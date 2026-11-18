import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { todayInLusaka } from '../src/utils/dates.js';
import { runFloatJobs } from '../src/modules/float/float.jobs.js';

let db;
let app;
let entra;
beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());

const as = (s) => ({
  get: (p) => s.agent.get(p),
  post: (p, body) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .send(body ?? {}),
  put: (p, body) =>
    s.agent
      .put(p)
      .set('X-CSRF-Token', s.csrf)
      .send(body ?? {}),
  delete: (p) => s.agent.delete(p).set('X-CSRF-Token', s.csrf),
});

let ams;
let people;
let ids;
async function person(key, over = {}) {
  const e = await fixtureEmployee(db, { company_id: ams, first_name: key, ...over });
  ids[key] = e.id;
  people[key] = { ...(await signIn(app, entra, { oid: e.oid })), id: e.id };
}
async function giveRole(key, roleName) {
  const role = await db('access_roles').where({ module: 'inventory', name: roleName }).first('id');
  await db('access_users').insert({ module: 'inventory', employee_id: ids[key], role_id: role.id });
}
const balances = async (branchId) =>
  Object.fromEntries(
    (await db('float_accounts').where({ branch_id: branchId })).map((a) => [a.kind, Number(a.balance)]),
  );
const notes = (id, event) => db('notifications').where({ recipient_id: id, event_type: event });

let branch;
beforeEach(async () => {
  await resetData(db);
  [ams] = await db('companies').insert({ code: 'AMS', name: 'Altus Money Solutions' });
  await db('float_settings').insert({
    id: 1,
    company_id: ams,
    working_days: 'MON,TUE,WED,THU,FRI,SAT,SUN',
    report_time: '17:00',
    cash_tolerance: 5,
    large_amount: 10000,
    director_limit: 1000,
  });
  people = {};
  ids = {};
  await person('admin', { roles: ['HR_ADMIN'] });
  // The System Admin adds the branch with its opening balances.
  const b = await as(people.admin).post('/api/float/branches', {
    name: 'Kalingalinga',
    location: 'Alick Nkhata Road',
    openings: { CASH: 2000, AIRTEL: 1000, MTN: 1000 },
    minimums: { CASH: 500, AIRTEL: 600, MTN: 500 },
  });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  branch = b.body.id;
  await person('teller', { branch_id: branch });
  await person('officer');
  await person('manager');
  await person('director');
  await person('hr');
  await giveRole('teller', 'AMS Branch Staff');
  await giveRole('manager', 'AMS Manager');
  await giveRole('officer', 'AMS Operations Officer');
  await giveRole('director', 'Director');
  await giveRole('hr', 'AMS HR');
});

// Branch staff open and close; the Operations Officer confirms (D124).
const confirmLast = async (body = {}) => {
  const c = await db('float_counts').where({ status: 'PENDING' }).orderBy('id', 'desc').first('id');
  return as(people.officer).post(`/api/float/counts/${c.id}/confirm`, body);
};
const open = async (body = {}) => {
  const r = await as(people.teller).post('/api/float/open', body);
  if (r.status === 201) await confirmLast();
  return r;
};
const close = async (body) => {
  const r = await as(people.teller).post('/api/float/counts', { kind: 'CLOSE', ...body });
  const c = await confirmLast();
  return { r, c };
};
const txn = (network, kind, amount, extra = {}) =>
  as(people.teller).post('/api/float/transactions', { network, kind, amount, ...extra });

