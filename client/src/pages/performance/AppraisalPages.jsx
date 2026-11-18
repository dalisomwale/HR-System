import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import { formatDate, formatDateTime } from '../../lib/format.js';
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
  Textarea,
  Th,
} from '../../components/ui.jsx';
import { errorText } from '../requisitions/rq.js';
import { PHASE, RATINGS, RATING_LABEL, STATUS, nextText, usePf } from './pf.js';

function AppraisalTable({ items, me, showEmployee = true, title }) {
  return (
    <Table title={title}>
      <thead>
        <tr>
          {showEmployee && <Th>Employee</Th>}
          {showEmployee && <Th>Department</Th>}
          <Th>Review cycle</Th>
          <Th>Manager</Th>
          <Th>Status</Th>
          <Th>Next</Th>
          <Th className="text-right">Overall</Th>
          <Th>
            <span className="sr-only">Action</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {items.map((a) => {
          const n = nextText(a, me);
          return (
            <tr key={a.id}>
              {showEmployee && (
                <Td className="font-semibold">
                  {a.employee.name}
                  <span className="block text-xs font-normal text-muted">{a.employee.jobTitle}</span>
                </Td>
              )}
              {showEmployee && <Td>{a.employee.department ?? '—'}</Td>}
              <Td>{a.cycle.name}</Td>
              <Td>{a.manager?.name ?? <span className="text-muted">HR</span>}</Td>
              <Td>
                <Badge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge>
              </Td>
              <Td>{n?.text ?? '—'}</Td>
              <Td className="text-right">{a.overallScore ?? '—'}</Td>
              <Td>
                <Link
                  to={`/performance/appraisals/${a.id}`}
                  className={`btn btn-sm whitespace-nowrap ${n?.mine ? 'btn-primary' : ''}`}
                >
                  {n?.mine ? 'Your turn' : 'View'}
                </Link>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function MyAppraisalsPage() {
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['pf-appraisals', 'mine'],
    queryFn: () => api.get('/api/performance/appraisals?scope=mine'),
  });
  return (
    <div>
      <PageHeader title="My appraisals" description="Your goals and appraisals, one for each review cycle." />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="You have no appraisals yet." />
          </div>
        ) : (
          <AppraisalTable items={q.data.items} me={me?.id} showEmployee={false} title="My appraisals" />
        ))}
    </div>
  );
}

/** My team's appraisals, or everyone's for those who see all. */
export function TeamAppraisalsPage() {
  const { data: me } = useMe();
  const pf = usePf();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'all' && pf.data?.viewAll ? 'all' : 'team';
  const status = params.get('status') ?? '';
  const cycleId = params.get('cycleId') ?? '';
  const q = useQuery({
    queryKey: ['pf-appraisals', scope, status, cycleId],
    queryFn: () =>
      api.get(
        `/api/performance/appraisals?scope=${scope}${status ? `&status=${status}` : ''}${cycleId ? `&cycleId=${cycleId}` : ''}`,
      ),
    enabled: !pf.isPending,
  });
  const set = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };
  return (
    <div>
      <PageHeader
        title={scope === 'all' ? 'All appraisals' : 'My team'}
        description={
          scope === 'all'
            ? 'Every appraisal in the group.'
            : 'The appraisals of the people who report to you.'
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {pf.data?.viewAll && (
          <div className="pill-tabs">
            <button
              type="button"
              className="pill-tab"
              aria-selected={scope === 'team'}
              onClick={() => set('scope', '')}
            >
              My team
            </button>
            <button
              type="button"
              className="pill-tab"
              aria-selected={scope === 'all'}
              onClick={() => set('scope', 'all')}
            >
              Everyone
            </button>
          </div>
        )}
        <div className="w-64">
          <Field id="pf-status" label="Status">
            <Select id="pf-status" value={status} onChange={(e) => set('status', e.target.value)}>
              <option value="">All</option>
              {Object.entries(STATUS).map(([k, [l]]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      {(q.isPending || pf.isPending) && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No appraisals here." />
          </div>
        ) : (
          <AppraisalTable
            items={q.data.items}
            me={me?.id}
            title={scope === 'all' ? 'All appraisals' : 'My team'}
          />
        ))}
    </div>
  );
}

const STEPS = [
  ['Goals', ['GOALS_DRAFT', 'GOALS_SUBMITTED']],
  ['Mid-year', ['GOALS_AGREED', 'MID_SELF_DONE']],
  ['Year end', ['MID_DONE', 'FINAL_SELF_DONE']],
  ['HR sign-off', ['FINAL_MANAGER_DONE']],
];
const ORDER = [
  'GOALS_DRAFT',
  'GOALS_SUBMITTED',
  'GOALS_AGREED',
  'MID_SELF_DONE',
  'MID_DONE',
  'FINAL_SELF_DONE',
  'FINAL_MANAGER_DONE',
  'SIGNED_OFF',
];

/** One appraisal: where it stands, the goals, and the step for whoever's turn it is. */
export function AppraisalPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['pf-appraisal', id],
    queryFn: () => api.get(`/api/performance/appraisals/${id}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const a = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pf-appraisal', id] });
    qc.invalidateQueries({ queryKey: ['pf-appraisals'] });
    qc.invalidateQueries({ queryKey: ['pf-me'] });
    qc.invalidateQueries({ queryKey: ['pf-summary'] });
  };
  const at = ORDER.indexOf(a.status);
  const action = a.yourTurn ? a.next : null;
  return (
    <div>
      <PageHeader
        title={`${a.employee.name} · ${a.cycle.name}`}
        description={[
          a.employee.jobTitle,
          a.employee.department,
          a.manager ? `Manager: ${a.manager.name}` : 'No manager: HR',
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Badge tone={action ? 'pending' : STATUS[a.status][1]}>
            {action ? 'Your turn' : STATUS[a.status][0]}
          </Badge>
        }
      />
      <div className="stack">
        <ol className="grid gap-3 sm:grid-cols-4">
          {STEPS.map(([label, during], i) => {
            const end = ORDER.indexOf(during.at(-1));
            const done = at > end;
            const now = during.includes(a.status);
            return (
              <li
                key={label}
                className={`rounded-md border p-3 text-sm ${now ? 'border-brand ring-1 ring-brand' : 'border-rule'} bg-white`}
              >
                <p className="text-xs text-muted">Step {i + 1}</p>
                <p className="font-semibold">{label}</p>
                <p className="mt-1">
                  {done ? (
                    <Badge tone="ok">Done</Badge>
                  ) : now ? (
                    <Badge tone="pending">Now</Badge>
                  ) : (
                    <Badge tone="neutral">Later</Badge>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
        {a.status === 'SIGNED_OFF' && (
          <Notice tone="ok" title={`Overall: ${a.overallScore} · ${a.overallRating}`}>
            Signed off {formatDateTime(a.signedOffAt)}.{a.hrComment ? ` HR: “${a.hrComment}”` : ''}
          </Notice>
        )}
        <div
          className={
            action || a.can.editGoals
              ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]'
              : 'grid gap-4'
          }
        >
          {(action || a.can.editGoals) && (
            <div className="grid gap-4 lg:sticky lg:top-4 lg:order-last">
              <ActionBox
                key={`${a.status}-${a.goals.map((g) => g.id).join('.')}`}
                appraisal={a}
                onDone={refresh}
              />
            </div>
          )}
          <div className="grid min-w-0 gap-4">
            {a.can.editGoals ? <GoalsEditor appraisal={a} onDone={refresh} /> : <GoalsView appraisal={a} />}
            {(a.midSelfComment || a.midManagerComment) && (
              <Section title="Mid-year">
                <dl className="detail-list">
                  <div>
                    <dt>{a.employee.name}</dt>
                    <dd className="whitespace-pre-line">
                      {a.midSelfComment || <span className="not-set">Not given</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Manager</dt>
                    <dd className="whitespace-pre-line">
                      {a.midManagerComment || <span className="not-set">Not yet</span>}
                    </dd>
                  </div>
                </dl>
              </Section>
            )}
            {(a.finalSelfComment || a.finalManagerComment || a.overallScore != null) && (
              <Section title="Year end">
                <dl className="detail-list">
                  <div>
                    <dt>{a.employee.name}</dt>
                    <dd className="whitespace-pre-line">
                      {a.finalSelfComment || <span className="not-set">Not given</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Manager</dt>
                    <dd className="whitespace-pre-line">
                      {a.finalManagerComment || <span className="not-set">Not yet</span>}
                    </dd>
                  </div>
                  {a.overallScore != null && (
                    <div>
                      <dt>Overall</dt>
                      <dd>
                        {a.overallScore} · {a.overallRating}
                      </dd>
                    </div>
                  )}
                  {a.hrComment && (
                    <div>
                      <dt>HR</dt>
                      <dd className="whitespace-pre-line">{a.hrComment}</dd>
                    </div>
                  )}
                </dl>
              </Section>
            )}
            <Section title="History">
              {a.history.length === 0 ? (
                <p className="muted-text">Nothing yet.</p>
              ) : (
                <ol className="space-y-3 text-sm">
                  {a.history.map((h, i) => (
                    <li key={i} className="border-l-2 border-rule pl-3">
                      <p>
                        <span className="font-medium">{STATUS[h.to]?.[0] ?? h.to}</span> · {h.by}
                      </p>
                      <p className="text-xs text-muted">{formatDateTime(h.at)}</p>
                      {h.comment && <p className="mt-1 whitespace-pre-line">{h.comment}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoalsView({ appraisal: a }) {
  if (!a.goals.length) {
    return (
      <Section title="Goals">
        <p className="muted-text">No goals yet.</p>
      </Section>
    );
  }
  return (
    <Section title="Goals">
      <ol className="space-y-4">
        {a.goals.map((g, i) => (
          <li key={g.id} className="rounded-md border border-rule p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">
                {i + 1}. {g.title}
              </p>
              <span className="text-muted">Weight {g.weight}%</span>
            </div>
            {g.description && <p className="mt-1 whitespace-pre-line">{g.description}</p>}
            {g.measure && <p className="mt-1 text-muted">Measured by: {g.measure}</p>}
            {g.midProgress && (
              <p className="mt-2">
                <span className="font-medium">Mid-year progress:</span> {g.midProgress}
              </p>
            )}
            {(g.selfRating || g.managerRating) && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {g.selfRating && (
                  <p>
                    <span className="font-medium">Self:</span> {g.selfRating} · {RATING_LABEL[g.selfRating]}
                    {g.selfComment && <span className="block text-muted">{g.selfComment}</span>}
                  </p>
                )}
                {g.managerRating && (
                  <p>
                    <span className="font-medium">Manager:</span> {g.managerRating} ·{' '}
                    {RATING_LABEL[g.managerRating]}
                    {g.managerComment && <span className="block text-muted">{g.managerComment}</span>}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function GoalsEditor({ appraisal: a, onDone }) {
  const [goals, setGoals] = useState(
    a.goals.length
      ? a.goals.map((g) => ({
          title: g.title,
          description: g.description ?? '',
          measure: g.measure ?? '',
          weight: String(g.weight),
        }))
      : [{ title: '', description: '', measure: '', weight: '' }],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const total = goals.reduce((s, g) => s + (Number(g.weight) || 0), 0);
  const set = (i, k) => (e) => setGoals(goals.map((g, j) => (j === i ? { ...g, [k]: e.target.value } : g)));
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.put(`/api/performance/appraisals/${a.id}/goals`, {
        goals: goals.filter((g) => g.title.trim()).map((g) => ({ ...g, weight: Number(g.weight) || 0 })),
      });
      setMsg({ tone: 'ok', text: 'Goals saved.' });
      onDone();
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Goals"
      description={`Weights add up to ${total}${total === 100 ? '' : ' (they must add up to 100)'}`}
    >
      <div className="stack">
        {goals.map((g, i) => (
          <div key={i} className="rounded-md border border-rule p-3">
            <div className="form-row">
              <Field id={`g-t-${i}`} label={`Goal ${i + 1}`}>
                <Input id={`g-t-${i}`} value={g.title} onChange={set(i, 'title')} />
              </Field>
              <Field id={`g-w-${i}`} label="Weight (%)">
                <Input
                  id={`g-w-${i}`}
                  type="number"
                  min={1}
                  max={100}
                  value={g.weight}
                  onChange={set(i, 'weight')}
                />
              </Field>
            </div>
            <Field id={`g-m-${i}`} label="How it is measured" optional>
              <Input id={`g-m-${i}`} value={g.measure} onChange={set(i, 'measure')} />
            </Field>
            <Field id={`g-d-${i}`} label="Details" optional>
              <Textarea id={`g-d-${i}`} rows={2} value={g.description} onChange={set(i, 'description')} />
            </Field>
            {goals.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setGoals(goals.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden /> Remove goal
              </Button>
            )}
          </div>
        ))}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          {goals.length < 15 && (
            <Button
              variant="secondary"
              onClick={() => setGoals([...goals, { title: '', description: '', measure: '', weight: '' }])}
            >
              <Plus aria-hidden /> Add goal
            </Button>
          )}
          <Button busy={busy} onClick={save}>
            Save goals
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** What the viewer does now, highlighted at the side. */
function ActionBox({ appraisal: a, onDone }) {
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      a.goals.map((g) => [g.id, { midProgress: g.midProgress ?? '', rating: '', comment: '' }]),
    ),
  );
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const send = async (action, needs) => {
    setBusy(action);
    setError(null);
    try {
      await api.post(`/api/performance/appraisals/${a.id}/action`, {
        action,
        comment: comment.trim() || null,
        goals: a.goals.map((g) => ({
          id: g.id,
          midProgress: rows[g.id]?.midProgress?.trim() || null,
          rating: needs === 'rating' ? Number(rows[g.id]?.rating) || null : null,
          comment: rows[g.id]?.comment?.trim() || null,
        })),
      });
      setComment('');
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const set = (gid, k) => (e) => setRows({ ...rows, [gid]: { ...rows[gid], [k]: e.target.value } });
  const n = a.yourTurn ? a.next : null;
  const v = a.viewer;
  const goalsStep = a.status === 'GOALS_DRAFT' || a.status === 'GOALS_SUBMITTED';
  const mid = v.self && a.status === 'GOALS_AGREED' && a.cycle.phase === 'MID_YEAR';
  const finalSelf =
    v.self &&
    ['GOALS_AGREED', 'MID_SELF_DONE', 'MID_DONE'].includes(a.status) &&
    a.cycle.phase === 'YEAR_END';
  const finalManager = v.manager && a.status === 'FINAL_SELF_DONE';
  const midManager = v.manager && a.status === 'MID_SELF_DONE' && a.cycle.phase !== 'YEAR_END';
  const signoff = v.hr && a.status === 'FINAL_MANAGER_DONE';
  const title = n?.label ?? 'Goals';
  const commentField = (label, hint) => (
    <Field id="pf-comment" label={label} hint={hint}>
      <Textarea id="pf-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
    </Field>
  );
  const due = { GOAL_SETTING: a.cycle.goalsDue, MID_YEAR: a.cycle.midYearDue, YEAR_END: a.cycle.yearEndDue }[
    a.cycle.phase
  ];
  return (
    <Section
      title={title}
      description={due ? `Due by ${formatDate(due)}` : PHASE[a.cycle.phase][0]}
      className="border-brand ring-1 ring-brand"
    >
      <div className="space-y-3 text-sm">
        {goalsStep && v.self && a.status === 'GOALS_DRAFT' && (
          <>
            <p>
              Write your goals for the year (save them on the left), then send them to your manager to agree.
            </p>
            <Button busy={busy === 'SUBMIT_GOALS'} onClick={() => send('SUBMIT_GOALS')}>
              Send goals to my manager
            </Button>
          </>
        )}
        {goalsStep && v.self && a.status === 'GOALS_SUBMITTED' && (
          <p>Your goals are with your manager to agree.</p>
        )}
        {goalsStep && v.manager && (
          <>
            <p>
              {a.status === 'GOALS_SUBMITTED'
                ? 'Check the goals (you can adjust them on the left), then agree them or send them back.'
                : 'The goals have not been sent yet. You can still agree them once they are complete.'}
            </p>
            {a.status === 'GOALS_SUBMITTED' && commentField('Comment', 'Required to send them back.')}
            <div className="flex flex-wrap gap-2">
              <Button busy={busy === 'AGREE_GOALS'} onClick={() => send('AGREE_GOALS')}>
                Agree goals
              </Button>
              {a.status === 'GOALS_SUBMITTED' && (
                <Button
                  variant="secondary"
                  busy={busy === 'RETURN_GOALS'}
                  onClick={() => send('RETURN_GOALS')}
                >
                  Send back
                </Button>
              )}
            </div>
          </>
        )}
        {mid && (
          <>
            <p>Say how each goal is going.</p>
            {a.goals.map((g) => (
              <Field key={g.id} id={`mp-${g.id}`} label={g.title}>
                <Textarea
                  id={`mp-${g.id}`}
                  rows={2}
                  value={rows[g.id].midProgress}
                  onChange={set(g.id, 'midProgress')}
                />
              </Field>
            ))}
            {commentField('Overall', undefined)}
            <Button busy={busy === 'MID_SELF'} onClick={() => send('MID_SELF')}>
              Send to my manager
            </Button>
          </>
        )}
        {midManager && (
          <>
            <p>Read the progress on the left and give your mid-year comments.</p>
            {commentField('Your comments', 'Required.')}
            <Button busy={busy === 'MID_MANAGER'} onClick={() => send('MID_MANAGER')}>
              Complete mid-year review
            </Button>
          </>
        )}
        {(finalSelf || finalManager) && (
          <>
            <p>
              {finalSelf
                ? 'Rate yourself on each goal.'
                : 'Rate each goal. The weighted average gives the overall score.'}
            </p>
            {a.goals.map((g) => (
              <div key={g.id} className="rounded-md border border-rule p-2">
                <p className="mb-1 font-medium">
                  {g.title} <span className="font-normal text-muted">· {g.weight}%</span>
                </p>
                {finalManager && g.selfRating && (
                  <p className="mb-1 text-muted">
                    Self: {g.selfRating} · {RATING_LABEL[g.selfRating]}
                  </p>
                )}
                <Field id={`r-${g.id}`} label="Rating">
                  <Select id={`r-${g.id}`} value={rows[g.id].rating} onChange={set(g.id, 'rating')}>
                    <option value="">Choose</option>
                    {RATINGS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {k} · {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`rc-${g.id}`} label="Comment" optional>
                  <Input id={`rc-${g.id}`} value={rows[g.id].comment} onChange={set(g.id, 'comment')} />
                </Field>
              </div>
            ))}
            {commentField(
              finalSelf ? 'Overall comments' : 'Your overall comments',
              finalManager ? 'Required.' : undefined,
            )}
            <Button busy={!!busy} onClick={() => send(finalSelf ? 'FINAL_SELF' : 'FINAL_MANAGER', 'rating')}>
              {finalSelf ? 'Send to my manager' : 'Complete appraisal'}
            </Button>
          </>
        )}
        {signoff && (
          <>
            <p>
              Overall {a.overallScore} · {a.overallRating}. Sign it off, or send it back to the manager.
            </p>
            {commentField('Comment', 'Required to send it back.')}
            <div className="flex flex-wrap gap-2">
              <Button busy={busy === 'SIGN_OFF'} onClick={() => send('SIGN_OFF')}>
                Sign off
              </Button>
              <Button
                variant="secondary"
                busy={busy === 'RETURN_TO_MANAGER'}
                onClick={() => send('RETURN_TO_MANAGER')}
              >
                Send back to the manager
              </Button>
            </div>
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Section>
  );
}
