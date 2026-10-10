import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';

let db;
let app;
let entra;
let admin; // { agent, csrf, id }

beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());
beforeEach(async () => {
  await resetData(db);
  const emp = await fixtureEmployee(db, { roles: ['HR_ADMIN'] });
  const s = await signIn(app, entra, { oid: emp.oid });
  admin = { ...s, id: emp.id };
});

const post = (path, body) => admin.agent.post(path).set('X-CSRF-Token', admin.csrf).send(body);
const patch = (path, body) => admin.agent.patch(path).set('X-CSRF-Token', admin.csrf).send(body);
const put = (path, body) => admin.agent.put(path).set('X-CSRF-Token', admin.csrf).send(body);

const newEmployee = (over = {}) => ({
  employeeNumber: `E${Math.floor(Math.random() * 1e6)}`,
  firstName: 'Fixture',
  lastName: 'Staff',
  employmentStartDate: '2025-02-03',
  ...over,
});

describe('employees', () => {
  it('creates an employee with the default schedule and audits it', async () => {
    const res = await post('/api/admin/employees', newEmployee({ email: 'Staff@Example.test' }));
    expect(res.status).toBe(201);
    const detail = await admin.agent.get(`/api/admin/employees/${res.body.id}`);
    expect(detail.body).toMatchObject({
      email: 'staff@example.test',
      status: 'ACTIVE',
      workSchedule: 'Standard Monday to Friday',
    });
    expect(
      await db('audit_log').where({ action: 'EMPLOYEE_CREATED', entity_id: String(res.body.id) }),
    ).toHaveLength(1);
  });

  it('returns field-level validation messages', async () => {
    const res = await post(
      '/api/admin/employees',
      newEmployee({ employmentStartDate: '2025-02-30', email: 'nope' }),
    );
    expect(res.status).toBe(400);
    const paths = res.body.error.fields.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['employmentStartDate', 'email']));
  });

  it('refuses duplicate employee numbers', async () => {
    await post('/api/admin/employees', newEmployee({ employeeNumber: 'DUP1' }));
    const res = await post('/api/admin/employees', newEmployee({ employeeNumber: 'DUP1' }));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/employee number/);
  });

  it('refuses reporting loops', async () => {
    const a = (await post('/api/admin/employees', newEmployee())).body.id;
    const b = (await post('/api/admin/employees', newEmployee({ lineManagerId: a }))).body.id;
    const res = await patch(`/api/admin/employees/${a}`, { lineManagerId: b });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/reporting loop/);
    expect((await patch(`/api/admin/employees/${a}`, { lineManagerId: a })).status).toBe(400);
  });

  it('will not deactivate a manager who still has direct reports, or yourself', async () => {
    const m = (await post('/api/admin/employees', newEmployee())).body.id;
    await post('/api/admin/employees', newEmployee({ lineManagerId: m }));
    const res = await post(`/api/admin/employees/${m}/deactivate`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/direct report/);
    expect((await post(`/api/admin/employees/${admin.id}/deactivate`, {})).status).toBe(409);
  });

  it('searches and paginates', async () => {
    await post('/api/admin/employees', newEmployee({ firstName: 'Chanda', lastName: 'Banda' }));
    await post('/api/admin/employees', newEmployee({ firstName: 'Mutale', lastName: 'Phiri' }));
    const res = await admin.agent.get('/api/admin/employees?search=chanda%20b');
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].lastName).toBe('Banda');
  });
});

describe('roles', () => {
  it('never removes the last active HR Administrator', async () => {
    const res = await put(`/api/admin/employees/${admin.id}/roles`, { roles: ['HR_OFFICER'] });
    expect(res.status).toBe(409);
  });

  it('grants and revokes roles with an audit trail', async () => {
    const id = (await post('/api/admin/employees', newEmployee())).body.id;
    expect(
      (await put(`/api/admin/employees/${id}/roles`, { roles: ['HR_OFFICER', 'HR_ADMIN'] })).status,
    ).toBe(200);
    expect((await put(`/api/admin/employees/${admin.id}/roles`, { roles: [] })).status).toBe(200);
    const changes = await db('audit_log').where({ action: 'ROLES_CHANGED' });
    expect(changes).toHaveLength(2);
  });

  it('rejects roles that do not exist', async () => {
    const res = await put(`/api/admin/employees/${admin.id}/roles`, { roles: ['SUPERUSER'] });
    expect(res.status).toBe(400);
  });
});

