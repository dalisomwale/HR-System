/**
 * A Microsoft account is linked to an employee automatically on first sign-in when its email
 * matches the employee's work email (31 Oct 2026; D73). Those links are recorded as EMAIL.
 */

export async function up(knex) {
  await knex.raw(
    "ALTER TABLE identity_links MODIFY linked_via ENUM('ADMIN','BOOTSTRAP','IMPORT','EMAIL') NOT NULL",
  );
}

export async function down(knex) {
  await knex('identity_links').where({ linked_via: 'EMAIL' }).update({ linked_via: 'ADMIN' });
  await knex.raw("ALTER TABLE identity_links MODIFY linked_via ENUM('ADMIN','BOOTSTRAP','IMPORT') NOT NULL");
}
