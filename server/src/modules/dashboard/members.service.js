import { todayInLusaka } from '../../utils/dates.js';
import { addDays } from '../leave/calendar.js';
import { employeeBalances, PENDING_STATES } from '../leave/balance.service.js';
import { getSetting } from '../leave/policy.service.js';

/*
 * Department members (D49). Used by the manager's Department members page and the
 * Department members report. Leave is described by dates only, never by type or reason,
 * so sensitive and confidential leave stays private.
 */

const name = (f, l) => (f ? `${f} ${l}` : null);
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/** People reporting to a manager: direct reports, or the whole line if configured (D2). */
export async function reportsOf(db, managerId) {
  const scope = await getSetting(db, 'manager_scope', 'DIRECT_REPORTS');
  const ids = [];
  let frontier = [managerId];
  const seen = new Set(frontier);
  while (frontier.length) {
    const next = await db('employees')
      .whereIn('line_manager_id', frontier)
      .where({ status: 'ACTIVE' })
      .pluck('id');
    frontier = next.filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
    ids.push(...frontier);
    if (scope !== 'REPORTING_LINE') break;
  }
  return ids;
}

/** Active employees, with the columns the members views need. `scope` narrows the query. */
function peopleQuery(db, scope) {
  const q = db('employees as e')
    .leftJoin('employees as m', 'm.id', 'e.line_manager_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('companies as co', 'co.id', 'e.company_id')
    .where('e.status', 'ACTIVE')
    .orderBy(['e.first_name', 'e.last_name'])
    .select(
      'e.id',
      'e.first_name',
      'e.last_name',
      'e.employee_number',
      'e.job_title',
      'e.email',
      'e.mobile_phone',
      'e.employment_start_date',
      'e.line_manager_id',
      'd.name as dept_name',
      'co.name as company_name',
      'm.first_name as mgr_first',
      'm.last_name as mgr_last',
    );
  scope(q);
  return q;
}

/** Leave position and contact details for a list of people, as of today. */
export async function describeMembers(db, people, viewerId) {
  const today = todayInLusaka();
  const year = Number(today.slice(0, 4));
  const ids = people.map((p) => p.id);
  const open = ids.length
    ? await db('leave_requests')
        .whereIn('employee_id', ids)
        .where((w) =>
          w
            .whereIn('status', PENDING_STATES)
            .orWhere((a) => a.where('status', 'APPROVED').andWhere('end_date', '>=', today)),
        )
        .orderBy('start_date')
        .select(
          'id',
          'employee_id',
          'status',
          'start_date',
          'end_date',
          'start_portion',
          'end_portion',
          'chargeable_days',
        )
    : [];
  // Today counts as leave only if today is a charged day of an approved request.
  const todayRows = ids.length
    ? await db('leave_request_days as x')
        .join('leave_requests as r', 'r.id', 'x.leave_request_id')
        .whereIn('r.employee_id', ids)
        .where({ 'r.status': 'APPROVED', 'x.leave_date': today })
        .where('x.charged', '>', 0)
        .select('r.employee_id', 'r.end_date', 'x.charged')
    : [];
  const in30 = addDays(today, 30);

  const members = [];
  for (const p of people) {
    const mine = open.filter((r) => r.employee_id === p.id);
    const away = todayRows.find((t) => t.employee_id === p.id);
    const next = mine.find((r) => r.status === 'APPROVED' && r.start_date > today);
    const balances = await employeeBalances(db, p.id, year);
    const main = balances.find((b) => b.kind === 'BALANCE');
    members.push({
      id: p.id,
      name: name(p.first_name, p.last_name),
      employeeNumber: p.employee_number,
      jobTitle: p.job_title,
      company: p.company_name,
      department: p.dept_name,
      email: p.email,
      mobilePhone: p.mobile_phone,
      startDate: p.employment_start_date,
      lineManager: name(p.mgr_first, p.mgr_last),
      reportsToYou: viewerId != null && p.line_manager_id === viewerId,
      today: away
        ? { onLeave: true, until: away.end_date, halfDay: Number(away.charged) < 1 }
        : { onLeave: false },
      annual: main ? { leaveType: main.leaveType.name, available: main.available } : null,
      takenThisYear: r2(balances.reduce((n, b) => n + Number(b.taken ?? 0), 0)),
      pendingRequests: mine.filter((r) => PENDING_STATES.includes(r.status)).length,
      nextLeave: next
        ? {
            startDate: next.start_date,
            endDate: next.end_date,
            startPortion: next.start_portion,
            endPortion: next.end_portion,
            chargeableDays: Number(next.chargeable_days),
          }
        : null,
      leaveSoon: !!next && next.start_date <= in30,
    });
  }
  return { year, members };
}

/** Everyone active in the manager's department, plus anyone reporting to them from elsewhere. */
export async function managerMembers(db, managerId, narrow = () => {}) {
  const me = await db('employees').where({ id: managerId }).first('department_id');
  const department = me?.department_id
    ? await db('departments').where({ id: me.department_id }).first('id', 'name')
    : null;
  const reports = await reportsOf(db, managerId);
  const people = await peopleQuery(db, (q) => {
    q.whereNot('e.id', managerId).where((w) => {
      if (department) w.where('e.department_id', department.id);
      if (reports.length) w.orWhereIn('e.id', reports);
      if (!department && !reports.length) w.whereRaw('1 = 0');
    });
    narrow(q);
  });
  return { department, people };
}

/** The Department members page for a manager. */
export async function departmentMembers(db, user) {
  const { department, people } = await managerMembers(db, user.id);
  const { year, members } = await describeMembers(db, people, user.id);
  return {
    department: department?.name ?? null,
    year,
    summary: {
      members: members.length,
      onLeaveToday: members.filter((m) => m.today.onLeave).length,
      atWorkToday: members.filter((m) => !m.today.onLeave).length,
      leaveNext30Days: members.filter((m) => m.leaveSoon).length,
    },
    members,
  };
}

/** People for the report when the viewer sees the whole group. */
export function groupPeople(db, narrow) {
  return peopleQuery(db, narrow);
}
