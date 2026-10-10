/**
 * Leave requests, per-day breakdown, change requests (amend/cancel approved leave),
 * approval history and supporting documents.
 */

const REQUEST_STATES = [
  'DRAFT',
  'PENDING_MANAGER_APPROVAL',
  'PENDING_HR_APPROVAL',
  'RETURNED_FOR_CORRECTION',
  'APPROVED',
  'REJECTED_BY_MANAGER',
  'REJECTED_BY_HR',
  'WITHDRAWN',
  'CANCELLED',
];

const CHANGE_STATES = [
  'PENDING_MANAGER_APPROVAL',
  'PENDING_HR_APPROVAL',
  'APPROVED',
  'REJECTED_BY_MANAGER',
  'REJECTED_BY_HR',
  'WITHDRAWN',
];

export async function up(knex) {
  await knex.schema.createTable('leave_requests', (t) => {
    t.increments('id').primary();
    // Human-readable reference, assigned on first submission (e.g. LR-2026-000042).
    t.string('reference', 20).nullable().unique();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    t.integer('leave_type_id').unsigned().notNullable().references('id').inTable('leave_types');
    t.integer('policy_version_id').unsigned().notNullable().references('id').inTable('leave_policy_versions');
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    // Half-day markers: the first day may start in the afternoon, the last day may end at midday.
    t.enu('start_portion', ['FULL', 'PM_ONLY']).notNullable().defaultTo('FULL');
    t.enu('end_portion', ['FULL', 'AM_ONLY']).notNullable().defaultTo('FULL');
    t.decimal('chargeable_days', 6, 2).notNullable().defaultTo(0);
    t.smallint('calendar_days').unsigned().notNullable().defaultTo(0);
    t.text('reason').nullable();
    t.text('handover_notes').nullable();
    t.integer('handover_contact_id').unsigned().nullable().references('id').inTable('employees');
    t.text('notice_shortfall_reason').nullable();
    t.enu('status', REQUEST_STATES).notNullable().defaultTo('DRAFT');
    // Manager resolved at submission time; null when the employee has no line manager (decision D3).
    t.integer('assigned_manager_id').unsigned().nullable().references('id').inTable('employees');
    t.boolean('routed_without_manager').notNullable().defaultTo(false);
    t.boolean('is_overdue').notNullable().defaultTo(false);
    t.timestamp('submitted_at').nullable();
    t.timestamp('manager_decided_at').nullable();
    t.timestamp('hr_decided_at').nullable();
    // Optimistic concurrency: incremented on every state change.
    t.integer('version').unsigned().notNullable().defaultTo(1);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    t.index(['employee_id', 'status']);
    t.index(['status', 'submitted_at']);
    t.index(['assigned_manager_id', 'status']);
    t.index(['start_date', 'end_date']);
    t.index(['leave_type_id', 'status']);
  });
  await knex.raw('ALTER TABLE leave_requests ADD CONSTRAINT chk_lr_dates CHECK (end_date >= start_date)');
  await knex.raw('ALTER TABLE leave_requests ADD CONSTRAINT chk_lr_days CHECK (chargeable_days >= 0)');

  await knex.schema.createTable('leave_request_days', (t) => {
    t.integer('leave_request_id').unsigned().notNullable().references('id').inTable('leave_requests');
    t.date('leave_date').notNullable();
    // Fraction of the day charged: 0, 0.5 or 1.
    t.decimal('charged', 3, 2).notNullable();
    t.enu('exclusion_reason', ['NON_WORKING_DAY', 'PUBLIC_HOLIDAY']).nullable();
    t.integer('public_holiday_id').unsigned().nullable().references('id').inTable('public_holidays');
    t.primary(['leave_request_id', 'leave_date']);
    t.index(['leave_date']);
  });
  await knex.raw(
    'ALTER TABLE leave_request_days ADD CONSTRAINT chk_lrd_charged CHECK (charged IN (0, 0.5, 1))',
  );

  await knex.schema.createTable('change_requests', (t) => {
    t.increments('id').primary();
    t.string('reference', 20).nullable().unique();
    t.integer('leave_request_id').unsigned().notNullable().references('id').inTable('leave_requests');
    t.enu('change_type', ['CANCEL', 'AMEND']).notNullable();
    t.date('proposed_start_date').nullable();
    t.date('proposed_end_date').nullable();
    t.enu('proposed_start_portion', ['FULL', 'PM_ONLY']).nullable();
    t.enu('proposed_end_portion', ['FULL', 'AM_ONLY']).nullable();
    t.decimal('proposed_chargeable_days', 6, 2).nullable();
    // Days reversed to the balance on approval (full or untaken portion).
    t.decimal('days_to_reverse', 6, 2).nullable();
    t.text('reason').notNullable();
    t.enu('status', CHANGE_STATES).notNullable().defaultTo('PENDING_MANAGER_APPROVAL');
    t.integer('requested_by').unsigned().notNullable().references('id').inTable('employees');
    t.integer('assigned_manager_id').unsigned().nullable().references('id').inTable('employees');
    t.boolean('routed_without_manager').notNullable().defaultTo(false);
    t.integer('version').unsigned().notNullable().defaultTo(1);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.index(['leave_request_id', 'status']);
    t.index(['assigned_manager_id', 'status']);
    t.index(['status']);
  });
  await knex.raw(
    "ALTER TABLE change_requests ADD CONSTRAINT chk_cr_amend CHECK (change_type <> 'AMEND' OR (proposed_start_date IS NOT NULL AND proposed_end_date IS NOT NULL AND proposed_end_date >= proposed_start_date))",
  );

  await knex.schema.createTable('approval_actions', (t) => {
    t.bigIncrements('id').primary();
    t.integer('leave_request_id').unsigned().nullable().references('id').inTable('leave_requests');
    t.integer('change_request_id').unsigned().nullable().references('id').inTable('change_requests');
    t.enu('stage', ['EMPLOYEE', 'MANAGER', 'HR', 'SYSTEM']).notNullable();
    t.enu('action', [
      'SUBMIT',
      'RESUBMIT',
      'APPROVE',
      'REJECT',
      'RETURN',
      'WITHDRAW',
      'ROUTE',
      'ESCALATE',
    ]).notNullable();
    t.integer('actor_id').unsigned().nullable().references('id').inTable('employees');
    t.enu('acting_as', ['EMPLOYEE', 'MANAGER', 'DELEGATE', 'HR_OFFICER', 'SYSTEM']).notNullable();
    // When a delegate acts, the manager they act for.
    t.integer('on_behalf_of_id').unsigned().nullable().references('id').inTable('employees');
    t.string('from_status', 40).nullable();
    t.string('to_status', 40).notNullable();
    t.text('comment').nullable();
    t.timestamp('created_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.index(['leave_request_id', 'created_at']);
    t.index(['change_request_id', 'created_at']);
    t.index(['actor_id', 'created_at']);
  });
  await knex.raw(
    'ALTER TABLE approval_actions ADD CONSTRAINT chk_aa_target CHECK ((leave_request_id IS NULL) <> (change_request_id IS NULL))',
  );

  await knex.schema.createTable('documents', (t) => {
    t.increments('id').primary();
    t.integer('leave_request_id').unsigned().notNullable().references('id').inTable('leave_requests');
    t.integer('uploaded_by').unsigned().notNullable().references('id').inTable('employees');
    t.string('original_name', 255).notNullable();
    // Random file name on disk; never derived from user input.
    t.string('stored_name', 80).notNullable().unique();
    t.enu('mime_type', ['application/pdf', 'image/jpeg', 'image/png']).notNullable();
    t.integer('size_bytes').unsigned().notNullable();
    t.specificType('sha256', 'CHAR(64)').notNullable();
    t.boolean('is_medical').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at').nullable();
    t.integer('deleted_by').unsigned().nullable().references('id').inTable('employees');
    t.index(['leave_request_id']);
  });
}

export async function down(knex) {
  for (const table of [
    'documents',
    'approval_actions',
    'change_requests',
    'leave_request_days',
    'leave_requests',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
