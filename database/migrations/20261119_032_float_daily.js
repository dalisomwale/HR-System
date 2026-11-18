/**
 * Project owner, 19 Nov 2026 (D118): AMS reports daily, not weekly, and has no commission set-up.
 *
 *   - The daily report per branch: deposits, withdrawals, float transfers and cash collections
 *     (count and amount), daytime and evening transactions, customers turned down and walk-ins,
 *     cash and float as per the phones at sign-out, the day's commission (as shown on the phone)
 *     and the month to date. A manager signs off each day, which locks it.
 *   - Cash collections ("cash retired to finance") are recorded by the branch and confirmed by a
 *     manager; customers turned down are counted with one tap.
 *   - Staff are paid through payroll: no commission tables or commission received. The
 *     commission the networks credit is typed from the phone at sign-out.
 */
export async function up(knex) {
  await knex.schema.dropTableIfExists('float_commission_rules');
  await knex.schema.dropTableIfExists('float_commission_receipts');
  await knex.schema.dropTableIfExists('float_weeks');

  await knex.schema.alterTable('float_settings', (t) => {
    t.dropColumn('week_end_day');
    t.string('day_start', 5).notNullable().defaultTo('07:30');
    t.string('evening_from', 5).notNullable().defaultTo('17:00');
  });
  await knex.schema.alterTable('float_counts', (t) => {
    t.decimal('commission', 14, 2).nullable();
  });
  await knex.raw(
    "ALTER TABLE float_movements MODIFY kind ENUM('TOPUP','TRANSFER','COLLECTION') NOT NULL",
  );
  await knex.raw(
    "ALTER TABLE float_entries MODIFY entry_type ENUM('OPENING','DEPOSIT','WITHDRAWAL','TOPUP','TRANSFER_IN','TRANSFER_OUT','REVERSAL','VARIANCE','RECOVERY','COLLECTION') NOT NULL",
  );
  await knex.schema.alterTable('float_movements', (t) => {
    t.string('collected_by', 150).nullable();
  });

  await knex.schema.createTable('float_turned_down', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.enu('reason', ['NO_FLOAT', 'NO_CASH', 'NETWORK_DOWN', 'OTHER']).notNullable();
    t.enu('network', ['AIRTEL', 'MTN']).nullable();
    t.date('business_date').notNullable();
    t.integer('recorded_by').unsigned().notNullable().references('id').inTable('employees');
    t.timestamp('recorded_at').notNullable().defaultTo(knex.fn.now());
    t.index(['branch_id', 'business_date']);
  });

  await knex.schema.createTable('float_days', (t) => {
    t.date('business_date').primary();
    t.integer('signed_by').unsigned().notNullable().references('id').inTable('employees');
    t.datetime('signed_at').notNullable();
    t.string('comment', 1000).nullable();
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('float_days');
  await knex.schema.dropTableIfExists('float_turned_down');
  await knex.schema.alterTable('float_movements', (t) => t.dropColumn('collected_by'));
  await knex.raw(
    "ALTER TABLE float_entries MODIFY entry_type ENUM('OPENING','DEPOSIT','WITHDRAWAL','TOPUP','TRANSFER_IN','TRANSFER_OUT','REVERSAL','VARIANCE','RECOVERY') NOT NULL",
  );
  await knex.raw("ALTER TABLE float_movements MODIFY kind ENUM('TOPUP','TRANSFER') NOT NULL");
  await knex.schema.alterTable('float_counts', (t) => t.dropColumn('commission'));
  await knex.schema.alterTable('float_settings', (t) => {
    t.dropColumn('day_start');
    t.dropColumn('evening_from');
    t.enu('week_end_day', ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']).notNullable().defaultTo('FRI');
  });
  await knex.schema.createTable('float_commission_rules', (t) => {
    t.increments('id').unsigned().primary();
    t.enu('network', ['AIRTEL', 'MTN']).notNullable();
    t.enu('kind', ['DEPOSIT', 'WITHDRAWAL']).notNullable();
    t.decimal('min_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('max_amount', 14, 2).nullable();
    t.enu('fee_type', ['FLAT', 'PERCENT']).notNullable();
    t.decimal('value', 12, 4).notNullable();
  });
  await knex.schema.createTable('float_commission_receipts', (t) => {
    t.increments('id').unsigned().primary();
    t.enu('network', ['AIRTEL', 'MTN']).notNullable();
    t.string('month', 7).notNullable();
    t.integer('branch_id').unsigned().nullable().references('id').inTable('stock_branches');
    t.decimal('amount', 14, 2).notNullable();
    t.date('received_on').notNullable();
    t.string('notes', 500).nullable();
    t.integer('recorded_by').unsigned().notNullable().references('id').inTable('employees');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('float_weeks', (t) => {
    t.increments('id').unsigned().primary();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable().unique();
    t.json('data').notNullable();
    t.enu('status', ['GENERATED', 'SIGNED_OFF']).notNullable().defaultTo('GENERATED');
    t.integer('signed_by').unsigned().nullable().references('id').inTable('employees');
    t.datetime('signed_at').nullable();
    t.string('sign_comment', 1000).nullable();
    t.timestamp('generated_at').notNullable().defaultTo(knex.fn.now());
  });
}
