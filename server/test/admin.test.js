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
  it('never removes the last active System Administrator', async () => {
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

describe('roles page', () => {
  it('lists holders and grants and removes a role', async () => {
    const id = (await post('/api/admin/employees', newEmployee({ firstName: 'Bwalya' }))).body.id;
    expect((await post('/api/admin/roles/HR_OFFICER/holders', { employeeId: id })).status).toBe(201);
    // Granting twice changes nothing.
    expect((await post('/api/admin/roles/hr_officer/holders', { employeeId: id })).status).toBe(201);
    let list = await admin.agent.get('/api/admin/roles');
    const officers = list.body.roles.find((r) => r.code === 'HR_OFFICER').holders;
    expect(officers.map((h) => h.id)).toEqual([id]);
    expect(list.body.roles.find((r) => r.code === 'HR_ADMIN').holders.map((h) => h.id)).toEqual([admin.id]);

    const del = await admin.agent
      .delete(`/api/admin/roles/HR_OFFICER/holders/${id}`)
      .set('X-CSRF-Token', admin.csrf);
    expect(del.status).toBe(200);
    list = await admin.agent.get('/api/admin/roles');
    expect(list.body.roles.find((r) => r.code === 'HR_OFFICER').holders).toEqual([]);
    expect(await db('audit_log').where({ action: 'ROLES_CHANGED' })).toHaveLength(2);
  });

  it('refuses to remove the last System Administrator and unknown roles', async () => {
    const res = await admin.agent
      .delete(`/api/admin/roles/HR_ADMIN/holders/${admin.id}`)
      .set('X-CSRF-Token', admin.csrf);
    expect(res.status).toBe(409);
    expect((await post('/api/admin/roles/SUPERUSER/holders', { employeeId: admin.id })).status).toBe(404);
  });

  it('makes someone a manager by giving them direct reports, refusing loops', async () => {
    const m = (await post('/api/admin/employees', newEmployee({ firstName: 'Mwila' }))).body.id;
    const a = (await post('/api/admin/employees', newEmployee())).body.id;
    const b = (await post('/api/admin/employees', newEmployee())).body.id;
    const res = await post('/api/admin/roles/manager/reports', { managerId: m, employeeIds: [a, b] });
    expect(res.status).toBe(201);
    const list = await admin.agent.get('/api/admin/roles');
    const mgr = list.body.managers.find((x) => x.id === m);
    expect(mgr.reports.map((r) => r.id).sort()).toEqual([a, b].sort());

    const loop = await post('/api/admin/roles/manager/reports', { managerId: a, employeeIds: [m] });
    expect(loop.status).toBe(400);
    expect(loop.body.error.message).toMatch(/reporting loop/);

    const off = await admin.agent
      .delete(`/api/admin/roles/manager/reports/${a}`)
      .set('X-CSRF-Token', admin.csrf);
    expect(off.status).toBe(200);
    expect((await db('employees').where({ id: a }).first()).line_manager_id).toBeNull();
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

describe('companies in the group', () => {
  const company = async (code, name) => (await post('/api/admin/companies', { code, name })).body.id;

  it('creates companies and refuses duplicates', async () => {
    expect(await company('AFS', 'Altus Financial Services Limited')).toBeGreaterThan(0);
    expect((await post('/api/admin/companies', { code: 'afs', name: 'Other' })).status).toBe(409);
    const list = await admin.agent.get('/api/admin/companies');
    expect(list.body.items).toEqual([expect.objectContaining({ code: 'AFS', activeEmployees: 0 })]);
    // The signed-in administrator has no company yet, so the "No company set" filter is offered.
    expect(list.body.employeesWithoutCompany).toBe(true);
    await db('employees').update({ company_id: list.body.items[0].id });
    expect((await admin.agent.get('/api/admin/companies')).body.employeesWithoutCompany).toBe(false);
    expect(await db('audit_log').where({ action: 'COMPANY_CREATED' })).toHaveLength(1);
  });

  it('lets two companies each have a department with the same code', async () => {
    const a = await company('AFS', 'Altus Financial Services Limited');
    const b = await company('AHL', 'Altus Holdings Limited');
    expect(
      (await post('/api/admin/departments', { companyId: a, code: 'FIN', name: 'Finance' })).status,
    ).toBe(201);
    expect(
      (await post('/api/admin/departments', { companyId: b, code: 'FIN', name: 'Finance' })).status,
    ).toBe(201);
    expect((await post('/api/admin/departments', { companyId: a, code: 'FIN', name: 'Other' })).status).toBe(
      409,
    );
    expect((await post('/api/admin/departments', { code: 'X', name: 'No company' })).status).toBe(400);
  });

  it('takes the company from the department and refuses a mismatch', async () => {
    const a = await company('AFS', 'Altus Financial Services Limited');
    const b = await company('AHL', 'Altus Holdings Limited');
    const fin = (await post('/api/admin/departments', { companyId: a, code: 'FIN', name: 'Finance' })).body
      .id;
    const id = (await post('/api/admin/employees', newEmployee({ departmentId: fin }))).body.id;
    expect((await admin.agent.get(`/api/admin/employees/${id}`)).body).toMatchObject({
      companyId: a,
      company: 'Altus Financial Services Limited',
    });
    const res = await patch(`/api/admin/employees/${id}`, { companyId: b });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/belongs to Altus Financial Services Limited/);
    expect((await patch(`/api/admin/employees/${id}`, { companyId: b, departmentId: null })).status).toBe(
      200,
    );
    const list = await admin.agent.get(`/api/admin/employees?companyId=${b}`);
    expect(list.body.items.map((e) => e.id)).toEqual([id]);
  });

  it('will not deactivate a company that still has active staff', async () => {
    const a = await company('AFS', 'Altus Financial Services Limited');
    await post('/api/admin/employees', newEmployee({ companyId: a }));
    const res = await patch(`/api/admin/companies/${a}`, { isActive: false });
    expect(res.status).toBe(409);
  });
});

describe('employee import', () => {
  const header =
    'employee_number,first_name,last_name,email,job_title,company_code,department_code,manager_employee_number,employment_start_date,employment_end_date';
  const company = async (code, name) => (await post('/api/admin/companies', { code, name })).body.id;

  it('previews errors without writing anything', async () => {
    await company('AFS', 'Altus Financial Services Limited');
    const csv = [
      header,
      'A1,Ann,One,a1@example.test,,AFS,NOPE,,2025-01-06,',
      'A1,Ben,Two,,,AFS,,,2025-13-01,',
      'A3,Cara,Three,,,,,,2025-01-06,',
    ].join('\n');
    const res = await post('/api/admin/employees/import/preview', { csv });
    expect(res.status).toBe(200);
    expect(res.body.validRows).toBe(0);
    expect(res.body.rows[0].errors.join(' ')).toMatch(/department_code NOPE/);
    expect(res.body.rows[1].errors.join(' ')).toMatch(/more than once/);
    expect(res.body.rows[2].errors.join(' ')).toMatch(/company_name or company_code is required/);
    expect((await db('employees').count({ n: '*' }).first()).n).toBe(1);
  });

  it('still accepts the older line_manager_employee_number column name', async () => {
    await company('AFS', 'Altus Financial Services Limited');
    const csv = [
      header.replace('manager_employee_number', 'line_manager_employee_number'),
      'L2,Ben,Two,,,AFS,,L1,2025-01-06,',
      'L1,Ann,One,,,AFS,,,2024-03-01,',
    ].join('\n');
    const res = await post('/api/admin/employees/import/preview', { csv });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.validRows).toBe(2);
  });

  it('imports valid rows, including managers defined in the same file', async () => {
    const afs = await company('AFS', 'Altus Financial Services Limited');
    await post('/api/admin/departments', { companyId: afs, code: 'CRD', name: 'Credit' });
    const csv = [
      header,
      'C2,Ben,Two,b2@example.test,Officer,AFS,CRD,C1,2025-01-06,',
      'C1,Ann,One,a1@example.test,Head of Credit,afs,crd,,2024-03-01,',
    ].join('\n');
    const res = await post('/api/admin/employees/import/commit', { csv });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.imported).toBe(2);
    const ben = await db('employees').where({ employee_number: 'C2' }).first();
    const ann = await db('employees').where({ employee_number: 'C1' }).first();
    expect(ben.line_manager_id).toBe(ann.id);
    expect(ben.company_id).toBe(afs);
  });

  const NEW_HEADER =
    'employee_number,first_name,last_name,email,job_title,company name,company_code,department name,department_code,manager_employee_name,employment_start_date';

  it('creates new companies and departments, and finds managers by name across the group', async () => {
    const afs = await company('AFS', 'Altus Financial Services Limited');
    await post('/api/admin/departments', { companyId: afs, code: 'CRD', name: 'Credit' });
    const csv = [
      NEW_HEADER,
      'N1,Ann,One,,Head of Sales,Altus Financial Services Limited,AFS,Sales,SLS,,2024-03-01',
      'N2,Ben,Two,,Sales Officer,,AFS,Sales,SLS,Ann One,2025-01-06',
      'N3,Cara,Three,,Credit Officer,altus financial services limited,,credit,CRD,ann  one,2025-02-03',
      'N4,Dan,Four,,Finance Officer,Altus Holdings Limited,AHL,Credit,CRD,Ann One,2025-02-03',
    ].join('\n');
    const preview = await post('/api/admin/employees/import/preview', { csv });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.validRows, JSON.stringify(preview.body.rows)).toBe(4);
    expect(preview.body.newCompanies).toEqual([{ code: 'AHL', name: 'Altus Holdings Limited' }]);
    expect(preview.body.newDepartments).toEqual([
      { company: 'Altus Financial Services Limited', code: 'SLS', name: 'Sales' },
      { company: 'Altus Holdings Limited', code: 'CRD', name: 'Credit' },
    ]);

    const res = await post('/api/admin/employees/import/commit', { csv });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ imported: 4, companiesCreated: 1, departmentsCreated: 2 });
    const ahl = await db('companies').where({ code: 'AHL' }).first();
    const sales = await db('departments').where({ code: 'SLS' }).first();
    const [ann, ben, cara, dan] = await Promise.all(
      ['N1', 'N2', 'N3', 'N4'].map((n) => db('employees').where({ employee_number: n }).first()),
    );
    expect(sales.company_id).toBe(afs);
    expect(ben).toMatchObject({ company_id: afs, department_id: sales.id, line_manager_id: ann.id });
    expect(cara.line_manager_id).toBe(ann.id);
    const ahlCredit = await db('departments').where({ company_id: ahl.id, code: 'CRD' }).first();
    expect(dan).toMatchObject({ company_id: ahl.id, department_id: ahlCredit.id, line_manager_id: ann.id });
  });

  it('assigns a department that has no company yet to the company named in the file', async () => {
    const [legacy] = await db('departments').insert({ code: 'OPS', name: 'Operations' });
    const afs = await company('AFS', 'Altus Financial Services Limited');
    const csv = [NEW_HEADER, 'O1,Ann,One,,,,AFS,Operations,OPS,,2024-03-01'].join('\n');
    const res = await post('/api/admin/employees/import/commit', { csv });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await db('departments').where({ id: legacy }).first()).company_id).toBe(afs);
    expect(
      await db('employees')
        .where({ employee_number: 'O1' })
        .first()
        .then((e) => e.department_id),
    ).toBe(legacy);
  });

  it('explains company, department and manager-name problems', async () => {
    const afs = await company('AFS', 'Altus Financial Services Limited');
    await post('/api/admin/departments', { companyId: afs, code: 'CRD', name: 'Credit' });
    await fixtureEmployee(db, { first_name: 'Sam', last_name: 'Same' });
    await fixtureEmployee(db, { first_name: 'Sam', last_name: 'Same' });
    const csv = [
      NEW_HEADER,
      'P1,Ann,One,,,,AFS,Finance,CRD,,2024-03-01',
      'P2,Ben,Two,,,,AFS,,NEW,,2024-03-01',
      'P3,Cara,Three,,,,AFS,Nowhere,,,2024-03-01',
      'P4,Dan,Four,,,,AFS,,,Sam Same,2024-03-01',
      'P5,Eve,Five,,,,AFS,,,Nobody Here,2024-03-01',
      'P6,Fay,Six,,,Wrong Name,AFS,,,,2024-03-01',
      'P7,Gus,Seven,,,,ZZZ,,,,2024-03-01',
    ].join('\n');
    const res = await post('/api/admin/employees/import/preview', { csv });
    const errs = res.body.rows.map((r) => r.errors.join(' '));
    expect(errs[0]).toMatch(/CRD is Credit, not Finance/);
    expect(errs[1]).toMatch(/does not exist in AFS; add department_name to create it/);
    expect(errs[2]).toMatch(/add department_code to create it/);
    expect(errs[3]).toMatch(/more than one person/);
    expect(errs[4]).toMatch(/not found/);
    expect(errs[5]).toMatch(/company_code AFS is Altus Financial Services Limited, not Wrong Name/);
    expect(errs[6]).toMatch(/company_code ZZZ does not exist; add company_name to create it/);
  });

  it('refuses the whole file if any row is invalid', async () => {
    await company('AFS', 'Altus Financial Services Limited');
    const csv = [header, 'D1,Ann,One,,,AFS,,,2025-01-06,', 'D2,Ben,,,,AFS,,,2025-01-06,'].join('\n');
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
