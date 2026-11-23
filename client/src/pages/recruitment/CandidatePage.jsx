import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  Details,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '../../components/ui.jsx';
import { errorText } from '../requisitions/rq.js';
import { CandidateForm } from './VacancyPages.jsx';
import {
  ACTIVE_STAGES,
  EMPLOYMENT_TYPES,
  RECOMMENDATION,
  SOURCE_LABEL,
  STAGES,
  STAGE_LABEL,
  STAGE_TONE,
  UPLOAD_OK,
  UPLOAD_WRONG,
  addMonths,
  useRcOptions,
  whenText,
} from './rc.js';

/** One candidate (D114): details, CV, interviews and feedback, history, and what HR does next. */
export default function CandidatePage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['rc-candidate', id],
    queryFn: () => api.get(`/api/recruitment/candidates/${id}`),
  });
  const [editing, setEditing] = useState(false);
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const c = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['rc-candidate', id] });
    qc.invalidateQueries({ queryKey: ['rc-vacancy', String(c.vacancy.id)] });
    qc.invalidateQueries({ queryKey: ['rc-me'] });
  };
  const active = ACTIVE_STAGES.includes(c.stage);
  const myFeedback = c.interviews.filter((i) => i.myFeedbackDue);
  const side = (c.can.manage && active) || c.can.hire || myFeedback.length > 0;
  return (
    <div>
      <PageHeader
        title={c.name}
        description={
          <>
            Candidate for{' '}
            <Link to={`/recruitment/vacancies/${c.vacancy.id}`} className="text-brand hover:underline">
              {c.vacancy.jobTitle} · {c.vacancy.reference}
            </Link>
          </>
        }
        actions={<Badge tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}</Badge>}
      />
      <div
        className={
          side ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]' : 'grid gap-4'
        }
      >
        {side && (
          <div className="grid gap-4 lg:sticky lg:top-4 lg:order-last">
            {myFeedback.map((i) => (
              <FeedbackForm key={i.id} interview={i} onDone={refresh} />
            ))}
            {c.can.hire && <HireForm candidate={c} onDone={refresh} />}
            {c.can.manage && active && <StageForm candidate={c} onDone={refresh} />}
            {c.can.manage && active && <OfferForm candidate={c} onDone={refresh} />}
          </div>
        )}
        <div className="grid min-w-0 gap-4">
          {c.stage === 'HIRED' && c.hiredEmployeeId && (
            <Notice tone="ok" title="Hired">
              Their record is in Employee Management.{' '}
              <Link to={`/people/employees/${c.hiredEmployeeId}`} className="font-medium underline">
                Open the employee record
              </Link>
            </Notice>
          )}
          {editing ? (
            <CandidateForm
              candidate={c}
              onDone={() => {
                setEditing(false);
                refresh();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <Section
              title="Candidate"
              actions={
                c.can.manage && (
                  <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    Change
                  </Button>
                )
              }
            >
              <Details
                items={[
                  ['Name', c.name],
                  ['Email', c.email],
                  ['Phone', c.phone],
                  ['Where They Came From', SOURCE_LABEL[c.source]],
                  ['Applied', formatDateTime(c.appliedAt)],
                  [
                    'Offer',
                    c.offer &&
                      `Start ${formatDate(c.offer.startDate)} · ${{ PENDING: 'Waiting For Their Answer', ACCEPTED: 'Accepted', DECLINED: 'Declined' }[c.offer.status]}${c.offer.notes ? ` · ${c.offer.notes}` : ''}`,
                  ],
                  [
                    'Notes',
                    c.notes && (
                      <span key="n" className="whitespace-pre-line">
                        {c.notes}
                      </span>
                    ),
                  ],
                ]}
              />
            </Section>
          )}
          <Files candidate={c} onDone={refresh} />
          <Interviews candidate={c} onDone={refresh} />
          <Section title="History">
            <ol className="space-y-3 text-sm">
              {c.history.map((h, i) => (
                <li key={i} className="border-l-2 border-rule pl-3">
                  <p>
                    <span className="font-medium">
                      {h.from && h.from !== h.to
                        ? `${STAGE_LABEL[h.from]} → ${STAGE_LABEL[h.to]}`
                        : STAGE_LABEL[h.to]}
                    </span>{' '}
                    by {h.by}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(h.at)}</p>
                  {h.comment && <p className="mt-1 whitespace-pre-line">{h.comment}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}

function useAct(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function StageForm({ candidate: c, onDone }) {
  const [stage, setStage] = useState('');
  const [comment, setComment] = useState('');
  const { busy, error, run } = useAct(onDone);
  const choices = STAGES.filter(([k]) => !['HIRED', 'OFFER', c.stage].includes(k));
  return (
    <Section title="Move To Another Stage" className="border-brand ring-1 ring-brand">
      <div className="space-y-3">
        <Field id="s-stage" label="Stage">
          <Select id="s-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Choose A Stage</option>
            {choices.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="s-comment"
          label="Comment"
          hint={
            stage === 'REJECTED'
              ? 'Required. Kept in the history; never sent to the candidate.'
              : 'Kept in the history.'
          }
        >
          <Textarea id="s-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button
          busy={busy}
          disabled={!stage}
          variant={stage === 'REJECTED' ? 'danger' : 'primary'}
          onClick={() =>
            run(() =>
              api.post(`/api/recruitment/candidates/${c.id}/stage`, {
                stage,
                comment: comment.trim() || null,
              }),
            ).then((ok) => ok && (setStage(''), setComment('')))
          }
        >
          {stage === 'REJECTED' ? 'Mark Not Successful' : 'Move'}
        </Button>
      </div>
    </Section>
  );
}

function OfferForm({ candidate: c, onDone }) {
  const [v, setV] = useState({
    startDate: c.offer?.startDate ?? '',
    notes: c.offer?.notes ?? '',
    status: c.offer?.status ?? 'PENDING',
  });
  const { busy, error, run } = useAct(onDone);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Section title={c.offer ? 'Offer' : 'Make An Offer'}>
      <div className="space-y-3">
        <Field id="o-start" label="Start Date">
          <Input id="o-start" type="date" value={v.startDate} onChange={set('startDate')} />
        </Field>
        <Field id="o-status" label="Their Answer">
          <Select id="o-status" value={v.status} onChange={set('status')}>
            <option value="PENDING">Waiting For Their Answer</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="DECLINED">Declined</option>
          </Select>
        </Field>
        <Field id="o-notes" label="Notes" optional hint="For example the salary or terms agreed.">
          <Textarea id="o-notes" rows={2} value={v.notes} onChange={set('notes')} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button
          busy={busy}
          disabled={!v.startDate}
          variant="secondary"
          onClick={() =>
            run(() =>
              api.post(`/api/recruitment/candidates/${c.id}/offer`, { ...v, notes: v.notes.trim() || null }),
            )
          }
        >
          Save Offer
        </Button>
      </div>
    </Section>
  );
}

function HireForm({ candidate: c, onDone }) {
  const opts = useRcOptions();
  const vac = useQuery({
    queryKey: ['rc-vacancy', String(c.vacancy.id)],
    queryFn: () => api.get(`/api/recruitment/vacancies/${c.vacancy.id}`),
  });
  const [v, setV] = useState(null);
  const { busy, error, run } = useAct(onDone);
  if (opts.isPending || vac.isPending) return <Loading />;
  if (opts.isError || vac.isError) return <LoadError error={opts.error ?? vac.error} />;
  const o = opts.data;
  const x = vac.data;
  const start = c.offer?.startDate ?? '';
  const val = v ?? {
    employeeNumber: '',
    email: c.email ?? '',
    jobTitle: x.jobTitle,
    companyId: String(x.companyId),
    departmentId: String(x.departmentId),
    branchId: String(x.branchId ?? ''),
    lineManagerId: String(x.hiringManager?.id ?? ''),
    employmentStartDate: start,
    employmentType: x.employmentType,
    contractEndDate: '',
    probationEndDate: addMonths(start, 3),
  };
  const set = (k) => (e) => setV({ ...val, [k]: e.target.value });
  return (
    <Section
      title={c.internal ? 'Appoint To The Position' : 'Hire'}
      className="border-brand ring-1 ring-brand"
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            api.post(`/api/recruitment/candidates/${c.id}/hire`, {
              ...val,
              branchId: val.branchId || null,
              lineManagerId: val.lineManagerId || null,
              contractEndDate: val.contractEndDate || null,
              probationEndDate: val.probationEndDate || null,
            }),
          );
        }}
      >
        <p className="text-sm">
          {c.internal
            ? 'They accepted the offer. Appointing them updates their record in Employee Management.'
            : 'They accepted the offer. Hiring adds them to Employee Management, on probation until the date below.'}
        </p>
        {!c.internal && (
          <div className="form-row">
            <Field id="x-number" label="Employee Number">
              <Input id="x-number" required value={val.employeeNumber} onChange={set('employeeNumber')} />
            </Field>
            <Field id="x-email" label="Work Email" optional hint="They sign in with it.">
              <Input id="x-email" type="email" value={val.email} onChange={set('email')} />
            </Field>
          </div>
        )}
        <Field id="x-title" label="Job Title">
          <Input id="x-title" required value={val.jobTitle} onChange={set('jobTitle')} />
        </Field>
        <Field id="x-dept" label="Department">
          <Select
            id="x-dept"
            required
            value={val.departmentId}
            onChange={(e) => {
              const d = o.departments.find((dd) => String(dd.id) === e.target.value);
              setV({
                ...val,
                departmentId: e.target.value,
                companyId: String(d?.companyId ?? val.companyId),
                branchId: '',
              });
            }}
          >
            {o.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {o.companies.find((cc) => cc.id === d.companyId)?.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="x-branch" label="Branch" optional>
          <Select id="x-branch" value={val.branchId} onChange={set('branchId')}>
            <option value="">Not Set</option>
            {o.branches
              .filter((b) => String(b.companyId) === val.companyId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="x-manager" label="Line Manager" optional>
          <Select id="x-manager" value={val.lineManagerId} onChange={set('lineManagerId')}>
            <option value="">None</option>
            {o.employees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="form-row">
          {!c.internal && (
            <Field id="x-start" label="Start Date">
              <Input
                id="x-start"
                type="date"
                required
                value={val.employmentStartDate}
                onChange={(e) =>
                  setV({
                    ...val,
                    employmentStartDate: e.target.value,
                    probationEndDate: addMonths(e.target.value, 3),
                  })
                }
              />
            </Field>
          )}
          <Field id="x-type" label="Employment Type">
            <Select id="x-type" value={val.employmentType} onChange={set('employmentType')}>
              {EMPLOYMENT_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="form-row">
          <Field id="x-probation" label="Probation Ends" optional>
            <Input
              id="x-probation"
              type="date"
              value={val.probationEndDate}
              onChange={set('probationEndDate')}
            />
          </Field>
          {val.employmentType !== 'PERMANENT' && (
            <Field id="x-contract" label="Contract Ends" optional>
              <Input
                id="x-contract"
                type="date"
                value={val.contractEndDate}
                onChange={set('contractEndDate')}
              />
            </Field>
          )}
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" busy={busy}>
          {c.internal ? 'Appoint' : 'Hire And Add To Employee Management'}
        </Button>
      </form>
    </Section>
  );
}

function Files({ candidate: c, onDone }) {
  const input = useRef(null);
  const [kind, setKind] = useState('cv');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const upload = async (file) => {
    setError(null);
    if (!file) return;
    if (!UPLOAD_OK.test(file.name)) return setError(UPLOAD_WRONG);
    setBusy('upload');
    try {
      await api.upload(`/api/recruitment/candidates/${c.id}/files?kind=${kind}`, file);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };
  const remove = async (fid) => {
    setBusy(fid);
    setError(null);
    try {
      await api.del(`/api/recruitment/files/${fid}`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="CV And Documents">
      {c.files.length === 0 ? (
        <p className="muted-text">No CV yet.</p>
      ) : (
        <ul className="divide-y divide-rule text-sm">
          {c.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <a
                  href={`/api/recruitment/files/${f.id}/download?view=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand hover:underline"
                >
                  {f.name}
                </a>
                <span className="ml-2 text-muted">{f.kind === 'CV' ? 'CV' : 'Document'}</span>
                <span className="block text-xs text-muted">
                  {f.uploadedBy} · {formatDateTime(f.uploadedAt)}
                </span>
              </span>
              <span className="flex gap-2">
                <a href={`/api/recruitment/files/${f.id}/download`} className="btn btn-sm">
                  Download
                </a>
                {c.can.manage && (
                  <Button variant="danger" size="sm" busy={busy === f.id} onClick={() => remove(f.id)}>
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {c.can.upload && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field id="f-kind" label="Type">
            <Select id="f-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="cv">CV</option>
              <option value="other">Other Document</option>
            </Select>
          </Field>
          <input
            ref={input}
            type="file"
            accept=".pdf,.docx,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button variant="secondary" busy={busy === 'upload'} onClick={() => input.current?.click()}>
            Upload A File
          </Button>
          <span className="text-xs text-muted">PDF, Word (.docx), JPEG or PNG</span>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Section>
  );
}

function Interviews({ candidate: c, onDone }) {
  const [scheduling, setScheduling] = useState(false);
  const { busy, error, run } = useAct(onDone);
  return (
    <Section
      title="Interviews"
      actions={
        c.can.manage &&
        ACTIVE_STAGES.includes(c.stage) &&
        !scheduling && (
          <Button size="sm" variant="secondary" onClick={() => setScheduling(true)}>
            Schedule Interview
          </Button>
        )
      }
    >
      {scheduling && (
        <ScheduleForm
          candidate={c}
          onDone={() => {
            setScheduling(false);
            onDone();
          }}
          onCancel={() => setScheduling(false)}
        />
      )}
      {c.interviews.length === 0 ? (
        !scheduling && <p className="muted-text">No interviews yet.</p>
      ) : (
        <ul className="space-y-4">
          {c.interviews.map((i) => (
            <li key={i.id} className="rounded-md border border-rule p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {whenText(i.scheduledAt)}
                  {i.location ? ` · ${i.location}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={{ SCHEDULED: 'pending', DONE: 'ok', CANCELLED: 'neutral' }[i.status]}>
                    {{ SCHEDULED: 'Scheduled', DONE: 'Feedback In', CANCELLED: 'Cancelled' }[i.status]}
                  </Badge>
                  {c.can.manage && i.status === 'SCHEDULED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      busy={busy}
                      onClick={() => run(() => api.post(`/api/recruitment/interviews/${i.id}/cancel`))}
                    >
                      Cancel
                    </Button>
                  )}
                </span>
              </div>
              {i.notes && <p className="mt-1 text-muted">{i.notes}</p>}
              <ul className="mt-2 space-y-2">
                {i.panel.map((p) => (
                  <li key={p.employeeId}>
                    <span className="font-medium">{p.name}</span>
                    {p.submittedAt ? (
                      <>
                        {' '}
                        · {p.rating}/5 ·{' '}
                        <Badge tone={RECOMMENDATION[p.recommendation][1]}>
                          {RECOMMENDATION[p.recommendation][0]}
                        </Badge>
                        {p.comments && <p className="mt-0.5 whitespace-pre-line text-ink-2">{p.comments}</p>}
                      </>
                    ) : (
                      <span className="text-muted"> · feedback not given yet</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
    </Section>
  );
}

function ScheduleForm({ candidate: c, onDone, onCancel }) {
  const opts = useRcOptions();
  const [v, setV] = useState({ date: '', time: '09:00', location: '', notes: '', panel: [] });
  const [pick, setPick] = useState('');
  const { busy, error, run } = useAct(onDone);
  const people = opts.data?.employees ?? [];
  const add = (id) => id && !v.panel.includes(Number(id)) && setV({ ...v, panel: [...v.panel, Number(id)] });
  return (
    <div className="mb-4 space-y-3 rounded-md border border-rule p-4">
      <div className="form-row">
        <Field id="i-date" label="Date">
          <Input
            id="i-date"
            type="date"
            value={v.date}
            onChange={(e) => setV({ ...v, date: e.target.value })}
          />
        </Field>
        <Field id="i-time" label="Time">
          <Input
            id="i-time"
            type="time"
            value={v.time}
            onChange={(e) => setV({ ...v, time: e.target.value })}
          />
        </Field>
        <Field id="i-where" label="Where" optional hint="A room, an address or a Teams link.">
          <Input id="i-where" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
        </Field>
      </div>
      <Field id="i-panel" label="Panel" hint="Each person is told, sees the CV and gives feedback.">
        <Select
          id="i-panel"
          value={pick}
          onChange={(e) => {
            add(e.target.value);
            setPick('');
          }}
        >
          <option value="">Add Someone To The Panel</option>
          {people
            .filter((p) => !v.panel.includes(p.id) && p.id !== c.employeeId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.department ? ` · ${p.department}` : ''}
              </option>
            ))}
        </Select>
      </Field>
      {v.panel.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {v.panel.map((pid) => (
            <li key={pid}>
              <button
                type="button"
                className="pill pill-brand"
                title="Remove From The Panel"
                onClick={() => setV({ ...v, panel: v.panel.filter((x) => x !== pid) })}
              >
                {people.find((p) => p.id === pid)?.name} ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Field id="i-notes" label="Notes For The Panel" optional>
        <Textarea
          id="i-notes"
          rows={2}
          value={v.notes}
          onChange={(e) => setV({ ...v, notes: e.target.value })}
        />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex gap-2">
        <Button
          busy={busy}
          disabled={!v.date || !v.time || v.panel.length === 0}
          onClick={() =>
            run(() =>
              api.post(`/api/recruitment/candidates/${c.id}/interviews`, {
                scheduledAt: `${v.date}T${v.time}`,
                location: v.location.trim() || null,
                notes: v.notes.trim() || null,
                panel: v.panel,
              }),
            )
          }
        >
          Schedule And Tell The Panel
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FeedbackForm({ interview: i, onDone }) {
  const [v, setV] = useState({ rating: '', recommendation: '', comments: '' });
  const { busy, error, run } = useAct(onDone);
  return (
    <Section title="Your Interview Feedback" className="border-brand ring-1 ring-brand">
      <div className="space-y-3">
        <p className="text-sm">
          Interview on {whenText(i.scheduledAt)}
          {i.location ? `, ${i.location}` : ''}.
        </p>
        <div className="form-row">
          <Field id={`fb-r-${i.id}`} label="Rating">
            <Select
              id={`fb-r-${i.id}`}
              value={v.rating}
              onChange={(e) => setV({ ...v, rating: e.target.value })}
            >
              <option value="">Choose</option>
              <option value="5">5 · Excellent</option>
              <option value="4">4 · Good</option>
              <option value="3">3 · Acceptable</option>
              <option value="2">2 · Weak</option>
              <option value="1">1 · Poor</option>
            </Select>
          </Field>
          <Field id={`fb-x-${i.id}`} label="Recommendation">
            <Select
              id={`fb-x-${i.id}`}
              value={v.recommendation}
              onChange={(e) => setV({ ...v, recommendation: e.target.value })}
            >
              <option value="">Choose</option>
              <option value="HIRE">Hire</option>
              <option value="MAYBE">Maybe</option>
              <option value="NO_HIRE">Do Not Hire</option>
            </Select>
          </Field>
        </div>
        <Field id={`fb-c-${i.id}`} label="Comments" optional>
          <Textarea
            id={`fb-c-${i.id}`}
            rows={3}
            value={v.comments}
            onChange={(e) => setV({ ...v, comments: e.target.value })}
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button
          busy={busy}
          disabled={!v.rating || !v.recommendation}
          onClick={() =>
            run(() =>
              api.post(`/api/recruitment/interviews/${i.id}/feedback`, {
                rating: Number(v.rating),
                recommendation: v.recommendation,
                comments: v.comments.trim() || null,
              }),
            )
          }
        >
          Send Feedback
        </Button>
      </div>
    </Section>
  );
}