describe('linking Microsoft accounts', () => {
  it('lists a refused sign-in and lets HR link it, after which the person can sign in', async () => {
    const oid = '33333333-3333-3333-3333-333333333333';
    const first = await signIn(app, entra, { oid, email: 'chanda@example.test', name: 'Chanda Banda' });
    expect(first.status).toBe(401);

    const pending = await admin.agent.get('/api/admin/employees/pending-sign-ins');
    expect(pending.body.items).toEqual([
      expect.objectContaining({
        objectId: oid,
        email: 'chanda@example.test',
        name: 'Chanda Banda',
        attempts: 1,
      }),
    ]);

    const id = (await post('/api/admin/employees', newEmployee({ email: 'chanda@example.test' }))).body.id;
    expect((await put(`/api/admin/employees/${id}/identity`, { objectId: oid })).status).toBe(200);
    expect((await admin.agent.get('/api/admin/employees/pending-sign-ins')).body.items).toHaveLength(0);

    const second = await signIn(app, entra, { oid });
    expect(second.status).toBe(200);
    expect(second.me.id).toBe(id);
  });

  it('refuses to link one Microsoft account to two employees', async () => {
    const oid = '44444444-4444-4444-4444-444444444444';
    const a = (await post('/api/admin/employees', newEmployee())).body.id;
    const b = (await post('/api/admin/employees', newEmployee())).body.id;
    await put(`/api/admin/employees/${a}/identity`, { objectId: oid });
    const res = await put(`/api/admin/employees/${b}/identity`, { objectId: oid });
    expect(res.status).toBe(409);
  });

  it('unlinking signs the person out everywhere', async () => {
    const emp = await fixtureEmployee(db);
    const s = await signIn(app, entra, { oid: emp.oid });
    const res = await admin.agent
      .delete(`/api/admin/employees/${emp.id}/identity`)
      .set('X-CSRF-Token', admin.csrf);
    expect(res.status).toBe(200);
    expect((await s.agent.get('/api/me/profile')).status).toBe(401);
  });
});

describe('employee import', () => {
  const header =
    'employee_number,first_name,last_name,email,job_title,department_code,line_manager_employee_number,employment_start_date,employment_end_date';

  it('previews errors without writing anything', async () => {
    const csv = [header, 'A1,Ann,One,a1@example.test,,NOPE,,2025-01-06,', 'A1,Ben,Two,,,,,2025-13-01,'].join(
      '\n',
    );
    const res = await post('/api/admin/employees/import/preview', { csv });
    expect(res.status).toBe(200);
    expect(res.body.validRows).toBe(0);
    expect(res.body.rows[0].errors.join(' ')).toMatch(/department_code NOPE/);
    expect(res.body.rows[1].errors.join(' ')).toMatch(/more than once/);
    expect((await db('employees').count({ n: '*' }).first()).n).toBe(1);
  });

  it('imports valid rows, including managers defined in the same file', async () => {
    await post('/api/admin/departments', { code: 'CRD', name: 'Credit' });
    const csv = [
      header,
      'C2,Ben,Two,b2@example.test,Officer,CRD,C1,2025-01-06,',
      'C1,Ann,One,a1@example.test,Head of Credit,crd,,2024-03-01,',
    ].join('\n');
    const res = await post('/api/admin/employees/import/commit', { csv });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
    const ben = await db('employees').where({ employee_number: 'C2' }).first();
    const ann = await db('employees').where({ employee_number: 'C1' }).first();
    expect(ben.line_manager_id).toBe(ann.id);
  });

  it('refuses the whole file if any row is invalid', async () => {
    const csv = [header, 'D1,Ann,One,,,,,2025-01-06,', 'D2,Ben,,,,,,2025-01-06,'].join('\n');
    const res = await post('/api/admin/employees/import/commit', { csv });
    expect(res.status).toBe(400);
    expect(await db('employees').where('employee_number', 'like', 'D%')).toHaveLength(0);
  });
});

describe('calendar and settings', () => {
  it('records public holidays and refuses two on one date', async () => {
    expect(
      (await post('/api/admin/holidays', { holidayDate: '2026-10-24', name: 'Independence Day' })).status,
    ).toBe(201);
    expect((await post('/api/admin/holidays', { holidayDate: '2026-10-24', name: 'Duplicate' })).status).toBe(
      409,
    );
    const list = await admin.agent.get('/api/admin/holidays?year=2026');
    expect(list.body.items).toHaveLength(1);
  });

  it('confirms a decision default and records who did it', async () => {
    const res = await put('/api/admin/settings/resubmission_routing', { value: 'MANAGER_STAGE' });
    expect(res.status).toBe(200);
    const row = await db('system_settings').where({ setting_key: 'resubmission_routing' }).first();
    expect(row.requires_hr_confirmation).toBe(0);
    expect(row.updated_by).toBe(admin.id);
    expect(await db('audit_log').where({ action: 'SETTING_CONFIRMED' })).toHaveLength(1);
  });

  it('refuses invalid or read-only settings', async () => {
    expect((await put('/api/admin/settings/overdue_hr_working_days', { value: 0 })).status).toBe(400);
    expect((await put('/api/admin/settings/leave_year_start', { value: { month: 4, day: 1 } })).status).toBe(
      409,
    );
  });
});
