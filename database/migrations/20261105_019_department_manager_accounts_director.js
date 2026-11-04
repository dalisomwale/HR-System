/**
 * Project owner, 5 Nov 2026 (D88):
 * - Department Manager: manages everyone in their own department, as if they all reported to
 *   them (manager-stage approvals, team pages, reports).
 * - Accounts Director: a director, like the Executive and Managing Directors: sees leave and
 *   staff across the whole Altus Group and every report, read only.
 */
const ROLES = [
  {
    code: 'DEPARTMENT_MANAGER',
    name: 'Department Manager',
    description: 'Approves leave and sees the team pages and reports for everyone in their own department.',
  },
  {
    code: 'ACCOUNTS_DIRECTOR',
    name: 'Accounts Director',
    description: 'Sees leave and staff across the whole Altus Group and every report. Cannot approve.',
  },
];

export async function up(knex) {
  for (const role of ROLES) {
    if (!(await knex('roles').where({ code: role.code }).first('id'))) await knex('roles').insert(role);
  }
}

export async function down(knex) {
  const ids = await knex('roles')
    .whereIn(
      'code',
      ROLES.map((r) => r.code),
    )
    .pluck('id');
  if (ids.length) {
    await knex('employee_roles').whereIn('role_id', ids).del();
    await knex('roles').whereIn('id', ids).del();
  }
}
