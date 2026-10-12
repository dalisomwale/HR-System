import { z } from 'zod';
import { forbidden, notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { isoDate } from '../../utils/validation.js';
import { addDays, daysBetween, eachDate, weekdayKey } from '../leave/calendar.js';
import { annualPosition, daysTaken } from '../leave/balance.service.js';
import { getSetting } from '../leave/policy.service.js';
import { workingCalendar, stageSince } from '../leave/working-days.js';

/*
 * Report definitions. Every query is limited to the people the viewer may see BEFORE rows are
 * read (scope.ids), never filtered afterwards. HR Officers see everyone; managers and their
 * delegates see every report, for their own team only; nobody else can run reports.
 */

const STATUS = [
  'PENDING_MANAGER_APPROVAL',
  'PENDING_HR_APPROVAL',
  'RETURNED_FOR_CORRECTION',
  'APPROVED',
  'REJECTED_BY_MANAGER',
  'REJECTED_BY_HR',
  'WITHDRAWN',
  'CANCELLED',
];
const STATUS_LABEL = {
  PENDING_MANAGER_APPROVAL: 'With manager',
  PENDING_HR_APPROVAL: 'With HR',
  RETURNED_FOR_CORRECTION: 'Returned for correction',
  APPROVED: 'Approved',
  REJECTED_BY_MANAGER: 'Rejected by manager',
  REJECTED_BY_HR: 'Rejected by HR',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
};
const ENTRY_LABEL = {
  OPENING: 'Opening balance',
  ENTITLEMENT: 'Entitlement',
  ACCRUAL: 'Accrual',
  DEDUCTION: 'Leave taken',
  REVERSAL: 'Returned',
  CARRY_FORWARD_IN: 'Carried forward',
  CARRY_FORWARD_EXPIRY: 'Carry-forward expired',
  ADJUSTMENT: 'Adjustment',
  RESERVATION: 'Reserved',
  RESERVATION_RELEASE: 'Reservation released',
};

export const filterSchema = z.object({
  employeeId: z.coerce.number().int().positive().optional().catch(undefined),
  companyId: z.coerce.number().int().positive().optional().catch(undefined),
  departmentId: z.coerce.number().int().positive().optional().catch(undefined),
  leaveTypeId: z.coerce.number().int().positive().optional().catch(undefined),
  status: z.enum(STATUS).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  entryType: z.enum(Object.keys(ENTRY_LABEL)).optional().catch(undefined),
});

/** Who the viewer may report on. */
export async function reportScope(db, user) {
  if (user.roles.includes('HR_OFFICER')) return { level: 'HR', ids: null };
  if (!user.isManager && !user.isDelegate) throw forbidden('Reports are for managers and HR.');
  const today = todayInLusaka();
  const delegators = await db('delegations')
    .where({ delegate_id: user.id })
    .whereNull('revoked_at')
    .andWhere('start_date', '<=', today)
    .andWhere('end_date', '>=', today)
    .pluck('delegator_id');
  const reportingLine = (await getSetting(db, 'manager_scope', 'DIRECT_REPORTS')) === 'REPORTING_LINE';
  const ids = new Set();
  for (const root of [user.id, ...delegators]) {
    let frontier = [root];
    const seen = new Set(frontier);
    while (frontier.length) {
      const next = await db('employees').whereIn('line_manager_id', frontier).pluck('id');
      frontier = next.filter((id) => !seen.has(id));
      frontier.forEach((id) => {
        seen.add(id);
        ids.add(id);
      });
      if (!reportingLine) break;
    }
  }
  ids.delete(user.id);
  return { level: 'MANAGER', ids: [...ids] };
}

/** Apply the viewer's scope and the people filters to a query on employees `e`. */
function people(q, scope, f) {
  if (scope.ids) q.whereIn('e.id', scope.ids.length ? scope.ids : [0]);
  if (f.employeeId) q.where('e.id', f.employeeId);
  if (f.companyId) q.where('e.company_id', f.companyId);
  if (f.departmentId) q.where('e.department_id', f.departmentId);
  return q;
}

const name = (r) => `${r.first_name} ${r.last_name}`;
const yearOf = (f) => f.year ?? Number(todayInLusaka().slice(0, 4));
const range = (f, defFrom, defTo) => ({ from: f.from ?? defFrom, to: f.to ?? defTo });
const yearRange = (f) => range(f, `${yearOf(f)}-01-01`, `${yearOf(f)}-12-31`);
const r2 = (n) => Math.round(Number(n) * 100) / 100;

function requestBase(db) {
  return db('leave_requests as r')
    .join('employees as e', 'e.id', 'r.employee_id')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .leftJoin('companies as co', 'co.id', 'e.company_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select(
      'r.*',
      'e.employee_number',
      'e.first_name',
      'e.last_name',
      'co.name as company',
      'd.name as department',
      't.name as leave_type',
    );
}

const PERSON_COLS = [
  { key: 'employeeNumber', label: 'Employee number', type: 'text' },
  { key: 'employee', label: 'Employee', type: 'text' },
  { key: 'company', label: 'Company', type: 'text' },
  { key: 'department', label: 'Department', type: 'text' },
];
const personRow = (r) => ({
  employeeNumber: r.employee_number,
  employee: name(r),
  company: r.company ?? '',
  department: r.department ?? '',
});
const lusaka = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lusaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** Event time in Lusaka, 'YYYY-MM-DD HH:MM'. */
const ts = (v) => (v ? lusaka.format(new Date(v)).replace(',', '') : '');

/** Approved days in the period against active headcount, per company or per company and department. */
async function utilisation(db, scope, f, byDepartment) {
  const { from, to } = yearRange(f);
  const keys = byDepartment ? ['e.company_id', 'e.department_id'] : ['e.company_id'];
  const heads = await people(
    db('employees as e')
      .leftJoin('companies as co', 'co.id', 'e.company_id')
      .leftJoin('departments as d', 'd.id', 'e.department_id'),
    scope,
    f,
  )
    .where('e.status', 'ACTIVE')
    .groupBy(...keys, 'co.name', ...(byDepartment ? ['d.name'] : []))
    .select(...keys, 'co.name as company', ...(byDepartment ? ['d.name as department'] : []))
    .count({ n: '*' });
  const taken = await people(
    db('leave_request_days as x')
      .join('leave_requests as r', 'r.id', 'x.leave_request_id')
      .join('employees as e', 'e.id', 'r.employee_id'),
    scope,
    f,
  )
    .where('r.status', 'APPROVED')
    .whereBetween('x.leave_date', [from, to])
    .modify((q) => f.leaveTypeId && q.where('r.leave_type_id', f.leaveTypeId))
    .groupBy(...keys)
    .select(...keys)
    .sum({ days: 'x.charged' });
  const key = (r) => `${r.company_id ?? ''}|${byDepartment ? (r.department_id ?? '') : ''}`;
  const by = new Map(taken.map((t) => [key(t), Number(t.days)]));
  return heads
    .map((h) => {
      const days = r2(by.get(key(h)) ?? 0);
      return {
        company: h.company ?? 'No company',
        ...(byDepartment ? { department: h.department ?? 'No department' } : {}),
        headcount: Number(h.n),
        days,
        perPerson: Number(h.n) ? Math.round((days / Number(h.n)) * 10) / 10 : 0,
      };
    })
    .sort(
      (a, b) => a.company.localeCompare(b.company) || (a.department ?? '').localeCompare(b.department ?? ''),
    );
}

// ---------------------------------------------------------------------------------------------

export const REPORTS = [
  {
    id: 'requests',
    title: 'Leave requests',
    description: 'Every request whose dates fall in the period, with its status and decision dates.',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'employee', 'company', 'department', 'leaveType', 'status'],
    columns: [
      { key: 'reference', label: 'Reference', type: 'text' },
      ...PERSON_COLS,
      { key: 'leaveType', label: 'Leave type', type: 'text' },
      { key: 'start', label: 'First day', type: 'date' },
      { key: 'end', label: 'Last day', type: 'date' },
      { key: 'days', label: 'Days', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'submitted', label: 'Submitted', type: 'text' },
      { key: 'managerDecided', label: 'Manager decided', type: 'text' },
      { key: 'hrDecided', label: 'HR decided', type: 'text' },
      { key: 'overdue', label: 'Overdue', type: 'text' },
    ],
    async run(db, scope, f) {
      const { from, to } = yearRange(f);
      const q = people(requestBase(db), scope, f)
        .whereNotNull('r.reference')
        .andWhere('r.start_date', '<=', to)
        .andWhere('r.end_date', '>=', from)
        .orderBy(['r.start_date', 'e.last_name']);
      if (f.leaveTypeId) q.where('r.leave_type_id', f.leaveTypeId);
      if (f.status) q.where('r.status', f.status);
      return (await q).map((r) => ({
        reference: r.reference,
        ...personRow(r),
        leaveType: r.leave_type,
        start: r.start_date,
        end: r.end_date,
        days: Number(r.chargeable_days),
        status: STATUS_LABEL[r.status],
        submitted: ts(r.submitted_at),
        managerDecided: ts(r.manager_decided_at),
        hrDecided: ts(r.hr_decided_at),
        overdue: r.is_overdue ? 'Yes' : '',
      }));
    },
  },

  {
    id: 'status-summary',
    title: 'Requests by status',
    description: 'How many requests, and how many days, are in each status for each leave type.',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'company', 'department', 'leaveType'],
    columns: [
      { key: 'leaveType', label: 'Leave type', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'requests', label: 'Requests', type: 'number' },
      { key: 'days', label: 'Days', type: 'number' },
    ],
    async run(db, scope, f) {
      const { from, to } = yearRange(f);
      const q = people(
        db('leave_requests as r')
          .join('employees as e', 'e.id', 'r.employee_id')
          .join('leave_types as t', 't.id', 'r.leave_type_id'),
        scope,
        f,
      )
        .whereNotNull('r.reference')
        .andWhere('r.start_date', '<=', to)
        .andWhere('r.end_date', '>=', from)
        .groupBy('t.name', 't.display_order', 'r.status')
        .select('t.name as leave_type', 'r.status')
        .count({ n: '*' })
        .sum({ days: 'r.chargeable_days' })
        .orderBy(['t.display_order', 'r.status']);
      if (f.leaveTypeId) q.where('r.leave_type_id', f.leaveTypeId);
      return (await q).map((r) => ({
        leaveType: r.leave_type,
        status: STATUS_LABEL[r.status],
        requests: Number(r.n),
        days: r2(r.days),
      }));
    },
  },

  {
    id: 'taken-by-employee',
    title: 'Leave taken by employee',
    description: 'Approved days that fall in the period, per person and leave type.',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'employee', 'company', 'department', 'leaveType'],
    columns: [
      ...PERSON_COLS,
      { key: 'leaveType', label: 'Leave type', type: 'text' },
      { key: 'days', label: 'Days taken', type: 'number' },
    ],
    async run(db, scope, f) {
      const { from, to } = yearRange(f);
      const q = people(
        db('leave_request_days as x')
          .join('leave_requests as r', 'r.id', 'x.leave_request_id')
          .join('employees as e', 'e.id', 'r.employee_id')
          .join('leave_types as t', 't.id', 'r.leave_type_id')
          .leftJoin('companies as co', 'co.id', 'e.company_id')
          .leftJoin('departments as d', 'd.id', 'e.department_id'),
        scope,
        f,
      )
        .where('r.status', 'APPROVED')
        .whereBetween('x.leave_date', [from, to])
        .where('x.charged', '>', 0)
        .groupBy(
          'e.id',
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'co.name',
          'd.name',
          't.name',
          't.display_order',
        )
        .select(
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'co.name as company',
          'd.name as department',
          't.name as leave_type',
        )
        .sum({ days: 'x.charged' })
        .orderBy(['e.last_name', 'e.first_name', 't.display_order']);
      if (f.leaveTypeId) q.where('r.leave_type_id', f.leaveTypeId);
      return (await q).map((r) => ({ ...personRow(r), leaveType: r.leave_type, days: r2(r.days) }));
    },
  },

  {
    id: 'utilisation-company',
    title: 'Utilisation by company',
    description: 'Approved days taken in the period per company in the group, against current headcount.',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'company', 'leaveType'],
    columns: [
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'headcount', label: 'Active staff', type: 'number' },
      { key: 'days', label: 'Days taken', type: 'number' },
      { key: 'perPerson', label: 'Days per person', type: 'number' },
    ],
    async run(db, scope, f) {
      return utilisation(db, scope, f, false);
    },
  },

  {
    id: 'utilisation',
    title: 'Utilisation by department',
    description: 'Approved days taken in the period per department, against current headcount.',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'company', 'department', 'leaveType'],
    columns: [
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'department', label: 'Department', type: 'text' },
      { key: 'headcount', label: 'Active staff', type: 'number' },
      { key: 'days', label: 'Days taken', type: 'number' },
      { key: 'perPerson', label: 'Days per person', type: 'number' },
    ],
    async run(db, scope, f) {
      return utilisation(db, scope, f, true);
    },
  },

  {
    id: 'balances',
    title: 'Current balances',
    description:
      'Annual-leave position per person for the year: opening, carried forward, accrued, taken, adjustments and what is left.',
    levels: ['HR', 'MANAGER'],
    filters: ['year', 'employee', 'company', 'department'],
    columns: [
      ...PERSON_COLS,
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'opening', label: 'Opening', type: 'number' },
      { key: 'carried', label: 'Carried forward', type: 'number' },
      { key: 'accrued', label: 'Accrued / granted', type: 'number' },
      { key: 'taken', label: 'Taken', type: 'number' },
      { key: 'adjustments', label: 'Adjustments', type: 'number' },
      { key: 'expired', label: 'Expired', type: 'number' },
      { key: 'balance', label: 'Balance', type: 'number' },
      { key: 'pending', label: 'Awaiting approval', type: 'number' },
      { key: 'available', label: 'Available to request', type: 'number' },
    ],
    async run(db, scope, f) {
      const year = yearOf(f);
      const annual = await db('leave_types').where({ code: 'ANNUAL' }).first('id');
      if (!annual) return [];
      const emps = await people(
        db('employees as e')
          .leftJoin('companies as co', 'co.id', 'e.company_id')
          .leftJoin('departments as d', 'd.id', 'e.department_id'),
        scope,
        f,
      )
        .where('e.status', 'ACTIVE')
        .orderBy(['e.last_name', 'e.first_name'])
        .select(
          'e.id',
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'co.name as company',
          'd.name as department',
        );
      const out = [];
      for (const e of emps) {
        const p = await annualPosition(db, e.id, annual.id, year);
        out.push({
          ...personRow(e),
          year,
          opening: p.opening,
          carried: p.carriedForward,
          accrued: p.accrued,
          taken: p.taken,
          adjustments: p.adjustments,
          expired: p.expired,
          balance: p.balance,
          pending: p.pending,
          available: p.available,
        });
      }
      return out;
    },
  },

  {
    id: 'upcoming',
    title: 'Upcoming absences',
    description:
      'Approved and pending leave starting or continuing in the period (default: the next 30 days).',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'employee', 'company', 'department', 'leaveType'],
    columns: [
      ...PERSON_COLS,
      { key: 'leaveType', label: 'Leave type', type: 'text' },
      { key: 'start', label: 'First day', type: 'date' },
      { key: 'end', label: 'Last day', type: 'date' },
      { key: 'days', label: 'Days', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'reference', label: 'Reference', type: 'text' },
    ],
    async run(db, scope, f) {
      const today = todayInLusaka();
      const { from, to } = range(f, today, addDays(today, 30));
      const q = people(requestBase(db), scope, f)
        .whereIn('r.status', ['APPROVED', 'PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL'])
        .andWhere('r.start_date', '<=', to)
        .andWhere('r.end_date', '>=', from)
        .orderBy(['r.start_date', 'e.last_name']);
      if (f.leaveTypeId) q.where('r.leave_type_id', f.leaveTypeId);
      return (await q).map((r) => ({
        ...personRow(r),
        leaveType: r.leave_type,
        start: r.start_date,
        end: r.end_date,
        days: Number(r.chargeable_days),
        status: STATUS_LABEL[r.status],
        reference: r.reference,
      }));
    },
  },

  {
    id: 'carry-forward',
    title: 'Carry-forward and expiry',
    description:
      'Annual-leave days carried into the year, how many were used by the deadline, and what expired.',
    levels: ['HR', 'MANAGER'],
    filters: ['year', 'employee', 'company', 'department'],
    columns: [
      ...PERSON_COLS,
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'carried', label: 'Carried in', type: 'number' },
      { key: 'usedByDeadline', label: 'Used by deadline', type: 'number' },
      { key: 'unused', label: 'Unused', type: 'number' },
      { key: 'expired', label: 'Expired', type: 'number' },
      { key: 'deadline', label: 'Deadline', type: 'date' },
    ],
    async run(db, scope, f) {
      const year = yearOf(f);
      const annual = await db('leave_types').where({ code: 'ANNUAL' }).first('id');
      if (!annual) return [];
      const p = await db('leave_policy_versions')
        .where({ leave_type_id: annual.id })
        .andWhere('effective_from', '<=', `${year}-12-31`)
        .orderBy('effective_from', 'desc')
        .first('carry_forward_expiry_month', 'carry_forward_expiry_day');
      const deadline = p?.carry_forward_expiry_month
        ? `${year}-${String(p.carry_forward_expiry_month).padStart(2, '0')}-${String(p.carry_forward_expiry_day).padStart(2, '0')}`
        : `${year}-12-31`;
      const rows = await people(
        db('balance_ledger as l')
          .join('employees as e', 'e.id', 'l.employee_id')
          .leftJoin('companies as co', 'co.id', 'e.company_id')
          .leftJoin('departments as d', 'd.id', 'e.department_id'),
        scope,
        f,
      )
        .where({ 'l.leave_type_id': annual.id, 'l.leave_year': year })
        .whereIn('l.entry_type', ['CARRY_FORWARD_IN', 'CARRY_FORWARD_EXPIRY'])
        .groupBy('e.id', 'e.employee_number', 'e.first_name', 'e.last_name', 'co.name', 'd.name')
        .select(
          'e.id',
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'co.name as company',
          'd.name as department',
          db.raw("SUM(CASE WHEN l.entry_type = 'CARRY_FORWARD_IN' THEN l.amount ELSE 0 END) AS carried"),
          db.raw("SUM(CASE WHEN l.entry_type = 'CARRY_FORWARD_EXPIRY' THEN -l.amount ELSE 0 END) AS expired"),
        )
        .orderBy(['e.last_name', 'e.first_name']);
      const out = [];
      for (const r of rows) {
        const used = await daysTaken(db, {
          employeeId: r.id,
          leaveTypeId: annual.id,
          from: `${year}-01-01`,
          to: deadline,
          states: ['APPROVED'],
        });
        const carried = r2(r.carried);
        const usedByDeadline = r2(Math.min(carried, used));
        out.push({
          ...personRow(r),
          year,
          carried,
          usedByDeadline,
          unused: r2(carried - usedByDeadline),
          expired: r2(r.expired),
          deadline,
        });
      }
      return out;
    },
  },

  {
    id: 'ledger',
    title: 'Ledger transactions and adjustments',
    description:
      'Every balance entry recorded in the period, with who made it and why. Choose “Adjustment” to see manual changes only.',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'employee', 'company', 'department', 'leaveType', 'entryType'],
    columns: [
      { key: 'at', label: 'Recorded', type: 'text' },
      ...PERSON_COLS,
      { key: 'leaveType', label: 'Leave type', type: 'text' },
      { key: 'year', label: 'Leave year', type: 'number' },
      { key: 'entryType', label: 'Entry', type: 'text' },
      { key: 'amount', label: 'Days', type: 'number' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'by', label: 'Recorded by', type: 'text' },
    ],
    async run(db, scope, f) {
      const { from, to } = yearRange(f);
      const q = people(
        db('balance_ledger as l')
          .join('employees as e', 'e.id', 'l.employee_id')
          .join('leave_types as t', 't.id', 'l.leave_type_id')
          .leftJoin('companies as co', 'co.id', 'e.company_id')
          .leftJoin('departments as d', 'd.id', 'e.department_id')
          .leftJoin('employees as c', 'c.id', 'l.created_by'),
        scope,
        f,
      )
        .whereBetween('l.created_at', [`${from} 00:00:00`, `${to} 23:59:59`])
        .orderBy('l.id')
        .select(
          'l.*',
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'co.name as company',
          'd.name as department',
          't.name as leave_type',
          'c.first_name as by_first',
          'c.last_name as by_last',
        );
      if (f.leaveTypeId) q.where('l.leave_type_id', f.leaveTypeId);
      if (f.entryType) q.where('l.entry_type', f.entryType);
      return (await q).map((l) => ({
        at: ts(l.created_at),
        ...personRow(l),
        leaveType: l.leave_type,
        year: l.leave_year,
        entryType: ENTRY_LABEL[l.entry_type] ?? l.entry_type,
        amount: Number(l.amount),
        reason: l.reason ?? '',
        by: l.by_first ? `${l.by_first} ${l.by_last}` : 'System',
      }));
    },
  },

  {
    id: 'approval-activity',
    title: 'Approval activity',
    description:
      'Decisions made in the period by each manager and HR Officer, and how long requests waited for them.',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'company', 'department'],
    columns: [
      { key: 'approver', label: 'Approver', type: 'text' },
      { key: 'stage', label: 'Stage', type: 'text' },
      { key: 'approved', label: 'Approved', type: 'number' },
      { key: 'rejected', label: 'Rejected', type: 'number' },
      { key: 'returned', label: 'Returned', type: 'number' },
      { key: 'avgDays', label: 'Average days to decide', type: 'number' },
    ],
    async run(db, scope, f) {
      const { from, to } = yearRange(f);
      // Wait = time from the previous action on the same request to this decision.
      const rows = await db('approval_actions as a')
        .join('employees as x', 'x.id', 'a.actor_id')
        .join('leave_requests as r', 'r.id', 'a.leave_request_id')
        .join('employees as e', 'e.id', 'r.employee_id')
        .modify((q) => people(q, scope, f))
        .whereIn('a.stage', ['MANAGER', 'HR'])
        .whereIn('a.action', ['APPROVE', 'REJECT', 'RETURN'])
        .whereBetween('a.created_at', [`${from} 00:00:00`, `${to} 23:59:59`])
        .select(
          'a.actor_id',
          'a.stage',
          'a.action',
          'a.created_at',
          'x.first_name',
          'x.last_name',
          db.raw(
            '(SELECT MAX(p.created_at) FROM approval_actions p WHERE p.leave_request_id = a.leave_request_id AND p.id < a.id) AS prev_at',
          ),
        );
      const groups = new Map();
      for (const r of rows) {
        const key = `${r.actor_id}|${r.stage}`;
        const g = groups.get(key) ?? {
          approver: name(r),
          stage: r.stage === 'HR' ? 'HR' : 'Manager',
          approved: 0,
          rejected: 0,
          returned: 0,
          waits: [],
        };
        g[{ APPROVE: 'approved', REJECT: 'rejected', RETURN: 'returned' }[r.action]] += 1;
        if (r.prev_at) g.waits.push((new Date(r.created_at) - new Date(r.prev_at)) / 86400000);
        groups.set(key, g);
      }
      return [...groups.values()]
        .map(({ waits, ...g }) => ({
          ...g,
          avgDays: waits.length
            ? Math.round((waits.reduce((s, w) => s + w, 0) / waits.length) * 10) / 10
            : null,
        }))
        .sort((a, b) => a.stage.localeCompare(b.stage) || a.approver.localeCompare(b.approver));
    },
  },

  {
    id: 'outstanding',
    title: 'Outstanding and overdue requests',
    description:
      'Requests still waiting for a decision, how long they have waited in working days, and whether they are overdue.',
    levels: ['HR', 'MANAGER'],
    filters: ['employee', 'company', 'department', 'leaveType'],
    columns: [
      { key: 'reference', label: 'Reference', type: 'text' },
      ...PERSON_COLS,
      { key: 'leaveType', label: 'Leave type', type: 'text' },
      { key: 'start', label: 'First day', type: 'date' },
      { key: 'stage', label: 'Waiting for', type: 'text' },
      { key: 'approver', label: 'Manager', type: 'text' },
      { key: 'since', label: 'Waiting since', type: 'date' },
      { key: 'workingDays', label: 'Working days waiting', type: 'number' },
      { key: 'overdue', label: 'Overdue', type: 'text' },
    ],
    async run(db, scope, f) {
      const today = todayInLusaka();
      const q = people(requestBase(db), scope, f)
        .leftJoin('employees as m', 'm.id', 'r.assigned_manager_id')
        .select('m.first_name as m_first', 'm.last_name as m_last')
        .whereIn('r.status', ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL'])
        .orderBy('r.submitted_at');
      if (f.leaveTypeId) q.where('r.leave_type_id', f.leaveTypeId);
      const rows = await q;
      if (!rows.length) return [];
      const age = await workingCalendar(db, rows.map(stageSince).filter(Boolean).sort()[0] ?? today, today);
      const limit = {
        PENDING_MANAGER_APPROVAL: Number(await getSetting(db, 'overdue_manager_working_days', 3)),
        PENDING_HR_APPROVAL: Number(await getSetting(db, 'overdue_hr_working_days', 3)),
      };
      return rows.map((r) => {
        const since = stageSince(r);
        const waited = since ? age(since) : 0;
        return {
          reference: r.reference,
          ...personRow(r),
          leaveType: r.leave_type,
          start: r.start_date,
          stage: r.status === 'PENDING_HR_APPROVAL' ? 'HR' : 'Manager',
          approver: r.m_first ? `${r.m_first} ${r.m_last}` : '',
          since,
          workingDays: waited,
          overdue: r.is_overdue || waited > limit[r.status] ? 'Yes' : '',
        };
      });
    },
  },

  {
    id: 'date-range',
    title: 'Leave over a date range',
    description: 'Approved leave in the period, counting only the days that fall inside it.',
    levels: ['HR', 'MANAGER'],
    filters: ['from', 'to', 'employee', 'company', 'department', 'leaveType'],
    columns: [
      ...PERSON_COLS,
      { key: 'leaveType', label: 'Leave type', type: 'text' },
      { key: 'start', label: 'First day', type: 'date' },
      { key: 'end', label: 'Last day', type: 'date' },
      { key: 'daysInRange', label: 'Days in period', type: 'number' },
      { key: 'reference', label: 'Reference', type: 'text' },
    ],
    async run(db, scope, f) {
      const today = todayInLusaka();
      const { from, to } = range(
        f,
        `${today.slice(0, 7)}-01`,
        addDays(`${addDays(`${today.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1),
      );
      const q = people(
        db('leave_request_days as x')
          .join('leave_requests as r', 'r.id', 'x.leave_request_id')
          .join('employees as e', 'e.id', 'r.employee_id')
          .join('leave_types as t', 't.id', 'r.leave_type_id')
          .leftJoin('companies as co', 'co.id', 'e.company_id')
          .leftJoin('departments as d', 'd.id', 'e.department_id'),
        scope,
        f,
      )
        .where('r.status', 'APPROVED')
        .whereBetween('x.leave_date', [from, to])
        .groupBy(
          'r.id',
          'r.reference',
          'r.start_date',
          'r.end_date',
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'co.name',
          'd.name',
          't.name',
        )
        .select(
          'r.reference',
          'r.start_date',
          'r.end_date',
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'co.name as company',
          'd.name as department',
          't.name as leave_type',
        )
        .sum({ days: 'x.charged' })
        .orderBy(['r.start_date', 'e.last_name']);
      if (f.leaveTypeId) q.where('r.leave_type_id', f.leaveTypeId);
      return (await q).map((r) => ({
        ...personRow(r),
        leaveType: r.leave_type,
        start: r.start_date,
        end: r.end_date,
        daysInRange: r2(r.days),
        reference: r.reference,
      }));
    },
  },

  {
    id: 'ten-days',
    title: 'Not yet taken 10 consecutive annual-leave days',
    description:
      'People whose longest block of annual leave this year is under 10 consecutive working days. Weekends and public holidays inside a block do not break it.',
    levels: ['HR', 'MANAGER'],
    filters: ['year', 'employee', 'company', 'department'],
    columns: [
      ...PERSON_COLS,
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'longest', label: 'Longest block (working days)', type: 'number' },
      { key: 'blockStart', label: 'Block from', type: 'date' },
      { key: 'blockEnd', label: 'Block to', type: 'date' },
      { key: 'totalTaken', label: 'Annual leave taken', type: 'number' },
      { key: 'target', label: 'Target', type: 'number' },
    ],
    async run(db, scope, f) {
      const year = yearOf(f);
      const annual = await db('leave_types').where({ code: 'ANNUAL' }).first('id');
      if (!annual) return [];
      const policy = await db('leave_policy_versions')
        .where({ leave_type_id: annual.id })
        .andWhere('effective_from', '<=', `${year}-12-31`)
        .orderBy('effective_from', 'desc')
        .first('min_consecutive_days_target');
      const target = Number(policy?.min_consecutive_days_target ?? 10);
      const schedule = await db('work_schedules').where({ is_company_default: true }).first();
      const holidays = new Set(
        await db('public_holidays')
          .whereBetween('holiday_date', [`${year}-01-01`, `${year}-12-31`])
          .pluck('holiday_date'),
      );
      const offDay = (d) => Number(schedule?.[`${weekdayKey(d)}_fraction`] ?? 0) === 0 || holidays.has(d);

      const emps = await people(
        db('employees as e')
          .leftJoin('companies as co', 'co.id', 'e.company_id')
          .leftJoin('departments as d', 'd.id', 'e.department_id'),
        scope,
        f,
      )
        .where('e.status', 'ACTIVE')
        .orderBy(['e.last_name', 'e.first_name'])
        .select(
          'e.id',
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'co.name as company',
          'd.name as department',
        );
      const days = emps.length
        ? await db('leave_request_days as x')
            .join('leave_requests as r', 'r.id', 'x.leave_request_id')
            .whereIn(
              'r.employee_id',
              emps.map((e) => e.id),
            )
            .where({ 'r.status': 'APPROVED', 'r.leave_type_id': annual.id })
            .whereBetween('x.leave_date', [`${year}-01-01`, `${year}-12-31`])
            .where('x.charged', '>', 0)
            .orderBy(['r.employee_id', 'x.leave_date'])
            .select('r.employee_id', 'x.leave_date', 'x.charged')
        : [];
      const byEmp = new Map();
      for (const d of days) {
        if (!byEmp.has(d.employee_id)) byEmp.set(d.employee_id, []);
        byEmp.get(d.employee_id).push({ date: d.leave_date, charged: Number(d.charged) });
      }
      const out = [];
      for (const e of emps) {
        const list = byEmp.get(e.id) ?? [];
        let best = { days: 0, start: null, end: null };
        let cur = null;
        for (const d of list) {
          const continues =
            cur &&
            (daysBetween(cur.end, d.date) === 1 ||
              [...eachDate(addDays(cur.end, 1), addDays(d.date, -1))].every(offDay));
          if (continues) {
            cur.days += d.charged;
            cur.end = d.date;
          } else cur = { days: d.charged, start: d.date, end: d.date };
          if (cur.days > best.days) best = { ...cur };
        }
        if (best.days >= target) continue;
        out.push({
          ...personRow(e),
          year,
          longest: r2(best.days),
          blockStart: best.start ?? '',
          blockEnd: best.end ?? '',
          totalTaken: r2(list.reduce((s, d) => s + d.charged, 0)),
          target,
        });
      }
      return out;
    },
  },
];

export const ENTRY_TYPES = Object.entries(ENTRY_LABEL).map(([value, label]) => ({ value, label }));
export const STATUS_OPTIONS = STATUS.map((value) => ({ value, label: STATUS_LABEL[value] }));

export function findReport(id, scope) {
  const r = REPORTS.find((x) => x.id === id);
  if (!r || !r.levels.includes(scope.level)) throw notFound('Report not found.');
  return r;
}
