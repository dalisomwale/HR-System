import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Select,
  Table,
  Td,
  Th,
  applyServerErrors,
} from '../../components/ui.jsx';

const STATUS = {
  ACTIVE: ['ok', 'Active'],
  UPCOMING: ['pending', 'Upcoming'],
  ENDED: ['neutral', 'Ended'],
  REVOKED: ['neutral', 'Revoked'],
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka' }).format(new Date());

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['delegations'] });
    qc.invalidateQueries({ queryKey: ['admin-delegations'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
}

function DelegationTable({ items, showDelegator, canRevoke }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const revoke = async (id) => {
    setBusy(id);
    setError(null);
    try {
      await api.post(`/api/delegations/${id}/revoke`);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {error && (
        <div className="mb-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <Table>
        <thead>
          <tr>
            {showDelegator && <Th>Manager</Th>}
            <Th>Covered by</Th>
            <Th>Dates</Th>
            <Th>Reason</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id}>
              {showDelegator && <Td>{d.delegator.name}</Td>}
              <Td>{d.delegate.name}</Td>
              <Td>
                {formatDate(d.startDate)} – {formatDate(d.endDate)}
              </Td>
              <Td>{d.reason}</Td>
              <Td>
                <Badge tone={STATUS[d.status][0]}>{STATUS[d.status][1]}</Badge>
              </Td>
              <Td className="text-right">
                {canRevoke && ['ACTIVE', 'UPCOMING'].includes(d.status) && (
                  <Button variant="ghost" busy={busy === d.id} onClick={() => revoke(d.id)}>
                    Revoke
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function DelegationForm({ people, admin }) {
  const refresh = useRefresh();
  const [message, setMessage] = useState(null);
  const fields = ['delegatorId', 'delegateId', 'startDate', 'endDate', 'reason'];
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: { delegatorId: '', delegateId: '', startDate: today(), endDate: '', reason: '' },
  });
  const onSubmit = async (v) => {
    setMessage(null);
    try {
      const body = {
        delegateId: Number(v.delegateId),
        startDate: v.startDate,
        endDate: v.endDate,
        reason: v.reason.trim() || null,
      };
      if (admin) body.delegatorId = Number(v.delegatorId);
      await api.post(admin ? '/api/admin/delegations' : '/api/delegations', body);
      reset();
      refresh();
      setMessage({ tone: 'ok', text: 'Delegation saved.' });
    } catch (err) {
      const left = applyServerErrors(err, setError, fields);
      if (left) setMessage({ tone: 'danger', text: left });
    }
  };
  const err = (f) => errors[f]?.message;
  const req = { required: 'Required' };
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
      {admin && (
        <Field id="delegatorId" label="Manager who is away" error={err('delegatorId')}>
          <Select id="delegatorId" invalid={!!err('delegatorId')} {...register('delegatorId', req)}>
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field
        id="delegateId"
        label="Who will cover approvals?"
        error={err('delegateId')}
        hint="They can approve or reject leave for the manager’s team, but never their own."
      >
        <Select id="delegateId" invalid={!!err('delegateId')} {...register('delegateId', req)}>
          <option value="">Choose…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      {!admin && <div className="hidden sm:block" />}
      <Field id="startDate" label="From" error={err('startDate')}>
        <Input id="startDate" type="date" invalid={!!err('startDate')} {...register('startDate', req)} />
      </Field>
      <Field id="endDate" label="Until (inclusive)" error={err('endDate')}>
        <Input id="endDate" type="date" invalid={!!err('endDate')} {...register('endDate', req)} />
      </Field>
      <Field id="reason" label="Reason" optional className="sm:col-span-2">
        <Input id="reason" {...register('reason')} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" busy={isSubmitting}>
          Save delegation
        </Button>
        {message && (
          <span className={message.tone === 'ok' ? 'text-sm text-ok' : 'text-sm text-danger'}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}

/** A manager's own delegations and the cover they have been asked to give. */
export function DelegationsPage() {
  const q = useQuery({ queryKey: ['delegations'], queryFn: () => api.get('/api/delegations') });
  const people = useQuery({
    queryKey: ['colleagues'],
    queryFn: () => api.get('/api/leave/colleagues'),
    staleTime: 5 * 60_000,
  });
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Delegation"
        description="When you are away, name someone to approve or reject your team’s leave in your place. HR still gives final approval."
      />
      {q.isPending || people.isPending ? (
        <Loading />
      ) : q.isError || people.isError ? (
        <LoadError error={q.error ?? people.error} onRetry={() => (q.refetch(), people.refetch())} />
      ) : (
        <>
          {q.data.received.length > 0 && (
            <Section title="You are covering for">
              <DelegationTable items={q.data.received} showDelegator canRevoke={false} />
            </Section>
          )}
          {q.data.canDelegate ? (
            <>
              <Section title="Delegate your approvals">
                <DelegationForm people={people.data.items} />
              </Section>
              <Section title="Your delegations">
                {q.data.given.length === 0 ? (
                  <EmptyState title="You have not delegated your approvals." />
                ) : (
                  <DelegationTable items={q.data.given} canRevoke />
                )}
              </Section>
            </>
          ) : (
            q.data.received.length === 0 && (
              <EmptyState title="Nothing to show">
                Delegation is for managers. Nobody has asked you to cover their approvals.
              </EmptyState>
            )
          )}
        </>
      )}
    </div>
  );
}

/** HR Administrators: all current delegations, and set one up for an absent manager. */
export function AdminDelegationsPage() {
  const [scope, setScope] = useState('current');
  const q = useQuery({
    queryKey: ['admin-delegations', scope],
    queryFn: () => api.get(`/api/admin/delegations?scope=${scope}`),
  });
  const people = useQuery({
    queryKey: ['employee-options'],
    queryFn: () => api.get('/api/admin/employees/options'),
  });
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Delegations"
        description="Who is covering manager approvals. Set one up when a manager is away without having done it themselves."
      />
      <Section title="Set up a delegation">
        {people.isPending ? (
          <Loading />
        ) : people.isError ? (
          <LoadError error={people.error} onRetry={() => people.refetch()} />
        ) : (
          <DelegationForm people={people.data.items} admin />
        )}
      </Section>
      <Section
        title={scope === 'current' ? 'Current and upcoming' : 'All delegations'}
        actions={
          <Select aria-label="Show" className="w-48" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="current">Current and upcoming</option>
            <option value="all">All, including past</option>
          </Select>
        }
      >
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState title="No delegations." />
        ) : (
          <DelegationTable items={q.data.items} showDelegator canRevoke />
        )}
      </Section>
    </div>
  );
}
