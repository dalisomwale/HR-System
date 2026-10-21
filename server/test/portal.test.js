import fs from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { todayInLusaka } from '../src/utils/dates.js';
import { addDays } from '../src/modules/leave/calendar.js';
import { storageDir } from '../src/modules/documents/documents.routes.js';

let db;
let app;
let entra;
let config;

beforeAll(() => {
  db = createTestDb();
  ({ app, entra, config } = testApp(db));
});
afterAll(async () => {
  await fs.promises.rm(storageDir(config), { recursive: true, force: true });
  await db.destroy();
});

const as = (s) => ({
  get: (p) => s.agent.get(p),
  post: (p, body, headers = {}) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .set(headers)
      .send(body ?? {}),
  upload: (p, buf, fileName) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(fileName))
      .send(buf),
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

let ids;
let hr;
let admin;
let mgr;
let emp;
let other;
let cover;

async function login(e) {
  return { ...(await signIn(app, entra, { oid: e.oid })), id: e.id };
}

beforeEach(async () => {
  await resetData(db);
  await db('leave_types').whereIn('code', ['ANNUAL', 'SICK']).update({ is_active: true });
  ids = Object.fromEntries(
    (await db('leave_types').whereIn('code', ['ANNUAL', 'SICK']).select('id', 'code')).map((t) => [
      t.code,
      t.id,
    ]),
  );
  const hrE = await fixtureEmployee(db, { roles: ['HR_OFFICER'] });
  const adminE = await fixtureEmployee(db, { roles: ['HR_ADMIN'] });
  const mgrE = await fixtureEmployee(db, { first_name: 'Mona' });
  const empE = await fixtureEmployee(db, { managerId: mgrE.id, first_name: 'Ezra' });
  const otherE = await fixtureEmployee(db, { first_name: 'Olu' });
  const coverE = await fixtureEmployee(db, { first_name: 'Cara' });
  // One at a time: the stand-in for Microsoft holds one set of claims at once.
  const sessions = [];
  for (const e of [hrE, adminE, mgrE, empE, otherE, coverE]) sessions.push(await login(e));
  [hr, admin, mgr, emp, other, cover] = sessions;
  await db('balance_ledger').insert({
    employee_id: emp.id,
    leave_type_id: ids.ANNUAL,
    leave_year: 2027,
    amount: 10,
    entry_type: 'OPENING',
    source_type: 'OPENING',
    reason: 'Test opening balance',
  });
});

async function annualRequest() {
  const res = await as(emp).post('/api/leave/requests', {
    leaveTypeId: ids.ANNUAL,
    startDate: '2027-03-01',
    endDate: '2027-03-05',
    handoverNotes: 'Covered.',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function sickRequest(startDate = '2027-03-01', endDate = '2027-03-02') {
  const res = await as(emp).post('/api/leave/requests', {
    leaveTypeId: ids.SICK,
    handoverNotes: 'Covered.',
    startDate,
    endDate,
    reason: 'Unwell',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe('approval delegation', () => {
  const window = () => ({ startDate: todayInLusaka(), endDate: addDays(todayInLusaka(), 10) });

  it('lets a delegate act for the manager while it lasts, and stops when revoked', async () => {
    const r = await annualRequest();
    const created = await as(mgr).post('/api/delegations', {
      delegateId: cover.id,
      ...window(),
      reason: 'Leave',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const me = await cover.agent.get('/api/auth/me');
    expect(me.body.user.isDelegate).toBe(true);
    const queue = await as(cover).get('/api/approvals/manager');
    expect(queue.body.requests.map((q) => q.id)).toEqual([r.id]);

    const revoke = await as(mgr).post(`/api/delegations/${created.body.id}/revoke`);
    expect(revoke.status).toBe(200);
    const after = await as(cover).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' });
    expect(after.status).toBe(403);

    const again = await as(mgr).post('/api/delegations', { delegateId: cover.id, ...window() });
    expect(again.status).toBe(201);
    const approve = await as(cover).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const detail = await as(emp).get(`/api/leave/requests/${r.id}`);
    expect(detail.body.history.at(-1)).toMatchObject({
      action: 'APPROVE',
      onBehalfOf: expect.stringMatching(/^Mona/),
    });
    expect(await db('audit_log').where({ action: 'DELEGATION_CREATED' }).count({ n: '*' }).first()).toEqual({
      n: 2,
    });
  });

  it('refuses non-managers, overlaps, self-delegation and revocation by others', async () => {
    expect((await as(other).post('/api/delegations', { delegateId: cover.id, ...window() })).status).toBe(
      403,
    );
    expect((await as(mgr).post('/api/delegations', { delegateId: mgr.id, ...window() })).status).toBe(400);
    const first = await as(mgr).post('/api/delegations', { delegateId: cover.id, ...window() });
    expect(first.status).toBe(201);
    const overlap = await as(mgr).post('/api/delegations', { delegateId: other.id, ...window() });
    expect(overlap.status).toBe(409);
    expect((await as(other).post(`/api/delegations/${first.body.id}/revoke`)).status).toBe(404);
    expect(
      (
        await as(mgr).post('/api/delegations', {
          delegateId: cover.id,
          startDate: '2020-01-01',
          endDate: '2020-01-02',
        })
      ).status,
    ).toBe(400);
  });

  it('lets a System Administrator set one up for an absent manager and revoke it', async () => {
    const res = await as(admin).post('/api/admin/delegations', {
      delegatorId: mgr.id,
      delegateId: cover.id,
      ...window(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const list = await as(admin).get('/api/admin/delegations');
    expect(list.body.items[0]).toMatchObject({ status: 'ACTIVE', delegator: { id: mgr.id } });
    expect((await as(admin).post(`/api/delegations/${res.body.id}/revoke`)).status).toBe(200);
    expect((await as(emp).get('/api/admin/delegations')).status).toBe(403);
  });
});

describe('supporting documents', () => {
  it('accepts PDF, JPEG and PNG by content, not by name', async () => {
    const r = await annualRequest();
    const ok = await as(emp).upload(`/api/documents/requests/${r.id}`, PDF, 'ticket.pdf');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const png = await as(emp).upload(`/api/documents/requests/${r.id}`, PNG, 'photo');
    expect(png.status).toBe(201);
    const fake = await as(emp).upload(
      `/api/documents/requests/${r.id}`,
      Buffer.from('MZ not a pdf'),
      'evil.pdf',
    );
    expect(fake.status).toBe(400);
    const big = await as(emp).upload(
      `/api/documents/requests/${r.id}`,
      Buffer.concat([PDF, Buffer.alloc(config.documents.maxBytes)]),
      'big.pdf',
    );
    expect(big.status).toBe(413);

    const list = await as(emp).get(`/api/documents/requests/${r.id}`);
    expect(list.body.items.map((d) => d.name)).toEqual(['ticket.pdf', 'photo.png']);
    const row = await db('documents').where({ id: ok.body.id }).first();
    expect(row.stored_name).toMatch(/^[0-9a-f]{48}$/);
    expect(fs.existsSync(`${storageDir(config)}/${row.stored_name}`)).toBe(true);
  });

  it('keeps medical documents from the manager but lets HR download them, with an audit entry', async () => {
    const r = await sickRequest();
    const up = await as(emp).upload(`/api/documents/requests/${r.id}`, PDF, 'medical certificate.pdf');
    expect(up.status).toBe(201);

    const mgrView = await as(mgr).get(`/api/leave/requests/${r.id}`);
    expect(mgrView.body.documents[0]).toMatchObject({ restricted: true, name: null, medical: true });
    expect(mgrView.body.documentRequirement).toMatchObject({ provided: true });
    expect((await as(mgr).get(`/api/documents/${up.body.id}/download`)).status).toBe(404);
    expect((await as(other).get(`/api/documents/requests/${r.id}`)).status).toBe(404);
    expect((await as(other).get(`/api/documents/${up.body.id}/download`)).status).toBe(404);

    const dl = await as(hr).get(`/api/documents/${up.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toMatch(/attachment/);
    expect(dl.headers['cache-control']).toMatch(/no-store/);
    expect(Buffer.from(dl.body).subarray(0, 5).toString()).toBe('%PDF-');
    const audit = await db('audit_log').where({ action: 'DOCUMENT_DOWNLOADED' });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_employee_id).toBe(hr.id);

    // View opens it in the browser instead of saving, and is recorded separately.
    const view = await as(hr).get(`/api/documents/${up.body.id}/download?view=1`);
    expect(view.status).toBe(200);
    expect(view.headers['content-disposition']).toMatch(/^inline/);
    expect(view.headers['x-content-type-options']).toBe('nosniff');
    expect(await db('audit_log').where({ action: 'DOCUMENT_VIEWED' })).toHaveLength(1);
    expect((await as(mgr).get(`/api/documents/${up.body.id}/download?view=1`)).status).toBe(404);
  });

  it('lets only the employee upload, and remove their own upload while pending', async () => {
    const r = await annualRequest();
    expect((await as(mgr).upload(`/api/documents/requests/${r.id}`, PDF, 'x.pdf')).status).toBe(404);
    expect((await as(hr).upload(`/api/documents/requests/${r.id}`, PDF, 'x.pdf')).status).toBe(404);
    expect((await as(hr).get(`/api/leave/requests/${r.id}`)).body.can.uploadDocument).toBe(false);
    const up = await as(emp).upload(`/api/documents/requests/${r.id}`, PDF, 'x.pdf');
    expect((await as(mgr).post(`/api/documents/${up.body.id}/remove`)).status).toBe(404);
    expect((await as(hr).post(`/api/documents/${up.body.id}/remove`)).status).toBe(404);
    expect((await as(emp).post(`/api/documents/${up.body.id}/remove`)).status).toBe(200);
    expect((await as(emp).get(`/api/documents/requests/${r.id}`)).body.items).toHaveLength(0);

    await as(emp).post(`/api/leave/requests/${r.id}/withdraw`);
    expect((await as(emp).upload(`/api/documents/requests/${r.id}`, PDF, 'y.pdf')).status).toBe(409);
  });
});

describe('System Administrator rights', () => {
  it('has every HR Officer right and the manager pages, but still cannot approve their own leave', async () => {
    const me = await admin.agent.get('/api/auth/me');
    expect(me.body.user.roles).toEqual(expect.arrayContaining(['HR_ADMIN', 'HR_OFFICER']));
    expect((await as(admin).get('/api/approvals/hr')).status).toBe(200);
    expect((await as(admin).get('/api/dashboard/hr')).status).toBe(200);
    expect((await as(admin).get('/api/dashboard/manager')).status).toBe(200);
    expect((await as(admin).get('/api/reports')).body.scope).toBe('HR');

    // The administrator's own request, sent straight to HR (no manager): another HR person must decide.
    await db('balance_ledger').insert({
      employee_id: admin.id,
      leave_type_id: ids.ANNUAL,
      leave_year: 2027,
      amount: 10,
      entry_type: 'OPENING',
      source_type: 'OPENING',
      reason: 'Test opening balance',
    });
    const own = await as(admin).post('/api/leave/requests', {
      leaveTypeId: ids.ANNUAL,
      startDate: '2027-03-01',
      endDate: '2027-03-05',
      handoverNotes: 'Covered.',
    });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(
      (await as(admin).post(`/api/approvals/requests/${own.body.id}/hr`, { action: 'APPROVE' })).status,
    ).toBe(403);
  });
});

describe('dashboards', () => {
  it('shows the employee their pending requests and required actions', async () => {
    const r = await sickRequest();
    const res = await as(emp).get('/api/dashboard/employee');
    expect(res.status).toBe(200);
    expect(res.body.pending.map((p) => p.id)).toEqual([r.id]);
    expect(res.body.actions).toEqual([expect.objectContaining({ kind: 'DOCUMENT', requestId: r.id })]);
    expect(res.body.balances.length).toBeGreaterThan(0);
    expect(res.body.insights).toMatchObject({ awaitingDecision: 1, teamApprovals: null, hrApprovals: null });
    expect(res.body.activity[0]).toMatchObject({ requestId: r.id, action: 'SUBMIT', own: true, byMe: true });
  });

  it('lists approved leave running today as active, with the days left', async () => {
    const today = todayInLusaka();
    const r = await sickRequest(today, addDays(today, 6));
    await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' });
    const hrRes = await as(hr).post(`/api/approvals/requests/${r.id}/hr`, { action: 'APPROVE' });
    expect(hrRes.status, JSON.stringify(hrRes.body)).toBe(200);
    const res = await as(emp).get('/api/dashboard/employee');
    expect(res.body.active).toEqual([expect.objectContaining({ id: r.id, daysLeft: r.chargeableDays })]);
  });

  it('counts approved leave in the dashboard charts', async () => {
    const today = todayInLusaka();
    const r = await sickRequest(today, addDays(today, 6));
    await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' });
    await as(hr).post(`/api/approvals/requests/${r.id}/hr`, { action: 'APPROVE' });
    const year = Number(today.slice(0, 4));
    const inYear = await db('leave_request_days')
      .where({ leave_request_id: r.id })
      .whereBetween('leave_date', [`${year}-01-01`, `${year}-12-31`])
      .sum({ d: 'charged' })
      .first();

    const mine = (await as(emp).get('/api/dashboard/employee')).body.charts.monthly;
    expect(mine).toHaveLength(12);
    const total = mine.reduce((s, m) => s + m.taken + m.booked, 0);
    expect(total).toBeCloseTo(Number(inYear.d));

    const team = (await as(mgr).get('/api/dashboard/manager')).body.charts;
    expect(team.offDaily).toHaveLength(30);
    expect(team.offDaily[0].date).toBe(today);
    const offDays = team.offDaily.filter((d) => d.approved === 1).length;
    expect(offDays).toBe(
      Number(
        (
          await db('leave_request_days')
            .where({ leave_request_id: r.id })
            .where('charged', '>', 0)
            .count({ n: '*' })
            .first()
        ).n,
      ),
    );

    const group = (await as(hr).get('/api/dashboard/hr')).body.charts;
    expect(group.outcomes.find((o) => o.key === 'approved').count).toBe(1);
    expect(group.byType).toEqual([expect.objectContaining({ value: expect.any(Number) })]);
    expect(group.monthlyByType.series).toEqual([expect.objectContaining({ name: expect.any(String) })]);
  });

  it('shows a manager their department members without leave types, and refuses others', async () => {
    const today = todayInLusaka();
    const r = await sickRequest(today, addDays(today, 6));
    await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' });
    await as(hr).post(`/api/approvals/requests/${r.id}/hr`, { action: 'APPROVE' });
    const res = await as(mgr).get('/api/dashboard/members');
    expect(res.status).toBe(200);
    const m = res.body.members.find((x) => x.id === emp.id);
    expect(m).toMatchObject({ reportsToYou: true, pendingRequests: 0 });
    expect(res.body.summary.members).toBe(res.body.members.length);
    expect(JSON.stringify(res.body)).not.toMatch(/Sick|Unwell/);
    expect((await as(emp).get('/api/dashboard/members')).status).toBe(403);
  });

  it('gives the manager an approvals count and their decisions in recent activity', async () => {
    const r = await sickRequest();
    let res = await as(mgr).get('/api/dashboard/employee');
    expect(res.body.insights.teamApprovals).toBe(1);
    await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' });
    res = await as(mgr).get('/api/dashboard/employee');
    expect(res.body.insights.teamApprovals).toBe(0);
    expect(res.body.activity[0]).toMatchObject({
      requestId: r.id,
      action: 'APPROVE',
      own: false,
      byMe: true,
    });
  });

  it('shows the manager what awaits them, without reasons', async () => {
    const soon = addDays(todayInLusaka(), 5);
    const r = await sickRequest(soon, addDays(soon, 1));
    const res = await as(mgr).get('/api/dashboard/manager');
    expect(res.status).toBe(200);
    expect(res.body.awaiting[0]).toMatchObject({ id: r.id, workingDaysWaiting: 0, overdue: false });
    expect(res.body.upcoming[0]).toMatchObject({ id: r.id });
    expect(res.body.upcoming[0]).not.toHaveProperty('reason');
    expect(res.body.teamSize).toBe(1);
    expect((await as(other).get('/api/dashboard/manager')).status).toBe(403);
  });

  it('gives HR the queues and exceptions, and only to HR Officers', async () => {
    const r = await annualRequest();
    expect((await as(emp).get('/api/dashboard/hr')).status).toBe(403);
    let res = await as(hr).get('/api/dashboard/hr');
    expect(res.status).toBe(200);
    expect(res.body.withManagers[0]).toMatchObject({ id: r.id, manager: expect.stringMatching(/^Mona/) });
    expect(res.body.exceptions.accrualUnconfirmed).toContain('Annual leave');
    expect(res.body.exceptions.unconfirmedTypes.length).toBeGreaterThan(0);

    // The manager leaves: the request is held with nobody able to act.
    await db('employees').where({ id: mgr.id }).update({ status: 'INACTIVE' });
    res = await as(hr).get('/api/dashboard/hr');
    expect(res.body.exceptions.held.map((h) => h.id)).toEqual([r.id]);
  });
});

describe('directors', () => {
  for (const role of ['EXECUTIVE_DIRECTOR', 'MANAGING_DIRECTOR']) {
    it(`${role} sees leave across the group but cannot approve or administer`, async () => {
      const director = await login(await fixtureEmployee(db, { roles: [role], first_name: 'Dina' }));
      const sick = await sickRequest();

      const me = await as(director).get('/api/auth/me');
      expect(me.body.user.roles).toEqual([role]);
      expect((await as(director).get('/api/dashboard/hr')).status).toBe(200);
      const reports = await as(director).get('/api/reports');
      expect(reports.body.scope).toBe('HR');
      expect(reports.body.items).toHaveLength(14);

      // Request detail is visible; the confidential reason of sick leave is not.
      const detail = await as(director).get(`/api/leave/requests/${sick.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.reason).toBeNull();
      expect((await as(director).get(`/api/documents/requests/${sick.id}`)).status).toBe(200);

      expect(
        (await as(director).post(`/api/approvals/requests/${sick.id}/manager`, { action: 'APPROVE' })).status,
      ).toBe(403);
      expect(
        (await as(director).post(`/api/approvals/requests/${sick.id}/hr`, { action: 'APPROVE' })).status,
      ).toBe(403);
      expect((await as(director).get(`/api/hr/employees/${emp.id}/balances`)).status).toBe(403);
      expect((await as(director).get('/api/admin/employees')).status).toBe(403);
    });
  }

  it('can be granted from the Roles page, and the administrator is called System Administrator', async () => {
    const roles = await as(admin).get('/api/admin/roles');
    expect(roles.body.roles.map((r) => r.name)).toEqual([
      'HR Officer',
      'System Administrator',
      'Executive Director',
      'Managing Director',
    ]);
    const res = await as(admin).post('/api/admin/roles/MANAGING_DIRECTOR/holders', { employeeId: other.id });
    expect(res.status).toBe(201);
    const s = await login({
      id: other.id,
      oid: `00000000-0000-0000-0000-${String(other.id).padStart(12, '0')}`,
    });
    expect((await as(s).get('/api/auth/me')).body.user.roles).toEqual(['MANAGING_DIRECTOR']);
  });
});

describe('HR approvals page', () => {
  it('lists recent HR decisions with who made them', async () => {
    const r = await annualRequest();
    expect(
      (await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' })).status,
    ).toBe(200);
    const ok = await as(hr).post(`/api/approvals/requests/${r.id}/hr`, {
      action: 'APPROVE',
      comment: 'Fine.',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const page = await as(hr).get('/api/approvals/hr');
    expect(page.body.requests).toHaveLength(0);
    expect(page.body.decided).toHaveLength(1);
    expect(page.body.decided[0]).toMatchObject({
      id: r.id,
      decision: { action: 'APPROVE', comment: 'Fine.' },
    });
    expect(page.body.decided[0].decision.by).toBeTruthy();
  });
});

describe('sensitive requests', () => {
  it('go straight to HR, and the manager never sees the reason or documents', async () => {
    const res = await as(emp).post('/api/leave/requests', {
      leaveTypeId: ids.ANNUAL,
      startDate: '2027-03-01',
      endDate: '2027-03-05',
      handoverNotes: 'Covered.',
      reason: 'Private family matter',
      sensitive: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('PENDING_HR_APPROVAL');
    const row = await db('leave_requests').where({ id: res.body.id }).first();
    expect(row).toMatchObject({ is_sensitive: 1, assigned_manager_id: null, routed_without_manager: 0 });

    // No approval task for the manager, and they cannot act at the manager stage.
    const mgrNotes = await db('notifications').where({ recipient_id: mgr.id });
    expect(mgrNotes).toHaveLength(0);
    expect(
      (await as(mgr).post(`/api/approvals/requests/${res.body.id}/manager`, { action: 'APPROVE' })).status,
    ).not.toBe(200);
    expect((await as(hr).get('/api/dashboard/hr')).body.awaitingHr.map((r) => r.id)).toContain(res.body.id);

    const up = await as(emp).upload(`/api/documents/requests/${res.body.id}`, PDF, 'letter.pdf');
    expect(up.status).toBe(201);

    // The employee's manager can see that the leave exists, not why.
    const mgrView = await as(mgr).get(`/api/leave/requests/${res.body.id}`);
    expect(mgrView.status).toBe(200);
    expect(mgrView.body).toMatchObject({ sensitive: true, reason: null });
    expect(mgrView.body.documents[0]).toMatchObject({ restricted: true, name: null });
    expect((await as(mgr).get(`/api/documents/${up.body.id}/download`)).status).toBe(404);
    expect((await as(other).get(`/api/leave/requests/${res.body.id}`)).status).toBe(404);

    const hrView = await as(hr).get(`/api/leave/requests/${res.body.id}`);
    expect(hrView.body.reason).toBe('Private family matter');
    expect((await as(hr).get(`/api/documents/${up.body.id}/download`)).status).toBe(200);

    // HR approves; a later cancellation also goes straight to HR.
    const ok = await as(hr).post(`/api/approvals/requests/${res.body.id}/hr`, { action: 'APPROVE' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const cancel = await as(emp).post(`/api/leave/requests/${res.body.id}/cancel`, {
      reasonType: 'PLANS_CHANGED',
      reason: 'No longer needed',
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    expect(cancel.body.status).toBe('PENDING_HR_APPROVAL');
  });

  it('a request that is not ticked still goes to the manager', async () => {
    const r = await annualRequest();
    expect(r.status).toBe('PENDING_MANAGER_APPROVAL');
  });
});

describe('HR Officer administration rights', () => {
  it('reaches people and leave setup, but not roles, accounts, settings, emails or audit', async () => {
    for (const path of [
      '/api/admin/employees',
      '/api/admin/employees/options',
      '/api/admin/employees/import/template',
      '/api/admin/companies',
      '/api/admin/departments',
      '/api/admin/leave-types',
      '/api/admin/jobs',
      '/api/admin/delegations',
      '/api/admin/holidays?year=2027',
      '/api/admin/work-schedules',
      '/api/reports',
    ]) {
      expect((await as(hr).get(path)).status, path).toBe(200);
    }
    const created = await as(hr).post('/api/admin/companies', { code: 'HRC', name: 'Created by HR' });
    expect(created.status).toBe(201);
    const person = await as(hr).post('/api/admin/employees', {
      employeeNumber: 'HR-1',
      firstName: 'Added',
      lastName: 'ByHr',
      employmentStartDate: '2026-01-05',
      companyId: created.body.id,
    });
    expect(person.status, JSON.stringify(person.body)).toBe(201);

    for (const path of [
      '/api/admin/roles',
      '/api/admin/settings',
      '/api/admin/audit',
      '/api/admin/emails',
      '/api/admin/employees/pending-sign-ins',
    ]) {
      expect((await as(hr).get(path)).status, path).toBe(403);
    }
    expect(
      (
        await hr.agent
          .put(`/api/admin/employees/${person.body.id}/roles`)
          .set('X-CSRF-Token', hr.csrf)
          .send({ roles: ['HR_ADMIN'] })
      ).status,
    ).toBe(403);
    expect(
      (
        await hr.agent
          .put(`/api/admin/employees/${person.body.id}/identity`)
          .set('X-CSRF-Token', hr.csrf)
          .send({ objectId: '55555555-5555-5555-5555-555555555555' })
      ).status,
    ).toBe(403);

    expect((await as(hr).post(`/api/admin/employees/${person.body.id}/deactivate`, {})).status).toBe(403);
    expect((await as(admin).post(`/api/admin/employees/${person.body.id}/deactivate`, {})).status).toBe(200);
    expect((await as(hr).post(`/api/admin/employees/${person.body.id}/reactivate`, {})).status).toBe(403);

    // Ordinary employees still reach none of it.
    expect((await as(emp).get('/api/admin/employees')).status).toBe(403);
    expect((await as(emp).get('/api/admin/companies')).status).toBe(403);
  });
});

describe('My profile personal details', () => {
  const patch = (s, body) => s.agent.patch('/api/me/profile/personal').set('X-CSRF-Token', s.csrf).send(body);

  it('lets employees keep their own personal details, and nothing else', async () => {
    const res = await patch(emp, {
      mobilePhone: '+260 97 1234567',
      personalEmail: 'Ezra@Example.test',
      homeAddress: 'Plot 12, Kabulonga, Lusaka',
      emergencyContactName: 'Ruth',
      emergencyContactRelationship: 'Sister',
      emergencyContactPhone: '0977 000111',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const me = await as(emp).get('/api/me/profile');
    expect(me.body.personal).toMatchObject({
      mobilePhone: '+260 97 1234567',
      personalEmail: 'ezra@example.test',
      emergencyContactRelationship: 'Sister',
    });
    // HR sees them on the employee record.
    const hrView = await as(hr).get(`/api/admin/employees/${emp.id}`);
    expect(hrView.body.personal.homeAddress).toBe('Plot 12, Kabulonga, Lusaka');
    // The audit log names the fields changed, not their values.
    const audit = await db('audit_log').where({ action: 'PERSONAL_DETAILS_UPDATED' }).first();
    const after = typeof audit.after_data === 'string' ? JSON.parse(audit.after_data) : audit.after_data;
    expect(after.fields).toContain('mobilePhone');
    expect(JSON.stringify(after)).not.toContain('Kabulonga');

    // Job details, bad numbers and bad emails are refused.
    expect((await patch(emp, { jobTitle: 'Director' })).status).toBe(400);
    expect((await patch(emp, { mobilePhone: 'call me' })).status).toBe(400);
    expect((await patch(emp, { personalEmail: 'nope' })).status).toBe(400);
    // Clearing a field is allowed.
    expect((await patch(emp, { mobilePhone: '' })).status).toBe(200);
    expect((await as(emp).get('/api/me/profile')).body.personal.mobilePhone).toBeNull();
  });
});

describe('transfer: the manager offers different dates', () => {
  const offer = (r, body) => as(mgr).post(`/api/approvals/requests/${r.id}/transfer`, body);

  it('holds the offer until the employee answers, and refuses bad offers', async () => {
    const r = await sickRequest('2027-03-01', '2027-03-02');
    expect((await offer(r, { startDate: '2027-03-01', endDate: '2027-03-01' })).status).toBe(400);
    expect((await offer(r, { startDate: '2027-03-01', endDate: '2027-03-02', comment: 'Same' })).status).toBe(
      400,
    );
    expect((await offer(r, { startDate: '2027-03-01', endDate: '2027-03-05', comment: 'More' })).status).toBe(
      400,
    );
    expect(
      (
        await as(emp).post(`/api/approvals/requests/${r.id}/transfer`, {
          startDate: '2027-03-01',
          endDate: '2027-03-01',
          comment: 'Mine',
        })
      ).status,
    ).toBe(403);

    const res = await offer(r, { startDate: '2027-03-01', endDate: '2027-03-01', comment: 'Busy week' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'PENDING_EMPLOYEE_ACCEPTANCE', offeredDays: 1 });

    const detail = (await as(emp).get(`/api/leave/requests/${r.id}`)).body;
    expect(detail).toMatchObject({ startDate: '2027-03-01', endDate: '2027-03-02', chargeableDays: 2 });
    expect(detail.offer).toMatchObject({
      startDate: '2027-03-01',
      endDate: '2027-03-01',
      chargeableDays: 1,
      comment: 'Busy week',
    });
    expect(detail.can).toMatchObject({ accept: true, withdraw: true });
    const note = await db('notifications')
      .where({ recipient_id: emp.id, event_type: 'LEAVE_TRANSFERRED' })
      .first();
    expect(note).toBeTruthy();
    // While it is with the employee the manager cannot approve it.
    expect(
      (await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' })).status,
    ).toBe(409);
  });

  it('on acceptance takes the offered dates and goes back to the manager, then HR', async () => {
    const r = await sickRequest('2027-03-01', '2027-03-02');
    await offer(r, { startDate: '2027-03-02', endDate: '2027-03-02', comment: 'Monday is busy' });
    expect((await as(other).post(`/api/leave/requests/${r.id}/accept`)).status).toBe(403);
    const acc = await as(emp).post(`/api/leave/requests/${r.id}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body).toMatchObject({ status: 'PENDING_MANAGER_APPROVAL', chargeableDays: 1 });
    const row = await db('leave_requests').where({ id: r.id }).first();
    expect(row).toMatchObject({ start_date: '2027-03-02', end_date: '2027-03-02', offered_start_date: null });
    expect(await db('leave_request_days').where({ leave_request_id: r.id }).pluck('leave_date')).toEqual([
      '2027-03-02',
    ]);
    expect(
      await db('notifications')
        .where({ recipient_id: mgr.id, event_type: 'LEAVE_AWAITING_MANAGER' })
        .count({ n: '*' })
        .first(),
    ).toEqual({ n: 2 });
    expect(
      (await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' })).status,
    ).toBe(200);
    const fin = await as(hr).post(`/api/approvals/requests/${r.id}/hr`, { action: 'APPROVE' });
    expect(fin.body.status).toBe('APPROVED');
    const history = (await as(emp).get(`/api/leave/requests/${r.id}`)).body.history.map((h) => h.action);
    expect(history).toEqual(['SUBMIT', 'TRANSFER', 'ACCEPT', 'APPROVE', 'APPROVE']);
  });

  it('lets the employee withdraw instead, with a reason, and tells the manager', async () => {
    const r = await sickRequest('2027-03-01', '2027-03-02');
    await offer(r, { startDate: '2027-03-01', endDate: '2027-03-01', comment: 'One day only' });
    expect((await as(emp).post(`/api/leave/requests/${r.id}/withdraw`, {})).status).toBe(400);
    const res = await as(emp).post(`/api/leave/requests/${r.id}/withdraw`, { comment: 'I need both days' });
    expect(res.body.status).toBe('WITHDRAWN');
    const note = await db('notifications')
      .where({ recipient_id: mgr.id, event_type: 'LEAVE_WITHDRAWN' })
      .first();
    expect(note.title).toMatch(/declined/);
  });
});
