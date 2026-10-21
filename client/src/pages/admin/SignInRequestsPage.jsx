import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Button,
  ButtonLink,
  EmptyState,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';

export default function SignInRequestsPage() {
  const pending = useQuery({
    queryKey: ['pending-sign-ins'],
    queryFn: () => api.get('/api/admin/employees/pending-sign-ins'),
  });
  const people = useQuery({
    queryKey: ['employees', 'unlinked'],
    queryFn: () => api.get('/api/admin/employees?status=ACTIVE&linked=false&pageSize=500'),
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title="Sign-in requests" />
      {pending.isPending ? (
        <Loading />
      ) : pending.isError ? (
        <LoadError error={pending.error} onRetry={() => pending.refetch()} />
      ) : !pending.data.signInConfigured ? (
        <Notice tone="pending" title="Microsoft sign-in is not configured on this server.">
          Requests appear here once sign-in is set up and people try to sign in.
        </Notice>
      ) : pending.data.items.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title="No sign-in requests.">
            When someone without a linked account signs in, they appear here.
          </EmptyState>
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Microsoft account</Th>
              <Th>Last attempt</Th>
              <Th>Link to employee</Th>
            </tr>
          </thead>
          <tbody>
            {pending.data.items.map((p) => (
              <RequestRow
                key={p.objectId}
                request={p}
                candidates={(people.data?.items ?? []).filter((e) => !e.linked)}
              />
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function RequestRow({ request, candidates }) {
  const qc = useQueryClient();
  // Pre-select the employee whose work email matches, if there is exactly one.
  const [employeeId, setEmployeeId] = useState('');
  const match = candidates.filter((c) => c.email && c.email === request.email);
  const suggested = match.length === 1 ? String(match[0].id) : '';
  useEffect(() => {
    if (suggested) setEmployeeId((cur) => cur || suggested);
  }, [suggested]);
  const link = useMutation({
    mutationFn: () =>
      api.put(`/api/admin/employees/${employeeId}/identity`, {
        objectId: request.objectId,
        email: request.email,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-sign-ins'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  return (
    <tr>
      <Td>
        <p className="font-medium">{request.name ?? 'Name not provided'}</p>
        <p className="text-xs text-muted">{request.email ?? request.objectId}</p>
      </Td>
      <Td>
        {formatDateTime(request.lastAttemptAt)}
        {request.attempts > 1 && <p className="text-xs text-muted">{request.attempts} attempts</p>}
      </Td>
      <Td>
        {candidates.length === 0 ? (
          <div className="text-sm text-muted">
            No unlinked employees.{' '}
            <ButtonLink to="/people/employees/new" variant="ghost" className="h-auto px-1">
              Add employee
            </ButtonLink>
          </div>
        ) : (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              link.mutate();
            }}
          >
            <Select
              aria-label={`Employee to link to ${request.email ?? request.objectId}`}
              className="w-72"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Choose employee</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName} ({c.employeeNumber})
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" busy={link.isPending} disabled={!employeeId}>
              Link
            </Button>
            {suggested && employeeId === suggested && (
              <p className="w-full text-xs text-muted">Suggested because the work email matches.</p>
            )}
            {link.isError && <p className="w-full text-xs text-danger">{link.error.message}</p>}
          </form>
        )}
      </Td>
    </tr>
  );
}
