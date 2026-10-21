import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { todayInLusaka } from '../src/utils/dates.js';
import { addDays } from '../src/modules/leave/calendar.js';

/* Employee management (D52): the central record, its history, the directory and the dashboard. */

let db;
let app;
let entra;
let hr; // { agent, csrf, id }

beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());
beforeEach(async () => {
  await resetData(db);
  const emp = await fixtureEmployee(db, { roles: ['HR_OFFICER'] });
  hr = { ...(await signIn(app, entra, { oid: emp.oid })), id: emp.id };
});

const post = (path, body) => hr.agent.post(path).set('X-CSRF-Token', hr.csrf).send(body);
const patch = (path, body) => hr.agent.patch(path).set('X-CSRF-Token', hr.csrf).send(body);

let seq = 0;
const newEmployee = (over = {}) => ({
  employeeNumber: `P${(seq += 1)}${Date.now() % 100000}`,
  firstName: 'Fixture',
  lastName: `Person${seq}`,
  employmentStartDate: '2025-02-03',
  ...over,
});

describe('employee record', () => {
  it('saves the employment details and keeps a history of every change', async () => {
    const id = (
      await post(
        '/api/admin/employees',
        newEmployee({ employmentType: 'FIXED_TERM', contractEndDate: '2026-11-30', payGrade: 'G5' }),
      )
    ).body.id;
    const res = await patch(`/api/admin/employees/${id}`, {
      jobTitle: 'Senior Accountant',
      probationStatus: 'CONFIRMED',
      lineManagerId: hr.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rec = await hr.agent.get(`/api/people/employees/${id}`);
    expect(rec.body).toMatchObject({
      employmentType: 'FIXED_TERM',
      contractEndDate: '2026-11-30',
      payGrade: 'G5',
      probationStatus: 'CONFIRMED',
      jobTitle: 'Senior Accountant',
    });

    const h = (await hr.agent.get(`/api/people/employees/${id}/history`)).body.items;
    expect(h.map((x) => x.event)).toEqual(['UPDATED', 'UPDATED', 'UPDATED', 'CREATED']);
    const manager = h.find((x) => x.field === 'lineManagerId');
    // Shown by name, not by id, so the history still reads correctly later.
    expect(manager.to).toMatch(/\w+ \w+/);
    expect(manager.from).toBeNull();
    expect(h.find((x) => x.field === 'jobTitle')).toMatchObject({ from: null, to: 'Senior Accountant' });
  });

  it('records nothing when a save changes nothing', async () => {
    const id = (await post('/api/admin/employees', newEmployee({ jobTitle: 'Clerk' }))).body.id;
    await patch(`/api/admin/employees/${id}`, { jobTitle: 'Clerk' });
    const h = await db('employee_history').where({ employee_id: id });
    expect(h.map((x) => x.event)).toEqual(['CREATED']);
  });

  it('keeps the history append-only', async () => {
    const id = (await post('/api/admin/employees', newEmployee())).body.id;
    await expect(db('employee_history').where({ employee_id: id }).del()).rejects.toThrow(/append-only/);
    await expect(db('employee_history').where({ employee_id: id }).update({ reason: 'x' })).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('directory and dashboard', () => {
  it('filters the directory by quick filter and counts each one', async () => {
    const today = todayInLusaka();
    await post(
      '/api/admin/employees',
      newEmployee({ employmentType: 'FIXED_TERM', contractEndDate: addDays(today, 20) }),
    );
    await post(
      '/api/admin/employees',
      newEmployee({ probationStatus: 'ON_PROBATION', probationEndDate: addDays(today, 10) }),
    );
    await post('/api/admin/employees', newEmployee({ employmentStartDate: addDays(today, 7) }));

    const list = (f) => hr.agent.get(`/api/people/employees?filter=${f}`).then((r) => r.body);
    expect((await list('contractEnding')).total).toBe(1);
    expect((await list('probation')).total).toBe(1);
    expect((await list('startingSoon')).total).toBe(1);

    const counts = (await hr.agent.get('/api/people/quick-filters')).body;
    expect(counts.contractEnding.count).toBe(1);
    expect(counts.probation.count).toBe(1);

    const d = (await hr.agent.get('/api/people/dashboard')).body;
    // Three created here plus the HR fixture.
    expect(d.headcount).toBe(4);
    expect(d.counts).toMatchObject({ contractsEnding: 1, probationDue: 1, startingSoon: 1 });
    expect(d.monthly).toHaveLength(12);
    expect(d.recentChanges.length).toBeGreaterThan(0);
  });

  it('lets directors read the record but not change it, and keeps everyone else out', async () => {
    const id = (await post('/api/admin/employees', newEmployee())).body.id;
    const director = await fixtureEmployee(db, { roles: ['MANAGING_DIRECTOR'] });
    const d = await signIn(app, entra, { oid: director.oid });
    expect((await d.agent.get(`/api/people/employees/${id}`)).status).toBe(200);
    expect((await d.agent.get('/api/people/dashboard')).status).toBe(200);
    const res = await d.agent
      .patch(`/api/admin/employees/${id}`)
      .set('X-CSRF-Token', d.csrf)
      .send({ jobTitle: 'Changed' });
    expect(res.status).toBe(403);

    const staff = await fixtureEmployee(db);
    const s = await signIn(app, entra, { oid: staff.oid });
    expect((await s.agent.get('/api/people/dashboard')).status).toBe(403);
    expect((await s.agent.get(`/api/people/employees/${id}`)).status).toBe(403);
  });
});

describe('overviews and reports', () => {
  it('gives the same figures for each company and department', async () => {
    await post('/api/admin/employees', newEmployee({ employmentType: 'PERMANENT' }));
    await post(
      '/api/admin/employees',
      newEmployee({ employmentType: 'TEMPORARY', probationStatus: 'ON_PROBATION' }),
    );
    const c = (await hr.agent.get('/api/people/companies-overview')).body;
    const total = c.companies.reduce((s, x) => s + x.headcount, 0) + c.withoutCompany;
    expect(total).toBe(3);
    const d = (await hr.agent.get('/api/people/departments-overview')).body;
    const all = d.departments.reduce((s, x) => s + x.headcount, 0) + d.withoutDepartment;
    expect(all).toBe(3);
    const types = [...c.companies.map((x) => x.byType)];
    expect(types.length + (c.withoutCompany ? 1 : 0)).toBeGreaterThan(0);
  });

  it('runs and exports every report', async () => {
    await post('/api/admin/employees', newEmployee({ employmentType: 'FIXED_TERM' }));
    const list = (await hr.agent.get('/api/people/reports')).body;
    expect(list.items.length).toBe(8);
    for (const r of list.items) {
      const res = await hr.agent.get(`/api/people/reports/${r.id}`);
      expect(res.status, r.id).toBe(200);
      expect(res.body.columns.length, r.id).toBeGreaterThan(0);
    }
    const staffList = (await hr.agent.get('/api/people/reports/staff-list')).body;
    expect(staffList.total).toBe(2);
    const missing = (await hr.agent.get('/api/people/reports/missing-details')).body;
    expect(missing.rows.find((x) => x.missing.includes('contract end'))).toBeTruthy();
    const file = await hr.agent.get('/api/people/reports/staff-list/export?format=xlsx');
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/spreadsheetml/);
    expect(
      await db('audit_log').where({ action: 'REPORT_EXPORTED', entity_id: 'people-staff-list' }),
    ).toHaveLength(1);
  });
});

describe('statistics', () => {
  it('counts staff at each month end and by length of service', async () => {
    const today = todayInLusaka();
    await post('/api/admin/employees', newEmployee({ employmentStartDate: addDays(today, -40) }));
    await post('/api/admin/employees', newEmployee({ employmentStartDate: '2015-01-05' }));
    const d = (await hr.agent.get('/api/people/dashboard')).body;
    expect(d.headcountTrend).toHaveLength(12);
    expect(d.bySex.FEMALE + d.bySex.MALE + d.bySex.NONE).toBe(d.headcount);
    // Today's column counts everyone active now: the two above and the HR fixture.
    expect(d.headcountTrend[11].headcount).toBe(d.headcount);
    const bands = Object.fromEntries(d.serviceBands.map((b) => [b.key, b.count]));
    expect(bands.gt10).toBe(1);
    expect(Object.values(bands).reduce((s, n) => s + n, 0)).toBe(d.headcount);

    const c = (await hr.agent.get('/api/people/companies-overview')).body;
    const all = [...c.companies.map((x) => x.serviceBands)];
    expect(all.every((b) => 'lt1' in b && 'gt10' in b)).toBe(true);
    expect(c.companies.every((x) => x.bySex && 'FEMALE' in x.bySex)).toBe(true);
  });
});
