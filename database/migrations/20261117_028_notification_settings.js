/**
 * Project owner, 17 Nov 2026 (D113): Leave management › Admin › Notifications. For each leave
 * notification the System Admin chooses whether it is sent at all (in the system) and whether it
 * is also emailed. Only changes from the defaults are stored; the defaults are in
 * server/src/modules/notifications/catalog.js.
 */
export async function up(knex) {
  await knex.schema.createTable('notification_settings', (t) => {
    t.string('notification_key', 60).primary();
    t.boolean('in_app').notNullable().defaultTo(true);
    t.boolean('email').notNullable().defaultTo(true);
    t.integer('updated_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTable('notification_settings');
}
