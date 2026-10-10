import { conflict, badRequest } from '../../utils/errors.js';
import { writeAudit } from '../audit/audit.service.js';
import { daysBetween, toIso } from './calendar.js';
import { ledgerBalance, daysTaken, postLedger } from './balance.service.js';
import { policyOn } from './policy.service.js';

const round = (n, mode) => {
  switch (mode) {
    case 'NEAREST_HALF':
      return Math.round(n * 2) / 2;
    case 'NEAREST_TENTH':
      return Math.round(n * 10) / 10;
    case 'DOWN_HALF':
      return Math.floor(n * 2) / 2;
    default:
      return Math.round(n * 100) / 100;
  }
};

/**
 * Record a job run once per period. A second run for the same period is skipped, and the
 * ledger's unique keys make double posting impossible even if two runs overlap.
 */
async function runOnce(db, jobName, periodKey, fn, audit) {
  try {
    await db('scheduled_job_runs').insert({ job_name: jobName, period_key: periodKey, status: 'RUNNING' });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      const prev = await db('scheduled_job_runs').where({ job_name: jobName, period_key: periodKey }).first();
      if (prev.status !== 'FAILED')
        return { skipped: true, reason: `Already run for ${periodKey}.`, previous: prev.summary };
      await db('scheduled_job_runs')
        .where({ id: prev.id })
        .update({ status: 'RUNNING', error: null, started_at: db.fn.now() });
    } else throw err;
  }
  try {
    const summary = await fn();
    await db('scheduled_job_runs')
      .where({ job_name: jobName, period_key: periodKey })
      .update({ status: 'SUCCEEDED', finished_at: db.fn.now(), summary: JSON.stringify(summary) });
    await writeAudit(db, {
      ...audit,
      action: 'JOB_RUN',
      entityType: 'job',
      entityId: `${jobName}:${periodKey}`,
      after: summary,
    });
    return summary;
  } catch (err) {
    await db('scheduled_job_runs')
      .where({ job_name: jobName, period_key: periodKey })
      .update({ status: 'FAILED', finished_at: db.fn.now(), error: String(err.message).slice(0, 2000) });
    throw err;
  }
}

async function balanceTypes(db, onIso) {
  const types = await db('leave_types').where({ is_active: true });
  const out = [];
  for (const t of types) {
    const p = await policyOn(db, t.id, onIso);
    if (p?.consumesBalance) out.push({ type: t, policy: p });
  }
  return out;
}

/**
 * Monthly accrual for balance types using FIXED_MONTHLY or ENTITLEMENT_DIV_12.
 * Refused until HR has confirmed the accrual rule (decision D8). Employees who join or leave
 * during the month accrue in proportion to the days they were employed (policy 1.2.1).
 */
export async function runMonthlyAccrual(db, period, audit) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw badRequest('Period must be YYYY-MM.');
  const monthStart = `${period}-01`;
  const [yy, mm] = period.split('-').map(Number);
  const monthEnd = toIso(new Date(Date.UTC(yy, mm, 0))); // day 0 of next month = last day of this month
  const daysInMonth = daysBetween(monthStart, monthEnd) + 1;
  const types = (await balanceTypes(db, monthEnd)).filter(({ policy }) =>
    ['FIXED_MONTHLY', 'ENTITLEMENT_DIV_12'].includes(policy.accrualMethod),
  );
  const unconfirmed = types.filter(({ policy }) => !policy.accrualConfirmed);
  if (unconfirmed.length) {
    throw conflict(
      `Accrual is not confirmed for: ${unconfirmed.map((t) => t.type.name).join(', ')}. HR must confirm the accrual rule first.`,
    );
  }
  return runOnce(
    db,
    'MONTHLY_ACCRUAL',
    period,
    async () => {
      const employees = await db('employees')
        .where('employment_start_date', '<=', monthEnd)
        .andWhere((w) => w.whereNull('employment_end_date').orWhere('employment_end_date', '>=', monthStart))
        .select('id', 'employment_start_date', 'employment_end_date');
      let posted = 0;
      for (const { type, policy } of types) {
        const monthly =
          policy.accrualMethod === 'FIXED_MONTHLY'
            ? policy.accrualMonthlyAmount
            : (policy.entitlementDays ?? 0) / 12;
        for (const e of employees) {
          const from = e.employment_start_date > monthStart ? e.employment_start_date : monthStart;
          const to =
            e.employment_end_date && e.employment_end_date < monthEnd ? e.employment_end_date : monthEnd;
          const employedDays = daysBetween(from, to) + 1;
          const amount = round(
            monthly * (policy.prorate ? employedDays / daysInMonth : 1),
            policy.accrualRounding,
          );
          if (amount <= 0) continue;
          await db
            .transaction((trx) =>
              postLedger(trx, {
                employeeId: e.id,
                leaveTypeId: type.id,
                leaveYear: Number(period.slice(0, 4)),
                amount,
                entryType: 'ACCRUAL',
                sourceType: 'ACCRUAL_RUN',
                periodKey: period,
                reason: `Monthly accrual ${period}`,
              }),
            )
            .then(
              () => (posted += 1),
              (err) => {
                if (err?.code !== 'ER_DUP_ENTRY') throw err; // already accrued for this period
              },
            );
        }
      }
      return { period, entriesPosted: posted, leaveTypes: types.map((t) => t.type.code) };
    },
    audit,
  );
}

