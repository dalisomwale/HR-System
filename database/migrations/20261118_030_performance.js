/**
 * Project owner, 18 Nov 2026 (D115): Performance management.
 *
 *   review_cycles      one a year: goal setting → mid-year review → year-end appraisal → closed
 *   appraisals         one per employee in a cycle, with their manager at the time
 *   appraisal_goals    the goals agreed, each weighted; progress at mid-year; ratings 1–5 at
 *                      year end from the employee and the manager
 *   appraisal_events   every step taken, with its comment
 *   probation_reviews  before an employee's probation ends: the manager recommends confirming,
 *                      extending or not confirming; HR decides, which updates the employee record
 *
 * Roles (D108): System Admin, HR Officer and Director. Today's HR Officers (in Leave management)
 * and directors get them.
 */
const ROLES = [
  ['System Admin', 'Every right in Performance management', true, []],
  [
    'HR Officer',
    'Runs review cycles, sees every appraisal, signs them off and decides probation',
    false,
    ['performance.cycles', 'performance.view_all', 'performance.signoff', 'performance.probation'],
  ],
  ['Director', 'Sees every appraisal and probation review', false, ['performance.view_all']],
];
const DIRECTORS = ['EXECUTIVE_DIRECTOR', 'MANAGING_DIRECTOR', 'ACCOUNTS_DIRECTOR'];

const emp = (t, name, nullable = true) => {
  const c = t.integer(name).unsigned().references('id').inTable('employees');
  return nullable ? c.nullable() : c.notNullable();
};

export async function up(knex) {
  await knex.schema.createTable('review_cycles', (t) => {
    t.increments('id').unsigned().primary();
    t.string('name', 120).notNullable();
    t.integer('year').unsigned().notNullable();
    t.integer('company_id').unsigned().nullable().references('id').inTable('companies');
    t.enu('status', ['DRAFT', 'GOAL_SETTING', 'MID_YEAR', 'YEAR_END', 'CLOSED'])
      .notNullable()
      .defaultTo('DRAFT');
    t.date('goals_due').nullable();
    t.date('mid_year_due').nullable();
    t.date('year_end_due').nullable();
    emp(t, 'created_by', false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('appraisals', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('cycle_id').unsigned().notNullable().references('id').inTable('review_cycles');
    emp(t, 'employee_id', false);
    emp(t, 'manager_id');
    t.enu('status', [
      'GOALS_DRAFT',
      'GOALS_SUBMITTED',
      'GOALS_AGREED',
      'MID_SELF_DONE',
      'MID_DONE',
      'FINAL_SELF_DONE',
      'FINAL_MANAGER_DONE',
      'SIGNED_OFF',
    ])
      .notNullable()
      .defaultTo('GOALS_DRAFT');
    t.text('mid_self_comment').nullable();
    t.text('mid_manager_comment').nullable();
    t.text('final_self_comment').nullable();
    t.text('final_manager_comment').nullable();
    t.decimal('overall_score', 4, 2).nullable();
    t.text('hr_comment').nullable();
    emp(t, 'signed_off_by');
    t.datetime('signed_off_at').nullable();
    t.timestamps(true, true);
    t.unique(['cycle_id', 'employee_id']);
    t.index(['manager_id']);
  });

  await knex.schema.createTable('appraisal_goals', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('appraisal_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('appraisals')
      .onDelete('CASCADE');
    t.integer('sort').unsigned().notNullable().defaultTo(0);
    t.string('title', 200).notNullable();
    t.text('description').nullable();
    t.string('measure', 300).nullable();
    t.integer('weight').unsigned().notNullable();
    t.text('mid_progress').nullable();
    t.tinyint('self_rating').unsigned().nullable();
    t.text('self_comment').nullable();
    t.tinyint('manager_rating').unsigned().nullable();
    t.text('manager_comment').nullable();
  });

  await knex.schema.createTable('appraisal_events', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('appraisal_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('appraisals')
      .onDelete('CASCADE');
    t.string('action', 30).notNullable();
    t.string('from_status', 30).nullable();
    t.string('to_status', 30).notNullable();
    t.text('comment').nullable();
    emp(t, 'actor_id');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('probation_reviews', (t) => {
    t.increments('id').unsigned().primary();
    emp(t, 'employee_id', false);
    emp(t, 'manager_id');
    t.date('probation_end_date').notNullable();
    t.enu('status', ['PENDING_MANAGER', 'PENDING_HR', 'COMPLETED'])
      .notNullable()
      .defaultTo('PENDING_MANAGER');
    t.tinyint('rating_work').unsigned().nullable();
    t.tinyint('rating_conduct').unsigned().nullable();
    t.tinyint('rating_attendance').unsigned().nullable();
    t.tinyint('rating_learning').unsigned().nullable();
    t.text('manager_comment').nullable();
    t.enu('recommendation', ['CONFIRM', 'EXTEND', 'NOT_CONFIRM']).nullable();
    t.date('recommended_extend_to').nullable();
    t.datetime('manager_done_at').nullable();
    t.enu('decision', ['CONFIRM', 'EXTEND', 'NOT_CONFIRM']).nullable();
    t.date('extended_to').nullable();
    t.text('hr_comment').nullable();
    emp(t, 'decided_by');
    t.datetime('decided_at').nullable();
    emp(t, 'started_by'); // null when the daily job started it
    t.timestamps(true, true);
    t.unique(['employee_id', 'probation_end_date']);
  });

  const roleId = {};
  for (const [name, description, isSystem, perms] of ROLES) {
    const [id] = await knex('access_roles').insert({
      module: 'performance',
      name,
      description,
      is_system: isSystem,
    });
    roleId[name] = id;
    if (perms.length) {
      await knex('access_role_permissions').insert(perms.map((permission) => ({ role_id: id, permission })));
    }
  }
  const officers = await knex('access_users as u')
    .join('access_roles as r', 'r.id', 'u.role_id')
    .where({ 'u.module': 'leave', 'r.name': 'HR Officer', 'u.is_active': true })
    .pluck('u.employee_id');
  const directors = (
    await knex('employee_roles as er')
      .join('roles as r', 'r.id', 'er.role_id')
      .whereIn('r.code', DIRECTORS)
      .distinct()
      .pluck('er.employee_id')
  ).filter((id) => !officers.includes(id));
  for (const [ids, role] of [
    [officers, 'HR Officer'],
    [directors, 'Director'],
  ]) {
    if (ids.length) {
      await knex('access_users').insert(
        ids.map((employee_id) => ({ module: 'performance', employee_id, role_id: roleId[role] })),
      );
    }
  }
}

export async function down(knex) {
  await knex('access_users').where({ module: 'performance' }).del();
  await knex('access_roles').where({ module: 'performance' }).del();
  for (const t of [
    'probation_reviews',
    'appraisal_events',
    'appraisal_goals',
    'appraisals',
    'review_cycles',
  ]) {
    await knex.schema.dropTableIfExists(t);
  }
}
