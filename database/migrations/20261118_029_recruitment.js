/**
 * Project owner, 18 Nov 2026 (D114): Recruitment management.
 *
 *   hiring_requests   a manager asks for a position; HR checks it, a director approves it
 *   vacancies         an approved position being filled (shown to staff when internal)
 *   candidates        people applying for a vacancy, recorded by HR or applying from inside
 *   candidate_files   their CVs and other documents
 *   candidate_events  every move between stages, with the comment given
 *   interviews        an interview, its panel and each panel member's feedback
 *
 * Candidates are recorded by HR; there is no public careers page. Hiring a candidate creates
 * the employee in Employee management.
 *
 * Roles, as for every module (D108): System Admin, HR Officer and Director. Today's HR Officers
 * (in Leave management) and directors get them, so the people who run HR can start at once.
 */
const ROLES = [
  ['System Admin', 'Every right in Recruitment management', true, []],
  [
    'HR Officer',
    'Checks hiring requests, runs vacancies and candidates, and hires',
    false,
    [
      'recruitment.raise_any',
      'recruitment.review',
      'recruitment.requests_all',
      'recruitment.view',
      'recruitment.manage',
      'recruitment.hire',
    ],
  ],
  [
    'Director',
    'Approves hiring requests and sees every vacancy',
    false,
    ['recruitment.approve', 'recruitment.requests_all', 'recruitment.view'],
  ],
];
const DIRECTORS = ['EXECUTIVE_DIRECTOR', 'MANAGING_DIRECTOR', 'ACCOUNTS_DIRECTOR'];

const emp = (t, name, nullable = true) => {
  const c = t.integer(name).unsigned().references('id').inTable('employees');
  return nullable ? c.nullable() : c.notNullable();
};

