/**
 * Leave configuration: leave types, versioned policies and public holidays.
 * No values are inserted here. Policy values come from docs/policy-extraction.md once the
 * policy document has been reviewed and confirmed by HR.
 */

export async function up(knex) {
  await knex.schema.createTable('leave_types', (t) => {
    t.increments('id').primary();
    t.string('code', 30).notNullable().unique();
    t.string('name', 80).notNullable().unique();
    t.string('description', 500).nullable();
    // Confidential types (e.g. sick leave) hide documents from managers and the type name from emails.
    t.boolean('is_confidential').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(false);
    t.smallint('display_order').unsigned().notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });

  await knex.schema.createTable('leave_policy_versions', (t) => {
    t.increments('id').primary();
    t.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types');
    t.integer('version_no').unsigned().notNullable();
    t.date('effective_from').notNullable();
    t.date('effective_to').nullable();

    // Classification
    t.boolean('is_paid').notNullable();
    t.enu('day_basis', ['WORKING_DAYS', 'CALENDAR_DAYS']).notNullable();
    t.boolean('consumes_balance').notNullable();
    t.boolean('allow_negative_balance').notNullable().defaultTo(false);

    // Entitlement
    t.decimal('entitlement_days', 6, 2).nullable();
    t.enu('entitlement_period', ['LEAVE_YEAR', 'PER_OCCASION', 'PER_EMPLOYMENT', 'NONE']).notNullable();
    t.boolean('prorate_for_joiners_leavers').notNullable().defaultTo(false);

    // Accrual. Production accrual runs are refused while accrual_confirmed is false.
    t.enu('accrual_method', ['NONE', 'ANNUAL_GRANT', 'FIXED_MONTHLY', 'ENTITLEMENT_DIV_12']).notNullable();
    t.decimal('accrual_monthly_amount', 6, 3).nullable();
    t.enu('accrual_rounding', ['NONE', 'NEAREST_HALF', 'NEAREST_TENTH', 'DOWN_HALF'])
      .notNullable()
      .defaultTo('NONE');
    t.boolean('accrual_confirmed').notNullable().defaultTo(false);

    // Carry-forward
    t.decimal('carry_forward_max_days', 6, 2).nullable();
    t.tinyint('carry_forward_expiry_month').unsigned().nullable();
    t.tinyint('carry_forward_expiry_day').unsigned().nullable();

    // Request rules
    t.boolean('allow_half_day').notNullable().defaultTo(false);
    t.boolean('allow_backdate').notNullable().defaultTo(false);
    t.smallint('backdate_max_days').unsigned().nullable();
    t.smallint('min_notice_days').unsigned().nullable();
    t.enu('notice_enforcement', ['NONE', 'WARN_WITH_REASON', 'BLOCK']).notNullable().defaultTo('NONE');
    t.decimal('max_single_duration_days', 6, 2).nullable();
    t.smallint('min_service_months').unsigned().nullable();
    t.decimal('min_consecutive_days_target', 5, 2).nullable();
    t.boolean('handover_required').notNullable().defaultTo(false);

    // Documents
    t.boolean('document_required').notNullable().defaultTo(false);
    t.string('document_description', 255).nullable();
    t.smallint('document_due_days_after_return').unsigned().nullable();

    // Rules that do not fit the columns above, recorded as structured JSON and validated in code.
    t.json('extra_rules').nullable();

    // Provenance and confirmation
    t.string('source_reference', 255).nullable();
    t.boolean('requires_hr_confirmation').notNullable().defaultTo(true);
    t.integer('confirmed_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('confirmed_at').nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['leave_type_id', 'version_no']);
    t.index(['leave_type_id', 'effective_from']);
  });
  const checks = [
    ['chk_lpv_dates', 'effective_to IS NULL OR effective_to >= effective_from'],
    ['chk_lpv_entitlement', 'entitlement_days IS NULL OR entitlement_days >= 0'],
    ['chk_lpv_cf_max', 'carry_forward_max_days IS NULL OR carry_forward_max_days >= 0'],
    ['chk_lpv_cf_month', 'carry_forward_expiry_month IS NULL OR carry_forward_expiry_month BETWEEN 1 AND 12'],
    ['chk_lpv_cf_day', 'carry_forward_expiry_day IS NULL OR carry_forward_expiry_day BETWEEN 1 AND 31'],
    ['chk_lpv_monthly', "accrual_method <> 'FIXED_MONTHLY' OR accrual_monthly_amount IS NOT NULL"],
    ['chk_lpv_backdate', 'allow_backdate = 1 OR backdate_max_days IS NULL'],
  ];
  for (const [name, expr] of checks) {
    await knex.raw(`ALTER TABLE leave_policy_versions ADD CONSTRAINT ${name} CHECK (${expr})`);
  }

  await knex.schema.createTable('public_holidays', (t) => {
    t.increments('id').primary();
    t.date('holiday_date').notNullable().unique();
    t.string('name', 120).notNullable();
    // A substitute day observed because the original holiday fell on a non-working day (see decision D7).
    t.boolean('is_substitute').notNullable().defaultTo(false);
    t.integer('substitutes_for_id').unsigned().nullable().references('id').inTable('public_holidays');
    t.string('source_note', 255).nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('public_holidays');
  await knex.schema.dropTableIfExists('leave_policy_versions');
  await knex.schema.dropTableIfExists('leave_types');
}
