import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { useMe } from '../../lib/auth.jsx';
import {
  Badge,
  Button,
  ButtonLink,
  ConfirmDialog,
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
} from '../../components/ui.jsx';
import { BarList } from '../../components/charts.jsx';
import { errorText } from '../requisitions/rq.js';
import { NEXT_PHASE, PHASE, STATUS, nextText } from './pf.js';

const PHASE_ACTION = {
  GOAL_SETTING: [
    'Start goal setting',
    'Every active employee in scope gets an appraisal and is asked, in the system and by email, to set their goals.',
  ],
  MID_YEAR: ['Start the mid-year review', 'Everyone is asked to record their progress on each goal.'],
  YEAR_END: [
    'Start the year-end appraisal',
    'Everyone is asked to rate themselves; then managers rate them.',
  ],
  CLOSED: ['Close the cycle', 'Appraisals can no longer be changed. Do this once they are signed off.'],
};

/** Review cycles (D115): one a year, moved on step by step by HR. */
export function CyclesPage() {
  const q = useQuery({ queryKey: ['pf-cycles'], queryFn: () => api.get('/api/performance/cycles') });
  return (
    <div>
      <PageHeader
        title="Review cycles"
        actions={
          q.data?.canManage && (
            <ButtonLink to="/performance/cycles/new" variant="primary">
              New review cycle
            </ButtonLink>
          )
        }
      />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No review cycles yet." />
          </div>
        ) : (
          <Table title="Review cycles">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Year</Th>
                <Th>Company</Th>
                <Th>Step</Th>
                <Th className="text-right">Appraisals</Th>
                <Th className="text-right">Signed off</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((c) => (
                <tr key={c.id} data-date={String(c.createdAt).slice(0, 10)}>
                  <Td className="font-semibold">
                    <Link to={`/performance/cycles/${c.id}`} className="text-brand hover:underline">
                      {c.name}
                    </Link>
                  </Td>
                  <Td>{c.year}</Td>
                  <Td>{c.company ?? 'All companies'}</Td>
                  <Td>
                    <Badge tone={PHASE[c.status][1]}>{PHASE[c.status][0]}</Badge>
                  </Td>
                  <Td className="text-right">{c.progress?.total ?? 0}</Td>
                  <Td className="text-right">{c.progress?.SIGNED_OFF ?? 0}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}
    </div>
  );
}

export function CycleFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const companies = useQuery({
    queryKey: ['rc-options'],
    queryFn: () => api.get('/api/recruitment/options'),
  });
  const year = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0);
  const [v, setV] = useState({
    name: `Performance year ${year}`,
    year: String(year),
    companyId: '',
    goalsDue: `${year}-02-28`,
    midYearDue: `${year}-07-31`,
    yearEndDue: `${year}-12-15`,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/performance/cycles', { ...v, companyId: v.companyId || null });
      qc.invalidateQueries({ queryKey: ['pf-cycles'] });
      navigate(`/performance/cycles/${r.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New review cycle"
        description="Nothing is sent until you start goal setting on the next page."
      />
      <form onSubmit={save} className="card stack">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-row">
          <Field id="cy-name" label="Name">
            <Input id="cy-name" required value={v.name} onChange={set('name')} />
          </Field>
          <Field id="cy-year" label="Year">
            <Input
              id="cy-year"
              type="number"
              min={2020}
              max={2100}
              required
              value={v.year}
              onChange={set('year')}
            />
          </Field>
          <Field id="cy-co" label="Who it covers">
            <Select id="cy-co" value={v.companyId} onChange={set('companyId')}>
              <option value="">Every company in the group</option>
              {(companies.data?.companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="form-row">
          <Field id="cy-g" label="Goals due" optional>
            <Input id="cy-g" type="date" value={v.goalsDue} onChange={set('goalsDue')} />
          </Field>
          <Field id="cy-m" label="Mid-year review due" optional>
            <Input id="cy-m" type="date" value={v.midYearDue} onChange={set('midYearDue')} />
          </Field>
          <Field id="cy-y" label="Year-end appraisal due" optional>
            <Input id="cy-y" type="date" value={v.yearEndDue} onChange={set('yearEndDue')} />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="submit" busy={busy}>
            Create review cycle
          </Button>
          <ButtonLink to="/performance/cycles">Cancel</ButtonLink>
        </div>
      </form>
    </div>
  );
}

export function CyclePage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pf-cycle', id], queryFn: () => api.get(`/api/performance/cycles/${id}`) });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [status, setStatus] = useState('');
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const c = q.data;
  const next = NEXT_PHASE[c.status];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pf-cycle', id] });
    qc.invalidateQueries({ queryKey: ['pf-cycles'] });
    qc.invalidateQueries({ queryKey: ['pf-summary'] });
  };
  const move = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post(`/api/performance/cycles/${c.id}/phase`, { to: next });
      setMsg({ tone: 'ok', text: `${PHASE[r.status][0]}: ${r.appraisals} people have been told.` });
      refresh();
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const addMissing = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post(`/api/performance/cycles/${c.id}/add-missing`);
      setMsg({
        tone: 'ok',
        text: r.added
          ? `${r.added} people added and asked to set their goals.`
          : 'Everyone is already in this cycle.',
      });
      refresh();
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  const shown = c.items.filter((a) => !status || a.status === status);
  return (
    <div>
      <PageHeader
        title={c.name}
        description={`${c.company ?? 'Every company in the group'} · Goals due ${c.goalsDue ? formatDate(c.goalsDue) : '—'} · Mid-year ${c.midYearDue ? formatDate(c.midYearDue) : '—'} · Year end ${c.yearEndDue ? formatDate(c.yearEndDue) : '—'}`}
        actions={
          <>
            <Badge tone={PHASE[c.status][1]}>{PHASE[c.status][0]}</Badge>
            {c.canManage && !['DRAFT', 'CLOSED'].includes(c.status) && (
              <Button variant="secondary" busy={busy && !confirm} onClick={addMissing}>
                Add new staff
              </Button>
            )}
            {c.canManage && next && <Button onClick={() => setConfirm(true)}>{PHASE_ACTION[next][0]}</Button>}
          </>
        }
      />
      <div className="stack">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {c.items.length > 0 && (
          <Section title="Where everyone is">
            <BarList
              items={Object.entries(STATUS).map(([k, [label]]) => ({
                key: k,
                label,
                value: c.progress?.[k] ?? 0,
              }))}
              format={(x) => String(x)}
            />
          </Section>
        )}
        {c.items.length > 0 && (
          <div>
            <div className="mb-3 w-64">
              <Field id="cy-status" label="Status">
                <Select id="cy-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  {Object.entries(STATUS).map(([k, [l]]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Table title={c.name}>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Department</Th>
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
                {shown.map((a) => (
                  <tr key={a.id}>
                    <Td className="font-semibold">{a.employee.name}</Td>
                    <Td>{a.employee.department ?? '—'}</Td>
                    <Td>{a.manager?.name ?? <span className="text-muted">HR</span>}</Td>
                    <Td>
                      <Badge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge>
                    </Td>
                    <Td>{nextText(a, me?.id)?.text ?? '—'}</Td>
                    <Td className="text-right">{a.overallScore ?? '—'}</Td>
                    <Td>
                      <Link to={`/performance/appraisals/${a.id}`} className="btn btn-sm">
                        View
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {c.items.length === 0 && (
          <div className="card p-0">
            <EmptyState title="Not started yet.">
              Start goal setting to give everyone an appraisal.
            </EmptyState>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title={next ? PHASE_ACTION[next][0] : ''}
        confirmLabel={next ? PHASE_ACTION[next][0] : ''}
        busy={busy}
        onConfirm={move}
        onCancel={() => setConfirm(false)}
      >
        {next && PHASE_ACTION[next][1]}
      </ConfirmDialog>
    </div>
  );
}
