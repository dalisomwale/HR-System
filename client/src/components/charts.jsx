import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

/*
 * Small SVG and HTML charts for the dashboards. No chart library: the shapes are few and this
 * keeps them in the app's own type and colours.
 *
 * Colours are checked for colour-blind separation against the white card surface. Their meaning
 * stays the same on every page: blue is approved leave already taken, light blue is approved
 * leave still to come, orange is leave waiting for a decision. Charts with leave types use blue,
 * orange and green for the three largest types, and grey for the rest.
 */
export const COLORS = {
  taken: '#2a3fbf',
  booked: '#9aa8ef',
  waiting: '#eb6834',
  series: ['#2a3fbf', '#eb6834', '#1baf7a'],
  other: '#a3aab8',
  track: '#eceef7',
  grid: '#e6e9ef',
  weekend: '#f5f6f8',
};

const ONE = { days: 'day', people: 'person' };
const withUnit = (n, unit) => `${fmt(n)} ${n === 1 ? (ONE[unit] ?? unit) : unit}`;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A clean axis maximum and its ticks: 0 and three or four round steps. */
function niceScale(max, whole) {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  let unit;
  // Whole numbers only when counting people; half days are real for days of leave.
  if (raw < 1) unit = max <= 2 && !whole ? 0.5 : 1;
  else {
    const mag = 10 ** Math.floor(Math.log10(raw));
    unit = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  }
  const top = Math.ceil(max / unit) * unit;
  const ticks = [];
  for (let t = 0; t <= top + 1e-9; t += unit) ticks.push(Math.round(t * 100) / 100);
  return { top, ticks };
}

export function Legend({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((s) => (
        <li key={s.key ?? s.name} className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: s.color, outline: s.outline ? '1px solid #c9cfe6' : undefined }}
            aria-hidden
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Columns along a category axis, stacked when there is more than one series.
 * data: [{ key, tick, title, shade, ...values }]; series: [{ key, name, color }].
 */
export function ColumnChart({ data, series, height = 200, label, unit = 'days', empty, whole = false }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const totals = data.map((d) => series.reduce((s, x) => s + (d[x.key] ?? 0), 0));
  const max = Math.max(0, ...totals);
  if (max === 0 && empty) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  const { top, ticks } = niceScale(max, whole);
  const left = 28;
  const bottom = 22;
  const plotW = Math.max(0, width - left - 4);
  const plotH = height - bottom - 8;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(3, Math.min(24, band * 0.62));
  const y = (v) => 8 + plotH - (v / top) * plotH;
  // Drop axis labels that would run into the one before (month names on a phone).
  const shownTicks = new Set();
  let lastEdge = -Infinity;
  data.forEach((d, i) => {
    if (!d.tick) return;
    const cx = left + i * band + band / 2;
    const half = (String(d.tick).length * 5.6) / 2;
    if (cx - half >= lastEdge + 6) {
      shownTicks.add(i);
      lastEdge = cx + half;
    }
  });

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width} y1={y(t)} y2={y(t)} stroke={COLORS.grid} strokeWidth="1" />
              <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px]">
                {fmt(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = left + i * band;
            const cx = x0 + band / 2;
            let acc = 0;
            const segs = series
              .map((s) => ({ s, v: d[s.key] ?? 0 }))
              .filter((g) => g.v > 0)
              .map((g, j, arr) => {
                const yTop = y(acc + g.v);
                const yBot = y(acc);
                acc += g.v;
                const last = j === arr.length - 1;
                // 2px of surface between stacked segments; only the top one is rounded.
                const h = Math.max(1, yBot - yTop - (j > 0 ? 2 : 0));
                return { ...g, yTop, h, last };
              });
            return (
              <g key={d.key}>
                {d.shade && <rect x={x0} y={8} width={band} height={plotH} fill={COLORS.weekend} />}
                {hover === i && (
                  <rect x={x0} y={8} width={band} height={plotH} fill="#000080" opacity="0.05" />
                )}
                {segs.map((g) =>
                  g.last ? (
                    <path
                      key={g.s.key}
                      d={roundedTop(cx - barW / 2, g.yTop, barW, g.h, Math.min(4, barW / 2, g.h))}
                      fill={g.s.color}
                    />
                  ) : (
                    <rect
                      key={g.s.key}
                      x={cx - barW / 2}
                      y={g.yTop}
                      width={barW}
                      height={g.h}
                      fill={g.s.color}
                    />
                  ),
                )}
                {shownTicks.has(i) && (
                  <text x={cx} y={height - 6} textAnchor="middle" className="fill-muted text-[10px]">
                    {d.tick}
                  </text>
                )}
                <rect
                  x={x0}
                  y={0}
                  width={band}
                  height={height}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.title}: ${series.map((s) => `${s.name} ${fmt(d[s.key] ?? 0)}`).join(', ')}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                />
              </g>
            );
          })}
          <line x1={left} x2={width} y1={y(0)} y2={y(0)} stroke="#c3c9d4" strokeWidth="1" />
        </svg>
      )}
      {hover != null && width > 0 && (
        <Tip
          x={left + hover * band + band / 2}
          width={width}
          title={data[hover].title}
          rows={series.map((s) => ({
            name: s.name,
            color: s.color,
            value: withUnit(data[hover][s.key] ?? 0, unit),
          }))}
        />
      )}
      <DataTable
        caption={label}
        head={['', ...series.map((s) => s.name)]}
        rows={data.map((d) => [d.title, ...series.map((s) => fmt(d[s.key] ?? 0))])}
      />
    </div>
  );
}

