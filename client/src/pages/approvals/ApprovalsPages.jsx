import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { CHANGE_LABELS, STATUS_TONES, dateRange, days, statusLabel } from '../../lib/leave.js';
import { useMe } from '../../lib/auth.jsx';
import {
  Badge,
  EmptyState,
  Field,
  Input,
  LoadError,
  Loading,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { RequestTable } from '../leave/MyLeavePage.jsx';

function Block({ title, children, empty, count }) {
  return (
    <div>
      <h2 className="mb-2 text-[15px] font-semibold">
        {title} <span className="font-normal text-muted">({count})</span>
      </h2>
      {count === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title={empty} />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function ChangeTable({ items }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Reference</Th>
          <Th>Employee</Th>
          <Th>Leave</Th>
          <Th>Reason</Th>
          <Th className="text-right">Days returned</Th>
          <Th>Asked</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <tr key={c.id}>
            <Td>
              <Link
                to={`/leave/requests/${c.leaveRequestId}`}
                className="font-medium text-brand hover:underline"
              >
                {c.reference}
              </Link>
              <span className="block text-xs text-muted">for {c.leaveReference}</span>
            </Td>
            <Td>{c.employee.name}</Td>
            <Td>
              {c.leaveType}
              <span className="block text-xs text-muted">
                {formatDate(c.startDate)} – {formatDate(c.endDate)}
              </span>
            </Td>
            <Td>{CHANGE_LABELS[c.reasonType] ?? 'Cancellation'}</Td>
            <Td className="text-right">{c.daysToReverse == null ? '–' : days(c.daysToReverse)}</Td>
            <Td>{formatDateTime(c.createdAt)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

const DECISION = {
  APPROVE: ['Approved', 'ok'],
  REJECT: ['Rejected', 'danger'],
  RETURN: ['Returned for correction', 'pending'],
};

export function ManagerApprovalsPage() {
  const q = useQuery({
    queryKey: ['approvals', 'manager'],
    queryFn: () => api.get('/api/approvals/manager'),
  });
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Team approvals" />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Block title="Leave requests" count={q.data.requests.length} empty="Nothing waiting for you">
            <RequestTable items={q.data.requests} showEmployee yourTurn="PENDING_MANAGER_APPROVAL" />
          </Block>
          <Block title="Cancellation requests" count={q.data.changes.length} empty="No cancellations waiting">
            <ChangeTable items={q.data.changes} />
          </Block>
        </>
      )}
    </div>
  );
}

const GROUPS = {
  WAITING: 'Waiting for your approval',
  CANCELLATION: 'Cancellation requests',
  MANAGERS: 'With managers',
  DECIDED: 'Decided in the last 90 days',
};

/** One row shape for every kind of item on the HR approvals page. */
function hrRows(data, viewerId) {
  const person = (e) => ({
    name: e.name,
    sub: [e.employeeNumber, e.department].filter(Boolean).join(' · '),
  });
  const request = (r, group, status, date) => ({
    key: `${group}-${r.id}-${r.decision?.id ?? ''}`,
    group,
    reference: r.reference,
    link: `/leave/requests/${r.id}`,
    employee: person(r.employee),
    leaveType: r.leaveType.name,
    dates: dateRange(r),
    start: r.startDate,
    end: r.endDate,
    days: r.chargeableDays,
    status,
    note: r.decision?.comment ?? null,
    overdue: r.isOverdue,
    own: r.isOwn,
    date,
  });
  return [
    ...data.requests.map((r) =>
      request(
        r,
        'WAITING',
        { label: statusLabel(r, 'PENDING_HR_APPROVAL', viewerId), tone: STATUS_TONES[r.status] },
        { label: 'Submitted', at: r.submittedAt },
      ),
    ),
    ...data.changes.map((c) => ({
      key: `CANCELLATION-${c.id}`,
      group: 'CANCELLATION',
      reference: c.reference,
      subReference: `for ${c.leaveReference}`,
      link: `/leave/requests/${c.leaveRequestId}`,
      employee: { name: c.employee.name, sub: '' },
      leaveType: c.leaveType,
      dates: `${formatDate(c.startDate)} – ${formatDate(c.endDate)}`,
      start: c.startDate,
      end: c.endDate,
      days: c.daysToReverse,
      status: { label: CHANGE_LABELS[c.reasonType] ?? 'Cancellation', tone: 'pending' },
      date: { label: 'Asked', at: c.createdAt },
    })),
    ...data.withManagers.map((r) =>
      request(
        r,
        'MANAGERS',
        { label: statusLabel(r), tone: STATUS_TONES[r.status] },
        { label: 'Submitted', at: r.submittedAt },
      ),
    ),
    ...data.decided.map((r) => {
      const [label, tone] = DECISION[r.decision.action] ?? [r.decision.action, 'neutral'];
      return request(
        r,
        'DECIDED',
        { label, tone, by: r.decision.by },
        { label: 'Decided', at: r.decision.at },
      );
    }),
  ];
}

export function HrApprovalsPage() {
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['approvals', 'hr'], queryFn: () => api.get('/api/approvals/hr') });
  const [group, setGroup] = useState('WAITING');
  const [search, setSearch] = useState('');
  const [leaveType, setLeaveType] = useState('');
  // Period: leave whose dates overlap it (either end can be left open).
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const rows = useMemo(() => (q.data ? hrRows(q.data, me?.id) : []), [q.data, me?.id]);
  const counts = Object.fromEntries(
    Object.keys(GROUPS).map((g) => [g, rows.filter((r) => r.group === g).length]),
  );
  // Every leave type, in the order HR set on the Leave types page.
  const allTypes = useQuery({
    queryKey: ['admin-leave-types'],
    queryFn: () => api.get('/api/admin/leave-types'),
  });
  const types = allTypes.data
    ? allTypes.data.items.map((t) => t.name)
    : [...new Set(rows.map((r) => r.leaveType))].sort();
  const term = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!group || r.group === group) &&
      (!leaveType || r.leaveType === leaveType) &&
      (!from || r.end >= from) &&
      (!to || r.start <= to) &&
      (!term || [r.reference, r.employee.name, r.employee.sub].some((v) => v?.toLowerCase().includes(term))),
  );

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="HR approvals" />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Object.entries(GROUPS).map(([g, label]) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(group === g ? '' : g)}
                aria-pressed={group === g}
                className={`rounded-md border bg-white px-4 py-3 text-left hover:border-muted ${
                  group === g ? 'border-brand ring-1 ring-brand' : 'border-rule'
                }`}
              >
                <p
                  className={`text-2xl font-semibold ${g === 'WAITING' && counts[g] > 0 ? 'text-brand' : ''}`}
                >
                  {counts[g]}
                </p>
                <p className="mt-0.5 text-sm text-muted">{label}</p>
              </button>
            ))}
          </div>

          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_9.5rem_9.5rem_auto]">
            <Field id="hrSearch" label="Search">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted"
                  aria-hidden
                />
                <Input
                  id="hrSearch"
                  placeholder="Name, number or reference"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </Field>
            <Field id="hrType" label="Leave type">
              <Select id="hrType" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
                <option value="">All leave types</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="hrFrom" label="From">
              <Input
                id="hrFrom"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field id="hrTo" label="To">
              <Input
                id="hrTo"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
            <button
              type="button"
              className={`h-9 text-sm text-brand hover:underline ${search || leaveType || from || to ? '' : 'invisible'}`}
              onClick={() => {
                setSearch('');
                setLeaveType('');
                setFrom('');
                setTo('');
              }}
            >
              Clear
            </button>
          </div>

          {shown.length === 0 ? (
            <div className="rounded-md border border-rule bg-white">
              <EmptyState
                title={term || leaveType || from || to ? 'Nothing matches these filters.' : 'Nothing here.'}
              />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Employee</Th>
                  <Th>Leave type</Th>
                  <Th>Dates</Th>
                  <Th className="text-right">Days</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key}>
                    <Td>
                      <Link to={r.link} className="font-medium text-brand hover:underline">
                        {r.reference}
                      </Link>
                      {r.subReference && <span className="block text-xs text-muted">{r.subReference}</span>}
                    </Td>
                    <Td>
                      {r.employee.name}
                      {r.employee.sub && <span className="block text-xs text-muted">{r.employee.sub}</span>}
                    </Td>
                    <Td>{r.leaveType}</Td>
                    <Td className="whitespace-nowrap">{r.dates}</Td>
                    <Td className="text-right">{r.days == null ? '–' : r.days}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={r.status.tone}>{r.status.label}</Badge>
                        {r.overdue && <Badge tone="danger">Overdue</Badge>}
                        {r.own && <Badge tone="brand">Your own</Badge>}
                      </div>
                      {r.status.by && <p className="mt-1 text-xs text-muted">by {r.status.by}</p>}
                      {r.note && <p className="mt-0.5 text-xs text-muted">{r.note}</p>}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className="block text-xs text-muted">{r.date.label}</span>
                      {formatDateTime(r.date.at)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
