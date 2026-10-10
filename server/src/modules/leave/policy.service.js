import { conflict } from '../../utils/errors.js';

const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
const num = (v) => (v == null ? null : Number(v));

/** Normalise a leave_policy_versions row into plain values. */
export function toPolicy(row) {
  return {
    id: row.id,
    leaveTypeId: row.leave_type_id,
    versionNo: row.version_no,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isPaid: Boolean(row.is_paid),
    dayBasis: row.day_basis,
    consumesBalance: Boolean(row.consumes_balance),
    allowNegativeBalance: Boolean(row.allow_negative_balance),
    entitlementDays: num(row.entitlement_days),
    entitlementPeriod: row.entitlement_period,
    prorate: Boolean(row.prorate_for_joiners_leavers),
    accrualMethod: row.accrual_method,
    accrualMonthlyAmount: num(row.accrual_monthly_amount),
    accrualRounding: row.accrual_rounding,
    accrualConfirmed: Boolean(row.accrual_confirmed),
    carryForwardMaxDays: num(row.carry_forward_max_days),
    carryForwardExpiryMonth: row.carry_forward_expiry_month,
    carryForwardExpiryDay: row.carry_forward_expiry_day,
    allowHalfDay: Boolean(row.allow_half_day),
    allowBackdate: Boolean(row.allow_backdate),
    backdateMaxDays: row.backdate_max_days,
    minNoticeDays: row.min_notice_days,
    noticeEnforcement: row.notice_enforcement,
    maxSingleDurationDays: num(row.max_single_duration_days),
    minServiceMonths: row.min_service_months,
    minConsecutiveDaysTarget: num(row.min_consecutive_days_target),
    handoverRequired: Boolean(row.handover_required),
    documentRequired: Boolean(row.document_required),
    documentDescription: row.document_description,
    extraRules: parseJson(row.extra_rules) ?? {},
    sourceReference: row.source_reference,
    requiresHrConfirmation: Boolean(row.requires_hr_confirmation),
    confirmedAt: row.confirmed_at,
  };
}

/** The policy version in force for a leave type on a date, or null. */
export async function policyOn(db, leaveTypeId, dateIso) {
  const row = await db('leave_policy_versions')
    .where({ leave_type_id: leaveTypeId })
    .andWhere('effective_from', '<=', dateIso)
    .andWhere((w) => w.whereNull('effective_to').orWhere('effective_to', '>=', dateIso))
    .orderBy('effective_from', 'desc')
    .first();
  return row ? toPolicy(row) : null;
}

export async function policyById(db, id) {
  const row = await db('leave_policy_versions').where({ id }).first();
  if (!row) throw conflict('Leave policy not found.');
  return toPolicy(row);
}

/** Settings stored as JSON in system_settings. */
export async function getSetting(db, key, fallback) {
  const row = await db('system_settings').where({ setting_key: key }).first('value');
  if (!row) return fallback;
  return typeof row.value === 'string' ? safeParse(row.value) : row.value;
}
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Working schedule fractions and public holidays needed to calculate a request. */
export async function loadCalendarInputs(db, employeeId, startIso, endIso) {
  const emp = await db('employees').where({ id: employeeId }).first('work_schedule_id');
  let schedule = emp?.work_schedule_id
    ? await db('work_schedules').where({ id: emp.work_schedule_id, is_active: true }).first()
    : null;
  if (!schedule) schedule = await db('work_schedules').where({ is_company_default: true }).first();
  const fractions = {};
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    fractions[d] = Number(schedule?.[`${d}_fraction`] ?? 0);

  const rows = await db('public_holidays')
    .whereBetween('holiday_date', [startIso, endIso])
    .select('id', 'holiday_date', 'name');
  const holidays = new Map(rows.map((r) => [r.holiday_date, { id: r.id, name: r.name }]));
  return { schedule: fractions, scheduleName: schedule?.name ?? null, holidays };
}
