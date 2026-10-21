import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.js';
import { Activity } from '../home/dashboard-ui.jsx';
import { BalanceMeter } from '../home/dashboard-charts.jsx';
import { formatDateTime } from '../../lib/format.js';
import { STATUS_LABELS, STATUS_TONES, PERIOD_LABELS, dateRange, days, statusLabel } from '../../lib/leave.js';
import {
  Badge,
  EmptyState,
  LoadError,
  Loading,
  PageHeader,
  Section,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';

const thisYear = new Date().getFullYear();

export default function MyLeavePage() {
  const [year, setYear] = useState(thisYear);
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="My leave" />
      <MyLeaveTop />
      <Requests year={year} setYear={setYear} />
      <RecentActivity />
    </div>
  );
}

/*
 * Active leave and recent activity come from the same summary as the home page, so the two
 * pages share one request. Days left are worked out on the server from today's date; the
 * summary is refreshed every hour and whenever the page is opened again.
 */
function useSummary() {
  return useQuery({
    queryKey: ['dashboard', 'employee'],
    queryFn: () => api.get('/api/dashboard/employee'),
    refetchInterval: 60 * 60 * 1000,
  });
}

function MyLeaveTop() {
  const q = useSummary();
  return (
    <Section title="Active leave">
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.active.length === 0 ? (
        <p className="text-sm text-muted">You are not on leave.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {q.data.active.map((r) => (
            <ActiveLeave key={r.id} r={r} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ActiveLeave({ r }) {
  const used = Math.max(0, r.chargeableDays - r.daysLeft);
  const pct = r.chargeableDays > 0 ? Math.round((used / r.chargeableDays) * 100) : 100;
  return (
    <li className="rounded-md border border-rule p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <Link to={`/leave/requests/${r.id}`} className="font-medium text-brand hover:underline">
          {r.leaveType}
        </Link>
        <span className="text-xs whitespace-nowrap text-muted">{r.reference}</span>
      </div>
      <p className="mt-0.5 text-sm text-muted">{dateRange(r)}</p>
      <p className="mt-3">
        <span className="text-2xl font-semibold">{r.daysLeft}</span>{' '}
        <span className="text-sm text-muted">of {days(r.chargeableDays)} left</span>
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-bg"
        role="progressbar"
        aria-label={`${r.leaveType}: ${used} of ${r.chargeableDays} days used`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

function RecentActivity() {
  const q = useSummary();
  return (
    <Section title="Recent activity">
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Activity items={q.data.activity.filter((a) => a.own)} />
      )}
    </Section>
  );
}

/** Balances on their own page (My balances in the menu). */
export function MyBalancesPage() {
  const [year, setYear] = useState(thisYear);
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="My balances" actions={<YearSelect year={year} setYear={setYear} />} />
      <Balances year={year} bare />
    </div>
  );
}

function YearSelect({ year, setYear }) {
  return (
    <Select aria-label="Year" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
      {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </Select>
  );
}

export function BalanceCards({ items, showPending = true }) {
  if (!items.length) {
    return (
      <EmptyState title="No leave types are active yet">
        HR activates leave types after reviewing the policy settings.
      </EmptyState>
    );
  }
  const dash = <span className="text-muted">—</span>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Leave type</Th>
          <Th>Allowance</Th>
          <Th className="text-right">Taken</Th>
          {showPending && <Th className="text-right">Awaiting approval</Th>}
          <Th className="text-right">Available</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((b) => (
          <tr key={b.leaveType.id}>
            <Td>
              <span className="font-medium">{b.leaveType.name}</span>
              {b.eligibility && <p className="text-xs text-pending">{b.eligibility}</p>}
            </Td>
            {b.kind === 'BALANCE' && (
              <>
                <Td>
                  Balance {days(b.balance)}
                  {b.carriedForward > 0 && (
                    <p className="text-xs text-muted">includes {days(b.carriedForward)} carried forward</p>
                  )}
                </Td>
                <Td className="text-right">{b.taken}</Td>
                {showPending && <Td className="text-right">{b.pending}</Td>}
                <Td className="text-right font-semibold">{days(b.available)}</Td>
              </>
            )}
            {b.kind === 'ALLOWANCE' && (
              <>
                <Td>
                  {days(b.entitlement)} {PERIOD_LABELS[b.period]}
                </Td>
                <Td className="text-right">{b.taken}</Td>
                {showPending && <Td className="text-right">{b.pending}</Td>}
                <Td className="text-right font-semibold">{days(b.remaining)}</Td>
              </>
            )}
            {b.kind === 'PER_OCCASION' && (
              <>
                <Td>{b.maxPerRequest ? `Up to ${days(b.maxPerRequest)} per occasion` : 'Per occasion'}</Td>
                <Td className="text-right">{b.taken ?? dash}</Td>
                {showPending && <Td className="text-right">{b.pending ?? dash}</Td>}
                <Td className="text-right">{dash}</Td>
              </>
            )}
            {b.kind === 'UNLIMITED' && (
              <>
                <Td>No fixed allowance</Td>
                <Td className="text-right">{b.taken ?? dash}</Td>
                {showPending && <Td className="text-right">{b.pending ?? dash}</Td>}
                <Td className="text-right">{dash}</Td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Balances({ year, bare = false }) {
  const q = useQuery({
    queryKey: ['balances', year],
    queryFn: () => api.get(`/api/leave/balances${qs({ year })}`),
  });
  const body = q.isPending ? (
    <Loading />
  ) : q.isError ? (
    <LoadError error={q.error} onRetry={() => q.refetch()} />
  ) : (
    <div className="space-y-6">
      <Meters items={q.data.items} />
      <BalanceCards items={q.data.items} />
    </div>
  );
  return bare ? body : <Section title={`Balances ${year}`}>{body}</Section>;
}

/** One bar per leave type that has a limit: taken, waiting and what is left. */
function Meters({ items }) {
  const limited = items.filter((b) => b.kind === 'BALANCE' || b.kind === 'ALLOWANCE');
  if (!limited.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {limited.map((b) => (
        <li key={b.leaveType.id}>
          <BalanceMeter b={b} />
        </li>
      ))}
    </ul>
  );
}

function Requests({ year, setYear }) {
  const q = useQuery({
    queryKey: ['my-requests', year],
    queryFn: () => api.get(`/api/leave/requests${qs({ year })}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.items;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Requests {year}</h2>
        <YearSelect year={year} setYear={setYear} />
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title={`No requests in ${year}`} />
        </div>
      ) : (
        <RequestTable items={items} />
      )}
    </div>
  );
}

export function RequestTable({ items, showEmployee = false, yourTurn }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Reference</Th>
          {showEmployee && <Th>Employee</Th>}
          <Th>Leave type</Th>
          <Th>Dates</Th>
          <Th className="text-right">Days</Th>
          <Th>Status</Th>
          <Th>Submitted</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.id}>
            <Td>
              <Link to={`/leave/requests/${r.id}`} className="font-medium text-brand hover:underline">
                {r.reference}
              </Link>
            </Td>
            {showEmployee && (
              <Td>
                {r.employee.name}
                <span className="block text-xs text-muted">
                  {[r.employee.employeeNumber, r.employee.department].filter(Boolean).join(' · ')}
                </span>
              </Td>
            )}
            <Td>{r.leaveType.name}</Td>
            <Td>{dateRange(r)}</Td>
            <Td className="text-right">{r.chargeableDays}</Td>
            <Td>
              <Badge tone={STATUS_TONES[r.status]}>{statusLabel(r, yourTurn)}</Badge>
              {r.isOverdue && (
                <span className="ml-1">
                  <Badge tone="danger">Overdue</Badge>
                </span>
              )}
              {r.isOwn && (
                <span className="ml-1">
                  <Badge tone="brand">Your own</Badge>
                </span>
              )}
            </Td>
            <Td>{formatDateTime(r.submittedAt)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
