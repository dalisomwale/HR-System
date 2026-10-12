/**
 * Sensitive requests (project owner, 12 Oct 2026; D44). The employee can mark a request as
 * sensitive when applying. It then goes straight to HR instead of the manager, and its reason
 * and documents are visible only to the employee and HR.
 */
export async function up(knex) {
  await knex.schema.alterTable('leave_requests', (t) => {
    t.boolean('is_sensitive').notNullable().defaultTo(false).after('reason');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('leave_requests', (t) => {
    t.dropColumn('is_sensitive');
  });
}
