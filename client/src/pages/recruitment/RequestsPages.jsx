import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  ButtonLink,
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
import { EMPLOYMENT_LABEL, EMPLOYMENT_TYPES, REQUEST_STATUS, useRc, useRcOptions } from './rc.js';

const REASON_LABEL = { NEW_POSITION: 'New Position', REPLACEMENT: 'Replacement' };

/** Hiring requests (D114): the viewer's own, or every one for HR and directors. */
export function HiringRequestsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const rc = useRc();
  const q = useQuery({
    queryKey: ['rc-requests', status],
    queryFn: () => api.get(`/api/recruitment/requests${status ? `?status=${status}` : ''}`),
  });
  return (
    <div>
      <PageHeader
        title="Hiring Requests"
        description={q.data?.all ? 'Every request for a new position.' : 'The positions you have asked for.'}
        actions={
          rc.data?.raise && (
            <ButtonLink to="/recruitment/requests/new" variant="primary">
              Request A Hire
            </ButtonLink>
          )
        }
      />
      <div className="mb-4 max-w-xs">
        <Field id="rq-status" label="Status">
          <Select
            id="rq-status"
            value={status}
            onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
          >
            <option value="">All</option>
            {Object.entries(REQUEST_STATUS).map(([k, [label]]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No hiring requests here." />
          </div>
        ) : (
          <Table title="Hiring Requests">
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Position</Th>
                <Th>Department</Th>
                <Th className="text-right">Positions</Th>
                <Th>Reason</Th>
                <Th>Requested By</Th>
                <Th>Status</Th>
                <Th>Requested</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => {
                const [label, tone] = REQUEST_STATUS[r.status];
                return (
                  <tr key={r.id} data-date={String(r.requestedAt).slice(0, 10)}>
                    <Td>
                      <Link
                        to={`/recruitment/requests/${r.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {r.reference}
                      </Link>
                    </Td>
                    <Td>{r.jobTitle}</Td>
                    <Td>
                      {r.department}
                      <span className="block text-xs text-muted">{r.company}</span>
                    </Td>
                    <Td className="text-right">{r.positions}</Td>
                    <Td>{REASON_LABEL[r.reason]}</Td>
                    <Td>{r.requestedBy.name}</Td>
                    <Td>
                      <Badge tone={tone}>{label}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(r.requestedAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ))}
    </div>
  );
}

/** Ask for a position: managers for their own department, or any with "Raise for any department". */
export function HiringRequestFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const rc = useRc();
  const opts = useRcOptions();
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (rc.isPending || opts.isPending) return <Loading />;
  if (opts.isError) return <LoadError error={opts.error} onRetry={opts.refetch} />;
  const o = opts.data;
  const raiseAny = rc.data?.raiseAny;
  const val = v ?? {
    companyId: String(o.mine.companyId ?? ''),
    departmentId: String(o.mine.departmentId ?? ''),
    branchId: '',
    jobTitle: '',
    positions: '1',
    employmentType: 'PERMANENT',
    reason: 'NEW_POSITION',
    replacingEmployeeId: '',
    justification: '',
    payGrade: '',
    targetStartDate: '',
  };
  const set = (k) => (e) => setV({ ...val, [k]: e.target.value });
  const departments = o.departments.filter((d) => String(d.companyId) === val.companyId);
  const branches = o.branches.filter((b) => String(b.companyId) === val.companyId);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/recruitment/requests', {
        ...val,
        branchId: val.branchId || null,
        replacingEmployeeId: val.replacingEmployeeId || null,
      });
      qc.invalidateQueries({ queryKey: ['rc-requests'] });
      navigate(`/recruitment/requests/${r.id}`, { state: { submitted: true } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!rc.data?.raise) {
    return <Notice tone="pending">Only managers can ask for a new position.</Notice>;
  }
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Request A Hire"
        description="Ask for a new or replacement position. HR checks it, then a director approves it, and HR opens the vacancy."
      />
      <form onSubmit={submit} className="card stack">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-row">
          <Field id="h-title" label="Position (Job Title)">
            <Input id="h-title" required value={val.jobTitle} onChange={set('jobTitle')} />
          </Field>
          <Field id="h-positions" label="How Many People">
            <Input
              id="h-positions"
              type="number"
              min={1}
              max={50}
              value={val.positions}
              onChange={set('positions')}
            />
          </Field>
        </div>
        <div className="form-row">
          <Field id="h-company" label="Company">
            <Select
              id="h-company"
              required
              disabled={!raiseAny}
              value={val.companyId}
              onChange={(e) => setV({ ...val, companyId: e.target.value, departmentId: '', branchId: '' })}
            >
              <option value="">Choose A Company</option>
              {o.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="h-dept" label="Department" hint={raiseAny ? undefined : 'Your own department.'}>
            <Select
              id="h-dept"
              required
              disabled={!raiseAny}
              value={val.departmentId}
              onChange={set('departmentId')}
            >
              <option value="">Choose A Department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="h-branch" label="Branch" optional>
            <Select id="h-branch" value={val.branchId} onChange={set('branchId')}>
              <option value="">Not Set</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="form-row">
          <Field id="h-type" label="Employment Type">
            <Select id="h-type" value={val.employmentType} onChange={set('employmentType')}>
              {EMPLOYMENT_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="h-reason" label="Reason">
            <Select id="h-reason" value={val.reason} onChange={set('reason')}>
              <option value="NEW_POSITION">New Position</option>
              <option value="REPLACEMENT">Replacing Someone Who Is Leaving</option>
            </Select>
          </Field>
          {val.reason === 'REPLACEMENT' && (
            <Field id="h-replacing" label="Replacing">
              <Select
                id="h-replacing"
                required
                value={val.replacingEmployeeId}
                onChange={set('replacingEmployeeId')}
              >
                <option value="">Choose The Employee</option>
                {o.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.jobTitle ? ` · ${e.jobTitle}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="form-row">
          <Field id="h-grade" label="Pay Grade" optional>
            <Input id="h-grade" value={val.payGrade} onChange={set('payGrade')} />
          </Field>
          <Field id="h-start" label="Wanted From" optional>
            <Input id="h-start" type="date" value={val.targetStartDate} onChange={set('targetStartDate')} />
          </Field>
        </div>
        <Field id="h-why" label="Why The Position Is Needed">
          <Textarea id="h-why" rows={4} required value={val.justification} onChange={set('justification')} />
        </Field>
        <div className="form-actions">
          <Button type="submit" busy={busy}>
            Send To HR
          </Button>
          <ButtonLink to="/recruitment/requests">Cancel</ButtonLink>
        </div>
      </form>
    </div>
  );
}

/** One hiring request: its details, where it stands, and the decision for whoever must make it. */
export function HiringRequestPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['rc-request', id],
    queryFn: () => api.get(`/api/recruitment/requests/${id}`),
  });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const r = q.data;
  const [label, tone] = REQUEST_STATUS[r.status];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['rc-request', id] });
    qc.invalidateQueries({ queryKey: ['rc-requests'] });
    qc.invalidateQueries({ queryKey: ['rc-me'] });
  };
  const act = async (path, action) => {
    if (action === 'REJECT' && !comment.trim()) {
      setError('Give a reason for turning it down.');
      return;
    }
    setBusy(action ?? path);
    setError(null);
    try {
      await api.post(
        `/api/recruitment/requests/${r.id}/${path}`,
        action ? { action, comment: comment.trim() || null } : {},
      );
      setComment('');
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const deciding = r.can.review || r.can.decide;
  return (
    <div>
      <PageHeader
        title={`${r.jobTitle} · ${r.reference}`}
        description={`${r.department}, ${r.company}`}
        actions={<Badge tone={tone}>{deciding ? 'Waiting For Your Decision' : label}</Badge>}
      />
      <div
        className={
          deciding || r.can.openVacancy
            ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]'
            : 'grid gap-4'
        }
      >
        {(deciding || r.can.openVacancy || r.can.cancel) && (
          <div className="grid gap-4 lg:sticky lg:top-4 lg:order-last">
            {deciding && (
              <Section
                title={r.can.review ? 'HR Check' : 'Director’s Decision'}
                className="border-brand ring-1 ring-brand"
              >
                <div className="space-y-3">
                  <p className="text-sm">
                    {r.can.review
                      ? 'Check the request, then send it to a director or turn it down.'
                      : 'HR has checked this request. Approve it or turn it down.'}
                  </p>
                  <Field id="h-comment" label="Comment" hint="Required to turn it down.">
                    <Textarea
                      id="h-comment"
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </Field>
                  {error && <Notice tone="danger">{error}</Notice>}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      busy={busy === 'FORWARD' || busy === 'APPROVE'}
                      disabled={!!busy}
                      onClick={() =>
                        act(r.can.review ? 'review' : 'decide', r.can.review ? 'FORWARD' : 'APPROVE')
                      }
                    >
                      {r.can.review ? 'Send To A Director' : 'Approve'}
                    </Button>
                    <Button
                      variant="danger"
                      busy={busy === 'REJECT'}
                      disabled={!!busy}
                      onClick={() => act(r.can.review ? 'review' : 'decide', 'REJECT')}
                    >
                      Turn Down
                    </Button>
                  </div>
                </div>
              </Section>
            )}
            {r.can.openVacancy && (
              <Section title="Open The Vacancy" className="border-brand ring-1 ring-brand">
                <p className="mb-3 text-sm">
                  This request is approved. Open the vacancy to start recording candidates.
                </p>
                <ButtonLink to={`/recruitment/vacancies/new?request=${r.id}`} variant="primary">
                  Open Vacancy
                </ButtonLink>
              </Section>
            )}
            {r.can.cancel && (
              <Section title="Cancel Request">
                <p className="mb-3 text-sm">Cancel it if the position is no longer needed.</p>
                {error && !deciding && <Notice tone="danger">{error}</Notice>}
                <Button variant="secondary" busy={busy === 'cancel'} onClick={() => act('cancel')}>
                  Cancel Request
                </Button>
              </Section>
            )}
          </div>
        )}
        <div className="grid min-w-0 gap-4">
          <Section title="Approval">
            <ol className="grid gap-3 sm:grid-cols-2">
              <Step
                title="HR Check"
                done={r.review}
                outcome={
                  r.review &&
                  (r.status === 'REJECTED' && !r.decision
                    ? ['Turned Down', 'danger']
                    : ['Sent To A Director', 'ok'])
                }
                waiting={r.status === 'PENDING_REVIEW'}
              />
              <Step
                title="Director"
                done={r.decision}
                outcome={
                  r.decision && (r.status === 'APPROVED' ? ['Approved', 'ok'] : ['Not Approved', 'danger'])
                }
                waiting={r.status === 'PENDING_APPROVAL'}
              />
            </ol>
            {r.vacancy && (
              <p className="mt-3 text-sm">
                Vacancy:{' '}
                <Link
                  to={`/recruitment/vacancies/${r.vacancy.id}`}
                  className="font-medium text-brand hover:underline"
                >
                  {r.vacancy.reference}
                </Link>
              </p>
            )}
          </Section>
          <Section title="Request">
            <Details
              items={[
                ['Position', r.jobTitle],
                ['How Many', String(r.positions)],
                ['Company', r.company],
                ['Department', r.department],
                ['Branch', r.branch],
                ['Employment Type', EMPLOYMENT_LABEL[r.employmentType]],
                ['Reason', REASON_LABEL[r.reason] + (r.replacing ? `: ${r.replacing}` : '')],
                ['Pay Grade', r.payGrade],
                ['Wanted From', r.targetStartDate && formatDate(r.targetStartDate)],
                [
                  'Why',
                  <span key="why" className="whitespace-pre-line">
                    {r.justification}
                  </span>,
                ],
                ['Requested By', `${r.requestedBy.name} · ${formatDateTime(r.requestedAt)}`],
              ]}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Step({ title, done, outcome, waiting }) {
  return (
    <li className="rounded-md border border-rule p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        {done ? (
          <Badge tone={outcome[1]}>{outcome[0]}</Badge>
        ) : waiting ? (
          <Badge tone="pending">Waiting For A Decision</Badge>
        ) : (
          <Badge tone="neutral">Not Yet</Badge>
        )}
      </div>
      {done && (
        <>
          <p className="mt-1 text-muted">
            {done.by} · {formatDateTime(done.at)}
          </p>
          {done.comment && <p className="mt-2 whitespace-pre-line">“{done.comment}”</p>}
        </>
      )}
    </li>
  );
}
