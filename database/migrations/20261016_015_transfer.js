/**
 * Transfer (project owner, 16 Oct 2026; D50). Besides approving or rejecting, the manager can
 * transfer a request back to the employee with different dates, for example 5 days instead of
 * the 10 asked for. The employee accepts (the request goes back to the manager with the new
 * dates) or withdraws it, giving a reason.
 *
 * The offered dates are held on the request until the employee answers; the request's own
 * dates and day breakdown change only when the employee accepts.
 */

const STATES = [
  'DRAFT',
  'PENDING_MANAGER_APPROVAL',
  'PENDING_HR_APPROVAL',
  'RETURNED_FOR_CORRECTION',
  'APPROVED',
  'REJECTED_BY_MANAGER',
  'REJECTED_BY_HR',
  'WITHDRAWN',
  'CANCELLED',
];
const ACTIONS = ['SUBMIT', 'RESUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'WITHDRAW', 'ROUTE', 'ESCALATE'];
const list = (values) => values.map((v) => `'${v}'`).join(', ');

export async function up(knex) {
  await knex.raw(
    `ALTER TABLE leave_requests MODIFY status ENUM(${list([...STATES, 'PENDING_EMPLOYEE_ACCEPTANCE'])}) NOT NULL DEFAULT 'DRAFT'`,
  );
  await knex.raw(
    `ALTER TABLE approval_actions MODIFY action ENUM(${list([...ACTIONS, 'TRANSFER', 'ACCEPT'])}) NOT NULL`,
  );
  await knex.schema.alterTable('leave_requests', (t) => {
    t.date('offered_start_date').nullable().after('end_portion');
    t.date('offered_end_date').nullable().after('offered_start_date');
    t.enu('offered_start_portion', ['FULL', 'PM_ONLY']).nullable().after('offered_end_date');
    t.enu('offered_end_portion', ['FULL', 'AM_ONLY']).nullable().after('offered_start_portion');
    t.decimal('offered_chargeable_days', 6, 2).nullable().after('offered_end_portion');
  });
}

export async function down(knex) {
  // Requests still waiting for the employee go back to the manager with their original dates.
  await knex('leave_requests')
    .where({ status: 'PENDING_EMPLOYEE_ACCEPTANCE' })
    .update({ status: 'PENDING_MANAGER_APPROVAL' });
  await knex.schema.alterTable('leave_requests', (t) => {
    t.dropColumn('offered_start_date');
    t.dropColumn('offered_end_date');
    t.dropColumn('offered_start_portion');
    t.dropColumn('offered_end_portion');
    t.dropColumn('offered_chargeable_days');
  });
  await knex.raw(`ALTER TABLE leave_requests MODIFY status ENUM(${list(STATES)}) NOT NULL DEFAULT 'DRAFT'`);
  // approval_actions is append-only, so TRANSFER and ACCEPT rows already written stay; the
  // column keeps those values rather than failing the rollback.
}
