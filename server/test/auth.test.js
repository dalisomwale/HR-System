import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn, TENANT } from './helpers/app.js';

let db;
let app;
let entra;
beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());
beforeEach(() => resetData(db));

describe('Microsoft sign-in', () => {
  it('signs in a linked, active employee and returns their roles', async () => {
    const emp = await fixtureEmployee(db, { roles: ['HR_OFFICER'] });
    const s = await signIn(app, entra, { oid: emp.oid, email: 'x@example.test' });
    expect(s.redirect).toBe('http://localhost:5173/');
    expect(s.status).toBe(200);
    expect(s.me).toMatchObject({ id: emp.id, roles: ['HR_OFFICER'], isManager: false });
    expect(s.csrf).toMatch(/^[0-9a-f]{64}$/);
    const audit = await db('audit_log').where({ action: 'SIGN_IN', actor_employee_id: emp.id });
    expect(audit).toHaveLength(1);
  });

  it('sets an HTTP-only session cookie', async () => {
    const emp = await fixtureEmployee(db);
    const agent = request.agent(app);
    const login = await agent.get('/api/auth/login');
    expect(login.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(login.headers['set-cookie'][0]).toMatch(/SameSite=Lax/i);
    entra.nextClaims = { tid: TENANT, oid: emp.oid };
    await agent.get('/api/auth/callback?code=a&state=s');
  });

  it('refuses an unlinked account and records it for HR to link', async () => {
    const s = await signIn(app, entra, {
      oid: '11111111-2222-3333-4444-555555555555',
      email: 'new@example.test',
      name: 'New Person',
    });
    expect(s.redirect).toBe('http://localhost:5173/access-not-configured?reason=not_configured');
    expect(s.status).toBe(401);
    const row = await db('audit_log').where({ action: 'SIGN_IN_NOT_CONFIGURED' }).first();
    expect(typeof row.after_data === 'string' ? JSON.parse(row.after_data) : row.after_data).toMatchObject({
      email: 'new@example.test',
      name: 'New Person',
    });
  });

  it('refuses another tenant even when the object ID matches an employee', async () => {
    const emp = await fixtureEmployee(db);
    const s = await signIn(app, entra, { oid: emp.oid, tid: '99999999-9999-9999-9999-999999999999' });
    expect(s.status).toBe(401);
    expect(await db('audit_log').where({ action: 'SIGN_IN_REJECTED_TENANT' })).toHaveLength(1);
  });

  it('refuses an inactive employee', async () => {
    const emp = await fixtureEmployee(db, { status: 'INACTIVE' });
    const s = await signIn(app, entra, { oid: emp.oid });
    expect(s.redirect).toContain('reason=inactive');
    expect(s.status).toBe(401);
  });

  it('never matches on email alone', async () => {
    await fixtureEmployee(db, { email: 'same@example.test' });
    const s = await signIn(app, entra, {
      oid: '22222222-2222-2222-2222-222222222222',
      email: 'same@example.test',
    });
    expect(s.status).toBe(401);
  });

  it('rejects a callback without a sign-in in progress', async () => {
    const res = await request(app).get('/api/auth/callback?code=a&state=s');
    expect(res.headers.location).toContain('/sign-in?error=expired');
  });

  it('requires the CSRF token for changes', async () => {
    const emp = await fixtureEmployee(db, { roles: ['HR_ADMIN'] });
    const s = await signIn(app, entra, { oid: emp.oid });
    const without = await s.agent.post('/api/admin/companies').send({ code: 'AFS', name: 'Altus' });
    expect(without.status).toBe(403);
    expect(without.body.error.code).toBe('CSRF_FAILED');
    const withToken = await s.agent
      .post('/api/admin/companies')
      .set('X-CSRF-Token', s.csrf)
      .send({ code: 'AFS', name: 'Altus' });
    expect(withToken.status).toBe(201);
  });

  it('signs out and ends the session', async () => {
    const emp = await fixtureEmployee(db);
    const s = await signIn(app, entra, { oid: emp.oid });
    const out = await s.agent.post('/api/auth/logout').set('X-CSRF-Token', s.csrf);
    expect(out.status).toBe(200);
    expect(out.body.logoutUrl).toContain(
      'post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fsigned-out',
    );
    expect((await s.agent.get('/api/auth/me')).status).toBe(401);
  });

  it('takes effect immediately when an employee is deactivated', async () => {
    const admin = await fixtureEmployee(db, { roles: ['HR_ADMIN'] });
    const user = await fixtureEmployee(db);
    const a = await signIn(app, entra, { oid: admin.oid });
    const u = await signIn(app, entra, { oid: user.oid });
    expect((await u.agent.get('/api/me/profile')).status).toBe(200);
    const res = await a.agent
      .post(`/api/admin/employees/${user.id}/deactivate`)
      .set('X-CSRF-Token', a.csrf)
      .send({});
    expect(res.status).toBe(200);
    expect((await u.agent.get('/api/me/profile')).status).toBe(401);
  });
});

describe('authorisation', () => {
  it('blocks everything except sign-in for anonymous requests', async () => {
    for (const path of ['/api/me/profile', '/api/admin/employees', '/api/admin/audit']) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
  });

  it('blocks the HR Administration API for employees and HR Officers', async () => {
    for (const roles of [[], ['HR_OFFICER']]) {
      const emp = await fixtureEmployee(db, { roles });
      const s = await signIn(app, entra, { oid: emp.oid });
      expect((await s.agent.get('/api/admin/employees')).status).toBe(403);
    }
  });

  it('serves only the signed-in employee their own profile', async () => {
    const mgr = await fixtureEmployee(db, { first_name: 'Mona' });
    const emp = await fixtureEmployee(db, { first_name: 'Ezra', managerId: mgr.id });
    const s = await signIn(app, entra, { oid: emp.oid });
    const res = await s.agent.get('/api/me/profile?employeeId=' + mgr.id);
    expect(res.body.firstName).toBe('Ezra');
    expect(res.body.lineManager).toMatch(/^Mona /);
  });
});
