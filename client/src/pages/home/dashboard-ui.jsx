import { Link } from 'react-router';
import { Badge } from '../../components/ui.jsx';
import { STATUS_TONES, dateRange, statusLabel } from '../../lib/leave.js';
import { useMe } from '../../lib/auth.jsx';
import { formatDateTime } from '../../lib/format.js';

/** One headline figure. `value` is shown only when a query established it. */
export function Stat({ label, value, to, tone }) {
  const body = (
    <>
      <p className={`text-2xl font-semibold ${tone === 'danger' && value > 0 ? 'text-danger' : ''}`}>
        {value}
      </p>
      <p className="mt-0.5 text-sm text-muted">{label}</p>
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-md border border-rule bg-white px-4 py-3 hover:border-muted">
      {body}
    </Link>
  ) : (
    <div className="rounded-md border border-rule bg-white px-4 py-3">{body}</div>
  );
}

export function Stats({ children, cols = 4 }) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${cols === 3 ? 'sm:grid-cols-3' : 'lg:grid-cols-4'}`}>
      {children}
    </div>
  );
}

/** Compact list of requests with a link to each. */
export function RequestList({ items, empty, showEmployee = false, showCompany = false, extra, yourTurn }) {
  const { data: me } = useMe();
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-rule">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
          <div className="min-w-0">
            <Link to={`/leave/requests/${r.id}`} className="font-medium text-brand hover:underline">
              {showEmployee ? r.employee.name : r.leaveType}
            </Link>
            <span className="text-muted">
              {' '}
              · {showEmployee ? `${r.leaveType} · ` : ''}
              {dateRange(r)} · {r.chargeableDays} {r.chargeableDays === 1 ? 'day' : 'days'}
            </span>
            {showCompany && r.employee?.company && <p className="text-xs text-muted">{r.employee.company}</p>}
          </div>
          <div className="flex items-center gap-2">
            {extra?.(r)}
            {r.status && <Badge tone={STATUS_TONES[r.status]}>{statusLabel(r, yourTurn, me?.id)}</Badge>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Waiting({ r }) {
  return (
    <span className={`text-xs ${r.overdue ? 'font-medium text-danger' : 'text-muted'}`}>
      {r.workingDaysWaiting} working {r.workingDaysWaiting === 1 ? 'day' : 'days'} waiting
      {r.overdue ? ' · overdue' : ''}
    </span>
  );
}

const VERBS = {
  SUBMIT: 'submitted',
  RESUBMIT: 'resubmitted',
  APPROVE: 'approved',
  REJECT: 'rejected',
  RETURN: 'returned',
  WITHDRAW: 'withdrew',
};
const DOTS = {
  APPROVE: 'bg-ok',
  REJECT: 'bg-danger',
  RETURN: 'bg-pending',
  ESCALATE: 'bg-pending',
  WITHDRAW: 'bg-muted',
};

/** What happened recently, newest first, as plain sentences. */
export function Activity({ items }) {
  if (!items.length) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="divide-y divide-rule text-sm">
      {items.map((a) => {
        const who = a.byMe ? 'You' : a.by;
        const whose = a.own ? 'your' : `${a.owner}\u2019s`;
        const what =
          a.change === 'CANCEL'
            ? 'cancellation request'
            : a.change === 'AMEND'
              ? 'change request'
              : 'request';
        const ref = (
          <Link
            to={`/leave/requests/${a.requestId}`}
            className="font-medium whitespace-nowrap text-brand hover:underline"
          >
            {a.reference}
          </Link>
        );
        return (
          <li key={a.id} className="flex items-start gap-3 py-2.5">
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${DOTS[a.action] ?? 'bg-brand'}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              {a.action === 'ESCALATE' ? (
                <p>
                  {a.own ? 'Your' : whose} {a.leaveType} {what} {ref} is overdue for a decision. Reminders
                  were sent.
                </p>
              ) : (
                <p>
                  {who} {VERBS[a.action] ?? a.action.toLowerCase()} {whose} {a.leaveType} {what} {ref}
                </p>
              )}
              <p className="text-xs text-muted">{formatDateTime(a.at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
