import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { todayInLusaka } from '../src/utils/dates.js';
import { addDays } from '../src/modules/leave/calendar.js';

let db;
let app;
let entra;

beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());

// Leave types come from migration 009 and are inactive; tests switch on what they need.
async function activate(...codes) {
  await db('leave_types').whereIn('code', codes).update({ is_active: true });
  return Object.fromEntries(
    (await db('leave_types').whereIn('code', codes).select('id', 'code')).map((t) => [t.code, t.id]),
  );
}

async function opening(employeeId, leaveTypeId, year, amount) {
  await db('balance_ledger').insert({
    employee_id: employeeId,
    leave_type_id: leaveTypeId,
    leave_year: year,
    amount,
    entry_type: 'OPENING',
    source_type: 'OPENING',
    reason: 'Test opening balance',
  });
}

const as = (s) => ({
  get: (p) => s.agent.get(p),
  post: (p, body, headers = {}) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .set(headers)
      .send(body ?? {}),
});

// A working Monday–Friday week well in the future, so notice rules are met.
const Y = 2027;
const MON = '2027-03-01';
const FRI = '2027-03-05';

let ids; // leave type ids
let hr; // HR officer session
let mgr; // manager session
let emp; // employee session
let empId;

beforeEach(async () => {
  await resetData(db);
  await db('leave_types').update({ is_active: false });
  ids = await activate('ANNUAL', 'SICK', 'MATERNITY', 'MOTHERS_DAY');
  const hrE = await fixtureEmployee(db, { roles: ['HR_OFFICER'] });
  const mgrE = await fixtureEmployee(db, { first_name: 'Mona' });
  const empE = await fixtureEmployee(db, { managerId: mgrE.id, sex: 'MALE', first_name: 'Ezra' });
  empId = empE.id;
  hr = { ...(await signIn(app, entra, { oid: hrE.oid })), id: hrE.id };
  mgr = { ...(await signIn(app, entra, { oid: mgrE.oid })), id: mgrE.id };
  emp = { ...(await signIn(app, entra, { oid: empE.oid })), id: empE.id };
  await opening(empId, ids.ANNUAL, Y, 10);
});

const annual = (over = {}) => ({
  leaveTypeId: ids.ANNUAL,
  startDate: MON,
  endDate: FRI,
  handoverNotes: 'Mutale covers the credit queue.',
  ...over,
});

