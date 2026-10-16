import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { STATUS_LABELS, STATUS_TONES, PERIOD_LABELS, dateRange, days, statusLabel } from '../../lib/leave.js';
import {
  Badge,
  ButtonLink,
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
      <PageHeader
        title="My leave"
        actions={
          <>
            <Select
              aria-label="Year"
              className="w-28"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <ButtonLink to="/leave/apply" variant="primary">
              <Plus className="size-4" aria-hidden /> Apply for leave
            </ButtonLink>
          </>
        }
      />
      <Balances year={year} />
      <Requests year={year} />
    </div>
  );
}

export function BalanceCards({ items }) {
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
          <Th className="text-right">Awaiting approval</Th>
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
                <Td className="text-right">{b.pending}</Td>
                <Td className="text-right font-semibold">{days(b.available)}</Td>
              </>
            )}
            {b.kind === 'ALLOWANCE' && (
              <>
                <Td>
                  {days(b.entitlement)} {PERIOD_LABELS[b.period]}
                </Td>
                <Td className="text-right">{b.used}</Td>
                <Td className="text-right">{dash}</Td>
                <Td className="text-right font-semibold">{days(b.remaining)}</Td>
              </>
            )}
            {b.kind === 'PER_OCCASION' && (
              <>
                <Td>{b.maxPerRequest ? `Up to ${days(b.maxPerRequest)} per occasion` : 'Per occasion'}</Td>
                <Td className="text-right">{dash}</Td>
                <Td className="text-right">{dash}</Td>
                <Td className="text-right">{dash}</Td>
              </>
            )}
            {b.kind === 'UNLIMITED' && (
              <>
                <Td>No fixed allowance</Td>
                <Td className="text-right">{dash}</Td>
                <Td className="text-right">{dash}</Td>
                <Td className="text-right">{dash}</Td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Balances({ year }) {
  const q = useQuery({
    queryKey: ['balances', year],
    queryFn: () => api.get(`/api/leave/balances${qs({ year })}`),
  });
  return (
    <Section title={`Balances ${year}`}>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <BalanceCards items={q.data.items} />
      )}
    </Section>
  );
}

function Requests({ year }) {
  const q = useQuery({
    queryKey: ['my-requests', year],
    queryFn: () => api.get(`/api/leave/requests${qs({ year })}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.items;
  return (
    <div>
      <h2 className="mb-2 text-[15px] font-semibold">Requests {year}</h2>
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