describe('AMS cash and float (D117, D121)', () => {
  it('opens the store before anything is recorded, and nothing after it closes', async () => {
    const before = await txn('AIRTEL', 'DEPOSIT', 300);
    expect(before.status).toBe(409);
    expect(before.body.error.code).toBe('STORE_NOT_OPEN');
    const o = await as(people.teller).post('/api/float/open', {});
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect(o.body).toMatchObject({ pending: true, balances: { CASH: 2000, AIRTEL: 1000, MTN: 1000 } });
    // Waiting for the Operations Officer: no trading yet.
    expect((await txn('AIRTEL', 'DEPOSIT', 300)).body.error.code).toBe('OPENING_NOT_CONFIRMED');
    expect((await confirmLast()).status).toBe(200);
    expect((await open()).status).toBe(409); // already open
    expect((await txn('AIRTEL', 'DEPOSIT', 300)).status).toBe(201);
    expect(await balances(branch)).toEqual({ CASH: 2300, AIRTEL: 700, MTN: 1000 });
    // A repeat within two minutes asks to confirm.
    const again = await txn('AIRTEL', 'DEPOSIT', 300);
    expect(again.body.error.code).toBe('POSSIBLE_DUPLICATE');
    expect((await txn('AIRTEL', 'DEPOSIT', 300, { confirm: true })).status).toBe(201);
    // Airtel below its minimum: the branch and the Operations Officer are told.
    expect(await notes(ids.officer, 'FLOAT_LOW')).toHaveLength(1);
    expect((await txn('MTN', 'WITHDRAWAL', 5000)).status).toBe(409); // not enough cash
    // Close: the day's transactions are closed and the report goes to the officer, manager,
    // director and System Admin.
    const closing = await as(people.teller).post('/api/float/counts', {
      kind: 'CLOSE',
      lines: [
        { kind: 'CASH', counted: 2600 },
        { kind: 'AIRTEL', counted: 400 },
        { kind: 'MTN', counted: 1000 },
      ],
      commission: 12,
    });
    expect(closing.status, JSON.stringify(closing.body)).toBe(201);
    expect(closing.body).toMatchObject({ pending: true, report: null });
    expect(await notes(ids.officer, 'FLOAT_COUNT_TO_CONFIRM')).toHaveLength(2); // opening and closing
    // Recording stops at once; the report waits for the Operations Officer.
    expect((await txn('MTN', 'DEPOSIT', 10)).body.error.code).toBe('STORE_CLOSED');
    expect(await notes(ids.director, 'FLOAT_SIGNED_OUT')).toHaveLength(0);
    expect((await confirmLast()).status).toBe(200);
    const today0 = todayInLusaka();
    const close = {
      body: {
        report: (await as(people.officer).get(`/api/float/daily?from=${today0}&to=${today0}`)).body.rows[0],
      },
    };
    expect(close.body.report).toMatchObject({
      signedOut: true,
      openingCash: 2000,
      openingFloat: 2000,
      cash: 2600,
      float: 1400,
    });
    expect(close.body.report.openedAt).toBeTruthy();
    for (const k of ['officer', 'manager', 'director', 'admin']) {
      expect(await notes(ids[k], 'FLOAT_SIGNED_OUT')).toHaveLength(1);
    }
  });

  it('sends staff requests to the Operations Officer, who approves them', async () => {
    await open();
    // Staff no longer move float themselves; the officer does, and another approves it.
    expect(
      (
        await as(people.teller).post('/api/float/movements', {
          kind: 'TOPUP',
          toAccount: 'AIRTEL',
          amount: 100,
        })
      ).status,
    ).toBe(403);
    const w = await txn('AIRTEL', 'WITHDRAWAL', 400);
    expect(
      (
        await as(people.teller).post(`/api/float/transactions/${w.body.id}/reverse`, {
          reason: 'Wrong network',
        })
      ).status,
    ).toBe(200);
    expect(await notes(ids.officer, 'FLOAT_REVERSAL_TO_APPROVE')).toHaveLength(1);
    expect(
      (await as(people.teller).post(`/api/float/transactions/${w.body.id}/reversal`, { approve: true }))
        .status,
    ).toBe(403);
    expect(
      (await as(people.officer).post(`/api/float/transactions/${w.body.id}/reversal`, { approve: true }))
        .status,
    ).toBe(200);
    expect(await balances(branch)).toEqual({ CASH: 2000, AIRTEL: 1000, MTN: 1000 });
    // Cash to finance: out of the drawer now, confirmed by the officer.
    const cc = await as(people.teller).post('/api/float/collections', { amount: 500 });
    expect(await notes(ids.officer, 'FLOAT_COLLECTION_TO_CONFIRM')).toHaveLength(1);
    expect(
      (await as(people.officer).post(`/api/float/movements/${cc.body.id}/decide`, { approve: true })).status,
    ).toBe(200);
    expect((await balances(branch)).CASH).toBe(1500);
  });

  it('runs requisitions from the branch to the officer, the manager and a director', async () => {
    const r = await as(people.teller).post('/api/float/requisitions', {
      kind: 'FLOAT',
      account: 'MTN',
      amount: 3000,
      reason: 'MTN float finished at 14:00',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await notes(ids.officer, 'FLOAT_REQUISITION_TO_APPROVE')).toHaveLength(1);
    // The manager cannot jump the officer; the director cannot jump the manager.
    expect(
      (await as(people.director).post(`/api/float/requisitions/${r.body.id}/decide`, { approve: true }))
        .status,
    ).toBe(403);
    expect(
      (await as(people.officer).post(`/api/float/requisitions/${r.body.id}/decide`, { approve: true }))
        .status,
    ).toBe(200);
    expect(await notes(ids.manager, 'FLOAT_REQUISITION_TO_APPROVE')).toHaveLength(1);
    expect(
      (await as(people.officer).post(`/api/float/requisitions/${r.body.id}/decide`, { approve: true }))
        .status,
    ).toBe(403);
    expect(
      (await as(people.manager).post(`/api/float/requisitions/${r.body.id}/decide`, { approve: true }))
        .status,
    ).toBe(200);
    expect(await notes(ids.director, 'FLOAT_REQUISITION_TO_APPROVE')).toHaveLength(1);
    expect(
      (await as(people.director).post(`/api/float/requisitions/${r.body.id}/decide`, { approve: true }))
        .status,
    ).toBe(200);
    expect(await notes(ids.teller, 'FLOAT_REQUISITION_APPROVED')).toHaveLength(1);
    // It is added when the branch confirms it arrived.
    await open();
    expect(
      (await as(people.teller).post(`/api/float/requisitions/${r.body.id}/received`, { amount: 3000 }))
        .status,
    ).toBe(200);
    expect((await balances(branch)).MTN).toBe(4000);
    // A device requisition turned down needs a reason.
    const d = await as(people.teller).post('/api/float/requisitions', {
      kind: 'DEVICE',
      device: 'Airtel agent phone',
      reason: 'Will not charge',
    });
    expect(
      (await as(people.officer).post(`/api/float/requisitions/${d.body.id}/decide`, { approve: false }))
        .status,
    ).toBe(400);
    expect(
      (
        await as(people.officer).post(`/api/float/requisitions/${d.body.id}/decide`, {
          approve: false,
          comment: 'Use the spare',
        })
      ).status,
    ).toBe(200);
    expect((await db('float_requisitions').where({ id: d.body.id }).first()).status).toBe('REJECTED');
  });

  it('records surpluses and deficits; the officer resolves them, big write-offs go to the director', async () => {
    await open();
    // A handover K1,500 short, then the close K200 short.
    await as(people.teller).post('/api/float/counts', {
      kind: 'HANDOVER',
      handedTo: ids.officer,
      lines: [{ kind: 'CASH', counted: 500 }],
    });
    const big = await db('float_variances').orderBy('id', 'desc').first();
    expect(Number(big.amount)).toBe(-1500);
    await close({
      lines: [{ kind: 'CASH', counted: 300 }],
    });
    const small = await db('float_variances').orderBy('id', 'desc').first();
    expect(Number(small.amount)).toBe(-200);
    // The handover's difference is sent to the officer; the closing's they saw as they confirmed it.
    expect(await notes(ids.officer, 'FLOAT_VARIANCE')).toHaveLength(1);
    expect(small.employee_id).toBe(ids.teller); // against the person who counted, not the confirmer
    const hr = (await as(people.hr).get('/api/float/variances')).body;
    expect(hr.byStaff).toEqual([expect.objectContaining({ id: ids.teller, count: 2, total: 1700 })]);
    expect(
      (
        await as(people.officer).post(`/api/float/variances/${small.id}/resolve`, {
          resolution: 'RECOVERED',
          comment: 'Paid back',
        })
      ).status,
    ).toBe(200);
    expect((await balances(branch)).CASH).toBe(500);
    await as(people.officer).post(`/api/float/variances/${big.id}/resolve`, {
      resolution: 'WRITTEN_OFF',
      comment: 'Robbery, police report',
    });
    expect((await db('float_variances').where({ id: big.id }).first()).status).toBe('PENDING_DIRECTOR');
    expect(
      (await as(people.director).post(`/api/float/variances/${big.id}/director`, { approve: true })).status,
    ).toBe(200);
  });

  it('shows the daily report with the columns apart, signed off by the officer, and locks the day', async () => {
    await open();
    const d = await txn('AIRTEL', 'DEPOSIT', 500);
    await txn('MTN', 'WITHDRAWAL', 200);
    await as(people.teller).post('/api/float/turned-down', { reason: 'NO_FLOAT' });
    await close({
      lines: [
        { kind: 'CASH', counted: 2300 },
        { kind: 'AIRTEL', counted: 500 },
        { kind: 'MTN', counted: 1200 },
      ],
    });
    const today = todayInLusaka();
    const rep = (await as(people.officer).get(`/api/float/daily?from=${today}&to=${today}`)).body;
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0]).toMatchObject({
      deposits: { count: 1, amount: 500 },
      withdrawals: { count: 1, amount: 200 },
      openingCash: 2000,
      openingFloat: 2000,
      cash: 2300,
      float: 1700,
      turnedDown: 1,
    });
    expect(rep.totals).toMatchObject({ cash: 2300, airtel: 500, mtn: 1200 });
    // Search by staff or branch, and filter by branch.
    expect(
      (await as(people.officer).get(`/api/float/daily?from=${today}&to=${today}&q=teller`)).body.rows,
    ).toHaveLength(1);
    expect(
      (await as(people.officer).get(`/api/float/daily?from=${today}&to=${today}&q=nowhere`)).body.rows,
    ).toHaveLength(0);
    // The officer signs it off; the manager and director are told; the day is locked.
    expect((await as(people.teller).post(`/api/float/daily/${today}/sign-off`)).status).toBe(403);
    expect(
      (await as(people.officer).post(`/api/float/daily/${today}/sign-off`, { comment: 'Reconciled' })).status,
    ).toBe(200);
    expect(await notes(ids.director, 'FLOAT_DAY_SIGNED_OFF')).toHaveLength(1);
    expect(
      (await as(people.teller).post(`/api/float/transactions/${d.body.id}/reverse`, { reason: 'Mistake' }))
        .status,
    ).toBe(409);
    expect(
      (await as(people.officer).get(`/api/float/daily?from=${today}&to=${today}&format=xlsx`)).status,
    ).toBe(200);
    // The report job runs at the report time.
    expect((await runFloatJobs(db, new Date(`${today}T17:30:00+02:00`))).daily).toBeTruthy();
  });

  it('gives each branch its own days, hours and staff (D120)', async () => {
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const today = days[(new Date(`${todayInLusaka()}T12:00:00Z`).getUTCDay() + 6) % 7];
    expect(
      (
        await as(people.admin).put(`/api/float/branches/${branch}/hours`, {
          workingDays: [today],
          opensAt: '09:00',
          closesAt: '08:00',
          eveningFrom: '17:00',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(people.admin).put(`/api/float/branches/${branch}/hours`, {
          workingDays: [today],
          opensAt: '09:00',
          closesAt: '21:00',
          eveningFrom: '18:00',
        })
      ).status,
    ).toBe(200);
    await person('newbie');
    expect(
      (await as(people.admin).post(`/api/float/branches/${branch}/staff`, { employeeId: ids.newbie })).status,
    ).toBe(201);
    const detail = (await as(people.admin).get(`/api/float/branches/${branch}`)).body;
    expect(detail.staff.find((x) => x.id === ids.newbie)).toMatchObject({ role: 'AMS Branch Staff' });
    await runFloatJobs(db, new Date(`${todayInLusaka()}T20:00:00+02:00`));
    expect(await notes(ids.teller, 'FLOAT_CLOSE_REMINDER')).toHaveLength(0);
    await runFloatJobs(db, new Date(`${todayInLusaka()}T21:05:00+02:00`));
    expect(await notes(ids.teller, 'FLOAT_CLOSE_REMINDER')).toHaveLength(1);
    expect(await notes(ids.officer, 'FLOAT_CLOSE_REMINDER')).toHaveLength(1);
    expect((await as(people.admin).delete(`/api/float/branches/${branch}/staff/${ids.newbie}`)).status).toBe(
      200,
    );
    expect(
      await db('access_users').where({ module: 'inventory', employee_id: ids.newbie }).first(),
    ).toBeUndefined();
  });

  it('lets the System Admin and the Operations Officer work at any branch they choose (D122)', async () => {
    // No branch on their records: they see the first branch, with the list to choose from.
    const view = (await as(people.admin).get('/api/float/branch')).body;
    expect(view).toMatchObject({ branch: { id: branch }, canRecord: true });
    expect(view.branches.map((b) => b.id)).toEqual([branch]);
    // Doing something needs the branch chosen.
    const none = await as(people.admin).post('/api/float/open', {});
    expect(none.body.error.code).toBe('CHOOSE_BRANCH');
    expect((await as(people.admin).post('/api/float/open', { branchId: branch })).status).toBe(201);
    expect(
      (
        await as(people.officer).post('/api/float/transactions', {
          network: 'MTN',
          kind: 'DEPOSIT',
          amount: 100,
          branchId: branch,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await as(people.admin).post('/api/float/requisitions', {
          kind: 'CASH',
          amount: 500,
          reason: 'Cash low',
          branchId: branch,
        })
      ).status,
    ).toBe(201);
    // Branch staff stay at their own branch, whatever they send.
    expect(
      (await as(people.teller).post('/api/float/turned-down', { reason: 'OTHER', branchId: 999 })).status,
    ).toBe(201);
  });

  it('opens with counted balances, filled in from the last closing (D123)', async () => {
    // Day 1: open and close with what was counted.
    await open();
    await close({
      lines: [
        { kind: 'CASH', counted: 1990 },
        { kind: 'AIRTEL', counted: 1000 },
        { kind: 'MTN', counted: 1000 },
      ],
    });
    // Pretend that close was yesterday, so today can open again.
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await db('float_counts').update({ business_date: yesterday });
    await db('float_entries').update({ business_date: yesterday });
    const view = (await as(people.teller).get('/api/float/branch')).body;
    expect(view.previousClose).toMatchObject({
      date: yesterday,
      balances: { CASH: 1990, AIRTEL: 1000, MTN: 1000 },
    });
    // Opening with K300 less cash than the closing: a deficit, and the Operations Officer is told.
    const o = await as(people.teller).post('/api/float/open', {
      lines: [
        { kind: 'CASH', counted: 1690 },
        { kind: 'AIRTEL', counted: 1000 },
        { kind: 'MTN', counted: 1000 },
      ],
    });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    // The Operations Officer cannot change the figures without saying why.
    expect((await confirmLast({ lines: [{ kind: 'CASH', counted: 1700 }] })).status).toBe(400);
    const confirmed = await confirmLast();
    expect(confirmed.body.results.find((r) => r.kind === 'CASH')).toMatchObject({
      expected: 1990,
      counted: 1690,
      difference: -300,
      recorded: true,
    });
    expect((await balances(branch)).CASH).toBe(1690);
    const opening = await db('float_variances').orderBy('id', 'desc').first();
    expect(opening).toMatchObject({ employee_id: ids.teller });
    expect(Number(opening.amount)).toBe(-300);
    const today = todayInLusaka();
    const rep = (await as(people.officer).get(`/api/float/daily?from=${today}&to=${today}`)).body.rows[0];
    expect(rep).toMatchObject({ openingCash: 1690, openingFloat: 2000 });
  });
});
