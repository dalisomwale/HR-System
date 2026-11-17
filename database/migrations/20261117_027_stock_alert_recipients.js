/**
 * Project owner, 17 Nov 2026 (D112): stock alerts go only to inventory users whose role can
 * receive stock or manage items, or who have the System Admin role, and the System Admin picks
 * which of them get the alerts on Inventory system › Admin › Stock alerts. Everyone who can get
 * them starts with them on.
 */
export async function up(knex) {
  await knex.schema.alterTable('access_users', (t) => {
    t.boolean('stock_alerts').notNullable().defaultTo(true).after('is_active');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('access_users', (t) => {
    t.dropColumn('stock_alerts');
  });
}
