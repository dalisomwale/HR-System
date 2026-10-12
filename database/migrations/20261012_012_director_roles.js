/**
 * Project owner, 12 Oct 2026:
 * - "HR Administrator" is renamed "System Administrator". The code HR_ADMIN is unchanged, so
 *   existing grants keep working.
 * - Two director roles: Executive Director and Managing Director. Directors see leave across
 *   the whole group (overview, request details and every report) but cannot approve, change
 *   balances or change settings. Their own leave follows the normal manager and HR route.
 */
const DIRECTORS = [
  {
    code: 'EXECUTIVE_DIRECTOR',
    name: 'Executive Director',
    description: 'Sees leave across the whole group: overview, requests and every report. Cannot approve.',
  },
  {
    code: 'MANAGING_DIRECTOR',
    name: 'Managing Director',
    description: 'Sees leave across the whole group: overview, requests and every report. Cannot approve.',
  },
];

export async function up(knex) {
  await knex('roles').where({ code: 'HR_ADMIN' }).update({
    name: 'System Administrator',
    description:
      'Every right in the system: employee records, roles, leave types, calendars and settings, plus HR Officer rights.',
  });
  await knex('roles').insert(DIRECTORS);
}

export async function down(knex) {
  const ids = await knex('roles')
    .whereIn(
      'code',
      DIRECTORS.map((d) => d.code),
    )
    .pluck('id');
  if (ids.length) {
    await knex('employee_roles').whereIn('role_id', ids).del();
    await knex('roles').whereIn('id', ids).del();
  }
  await knex('roles').where({ code: 'HR_ADMIN' }).update({
    name: 'HR Administrator',
    description:
      'Employee records, identity mapping, roles, leave types, policies, calendars and system settings.',
  });
}
