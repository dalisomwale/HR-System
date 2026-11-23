import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { STATUS_TONES, dateRange, days, statusLabel } from '../../lib/leave.js';
import { Badge, EmptyState, LoadError, Loading, Table, Td, Th } from '../../components/ui.jsx';

/*
 * Someone's own leave on the balances page (D131): Active Leave and Upcoming Leave side by side,
 * then Leave History (what has ended, or was turned down, withdrawn or cancelled) for the year.
 */

const CLOSED = new Set(['REJECTED_BY_MANAGER', 'REJECTED_BY_HR', 'WITHDRAWN', 'CANCELLED']);
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Sorts requests into active (on leave today), upcoming and history. */
export function splitLeave(items, today = isoToday()) {
  const active = [];
  const upcoming = [];
  const history = [];
  for (const r of items) {
    if (CLOSED.has(r.status) || r.endDate < today) history.push(r);
    else if (r.status === 'APPROVED' && r.startDate <= today) active.push(r);
    else if (r.startDate > today || r.status !== 'APPROVED') upcoming.push(r);
    else history.push(r);
  }
  upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { active, upcoming, history };
}

const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

function LeaveItem({ r, today, mode }) {
  const when =
    mode === 'active'
      ? r.endDate === today
        ? 'Back after today'
        : `Until ${new Date(`${r.endDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
      : (() => {
          const n = daysBetween(today, r.startDate);
          return n <= 0 ? 'Starts today' : n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`;
        })();
  return (
    <li>
      <Link
        to={`/leave/requests/${r.id}`}
        className={`flex items-center gap-3 rounded-md border border-rule border-l-4 bg-white p-3 hover:bg-hover ${
          mode === 'active' ? 'border-l-accent-green' : 'border-l-brand'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{r.leaveType.name}</p>
          <p className="text-sm text-muted">{dateRange(r)}</p>
          <p className={`mt-1 text-xs font-semibold ${mode === 'active' ? 'text-ok' : 'text-brand'}`}>
            {when} · {days(r.chargeableDays)}
          </p>
        </div>
        {r.status !== 'APPROVED' && <Badge tone={STATUS_TONES[r.status]}>{statusLabel(r)}</Badge>}
      </Link>
    </li>
  );
}

function Column({ title, items, empty, today, mode }) {
  return (
    <section className="rounded-md border border-rule bg-canvas/40 p-4">
      <h2 className="mb-3 flex items-center justify-between font-head text-base font-semibold text-ink">
        {title}
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-muted">
          {items.length}
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <LeaveItem key={r.id} r={r} today={today} mode={mode} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function LeaveHistory({ year }) {
  const q = useQuery({ queryKey: ['my-requests', 'all'], queryFn: () => api.get('/api/leave/requests') });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const today = isoToday();
  const { active, upcoming, history } = splitLeave(q.data.items, today);
  const past = history
    .filter((r) => r.startDate.slice(0, 4) === String(year))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    <div className="stack">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Column
          title="Active Leave"
          items={active}
          empty="You are not on leave today."
          today={today}
          mode="active"
        />
        <Column
          title="Upcoming Leave"
          items={upcoming}
          empty="No leave coming up. Use Apply Leave on a balance above."
          today={today}
          mode="upcoming"
        />
      </div>
      <section>
        <h2 className="mb-2 font-head text-base font-semibold text-ink">Leave History {year}</h2>
        {past.length === 0 ? (
          <div className="card p-0">
            <EmptyState title={`No Past Leave In ${year}`} />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Leave Type</Th>
                <Th>Dates</Th>
                <Th className="text-right">Days</Th>
                <Th>Status</Th>
                <Th>Reference</Th>
              </tr>
            </thead>
            <tbody>
              {past.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="font-medium">{r.leaveType.name}</span>
                  </Td>
                  <Td>{dateRange(r)}</Td>
                  <Td className="text-right tabular-nums">{r.chargeableDays}</Td>
                  <Td>
                    <Badge tone={r.status === 'APPROVED' ? 'ok' : STATUS_TONES[r.status]}>
                      {r.status === 'APPROVED' ? 'Taken' : statusLabel(r)}
                    </Badge>
                  </Td>
                  <Td>
                    <Link to={`/leave/requests/${r.id}`} className="font-medium text-brand hover:underline">
                      {r.reference}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
