import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn, TENANT } from './helpers/app.js';
import { todayInLusaka } from '../src/utils/dates.js';
import { addDays } from '../src/modules/leave/calendar.js';
import { notify } from '../src/modules/notifications/notify.service.js';
import { processOutbox } from '../src/modules/notifications/email-worker.js';
import { escalateOverdue, remindDocumentsDue } from '../src/modules/notifications/reminders.js';
import { renderEmail, buildMime } from '../src/modules/notifications/mail-template.js';

let db;
let app;
let entra;

beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db, {
    MAIL_TRANSPORT: 'graph',
    MAIL_SENDER_ADDRESS: 'leave@example.test',
    GRAPH_MAIL_CLIENT_ID: 'mail-client',
    GRAPH_MAIL_CLIENT_SECRET: 'mail-secret',
  }));
});
afterAll(() => db.destroy());

const as = (s) => ({
  get: (p) => s.agent.get(p),
  post: (p, body) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .send(body ?? {}),
});

let ids;
let hr;
let hr2;
let admin;
let boss;
let mgr;
let emp;

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
  const hrE = await fixtureEmployee(db, { roles: ['HR_OFFICER'], first_name: 'Hana' });
  const hr2E = await fixtureEmployee(db, { roles: ['HR_OFFICER'], first_name: 'Hugo' });
  const adminE = await fixtureEmployee(db, { roles: ['HR_ADMIN'], first_name: 'Ada' });
  const bossE = await fixtureEmployee(db, { first_name: 'Bola' });
  const mgrE = await fixtureEmployee(db, { first_name: 'Mona', managerId: bossE.id });
  const empE = await fixtureEmployee(db, { first_name: 'Ezra', managerId: mgrE.id });
  const s = [];
  for (const e of [hrE, hr2E, adminE, bossE, mgrE, empE]) s.push(await login(e));
  [hr, hr2, admin, boss, mgr, emp] = s;
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

const notes = (recipientId) => db('notifications').where({ recipient_id: recipientId }).orderBy('id');
const mails = (recipientId) => db('email_outbox').where({ recipient_id: recipientId }).orderBy('id');

