import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { bootstrapAdmin, BootstrapError } from '../src/modules/setup/bootstrap-admin.service.js';

const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const input = {
  oid: '12345678-90ab-cdef-1234-567890abcdef',
  email: 'Admin.Fixture@example.test',
  employeeNumber: 'FIX-001',
  firstName: 'Admin',
  lastName: 'Fixture',
  startDate: '2023-05-02',
};

let db;
beforeAll(() => {
  db = createTestDb();
});
afterAll(() => db.destroy());
beforeEach(() => resetData(db));

describe('bootstrap-admin', () => {
  it('creates the employee, identity link, HR_ADMIN role and an audit entry in one go', async () => {
    const { employeeId } = await bootstrapAdmin(db, input, { tenantId: TENANT });

    const employee = await db('employees').where({ id: employeeId }).first();
    expect(employee.email).toBe('admin.fixture@example.test');
    expect(employee.status).toBe('ACTIVE');
    expect(employee.work_schedule_id).not.toBeNull();

    const link = await db('identity_links').where({ employee_id: employeeId }).first();
    expect(link).toMatchObject({ tenant_id: TENANT, object_id: input.oid, linked_via: 'BOOTSTRAP' });

    const roles = await db('employee_roles')
      .join('roles', 'roles.id', 'employee_roles.role_id')
      .where({ employee_id: employeeId })
      .pluck('roles.code');
    expect(roles).toEqual(['HR_ADMIN']);

    const audit = await db('audit_log').where({ action: 'BOOTSTRAP_ADMIN_CREATED' });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_type).toBe('CLI');
  });

  it('refuses to run once an HR Administrator exists', async () => {
    await bootstrapAdmin(db, input, { tenantId: TENANT });
    await expect(
      bootstrapAdmin(
        db,
        {
          ...input,
          oid: '99999999-90ab-cdef-1234-567890abcdef',
          email: 'second@example.test',
          employeeNumber: 'FIX-002',
        },
        { tenantId: TENANT },
      ),
    ).rejects.toThrow(/already exists/);
    const { n } = await db('employees').count({ n: '*' }).first();
    expect(Number(n)).toBe(1);
  });

  it('allows only one of two concurrent runs to succeed', async () => {
    const results = await Promise.allSettled([
      bootstrapAdmin(db, input, { tenantId: TENANT }),
      bootstrapAdmin(
        db,
        {
          ...input,
          oid: '99999999-90ab-cdef-1234-567890abcdef',
          email: 'second@example.test',
          employeeNumber: 'FIX-002',
        },
        { tenantId: TENANT },
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { n } = await db('employee_roles').count({ n: '*' }).first();
    expect(Number(n)).toBe(1);
  });

  it('validates input and the configured tenant', async () => {
    await expect(bootstrapAdmin(db, { ...input, oid: 'not-a-guid' }, { tenantId: TENANT })).rejects.toThrow(
      /--oid must be the Entra object ID/,
    );
    await expect(
      bootstrapAdmin(db, { ...input, startDate: '2023-02-30' }, { tenantId: TENANT }),
    ).rejects.toThrow(/--start-date must be a real calendar date/);
    await expect(bootstrapAdmin(db, input, { tenantId: undefined })).rejects.toBeInstanceOf(BootstrapError);
    const { n } = await db('employees').count({ n: '*' }).first();
    expect(Number(n)).toBe(0);
  });
});
