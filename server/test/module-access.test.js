import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';

/* Users, Roles with access levels and the Audit trail in every module (D108). */

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
  del: (p) => s.agent.delete(p).set('X-CSRF-Token', s.csrf),
});

let people;
async function person(key, over) {
  const e = await fixtureEmployee(db, { first_name: key, ...over });
  people[key] = { ...(await signIn(app, entra, { oid: e.oid })), id: e.id };
}

beforeEach(async () => {
  await resetData(db);
  people = {};
  await person('admin', { roles: ['HR_ADMIN'] });
  await person('officer', { roles: ['HR_OFFICER'] });
  await person('clerk', {});
});

describe('Module access', () => {
  it('installs System Admin, HR Officer and Director in Leave and Employee management', async () => {
    for (const module of ['leave', 'people']) {
      const r = await as(people.admin).get(`/api/access/${module}/roles`);
      expect(r.status).toBe(200);
      expect(r.body.items.map((x) => x.name)).toEqual(['System Admin', 'Director', 'HR Officer']);
      expect(r.body.areas.map((a) => a.key)).toEqual(expect.arrayContaining(['users', 'roles', 'audit']));
    }
    const leave = (await as(people.admin).get('/api/access/leave/roles')).body.items;
    expect(leave.find((x) => x.name === 'HR Officer').levels).toMatchObject({
      approvals: 1,
      requests: 2,
      audit: 0,
    });
  });

  it('opens each part to exactly the rights of the role, and nothing beyond the module', async () => {
    const made = await as(people.admin).post('/api/access/leave/roles', {
      name: 'Calendar keeper',
      levels: { calendar: 1, audit: 1 },
    });
    expect(made.status).toBe(201);
    expect(
      (
        await as(people.admin).post('/api/access/leave/users', {
          employeeId: people.clerk.id,
          roleId: made.body.id,
        })
      ).status,
    ).toBe(201);
    expect((await as(people.clerk).get('/api/admin/holidays')).status).toBe(200);
    expect((await as(people.clerk).get('/api/approvals/hr')).status).toBe(403);
    expect((await as(people.clerk).get('/api/admin/leave-types')).status).toBe(403);
    expect((await as(people.clerk).get('/api/access/leave/audit')).status).toBe(200);
    // Leave rights do not open Employee management or its admin pages.
    expect((await as(people.clerk).get('/api/people/employees')).status).toBe(403);
    expect((await as(people.clerk).get('/api/access/people/audit')).status).toBe(403);
    expect((await as(people.clerk).get('/api/access/leave/users')).status).toBe(403);
  });

  it('keeps today’s HR Officer rights through the HR Officer roles', async () => {
    expect((await as(people.officer).get('/api/approvals/hr')).status).toBe(200);
    expect((await as(people.officer).get('/api/admin/holidays')).status).toBe(200);
    expect((await as(people.officer).get('/api/people/employees')).status).toBe(200);
    // Users, Roles and Audit trail stay with the System Administrator unless a role gives them.
    expect((await as(people.officer).get('/api/access/leave/roles')).status).toBe(403);
    expect((await as(people.officer).get('/api/admin/settings')).status).toBe(403);
  });

  it('shows each module only its own changes in the Audit trail', async () => {
    const leaveRole = await as(people.admin).post('/api/access/leave/roles', { name: 'Leave A', levels: {} });
    const peopleRole = await as(people.admin).post('/api/access/people/roles', {
      name: 'People B',
      levels: {},
    });
    expect(leaveRole.status).toBe(201);
    expect(peopleRole.status).toBe(201);
    const leave = (await as(people.admin).get('/api/access/leave/audit')).body;
    const ppl = (await as(people.admin).get('/api/access/people/audit')).body;
    expect(leave.items.map((i) => i.entityType)).toContain('leave_role');
    expect(leave.items.map((i) => i.entityType)).not.toContain('people_role');
    expect(ppl.items.map((i) => i.entityType)).toContain('people_role');
    expect(ppl.items.map((i) => i.entityType)).not.toContain('leave_role');
  });

  it('applies a change to someone’s role on their next request', async () => {
    const officerRole = (await db('access_roles').where({ module: 'leave', name: 'HR Officer' }).first('id'))
      .id;
    const off = await as(people.admin).put(`/api/access/leave/users/${people.officer.id}`, {
      roleId: officerRole,
      isActive: false,
    });
    expect(off.status).toBe(200);
    expect((await as(people.officer).get('/api/approvals/hr')).status).toBe(403);
  });
});
