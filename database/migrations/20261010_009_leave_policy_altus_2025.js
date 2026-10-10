/**
 * Leave types and policy version 1 from "Leave Policy – Altus Group – 29th May 2025",
 * as extracted in docs/policy-extraction.md (clause references in source_reference).
 *
 * Every leave type is created INACTIVE. HR reviews each one in the system, answers the
 * questions flagged in the extraction, and activates it. Nothing here is invented: where the
 * policy is silent or ambiguous the value follows the documented default in docs/decisions.md
 * and the version is marked requires_hr_confirmation.
 *
 * Also adds the fields the policy needs: entitlement periods for rolling 12 months (sick leave)
 * and per calendar month (Mother's Day), the employee's recorded sex for eligibility (D20),
 * and request details for paternity/maternity (event date, multiple birth) and for
 * cancelling approved leave (recall vs early return, D24).
 */

const EFFECTIVE_FROM = '2025-05-29';

// [code, name, description, isConfidential, displayOrder, policy]
const TYPES = [
  [
    'ANNUAL',
    'Annual leave',
    '25 working days per leave year. Handover notes required. Apply at least two weeks ahead.',
    false,
    1,
    {
      is_paid: true,
      day_basis: 'WORKING_DAYS',
      consumes_balance: true,
      entitlement_days: 25,
      entitlement_period: 'LEAVE_YEAR',
      prorate_for_joiners_leavers: true,
      // Policy states both 25/year (2.1) and 2.3/month (2.2). Accrual stays off until HR confirms (D8).
      accrual_method: 'ENTITLEMENT_DIV_12',
      accrual_monthly_amount: null,
      accrual_confirmed: false,
      carry_forward_max_days: 5,
      carry_forward_expiry_month: 3,
      carry_forward_expiry_day: 31,
      allow_half_day: true,
      min_notice_days: 14,
      notice_enforcement: 'WARN_WITH_REASON',
      min_consecutive_days_target: 10,
      handover_required: true,
      source_reference: '1.2.1, 1.2.7, 2.1–2.11, 10.3',
      requires_hr_confirmation: true,
    },
  ],
  [
    'SICK',
    'Sick leave',
    'Up to 30 calendar days with full pay in any 12 consecutive months. Medical certificate required.',
    true,
    2,
    {
      is_paid: true,
      day_basis: 'CALENDAR_DAYS',
      consumes_balance: false,
      entitlement_days: 30,
      entitlement_period: 'ROLLING_12_MONTHS',
      accrual_method: 'NONE',
      allow_backdate: true,
      backdate_max_days: 14,
      document_required: true,
      document_description: 'Medical certificate for the days not worked',
      document_due_days_after_return: 3,
      source_reference: '3.1–3.5',
      requires_hr_confirmation: true, // D21: 30-day cap vs s38 of the Act
    },
  ],
  [
    'MOTHERS_DAY',
    "Mother's Day",
    'One day each calendar month for female employees. No medical certificate needed.',
    false,
    3,
    {
      is_paid: true,
      day_basis: 'WORKING_DAYS',
      consumes_balance: false,
      entitlement_days: 1,
      entitlement_period: 'CALENDAR_MONTH',
      accrual_method: 'NONE',
      allow_backdate: true,
      backdate_max_days: 7,
      extra_rules: { eligibleSex: 'FEMALE' },
      source_reference: '3.3',
      requires_hr_confirmation: true, // D28
    },
  ],
  [
    'COMPASSIONATE',
    'Compassionate leave',
    'Up to 12 working days a year for serious illness or death in the family. Not taken from annual leave.',
    false,
    4,
    {
      is_paid: true,
      day_basis: 'WORKING_DAYS',
      consumes_balance: false,
      entitlement_days: 12,
      entitlement_period: 'LEAVE_YEAR',
      accrual_method: 'NONE',
      allow_backdate: true,
      backdate_max_days: 14,
      extra_rules: { reasonRequired: true, overflowTo: 'ANNUAL' },
      source_reference: '4.1–4.2',
      requires_hr_confirmation: false,
    },
  ],
  [
    'FAMILY_RESPONSIBILITY',
    'Family responsibility leave',
    'Up to 7 days a year to nurse a sick spouse, child or dependant, after 6 months of service. Medical certificate required.',
    true,
    5,
    {
      is_paid: true,
      day_basis: 'WORKING_DAYS',
      consumes_balance: false,
      entitlement_days: 7,
      entitlement_period: 'LEAVE_YEAR',
      accrual_method: 'NONE',
      min_service_months: 6,
      allow_backdate: true,
      backdate_max_days: 14,
      document_required: true,
      document_description: 'Medical certificate showing special attention is needed',
      extra_rules: { reasonRequired: true },
      source_reference: '5.1–5.2',
      requires_hr_confirmation: true, // working vs calendar days; s40(2) 3 days (D25)
    },
  ],
  [
    'STUDY',
    'Study leave',
    'Up to 10 working days a year for company-approved courses, after 6 months of service.',
    false,
    6,
    {
      is_paid: true,
      day_basis: 'WORKING_DAYS',
      consumes_balance: false,
      entitlement_days: 10,
      entitlement_period: 'LEAVE_YEAR',
      accrual_method: 'NONE',
      min_service_months: 6,
      allow_half_day: true,
      document_required: true,
      document_description: 'Proof of study and examination dates',
      extra_rules: { reasonRequired: true, overflowTo: 'ANNUAL' },
      source_reference: '6.1–6.5',
      requires_hr_confirmation: false,
    },
  ],
  [
    'MATERNITY',
    'Maternity leave',
    '14 weeks with full pay; 4 more weeks for a multiple birth. Medical certificate confirming pregnancy required.',
    true,
    7,
    {
      is_paid: true,
      day_basis: 'CALENDAR_DAYS',
      consumes_balance: false,
      entitlement_days: 98,
      entitlement_period: 'PER_OCCASION',
      accrual_method: 'NONE',
      max_single_duration_days: 98,
      document_required: true,
      document_description: 'Certificate from a registered medical practitioner confirming pregnancy',
      extra_rules: { eligibleSex: 'FEMALE', multipleBirthMaxDays: 126 },
      source_reference: '7.1–7.5, 7.7, 7.9',
      requires_hr_confirmation: true, // D30
    },
  ],
  [
    'PREGNANCY_LOSS',
    'Leave after miscarriage or stillbirth',
    '6 weeks with full pay after a third-trimester miscarriage or a stillbirth, after 12 months of service. Certified by a medical doctor.',
    true,
    8,
    {
      is_paid: true,
      day_basis: 'CALENDAR_DAYS',
      consumes_balance: false,
      entitlement_days: 42,
      entitlement_period: 'PER_OCCASION',
      accrual_method: 'NONE',
      max_single_duration_days: 42,
      min_service_months: 12,
      allow_backdate: true,
      backdate_max_days: 14,
      document_required: true,
      document_description: 'Certificate from a medical doctor',
      extra_rules: { eligibleSex: 'FEMALE' },
      source_reference: '7.8',
      requires_hr_confirmation: false,
    },
  ],
  [
    'PATERNITY',
    'Paternity leave',
    '5 days with full pay, starting within 7 days of the birth, or as agreed within one month.',
    false,
    9,
    {
      is_paid: true,
      day_basis: 'WORKING_DAYS',
      consumes_balance: false,
      entitlement_days: 5,
      entitlement_period: 'PER_OCCASION',
      accrual_method: 'NONE',
      max_single_duration_days: 5,
      allow_backdate: true,
      backdate_max_days: 7,
      document_required: true,
      document_description: 'Notification of birth (if not already on HR records)',
      extra_rules: { eligibleSex: 'MALE', eventRequired: 'birth', startWithinDays: 30, reasonAfterDays: 7 },
      source_reference: '8.1–8.4',
      requires_hr_confirmation: true, // D22
    },
  ],
  [
    'UNPAID',
    'Leave without pay',
    'Up to 30 days at the company’s discretion, only once all other leave is used. Proof of need required.',
    false,
    10,
    {
      is_paid: false,
      day_basis: 'CALENDAR_DAYS',
      consumes_balance: false,
      entitlement_days: null,
      entitlement_period: 'NONE',
      accrual_method: 'NONE',
      max_single_duration_days: 30,
      document_required: true,
      document_description: 'Proof of the urgent need',
      extra_rules: { reasonRequired: true, requiresExhausted: ['ANNUAL'] },
      source_reference: '9.1–9.3',
      requires_hr_confirmation: true, // D23
    },
  ],
];

