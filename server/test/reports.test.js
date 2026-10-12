import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { toCsv, neutralise } from '../src/modules/reports/export-files.js';

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
  file: (p) =>
    s.agent
      .get(p)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }),
});

let ids;
let hr;
let mgr;
let emp;
let outsider;
let dept;
let company;

async function login(e) {
  return { ...(await signIn(app, entra, { oid: e.oid })), id: e.id };
}

async function approved(employeeId, start, end, days) {
  const pv = await db('leave_policy_versions').where({ leave_type_id: ids.ANNUAL }).first('id');
  const [id] = await db('leave_requests').insert({
    employee_id: employeeId,
    leave_type_id: ids.ANNUAL,
    policy_version_id: pv.id,
    start_date: start,
    end_date: end,
    chargeable_days: days.reduce((s, d) => s + d[1], 0),
    status: 'APPROVED',
    reference: `LR-T-${Math.random().toString(36).slice(2, 8)}`,
    submitted_at: db.fn.now(),
  });
  await db('leave_request_days').insert(
    days.map(([date, charged]) => ({
      leave_request_id: id,
      leave_date: date,
      charged,
      exclusion_reason: charged ? null : 'NON_WORKING_DAY',
    })),
  );
  return id;
}

const weekdays = (from, n) => {
  // n working days from a Monday, including the weekends in between as uncharged days
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  let count = 0;
  while (count < n) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const work = dow !== 0 && dow !== 6;
    out.push([iso, work ? 1 : 0]);
    if (work) count += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

beforeEach(async () => {
  await resetData(db);
  await db('leave_types').where({ code: 'ANNUAL' }).update({ is_active: true });
  ids = { ANNUAL: (await db('leave_types').where({ code: 'ANNUAL' }).first('id')).id };
  [company] = await db('companies').insert({ code: 'AFS', name: 'Altus Financial Services Limited' });
  [dept] = await db('departments').insert({ company_id: company, code: 'CRD', name: 'Credit' });
  const hrE = await fixtureEmployee(db, { roles: ['HR_OFFICER'] });
  const inCredit = { department_id: dept, company_id: company };
  const mgrE = await fixtureEmployee(db, { first_name: 'Mona', ...inCredit });
  const empE = await fixtureEmployee(db, { first_name: 'Ezra', managerId: mgrE.id, ...inCredit });
  const outE = await fixtureEmployee(db, { first_name: '=HYPERLINK("http://evil")' });
  const s = [];
  for (const e of [hrE, mgrE, empE, outE]) s.push(await login(e));
  [hr, mgr, emp, outsider] = s;
});

describe('who can run reports', () => {
  it('refuses employees and limits managers to their team, in the query itself', async () => {
    expect((await as(emp).get('/api/reports')).status).toBe(403);
    await approved(emp.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    await approved(outsider.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));

    const list = await as(mgr).get('/api/reports');
    expect(list.body.scope).toBe('MANAGER');
    expect(list.body.items).toHaveLength(13);
    expect(list.body.options.employees.map((e) => e.id)).toEqual([emp.id]);

    const mine = await as(mgr).get('/api/reports/requests?year=2027');
    expect(mine.body.rows.map((r) => r.employee)).toEqual([expect.stringMatching(/^Ezra/)]);
    // Asking for someone outside the team returns nothing rather than their data.
    const sneaky = await as(mgr).get(`/api/reports/requests?year=2027&employeeId=${outsider.id}`);
    expect(sneaky.body.rows).toEqual([]);
    expect((await as(emp).get('/api/reports/ledger')).status).toBe(403);

    const all = await as(hr).get('/api/reports/requests?year=2027');
    expect(all.body.total).toBe(2);
  });
});

describe('every report for managers, limited to their team', () => {
  it('runs the HR-style reports on the team only', async () => {
    for (const who of [emp.id, outsider.id]) {
      await db('balance_ledger').insert({
        employee_id: who,
        leave_type_id: ids.ANNUAL,
        leave_year: 2027,
        amount: 5,
        entry_type: 'ADJUSTMENT',
        source_type: 'ADJUSTMENT',
        reason: 'Correction',
      });
    }
    await approved(emp.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    await approved(outsider.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));

    const ledger = await as(mgr).get('/api/reports/ledger?from=2000-01-01&to=2100-12-31');
    expect(ledger.status).toBe(200);
    expect(ledger.body.rows.map((r) => r.employee)).toEqual([expect.stringMatching(/^Ezra/)]);

    const util = await as(mgr).get('/api/reports/utilisation-company?year=2027');
    expect(util.body.rows).toEqual([
      { company: 'Altus Financial Services Limited', headcount: 1, days: 5, perPerson: 5 },
    ]);
    for (const id of ['carry-forward', 'approval-activity', 'utilisation']) {
      expect((await as(mgr).get(`/api/reports/${id}?year=2027`)).status).toBe(200);
    }
    const options = (await as(mgr).get('/api/reports')).body.options;
    expect(options.companies).toEqual([{ id: company, name: 'Altus Financial Services Limited' }]);
    expect(options.departments.map((d) => d.id)).toEqual([dept]);
  });
});

describe('report contents', () => {
  it('counts only days inside the period for the date-range report', async () => {
    await approved(emp.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    const res = await as(hr).get('/api/reports/date-range?from=2027-03-03&to=2027-03-31');
    expect(res.body.rows[0]).toMatchObject({ daysInRange: 3 });
  });

  it('finds people without 10 consecutive working days, treating weekends as part of a block', async () => {
    await approved(emp.id, '2027-03-01', '2027-03-12', weekdays('2027-03-01', 10));
    await approved(mgr.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    const res = await as(hr).get('/api/reports/ten-days?year=2027');
    const names = res.body.rows.map((r) => r.employee);
    expect(names.some((n) => n.startsWith('Ezra'))).toBe(false);
    expect(res.body.rows.find((r) => r.employee.startsWith('Mona'))).toMatchObject({
      longest: 5,
      target: 10,
    });
  });

  it('reports balances from the ledger', async () => {
    await db('balance_ledger').insert({
      employee_id: emp.id,
      leave_type_id: ids.ANNUAL,
      leave_year: 2027,
      amount: 12,
      entry_type: 'OPENING',
      source_type: 'OPENING',
      reason: 'Opening',
    });
    const res = await as(hr).get(`/api/reports/balances?year=2027&employeeId=${emp.id}`);
    expect(res.body.rows[0]).toMatchObject({ opening: 12, balance: 12, available: 12 });
  });

  it('summarises by status and lists outstanding requests', async () => {
    await approved(emp.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    const res = await as(hr).get('/api/reports/status-summary?year=2027');
    expect(res.body.rows).toEqual([{ leaveType: 'Annual leave', status: 'Approved', requests: 1, days: 5 }]);
    expect((await as(hr).get('/api/reports/outstanding')).body.rows).toEqual([]);
  });
});

describe('companies in the group', () => {
  it('shows the company on each row and filters by company', async () => {
    await approved(emp.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    await approved(outsider.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    const all = await as(hr).get('/api/reports/requests?year=2027');
    expect(all.body.columns.map((c) => c.key)).toContain('company');
    expect(all.body.rows.map((r) => r.company).sort()).toEqual(['', 'Altus Financial Services Limited']);
    const one = await as(hr).get(`/api/reports/requests?year=2027&companyId=${company}`);
    expect(one.body.rows.map((r) => r.employee)).toEqual([expect.stringMatching(/^Ezra/)]);
    const list = await as(hr).get('/api/reports');
    expect(list.body.options.companies).toEqual([{ id: company, name: 'Altus Financial Services Limited' }]);
  });

  it('summarises utilisation per company', async () => {
    await approved(emp.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    const res = await as(hr).get('/api/reports/utilisation-company?year=2027');
    expect(res.body.rows).toEqual([
      { company: 'Altus Financial Services Limited', headcount: 2, days: 5, perPerson: 2.5 },
      { company: 'No company', headcount: 2, days: 0, perPerson: 0 },
    ]);
    const byDept = await as(hr).get(`/api/reports/utilisation?year=2027&companyId=${company}`);
    expect(byDept.body.rows).toEqual([
      {
        company: 'Altus Financial Services Limited',
        department: 'Credit',
        headcount: 2,
        days: 5,
        perPerson: 2.5,
      },
    ]);
  });

  it('limits the HR overview to one company when asked', async () => {
    const res = await as(hr).get(`/api/dashboard/hr?companyId=${company}`);
    expect(res.status).toBe(200);
    expect(res.body.companyId).toBe(company);
    expect(res.body.utilisation.rows.every((r) => r.company === 'Altus Financial Services Limited')).toBe(
      true,
    );
    expect(res.body.utilisation.companies).toEqual([
      expect.objectContaining({ company: 'Altus Financial Services Limited', headcount: 2 }),
    ]);
  });
});

describe('exports', () => {
  it('exports CSV with formulas neutralised, and records the export', async () => {
    await approved(outsider.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    const res = await as(hr).file('/api/reports/requests/export?format=csv&year=2027');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = res.body.toString('utf8');
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")`);
    const audit = await db('audit_log').where({ action: 'REPORT_EXPORTED' }).first();
    expect(
      typeof audit.after_data === 'string' ? JSON.parse(audit.after_data) : audit.after_data,
    ).toMatchObject({ format: 'csv', rows: 1, scope: 'HR' });
  });

  it('exports a valid XLSX package', async () => {
    await approved(emp.id, '2027-03-01', '2027-03-05', weekdays('2027-03-01', 5));
    const res = await as(hr).file('/api/reports/requests/export?format=xlsx&year=2027');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
    expect(res.body.includes(Buffer.from('xl/worksheets/sheet1.xml'))).toBe(true);
  });

  it('neutralises every formula prefix', () => {
    for (const s of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=x'])
      expect(neutralise(s).startsWith("'")).toBe(true);
    expect(neutralise('Normal')).toBe('Normal');
    const csv = toCsv([{ key: 'a', label: 'A' }], [{ a: '=cmd' }, { a: 'x,"y"' }]).toString('utf8');
    expect(csv).toBe('﻿A\r\n\'=cmd\r\n"x,""y"""\r\n');
  });
});
