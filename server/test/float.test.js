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
});
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const todayCode = DAYS[new Date(`${todayInLusaka()}T12:00:00Z`).getUTCDay()];

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
    week_end_day: todayCode,
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
  await person('manager');
  await person('director');
  await person('hr');
  await giveRole('teller', 'AMS Branch Staff');
  await giveRole('manager', 'AMS Manager');
  await giveRole('director', 'Director');
  await giveRole('hr', 'AMS HR');
  await db('float_commission_rules').insert({
    network: 'AIRTEL',
    kind: 'DEPOSIT',
    min_amount: 0,
    max_amount: null,
    fee_type: 'PERCENT',
    value: 1,
  });
});

describe('AMS cash and float (D117)', () => {
  it('records a deposit and a withdrawal with one tap each, moving both sides', async () => {
    const me = (await as(people.teller).get('/api/float/me')).body;
    expect(me).toMatchObject({
      configured: true,
      branch: { id: branch },
      rights: { record: true, approve: false },
    });
    const dep = await as(people.teller).post('/api/float/transactions', {
      network: 'AIRTEL',
      kind: 'DEPOSIT',
      amount: 300,
    });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    expect(dep.body.commission).toBe(3); // 1% from the admin's table
    expect(await balances(branch)).toEqual({ CASH: 2300, AIRTEL: 700, MTN: 1000 });
    // Same again within two minutes: asked to confirm.
    const again = await as(people.teller).post('/api/float/transactions', {
      network: 'AIRTEL',
      kind: 'DEPOSIT',
      amount: 300,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('POSSIBLE_DUPLICATE');
    const sure = await as(people.teller).post('/api/float/transactions', {
      network: 'AIRTEL',
      kind: 'DEPOSIT',
      amount: 300,
      confirm: true,
    });
    expect(sure.status).toBe(201);
    // Airtel is now below its minimum: the branch and the manager are told once.
    expect(await notes(ids.manager, 'FLOAT_LOW')).toHaveLength(1);
    // A withdrawal needs the cash.
    expect(
      (
        await as(people.teller).post('/api/float/transactions', {
          network: 'MTN',
          kind: 'WITHDRAWAL',
          amount: 5000,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await as(people.teller).post('/api/float/transactions', {
          network: 'MTN',
          kind: 'WITHDRAWAL',
          amount: 100,
        })
      ).status,
    ).toBe(201);
    expect(await balances(branch)).toEqual({ CASH: 2500, AIRTEL: 400, MTN: 1100 });
    // Someone without a branch on their record cannot record.
    expect(
      (
        await as(people.manager).post('/api/float/transactions', {
          network: 'MTN',
          kind: 'DEPOSIT',
          amount: 10,
        })
      ).status,
    ).toBe(400);
    // Branch view.
    const today = (await as(people.teller).get('/api/float/branch')).body;
    expect(today.transactions).toHaveLength(3);
    expect(today.accounts.find((a) => a.kind === 'AIRTEL')).toMatchObject({ balance: 400, low: true });
  });

  it('top-ups and reversals need a manager, never the person who asked', async () => {
    const t = await as(people.teller).post('/api/float/movements', {
      kind: 'TOPUP',
      toAccount: 'AIRTEL',
      amount: 2000,
      reason: 'Float low',
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(await notes(ids.manager, 'FLOAT_MOVEMENT_TO_APPROVE')).toHaveLength(1);
    expect(
      (await as(people.teller).post(`/api/float/movements/${t.body.id}/decide`, { approve: true })).status,
    ).toBe(403);
    expect(
      (await as(people.manager).post(`/api/float/movements/${t.body.id}/decide`, { approve: true })).status,
    ).toBe(200);
    expect((await balances(branch)).AIRTEL).toBe(3000);

    const w = await as(people.teller).post('/api/float/transactions', {
      network: 'AIRTEL',
      kind: 'WITHDRAWAL',
      amount: 400,
    });
    expect(
      (
        await as(people.teller).post(`/api/float/transactions/${w.body.id}/reverse`, {
          reason: 'Wrong network',
        })
      ).status,
    ).toBe(200);
    expect(
      (await as(people.manager).post(`/api/float/transactions/${w.body.id}/reversal`, { approve: true }))
        .status,
    ).toBe(200);
    expect(await balances(branch)).toEqual({ CASH: 2000, AIRTEL: 3000, MTN: 1000 });
  });

  it('records surpluses and deficits at close, which the manager resolves; big write-offs go to the director', async () => {
    const c = await as(people.teller).post('/api/float/counts', {
      kind: 'CLOSE',
      lines: [
        { kind: 'CASH', counted: 1800 }, // K200 short
        { kind: 'AIRTEL', counted: 1003 }, // K3 over: within the tolerance
        { kind: 'MTN', counted: 1000 },
      ],
      denominations: { 100: 18 },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    // The books now match the count; one deficit is recorded against the teller.
    expect(await balances(branch)).toEqual({ CASH: 1800, AIRTEL: 1003, MTN: 1000 });
    const v = await db('float_variances').first();
    expect(v).toMatchObject({ employee_id: ids.teller, status: 'OPEN' });
    expect(Number(v.amount)).toBe(-200);
    expect(await notes(ids.manager, 'FLOAT_VARIANCE')).toHaveLength(1);
    // HR sees the shortage by member of staff.
    const hr = (await as(people.hr).get('/api/float/variances')).body;
    expect(hr.byStaff).toEqual([expect.objectContaining({ id: ids.teller, count: 1, total: 200 })]);
    // Recovered: the money goes back into the cash.
    expect(
      (
        await as(people.manager).post(`/api/float/variances/${v.id}/resolve`, {
          resolution: 'RECOVERED',
          comment: 'Paid back',
        })
      ).status,
    ).toBe(200);
    expect((await balances(branch)).CASH).toBe(2000);

    // A K1,500 deficit written off is above the K1,000 director limit.
    await as(people.teller).post('/api/float/counts', {
      kind: 'HANDOVER',
      handedTo: ids.manager,
      lines: [{ kind: 'CASH', counted: 500 }],
    });
    const big = await db('float_variances').orderBy('id', 'desc').first();
    await as(people.manager).post(`/api/float/variances/${big.id}/resolve`, {
      resolution: 'WRITTEN_OFF',
      comment: 'Robbery, police report filed',
    });
    expect((await db('float_variances').where({ id: big.id }).first()).status).toBe('PENDING_DIRECTOR');
    expect(await notes(ids.director, 'FLOAT_WRITE_OFF_TO_APPROVE')).toHaveLength(1);
    expect(
      (await as(people.director).post(`/api/float/variances/${big.id}/director`, { approve: true })).status,
    ).toBe(200);
    expect((await db('float_variances').where({ id: big.id }).first()).status).toBe('WRITTEN_OFF');
  });

  it('makes the weekly report at the set time; signing it off tells the director and locks the week', async () => {
    const d = await as(people.teller).post('/api/float/transactions', {
      network: 'AIRTEL',
      kind: 'DEPOSIT',
      amount: 500,
    });
    const [h, m] = ['17', '30'];
    const now = new Date(`${todayInLusaka()}T${h}:${m}:00+02:00`);
    const r = await runFloatJobs(db, now);
    expect(r.week).toBeTruthy();
    const week = await db('float_weeks').first();
    const data = JSON.parse(typeof week.data === 'string' ? week.data : JSON.stringify(week.data));
    expect(data.totals).toMatchObject({ depositCount: 1, depositAmount: 500, commission: 5 });
    expect(data.branches[0].accounts.find((a) => a.kind === 'CASH')).toMatchObject({
      opening: 2000,
      deposits: 500,
      closing: 2500,
    });
    expect(await notes(ids.manager, 'FLOAT_WEEK_READY')).toHaveLength(1);
    // Postings after the report count in the next week.
    const late = await as(people.teller).post('/api/float/transactions', {
      network: 'MTN',
      kind: 'DEPOSIT',
      amount: 50,
    });
    expect(
      (await db('float_transactions').where({ id: late.body.id }).first()).business_date > todayInLusaka(),
    ).toBe(true);

    expect(
      (await as(people.manager).post(`/api/float/weeks/${week.id}/sign-off`, { comment: 'All good' })).status,
    ).toBe(200);
    expect(await notes(ids.director, 'FLOAT_WEEK_SIGNED_OFF')).toHaveLength(1);
    // That week is now locked.
    expect(
      (await as(people.teller).post(`/api/float/transactions/${d.body.id}/reverse`, { reason: 'Mistake' }))
        .status,
    ).toBe(409);
    expect((await as(people.manager).get(`/api/float/weeks/${week.id}?format=xlsx`)).status).toBe(200);
    // The audit trail of the inventory system has the AMS work.
    const audit = await as(people.admin).get('/api/access/inventory/audit');
    expect(JSON.stringify(audit.body)).toContain('FLOAT_DEPOSIT');
  });
});
