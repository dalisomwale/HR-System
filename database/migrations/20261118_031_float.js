/**
 * Project owner, 18 Nov 2026 (D117): Cash and float for Altus Money Solutions (AMS), inside the
 * Inventory system. AMS's "stock" is money: each AMS branch holds Cash (Kwacha), Airtel Money
 * float and MTN MoMo float.
 *
 *   float_settings          one row: the AMS company, trading days, the day the week ends, the
 *                           report time, and the limits
 *   float_accounts          a branch's Cash, Airtel and MTN balances (kept with the ledger)
 *   float_transactions      a customer deposit or withdrawal: one tap moves both sides
 *   float_movements         top-ups and transfers between branches and accounts, approved by a manager
 *   float_entries           the ledger: every change to an account's balance; never edited
 *   float_counts            day closes and shift handovers: what was counted against what was expected
 *   float_count_lines       one line per account in a count
 *   float_variances         surpluses and deficits found by counts, and how a manager resolved them
 *   float_commission_rules  what Airtel and MTN pay per transaction: flat or percentage, by amount band
 *   float_commission_receipts  commission actually paid by the networks, per month
 *   float_weeks             the weekly report: generated at the set time, signed off, then locked
 *
 * Roles (D108): "AMS Branch Staff", "AMS Manager" and "AMS HR" are added to the Inventory system's
 * roles, and the inventory Director role gains the AMS director view and approvals.
 */
const KINDS = ['CASH', 'AIRTEL', 'MTN'];
const emp = (t, name, nullable = true) => {
  const c = t.integer(name).unsigned().references('id').inTable('employees');
  return nullable ? c.nullable() : c.notNullable();
};
const money = (t, name) => t.decimal(name, 14, 2);

