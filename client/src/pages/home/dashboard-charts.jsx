import { BarList, COLORS, ColumnChart, Legend, Meter } from '../../components/charts.jsx';
import { PERIOD_LABELS, days } from '../../lib/leave.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const dayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const tickFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const asDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

const TAKEN_BOOKED = [
  { key: 'taken', name: 'Taken', color: COLORS.taken },
  { key: 'booked', name: 'Booked', color: COLORS.booked },
];

/** Approved leave days per month: taken so far, and booked for later in the year. */
export function MonthlyLeaveChart({ months, year, empty }) {
  return (
    <div className="space-y-3">
      <Legend items={TAKEN_BOOKED} />
      <ColumnChart
        label={`Approved leave days by month, ${year}`}
        series={TAKEN_BOOKED}
        empty={empty}
        data={months.map((m) => ({
          key: m.month,
          tick: MONTHS[m.month - 1],
          title: `${LONG_MONTHS[m.month - 1]} ${year}`,
          taken: m.taken,
          booked: m.booked,
        }))}
      />
    </div>
  );
}

const OFF = [
  { key: 'approved', name: 'Approved leave', color: COLORS.taken },
  { key: 'pending', name: 'Waiting for a decision', color: COLORS.waiting },
];

/** How many people are off on each of the next 30 days. Weekends are shaded. */
export function PeopleOffChart({ daily, empty }) {
  return (
    <div className="space-y-3">
      <Legend items={[...OFF, { key: 'we', name: 'Weekend', color: COLORS.weekend, outline: true }]} />
      <ColumnChart
        label="People off on each of the next 30 days"
        series={OFF}
        unit="people"
        whole
        height={180}
        empty={empty}
        data={daily.map((d, i) => {
          const date = asDate(d.date);
          const dow = date.getUTCDay();
          return {
            key: d.date,
            // A date under the first column and under each Monday after it.
            tick: i === 0 || dow === 1 ? tickFmt.format(date) : null,
            title: dayFmt.format(date),
            shade: dow === 0 || dow === 6,
            approved: d.approved,
            pending: d.pending,
          };
        })}
      />
    </div>
  );
}

/** Approved days per month by leave type: the three largest types, then the rest together. */
export function LeaveTypeChart({ byType, year, empty }) {
  const series = byType.series.map((s, i) => ({
    ...s,
    color: s.key === 'other' ? COLORS.other : COLORS.series[i],
  }));
  return (
    <div className="space-y-3">
      {series.length > 0 && <Legend items={series} />}
      <ColumnChart
        label={`Approved leave days by month and leave type, ${year}`}
        series={series}
        empty={empty}
        data={byType.months.map((m) => ({
          ...m,
          key: m.month,
          tick: MONTHS[m.month - 1],
          title: `${LONG_MONTHS[m.month - 1]} ${year}`,
        }))}
      />
    </div>
  );
}

/** Requests in the year by where they stand now. */
export function OutcomesChart({ outcomes }) {
  const total = outcomes.reduce((s, o) => s + o.count, 0);
  return (
    <BarList
      empty="No requests this year yet."
      max={total}
      format={(n) => `${n}${total ? ` · ${Math.round((n / total) * 100)}%` : ''}`}
      items={outcomes.map((o) => ({ key: o.key, label: o.label, value: o.count }))}
    />
  );
}

/** Taken, waiting and available as one bar, with the figures beneath it. */
export function BalanceMeter({ b, compact = false }) {
  let parts;
  let headline;
  let of;
  if (b.kind === 'BALANCE') {
    parts = [
      { key: 'taken', name: 'Taken', value: b.taken, color: COLORS.taken },
      { key: 'waiting', name: 'Waiting', value: b.pending, color: COLORS.waiting },
      { key: 'available', name: 'Available', value: Math.max(0, b.available), color: COLORS.track },
    ];
    headline = b.available;
    of = `Out of ${days(Math.round((b.taken + b.balance) * 100) / 100)} for ${b.year}`;
  } else if (b.kind === 'ALLOWANCE') {
    parts = [
      { key: 'taken', name: 'Taken', value: b.taken, color: COLORS.taken },
      { key: 'waiting', name: 'Waiting', value: b.pending, color: COLORS.waiting },
      { key: 'available', name: 'Available', value: b.remaining, color: COLORS.track },
    ];
    headline = b.remaining;
    of = `Out of ${days(b.entitlement)} ${PERIOD_LABELS[b.period] ?? ''}`.trim();
  } else {
    return null;
  }
  return (
    <div className={compact ? '' : 'rounded-md border border-rule bg-white p-4'}>
      {!compact && <p className="text-sm font-medium">{b.leaveType.name}</p>}
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular-nums">{headline}</span>
        <span className="text-sm text-muted">{headline === 1 ? 'day' : 'days'} available</span>
      </p>
      <p className="text-xs text-muted">{of}</p>
      <div className="mt-3">
        <Meter
          label={`${b.leaveType.name}`}
          total={parts.reduce((s, p) => s + p.value, 0)}
          segments={parts.filter((p) => p.key !== 'available')}
          height={12}
        />
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{
                  background: p.color,
                  outline: p.key === 'available' ? '1px solid #c9cfe6' : undefined,
                }}
                aria-hidden
              />
              {p.name}
            </span>
            <span className="mt-0.5 block text-sm font-semibold text-ink tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
      {b.carriedForward > 0 && (
        <p className="mt-2 text-xs text-muted">Includes {days(b.carriedForward)} carried forward</p>
      )}
      {b.eligibility && <p className="mt-2 text-xs text-pending">{b.eligibility}</p>}
    </div>
  );
}
