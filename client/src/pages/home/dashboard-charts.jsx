import { COLORS, ColumnChart, Donut, Legend, Meter } from '../../components/charts.jsx';
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
        label={`Approved Leave Days By Month, ${year}`}
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
        label="People Off On Each Of The Next 30 Days"
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
        label={`Approved Leave Days By Month And Leave Type, ${year}`}
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

/**
 * One leave type at a glance: how many days are left in large print, a bar of what is used and
 * waiting, one short line with those figures, and the allowance as a small note. Types with no
 * fixed limit (per occasion, unlimited) show what they allow and what was taken this year.
 */
export function BalanceMeter({ b, compact = false }) {
  const card = compact ? '' : 'flex h-full flex-col rounded-md border border-rule bg-white p-4 shadow-card';
  const title = !compact && <p className="font-medium text-ink">{b.leaveType.name}</p>;
  const note = (text) => text && <p className="mt-auto pt-3 text-xs text-muted">{text}</p>;
  const warn = b.eligibility && <p className="mt-2 text-xs text-pending">{b.eligibility}</p>;

  if (b.kind === 'PER_OCCASION' || b.kind === 'UNLIMITED') {
    return (
      <div className={card}>
        {title}
        <p className="mt-2 text-lg font-semibold text-ink">
          {b.kind === 'UNLIMITED'
            ? 'No fixed limit'
            : b.maxPerRequest
              ? `Up to ${days(b.maxPerRequest)} each time`
              : 'As needed'}
        </p>
        <p className="mt-1 text-sm text-muted">
          {b.taken ? `${days(b.taken)} taken this year` : 'None taken this year'}
          {b.pending ? ` · ${days(b.pending)} waiting` : ''}
        </p>
        {warn}
      </div>
    );
  }
  if (b.kind !== 'BALANCE' && b.kind !== 'ALLOWANCE') return null;

  const left = Math.max(0, b.kind === 'BALANCE' ? b.available : b.remaining);
  const total = b.kind === 'BALANCE' ? Math.round((b.taken + b.balance) * 100) / 100 : Number(b.entitlement);
  const allowance =
    b.kind === 'BALANCE'
      ? total > 0
        ? `${days(total)} for ${b.year}${b.carriedForward > 0 ? `, including ${days(b.carriedForward)} carried forward` : ''}`
        : `No days for ${b.year} yet`
      : `${days(total)} ${PERIOD_LABELS[b.period] ?? ''}`.trim();
  const used = [
    { key: 'taken', name: 'Used', value: b.taken, color: COLORS.taken },
    { key: 'waiting', name: 'Waiting', value: b.pending, color: COLORS.waiting },
  ];
  return (
    <div className={card}>
      {title}
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-3xl font-semibold tabular-nums ${left > 0 ? 'text-ink' : 'text-muted'}`}>
          {left}
        </span>
        <span className="text-sm text-muted">{left === 1 ? 'day' : 'days'} left</span>
      </p>
      <div className="mt-3">
        <Meter
          label={b.leaveType.name}
          total={Math.max(total, b.taken + b.pending)}
          segments={used}
          height={8}
        />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {used.map((u) => (
          <span key={u.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full" style={{ background: u.color }} aria-hidden />
            <span className="font-semibold text-ink tabular-nums">{u.value}</span> {u.name.toLowerCase()}
          </span>
        ))}
      </p>
      {warn}
      {note(allowance)}
    </div>
  );
}

/** Annual leave as a ring: taken, waiting for a decision, and still available. */
export function BalanceDonut({ b }) {
  return (
    <Donut
      label={`${b.leaveType.name} ${b.year}`}
      centre={b.available}
      centreLabel="days available"
      segments={[
        { key: 'taken', name: 'Taken', value: b.taken, color: COLORS.taken },
        { key: 'waiting', name: 'Waiting for a decision', value: b.pending, color: COLORS.waiting },
        {
          key: 'available',
          name: 'Available',
          value: Math.max(0, b.available),
          color: COLORS.track,
          outline: true,
        },
      ]}
    />
  );
}

/** Share of days by leave type: the three largest named, the rest together. */
export function TypeDonut({ items, label, empty }) {
  const ranked = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const named = ranked.slice(0, 3).map((i, n) => ({ ...i, color: COLORS.series[n] }));
  const rest = ranked.slice(3).reduce((s, i) => s + i.value, 0);
  const segments =
    rest > 0
      ? [
          ...named,
          { key: 'other', name: 'Other types', value: Math.round(rest * 100) / 100, color: COLORS.other },
        ]
      : named;
  return <Donut label={label} segments={segments} unit="days" empty={empty} />;
}

const OUTCOME_COLORS = {
  approved: COLORS.taken,
  waiting: COLORS.waiting,
  rejected: '#c53030',
  withdrawn: COLORS.other,
};

/** Requests in the year by where they stand now. */
export function OutcomesDonut({ outcomes }) {
  return (
    <Donut
      label="Requests By Outcome"
      unit="requests"
      empty="No requests this year yet."
      segments={outcomes.map((o) => ({
        key: o.key,
        name: o.label,
        value: o.count,
        color: OUTCOME_COLORS[o.key],
      }))}
    />
  );
}

/** The team today: on approved leave, and at work. */
export function TeamTodayDonut({ size, onLeave }) {
  return (
    <Donut
      label="Your Team Today"
      centre={size}
      centreLabel={size === 1 ? 'person' : 'people'}
      empty="Nobody reports to you yet."
      segments={[
        { key: 'leave', name: 'On leave today', value: onLeave, color: COLORS.taken },
        {
          key: 'work',
          name: 'At work',
          value: Math.max(0, size - onLeave),
          color: COLORS.track,
          outline: true,
        },
      ]}
    />
  );
}
