import { Link } from 'react-router';
import { EmptyState } from '../../components/ui.jsx';
import { COLORS } from '../../components/charts.jsx';

/*
 * Leave balances as tiles (D130, D131, D132): every leave type the person is entitled to, in the
 * platform's colours: Altus navy for the tile, title and Apply Leave; in the ring, used days in
 * the chart blue, waiting in the chart orange and what is left in the light track, as on every
 * other chart. Types with no fixed quota (per occasion, unlimited) show what they allow.
 */

const dayWord = (n) => (Number(n) === 1 ? 'Day' : 'Days');
const daysText = (n) => `${Number(n)} ${dayWord(n)}`;

/** The ring: used, waiting and what is left, with the figure in the middle. */
function Ring({ available, used, waiting, label, centre, sub }) {
  const size = 132;
  const stroke = 12;
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
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <span className="text-xl leading-tight font-semibold text-brand tabular-nums">{centre}</span>
        <span className="mt-0.5 text-[0.68rem] font-medium tracking-wider text-muted uppercase">{sub}</span>
      </div>
    </div>
  );
}

function Row({ swatch, outline, label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2 text-muted">
        <span
          className="inline-block size-3 rounded-[3px]"
          style={{ background: swatch, outline: outline ? `1px solid ${COLORS.booked}` : undefined }}
          aria-hidden
        />
        {label}
      </span>
      <span className="font-medium text-ink tabular-nums">{value}</span>
    </div>
  );
}

function Tile({ b, canApply }) {
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
  const blocked = Boolean(b.eligibility);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-rule border-t-4 border-t-brand bg-white shadow-card">
      <div className="flex flex-1 flex-col p-4">
        <h3 className="mb-3 text-center font-head text-sm font-semibold tracking-wide text-brand uppercase">
          {b.leaveType.name}
        </h3>
        <Ring {...ring} />
        <div className="mt-4 space-y-1.5">
          {quota && <Row swatch={COLORS.track} outline label="Available" value={daysText(available)} />}
          <Row swatch={COLORS.taken} label={quota ? 'Used' : 'Used This Year'} value={daysText(used)} />
          {waiting > 0 && <Row swatch={COLORS.waiting} label="Waiting" value={daysText(waiting)} />}
        </div>
        {blocked && <p className="mt-3 text-xs text-pending">{b.eligibility}</p>}
      </div>
      {canApply &&
        (blocked ? (
          <span className="block bg-canvas px-3 py-2.5 text-center text-xs font-semibold tracking-wider text-muted uppercase">
            Not Available Yet
          </span>
        ) : (
          <Link
            to={`/leave/apply?type=${b.leaveType.id}`}
            className="block bg-brand px-3 py-2.5 text-center text-xs font-semibold tracking-wider text-white uppercase hover:bg-brand-strong"
          >
            Apply Leave
          </Link>
        ))}
    </div>
  );
}

export function BalanceTiles({ items, canApply = true }) {
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
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {sorted.map((b) => (
        <li key={b.leaveType.id}>
          <Tile b={b} canApply={canApply} />
        </li>
      ))}
    </ul>
  );
}
