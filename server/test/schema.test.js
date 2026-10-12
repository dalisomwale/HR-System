import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';

const EXPECTED_TABLES = [
  'approval_actions',
  'audit_log',
  'balance_cache',
  'balance_ledger',
  'change_requests',
  'delegations',
  'companies',
  'departments',
  'documents',
  'email_outbox',
  'employee_roles',
  'employees',
  'idempotency_keys',
  'identity_links',
  'leave_policy_versions',
  'leave_request_days',
  'leave_requests',
  'leave_types',
  'notifications',
  'public_holidays',
  'roles',
  'scheduled_job_runs',
  'sessions',
  'system_settings',
  'work_schedules',
];

let db;
beforeAll(() => {
  db = createTestDb();
});
afterAll(() => db.destroy());
beforeEach(() => resetData(db));

// Test fixtures: exist only in the test database and are removed before every test.
async function fixtureEmployee(overrides = {}) {
  const [id] = await db('employees').insert({
    employee_number: overrides.employee_number ?? `T${Math.floor(Math.random() * 1e9)}`,
    first_name: 'Test',
    last_name: 'Fixture',
    employment_start_date: '2024-01-01',
    ...overrides,
  });
  return id;
}
async function fixtureLeaveType() {
  const [id] = await db('leave_types').insert({ code: 'TEST', name: 'Test leave type' });
  return id;
}

describe('schema', () => {
  it('creates every table in the design', async () => {
    const [rows] = await db.raw(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
    );
    const names = rows.map((r) => r.name);
    for (const t of EXPECTED_TABLES) expect(names).toContain(t);
  });

  it('installs required configuration only, with no business records', async () => {
    const roles = await db('roles').pluck('code');
    expect(roles.sort()).toEqual(['EXECUTIVE_DIRECTOR', 'HR_ADMIN', 'HR_OFFICER', 'MANAGING_DIRECTOR']);
    for (const table of ['employees', 'departments', 'leave_requests', 'public_holidays', 'balance_ledger']) {
      const { n } = await db(table).count({ n: '*' }).first();
      expect(Number(n), table).toBe(0);
    }
    // Leave types from the policy are installed inactive, for HR to review and activate.
    const types = await db('leave_types').select('code', 'is_active');
    expect(types).toHaveLength(10);
    expect(types.every((t) => !t.is_active)).toBe(true);
    const unconfirmed = await db('system_settings')
      .where({ requires_hr_confirmation: true })
      .pluck('setting_key');
    expect(unconfirmed).toEqual(
      expect.arrayContaining(['weekend_holiday_substitution', 'uncommunicated_decision_escalation_days']),
    );
  });

  it('rejects a leave request whose end date is before its start date', async () => {
    const employeeId = await fixtureEmployee();
    const leaveTypeId = await fixtureLeaveType();
    const [policyId] = await db('leave_policy_versions').insert({
      leave_type_id: leaveTypeId,
      version_no: 1,
      effective_from: '2026-01-01',
      is_paid: true,
      day_basis: 'WORKING_DAYS',
      consumes_balance: true,
      entitlement_period: 'LEAVE_YEAR',
      accrual_method: 'NONE',
    });
    await expect(
      db('leave_requests').insert({
        employee_id: employeeId,
        leave_type_id: leaveTypeId,
        policy_version_id: policyId,
        start_date: '2026-11-10',
        end_date: '2026-11-09',
      }),
    ).rejects.toThrow(/chk_lr_dates/);
  });

  it('refuses FIXED_MONTHLY accrual without an amount', async () => {
    const leaveTypeId = await fixtureLeaveType();
    await expect(
      db('leave_policy_versions').insert({
        leave_type_id: leaveTypeId,
        version_no: 1,
        effective_from: '2026-01-01',
        is_paid: true,
        day_basis: 'WORKING_DAYS',
        consumes_balance: true,
        entitlement_period: 'LEAVE_YEAR',
        accrual_method: 'FIXED_MONTHLY',
      }),
    ).rejects.toThrow(/chk_lpv_monthly/);
  });
});

describe('balance ledger', () => {
  async function ledgerFixture() {
    const employeeId = await fixtureEmployee();
    const leaveTypeId = await fixtureLeaveType();
    return { employeeId, leaveTypeId };
  }

  it('is append-only: updates and deletes are refused by the database', async () => {
    const { employeeId, leaveTypeId } = await ledgerFixture();
    const [id] = await db('balance_ledger').insert({
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      leave_year: 2026,
      amount: 5,
      entry_type: 'OPENING',
      source_type: 'OPENING',
      reason: 'Opening balance',
    });
    await expect(db('balance_ledger').where({ id }).update({ amount: 50 })).rejects.toThrow(/append-only/);
    await expect(db('balance_ledger').where({ id }).del()).rejects.toThrow(/append-only/);
  });

  it('accepts a deduction for a request only once per leave type and year', async () => {
    const { employeeId, leaveTypeId } = await ledgerFixture();
    const deduction = {
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      leave_year: 2026,
      amount: -3,
      entry_type: 'DEDUCTION',
      source_type: 'LEAVE_REQUEST',
      source_id: 42,
    };
    await db('balance_ledger').insert(deduction);
    await expect(db('balance_ledger').insert(deduction)).rejects.toThrow(/uq_ledger_source_once/);
  });

  it('accepts a monthly accrual only once per period', async () => {
    const { employeeId, leaveTypeId } = await ledgerFixture();
    const accrual = {
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      leave_year: 2026,
      amount: 2,
      entry_type: 'ACCRUAL',
      source_type: 'ACCRUAL_RUN',
      period_key: '2026-03',
    };
    await db('balance_ledger').insert(accrual);
    await expect(db('balance_ledger').insert({ ...accrual, source_id: 2 })).rejects.toThrow(
      /uq_ledger_period_once/,
    );
  });

  it('requires a reason for adjustments and refuses zero amounts', async () => {
    const { employeeId, leaveTypeId } = await ledgerFixture();
    const base = {
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      leave_year: 2026,
      source_type: 'ADJUSTMENT',
    };
    await expect(
      db('balance_ledger').insert({ ...base, amount: 1, entry_type: 'ADJUSTMENT' }),
    ).rejects.toThrow(/chk_ledger_reason/);
    await expect(
      db('balance_ledger').insert({ ...base, amount: 0, entry_type: 'ADJUSTMENT', reason: 'x' }),
    ).rejects.toThrow(/chk_ledger_nonzero/);
  });
});

describe('audit log', () => {
  it('is append-only', async () => {
    const [id] = await db('audit_log').insert({ actor_type: 'SYSTEM', action: 'TEST', entity_type: 'test' });
    await expect(db('audit_log').where({ id }).update({ action: 'CHANGED' })).rejects.toThrow(/append-only/);
    await expect(db('audit_log').where({ id }).del()).rejects.toThrow(/append-only/);
  });
});
