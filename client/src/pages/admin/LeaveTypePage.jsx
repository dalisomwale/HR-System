import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { PolicyForm, summary } from './leave-type-rules.jsx';

/** One leave type: its rules, how it is used this year, its versions and its change history. */
export default function LeaveTypePage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-leave-type', id],
    queryFn: () => api.get(`/api/admin/leave-types/${id}`),
  });
  const toggle = useMutation({
    mutationFn: (t) => api.post(`/api/admin/leave-types/${t.id}/${t.isActive ? 'deactivate' : 'activate'}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-leave-type', id] });
      qc.invalidateQueries({ queryKey: ['admin-leave-types'] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      qc.invalidateQueries({ queryKey: ['balances'] });
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  const p = t.current;

  return (
    <div className="max-w-6xl">
      <Link
        to="/admin/leave-types"
        className="mb-3 inline-flex items-center gap-1 text-sm text-brand hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Leave types
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t.name}
            {t.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}
            {p?.requiresHrConfirmation && <Badge tone="pending">Awaiting review</Badge>}
            {t.isConfidential && <Badge tone="brand">Confidential</Badge>}
          </span>
        }
        description={t.description}
        actions={
          p && (
            <Button
              variant={t.isActive ? 'danger' : 'primary'}
              busy={toggle.isPending}
              onClick={() => toggle.mutate(t)}
            >
              {t.isActive ? 'Deactivate' : 'Review done – activate'}
            </Button>
          )
        }
      />
      {toggle.isError && (
        <div className="mb-4">
          <Notice tone="danger">{toggle.error.message}</Notice>
        </div>
      )}

      <div className="space-y-6">
        <Stats>
          <Stat label={`Waiting for a decision, ${t.usage.year}`} value={t.usage.pending} />
          <Stat label={`Approved requests, ${t.usage.year}`} value={t.usage.approved} />
          <Stat label={`Days approved, ${t.usage.year}`} value={t.usage.approvedDays} />
          <Stat label="On this leave today" value={t.usage.onLeaveToday} />
        </Stats>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid content-start gap-6">
            {p ? (
              <RulesSection type={t} />
            ) : (
              <Notice tone="pending">No policy recorded for this type.</Notice>
            )}
            <VersionsSection versions={t.versions} />
          </div>
          <div className="grid content-start gap-6">
            <Section title="About">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted">Code</dt>
                <dd>{t.code}</dd>
                <dt className="text-muted">Policy reference</dt>
                <dd>{p?.sourceReference ?? '—'}</dd>
                <dt className="text-muted">Who can use it</dt>
                <dd>
                  {p?.extraRules?.eligibleSex === 'FEMALE'
                    ? 'Female employees'
                    : p?.extraRules?.eligibleSex === 'MALE'
                      ? 'Male employees'
                      : 'Everyone'}
                  {p?.minServiceMonths ? `, after ${p.minServiceMonths} months of service` : ''}
                </dd>
                <dt className="text-muted">Reasons</dt>
                <dd>{t.isConfidential ? 'HR only (confidential)' : 'Manager and HR'}</dd>
                <dt className="text-muted">Requests ever</dt>
                <dd>{t.requests}</dd>
              </dl>
            </Section>
            <Section title="Change history">
              {t.history.length === 0 ? (
                <p className="text-sm text-muted">No changes recorded.</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {t.history.map((h, i) => (
                    <li key={i} className="border-l-2 border-rule pl-3">
                      <p>
                        <span className="font-medium">{h.action}</span> by {h.by}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDateTime(h.at)}
                        {h.detail ? ` · ${h.detail}` : ''}
                      </p>
                      {h.note && <p className="mt-0.5 text-muted">{h.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function RulesSection({ type: t }) {
  const [changing, setChanging] = useState(false);
  const p = t.current;
  return (
    <Section
      title="Rules"
      description={`Version ${p.versionNo}, in force from ${formatDate(p.effectiveFrom)}`}
      actions={
        !changing && (
          <Button variant="secondary" onClick={() => setChanging(true)}>
            Change rules
          </Button>
        )
      }
    >
      {changing ? (
        <PolicyForm type={t} onDone={() => setChanging(false)} />
      ) : (
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
          {summary(p).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
}

function VersionsSection({ versions }) {
  return (
    <Section title="Versions">
      {versions.length === 0 ? (
        <p className="text-sm text-muted">No versions recorded.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Version</Th>
              <Th>In force</Th>
              <Th>Confirmed</Th>
              <Th>Why it changed</Th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.versionNo}>
                <Td className="font-medium">{v.versionNo}</Td>
                <Td className="whitespace-nowrap">
                  {formatDate(v.effectiveFrom)} – {v.effectiveTo ? formatDate(v.effectiveTo) : 'now'}
                </Td>
                <Td>
                  {v.awaitingReview ? (
                    <Badge tone="pending">Awaiting review</Badge>
                  ) : (
                    <>
                      {v.confirmedBy ?? '—'}
                      {v.confirmedAt && <p className="text-xs text-muted">{formatDateTime(v.confirmedAt)}</p>}
                    </>
                  )}
                </Td>
                <Td className="text-muted">
                  {v.note ??
                    (v.versionNo === 1
                      ? `From the leave policy${v.sourceReference ? ` (${v.sourceReference})` : ''}`
                      : '—')}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}
