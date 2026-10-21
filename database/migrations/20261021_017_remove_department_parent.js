/**
 * Departments no longer sit under other departments ("Part of"): the project owner removed it
 * throughout the system (21 Oct 2026; D58). The column and its foreign key go.
 */

export async function up(knex) {
  await knex.schema.alterTable('departments', (t) => {
    t.dropForeign(['parent_id']);
    t.dropColumn('parent_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('departments', (t) => {
    t.integer('parent_id').unsigned().nullable().references('id').inTable('departments');
  });
}
