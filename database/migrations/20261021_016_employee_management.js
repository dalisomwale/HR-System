/**
 * Employee management (phase 2, project owner 21 Oct 2026; D52). The employee record becomes the
 * central record every HR module reads: it gains the employment type, contract end, probation and
 * pay grade, and a history of every change.
 *
 * employee_history is append-only, like the ledger and the audit log: each row is one field that
 * changed, with the old and new value as shown to people (names, not ids), so the history still
 * reads correctly after a department or manager is renamed.
 */

export async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.enu('employment_type', ['PERMANENT', 'FIXED_TERM', 'TEMPORARY']).nullable().after('job_title');
    t.date('contract_end_date').nullable().after('employment_end_date');
    t.date('probation_end_date').nullable().after('contract_end_date');
    t.enu('probation_status', ['ON_PROBATION', 'CONFIRMED', 'EXTENDED']).nullable().after('probation_end_date');
    // Seen only by HR and directors.
    t.string('pay_grade', 20).nullable().after('probation_status');
    t.index(['status', 'contract_end_date']);
    t.index(['status', 'probation_end_date']);
  });

  await knex.schema.createTable('employee_history', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    t.enu('event', ['CREATED', 'UPDATED', 'DEACTIVATED', 'REACTIVATED']).notNullable();
    // The field that changed, by its API name (jobTitle, departmentId…); null for whole-record events.
    t.string('field', 40).nullable();
    t.string('old_value', 500).nullable();
    t.string('new_value', 500).nullable();
    t.string('reason', 500).nullable();
    t.integer('actor_id').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['employee_id', 'id']);
    t.index(['created_at']);
  });

  try {
    await knex.raw(`
      CREATE TRIGGER trg_employee_history_no_update BEFORE UPDATE ON employee_history
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'employee_history is append-only'
    `);
    await knex.raw(`
      CREATE TRIGGER trg_employee_history_no_delete BEFORE DELETE ON employee_history
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'employee_history is append-only'
    `);
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
  await knex.raw('DROP TRIGGER IF EXISTS trg_employee_history_no_update');
  await knex.raw('DROP TRIGGER IF EXISTS trg_employee_history_no_delete');
  await knex.schema.dropTableIfExists('employee_history');
  await knex.schema.alterTable('employees', (t) => {
    t.dropIndex(['status', 'contract_end_date']);
    t.dropIndex(['status', 'probation_end_date']);
    t.dropColumn('employment_type');
    t.dropColumn('contract_end_date');
    t.dropColumn('probation_end_date');
    t.dropColumn('probation_status');
    t.dropColumn('pay_grade');
  });
}