export async function up(knex) {
  await knex.schema.createTable('hiring_requests', (t) => {
    t.increments('id').unsigned().primary();
    t.string('reference', 20).nullable().unique();
    t.integer('company_id').unsigned().notNullable().references('id').inTable('companies');
    t.integer('department_id').unsigned().notNullable().references('id').inTable('departments');
    t.integer('branch_id').unsigned().nullable().references('id').inTable('stock_branches');
    t.string('job_title', 120).notNullable();
    t.integer('positions').unsigned().notNullable().defaultTo(1);
    t.enu('employment_type', ['PERMANENT', 'FIXED_TERM', 'TEMPORARY']).notNullable();
    t.enu('reason', ['NEW_POSITION', 'REPLACEMENT']).notNullable();
    emp(t, 'replacing_employee_id');
    t.text('justification').notNullable();
    t.string('pay_grade', 20).nullable();
    t.date('target_start_date').nullable();
    t.enu('status', ['PENDING_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'])
      .notNullable()
      .defaultTo('PENDING_REVIEW');
    emp(t, 'requested_by', false);
    emp(t, 'reviewed_by');
    t.datetime('reviewed_at').nullable();
    t.text('review_comment').nullable();
    emp(t, 'decided_by');
    t.datetime('decided_at').nullable();
    t.text('decision_comment').nullable();
    t.timestamps(true, true);
    t.index(['status']);
  });

  await knex.schema.createTable('vacancies', (t) => {
    t.increments('id').unsigned().primary();
    t.string('reference', 20).nullable().unique();
    t.integer('hiring_request_id').unsigned().nullable().unique().references('id').inTable('hiring_requests');
    t.string('job_title', 120).notNullable();
    t.integer('company_id').unsigned().notNullable().references('id').inTable('companies');
    t.integer('department_id').unsigned().notNullable().references('id').inTable('departments');
    t.integer('branch_id').unsigned().nullable().references('id').inTable('stock_branches');
    t.enu('employment_type', ['PERMANENT', 'FIXED_TERM', 'TEMPORARY']).notNullable();
    t.integer('positions').unsigned().notNullable().defaultTo(1);
    t.text('description').nullable();
    t.text('requirements').nullable();
    t.date('closing_date').nullable();
    t.boolean('is_internal').notNullable().defaultTo(true);
    t.enu('status', ['OPEN', 'ON_HOLD', 'CLOSED', 'FILLED']).notNullable().defaultTo('OPEN');
    emp(t, 'hiring_manager_id');
    emp(t, 'created_by', false);
    t.timestamps(true, true);
    t.index(['status']);
  });

  await knex.schema.createTable('candidates', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('vacancy_id').unsigned().notNullable().references('id').inTable('vacancies');
    emp(t, 'employee_id'); // an internal applicant
    t.string('first_name', 80).notNullable();
    t.string('last_name', 80).notNullable();
    t.string('email', 254).nullable();
    t.string('phone', 40).nullable();
    t.enu('source', ['INTERNAL', 'EMAIL', 'AGENCY', 'WALK_IN', 'REFERRAL', 'OTHER']).notNullable();
    t.enu('stage', [
      'APPLIED',
      'SCREENING',
      'SHORTLISTED',
      'INTERVIEW',
      'OFFER',
      'HIRED',
      'REJECTED',
      'WITHDRAWN',
    ])
      .notNullable()
      .defaultTo('APPLIED');
    t.text('notes').nullable();
    t.date('offer_start_date').nullable();
    t.text('offer_notes').nullable();
    t.enu('offer_status', ['PENDING', 'ACCEPTED', 'DECLINED']).nullable();
    emp(t, 'hired_employee_id');
    emp(t, 'created_by', false);
    t.timestamps(true, true);
    t.unique(['vacancy_id', 'employee_id']);
    t.index(['stage']);
  });

  await knex.schema.createTable('candidate_files', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('candidate_id').unsigned().notNullable().references('id').inTable('candidates');
    t.enu('kind', ['CV', 'OTHER']).notNullable().defaultTo('CV');
    t.string('original_name', 150).notNullable();
    t.string('stored_name', 64).notNullable().unique();
    t.string('mime_type', 100).notNullable();
    t.integer('size_bytes').unsigned().notNullable();
    t.string('sha256', 64).notNullable();
    emp(t, 'uploaded_by', false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at').nullable();
    emp(t, 'deleted_by');
  });

  await knex.schema.createTable('candidate_events', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('candidate_id').unsigned().notNullable().references('id').inTable('candidates');
    t.string('from_stage', 20).nullable();
    t.string('to_stage', 20).notNullable();
    t.text('comment').nullable();
    emp(t, 'actor_id', false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['candidate_id']);
  });

  await knex.schema.createTable('interviews', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('candidate_id').unsigned().notNullable().references('id').inTable('candidates');
    // Lusaka local time as 'YYYY-MM-DDTHH:mm', so it reads back exactly as entered.
    t.string('scheduled_at', 16).notNullable();
    t.string('location', 200).nullable();
    t.text('notes').nullable();
    t.enu('status', ['SCHEDULED', 'DONE', 'CANCELLED']).notNullable().defaultTo('SCHEDULED');
    emp(t, 'created_by', false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('interview_panel', (t) => {
    t.integer('interview_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('interviews')
      .onDelete('CASCADE');
    emp(t, 'employee_id', false);
    t.tinyint('rating').unsigned().nullable();
    t.enu('recommendation', ['HIRE', 'MAYBE', 'NO_HIRE']).nullable();
    t.text('comments').nullable();
    t.datetime('submitted_at').nullable();
    t.primary(['interview_id', 'employee_id']);
  });

  // Roles, and the people who start with them.
  const roleId = {};
  for (const [name, description, isSystem, perms] of ROLES) {
    const [id] = await knex('access_roles').insert({
      module: 'recruitment',
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
        ids.map((employee_id) => ({ module: 'recruitment', employee_id, role_id: roleId[role] })),
      );
    }
  }
}

export async function down(knex) {
  await knex('access_users').where({ module: 'recruitment' }).del();
  await knex('access_roles').where({ module: 'recruitment' }).del();
  for (const t of [
    'interview_panel',
    'interviews',
    'candidate_events',
    'candidate_files',
    'candidates',
    'vacancies',
    'hiring_requests',
  ]) {
    await knex.schema.dropTableIfExists(t);
  }
}
