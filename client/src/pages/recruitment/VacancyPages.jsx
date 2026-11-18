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
  Tabs,
  Td,
  Textarea,
  Th,
} from '../../components/ui.jsx';
import { errorText } from '../requisitions/rq.js';
import {
  ACTIVE_STAGES,
  EMPLOYMENT_LABEL,
  EMPLOYMENT_TYPES,
  SOURCES,
  SOURCE_LABEL,
  STAGES,
  STAGE_LABEL,
  STAGE_TONE,
  VACANCY_STATUS,
  useRcOptions,
} from './rc.js';

/** Vacancies (D114): every one for HR, or the ones the viewer is hiring for. */
export function VacanciesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = useQuery({
    queryKey: ['rc-vacancies', status],
    queryFn: () => api.get(`/api/recruitment/vacancies${status ? `?status=${status}` : ''}`),
  });
  return (
    <div>
      <PageHeader
        title="Vacancies"
        actions={
          q.data?.canManage && (
            <ButtonLink to="/recruitment/vacancies/new" variant="primary">
              Open vacancy
            </ButtonLink>
          )
        }
      />
      <div className="mb-4 max-w-xs">
        <Field id="v-status" label="Status">
          <Select
            id="v-status"
            value={status}
            onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
          >
            <option value="">All</option>
            {Object.entries(VACANCY_STATUS).map(([k, [l]]) => (
              <option key={k} value={k}>
                {l}
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
            <EmptyState title="No vacancies here.">
              {q.data.canManage && 'Open one from an approved hiring request.'}
            </EmptyState>
          </div>
        ) : (
          <Table title="Vacancies">
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Position</Th>
                <Th>Department</Th>
                <Th className="text-right">Positions</Th>
                <Th className="text-right">Candidates</Th>
                <Th className="text-right">In progress</Th>
                <Th>Closing date</Th>
                <Th>Hiring manager</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((v) => {
                const [label, tone] = VACANCY_STATUS[v.status];
                return (
                  <tr key={v.id} data-date={String(v.createdAt).slice(0, 10)}>
                    <Td>
                      <Link
                        to={`/recruitment/vacancies/${v.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {v.reference}
                      </Link>
                    </Td>
                    <Td>
                      {v.jobTitle}
                      {v.isInternal && <span className="block text-xs text-muted">Shown to staff</span>}
                    </Td>
                    <Td>
                      {v.department}
                      <span className="block text-xs text-muted">{v.company}</span>
                    </Td>
                    <Td className="text-right">{v.positions}</Td>
                    <Td className="text-right">{v.candidates.total}</Td>
                    <Td className="text-right">{v.candidates.active}</Td>
                    <Td className="whitespace-nowrap">{v.closingDate ? formatDate(v.closingDate) : '—'}</Td>
                    <Td>{v.hiringManager?.name ?? '—'}</Td>
                    <Td>
                      <Badge tone={tone}>{label}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ))}
    </div>
  );
}

/** Open a vacancy (from an approved hiring request when ?request= is given) or change one. */
export function VacancyFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const opts = useRcOptions();
  const existing = useQuery({
    queryKey: ['rc-vacancy', id],
    queryFn: () => api.get(`/api/recruitment/vacancies/${id}`),
    enabled: Boolean(id),
  });
  const request = useQuery({
    queryKey: ['rc-request', requestId],
    queryFn: () => api.get(`/api/recruitment/requests/${requestId}`),
    enabled: Boolean(requestId),
  });
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (opts.isPending || (id && existing.isPending) || (requestId && request.isPending)) return <Loading />;
  const failed = opts.error ?? existing.error ?? request.error;
  if (failed) return <LoadError error={failed} />;
  const o = opts.data;
  const e = existing.data;
  const r = request.data;
  const val = v ?? {
    jobTitle: e?.jobTitle ?? r?.jobTitle ?? '',
    companyId: String(e?.companyId ?? r?.companyId ?? ''),
    departmentId: String(e?.departmentId ?? r?.departmentId ?? ''),
    branchId: String(e?.branchId ?? r?.branchId ?? ''),
    employmentType: e?.employmentType ?? r?.employmentType ?? 'PERMANENT',
    positions: String(e?.positions ?? r?.positions ?? 1),
    description: e?.description ?? '',
    requirements: e?.requirements ?? '',
    closingDate: e?.closingDate ?? '',
    isInternal: e?.isInternal ?? true,
    hiringManagerId: String(e?.hiringManager?.id ?? r?.requestedBy.id ?? ''),
    status: e?.status ?? 'OPEN',
  };
  const set = (k) => (ev) => setV({ ...val, [k]: ev.target.value });
  const departments = o.departments.filter((d) => String(d.companyId) === val.companyId);
  const branches = o.branches.filter((b) => String(b.companyId) === val.companyId);
  const save = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      ...val,
      hiringRequestId: requestId ? Number(requestId) : null,
      branchId: val.branchId || null,
      hiringManagerId: val.hiringManagerId || null,
      status: id ? val.status : undefined,
    };
    try {
      const out = id
        ? await api.put(`/api/recruitment/vacancies/${id}`, body)
        : await api.post('/api/recruitment/vacancies', body);
      qc.invalidateQueries({ queryKey: ['rc-vacancies'] });
      qc.invalidateQueries({ queryKey: ['rc-vacancy', String(out.id)] });
      qc.invalidateQueries({ queryKey: ['rc-request'] });
      navigate(`/recruitment/vacancies/${out.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={id ? `Change ${e.reference}` : 'Open vacancy'}
        description={r ? `From hiring request ${r.reference}, approved.` : undefined}
      />
      <form onSubmit={save} className="card stack">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-row">
          <Field id="v-title" label="Position (job title)">
            <Input id="v-title" required value={val.jobTitle} onChange={set('jobTitle')} />
          </Field>
          <Field id="v-positions" label="How many people">
            <Input
              id="v-positions"
              type="number"
              min={1}
              max={50}
              value={val.positions}
              onChange={set('positions')}
            />
          </Field>
        </div>
        <div className="form-row">
          <Field id="v-company" label="Company">
            <Select
              id="v-company"
              required
              value={val.companyId}
              onChange={(ev) => setV({ ...val, companyId: ev.target.value, departmentId: '', branchId: '' })}
            >
              <option value="">Choose a company</option>
              {o.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="v-dept" label="Department">
            <Select id="v-dept" required value={val.departmentId} onChange={set('departmentId')}>
              <option value="">Choose a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="v-branch" label="Branch" optional>
            <Select id="v-branch" value={val.branchId} onChange={set('branchId')}>
              <option value="">Not set</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="form-row">
          <Field id="v-type" label="Employment type">
            <Select id="v-type" value={val.employmentType} onChange={set('employmentType')}>
              {EMPLOYMENT_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="v-close" label="Closing date" optional>
            <Input id="v-close" type="date" value={val.closingDate ?? ''} onChange={set('closingDate')} />
          </Field>
          <Field
            id="v-manager"
            label="Hiring manager"
            hint="Sees the candidates and gives interview feedback."
            optional
          >
            <Select id="v-manager" value={val.hiringManagerId} onChange={set('hiringManagerId')}>
              <option value="">None</option>
              {o.employees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.department ? ` · ${p.department}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="v-desc" label="About the role" optional>
          <Textarea id="v-desc" rows={5} value={val.description ?? ''} onChange={set('description')} />
        </Field>
        <Field id="v-req" label="Requirements" optional>
          <Textarea id="v-req" rows={4} value={val.requirements ?? ''} onChange={set('requirements')} />
        </Field>
        <div className="form-row">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand"
              checked={val.isInternal}
              onChange={(ev) => setV({ ...val, isInternal: ev.target.checked })}
            />
            Show it to staff under Open positions, so they can apply
          </label>
          {id && (
            <Field id="v-st" label="Status">
              <Select id="v-st" value={val.status} onChange={set('status')}>
                {Object.entries(VACANCY_STATUS).map(([k, [l]]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="form-actions">
          <Button type="submit" busy={busy}>
            {id ? 'Save changes' : 'Open vacancy'}
          </Button>
          <ButtonLink to={id ? `/recruitment/vacancies/${id}` : '/recruitment/vacancies'}>Cancel</ButtonLink>
        </div>
      </form>
    </div>
  );
}

/** One vacancy: its details and its candidates, by stage. HR adds candidates here. */
export function VacancyPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['rc-vacancy', id],
    queryFn: () => api.get(`/api/recruitment/vacancies/${id}`),
  });
  const [tab, setTab] = useState('active');
  const [adding, setAdding] = useState(false);
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const v = q.data;
  const [label, tone] = VACANCY_STATUS[v.status];
  const open = !['CLOSED', 'FILLED'].includes(v.status);
  const count = (stages) => v.items.filter((c) => stages.includes(c.stage)).length;
  const tabs = [
    { id: 'active', label: 'In progress', count: count(ACTIVE_STAGES) },
    ...STAGES.map(([k, l]) => ({ id: k, label: l, count: count([k]) })).filter((t) => t.count > 0),
    { id: 'all', label: 'All', count: v.items.length },
  ];
  const shown = v.items.filter((c) =>
    tab === 'all' ? true : tab === 'active' ? ACTIVE_STAGES.includes(c.stage) : c.stage === tab,
  );
  return (
    <div>
      <PageHeader
        title={`${v.jobTitle} · ${v.reference}`}
        description={`${v.department}, ${v.company}`}
        actions={
          <>
            <Badge tone={tone}>{label}</Badge>
            {v.canManage && <ButtonLink to={`/recruitment/vacancies/${v.id}/edit`}>Change</ButtonLink>}
            {v.canManage && open && !adding && <Button onClick={() => setAdding(true)}>Add candidate</Button>}
          </>
        }
      />
      <div className="stack">
        {adding && (
          <CandidateForm
            vacancyId={v.id}
            onDone={() => {
              setAdding(false);
              qc.invalidateQueries({ queryKey: ['rc-vacancy', id] });
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        <div>
          <Tabs
            label="Candidates by stage"
            tabs={tabs}
            active={tabs.some((t) => t.id === tab) ? tab : 'active'}
            onChange={setTab}
          />
          {shown.length === 0 ? (
            <div className="card p-0">
              <EmptyState title="No candidates here yet." />
            </div>
          ) : (
            <Table title={`Candidates ${v.reference}`}>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Source</Th>
                  <Th>Stage</Th>
                  <Th className="text-right">Files</Th>
                  <Th>Applied</Th>
                  <Th>
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} data-date={String(c.appliedAt).slice(0, 10)}>
                    <Td className="font-semibold">
                      <Link to={`/recruitment/candidates/${c.id}`} className="text-brand hover:underline">
                        {c.name}
                      </Link>
                    </Td>
                    <Td>{c.email ?? '—'}</Td>
                    <Td>{c.phone ?? '—'}</Td>
                    <Td>{SOURCE_LABEL[c.source]}</Td>
                    <Td>
                      <Badge tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}</Badge>
                    </Td>
                    <Td className="text-right">{c.files}</Td>
                    <Td className="whitespace-nowrap">{formatDateTime(c.appliedAt)}</Td>
                    <Td>
                      <ButtonLink
                        to={`/recruitment/candidates/${c.id}`}
                        size="sm"
                        variant={v.canManage ? 'primary' : 'secondary'}
                      >
                        Open
                      </ButtonLink>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <Section title="Vacancy">
          <Details
            items={[
              ['Position', v.jobTitle],
              ['How many', String(v.positions)],
              ['Company', v.company],
              ['Department', v.department],
              ['Branch', v.branch],
              ['Employment type', EMPLOYMENT_LABEL[v.employmentType]],
              ['Closing date', v.closingDate && formatDate(v.closingDate)],
              ['Hiring manager', v.hiringManager?.name],
              ['Shown to staff', v.isInternal ? 'Yes, under Open positions' : 'No'],
              [
                'Hiring request',
                v.hiringRequest && (
                  <Link
                    key="hr"
                    to={`/recruitment/requests/${v.hiringRequest.id}`}
                    className="text-brand hover:underline"
                  >
                    {v.hiringRequest.reference}
                  </Link>
                ),
              ],
              [
                'About the role',
                v.description && (
                  <span key="d" className="whitespace-pre-line">
                    {v.description}
                  </span>
                ),
              ],
              [
                'Requirements',
                v.requirements && (
                  <span key="r" className="whitespace-pre-line">
                    {v.requirements}
                  </span>
                ),
              ],
            ]}
          />
        </Section>
      </div>
    </div>
  );
}

export function CandidateForm({ vacancyId, candidate, onDone, onCancel }) {
  const [v, setV] = useState({
    firstName: candidate?.firstName ?? '',
    lastName: candidate?.lastName ?? '',
    email: candidate?.email ?? '',
    phone: candidate?.phone ?? '',
    source: candidate && candidate.source !== 'INTERNAL' ? candidate.source : 'EMAIL',
    notes: candidate?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (candidate) await api.put(`/api/recruitment/candidates/${candidate.id}`, v);
      else await api.post(`/api/recruitment/vacancies/${vacancyId}/candidates`, v);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={candidate ? 'Change details' : 'Add candidate'}>
      <form onSubmit={save} className="stack">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-row">
          <Field id="c-first" label="First name">
            <Input id="c-first" required value={v.firstName} onChange={set('firstName')} />
          </Field>
          <Field id="c-last" label="Last name">
            <Input id="c-last" required value={v.lastName} onChange={set('lastName')} />
          </Field>
        </div>
        <div className="form-row">
          <Field id="c-email" label="Email" optional>
            <Input id="c-email" type="email" value={v.email ?? ''} onChange={set('email')} />
          </Field>
          <Field id="c-phone" label="Phone" optional>
            <Input id="c-phone" value={v.phone ?? ''} onChange={set('phone')} />
          </Field>
          {candidate?.source !== 'INTERNAL' && (
            <Field id="c-source" label="Where they came from">
              <Select id="c-source" value={v.source} onChange={set('source')}>
                {SOURCES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field
          id="c-notes"
          label="Notes"
          optional
          hint="Seen by HR and the hiring manager, never by the candidate."
        >
          <Textarea id="c-notes" rows={3} value={v.notes ?? ''} onChange={set('notes')} />
        </Field>
        {!candidate && <p className="text-sm text-muted">Add their CV on the candidate’s page once saved.</p>}
        <div className="form-actions">
          <Button type="submit" busy={busy}>
            {candidate ? 'Save changes' : 'Add candidate'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}
