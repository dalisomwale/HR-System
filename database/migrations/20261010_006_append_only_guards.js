/**
 * Database-level protection for append-only tables. The application never updates or deletes
 * these rows; these triggers make sure nothing else does either, including a mistaken query.
 * Corrections to the ledger are made with reversing entries.
 *
 * Production should additionally grant the application user only SELECT and INSERT on these
 * tables (see docs/deployment.md).
 */

const APPEND_ONLY = ['balance_ledger', 'audit_log', 'approval_actions'];

export async function up(knex) {
  try {
    for (const table of APPEND_ONLY) {
      await knex.raw(`
        CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
        FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} is append-only'
      `);
      await knex.raw(`
        CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
        FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} is append-only'
      `);
    }
  } catch (err) {
    if (err.errno === 1419) {
      throw new Error(
        'Creating the append-only triggers needs one of: (a) the MySQL setting ' +
          'log_bin_trust_function_creators=1, or (b) running migrations as a user with the SUPER ' +
          'privilege via MIGRATION_DB_USER / MIGRATION_DB_PASSWORD. See docs/setup.md.',
        { cause: err },
      );
    }
    throw err;
  }
}

export async function down(knex) {
  for (const table of APPEND_ONLY) {
    await knex.raw(`DROP TRIGGER IF EXISTS trg_${table}_no_update`);
    await knex.raw(`DROP TRIGGER IF EXISTS trg_${table}_no_delete`);
  }
}