export async function up(knex) {
  await knex.schema.createTable('float_settings', (t) => {
    t.integer('id').unsigned().primary();
    t.integer('company_id').unsigned().nullable().references('id').inTable('companies');
    t.string('working_days', 40).notNullable().defaultTo('MON,TUE,WED,THU,FRI,SAT');
    t.enu('week_end_day', ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']).notNullable().defaultTo('FRI');
    t.string('report_time', 5).notNullable().defaultTo('17:30');
    t.string('close_reminder_time', 5).notNullable().defaultTo('18:00');
    money(t, 'cash_tolerance').notNullable().defaultTo(5);
    money(t, 'large_amount').notNullable().defaultTo(10000);
    money(t, 'director_limit').notNullable().defaultTo(5000);
    t.integer('duplicate_minutes').unsigned().notNullable().defaultTo(2);
    emp(t, 'updated_by');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('float_accounts', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.enu('kind', KINDS).notNullable();
    money(t, 'balance').notNullable().defaultTo(0);
    money(t, 'min_balance').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['branch_id', 'kind']);
  });

  await knex.schema.createTable('float_transactions', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.enu('network', ['AIRTEL', 'MTN']).notNullable();
    t.enu('kind', ['DEPOSIT', 'WITHDRAWAL']).notNullable();
    money(t, 'amount').notNullable();
    t.string('reference', 60).nullable();
    money(t, 'commission').notNullable().defaultTo(0);
    t.date('business_date').notNullable();
    emp(t, 'recorded_by', false);
    t.timestamp('recorded_at').notNullable().defaultTo(knex.fn.now());
    t.boolean('is_large').notNullable().defaultTo(false);
    emp(t, 'large_reviewed_by');
    t.datetime('large_reviewed_at').nullable();
    t.enu('status', ['POSTED', 'REVERSAL_PENDING', 'REVERSED']).notNullable().defaultTo('POSTED');
    t.string('reversal_reason', 500).nullable();
    emp(t, 'reversal_requested_by');
    t.datetime('reversal_requested_at').nullable();
    emp(t, 'reversal_decided_by');
    t.datetime('reversal_decided_at').nullable();
    t.index(['branch_id', 'business_date']);
  });

  await knex.schema.createTable('float_movements', (t) => {
    t.increments('id').unsigned().primary();
    t.enu('kind', ['TOPUP', 'TRANSFER']).notNullable();
    t.integer('from_branch_id').unsigned().nullable().references('id').inTable('stock_branches');
    t.enu('from_account', KINDS).nullable();
    t.integer('to_branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.enu('to_account', KINDS).notNullable();
    money(t, 'amount').notNullable();
    t.string('reason', 500).nullable();
    t.enu('status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).notNullable().defaultTo('PENDING');
    emp(t, 'requested_by', false);
    t.timestamp('requested_at').notNullable().defaultTo(knex.fn.now());
    emp(t, 'decided_by');
    t.datetime('decided_at').nullable();
    t.string('decision_comment', 500).nullable();
    t.date('business_date').nullable(); // the day it was posted
    t.index(['status']);
  });

  await knex.schema.createTable('float_entries', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('account_id').unsigned().notNullable().references('id').inTable('float_accounts');
    t.integer('branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.enu('entry_type', [
      'OPENING',
      'DEPOSIT',
      'WITHDRAWAL',
      'TOPUP',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'REVERSAL',
      'VARIANCE',
      'RECOVERY',
    ]).notNullable();
    money(t, 'amount').notNullable(); // signed
    money(t, 'balance_after').notNullable();
    t.integer('transaction_id').unsigned().nullable().references('id').inTable('float_transactions');
    t.integer('movement_id').unsigned().nullable().references('id').inTable('float_movements');
    t.integer('variance_id').unsigned().nullable();
    t.date('business_date').notNullable();
    emp(t, 'created_by');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['branch_id', 'business_date']);
    t.index(['account_id', 'business_date']);
  });

  await knex.schema.createTable('float_counts', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.enu('kind', ['CLOSE', 'HANDOVER']).notNullable();
    t.date('business_date').notNullable();
    emp(t, 'counted_by', false); // the person handing over, or closing
    emp(t, 'handed_to');
    t.json('denominations').nullable();
    t.string('notes', 500).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['branch_id', 'business_date']);
  });
  await knex.schema.createTable('float_count_lines', (t) => {
    t.integer('count_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('float_counts')
      .onDelete('CASCADE');
    t.integer('account_id').unsigned().notNullable().references('id').inTable('float_accounts');
    money(t, 'expected').notNullable();
    money(t, 'counted').notNullable();
    money(t, 'difference').notNullable();
    t.primary(['count_id', 'account_id']);
  });

  await knex.schema.createTable('float_variances', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('count_id').unsigned().notNullable().references('id').inTable('float_counts');
    t.integer('branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.integer('account_id').unsigned().notNullable().references('id').inTable('float_accounts');
    emp(t, 'employee_id'); // on duty
    t.date('business_date').notNullable();
    money(t, 'amount').notNullable(); // + surplus, − deficit
    t.enu('status', ['OPEN', 'PENDING_DIRECTOR', 'EXPLAINED', 'RECOVERED', 'WRITTEN_OFF'])
      .notNullable()
      .defaultTo('OPEN');
    t.enu('resolution', ['EXPLAINED', 'RECOVERED', 'WRITTEN_OFF']).nullable();
    t.string('comment', 1000).nullable();
    emp(t, 'resolved_by');
    t.datetime('resolved_at').nullable();
    emp(t, 'director_by');
    t.datetime('director_at').nullable();
    t.index(['status']);
    t.index(['employee_id']);
  });

  await knex.schema.createTable('float_commission_rules', (t) => {
    t.increments('id').unsigned().primary();
    t.enu('network', ['AIRTEL', 'MTN']).notNullable();
    t.enu('kind', ['DEPOSIT', 'WITHDRAWAL']).notNullable();
    money(t, 'min_amount').notNullable().defaultTo(0);
    money(t, 'max_amount').nullable();
    t.enu('fee_type', ['FLAT', 'PERCENT']).notNullable();
    t.decimal('value', 12, 4).notNullable();
  });
  await knex.schema.createTable('float_commission_receipts', (t) => {
    t.increments('id').unsigned().primary();
    t.enu('network', ['AIRTEL', 'MTN']).notNullable();
    t.string('month', 7).notNullable(); // YYYY-MM
    t.integer('branch_id').unsigned().nullable().references('id').inTable('stock_branches');
    money(t, 'amount').notNullable();
    t.date('received_on').notNullable();
    t.string('notes', 500).nullable();
    emp(t, 'recorded_by', false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('float_weeks', (t) => {
    t.increments('id').unsigned().primary();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable().unique();
    t.json('data').notNullable();
    t.enu('status', ['GENERATED', 'SIGNED_OFF']).notNullable().defaultTo('GENERATED');
    emp(t, 'signed_by');
    t.datetime('signed_at').nullable();
    t.string('sign_comment', 1000).nullable();
    t.timestamp('generated_at').notNullable().defaultTo(knex.fn.now());
  });

  // The AMS company, if it is already there by name.
  const ams = await knex('companies')
    .whereRaw('LOWER(name) LIKE ?', ['%money solutions%'])
    .orWhereRaw('UPPER(code) = ?', ['AMS'])
    .first('id');
  await knex('float_settings').insert({ id: 1, company_id: ams?.id ?? null });

  // Roles in the Inventory system.
  const roles = [
    [
      'AMS Branch Staff',
      'Records deposits and withdrawals at their branch, closes the day, asks for top-ups',
      ['float.record'],
    ],
    [
      'AMS Manager',
      'Every AMS branch: approves top-ups, transfers and reversals, resolves surpluses and deficits, signs off the weekly report',
      ['float.record', 'float.view_all', 'float.approve'],
    ],
    ['AMS HR', 'Sees the deficits that name a member of staff, for follow-up', ['float.shortages']],
  ];
  for (const [name, description, perms] of roles) {
    const [id] = await knex('access_roles').insert({
      module: 'inventory',
      name,
      description,
      is_system: false,
    });
    await knex('access_role_permissions').insert(perms.map((permission) => ({ role_id: id, permission })));
  }
  const director = await knex('access_roles').where({ module: 'inventory', name: 'Director' }).first('id');
  if (director) {
    await knex('access_role_permissions').insert(
      ['float.view_all', 'float.director'].map((permission) => ({ role_id: director.id, permission })),
    );
  }
}

export async function down(knex) {
  const ids = await knex('access_roles')
    .where({ module: 'inventory' })
    .whereIn('name', ['AMS Branch Staff', 'AMS Manager', 'AMS HR'])
    .pluck('id');
  if (ids.length) {
    await knex('access_users').whereIn('role_id', ids).del();
    await knex('access_roles').whereIn('id', ids).del();
  }
  await knex('access_role_permissions').where('permission', 'like', 'float.%').del();
  for (const t of [
    'float_weeks',
    'float_commission_receipts',
    'float_commission_rules',
    'float_variances',
    'float_count_lines',
    'float_counts',
    'float_entries',
    'float_movements',
    'float_transactions',
    'float_accounts',
    'float_settings',
  ]) {
    await knex.schema.dropTableIfExists(t);
  }
}
