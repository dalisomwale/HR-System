/**
 * Balance ledger (append-only), balance cache and scheduled job runs.
 */

export async function up(knex) {
  await knex.schema.createTable('balance_ledger', (t) => {
    t.bigIncrements('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    t.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types');
    t.smallint('leave_year').unsigned().notNullable();
    // Positive adds to the balance, negative deducts.
    t.decimal('amount', 7, 2).notNullable();
    t.enu('entry_type', [
      'OPENING',
      'ENTITLEMENT',
      'ACCRUAL',
      'DEDUCTION',
      'REVERSAL',
      'CARRY_FORWARD_IN',
      'CARRY_FORWARD_EXPIRY',
      'ADJUSTMENT',
      'RESERVATION',
      'RESERVATION_RELEASE',
    ]).notNullable();
    t.enu('source_type', [
      'OPENING',
      'LEAVE_REQUEST',
      'CHANGE_REQUEST',
      'ACCRUAL_RUN',
      'ADJUSTMENT',
      'CARRY_FORWARD_RUN',
      'EXPIRY_RUN',
    ]).notNullable();
    t.bigInteger('source_id').unsigned().nullable();
    // Idempotency key for periodic jobs, e.g. '2026-03' for a monthly accrual.
    t.string('period_key', 20).nullable();
    t.bigInteger('reverses_entry_id').unsigned().nullable().references('id').inTable('balance_ledger');
    t.string('reason', 500).nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('created_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));

    // A request or change request posts each entry type at most once per leave type and year.
    // This is what guarantees "deducted exactly once" even under concurrent approvals.
    t.unique(['source_type', 'source_id', 'entry_type', 'leave_type_id', 'leave_year'], {
      indexName: 'uq_ledger_source_once',
    });
    // Periodic jobs post at most once per employee, leave type and period.
    t.unique(['employee_id', 'leave_type_id', 'entry_type', 'period_key'], {
      indexName: 'uq_ledger_period_once',
    });
    // An entry can be reversed at most once.
    t.unique(['reverses_entry_id'], { indexName: 'uq_ledger_reversed_once' });
    t.index(['employee_id', 'leave_type_id', 'leave_year'], 'ix_ledger_balance');
  });
  await knex.raw('ALTER TABLE balance_ledger ADD CONSTRAINT chk_ledger_nonzero CHECK (amount <> 0)');
  await knex.raw(
    "ALTER TABLE balance_ledger ADD CONSTRAINT chk_ledger_reason CHECK (entry_type NOT IN ('ADJUSTMENT', 'OPENING') OR (reason IS NOT NULL AND CHAR_LENGTH(TRIM(reason)) > 0))",
  );

  await knex.schema.createTable('balance_cache', (t) => {
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    t.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types');
    t.smallint('leave_year').unsigned().notNullable();
    t.decimal('balance', 7, 2).notNullable().defaultTo(0);
    t.decimal('reserved', 7, 2).notNullable().defaultTo(0);
    t.bigInteger('last_ledger_id').unsigned().nullable();
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.primary(['employee_id', 'leave_type_id', 'leave_year']);
  });

  await knex.schema.createTable('scheduled_job_runs', (t) => {
    t.bigIncrements('id').primary();
    t.string('job_name', 60).notNullable();
    t.string('period_key', 20).notNullable();
    t.enu('status', ['RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED']).notNullable();
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at').nullable();
    t.json('summary').nullable();
    t.text('error').nullable();
    t.unique(['job_name', 'period_key']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('scheduled_job_runs');
  await knex.schema.dropTableIfExists('balance_cache');
  await knex.schema.dropTableIfExists('balance_ledger');
}