function roundedTop(x, y, w, h, r) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Tip({ x, width, title, rows }) {
  const left = Math.min(Math.max(x, 130), width - 130);
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-64 -translate-x-1/2 rounded-md border border-rule bg-white px-3 py-2 text-xs shadow-md"
      style={{ left }}
      role="status"
    >
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ background: r.color }} aria-hidden />
          <span className="font-semibold whitespace-nowrap">{r.value}</span>
          <span className="text-muted">{r.name}</span>
        </p>
      ))}
    </div>
  );
}

/** The same figures as a table, for screen readers. */
function DataTable({ caption, head, rows }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>
            {r.map((c, i) =>
              i === 0 ? (
                <th key={i} scope="row">
                  {c}
                </th>
              ) : (
                <td key={i}>{c}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Horizontal bars, one per row, with the value at the end of the bar.
 * items: [{ key, label, value, sub, to }]
 */
export function BarList({ items, format = fmt, color = COLORS.taken, max, empty }) {
  const top = max ?? Math.max(0, ...items.map((i) => i.value));
  if (!items.length || (top === 0 && empty)) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const pct = top > 0 ? (it.value / top) * 100 : 0;
        const name = it.to ? (
          <Link to={it.to} className="text-brand hover:underline">
            {it.label}
          </Link>
        ) : (
          it.label
        );
        return (
          <li key={it.key} className="text-sm">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {name}
                {it.sub && <span className="text-xs text-muted"> · {it.sub}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{format(it.value)}</span>
            </div>
            <div className="h-2 rounded-r bg-transparent" title={`${it.label}: ${format(it.value)}`}>
              <div
                className="h-2 rounded-r"
                style={{ width: `${Math.max(it.value > 0 ? 1.5 : 0, pct)}%`, background: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One bar split into parts of a whole, e.g. days taken, waiting and still available.
 * segments: [{ key, name, value, color }]; the last segment may be the unused remainder.
 */
export function Meter({ segments, total, label, height = 10 }) {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div
        className="flex w-full gap-[2px] overflow-hidden rounded"
        style={{ height, background: COLORS.track }}
        role="img"
        aria-label={`${label}: ${segments.map((s) => `${s.name} ${fmt(s.value)}`).join(', ')}`}
      >
        {sum > 0 &&
          shown.map((s) => (
            <div
              key={s.key}
              title={`${s.name}: ${fmt(s.value)}`}
              style={{ width: `${(s.value / sum) * 100}%`, background: s.color }}
            />
          ))}
      </div>
    </div>
  );
}
