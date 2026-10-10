/**
 * Organisation model: departments, working schedules, employees, Entra identity links,
 * roles and approval delegations.
 */

export async function up(knex) {
  await knex.schema.createTable('departments', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 120).notNullable().unique();
    t.integer('parent_id').unsigned().nullable().references('id').inTable('departments');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });

  await knex.schema.createTable('work_schedules', (t) => {
    t.increments('id').primary();
    t.string('name', 80).notNullable().unique();
    // ISO weekdays: 1 = Monday ... 7 = Sunday. Value is the working fraction of that day (0, 0.5 or 1).
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      t.decimal(`${d}_fraction`, 3, 2).notNullable().defaultTo(0);
    }
    t.boolean('is_company_default').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    await knex.raw(
      `ALTER TABLE work_schedules ADD CONSTRAINT chk_ws_${d} CHECK (${d}_fraction IN (0, 0.5, 1))`,
    );
  }

  await knex.schema.createTable('employees', (t) => {
    t.increments('id').primary();
    t.string('employee_number', 30).notNullable().unique();
    t.string('first_name', 80).notNullable();
    t.string('last_name', 80).notNullable();
    // Display and notification only. Identity is established through identity_links.
    t.string('email', 254).nullable().unique();
    t.string('job_title', 120).nullable();
    t.integer('department_id').unsigned().nullable().references('id').inTable('departments');
    t.integer('line_manager_id').unsigned().nullable().references('id').inTable('employees');
    t.integer('work_schedule_id').unsigned().nullable().references('id').inTable('work_schedules');
    t.date('employment_start_date').notNullable();
    t.date('employment_end_date').nullable();
    t.enu('status', ['ACTIVE', 'INACTIVE']).notNullable().defaultTo('ACTIVE');
    t.timestamp('deactivated_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.index(['line_manager_id', 'status']);
    t.index(['department_id', 'status']);
    t.index(['last_name', 'first_name']);
  });
  await knex.raw(
    'ALTER TABLE employees ADD CONSTRAINT chk_emp_dates CHECK (employment_end_date IS NULL OR employment_end_date >= employment_start_date)',
  );
  // "An employee cannot be their own line manager" cannot be a CHECK constraint because MySQL
  // forbids CHECK constraints that reference an AUTO_INCREMENT column. It is enforced in the
  // employee service (Phase 2), together with reporting-loop detection.

  await knex.schema.createTable('identity_links', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().unique().references('id').inTable('employees');
    // Entra tenant ID (tid) and object ID (oid): immutable identifiers.
    t.specificType('tenant_id', 'CHAR(36)').notNullable();
    t.specificType('object_id', 'CHAR(36)').notNullable();
    t.string('email_at_link', 254).nullable();
    t.integer('linked_by').unsigned().nullable().references('id').inTable('employees');
    t.enu('linked_via', ['ADMIN', 'BOOTSTRAP', 'IMPORT']).notNullable();
    t.timestamp('linked_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_sign_in_at').nullable();
    t.unique(['tenant_id', 'object_id']);
  });

  await knex.schema.createTable('roles', (t) => {
    t.increments('id').primary();
    t.string('code', 30).notNullable().unique();
    t.string('name', 80).notNullable();
    t.string('description', 255).nullable();
  });

  await knex.schema.createTable('employee_roles', (t) => {
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    t.integer('role_id').unsigned().notNullable().references('id').inTable('roles');
    t.integer('granted_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('granted_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['employee_id', 'role_id']);
    t.index(['role_id']);
  });

  await knex.schema.createTable('delegations', (t) => {
    t.increments('id').primary();
    t.integer('delegator_id').unsigned().notNullable().references('id').inTable('employees');
    t.integer('delegate_id').unsigned().notNullable().references('id').inTable('employees');
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.string('reason', 255).nullable();
    t.integer('created_by').unsigned().notNullable().references('id').inTable('employees');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at').nullable();
    t.integer('revoked_by').unsigned().nullable().references('id').inTable('employees');
    t.index(['delegate_id', 'start_date', 'end_date']);
    t.index(['delegator_id', 'start_date', 'end_date']);
  });
  await knex.raw('ALTER TABLE delegations ADD CONSTRAINT chk_dlg_dates CHECK (end_date >= start_date)');
  await knex.raw('ALTER TABLE delegations ADD CONSTRAINT chk_dlg_self CHECK (delegator_id <> delegate_id)');
}

export async function down(knex) {
  for (const table of [
    'delegations',
    'employee_roles',
    'roles',
    'identity_links',
    'employees',
    'work_schedules',
    'departments',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
