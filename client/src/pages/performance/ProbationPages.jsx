import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  Details,
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
  Textarea,
  Th,
} from '../../components/ui.jsx';
import { errorText } from '../requisitions/rq.js';
import { OUTCOME, PROBATION_CRITERIA, PROBATION_STATUS, RATINGS, RATING_LABEL } from './pf.js';

/** Probation reviews (D115): a manager's team, or every one for HR. */
export function ProbationListPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pf-probation'], queryFn: () => api.get('/api/performance/probation') });
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const start = async (employee) => {
    setBusy(employee.id);
    setMsg(null);
    try {
      await api.post('/api/performance/probation', { employeeId: employee.id });
      setMsg({
        tone: 'ok',
        text: `Probation review started for ${employee.name}. Their manager has been asked to complete it.`,
      });
      qc.invalidateQueries({ queryKey: ['pf-probation'] });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <PageHeader
        title="Probation Reviews"
        description="Reviews start by themselves 30 days before probation ends. The manager recommends; HR decides, and the employee record is updated."
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data && (
        <div className="stack">
          {q.data.items.length === 0 ? (
            <div className="card p-0">
              <EmptyState title="No probation reviews." />
            </div>
          ) : (
            <Table title="Probation Reviews">
              <thead>
                <tr>
                  <Th>First Name</Th>
                  <Th>Last Name</Th>
                  <Th>Department</Th>
                  <Th>Probation Ends</Th>
                  <Th>Manager</Th>
                  <Th>Recommendation</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((p) => {
                  const turn =
                    (p.status === 'PENDING_MANAGER' && !q.data.all) ||
                    (p.status === 'PENDING_HR' && q.data.canDecide);
                  return (
                    <tr key={p.id} data-date={p.probationEndDate}>
                      <Td className="font-semibold">
                        {p.employee.firstName}
                        <span className="block text-xs font-normal text-muted">{p.employee.jobTitle}</span>
                      </Td>
                      <Td className="font-semibold">{p.employee.lastName}</Td>
                      <Td>{p.employee.department ?? '—'}</Td>
                      <Td className="whitespace-nowrap">{formatDate(p.probationEndDate)}</Td>
                      <Td>{p.manager?.name ?? <span className="text-muted">HR</span>}</Td>
                      <Td>{p.recommendation ? OUTCOME[p.recommendation][0] : '—'}</Td>
                      <Td>
                        <Badge tone={PROBATION_STATUS[p.status][1]}>
                          {p.status === 'COMPLETED' ? OUTCOME[p.decision][0] : PROBATION_STATUS[p.status][0]}
                        </Badge>
                      </Td>
                      <Td>
                        <Link
                          to={`/performance/probation/${p.id}`}
                          className={`btn btn-sm whitespace-nowrap ${turn ? 'btn-primary' : ''}`}
                        >
                          {turn ? (p.status === 'PENDING_HR' ? 'Decide' : 'Review') : 'View'}
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {q.data.notStarted.length > 0 && (
            <Section
              title="Probation Ending, No Review Yet"
              description="They are started automatically 30 days before the end date; start one sooner here."
            >
              <Table title="Probation Not Started" tools={false}>
                <thead>
                  <tr>
                    <Th>First Name</Th>
                    <Th>Last Name</Th>
                    <Th>Department</Th>
                    <Th>Probation Ends</Th>
                    <Th>
                      <span className="sr-only">Action</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.notStarted.map((e) => (
                    <tr key={e.id}>
                      <Td className="font-semibold">{e.firstName}</Td>
                      <Td className="font-semibold">{e.lastName}</Td>
                      <Td>{e.department ?? '—'}</Td>
                      <Td>{formatDate(e.probationEndDate)}</Td>
                      <Td>
                        <Button size="sm" variant="secondary" busy={busy === e.id} onClick={() => start(e)}>
                          Start Review
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

export function ProbationReviewPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['pf-probation', id],
    queryFn: () => api.get(`/api/performance/probation/${id}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const p = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pf-probation'] });
    qc.invalidateQueries({ queryKey: ['pf-me'] });
  };
  const acting = p.can.review || p.can.decide;
  return (
    <div>
      <PageHeader
        title={`Probation Review · ${p.employee.name}`}
        description={[
          p.employee.jobTitle,
          p.employee.department,
          `Probation ends ${formatDate(p.probationEndDate)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Badge tone={acting ? 'pending' : PROBATION_STATUS[p.status][1]}>
            {acting
              ? 'Your Turn'
              : p.status === 'COMPLETED'
                ? OUTCOME[p.decision][0]
                : PROBATION_STATUS[p.status][0]}
          </Badge>
        }
      />
      <div
        className={
          acting ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]' : 'grid gap-4'
        }
      >
        {acting && (
          <div className="grid gap-4 lg:sticky lg:top-4 lg:order-last">
            {p.can.review && <ManagerForm review={p} onDone={refresh} />}
            {p.can.decide && <DecideForm review={p} onDone={refresh} />}
          </div>
        )}
        <div className="grid min-w-0 gap-4">
          {p.status === 'COMPLETED' && (
            <Notice
              tone={OUTCOME[p.decision][1] === 'danger' ? 'danger' : 'ok'}
              title={`Decision: ${OUTCOME[p.decision][0]}`}
            >
              {p.decision === 'EXTEND' && `Probation extended until ${formatDate(p.extendedTo)}. `}
              {p.decision === 'NOT_CONFIRM' && 'Process their exit in Employee Management. '}
              By {p.decidedBy}, {formatDateTime(p.decidedAt)}.{p.hrComment ? ` “${p.hrComment}”` : ''}
            </Notice>
          )}
          <Section title="Employee">
            <Details
              items={[
                ['Name', p.employee.name],
                ['Job Title', p.employee.jobTitle],
                ['Department', p.employee.department],
                ['Started', p.employee.startDate && formatDate(p.employee.startDate)],
                ['Probation Ends', formatDate(p.probationEndDate)],
                ['Manager', p.manager?.name ?? 'None recorded (HR completes the review)'],
              ]}
            />
          </Section>
          {p.recommendation && (
            <Section title="Manager’s Review">
              <Details
                items={[
                  ...PROBATION_CRITERIA.map(([k, l]) => [
                    l,
                    p.ratings[k] && `${p.ratings[k]} · ${RATING_LABEL[p.ratings[k]]}`,
                  ]),
                  [
                    'Recommendation',
                    OUTCOME[p.recommendation][0] +
                      (p.recommendedExtendTo ? ` until ${formatDate(p.recommendedExtendTo)}` : ''),
                  ],
                  [
                    'Comments',
                    <span key="c" className="whitespace-pre-line">
                      {p.managerComment}
                    </span>,
                  ],
                  ['Completed', formatDateTime(p.managerDoneAt)],
                ]}
              />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function ManagerForm({ review: p, onDone }) {
  const [v, setV] = useState({
    work: '',
    conduct: '',
    attendance: '',
    learning: '',
    comment: '',
    recommendation: '',
    extendTo: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/performance/probation/${p.id}/manager`, {
        ratings: { work: v.work, conduct: v.conduct, attendance: v.attendance, learning: v.learning },
        comment: v.comment,
        recommendation: v.recommendation,
        extendTo: v.recommendation === 'EXTEND' ? v.extendTo : null,
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const ready = PROBATION_CRITERIA.every(([k]) => v[k]) && v.comment.trim() && v.recommendation;
  return (
    <Section title="Your Review" className="border-brand ring-1 ring-brand">
      <div className="space-y-3">
        {PROBATION_CRITERIA.map(([k, l]) => (
          <Field key={k} id={`pr-${k}`} label={l}>
            <Select id={`pr-${k}`} value={v[k]} onChange={set(k)}>
              <option value="">Choose</option>
              {RATINGS.map(([n, t]) => (
                <option key={n} value={n}>
                  {n} · {t}
                </option>
              ))}
            </Select>
          </Field>
        ))}
        <Field id="pr-comment" label="Comments">
          <Textarea id="pr-comment" rows={4} value={v.comment} onChange={set('comment')} />
        </Field>
        <Field id="pr-rec" label="Recommendation">
          <Select id="pr-rec" value={v.recommendation} onChange={set('recommendation')}>
            <option value="">Choose</option>
            {Object.entries(OUTCOME).map(([k, [l]]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {v.recommendation === 'EXTEND' && (
          <Field id="pr-ext" label="Extend Until">
            <Input
              id="pr-ext"
              type="date"
              min={p.probationEndDate}
              value={v.extendTo}
              onChange={set('extendTo')}
            />
          </Field>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <Button busy={busy} disabled={!ready} onClick={send}>
          Send To HR
        </Button>
      </div>
    </Section>
  );
}

function DecideForm({ review: p, onDone }) {
  const [v, setV] = useState({
    decision: p.recommendation ?? '',
    extendTo: p.recommendedExtendTo ?? '',
    comment: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/performance/probation/${p.id}/decide`, {
        decision: v.decision,
        extendTo: v.decision === 'EXTEND' ? v.extendTo : null,
        comment: v.comment.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="HR Decision" className="border-brand ring-1 ring-brand">
      <div className="space-y-3">
        <p className="text-sm">
          The manager recommends: <span className="font-semibold">{OUTCOME[p.recommendation][0]}</span>.
          Confirming or extending updates the employee record.
        </p>
        <Field id="pd-decision" label="Decision">
          <Select id="pd-decision" value={v.decision} onChange={set('decision')}>
            {Object.entries(OUTCOME).map(([k, [l]]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {v.decision === 'EXTEND' && (
          <Field id="pd-ext" label="Extend Until">
            <Input
              id="pd-ext"
              type="date"
              min={p.probationEndDate}
              value={v.extendTo}
              onChange={set('extendTo')}
            />
          </Field>
        )}
        <Field
          id="pd-comment"
          label="Comment"
          hint={
            v.decision !== p.recommendation
              ? 'Required: say why it differs from the recommendation.'
              : undefined
          }
        >
          <Textarea id="pd-comment" rows={3} value={v.comment} onChange={set('comment')} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button busy={busy} variant={v.decision === 'NOT_CONFIRM' ? 'danger' : 'primary'} onClick={send}>
          Make Decision
        </Button>
      </div>
    </Section>
  );
}
