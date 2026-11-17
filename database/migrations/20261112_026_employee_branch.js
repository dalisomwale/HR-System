/**
 * Project owner, 12 Nov 2026 (D110): an employee's branch is part of their record in Employee
 * management, next to company and department, and every module reads it from there. A branch
 * belongs to one company, so an employee's branch is always one of their company's.
 */
export async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.integer('branch_id')
      .unsigned()
      .nullable()
      .after('department_id')
      .references('id')
      .inTable('stock_branches');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.dropForeign(['branch_id']);
    t.dropColumn('branch_id');
  });
}
