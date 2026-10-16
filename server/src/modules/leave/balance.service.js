import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { writeAudit } from '../audit/audit.service.js';
import { addDays, completedMonths } from './calendar.js';
import { policyOn, toPolicy } from './policy.service.js';

const round2 = (n) => Math.round(n * 100) / 100;
// Requests still in progress: their days count as awaiting approval until decided.
export const PENDING_STATES = [
  'PENDING_MANAGER_APPROVAL',
  'PENDING_EMPLOYEE_ACCEPTANCE',
  'PENDING_HR_APPROVAL',
  'RETURNED_FOR_CORRECTION',
];
const COUNTED_STATES = [...PENDING_STATES, 'APPROVED'];

/**
 * Post a ledger entry and keep the cached balance in step, in the caller's transaction.
 * The ledger is the source of truth; the cache is a convenience and is reconciled from it.
 */
export async function postLedger(trx, entry) {
  const row = {
    employee_id: entry.employeeId,
    leave_type_id: entry.leaveTypeId,
    leave_year: entry.leaveYear,
    amount: round2(entry.amount),
    entry_type: entry.entryType,
    source_type: entry.sourceType,
    source_id: entry.sourceId ?? null,
    period_key: entry.periodKey ?? null,
    reverses_entry_id: entry.reversesEntryId ?? null,
    reason: entry.reason ?? null,
    created_by: entry.createdBy ?? null,
  };
  if (row.amount === 0) return null;
  const [id] = await trx('balance_ledger').insert(row);
  await trx.raw(
    `INSERT INTO balance_cache (employee_id, leave_type_id, leave_year, balance, last_ledger_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance), last_ledger_id = VALUES(last_ledger_id)`,
    [row.employee_id, row.leave_type_id, row.leave_year, row.amount, id],
  );
  return id;
}

/** Sum of ledger entries for an employee, leave type and year (the authoritative balance). */
export async function ledgerBalance(db, employeeId, leaveTypeId, year) {
  const r = await db('balance_ledger')
    .where({ employee_id: employeeId, leave_type_id: leaveTypeId, leave_year: year })
    .sum({ total: 'amount' })
    .first();
  return round2(Number(r.total ?? 0));
}

/** Chargeable days of the employee's requests of one type, in given states, falling between two dates. */
export async function daysTaken(
  db,
  { employeeId, leaveTypeId, from, to, states = COUNTED_STATES, excludeRequestId },
) {
  const q = db('leave_request_days as d')
    .join('leave_requests as r', 'r.id', 'd.leave_request_id')
    .where({ 'r.employee_id': employeeId, 'r.leave_type_id': leaveTypeId })
    .whereIn('r.status', states)
    .whereBetween('d.leave_date', [from, to]);
  if (excludeRequestId) q.whereNot('r.id', excludeRequestId);
  const r = await q.sum({ total: 'd.charged' }).first();
  return round2(Number(r.total ?? 0));
}

/**
 * Balance figures for a balance-consuming type (annual leave) in a leave year:
 * ledger balance, days in pending requests, and what is available to request.
 */
export async function annualPosition(db, employeeId, leaveTypeId, year, { excludeRequestId } = {}) {
  const balance = await ledgerBalance(db, employeeId, leaveTypeId, year);
  const pending = await daysTaken(db, {
    employeeId,
    leaveTypeId,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    states: PENDING_STATES,
    excludeRequestId,
  });
  const entries = await db('balance_ledger')
    .where({ employee_id: employeeId, leave_type_id: leaveTypeId, leave_year: year })
    .select('entry_type')
    .sum({ total: 'amount' })
    .groupBy('entry_type');
  const byType = Object.fromEntries(entries.map((e) => [e.entry_type, round2(Number(e.total))]));
  return {
    year,
    balance,
    pending,
    available: round2(balance - pending),
    opening: byType.OPENING ?? 0,
    accrued: round2((byType.ACCRUAL ?? 0) + (byType.ENTITLEMENT ?? 0)),
    carriedForward: byType.CARRY_FORWARD_IN ?? 0,
    expired: byType.CARRY_FORWARD_EXPIRY ?? 0,
    taken: round2(-((byType.DEDUCTION ?? 0) + (byType.REVERSAL ?? 0))),
    adjustments: round2(byType.ADJUSTMENT ?? 0),
  };
}

/** The window an entitlement limit is measured over, for a request starting on a date. */
export function entitlementWindow(period, startIso, endIso) {
  switch (period) {
    case 'LEAVE_YEAR':
      return {
        from: `${startIso.slice(0, 4)}-01-01`,
        to: `${startIso.slice(0, 4)}-12-31`,
        label: `in ${startIso.slice(0, 4)}`,
      };
    case 'ROLLING_12_MONTHS':
      return { from: addDays(endIso, -364), to: endIso, label: 'in any 12 consecutive months' };
    case 'CALENDAR_MONTH':
      return {
        from: `${startIso.slice(0, 7)}-01`,
        to: addDays(`${addMonth(startIso.slice(0, 7))}-01`, -1),
        label: 'in a calendar month',
      };
    default:
      return null;
  }
}
function addMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

async function takenAndPending(db, employeeId, leaveTypeId, from, to) {
  const range = { employeeId, leaveTypeId, from, to };
  return {
    taken: await daysTaken(db, { ...range, states: ['APPROVED'] }),
    pending: await daysTaken(db, { ...range, states: PENDING_STATES }),
  };
}

