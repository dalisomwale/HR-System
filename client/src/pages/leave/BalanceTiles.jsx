import { Link } from 'react-router';
import { COLORS } from '../../components/charts.jsx';
import { EmptyState } from '../../components/ui.jsx';
import { PERIOD_LABELS } from '../../lib/leave.js';

/*
 * Leave balances as tiles (D130): one per leave type with a quota, each with a ring showing the
 * days available in the middle, what is available, used and waiting, the quota, and Apply Leave.
 * Types with no quota (per occasion, unlimited) are listed together under Other Leaves, with a
 * link to the leave policy.
 */

const dayWord = (n) => (Number(n) === 1 ? 'Day' : 'Days');
const daysText = (n) => `${Number(n)} ${dayWord(n)}`;

/** A ring: used and waiting filled in, the rest of the quota left empty, days available inside. */
function Ring({ available, used, waiting, label }) {
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
        aria-label={`${label}: ${available} available, ${used} used${waiting ? `, ${waiting} waiting` : ''}`}
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
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={`text-xl font-semibold tabular-nums ${available > 0 ? 'text-ink' : 'text-muted'}`}>
          {daysText(available)}
        </span>
        <span className="text-[0.7rem] font-medium tracking-wider text-muted uppercase">Available</span>
      </div>
    </div>
  );
}

function Row({ swatch, outline, label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2 text-muted">
        {swatch && (
          <span
            className="inline-block size-3 rounded-[2px]"
            style={{ background: swatch, outline: outline ? '1px solid #c7cfe8' : undefined }}
            aria-hidden
          />
        )}
        {label}
      </span>
      <span className="font-medium text-ink tabular-nums">{value}</span>
    </div>
  );
}

function Tile({ title, children, applyTo, canApply = true }) {
  return (
    <div className="flex h-full flex-col rounded-md border border-rule bg-white p-4 shadow-card">
      <h3 className="mb-3 text-center font-head text-sm font-semibold tracking-wide text-ink uppercase">
        {title}
      </h3>
      <div className="flex flex-1 flex-col">{children}</div>
      {canApply && (
        <Link
          to={applyTo}
          className="mt-4 block rounded-sm bg-canvas px-3 py-2 text-center text-xs font-semibold tracking-wider text-ink uppercase hover:bg-brand hover:text-white"
        >
          Apply Leave
        </Link>
      )}
    </div>
  );
}

function QuotaTile({ b, canApply }) {
  const balance = b.kind === 'BALANCE';
  const available = Math.max(0, balance ? b.available : b.remaining);
  const used = Number(b.taken) || 0;
  const waiting = Number(b.pending) || 0;
  return (
    <Tile title={b.leaveType.name} applyTo={`/leave/apply?type=${b.leaveType.id}`} canApply={canApply}>
      <Ring available={available} used={used} waiting={waiting} label={b.leaveType.name} />
      <div className="mt-4 space-y-1.5">
        <Row swatch={COLORS.track} outline label="Available" value={daysText(available)} />
        <Row swatch={COLORS.taken} label="Used" value={daysText(used)} />
        {waiting > 0 && <Row swatch={COLORS.waiting} label="Waiting" value={daysText(waiting)} />}
      </div>
      <div className="mt-3 space-y-1 border-t border-rule pt-3">
        {balance ? (
          <>
            {b.quota != null && <Row label="Annual Quota" value={daysText(b.quota)} />}
            <Row label="Accrued" value={daysText(b.accrued)} />
            {b.carriedForward > 0 && <Row label="Carried Forward" value={daysText(b.carriedForward)} />}
          </>
        ) : (
          <Row label="Quota" value={`${daysText(b.entitlement)} ${PERIOD_LABELS[b.period] ?? ''}`.trim()} />
        )}
      </div>
      {b.eligibility && <p className="mt-2 text-xs text-pending">{b.eligibility}</p>}
    </Tile>
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
  const quota = items.filter((b) => b.kind === 'BALANCE' || b.kind === 'ALLOWANCE');
  const other = items.filter((b) => b.kind !== 'BALANCE' && b.kind !== 'ALLOWANCE');
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {quota.map((b) => (
        <li key={b.leaveType.id}>
          <QuotaTile b={b} canApply={canApply} />
        </li>
      ))}
      {other.length > 0 && (
        <li>
          <Tile title="Other Leaves" applyTo="/leave/apply" canApply={canApply}>
            <p className="-mt-2 mb-3 text-center text-xs text-muted">
              (View{' '}
              <Link to="/leave/policy" className="text-brand underline">
                Leave Policy
              </Link>{' '}
              for details)
            </p>
            <ul className="space-y-3">
              {other.map((b) => (
                <li key={b.leaveType.id}>
                  <Link
                    to={canApply ? `/leave/apply?type=${b.leaveType.id}` : '/leave/policy'}
                    className="group flex items-center gap-3 text-sm text-ink"
                  >
                    <span
                      className="inline-block size-6 shrink-0 rounded-full border border-rule group-hover:border-brand"
                      aria-hidden
                    />
                    <span className="group-hover:text-brand">
                      {b.leaveType.name}
                      {b.taken ? (
                        <span className="block text-xs text-muted">{daysText(b.taken)} used this year</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {other.some((b) => b.eligibility) && (
              <p className="mt-3 text-xs text-pending">Some of these are not available to you yet.</p>
            )}
          </Tile>
        </li>
      )}
    </ul>
  );
}
