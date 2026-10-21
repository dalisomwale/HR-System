import { COLORS, ColumnChart, Donut, Legend } from '../../components/charts.jsx';

/*
 * Statistic charts for Employee management (D54). Colours keep one meaning across pages:
 * employment type is blue (permanent), orange (fixed-term), green (temporary), grey (not
 * recorded); joined is blue and left is orange, as on the Home page.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = [
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

export const TYPE_SERIES = [
  { key: 'PERMANENT', name: 'Permanent', color: COLORS.series[0] },
  { key: 'FIXED_TERM', name: 'Fixed-term', color: COLORS.series[1] },
  { key: 'TEMPORARY', name: 'Temporary', color: COLORS.series[2] },
  { key: 'NONE', name: 'Not recorded', color: COLORS.other },
];
const MOVES = [
  { key: 'joined', name: 'Joined', color: COLORS.taken },
  { key: 'left', name: 'Left', color: COLORS.waiting },
];
const BAND_TICKS = { lt1: 'Under 1', y1to2: '1–2', y2to5: '2–5', y5to10: '5–10', gt10: '10+' };

/** Staff at the end of each of the last 12 months. */
export function HeadcountTrend({ trend }) {
  return (
    <ColumnChart
      label="Staff at the end of each of the last 12 months"
      unit="people"
      whole
      series={[{ key: 'headcount', name: 'Staff', color: COLORS.taken }]}
      data={trend.map((t, i) => ({
        key: `${t.year}-${t.month}`,
        tick: MONTHS[t.month - 1],
        title:
          i === trend.length - 1
            ? `Today (${LONG[t.month - 1]} ${t.year})`
            : `End of ${LONG[t.month - 1]} ${t.year}`,
        headcount: t.headcount,
      }))}
    />
  );
}

/** Active staff by time with the group. bands: [{ key, label, count }]. */
export function ServiceChart({ bands }) {
  return (
    <div className="space-y-2">
      <ColumnChart
        label="Active staff by length of service"
        unit="people"
        whole
        empty="No active staff yet."
        series={[{ key: 'count', name: 'Staff', color: COLORS.taken }]}
        data={bands.map((b) => ({ key: b.key, tick: BAND_TICKS[b.key], title: b.label, count: b.count }))}
      />
      <p className="text-xs text-muted">Years with the group</p>
    </div>
  );
}

/** Add up the service bands of several groups. */
export function sumBands(groups) {
  const keys = Object.keys(BAND_TICKS);
  const labels = {
    lt1: 'Under 1 year',
    y1to2: '1 to 2 years',
    y2to5: '2 to 5 years',
    y5to10: '5 to 10 years',
    gt10: 'Over 10 years',
  };
  return keys.map((k) => ({
    key: k,
    label: labels[k],
    count: groups.reduce((s, g) => s + (g.serviceBands?.[k] ?? 0), 0),
  }));
}

/** Employment type as a ring. */
export function TypeDonutChart({ byType, label = 'Active staff by employment type' }) {
  return (
    <Donut
      label={label}
      unit="people"
      empty="No active staff yet."
      segments={TYPE_SERIES.map((s) => ({ ...s, value: byType?.[s.key] ?? 0 })).filter(
        (s) => s.value > 0 || s.key !== 'NONE',
      )}
    />
  );
}

/** Add up employment types across groups. */
export function sumTypes(groups) {
  const out = { PERMANENT: 0, FIXED_TERM: 0, TEMPORARY: 0, NONE: 0 };
  for (const g of groups) for (const k of Object.keys(out)) out[k] += g.byType?.[k] ?? 0;
  return out;
}

/** Staff in each group, split by employment type. groups: [{ key, tick, title, byType }]. */
export function TypesByGroup({ groups, label }) {
  return (
    <div className="space-y-3">
      <Legend items={TYPE_SERIES} />
      <ColumnChart
        label={label}
        unit="people"
        whole
        empty="No active staff yet."
        series={TYPE_SERIES}
        data={groups.map((g) => ({ key: g.key, tick: g.tick, title: g.title, ...g.byType }))}
      />
    </div>
  );
}

/** Joined and left this year in each group. groups: [{ key, tick, title, joined, left }]. */
export function MovesByGroup({ groups, label }) {
  return (
    <div className="space-y-3">
      <Legend items={MOVES} />
      <ColumnChart
        label={label}
        unit="people"
        whole
        grouped
        series={MOVES}
        data={groups.map((g) => ({
          key: g.key,
          tick: g.tick,
          title: g.title,
          joined: g.joined,
          left: g.left,
        }))}
      />
    </div>
  );
}

/** A short axis label: the code when there is one, else the name cut to fit. */
export const shortName = (g) => g.code || (g.name.length > 12 ? `${g.name.slice(0, 11)}…` : g.name);

/* Gender (D61), from the Female/Male recorded on each employee record. */
export const SEX_SERIES = [
  { key: 'FEMALE', name: 'Female', color: '#6250d6' },
  { key: 'MALE', name: 'Male', color: '#eda100' },
  { key: 'NONE', name: 'Not recorded', color: COLORS.other },
];

/** Staff by gender as a ring. */
export function GenderDonutChart({ bySex, label = 'Active staff by gender' }) {
  return (
    <Donut
      label={label}
      unit="people"
      empty="No active staff yet."
      segments={SEX_SERIES.map((s) => ({ ...s, value: bySex?.[s.key] ?? 0 })).filter(
        (s) => s.value > 0 || s.key !== 'NONE',
      )}
    />
  );
}

/** Add up gender counts across groups. */
export function sumSex(groups) {
  const out = { FEMALE: 0, MALE: 0, NONE: 0 };
  for (const g of groups) for (const k of Object.keys(out)) out[k] += g.bySex?.[k] ?? 0;
  return out;
}

/** Staff in each group by gender. groups: [{ key, tick, title, bySex }]. */
export function GenderByGroup({ groups, label }) {
  return (
    <div className="space-y-3">
      <Legend items={SEX_SERIES} />
      <ColumnChart
        label={label}
        unit="people"
        whole
        empty="No active staff yet."
        series={SEX_SERIES}
        data={groups.map((g) => ({ key: g.key, tick: g.tick, title: g.title, ...g.bySex }))}
      />
    </div>
  );
}