async function submitAnnual() {
  const res = await as(emp).post('/api/leave/requests', {
    leaveTypeId: ids.ANNUAL,
    startDate: '2027-03-01',
    endDate: '2027-03-05',
    handoverNotes: 'Covered.',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe('workflow notifications', () => {
  it('tells the manager to review, and confirms to the employee in the system only', async () => {
    const r = await submitAnnual();
    const [m] = await notes(mgr.id);
    expect(m).toMatchObject({ event_type: 'LEAVE_AWAITING_MANAGER', link_path: `/leave/requests/${r.id}` });
    const [mail] = await mails(mgr.id);
    expect(mail).toMatchObject({ status: 'QUEUED', subject: expect.stringContaining(r.reference) });
    expect(mail.body_text).toContain('Annual leave');
    expect(mail.body_text).toContain('http://localhost:5173/leave/requests/');
    expect(await notes(emp.id)).toHaveLength(1);
    expect(await mails(emp.id)).toHaveLength(0);
  });

  it('never names a confidential leave type or includes the reason in an email', async () => {
    await as(emp).post('/api/leave/requests', {
      leaveTypeId: ids.SICK,
      startDate: '2027-03-01',
      endDate: '2027-03-02',
      reason: 'Private medical detail',
    });
    const [mail] = await mails(mgr.id);
    expect(mail.body_text).toContain('Leave (details in the system)');
    expect(mail.body_text + mail.body_html).not.toMatch(/Sick|Private medical detail/);
  });

  it('moves through the stages: HR is told after the manager, the employee after each decision', async () => {
    const r = await submitAnnual();
    await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' });
    expect((await mails(emp.id)).map((m) => m.event_type)).toEqual(['LEAVE_MANAGER_APPROVED']);
    for (const h of [hr, hr2]) {
      expect((await notes(h.id)).map((n) => n.event_type)).toEqual(['LEAVE_AWAITING_HR']);
    }
    // The manager does not hear about their own approval.
    expect((await notes(mgr.id)).map((n) => n.event_type)).toEqual(['LEAVE_AWAITING_MANAGER']);

    await as(hr).post(`/api/approvals/requests/${r.id}/hr`, { action: 'APPROVE' });
    expect((await mails(emp.id)).map((m) => m.event_type)).toEqual([
      'LEAVE_MANAGER_APPROVED',
      'LEAVE_HR_APPROVED',
    ]);
    expect((await notes(mgr.id)).at(-1).event_type).toBe('LEAVE_HR_APPROVED_FYI');
    expect(await notes(hr.id)).toHaveLength(1); // nothing for their own decision
  });

  it('writes nothing when the change is rolled back', async () => {
    await expect(
      db.transaction(async (trx) => {
        await notify(trx, {
          recipients: [mgr.id],
          event: 'X',
          title: 'Should vanish',
          email: { intro: 'x' },
        });
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await notes(mgr.id)).toHaveLength(0);
    expect(await mails(mgr.id)).toHaveLength(0);

    const bad = await as(emp).post('/api/leave/requests', {
      leaveTypeId: ids.ANNUAL,
      startDate: '2027-03-01',
      endDate: '2027-03-31',
      handoverNotes: 'x',
    });
    expect(bad.status).toBe(400);
    expect(await db('notifications').count({ n: '*' }).first()).toEqual({ n: 0 });
  });

  it('tells HR Administrators once about a sign-in that is not linked', async () => {
    for (let i = 0; i < 2; i += 1) {
      await signIn(app, entra, {
        oid: '99999999-0000-0000-0000-000000000001',
        name: 'New Person',
        tid: TENANT,
      });
    }
    const n = await notes(admin.id);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ event_type: 'ACCESS_NOT_CONFIGURED', link_path: '/admin/sign-in-requests' });
  });
});

describe('notification list', () => {
  it('lists, counts and marks as read only the user’s own notifications', async () => {
    await submitAnnual();
    let res = await as(mgr).get('/api/notifications');
    expect(res.body).toMatchObject({ unread: 1, total: 1 });
    const id = res.body.items[0].id;
    expect((await as(emp).post(`/api/notifications/${id}/read`)).status).toBe(404);
    expect((await as(mgr).post(`/api/notifications/${id}/read`)).status).toBe(200);
    res = await as(mgr).get('/api/notifications/unread-count');
    expect(res.body.unread).toBe(0);
    expect((await as(emp).post('/api/notifications/read-all')).body.marked).toBe(1);
  });
});

describe('email outbox', () => {
  const fake = (fail = false) => {
    const sent = [];
    return {
      sent,
      async send(m) {
        await new Promise((r) => setTimeout(r, 20));
        if (fail) throw new Error('Microsoft Graph did not accept the message (403) ErrorAccessDenied');
        sent.push(m);
        return { messageId: `msg-${sent.length}` };
      },
    };
  };

  it('marks accepted messages honestly and sends each once, even with two workers', async () => {
    await submitAnnual();
    await as(mgr).post(`/api/approvals/requests/${(await db('leave_requests').first('id')).id}/manager`, {
      action: 'APPROVE',
    });
    const queued = await db('email_outbox').count({ n: '*' }).first();
    const t = fake();
    const [a, b] = await Promise.all([processOutbox(db, t), processOutbox(db, t)]);
    expect(a.accepted + b.accepted).toBe(queued.n);
    expect(t.sent).toHaveLength(queued.n);
    const rows = await db('email_outbox');
    expect(rows.every((r) => r.status === 'ACCEPTED' && r.provider_message_id && r.accepted_at)).toBe(true);
  });

  it('retries with a delay, gives up after the limit, and HR Administrators can resend', async () => {
    await submitAnnual();
    await db('system_settings').where({ setting_key: 'email_max_attempts' }).update({ value: '2' });
    const failing = fake(true);
    expect((await processOutbox(db, failing)).failed).toBe(1);
    let [m] = await mails(mgr.id);
    expect(m).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(m.last_error).toMatch(/ErrorAccessDenied/);
    expect(new Date(m.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect((await processOutbox(db, failing)).failed).toBe(0); // not due yet

    await db('email_outbox').update({ next_attempt_at: db.raw('NOW()') });
    expect((await processOutbox(db, failing)).dead).toBe(1);
    [m] = await mails(mgr.id);
    expect(m.status).toBe('DEAD');

    expect((await as(emp).post(`/api/admin/emails/${m.id}/resend`)).status).toBe(403);
    const list = await as(admin).get('/api/admin/emails?status=PROBLEMS');
    expect(list.body.items.map((i) => i.id)).toEqual([m.id]);
    expect((await as(admin).post(`/api/admin/emails/${m.id}/resend`)).status).toBe(200);
    expect((await mails(mgr.id))[0]).toMatchObject({ status: 'QUEUED', attempts: 0 });
    const ok = fake();
    await processOutbox(db, ok);
    expect((await mails(mgr.id))[0].status).toBe('ACCEPTED');
  });

  it('queues a test message to the administrator', async () => {
    await db('employees').where({ id: admin.id }).update({ email: 'ada@example.test' });
    const res = await as(admin).post('/api/admin/emails/test');
    expect(res.status).toBe(201);
    expect((await mails(admin.id))[0]).toMatchObject({
      to_address: 'ada@example.test',
      event_type: 'EMAIL_TEST',
    });
  });
});

describe('reminders and escalation', () => {
  it('escalates an undecided request once, to the manager, their manager and HR, without approving it', async () => {
    const r = await submitAnnual();
    await db('leave_requests')
      .where({ id: r.id })
      .update({ submitted_at: db.raw('NOW() - INTERVAL 10 DAY') });
    expect(await escalateOverdue(db)).toBe(1);
    expect(await escalateOverdue(db)).toBe(0);
    const row = await db('leave_requests').where({ id: r.id }).first();
    expect(row).toMatchObject({ is_overdue: 1, status: 'PENDING_MANAGER_APPROVAL' });
    const action = await db('approval_actions').where({ leave_request_id: r.id, action: 'ESCALATE' }).first();
    expect(action.comment).toMatch(/not approved automatically/);
    for (const p of [mgr, boss, hr, hr2]) {
      expect((await notes(p.id)).some((n) => n.event_type === 'LEAVE_OVERDUE')).toBe(true);
    }
    expect((await notes(emp.id)).some((n) => n.event_type === 'LEAVE_OVERDUE')).toBe(false);

    // Moving to HR clears the flag, so the HR stage can escalate on its own.
    await as(mgr).post(`/api/approvals/requests/${r.id}/manager`, { action: 'APPROVE' });
    expect((await db('leave_requests').where({ id: r.id }).first()).is_overdue).toBe(0);
  });

  it('reminds the employee once when leave starts without a required document', async () => {
    const start = todayInLusaka();
    const res = await as(emp).post('/api/leave/requests', {
      leaveTypeId: ids.SICK,
      startDate: start,
      endDate: addDays(start, 1),
      reason: 'Unwell',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await remindDocumentsDue(db)).toBe(1);
    expect(await remindDocumentsDue(db)).toBe(0);
    expect((await mails(emp.id)).map((m) => m.event_type)).toEqual(['DOCUMENT_DUE']);
  });
});

describe('email content', () => {
  it('escapes text and keeps headers clean', () => {
    const { html, text } = renderEmail({
      greetingName: '<b>Ann</b>',
      heading: 'Hello',
      intro: 'A & B',
      rows: [['Reference', '<script>x</script>']],
      url: 'https://leave.example/leave/requests/1',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Ann&lt;/b&gt;');
    expect(text).toContain('Reference: <script>x</script>');
    const mime = buildMime({
      from: 'leave@example.test',
      to: 'ann@example.test\r\nBcc: evil@example.test',
      subject: 'Hi\r\nBcc: evil@example.test',
      html,
      text,
    });
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
  });
});
