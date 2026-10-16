/**
 * Personal details the employee keeps up to date themselves on My profile (project owner,
 * 16 Oct 2026; D48). HR sees them on the employee record. All optional.
 */
const COLUMNS = [
  ['mobile_phone', 30],
  ['personal_email', 254],
  ['home_address', 500],
  ['emergency_contact_name', 160],
  ['emergency_contact_relationship', 60],
  ['emergency_contact_phone', 30],
];

export async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    for (const [name, len] of COLUMNS) t.string(name, len).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('employees', (t) => {
    for (const [name] of COLUMNS) t.dropColumn(name);
  });
}