async function submitted(over) {
  const res = await as(emp).post('/api/leave/requests', annual(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe('calculating and validating a request', () => {
  it('previews working days, excluding weekends and public holidays', async () => {
    await db('public_holidays').insert({ holiday_date: '2027-03-03', name: 'Test holiday' });
    const res = await as(emp).post('/api/leave/requests/preview', annual({ endDate: '2027-03-07' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      chargeableDays: 4,
      calendarDays: 7,
      nonWorkingDaysExcluded: 2,
      ok: true,
    });
    expect(res.body.holidaysExcluded).toEqual([{ date: '2027-03-03', name: 'Test holiday' }]);
  });

  it('asks for a reason when notice is shorter than two weeks', async () => {
    const soon = addDays(todayInLusaka(), 3);
    await opening(empId, ids.ANNUAL, Number(soon.slice(0, 4)), 10);
    const res = await as(emp).post('/api/leave/requests/preview', annual({ startDate: soon, endDate: soon }));
    if (res.body.chargeableDays === 0) return; // landed on a weekend; nothing to check
    expect(res.body.ok).toBe(false);
    expect(res.body.errors.map((e) => e.field)).toContain('noticeShortfallReason');
    const withReason = await as(emp).post(
      '/api/leave/requests/preview',
      annual({ startDate: soon, endDate: soon, noticeShortfallReason: 'Family event' }),
    );
    expect(withReason.body.warnings.join(' ')).toMatch(/14 days/);
  });

  it('refuses more days than the balance, overlaps, and dates with no working days', async () => {
    const tooMuch = await as(emp).post('/api/leave/requests', annual({ endDate: '2027-03-19' }));
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.fields[0].message).toMatch(
      /10 days of annual leave available for 2027; this request needs 15/,
    );

    await submitted();
    const overlap = await as(emp).post(
      '/api/leave/requests',
      annual({ startDate: '2027-03-04', endDate: '2027-03-04' }),
    );
    expect(overlap.status).toBe(400);
    expect(overlap.body.error.fields[0].message).toMatch(/overlap/);

    const weekend = await as(emp).post(
      '/api/leave/requests',
      annual({ startDate: '2027-03-06', endDate: '2027-03-07' }),
    );
    expect(weekend.body.error.fields[0].message).toMatch(/no working days/);
  });

  it('counts pending requests against what is available', async () => {
    await submitted(); // 5 days pending
    const res = await as(emp).post(
      '/api/leave/requests/preview',
      annual({ startDate: '2027-04-05', endDate: '2027-04-12' }),
    );
    expect(res.body.ok).toBe(false);
    expect(res.body.balances[0]).toMatchObject({ available: 5, requested: 6 });
  });

  it('applies eligibility: maternity leave is not available to a male employee', async () => {
    const res = await as(emp).post('/api/leave/requests/preview', {
      leaveTypeId: ids.MATERNITY,
      startDate: '2027-05-03',
      endDate: '2027-05-09',
    });
    expect(res.body.errors[0].message).toMatch(/Only available to female employees/);
  });

  it('leaves out leave types for the other sex wherever leave types are listed', async () => {
    const codes = async (session, path, pick) => (await as(session).get(path)).body.items.map(pick).sort();
    // Male: no maternity or Mother's Day in the apply list or the balances.
    expect(await codes(emp, '/api/leave/types', (t) => t.code)).toEqual(['ANNUAL', 'SICK']);
    expect(await codes(emp, `/api/leave/balances?year=${Y}`, (b) => b.leaveType.code)).toEqual([
      'ANNUAL',
      'SICK',
    ]);
    expect(
      (await as(hr).get(`/api/hr/employees/${empId}/balances?year=${Y}`)).body.items.map(
        (b) => b.leaveType.code,
      ),
    ).not.toContain('MATERNITY');

    // Female: no paternity.
    await activate('PATERNITY');
    const her = await fixtureEmployee(db, { sex: 'FEMALE' });
    const s = await signIn(app, entra, { oid: her.oid });
    const hers = await codes(s, '/api/leave/types', (t) => t.code);
    expect(hers).toContain('MATERNITY');
    expect(hers).not.toContain('PATERNITY');

    // Sex not recorded: everything is listed, with a note that HR must complete the record.
    const unknown = await fixtureEmployee(db, {});
    const u = await signIn(app, entra, { oid: unknown.oid });
    const types = (await as(u).get('/api/leave/types')).body.items;
    expect(types.map((t) => t.code)).toEqual(expect.arrayContaining(['MATERNITY', 'PATERNITY']));
    expect(types.find((t) => t.code === 'PATERNITY').notAvailableReason).toMatch(
      /complete your employee record/,
    );
  });

  it("limits Mother's Day to one day a calendar month", async () => {
    const her = await fixtureEmployee(db, { sex: 'FEMALE' });
    const s = await signIn(app, entra, { oid: her.oid });
    const first = await as(s).post('/api/leave/requests', {
      leaveTypeId: ids.MOTHERS_DAY,
      handoverNotes: 'Covered.',
      startDate: '2027-03-01',
      endDate: '2027-03-01',
    });
    expect(first.status).toBe(201);
    const second = await as(s).post('/api/leave/requests', {
      leaveTypeId: ids.MOTHERS_DAY,
      handoverNotes: 'Covered.',
      startDate: '2027-03-15',
      endDate: '2027-03-15',
    });
    expect(second.status).toBe(400);
    expect(second.body.error.fields[0].message).toMatch(/1 days in a calendar month/);
    const nextMonth = await as(s).post('/api/leave/requests', {
      leaveTypeId: ids.MOTHERS_DAY,
      handoverNotes: 'Covered.',
      startDate: '2027-04-01',
      endDate: '2027-04-01',
    });
    expect(nextMonth.status).toBe(201);
  });

  it('requires handover notes for every leave type', async () => {
    const res = await as(emp).post('/api/leave/requests', annual({ handoverNotes: '' }));
    expect(res.body.error.fields.map((f) => f.path)).toContain('handoverNotes');
    const sick = await as(emp).post('/api/leave/requests', {
      leaveTypeId: ids.SICK,
      startDate: addDays(todayInLusaka(), -2),
      endDate: addDays(todayInLusaka(), -1),
      handoverNotes: '   ',
    });
    expect(sick.status).toBe(400);
    expect(sick.body.error.fields.map((f) => f.path)).toContain('handoverNotes');
  });
});

describe('two-stage approval', () => {
  it('goes employee → manager → HR, and deducts only at HR approval', async () => {
    const { id } = await submitted();
    expect((await db('leave_requests').where({ id }).first()).status).toBe('PENDING_MANAGER_APPROVAL');

    const managerApprove = await as(mgr).post(`/api/approvals/requests/${id}/manager`, { action: 'APPROVE' });
    expect(managerApprove.body.status).toBe('PENDING_HR_APPROVAL');
    expect(await db('balance_ledger').where({ entry_type: 'DEDUCTION' })).toHaveLength(0);

    const hrApprove = await as(hr).post(`/api/approvals/requests/${id}/hr`, { action: 'APPROVE' });
    expect(hrApprove.body.status).toBe('APPROVED');
    const deductions = await db('balance_ledger').where({ entry_type: 'DEDUCTION', source_id: id });
    expect(deductions.map((d) => Number(d.amount))).toEqual([-5]);

    const balances = await as(emp).get(`/api/leave/balances?year=${Y}`);
    expect(balances.body.items.find((b) => b.leaveType.code === 'ANNUAL')).toMatchObject({
      balance: 5,
      available: 5,
      taken: 5,
    });
  });

  it('HR cannot approve before the manager has', async () => {
    const { id } = await submitted();
    const res = await as(hr).post(`/api/approvals/requests/${id}/hr`, { action: 'APPROVE' });
    expect(res.status).toBe(409);
  });

  it('only the manager can act at the manager stage; nobody approves their own', async () => {
    const { id } = await submitted();
    expect((await as(emp).post(`/api/approvals/requests/${id}/manager`, { action: 'APPROVE' })).status).toBe(
      403,
    );
    expect((await as(hr).post(`/api/approvals/requests/${id}/manager`, { action: 'APPROVE' })).status).toBe(
      403,
    );
  });

  it('managers cannot perform the HR stage', async () => {
    const { id } = await submitted();
    await as(mgr).post(`/api/approvals/requests/${id}/manager`, { action: 'APPROVE' });
    expect((await as(mgr).post(`/api/approvals/requests/${id}/hr`, { action: 'APPROVE' })).status).toBe(403);
  });

  it('an HR Officer who approved as manager cannot also give final approval', async () => {
    const hrMgr = await fixtureEmployee(db, { roles: ['HR_OFFICER'] });
    const report = await fixtureEmployee(db, { managerId: hrMgr.id });
    await opening(report.id, ids.ANNUAL, Y, 10);
    const r = await signIn(app, entra, { oid: report.oid });
    const h = await signIn(app, entra, { oid: hrMgr.oid });
    const { body } = await as(r).post('/api/leave/requests', annual());
    await as(h).post(`/api/approvals/requests/${body.id}/manager`, { action: 'APPROVE' });
    const final = await as(h).post(`/api/approvals/requests/${body.id}/hr`, { action: 'APPROVE' });
    expect(final.status).toBe(403);
    expect(
      (await as(hr).post(`/api/approvals/requests/${body.id}/hr`, { action: 'APPROVE' })).body.status,
    ).toBe('APPROVED');
  });

  it('HR Officers cannot finally approve their own leave', async () => {
    const hrE = await db('employees').where({ id: hr.id }).first();
    await db('employees').where({ id: hr.id }).update({ line_manager_id: mgr.id, sex: hrE.sex });
    await opening(hr.id, ids.ANNUAL, Y, 10);
    const { body } = await as(hr).post('/api/leave/requests', annual());
    await as(mgr).post(`/api/approvals/requests/${body.id}/manager`, { action: 'APPROVE' });
    expect((await as(hr).post(`/api/approvals/requests/${body.id}/hr`, { action: 'APPROVE' })).status).toBe(
      403,
    );
  });

  it('sends requests from staff with no manager straight to HR, and records why', async () => {
    const solo = await fixtureEmployee(db);
    await opening(solo.id, ids.ANNUAL, Y, 10);
    const s = await signIn(app, entra, { oid: solo.oid });
    const { body } = await as(s).post('/api/leave/requests', annual());
    expect(body.status).toBe('PENDING_HR_APPROVAL');
    const route = await db('approval_actions').where({ leave_request_id: body.id, action: 'ROUTE' }).first();
    expect(route.comment).toMatch(/No active manager/);
  });

  it('deducts exactly once even when HR approves twice at the same moment', async () => {
    const { id } = await submitted();
    await as(mgr).post(`/api/approvals/requests/${id}/manager`, { action: 'APPROVE' });
    const hr2E = await fixtureEmployee(db, { roles: ['HR_OFFICER'] });
    const hr2 = await signIn(app, entra, { oid: hr2E.oid });
    const results = await Promise.all([
      as(hr).post(`/api/approvals/requests/${id}/hr`, { action: 'APPROVE' }),
      as(hr2).post(`/api/approvals/requests/${id}/hr`, { action: 'APPROVE' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db('balance_ledger').where({ entry_type: 'DEDUCTION', source_id: id })).toHaveLength(1);
  });

  it('rejects stale decisions made on an out-of-date view', async () => {
    const { id } = await submitted();
    const res = await as(mgr).post(`/api/approvals/requests/${id}/manager`, {
      action: 'APPROVE',
      version: 99,
    });
    expect(res.status).toBe(409);
  });

  it('rejection needs a reason and deducts nothing', async () => {
    const { id } = await submitted();
    expect((await as(mgr).post(`/api/approvals/requests/${id}/manager`, { action: 'REJECT' })).status).toBe(
      400,
    );
    const res = await as(mgr).post(`/api/approvals/requests/${id}/manager`, {
      action: 'REJECT',
      comment: 'Month-end close.',
    });
    expect(res.body.status).toBe('REJECTED_BY_MANAGER');
    expect(await db('balance_ledger').where({ entry_type: 'DEDUCTION' })).toHaveLength(0);
  });

  it('HR can return a request; the employee corrects it and it goes back to the manager', async () => {
    const { id } = await submitted();
    await as(mgr).post(`/api/approvals/requests/${id}/manager`, { action: 'APPROVE' });
    const ret = await as(hr).post(`/api/approvals/requests/${id}/hr`, {
      action: 'RETURN',
      comment: 'Handover contact missing.',
    });
    expect(ret.body.status).toBe('RETURNED_FOR_CORRECTION');
    const re = await as(emp).post(`/api/leave/requests/${id}/resubmit`, {
      startDate: MON,
      endDate: '2027-03-04',
      handoverNotes: 'Mutale covers; queue handed over on Friday.',
    });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect(re.body.status).toBe('PENDING_MANAGER_APPROVAL');
    const updated = await db('leave_requests').where({ id }).first();
    expect(Number(updated.chargeable_days)).toBe(4);
    const history = await db('approval_actions').where({ leave_request_id: id }).pluck('action');
    expect(history).toEqual(['SUBMIT', 'APPROVE', 'RETURN', 'RESUBMIT']);
  });

  it('the employee can withdraw a pending request, and nobody else can', async () => {
    const { id } = await submitted();
    expect((await as(mgr).post(`/api/leave/requests/${id}/withdraw`)).status).toBe(403);
    expect((await as(emp).post(`/api/leave/requests/${id}/withdraw`)).body.status).toBe('WITHDRAWN');
  });
});

describe('cancelling approved leave', () => {
  it('returns the days when leave is cancelled before it starts, after both approvals', async () => {
    const { id } = await submitted();
    await as(mgr).post(`/api/approvals/requests/${id}/manager`, { action: 'APPROVE' });
    await as(hr).post(`/api/approvals/requests/${id}/hr`, { action: 'APPROVE' });

    const cancel = await as(emp).post(`/api/leave/requests/${id}/cancel`, {
      reasonType: 'PLANS_CHANGED',
      reason: 'Trip postponed.',
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    expect(
      (
        await as(emp).post(`/api/leave/requests/${id}/cancel`, {
          reasonType: 'PLANS_CHANGED',
          reason: 'Again',
        })
      ).status,
    ).toBe(409);

    await as(mgr).post(`/api/approvals/changes/${cancel.body.id}/manager`, { action: 'APPROVE' });
    const done = await as(hr).post(`/api/approvals/changes/${cancel.body.id}/hr`, { action: 'APPROVE' });
    expect(done.body).toMatchObject({ status: 'APPROVED', daysReturned: 5, leaveStatus: 'CANCELLED' });

    const ledger = await db('balance_ledger')
      .where({ employee_id: empId, leave_year: Y })
      .sum({ t: 'amount' })
      .first();
    expect(Number(ledger.t)).toBe(10);
  });
});

describe('balances table figures', () => {
  it('reports approved and waiting days separately for every leave type', async () => {
    const res = await as(emp).post('/api/leave/requests', {
      leaveTypeId: ids.SICK,
      handoverNotes: 'Covered.',
      startDate: addDays(todayInLusaka(), -2),
      endDate: addDays(todayInLusaka(), -1),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const sick = async () =>
      (await as(emp).get(`/api/leave/balances?year=${todayInLusaka().slice(0, 4)}`)).body.items.find(
        (b) => b.leaveType.code === 'SICK',
      );
    expect(await sick()).toMatchObject({ taken: 0, pending: 2, remaining: 28 });

    await as(mgr).post(`/api/approvals/requests/${res.body.id}/manager`, { action: 'APPROVE' });
    const ok = await as(hr).post(`/api/approvals/requests/${res.body.id}/hr`, { action: 'APPROVE' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await sick()).toMatchObject({ taken: 2, pending: 0, remaining: 28 });
  });
});

describe('who can see a request', () => {
  it('hides requests from unrelated staff and confidential reasons from managers', async () => {
    const res = await as(emp).post('/api/leave/requests', {
      leaveTypeId: ids.SICK,
      handoverNotes: 'Covered.',
      startDate: addDays(todayInLusaka(), -2),
      endDate: addDays(todayInLusaka(), -1),
      reason: 'Diagnosis details',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const outsider = await fixtureEmployee(db);
    const o = await signIn(app, entra, { oid: outsider.oid });
    expect((await o.agent.get(`/api/leave/requests/${res.body.id}`)).status).toBe(404);

    const asManager = await mgr.agent.get(`/api/leave/requests/${res.body.id}`);
    expect(asManager.body.reason).toBeNull();
    expect(asManager.body.reasonHidden).toBe(true);
    expect((await hr.agent.get(`/api/leave/requests/${res.body.id}`)).body.reason).toBe('Diagnosis details');
  });
});

describe('duplicate submissions', () => {
  it('the same Idempotency-Key submits once and replays the answer', async () => {
    const key = { 'Idempotency-Key': 'submit-abc-12345' };
    const first = await as(emp).post('/api/leave/requests', annual(), key);
    const again = await as(emp).post('/api/leave/requests', annual(), key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.id).toBe(first.body.id);
    expect(await db('leave_requests').where({ employee_id: empId })).toHaveLength(1);
    const different = await as(emp).post('/api/leave/requests', annual({ endDate: '2027-03-02' }), key);
    expect(different.status).toBe(422);
  });
});

describe('leave types and balance jobs', () => {
  let admin;
  beforeEach(async () => {
    const a = await fixtureEmployee(db, { roles: ['HR_ADMIN'] });
    admin = await signIn(app, entra, { oid: a.oid });
  });

  it('refuses accrual until HR confirms the rule, then accrues once per month', async () => {
    const refused = await as(admin).post('/api/admin/jobs/monthly-accrual', { period: '2027-01' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/HR must confirm the accrual rule/);

    const change = await as(admin).post(`/api/admin/leave-types/${ids.ANNUAL}/policy`, {
      effectiveFrom: '2026-01-01',
      accrualMethod: 'ENTITLEMENT_DIV_12',
      accrualConfirmed: true,
      note: 'HR confirmed 25 days a year, accrued monthly.',
    });
    expect(change.status, JSON.stringify(change.body)).toBe(201);
    expect(change.body.versionNo).toBe(2);

    const run = await as(admin).post('/api/admin/jobs/monthly-accrual', { period: '2027-01' });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const accrual = await db('balance_ledger').where({ employee_id: empId, entry_type: 'ACCRUAL' });
    expect(accrual.map((a) => Number(a.amount))).toEqual([2.08]);

    const again = await as(admin).post('/api/admin/jobs/monthly-accrual', { period: '2027-01' });
    expect(again.body.skipped).toBe(true);
    expect(await db('balance_ledger').where({ entry_type: 'ACCRUAL', employee_id: empId })).toHaveLength(1);
  });

  it('shows one leave type in full: versions with why they changed, usage and history', async () => {
    await as(admin).post(`/api/admin/leave-types/${ids.ANNUAL}/policy`, {
      effectiveFrom: '2026-01-01',
      accrualMethod: 'ENTITLEMENT_DIV_12',
      accrualConfirmed: true,
      note: 'HR confirmed 25 days a year, accrued monthly.',
    });
    const res = await as(admin).get(`/api/admin/leave-types/${ids.ANNUAL}`);
    expect(res.status).toBe(200);
    expect(res.body.current.versionNo).toBe(2);
    expect(res.body.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(res.body.versions[0]).toMatchObject({ note: 'HR confirmed 25 days a year, accrued monthly.' });
    expect(res.body.versions[0].confirmedBy).toBeTruthy();
    expect(res.body.usage).toMatchObject({ pending: 0, approved: 0, onLeaveToday: 0 });
    expect(res.body.history[0]).toMatchObject({ action: 'Rules changed' });
    expect((await as(admin).get('/api/admin/leave-types/999999')).status).toBe(404);
    expect((await as(emp).get(`/api/admin/leave-types/${ids.ANNUAL}`)).status).toBe(403);
  });

  it('activating a leave type records HR confirmation', async () => {
    await db('leave_types').where({ id: ids.SICK }).update({ is_active: false });
    const res = await as(admin).post(`/api/admin/leave-types/${ids.SICK}/activate`);
    expect(res.status).toBe(200);
    const v = await db('leave_policy_versions').where({ leave_type_id: ids.SICK }).first();
    expect(v.confirmed_at).not.toBeNull();
    expect(v.requires_hr_confirmation).toBe(0);
  });

  it('HR records opening balances once, with a reason', async () => {
    const other = await fixtureEmployee(db);
    const body = {
      employeeId: other.id,
      leaveTypeId: ids.ANNUAL,
      year: Y,
      amount: 12.5,
      reason: 'Balance from paper records',
      kind: 'OPENING',
    };
    expect((await as(hr).post('/api/hr/balances', body)).status).toBe(201);
    expect((await as(hr).post('/api/hr/balances', body)).status).toBe(409);
    expect((await as(emp).post('/api/hr/balances', body)).status).toBe(403);
  });
});
