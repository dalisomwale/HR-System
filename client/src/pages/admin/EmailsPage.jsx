import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';

const STATUS = {
  QUEUED: ['neutral', 'Queued'],
  SENDING: ['pending', 'Sending'],
  ACCEPTED: ['ok', 'Accepted by Microsoft'],
  FAILED: ['pending', 'Failed – will retry'],
  DEAD: ['danger', 'Failed – gave up'],
};

export default function EmailsPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const q = useQuery({
    queryKey: ['admin-emails', status, page],
    queryFn: () => api.get(`/api/admin/emails${qs({ status, page })}`),
    refetchInterval: 30_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-emails'] });

  const act = async (name, fn, ok) => {
    setBusy(name);
    setMessage(null);
    try {
      const out = await fn();
      setMessage({ tone: 'ok', text: ok(out) });
      refresh();
    } catch (err) {
      setMessage({ tone: 'danger', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const d = q.data;
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Emails"
        description="Every email the system has queued. “Accepted” means Microsoft accepted the message; the system cannot see whether it reached the inbox."
        actions={
          d?.transport === 'graph' && (
            <Button
              variant="secondary"
              busy={busy === 'test'}
              onClick={() =>
                act(
                  'test',
                  () => api.post('/api/admin/emails/test'),
                  (o) => `Test message queued to ${o.to}. It is sent within a minute.`,
                )
              }
            >
              Send me a test email
            </Button>
          )
        }
      />
      {d && d.transport !== 'graph' && (
        <Notice tone="pending" title="Email is switched off on this server.">
          In-system notifications still work. To send email, set MAIL_TRANSPORT=graph and the mail settings
          described in docs/email-setup.md, then restart.
        </Notice>
      )}
      {d?.transport === 'graph' && (
        <p className="text-sm text-muted">
          Sending through Microsoft 365 as <span className="font-medium text-ink">{d.sender}</span>.
        </p>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Status"
          className="w-56"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="PROBLEMS">Failed (needs attention)</option>
          {Object.entries(STATUS).map(([k, [, label]]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        {d && (
          <p className="text-sm text-muted">
            {Object.entries(STATUS)
              .map(([k, [, label]]) => `${label}: ${d.counts[k] ?? 0}`)
              .join(' · ')}
          </p>
        )}
      </div>

      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : d.items.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title="No emails found." />
        </div>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Queued</Th>
                <Th>To</Th>
                <Th>Subject</Th>
                <Th>Status</Th>
                <Th className="text-right">Attempts</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {d.items.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</Td>
                  <Td>{m.to}</Td>
                  <Td>
                    {m.subject}
                    {m.lastError && <span className="mt-0.5 block text-xs text-danger">{m.lastError}</span>}
                    {m.status === 'FAILED' && (
                      <span className="block text-xs text-muted">
                        Next try {formatDateTime(m.nextAttemptAt)}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={STATUS[m.status][0]}>{STATUS[m.status][1]}</Badge>
                    {m.acceptedAt && (
                      <span className="block text-xs text-muted">{formatDateTime(m.acceptedAt)}</span>
                    )}
                  </Td>
                  <Td className="text-right">{m.attempts}</Td>
                  <Td className="text-right">
                    {['FAILED', 'DEAD'].includes(m.status) && (
                      <Button
                        variant="ghost"
                        busy={busy === m.id}
                        onClick={() =>
                          act(
                            m.id,
                            () => api.post(`/api/admin/emails/${m.id}/resend`),
                            () => 'Queued to send again.',
                          )
                        }
                      >
                        Resend
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
