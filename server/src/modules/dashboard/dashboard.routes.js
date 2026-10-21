import { Router } from 'express';
import { GROUP_VIEW_ROLES, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/validation.js';
import { forbidden } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { addDays, eachDate } from '../leave/calendar.js';
import { workingCalendar, stageSince } from '../leave/working-days.js';
import { employeeBalances, PENDING_STATES } from '../leave/balance.service.js';
import { getSetting } from '../leave/policy.service.js';
import { hrQueue, managerQueue } from '../leave/queries.service.js';
import { departmentMembers } from './members.service.js';
import { monthlyByType, monthlyTakenBooked, peopleOffDaily, requestOutcomes } from './charts.service.js';

/*
 * Dashboards. Every figure is a query scoped to what the viewer may see; nothing is estimated.
 * Lists are capped so a dashboard stays a summary; the full lists live on their own pages.
 */

const name = (f, l) => (f ? `${f} ${l}` : null);
const LIST = 8;

function requestsQuery(db) {
  return db('leave_requests as r')
    .join('employees as e', 'e.id', 'r.employee_id')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .leftJoin('companies as co', 'co.id', 'e.company_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select(
      'r.id',
      'r.reference',
      'r.employee_id',
      'r.start_date',
      'r.end_date',
      'r.start_portion',
      'r.end_portion',
      'r.chargeable_days',
      'r.status',
      'r.submitted_at',
      'r.manager_decided_at',
      'r.assigned_manager_id',
      'r.handover_contact_id',
      'r.handover_notes',
      'r.policy_version_id',
      'e.first_name',
      'e.last_name',
      'e.employee_number',
      'd.name as dept_name',
      'co.name as company_name',
      't.name as type_name',
      't.is_confidential',
    );
}

/** Request summary. Reasons and documents are never included; approvers see the leave type. */
function item(r) {
  return {
    id: r.id,
    reference: r.reference,
    employee: {
      id: r.employee_id,
      name: name(r.first_name, r.last_name),
      company: r.company_name ?? null,
      department: r.dept_name ?? null,
    },
    leaveType: r.type_name,
    startDate: r.start_date,
    endDate: r.end_date,
    startPortion: r.start_portion,
    endPortion: r.end_portion,
    chargeableDays: Number(r.chargeable_days),
    status: r.status,
  };
}

async function withAge(db, rows, today, thresholdKey) {
  if (!rows.length) return [];
  const earliest = rows.map(stageSince).filter(Boolean).sort()[0] ?? today;
  const age = await workingCalendar(db, earliest, today);
  const threshold = Number(await getSetting(db, thresholdKey, 3));
  return rows.map((r) => {
    const since = stageSince(r);
    const days = since ? age(since) : 0;
    return { ...item(r), waitingSince: since, workingDaysWaiting: days, overdue: days > threshold };
  });
}

/** Team members a manager sees: direct reports, or the whole reporting line if configured (D2). */
async function teamOf(db, managerId) {
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

/** Days in a window when two or more of the given people are off (approved or pending). */
function overlaps(rows, from, to) {
  const byDay = new Map();
  for (const r of rows) {
    const s = r.start_date > from ? r.start_date : from;
    const e = r.end_date < to ? r.end_date : to;
    for (const d of eachDate(s, e)) {
      if (!byDay.has(d)) byDay.set(d, new Map());
      byDay.get(d).set(r.employee_id, name(r.first_name, r.last_name));
    }
  }
  // Merge consecutive days with the same group of people into one period.
  const periods = [];
  for (const d of [...byDay.keys()].sort()) {
    const people = byDay.get(d);
    if (people.size < 2) continue;
    const key = [...people.keys()].sort().join(',');
    const last = periods[periods.length - 1];
    if (last && last.key === key && addDays(last.endDate, 1) === d) last.endDate = d;
    else periods.push({ key, startDate: d, endDate: d, people: [...people.values()].sort() });
  }
  return periods.map(({ key: _k, ...p }) => p);
}

async function documentsMissing(db, requestIds) {
  if (!requestIds.length) return new Set();
  const rows = await db('leave_requests as r')
    .join('leave_policy_versions as p', 'p.id', 'r.policy_version_id')
    .leftJoin('documents as d', function joinDocs() {
      this.on('d.leave_request_id', 'r.id').andOnNull('d.deleted_at');
    })
    .whereIn('r.id', requestIds)
    .where('p.document_required', true)
    .groupBy('r.id')
    .havingRaw('COUNT(d.id) = 0')
    .pluck('r.id');
  return new Set(rows);
}

export function dashboardRoutes({ db }) {
  const router = Router();

  // ---------------------------------------------------------------------------------------
  router.get(
    '/employee',
    asyncHandler(async (req, res) => {
      const me = req.user.id;
      const today = todayInLusaka();
      const year = Number(today.slice(0, 4));
      const balances = await employeeBalances(db, me, year);

      const pending = await requestsQuery(db)
        .where('r.employee_id', me)
        .whereIn('r.status', PENDING_STATES)
        .orderBy('r.start_date');
      const upcoming = await requestsQuery(db)
        .where('r.employee_id', me)
        .where('r.status', 'APPROVED')
        .andWhere('r.end_date', '>=', today)
        .orderBy('r.start_date')
        .limit(LIST);

      const missing = await documentsMissing(
        db,
        [...pending, ...upcoming].map((r) => r.id),
      );
      const actions = [
        ...pending
          .filter((r) => r.status === 'PENDING_EMPLOYEE_ACCEPTANCE')
          .map((r) => ({
            kind: 'ANSWER_OFFER',
            requestId: r.id,
            text: `${r.reference}: your manager offered different dates. Accept them or withdraw the request.`,
          })),
        ...pending
          .filter((r) => r.status === 'RETURNED_FOR_CORRECTION')
          .map((r) => ({
            kind: 'RESUBMIT',
            requestId: r.id,
            text: `${r.reference}: HR returned this request. Correct it and resubmit.`,
          })),
        ...[...pending, ...upcoming]
          .filter((r) => missing.has(r.id))
          .map((r) => ({
            kind: 'DOCUMENT',
            requestId: r.id,
            text: `${r.reference}: upload the supporting document for your ${r.type_name.toLowerCase()}.`,
          })),
      ];

      // Insight figures, each from the same data the rest of the page uses.
      const taken = balances.reduce((sum, b) => sum + Number(b.taken ?? 0), 0);
      const main = balances.find((b) => b.kind === 'BALANCE') ?? null;
      const nextLeave = upcoming.find((r) => r.start_date > today) ?? null;
      const onLeaveNow = upcoming.find((r) => r.start_date <= today) ?? null;
      let teamApprovals = null;
      if (req.user.isManager || req.user.isDelegate) {
        const mq = await managerQueue(db, req.user);
        teamApprovals = mq.requests.length + mq.changes.length;
      }
      let hrApprovals = null;
      if (req.user.roles.includes('HR_OFFICER')) {
        const hq = await hrQueue(db, req.user);
        hrApprovals = hq.requests.filter((r) => !r.isOwn).length + hq.changes.length;
      }

      // Recent activity: what happened on the viewer's own requests, and decisions they made.
      const activity = await db('approval_actions as a')
        .leftJoin('change_requests as c', 'c.id', 'a.change_request_id')
        .joinRaw('JOIN leave_requests as r ON r.id = COALESCE(a.leave_request_id, c.leave_request_id)')
        .join('leave_types as t', 't.id', 'r.leave_type_id')
        .join('employees as o', 'o.id', 'r.employee_id')
        .leftJoin('employees as x', 'x.id', 'a.actor_id')
        .where((w) => w.where('r.employee_id', me).orWhere('a.actor_id', me))
        .whereNot('a.action', 'ROUTE')
        .orderBy('a.id', 'desc')
        .limit(LIST)
        .select(
          'a.id',
          'a.action',
          'a.stage',
          'a.created_at',
          'a.actor_id',
          'a.change_request_id',
          'c.change_type',
          'r.id as request_id',
          'r.reference',
          'r.employee_id',
          't.name as type_name',
          'o.first_name as owner_first',
          'o.last_name as owner_last',
          'x.first_name',
          'x.last_name',
        );

      // Active leave: approved leave running today. Days left counts today and the remaining
      // charged days of the stored day breakdown, so it goes down by itself day by day.
      const running = upcoming.filter((r) => r.start_date <= today);
      const daysLeft = running.length
        ? await db('leave_request_days')
            .whereIn(
              'leave_request_id',
              running.map((r) => r.id),
            )
            .andWhere('leave_date', '>=', today)
            .groupBy('leave_request_id')
            .select('leave_request_id', db.raw('SUM(charged) as left_days'))
        : [];
      const leftById = new Map(daysLeft.map((x) => [x.leave_request_id, Number(x.left_days)]));

      const charts = {
        monthly: await monthlyTakenBooked(db, (q) => q.where('r.employee_id', me), year, today),
      };

      res.json({
        year,
        charts,
        active: running.map((r) => ({ ...item(r), daysLeft: leftById.get(r.id) ?? 0 })),
        insights: {
          main: main
            ? { leaveType: main.leaveType.name, available: main.available, balance: main.balance }
            : null,
          takenThisYear: Math.round(taken * 100) / 100,
          awaitingDecision: pending.length,
          nextLeave: nextLeave ? item(nextLeave) : null,
          onLeaveNow: onLeaveNow ? item(onLeaveNow) : null,
          teamApprovals,
          hrApprovals,
        },
        activity: activity.map((a) => ({
          id: a.id,
          requestId: a.request_id,
          reference: a.reference,
          leaveType: a.type_name,
          action: a.action,
          stage: a.stage,
          change: a.change_request_id ? a.change_type : null,
          own: a.employee_id === me,
          owner: name(a.owner_first, a.owner_last),
          byMe: a.actor_id === me,
          by: name(a.first_name, a.last_name) ?? 'System',
          at: a.created_at,
        })),
        balances,
        pending: pending.map((r) => item(r)),
        upcoming: upcoming.map((r) => item(r)),
        actions,
      });
    }),
  );

  // ---------------------------------------------------------------------------------------
  // Department members (D49): everyone active in the manager's department, plus anyone who
  // reports to them from elsewhere. Leave types and reasons are never shown here, only dates,
  // so sensitive or confidential leave stays private.
  router.get(
    '/members',
    asyncHandler(async (req, res) => {
      if (!req.user.isManager) throw forbidden('Department members is for managers.');
      res.json(await departmentMembers(db, req.user));
    }),
  );

  // ---------------------------------------------------------------------------------------
  router.get(
    '/manager',
    asyncHandler(async (req, res) => {
      const { user } = req;
      if (!user.isManager && !user.isDelegate && !user.roles.includes('HR_ADMIN')) {
        throw forbidden('This dashboard is for managers.');
      }
      const today = todayInLusaka();
      const horizon = addDays(today, 30);

      const delegators = await db('delegations')
        .where({ delegate_id: user.id })
        .whereNull('revoked_at')
        .andWhere('start_date', '<=', today)
        .andWhere('end_date', '>=', today)
        .pluck('delegator_id');
      const approvers = [user.id, ...delegators];
      if ((await getSetting(db, 'manager_scope', 'DIRECT_REPORTS')) === 'REPORTING_LINE') {
        approvers.push(...(await teamOf(db, user.id)));
      }
      const awaiting = await requestsQuery(db)
        .where('r.status', 'PENDING_MANAGER_APPROVAL')
        .whereIn('r.assigned_manager_id', approvers)
        .whereNot('r.employee_id', user.id)
        .orderBy('r.submitted_at');
      const awaitingChanges = await db('change_requests')
        .where({ status: 'PENDING_MANAGER_APPROVAL' })
        .whereIn('assigned_manager_id', approvers)
        .count({ n: '*' })
        .first();

      const team = await teamOf(db, user.id);
      const teamRequests = team.length
        ? await requestsQuery(db)
            .whereIn('r.employee_id', team)
            .whereIn('r.status', ['APPROVED', 'PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL'])
            .andWhere('r.start_date', '<=', horizon)
            .andWhere('r.end_date', '>=', today)
            .orderBy('r.start_date')
        : [];
      const onLeave = teamRequests.filter(
        (r) => r.status === 'APPROVED' && r.start_date <= today && r.end_date >= today,
      );
      const upcoming = teamRequests.filter((r) => r.start_date > today);
      const handovers = teamRequests.filter(
        (r) => r.status === 'APPROVED' && r.start_date > today && !r.handover_contact_id,
      );

      const inTeam = (q) => q.whereIn('r.employee_id', team.length ? team : [0]);
      const year = Number(today.slice(0, 4));
      const charts = {
        year,
        offDaily: await peopleOffDaily(db, inTeam, today, 30),
        monthly: await monthlyTakenBooked(db, inTeam, year, today),
      };

      res.json({
        charts,
        teamSize: team.length,
        awaiting: await withAge(db, awaiting, today, 'overdue_manager_working_days'),
        awaitingChanges: Number(awaitingChanges.n),
        onLeave: onLeave.map((r) => item(r)),
        upcoming: upcoming.map((r) => item(r)),
        overlaps: overlaps(teamRequests, today, horizon),
        handoversOutstanding: handovers.map((r) => ({
          ...item(r),
          hasNotes: Boolean(r.handover_notes),
        })),
        coveringFor: delegators.length
          ? (await db('employees').whereIn('id', delegators).select('first_name', 'last_name')).map((e) =>
              name(e.first_name, e.last_name),
            )
          : [],
      });
    }),
  );

  // ---------------------------------------------------------------------------------------
  router.get(
    '/hr',
    requireRole(...GROUP_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      const today = todayInLusaka();
      const year = Number(today.slice(0, 4));
      // Optional: one company in the group. Every employee-based figure below is limited to it.
      const companyId = Number(req.query.companyId) || null;
      const inCompany = (q) => (companyId ? q.where('e.company_id', companyId) : q);

      const atHr = await requestsQuery(db)
        .modify(inCompany)
        .where('r.status', 'PENDING_HR_APPROVAL')
        .orderBy('r.submitted_at');
      const withManagers = await requestsQuery(db)
        .modify(inCompany)
        .select('m.status as manager_status', 'm.first_name as m_first', 'm.last_name as m_last')
        .leftJoin('employees as m', 'm.id', 'r.assigned_manager_id')
        .where('r.status', 'PENDING_MANAGER_APPROVAL')
        .orderBy('r.submitted_at');
      const hrAged = await withAge(db, atHr, today, 'overdue_hr_working_days');
      const mgrAged = (await withAge(db, withManagers, today, 'overdue_manager_working_days')).map(
        (x, i) => ({
          ...x,
          manager: name(withManagers[i].m_first, withManagers[i].m_last),
        }),
      );
      // Held: waiting for a manager who can no longer act.
      const held = withManagers
        .map((r, i) => ({ r, aged: mgrAged[i] }))
        .filter(({ r }) => !r.assigned_manager_id || r.manager_status !== 'ACTIVE')
        .map(({ aged }) => aged);

      const unconfirmedTypes = await db('leave_types as t')
        .join('leave_policy_versions as p', function latest() {
          this.on('p.leave_type_id', 't.id').andOnNull('p.effective_to');
        })
        .where((w) => w.where('t.is_active', false).orWhere('p.requires_hr_confirmation', true))
        .select('t.name', 't.is_active', 'p.requires_hr_confirmation');
      const accrualUnconfirmed = await db('leave_types as t')
        .join('leave_policy_versions as p', function latest() {
          this.on('p.leave_type_id', 't.id').andOnNull('p.effective_to');
        })
        .where('p.consumes_balance', true)
        .whereNot('p.accrual_method', 'NONE')
        .where('p.accrual_confirmed', false)
        .pluck('t.name');
      const unconfirmedSettings = await db('system_settings')
        .where({ requires_hr_confirmation: true })
        .pluck('setting_key');
      const failedEmails = await db('email_outbox')
        .whereIn('status', ['FAILED', 'DEAD'])
        .count({ n: '*' })
        .first();

      const openIds = await db('leave_requests as r')
        .join('employees as e', 'e.id', 'r.employee_id')
        .modify(inCompany)
        .whereIn('r.status', ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL', 'APPROVED'])
        .andWhere('r.end_date', '>=', addDays(today, -30))
        .pluck('r.id');
      const missingIds = [...(await documentsMissing(db, openIds))];
      const missingDocs = missingIds.length
        ? await requestsQuery(db).whereIn('r.id', missingIds).orderBy('r.start_date').limit(LIST)
        : [];

      const onLeave = await requestsQuery(db)
        .modify(inCompany)
        .where('r.status', 'APPROVED')
        .andWhere('r.start_date', '<=', today)
        .andWhere('r.end_date', '>=', today)
        .orderBy('e.last_name');

      // Utilisation: annual-leave days approved this year per company and department, against headcount.
      const annual = await db('leave_types').where({ code: 'ANNUAL' }).first('id');
      const heads = await db('employees as e')
        .leftJoin('companies as co', 'co.id', 'e.company_id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .modify(inCompany)
        .where('e.status', 'ACTIVE')
        .groupBy('e.company_id', 'co.name', 'e.department_id', 'd.name')
        .select('e.company_id', 'co.name as company', 'e.department_id', 'd.name as department')
        .count({ n: '*' });
      const taken = annual
        ? await db('leave_request_days as x')
            .join('leave_requests as r', 'r.id', 'x.leave_request_id')
            .join('employees as e', 'e.id', 'r.employee_id')
            .modify(inCompany)
            .where({ 'r.status': 'APPROVED', 'r.leave_type_id': annual.id })
            .whereBetween('x.leave_date', [`${year}-01-01`, `${year}-12-31`])
            .groupBy('e.company_id', 'e.department_id')
            .select('e.company_id', 'e.department_id')
            .sum({ days: 'x.charged' })
        : [];
      const key = (r) => `${r.company_id ?? ''}|${r.department_id ?? ''}`;
      const takenBy = new Map(taken.map((t) => [key(t), Number(t.days)]));
      const round = (n) => Math.round(n * 100) / 100;
      const perPerson = (days, n) => (n ? Math.round((days / n) * 10) / 10 : 0);
      const utilisation = heads
        .map((h) => {
          const days = round(takenBy.get(key(h)) ?? 0);
          return {
            company: h.company ?? 'No company',
            department: h.department ?? 'No department',
            headcount: Number(h.n),
            annualDaysApproved: days,
            perPerson: perPerson(days, Number(h.n)),
          };
        })
        .sort((a, b) => a.company.localeCompare(b.company) || a.department.localeCompare(b.department));
      const byCompany = new Map();
      for (const u of utilisation) {
        const c = byCompany.get(u.company) ?? { company: u.company, headcount: 0, annualDaysApproved: 0 };
        c.headcount += u.headcount;
        c.annualDaysApproved = round(c.annualDaysApproved + u.annualDaysApproved);
        byCompany.set(u.company, c);
      }
      const companySummary = [...byCompany.values()].map((c) => ({
        ...c,
        perPerson: perPerson(c.annualDaysApproved, c.headcount),
      }));
      const companies = await db('companies').where({ is_active: true }).orderBy('name').select('id', 'name');

      // Carry-forward still unused before this year's expiry date.
      let carryForward = { expiry: null, items: [] };
      if (annual) {
        const p = await db('leave_policy_versions')
          .where({ leave_type_id: annual.id })
          .andWhere('effective_from', '<=', today)
          .andWhere((w) => w.whereNull('effective_to').orWhere('effective_to', '>=', today))
          .first('carry_forward_expiry_month', 'carry_forward_expiry_day');
        if (p?.carry_forward_expiry_month) {
          const expiry = `${year}-${String(p.carry_forward_expiry_month).padStart(2, '0')}-${String(p.carry_forward_expiry_day).padStart(2, '0')}`;
          if (today <= expiry) {
            const rows = await db('balance_ledger as l')
              .join('employees as e', 'e.id', 'l.employee_id')
              .modify(inCompany)
              .where({
                'l.leave_type_id': annual.id,
                'l.leave_year': year,
                'l.entry_type': 'CARRY_FORWARD_IN',
              })
              .groupBy('l.employee_id', 'e.first_name', 'e.last_name')
              .select('l.employee_id', 'e.first_name', 'e.last_name')
              .sum({ carried: 'l.amount' });
            const items = [];
            for (const r of rows) {
              const used = await db('leave_request_days as x')
                .join('leave_requests as q', 'q.id', 'x.leave_request_id')
                .where({
                  'q.employee_id': r.employee_id,
                  'q.leave_type_id': annual.id,
                  'q.status': 'APPROVED',
                })
                .whereBetween('x.leave_date', [`${year}-01-01`, expiry])
                .sum({ d: 'x.charged' })
                .first();
              const left = Math.round(Math.max(0, Number(r.carried) - Number(used.d ?? 0)) * 100) / 100;
              if (left > 0)
                items.push({
                  employeeId: r.employee_id,
                  name: name(r.first_name, r.last_name),
                  carried: Number(r.carried),
                  unused: left,
                });
            }
            carryForward = { expiry, items: items.sort((a, b) => b.unused - a.unused) };
          }
        }
      }

      const charts = {
        year,
        offDaily: await peopleOffDaily(db, inCompany, today, 30),
        monthlyByType: await monthlyByType(db, inCompany, year, 3),
        outcomes: await requestOutcomes(db, inCompany, year),
      };

      res.json({
        charts,
        awaitingHr: hrAged,
        withManagers: mgrAged,
        exceptions: {
          overdue: [...hrAged, ...mgrAged].filter((r) => r.overdue).length,
          held,
          unconfirmedTypes: unconfirmedTypes.map((t) => ({
            name: t.name,
            reason: !t.is_active ? 'Inactive – awaiting review' : 'Rules not confirmed',
          })),
          accrualUnconfirmed,
          unconfirmedSettings,
          failedEmails: Number(failedEmails.n),
          missingDocuments: { count: missingIds.length, items: missingDocs.map((r) => item(r)) },
        },
        onLeave: onLeave.map((r) => item(r)),
        companies,
        companyId,
        utilisation: { year, rows: utilisation, companies: companySummary },
        carryForward,
      });
    }),
  );

  return router;
}
