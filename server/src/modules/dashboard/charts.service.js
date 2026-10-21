import { addDays } from '../leave/calendar.js';

/*
 * Figures behind the dashboard charts. Each one is counted from the stored day breakdown
 * (leave_request_days), so a half day counts as 0.5 and weekends and public holidays never count.
 * `scope` limits the employees counted, exactly as the rest of the dashboard does.
 */

const round = (n) => Math.round(n * 100) / 100;
const OFF_STATES = ['APPROVED', 'PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL'];

function daysQuery(db, scope) {
  return db('leave_request_days as x')
    .join('leave_requests as r', 'r.id', 'x.leave_request_id')
    .join('employees as e', 'e.id', 'r.employee_id')
    .where('x.charged', '>', 0)
    .modify(scope);
}

/**
 * Approved leave days per month of a year, split into days already taken (before today) and
 * days booked (today onwards).
 */
export async function monthlyTakenBooked(db, scope, year, today) {
  const rows = await daysQuery(db, scope)
    .where('r.status', 'APPROVED')
    .whereBetween('x.leave_date', [`${year}-01-01`, `${year}-12-31`])
    .groupByRaw('MONTH(x.leave_date), x.leave_date < ?', [today])
    .select(db.raw('MONTH(x.leave_date) as m'), db.raw('x.leave_date < ? as past', [today]))
    .sum({ days: 'x.charged' });
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, taken: 0, booked: 0 }));
  for (const r of rows) {
    const slot = months[Number(r.m) - 1];
    slot[Number(r.past) ? 'taken' : 'booked'] = round(
      slot[Number(r.past) ? 'taken' : 'booked'] + Number(r.days),
    );
  }
  return months;
}

/**
 * Approved leave days per month of a year by leave type: the `top` types with the most days are
 * named and every other type is folded into "Other", so a chart never needs more than top + 1 colours.
 */
export async function monthlyByType(db, scope, year, top = 3) {
  const rows = await daysQuery(db, scope)
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .where('r.status', 'APPROVED')
    .whereBetween('x.leave_date', [`${year}-01-01`, `${year}-12-31`])
    .groupByRaw('MONTH(x.leave_date), t.id, t.name')
    .select(db.raw('MONTH(x.leave_date) as m'), 't.id', 't.name')
    .sum({ days: 'x.charged' });
  const totals = new Map();
  for (const r of rows)
    totals.set(r.id, { name: r.name, days: (totals.get(r.id)?.days ?? 0) + Number(r.days) });
  const ranked = [...totals.entries()].sort((a, b) => b[1].days - a[1].days);
  const named = ranked.slice(0, top).map(([id, t]) => ({ key: `t${id}`, id, name: t.name }));
  const hasOther = ranked.length > top;
  const series = [...named, ...(hasOther ? [{ key: 'other', name: 'Other types' }] : [])];
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    ...Object.fromEntries(series.map((s) => [s.key, 0])),
  }));
  for (const r of rows) {
    const key = named.find((n) => n.id === r.id)?.key ?? 'other';
    months[Number(r.m) - 1][key] = round(months[Number(r.m) - 1][key] + Number(r.days));
  }
  return { series: series.map(({ key, name }) => ({ key, name })), months };
}

/**
 * People off on each day of a window, from today: approved leave and leave still waiting for a
 * decision are counted apart. A person with both on one day counts once, as approved.
 */
export async function peopleOffDaily(db, scope, from, days = 30) {
  const to = addDays(from, days - 1);
  const rows = await daysQuery(db, scope)
    .whereIn('r.status', OFF_STATES)
    .whereBetween('x.leave_date', [from, to])
    .distinct('x.leave_date', 'r.employee_id', 'r.status');
  const byDay = new Map();
  for (const r of rows) {
    const d = String(r.leave_date).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, { approved: new Set(), pending: new Set() });
    byDay.get(d)[r.status === 'APPROVED' ? 'approved' : 'pending'].add(r.employee_id);
  }
  const out = [];
  for (let i = 0, d = from; i < days; i += 1, d = addDays(d, 1)) {
    const day = byDay.get(d);
    const approved = day ? day.approved.size : 0;
    const pending = day ? [...day.pending].filter((id) => !day.approved.has(id)).length : 0;
    out.push({ date: d, approved, pending });
  }
  return out;
}

/** Requests submitted in a year, grouped by where they stand now. */
export async function requestOutcomes(db, scope, year) {
  const rows = await db('leave_requests as r')
    .join('employees as e', 'e.id', 'r.employee_id')
    .modify(scope)
    .whereNot('r.status', 'DRAFT')
    .whereBetween('r.start_date', [`${year}-01-01`, `${year}-12-31`])
    .groupBy('r.status')
    .select('r.status')
    .count({ n: '*' });
  const n = (...states) => rows.filter((r) => states.includes(r.status)).reduce((s, r) => s + Number(r.n), 0);
  return [
    { key: 'approved', label: 'Approved', count: n('APPROVED') },
    {
      key: 'waiting',
      label: 'Waiting for a decision',
      count: n(
        'PENDING_MANAGER_APPROVAL',
        'PENDING_HR_APPROVAL',
        'PENDING_EMPLOYEE_ACCEPTANCE',
        'RETURNED_FOR_CORRECTION',
      ),
    },
    { key: 'rejected', label: 'Rejected', count: n('REJECTED_BY_MANAGER', 'REJECTED_BY_HR') },
    { key: 'withdrawn', label: 'Withdrawn or cancelled', count: n('WITHDRAWN', 'CANCELLED') },
  ];
}

/** Approved leave days in a year for each leave type, largest first. */
export async function daysByType(db, scope, year) {
  const rows = await daysQuery(db, scope)
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .where('r.status', 'APPROVED')
    .whereBetween('x.leave_date', [`${year}-01-01`, `${year}-12-31`])
    .groupBy('t.id', 't.name')
    .select('t.id', 't.name')
    .sum({ days: 'x.charged' });
  return rows
    .map((r) => ({ key: r.id, name: r.name, value: round(Number(r.days)) }))
    .sort((a, b) => b.value - a.value);
}
