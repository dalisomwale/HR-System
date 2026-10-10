/**
 * Record which employee owns each session, so deactivating an employee or removing their
 * identity link can revoke their sessions immediately.
 */
export async function up(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.integer('employee_id').unsigned().nullable().after('session_id');
    t.index(['employee_id']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('sessions', (t) => {
    t.dropIndex(['employee_id']);
    t.dropColumn('employee_id');
  });
}
