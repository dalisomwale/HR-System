/**
 * Wording only: the system says "manager" rather than "line manager" (project owner, 11 Oct 2026).
 * Updates the stored setting description; no data or behaviour changes.
 */
export async function up(knex) {
  await knex('system_settings')
    .where({ setting_key: 'no_manager_routing' })
    .update({ description: 'Routing for employees with no manager. Decision D3.' });
}

export async function down(knex) {
  await knex('system_settings')
    .where({ setting_key: 'no_manager_routing' })
    .update({ description: 'Routing for employees with no line manager. Decision D3.' });
}
