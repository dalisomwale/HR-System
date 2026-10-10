/**
 * Required system configuration only. No employees, departments, requests, balances or
 * holidays are created here.
 *
 * Settings marked requires_hr_confirmation carry the documented default from
 * docs/decisions.md and appear on the HR exceptions list until an HR Administrator confirms them.
 */

const ROLES = [
  {
    code: 'HR_OFFICER',
    name: 'HR Officer',
    description:
      'Final approval of leave requests, company-wide leave records, reports and balance adjustments.',
  },
  {
    code: 'HR_ADMIN',
    name: 'HR Administrator',
    description:
      'Employee records, identity mapping, roles, leave types, policies, calendars and system settings.',
  },
];

// [key, value, description, requiresHrConfirmation, decisionRef]
const SETTINGS = [
  ['leave_year_start', { month: 1, day: 1 }, 'Leave year start (policy: 1 January to 31 December).', false],
  ['business_timezone', 'Africa/Lusaka', 'Timezone used for leave dates and scheduled jobs.', false],
  ['manager_scope', 'DIRECT_REPORTS', 'Which employees a manager may act on. Decision D2.', true],
  ['no_manager_routing', 'HR_STAGE', 'Routing for employees with no manager. Decision D3.', true],
  [
    'resubmission_routing',
    'MANAGER_STAGE',
    'Where a request returned by HR goes on resubmission. Decision D4.',
    true,
  ],
  [
    'handover_signoff_by',
    'LINE_MANAGER',
    'Who signs off handover notes ("Head of Department"). Decision D6.',
    true,
  ],
  [
    'weekend_holiday_substitution',
    'UNCONFIRMED',
    'Rule for public holidays falling on a non-working day. Decision D7.',
    true,
  ],
  ['overdue_manager_working_days', 3, 'Working days before a manager-stage request is marked overdue.', true],
  ['overdue_hr_working_days', 3, 'Working days before an HR-stage request is marked overdue.', true],
  [
    'uncommunicated_decision_escalation_days',
    7,
    'Policy provision on decisions not communicated within one week: escalation only, never auto-approval. Decision D9.',
    true,
  ],
  ['leave_reservations_enabled', false, 'Whether pending requests reserve balance.', false],
  ['email_max_attempts', 5, 'Email send attempts before an outbox message is marked DEAD.', false],
  ['idempotency_ttl_hours', 24, 'How long idempotency keys are retained.', false],
];

export async function up(knex) {
  await knex('roles').insert(ROLES);

  await knex('system_settings').insert(
    SETTINGS.map(([key, value, description, requiresConfirmation]) => ({
      setting_key: key,
      value: JSON.stringify(value),
      description,
      requires_hr_confirmation: requiresConfirmation,
    })),
  );

  // Company working week default from the project brief (Monday to Friday). HR can change it.
  await knex('work_schedules').insert({
    name: 'Standard Monday to Friday',
    mon_fraction: 1,
    tue_fraction: 1,
    wed_fraction: 1,
    thu_fraction: 1,
    fri_fraction: 1,
    sat_fraction: 0,
    sun_fraction: 0,
    is_company_default: true,
  });
}

export async function down(knex) {
  await knex('work_schedules').where({ name: 'Standard Monday to Friday' }).del();
  await knex('system_settings')
    .whereIn(
      'setting_key',
      SETTINGS.map(([key]) => key),
    )
    .del();
  await knex('roles')
    .whereIn(
      'code',
      ROLES.map((r) => r.code),
    )
    .del();
}