/** All of an employee's balances and allowances for a year, for display. */
export async function employeeBalances(db, employeeId, year, { activeOnly = true } = {}) {
  const emp = await db('employees').where({ id: employeeId }).first();
  if (!emp) throw notFound('Employee not found.');
  const types = await db('leave_types')
    .modify((q) => activeOnly && q.where({ is_active: true }))
    .orderBy('display_order');
  const today = new Date().toISOString().slice(0, 10);
  const asOf = today.slice(0, 4) === String(year) ? today : `${year}-12-31`;
  const out = [];
  for (const t of types) {
    const policy = await policyOn(db, t.id, asOf);
    if (!policy || !appliesTo(emp, policy)) continue;
    const eligibility = eligibilityProblem(emp, policy, asOf);
    if (policy.consumesBalance) {
      out.push({
        leaveType: { id: t.id, code: t.code, name: t.name },
        kind: 'BALANCE',
        eligibility,
        ...(await annualPosition(db, employeeId, t.id, year)),
      });
    } else if (
      policy.entitlementDays != null &&
      ['LEAVE_YEAR', 'ROLLING_12_MONTHS', 'CALENDAR_MONTH'].includes(policy.entitlementPeriod)
    ) {
      const w = entitlementWindow(policy.entitlementPeriod, asOf, asOf);
      // Approved and waiting are reported apart; both count against what is left.
      const { taken, pending } = await takenAndPending(db, employeeId, t.id, w.from, w.to);
      const used = round2(taken + pending);
      out.push({
        leaveType: { id: t.id, code: t.code, name: t.name },
        kind: 'ALLOWANCE',
        eligibility,
        entitlement: policy.entitlementDays,
        period: policy.entitlementPeriod,
        taken,
        pending,
        used,
        remaining: round2(Math.max(0, policy.entitlementDays - used)),
      });
    } else {
      // No running allowance: still show what was taken and what is waiting in the leave year.
      const { taken, pending } = await takenAndPending(
        db,
        employeeId,
        t.id,
        `${year}-01-01`,
        `${year}-12-31`,
      );
      out.push({
        leaveType: { id: t.id, code: t.code, name: t.name },
        kind: policy.entitlementPeriod === 'PER_OCCASION' ? 'PER_OCCASION' : 'UNLIMITED',
        eligibility,
        entitlement: policy.entitlementDays,
        maxPerRequest: policy.maxSingleDurationDays,
        taken,
        pending,
      });
    }
  }
  return out;
}

/**
 * Does this leave type apply to the employee at all? Types for one sex (maternity, paternity,
 * Mother's Day, pregnancy loss) are left out for employees of the other sex everywhere they
 * are listed. If the employee's sex is not recorded, the type is still listed, with a note
 * that HR must complete the record.
 */
export function appliesTo(emp, policy) {
  const sex = policy.extraRules?.eligibleSex;
  return !sex || !emp.sex || emp.sex === sex;
}

/** Why an employee cannot use a leave type on a date, or null if they can. */
export function eligibilityProblem(emp, policy, onIso) {
  const sex = policy.extraRules?.eligibleSex;
  if (sex && emp.sex !== sex) {
    return emp.sex
      ? `Only available to ${sex === 'FEMALE' ? 'female' : 'male'} employees.`
      : 'HR needs to complete your employee record before you can use this leave type.';
  }
  if (
    policy.minServiceMonths &&
    completedMonths(emp.employment_start_date, onIso) < policy.minServiceMonths
  ) {
    return `Available after ${policy.minServiceMonths} months of service.`;
  }
  return null;
}

/** HR records an opening balance or an adjustment. Both require a reason and are audited. */
export async function recordAdjustment(db, { employeeId, leaveTypeId, year, amount, reason, kind }, audit) {
  if (!['OPENING', 'ADJUSTMENT'].includes(kind)) throw badRequest('Unknown adjustment kind.');
  if (!reason?.trim()) throw badRequest('A reason is required.');
  return db.transaction(async (trx) => {
    const emp = await trx('employees').where({ id: employeeId }).first('id');
    if (!emp) throw notFound('Employee not found.');
    const type = await trx('leave_types').where({ id: leaveTypeId }).first();
    if (!type) throw notFound('Leave type not found.');
    const policy = await trx('leave_policy_versions')
      .where({ leave_type_id: leaveTypeId })
      .orderBy('version_no', 'desc')
      .first();
    if (!policy || !toPolicy(policy).consumesBalance) throw conflict(`${type.name} does not use a balance.`);
    if (kind === 'OPENING') {
      const existing = await trx('balance_ledger')
        .where({
          employee_id: employeeId,
          leave_type_id: leaveTypeId,
          leave_year: year,
          entry_type: 'OPENING',
        })
        .first('id');
      if (existing)
        throw conflict('An opening balance already exists for this year. Record an adjustment instead.');
    }
    const id = await postLedger(trx, {
      employeeId,
      leaveTypeId,
      leaveYear: year,
      amount,
      entryType: kind,
      sourceType: kind === 'OPENING' ? 'OPENING' : 'ADJUSTMENT',
      reason: reason.trim(),
      createdBy: audit.actorEmployeeId,
    });
    await writeAudit(trx, {
      ...audit,
      action: kind === 'OPENING' ? 'BALANCE_OPENING_RECORDED' : 'BALANCE_ADJUSTED',
      entityType: 'employee',
      entityId: employeeId,
      after: { leaveType: type.code, year, amount, reason: reason.trim(), ledgerEntryId: id },
    });
    return id;
  });
}
