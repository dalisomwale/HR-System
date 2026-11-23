import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.js';
import { BalanceTiles } from './BalanceTiles.jsx';
import { LeaveHistory } from './LeaveHistory.jsx';
import { formatDateTime } from '../../lib/format.js';
import { STATUS_TONES, PERIOD_LABELS, dateRange, days, statusLabel } from '../../lib/leave.js';
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

/** Balances on their own page (My balances in the menu). */
export function MyBalancesPage() {
  const [year, setYear] = useState(thisYear);
  return (
    <div className="stack">
      <PageHeader title="My Leave Balances" actions={<YearSelect year={year} setYear={setYear} />} />
      <Balances year={year} bare />
      <LeaveHistory year={year} />
    </div>
  );
}

export function YearSelect({ year, setYear }) {
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
      <EmptyState title="No Leave Types Are Active Yet">
        HR activates leave types after reviewing the policy settings.
      </EmptyState>
    );
  }
  const dash = <span className="text-muted">—</span>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Leave Type</Th>
          <Th>Allowance</Th>
          <Th className="text-right">Taken</Th>
          {showPending && <Th className="text-right">Awaiting Approval</Th>}
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

export function Balances({ year, bare = false }) {
  const q = useQuery({
    queryKey: ['balances', year],
    queryFn: () => api.get(`/api/leave/balances${qs({ year })}`),
  });
  const body = q.isPending ? (
    <Loading />
  ) : q.isError ? (
    <LoadError error={q.error} onRetry={() => q.refetch()} />
  ) : (
    <BalanceTiles items={q.data.items} />
  );
  return bare ? body : <Section title={`Balances ${year}`}>{body}</Section>;
}

export function RequestTable({ items, showEmployee = false, yourTurn }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Reference</Th>
          {showEmployee && <Th>First Name</Th>}
          {showEmployee && <Th>Last Name</Th>}
          <Th>Leave Type</Th>
          <Th>Dates</Th>
          <Th className="text-right">Days</Th>
          <Th>Status</Th>
          <Th>Submitted</Th>
          {yourTurn && (
            <Th>
              <span className="sr-only">Action</span>
            </Th>
          )}
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
                {r.employee.firstName}
                <span className="block text-xs text-muted">
                  {[r.employee.employeeNumber, r.employee.department].filter(Boolean).join(' · ')}
                </span>
              </Td>
            )}
            {showEmployee && <Td>{r.employee.lastName}</Td>}
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
                  <Badge tone="brand">Your Own</Badge>
                </span>
              )}
            </Td>
            <Td>{formatDateTime(r.submittedAt)}</Td>
            {yourTurn && (
              <Td>
                {r.status === yourTurn && !r.isOwn ? (
                  <Link
                    to={`/leave/requests/${r.id}`}
                    state={{ decide: true }}
                    className="btn btn-primary btn-sm whitespace-nowrap"
                  >
                    Decide
                  </Link>
                ) : (
                  <Link to={`/leave/requests/${r.id}`} className="btn btn-sm whitespace-nowrap">
                    View
                  </Link>
                )}
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