/**
 * Carry unused balance from one leave year into the next, capped by the policy (5 days).
 * Anything above the cap is not carried (policy 1.2.7; flagged against s36(4) of the Act).
 */
export async function runCarryForward(db, fromYear, audit) {
  const year = Number(fromYear);
  if (!Number.isInteger(year)) throw badRequest('Year is required.');
  return runOnce(
    db,
    'CARRY_FORWARD',
    String(year),
    async () => {
      const types = await balanceTypes(db, `${year}-12-31`);
      const employees = await db('employees').where({ status: 'ACTIVE' }).select('id');
      let carried = 0;
      for (const { type, policy } of types) {
        if (!policy.carryForwardMaxDays) continue;
        for (const e of employees) {
          const bal = await ledgerBalance(db, e.id, type.id, year);
          const amount = Math.min(Math.max(bal, 0), policy.carryForwardMaxDays);
          if (amount <= 0) continue;
          await db
            .transaction((trx) =>
              postLedger(trx, {
                employeeId: e.id,
                leaveTypeId: type.id,
                leaveYear: year + 1,
                amount,
                entryType: 'CARRY_FORWARD_IN',
                sourceType: 'CARRY_FORWARD_RUN',
                periodKey: `CF-${year}`,
                reason: `Carried forward from ${year} (unused ${bal}, cap ${policy.carryForwardMaxDays})`,
              }),
            )
            .then(
              () => (carried += 1),
              (err) => {
                if (err?.code !== 'ER_DUP_ENTRY') throw err;
              },
            );
        }
      }
      return { fromYear: year, toYear: year + 1, employeesCarried: carried };
    },
    audit,
  );
}

/**
 * After the expiry date (31 March), remove carried-forward days that were not used.
 * Leave taken from 1 January up to the expiry date is treated as using carried days first.
 */
export async function runCarryForwardExpiry(
  db,
  year,
  audit,
  { today = new Date().toISOString().slice(0, 10) } = {},
) {
  const y = Number(year);
  if (!Number.isInteger(y)) throw badRequest('Year is required.');
  const types = await balanceTypes(db, `${y}-01-01`);
  for (const { policy, type } of types) {
    if (!policy.carryForwardExpiryMonth) continue;
    const expiry = `${y}-${String(policy.carryForwardExpiryMonth).padStart(2, '0')}-${String(policy.carryForwardExpiryDay).padStart(2, '0')}`;
    if (today <= expiry)
      throw conflict(`Carried-forward ${type.name} expires after ${expiry}. Run this after that date.`);
  }
  return runOnce(
    db,
    'CARRY_FORWARD_EXPIRY',
    String(y),
    async () => {
      let expiredCount = 0;
      for (const { type, policy } of types) {
        if (!policy.carryForwardExpiryMonth) continue;
        const expiry = `${y}-${String(policy.carryForwardExpiryMonth).padStart(2, '0')}-${String(policy.carryForwardExpiryDay).padStart(2, '0')}`;
        const rows = await db('balance_ledger')
          .where({ leave_type_id: type.id, leave_year: y, entry_type: 'CARRY_FORWARD_IN' })
          .select('employee_id')
          .sum({ carried: 'amount' })
          .groupBy('employee_id');
        for (const r of rows) {
          const carried = Number(r.carried);
          const used = await daysTaken(db, {
            employeeId: r.employee_id,
            leaveTypeId: type.id,
            from: `${y}-01-01`,
            to: expiry,
            states: ['APPROVED'],
          });
          const toExpire = Math.round(Math.max(0, carried - used) * 100) / 100;
          if (toExpire <= 0) continue;
          await db
            .transaction((trx) =>
              postLedger(trx, {
                employeeId: r.employee_id,
                leaveTypeId: type.id,
                leaveYear: y,
                amount: -toExpire,
                entryType: 'CARRY_FORWARD_EXPIRY',
                sourceType: 'EXPIRY_RUN',
                periodKey: `CFX-${y}`,
                reason: `Unused carried-forward days expired after ${expiry} (carried ${carried}, used ${used})`,
              }),
            )
            .then(
              () => (expiredCount += 1),
              (err) => {
                if (err?.code !== 'ER_DUP_ENTRY') throw err;
              },
            );
        }
      }
      return { year: y, employeesExpired: expiredCount };
    },
    audit,
  );
}