export async function up(knex) {
  await knex.raw(
    "ALTER TABLE leave_policy_versions MODIFY entitlement_period ENUM('LEAVE_YEAR','ROLLING_12_MONTHS','CALENDAR_MONTH','PER_OCCASION','PER_EMPLOYMENT','NONE') NOT NULL",
  );

  await knex.schema.alterTable('employees', (t) => {
    // Used only for maternity, paternity and Mother's Day eligibility (decision D20).
    t.enu('sex', ['FEMALE', 'MALE']).nullable().after('job_title');
  });

  await knex.schema.alterTable('leave_requests', (t) => {
    // Date of the event the leave relates to, e.g. the birth for paternity leave.
    t.date('event_date').nullable().after('end_portion');
    t.boolean('multiple_birth').notNullable().defaultTo(false).after('event_date');
  });

  await knex.schema.alterTable('change_requests', (t) => {
    // Recall by management returns untaken days; early return by choice does not (policy 2.7–2.8, D24).
    t.enu('cancel_reason_type', ['PLANS_CHANGED', 'RECALLED_BY_MANAGEMENT', 'EARLY_RETURN_BY_CHOICE'])
      .nullable()
      .after('change_type');
  });

  for (const [code, name, description, isConfidential, displayOrder, policy] of TYPES) {
    const [leaveTypeId] = await knex('leave_types').insert({
      code,
      name,
      description,
      is_confidential: isConfidential,
      is_active: false,
      display_order: displayOrder,
    });
    await knex('leave_policy_versions').insert({
      leave_type_id: leaveTypeId,
      version_no: 1,
      effective_from: EFFECTIVE_FROM,
      allow_negative_balance: false,
      prorate_for_joiners_leavers: false,
      accrual_rounding: 'NONE',
      accrual_confirmed: false,
      allow_half_day: false,
      allow_backdate: false,
      notice_enforcement: 'NONE',
      handover_required: false,
      document_required: false,
      ...policy,
      extra_rules: policy.extra_rules ? JSON.stringify(policy.extra_rules) : null,
    });
  }
}

export async function down(knex) {
  const codes = TYPES.map(([code]) => code);
  const ids = await knex('leave_types').whereIn('code', codes).pluck('id');
  if (ids.length) {
    await knex('leave_policy_versions').whereIn('leave_type_id', ids).del();
    await knex('leave_types').whereIn('id', ids).del();
  }
  await knex.schema.alterTable('change_requests', (t) => t.dropColumn('cancel_reason_type'));
  await knex.schema.alterTable('leave_requests', (t) => {
    t.dropColumn('multiple_birth');
    t.dropColumn('event_date');
  });
  await knex.schema.alterTable('employees', (t) => t.dropColumn('sex'));
  await knex.raw(
    "ALTER TABLE leave_policy_versions MODIFY entitlement_period ENUM('LEAVE_YEAR','PER_OCCASION','PER_EMPLOYMENT','NONE') NOT NULL",
  );
}
