import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui.jsx';
import { errorText } from '../requisitions/rq.js';
import { EMPLOYMENT_LABEL, UPLOAD_OK, UPLOAD_WRONG, whenText } from './rc.js';

/** Open positions (D114): internal vacancies any member of staff can apply for. */
export function JobsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rc-jobs'], queryFn: () => api.get('/api/recruitment/jobs') });
  const [applying, setApplying] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const apply = async (job) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/api/recruitment/jobs/${job.id}/apply`, { note: note.trim() || null });
      setMsg({ tone: 'ok', text: `Application sent for ${job.jobTitle}. Add your CV on My applications.` });
      setApplying(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['rc-jobs'] });
      qc.invalidateQueries({ queryKey: ['rc-applications'] });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Open positions"
        description="Positions in the group open to staff. Applying tells HR; your manager is not told by the system."
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>
            {msg.text}{' '}
            {msg.tone === 'ok' && (
              <Link to="/recruitment/applications" className="font-medium underline">
                My applications
              </Link>
            )}
          </Notice>
        </div>
      )}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No open positions right now." />
          </div>
        ) : (
          <div className="stack">
            {q.data.items.map((j) => (
              <Section
                key={j.id}
                title={j.jobTitle}
                description={`${j.department}, ${j.company}${j.branch ? ` · ${j.branch}` : ''}`}
              >
                <div className="space-y-3 text-sm">
                  <p className="text-muted">
                    {EMPLOYMENT_LABEL[j.employmentType]} · {j.positions}{' '}
                    {j.positions === 1 ? 'position' : 'positions'}
                    {j.closingDate ? ` · Closes ${formatDate(j.closingDate)}` : ''} · {j.reference}
                  </p>
                  {j.description && <p className="whitespace-pre-line">{j.description}</p>}
                  {j.requirements && (
                    <div>
                      <p className="font-semibold">Requirements</p>
                      <p className="whitespace-pre-line">{j.requirements}</p>
                    </div>
                  )}
                  {j.applied ? (
                    <Badge tone="ok">You have applied</Badge>
                  ) : applying === j.id ? (
                    <div className="space-y-3 rounded-md border border-rule p-3">
                      <Field id={`note-${j.id}`} label="A note to HR" optional>
                        <Textarea
                          id={`note-${j.id}`}
                          rows={3}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <Button busy={busy} onClick={() => apply(j)}>
                          Send application
                        </Button>
                        <Button variant="secondary" onClick={() => setApplying(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button onClick={() => setApplying(j.id)}>Apply</Button>
                  )}
                </div>
              </Section>
            ))}
          </div>
        ))}
    </div>
  );
}

/** My applications: where each stands, adding a CV, and withdrawing. */
export function ApplicationsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['rc-applications'],
    queryFn: () => api.get('/api/recruitment/applications'),
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const input = useRef(null);
  const [target, setTarget] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['rc-applications'] });
  const upload = async (file) => {
    setError(null);
    if (!file || !target) return;
    if (!UPLOAD_OK.test(file.name)) return setError(UPLOAD_WRONG);
    setBusy(`up-${target}`);
    try {
      await api.upload(`/api/recruitment/candidates/${target}/files?kind=cv`, file);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };
  const withdraw = async (id) => {
    setBusy(`w-${id}`);
    setError(null);
    try {
      await api.post(`/api/recruitment/applications/${id}/withdraw`);
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const tone = (s) =>
    ({ Successful: 'ok', 'Not successful': 'danger', Withdrawn: 'neutral', Offer: 'pending' })[s] ?? 'brand';
  return (
    <div>
      <PageHeader title="My applications" description="Positions you have applied for inside the group." />
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState
              title="You have not applied for anything yet."
              action={
                <Link to="/recruitment/jobs" className="text-brand hover:underline">
                  See open positions
                </Link>
              }
            />
          </div>
        ) : (
          <Table title="My applications">
            <thead>
              <tr>
                <Th>Position</Th>
                <Th>Department</Th>
                <Th>Applied</Th>
                <Th>Status</Th>
                <Th>CV</Th>
                <Th>
                  <span className="sr-only">Action</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((a) => (
                <tr key={a.id} data-date={String(a.appliedAt).slice(0, 10)}>
                  <Td className="font-semibold">
                    {a.jobTitle}
                    <span className="block text-xs font-normal text-muted">{a.reference}</span>
                  </Td>
                  <Td>{a.department}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(a.appliedAt)}</Td>
                  <Td>
                    <Badge tone={tone(a.status)}>{a.status}</Badge>
                  </Td>
                  <Td>
                    {a.files.length ? (
                      a.files.map((f) => (
                        <a
                          key={f.id}
                          href={`/api/recruitment/files/${f.id}/download`}
                          className="block text-brand hover:underline"
                        >
                          {f.name}
                        </a>
                      ))
                    ) : (
                      <span className="text-muted">None yet</span>
                    )}
                  </Td>
                  <Td>
                    {a.active && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          busy={busy === `up-${a.id}`}
                          onClick={() => {
                            setTarget(a.id);
                            input.current?.click();
                          }}
                        >
                          Add CV
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          busy={busy === `w-${a.id}`}
                          onClick={() => withdraw(a.id)}
                        >
                          Withdraw
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}
    </div>
  );
}

/** Interviews the signed-in person sits on, with feedback still to give first. */
export function InterviewsPage() {
  const q = useQuery({
    queryKey: ['rc-interviews'],
    queryFn: () => api.get('/api/recruitment/interviews/mine'),
  });
  return (
    <div>
      <PageHeader title="My interviews" description="Interviews you are on the panel for." />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="You are not on any interview panels." />
          </div>
        ) : (
          <Table title="My interviews">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Candidate</Th>
                <Th>Position</Th>
                <Th>Where</Th>
                <Th>Your feedback</Th>
                <Th>
                  <span className="sr-only">Action</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {[...q.data.items]
                .sort((x, y) => Number(x.feedbackGiven) - Number(y.feedbackGiven))
                .map((i) => (
                  <tr key={i.id} data-date={i.scheduledAt.slice(0, 10)}>
                    <Td className="whitespace-nowrap">{whenText(i.scheduledAt)}</Td>
                    <Td className="font-semibold">{i.candidate.name}</Td>
                    <Td>
                      {i.vacancy.jobTitle}
                      <span className="block text-xs text-muted">{i.vacancy.reference}</span>
                    </Td>
                    <Td>{i.location ?? '—'}</Td>
                    <Td>
                      {i.feedbackGiven ? (
                        <Badge tone="ok">Given · {i.rating}/5</Badge>
                      ) : (
                        <Badge tone="pending">Due</Badge>
                      )}
                    </Td>
                    <Td>
                      <Link
                        to={`/recruitment/candidates/${i.candidate.id}`}
                        className={`btn btn-sm whitespace-nowrap ${i.feedbackGiven ? '' : 'btn-primary'}`}
                      >
                        {i.feedbackGiven ? 'View' : 'Give feedback'}
                      </Link>
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ))}
    </div>
  );
}
