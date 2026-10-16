import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { CHANGE_LABELS, days } from '../../lib/leave.js';
import { EmptyState, LoadError, Loading, PageHeader, Table, Td, Th } from '../../components/ui.jsx';
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

export function HrApprovalsPage() {
  const q = useQuery({ queryKey: ['approvals', 'hr'], queryFn: () => api.get('/api/approvals/hr') });
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="HR approvals" />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Block
            title="Waiting for your approval"
            count={q.data.requests.length}
            empty="Nothing waiting for HR"
          >
            <RequestTable items={q.data.requests} showEmployee yourTurn="PENDING_HR_APPROVAL" />
          </Block>
          <Block title="Cancellation requests" count={q.data.changes.length} empty="No cancellations waiting">
            <ChangeTable items={q.data.changes} />
          </Block>
          <Block title="Still with managers" count={q.data.withManagers.length} empty="None">
            <RequestTable items={q.data.withManagers} showEmployee />
          </Block>
        </>
      )}
    </div>
  );
}
