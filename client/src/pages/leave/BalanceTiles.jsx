import { EmptyState } from '../../components/ui.jsx';
import { COLORS } from '../../components/charts.jsx';

/*
 * Leave balances as tiles (D130, D131, D132): every leave type the person is entitled to, in the
 * platform's colours: each tile with a small accent of its own (see ACCENTS); in the ring, used days in
 * the chart blue, waiting in the chart orange and what is left in the light track, as on every
 * other chart. Types with no fixed quota (per occasion, unlimited) show what they allow.
 */

const dayWord = (n) => (Number(n) === 1 ? 'Day' : 'Days');
const daysText = (n) => `${Number(n)} ${dayWord(n)}`;

/** The ring: used, waiting and what is left, with the figure in the middle. */
function Ring({ available, used, waiting, label, centre, sub }) {
  const size = 92;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const total = available + used + waiting;
  const part = (v) => (total > 0 ? (v / total) * circ : 0);
  const usedLen = part(used);
  const waitLen = part(waiting);
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label}
        className="-rotate-90"
      >
        <circle cx={c} cy={c} r={r} fill="none" stroke={COLORS.track} strokeWidth={stroke} />
        {usedLen > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={COLORS.taken}
            strokeWidth={stroke}
            strokeDasharray={`${usedLen} ${circ}`}
          />
        )}
        {waitLen > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={COLORS.waiting}
            strokeWidth={stroke}
            strokeDasharray={`${waitLen} ${circ}`}
            strokeDashoffset={-usedLen}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
        <span className="text-[0.95rem] leading-tight font-semibold text-brand tabular-nums">{centre}</span>
        <span className="text-[0.6rem] font-medium tracking-wider text-muted uppercase">{sub}</span>
      </div>
    </div>
  );
}

function Row({ swatch, outline, label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted">
        <span
          className="inline-block size-2.5 rounded-[2px]"
          style={{ background: swatch, outline: outline ? `1px solid ${COLORS.booked}` : undefined }}
          aria-hidden
        />
        {label}
      </span>
      <span className="font-medium text-ink tabular-nums">{value}</span>
    </div>
  );
}

/*
 * A small accent per tile so they are easy to tell apart (D133), taken only from the platform's
 * own colours (styles.css, charts.jsx): Altus navy, the chart orange, the accent green and the chart blue,
 * in turn, so neighbouring tiles always differ. It marks the top edge, the name and a light tint
 * behind it; the ring keeps the same meaning on every tile (used blue, waiting orange).
 */
const ACCENTS = ['#25398d', '#d0700c', '#6f9a2e', '#3a54b4'];

function Tile({ b, accent }) {
  const quota = b.kind === 'BALANCE' || b.kind === 'ALLOWANCE';
  const used = Number(b.taken) || 0;
  const waiting = Number(b.pending) || 0;
  const available = quota ? Math.max(0, b.kind === 'BALANCE' ? b.available : b.remaining) : 0;
  const ring = quota
    ? {
        available,
        used,
        waiting,
        centre: daysText(available),
        sub: 'Available',
        label: `${b.leaveType.name}: ${available} available, ${used} used${waiting ? `, ${waiting} waiting` : ''}`,
      }
    : {
        available: 1,
        used: 0,
        waiting: 0,
        centre:
          b.kind === 'UNLIMITED'
            ? 'No Limit'
            : b.maxPerRequest
              ? `Up To ${daysText(b.maxPerRequest)}`
              : 'As Needed',
        sub: b.kind === 'UNLIMITED' ? 'No Fixed Quota' : 'Each Time',
        label: `${b.leaveType.name}: ${used} used this year`,
      };
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-md border border-rule bg-white shadow-card"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <h3
        className="flex min-h-[2.6rem] items-center justify-center px-2 text-center font-head text-xs leading-tight font-semibold tracking-wide uppercase"
        style={{ color: accent, background: `${accent}14` }}
      >
        {b.leaveType.name}
      </h3>
      <div className="flex flex-1 flex-col p-3 pt-2.5">
        <Ring {...ring} />
        <div className="mt-2.5 space-y-1">
          {quota && <Row swatch={COLORS.track} outline label="Available" value={daysText(available)} />}
          <Row swatch={COLORS.taken} label={quota ? 'Used' : 'Used This Year'} value={daysText(used)} />
          {waiting > 0 && <Row swatch={COLORS.waiting} label="Waiting" value={daysText(waiting)} />}
        </div>
        {b.eligibility && <p className="mt-2 text-[0.7rem] leading-snug text-pending">{b.eligibility}</p>}
      </div>
    </div>
  );
}

export function BalanceTiles({ items }) {
  if (!items.length) {
    return (
      <EmptyState title="No Leave Types Are Active Yet">
        HR activates leave types after reviewing the policy settings.
      </EmptyState>
    );
  }
  // Types with a quota first, in the order HR set; then those without one.
  const order = { BALANCE: 0, ALLOWANCE: 0, PER_OCCASION: 1, UNLIMITED: 1 };
  const sorted = [...items].sort((x, y) => (order[x.kind] ?? 2) - (order[y.kind] ?? 2));
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {sorted.map((b, i) => (
        <li key={b.leaveType.id}>
          <Tile b={b} accent={ACCENTS[i % ACCENTS.length]} />
        </li>
      ))}
    </ul>
  );
}
