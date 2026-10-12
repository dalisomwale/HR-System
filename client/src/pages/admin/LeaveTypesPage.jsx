import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  ButtonLink,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { allowance } from './leave-type-rules.jsx';

export default function LeaveTypesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-leave-types'], queryFn: () => api.get('/api/admin/leave-types') });
  const toggle = useMutation({
    mutationFn: (t) => api.post(`/api/admin/leave-types/${t.id}/${t.isActive ? 'deactivate' : 'activate'}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-leave-types'] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      qc.invalidateQueries({ queryKey: ['balances'] });
    },
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title="Leave types" />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-6">
          <AccrualNotice items={q.data.items} />
          {toggle.isError && <Notice tone="danger">{toggle.error.message}</Notice>}
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Allowance</Th>
                <Th>Counted in</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link
                      to={`/admin/leave-types/${t.id}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {t.name}
                    </Link>
                    {t.current?.sourceReference && (
                      <p className="text-xs text-muted">Policy {t.current.sourceReference}</p>
                    )}
                  </Td>
                  <Td>{t.current ? allowance(t.current) : 'No policy recorded'}</Td>
                  <Td>{t.current?.dayBasis === 'CALENDAR_DAYS' ? 'Calendar days' : 'Working days'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {t.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}
                      {t.current?.requiresHrConfirmation && <Badge tone="pending">Awaiting review</Badge>}
                      {t.isConfidential && <Badge tone="brand">Confidential</Badge>}
                    </div>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <ButtonLink to={`/admin/leave-types/${t.id}`} variant="ghost" className="h-7 px-2">
                      View
                    </ButtonLink>
                    <Button
                      variant="ghost"
                      className="h-7 px-2"
                      busy={toggle.isPending && toggle.variables?.id === t.id}
                      onClick={() => toggle.mutate(t)}
                    >
                      {t.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <JobsSection />
        </div>
      )}
    </div>
  );
}

const JOB_LABELS = {
  MONTHLY_ACCRUAL: 'Monthly accrual',
  CARRY_FORWARD: 'Year-end carry forward',
  CARRY_FORWARD_EXPIRY: 'Carry-forward expiry',
  DAILY_REMINDERS: 'Daily reminders',
};

function JobsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['jobs'], queryFn: () => api.get('/api/admin/jobs') });
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [period, setPeriod] = useState(
    `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`,
  );
  const [year, setYear] = useState(String(now.getFullYear() - 1));
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);

  const run = async (name, path, body) => {
    setBusy(name);
    setResult(null);
    try {
      const out = await api.post(path, body);
      setResult({ tone: 'ok', text: `${JOB_LABELS[name]} finished: ${describe(out)}` });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['balances'] });
    } catch (err) {
      setResult({ tone: 'danger', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Balance jobs">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Field id="accrual-period" label="Monthly accrual for">
            <Input
              id="accrual-period"
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            busy={busy === 'MONTHLY_ACCRUAL'}
            onClick={() => run('MONTHLY_ACCRUAL', '/api/admin/jobs/monthly-accrual', { period })}
          >
            Run accrual
          </Button>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Field id="cf-year" label="Leave year ending">
            <Input
              id="cf-year"
              className="w-32"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              busy={busy === 'CARRY_FORWARD'}
              onClick={() => run('CARRY_FORWARD', '/api/admin/jobs/carry-forward', { year: Number(year) })}
            >
              Run carry forward
            </Button>
            <Button
              variant="secondary"
              busy={busy === 'CARRY_FORWARD_EXPIRY'}
              onClick={() =>
                run('CARRY_FORWARD_EXPIRY', '/api/admin/jobs/carry-forward-expiry', { year: Number(year) })
              }
            >
              Run expiry
            </Button>
          </div>
        </div>
      </div>
      {result && (
        <div className="mt-4">
          <Notice tone={result.tone}>{result.text}</Notice>
        </div>
      )}
      <h3 className="mt-6 mb-2 text-sm font-semibold">Recent runs</h3>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="text-sm text-muted">No jobs have run yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th>Finished</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((j, i) => (
              <tr key={i}>
                <Td>{JOB_LABELS[j.job] ?? j.job}</Td>
                <Td>{j.period}</Td>
                <Td>
                  <Badge
                    tone={j.status === 'SUCCEEDED' ? 'ok' : j.status === 'FAILED' ? 'danger' : 'pending'}
                  >
                    {j.status}
                  </Badge>
                </Td>
                <Td>{formatDateTime(j.finishedAt)}</Td>
                <Td className="text-xs">{j.error ?? describe(j.summary)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

function describe(summary) {
  if (!summary || typeof summary !== 'object') return '';
  return Object.entries(summary)
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v}`)
    .join(', ');
}

/** Shown while a balance accrual rule is unconfirmed; accrual will not run until it is. */
function AccrualNotice({ items }) {
  const names = items
    .filter(
      (t) => t.current?.consumesBalance && t.current.accrualMethod !== 'NONE' && !t.current.accrualConfirmed,
    )
    .map((t) => t.name);
  if (!names.length) return null;
  return (
    <Notice
      tone="pending"
      title={`Accrual is off until the ${names.join(', ').toLowerCase()} rule is confirmed.`}
    >
      Open the leave type, choose Change rules and tick “Accrual rule confirmed by HR”.
    </Notice>
  );
}
