import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFile } from '../../../lib/api.js';
import { formatDate, formatDateTime } from '../../../lib/format.js';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Kpi,
  KpiRow,
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
} from '../../../components/ui.jsx';
import { errorText } from '../rq.js';
import { ACCOUNT, DAYS, money, timeOf, useFloat } from './fl.js';

// ── Daily reports (D118) ───────────────────────────────────────────────────────────────────────
/** "Mon–Sat, 07:30–18:00" */
export function hoursText(h) {
  if (!h) return '—';
  const order = DAYS.map(([k]) => k);
  const idx = h.workingDays.map((d) => order.indexOf(d)).sort((a, b) => a - b);
  const short = (i) => DAYS[i][1].slice(0, 3);
  const run = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  const days =
    idx.length === 7
      ? 'Every day'
      : run
        ? `${short(idx[0])}–${short(idx.at(-1))}`
        : idx.map(short).join(', ');
  return `${days}, ${h.opensAt}–${h.closesAt}`;
}

const today = () => new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10); // Lusaka

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
/** The dates a filter covers: a day, a week of a month (1–7, 8–14, …), or a month. */
function rangeOf(f) {
  if (f.period === 'DAY') return [f.day, f.day];
  const last = lastDay(f.month);
  if (f.period === 'MONTH') return [`${f.month}-01`, `${f.month}-${pad(last)}`];
  const start = (Number(f.week) - 1) * 7 + 1;
  return [`${f.month}-${pad(start)}`, `${f.month}-${pad(Math.min(start + 6, last))}`];
}
const dash = (n, fmt = (x) => x) => (n ? fmt(n) : '—');

export function FloatDailyPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const me = useFloat();
  const branches = useQuery({
    queryKey: ['float-branches'],
    queryFn: () => api.get('/api/float/branches'),
    enabled: Boolean(me.data?.rights.viewAll || me.data?.rights.admin),
  });
  const t0 = today();
  const [f, setF] = useState({
    period: params.get('from') && params.get('from') !== params.get('to') ? 'MONTH' : 'DAY',
    day: params.get('from') ?? t0,
    month: (params.get('from') ?? t0).slice(0, 7),
    week: String(Math.min(5, Math.ceil(Number(t0.slice(8, 10)) / 7))),
    branch: params.get('branch') ?? '',
    q: '',
  });
  const [from, to] = rangeOf(f);
  const qs = `from=${from}&to=${to}${f.branch ? `&branch=${f.branch}` : ''}${f.q.trim() ? `&q=${encodeURIComponent(f.q.trim())}` : ''}`;
  const q = useQuery({ queryKey: ['float-daily', qs], queryFn: () => api.get(`/api/float/daily?${qs}`) });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const sign = async (date) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/float/daily/${date}/sign-off`, { comment: comment.trim() || null });
      setComment('');
      qc.invalidateQueries({ queryKey: ['float-daily'] });
      qc.invalidateQueries({ queryKey: ['float-me'] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  const t = d?.totals;
  const weeks = Math.ceil(lastDay(f.month) / 7);
  return (
    <div>
      <PageHeader
        title="AMS daily reports"
        description="Each branch's day, from opening to closing. Sent automatically when a store closes."
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              downloadFile(`/api/float/daily?${qs}&format=xlsx`).catch((e) => setError(e.message))
            }
          >
            Export to Excel
          </Button>
        }
      />
      <div className="mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_8rem_minmax(0,1fr)_minmax(0,1.4fr)]">
        <Field id="dr-period" label="Show">
          <Select id="dr-period" value={f.period} onChange={set('period')}>
            <option value="DAY">A day</option>
            <option value="WEEK">A week of the month</option>
            <option value="MONTH">A month</option>
          </Select>
        </Field>
        {f.period === 'DAY' ? (
          <Field id="dr-day" label="Day">
            <Input id="dr-day" type="date" max={t0} value={f.day} onChange={set('day')} />
          </Field>
        ) : (
          <Field id="dr-month" label="Month">
            <Input id="dr-month" type="month" max={t0.slice(0, 7)} value={f.month} onChange={set('month')} />
          </Field>
        )}
        {f.period === 'WEEK' ? (
          <Field id="dr-week" label="Week">
            <Select id="dr-week" value={f.week} onChange={set('week')}>
              {Array.from({ length: weeks }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Week {i + 1}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="hidden lg:block" />
        )}
        {me.data?.rights.viewAll || me.data?.rights.admin ? (
          <Field id="dr-branch" label="Branch">
            <Select id="dr-branch" value={f.branch} onChange={set('branch')}>
              <option value="">All branches</option>
              {(branches.data?.items ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="hidden lg:block" />
        )}
        <Field id="dr-q" label="Search">
          <Input id="dr-q" placeholder="Branch or staff name" value={f.q} onChange={set('q')} />
        </Field>
      </div>
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {d && (
        <div className="stack">
          {d.unsigned.length > 0 && (
            <Notice tone="pending" title="Days not yet reconciled and signed off">
              {d.unsigned.map((x) => (
                <button
                  key={x}
                  type="button"
                  className="mr-3 font-medium underline"
                  onClick={() => setF({ ...f, period: 'DAY', day: x })}
                >
                  {formatDate(x)}
                </button>
              ))}
            </Notice>
          )}
          {f.period === 'DAY' && d.canSignOff && !d.signed[f.day] && d.rows.length > 0 && (
            <Section
              title={`Reconcile and sign off ${formatDate(f.day)}`}
              className="border-brand ring-1 ring-brand"
            >
              <div className="space-y-3">
                <p className="text-sm">
                  Check each branch's closing cash and float below. Signing off tells the managers and
                  directors and locks the day.
                </p>
                <Field id="dy-c" label="Note" optional>
                  <Textarea id="dy-c" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
                <Button busy={busy} onClick={() => sign(f.day)}>
                  Sign off {formatDate(f.day)}
                </Button>
              </div>
            </Section>
          )}
          {f.period === 'DAY' && d.signed[f.day] && (
            <Notice tone="ok" title={`Signed off by ${d.signed[f.day].by}`}>
              {formatDateTime(d.signed[f.day].at)}
              {d.signed[f.day].comment ? `: “${d.signed[f.day].comment}”` : ''}
            </Notice>
          )}
          <KpiRow cols={4}>
            <Kpi label="Number of deposits" value={dash(t.deposits.count)} small />
            <Kpi label="Deposits" value={dash(t.deposits.amount, money)} small />
            <Kpi label="Number of withdrawals" value={dash(t.withdrawals.count)} small />
            <Kpi label="Withdrawals" value={dash(t.withdrawals.amount, money)} small />
          </KpiRow>
          <KpiRow cols={4}>
            <Kpi label="Closing cash" value={dash(t.cash, money)} small />
            <Kpi label="Closing Airtel Money float" value={dash(t.airtel, money)} small />
            <Kpi label="Closing MTN MoMo float" value={dash(t.mtn, money)} small />
            <Kpi
              label="Daily commission"
              value={dash(t.commission, money)}
              note={t.deficit ? `Deficits ${money(t.deficit)}` : undefined}
              tone={t.deficit ? 'bad' : undefined}
              small
            />
          </KpiRow>
          {d.rows.length === 0 ? (
            <div className="card p-0">
              <EmptyState title="No reports for this period." />
            </div>
          ) : (
            <Table title={`AMS daily ${from} to ${to}`} tools={false}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Branch</Th>
                  <Th>Opened</Th>
                  <Th>Closed</Th>
                  <Th className="text-right">No. of deposits</Th>
                  <Th className="text-right">Deposits</Th>
                  <Th className="text-right">No. of withdrawals</Th>
                  <Th className="text-right">Withdrawals</Th>
                  <Th className="text-right">Opening cash</Th>
                  <Th className="text-right">Opening float</Th>
                  <Th className="text-right">Closing cash</Th>
                  <Th className="text-right">Closing float</Th>
                  <Th className="text-right">Float transfers</Th>
                  <Th className="text-right">Cash to finance</Th>
                  <Th className="text-right">Daytime</Th>
                  <Th className="text-right">Evening</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Turned down</Th>
                  <Th className="text-right">Commission</Th>
                  <Th className="text-right">Deficit</Th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={`${r.date}-${r.id}`}>
                    <Td className="whitespace-nowrap">{formatDate(r.date)}</Td>
                    <Td className="font-semibold">{r.name}</Td>
                    <Td className="whitespace-nowrap">
                      {r.openedAt ? timeOf(r.openedAt) : '—'}
                      {r.openedBy && (
                        <span className="block text-xs text-muted">
                          {r.openedBy.firstName} {r.openedBy.lastName}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {r.signedOut ? (
                        timeOf(r.signedOutAt)
                      ) : r.closePending ? (
                        <Badge tone="pending">To confirm</Badge>
                      ) : r.tradingDay ? (
                        <Badge tone="pending">Open</Badge>
                      ) : (
                        '—'
                      )}
                      {r.signedOutBy && (
                        <span className="block text-xs text-muted">
                          {r.signedOutBy.firstName} {r.signedOutBy.lastName}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">{dash(r.deposits.count)}</Td>
                    <Td className="text-right tabular-nums">{dash(r.deposits.amount, money)}</Td>
                    <Td className="text-right">{dash(r.withdrawals.count)}</Td>
                    <Td className="text-right tabular-nums">{dash(r.withdrawals.amount, money)}</Td>
                    <Td className="text-right tabular-nums">{dash(r.openingCash, money)}</Td>
                    <Td className="text-right tabular-nums">{dash(r.openingFloat, money)}</Td>
                    <Td className="text-right tabular-nums">{dash(r.cash, money)}</Td>
                    <Td className="text-right tabular-nums">{dash(r.float, money)}</Td>
                    <Td className="text-right tabular-nums">
                      {r.floatTransfers.count
                        ? `${r.floatTransfers.count} · ${money(r.floatTransfers.amount)}`
                        : '—'}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {r.cashCollections.count
                        ? `${r.cashCollections.count} · ${money(r.cashCollections.amount)}`
                        : '—'}
                    </Td>
                    <Td className="text-right">{dash(r.transactions.daytime)}</Td>
                    <Td className="text-right">{dash(r.transactions.evening)}</Td>
                    <Td className="text-right font-semibold">{dash(r.transactions.total)}</Td>
                    <Td className="text-right">{dash(r.turnedDown)}</Td>
                    <Td className="text-right tabular-nums">
                      {r.commission == null ? '—' : dash(r.commission, money)}
                    </Td>
                    <Td className={`text-right tabular-nums ${r.deficit ? 'font-semibold text-danger' : ''}`}>
                      {dash(r.deficit, money)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

// ── AMS branches (the System Admin adds them) ──────────────────────────────────────────────────
const emptyBranch = {
  name: '',
  location: '',
  isActive: true,
  openings: { CASH: '', AIRTEL: '', MTN: '' },
  minimums: { CASH: '', AIRTEL: '', MTN: '' },
};
export function FloatBranchesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['float-branches'], queryFn: () => api.get('/api/float/branches') });
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <div>
      <PageHeader
        title="AMS branches"
        description="Each AMS branch has a Cash, an Airtel Money and an MTN MoMo account. Staff record at the branch on their employee record."
        actions={
          d.canEdit &&
          d.configured &&
          editing !== 'new' && <Button onClick={() => setEditing('new')}>Add branch</Button>
        }
      />
      <div className="stack">
        {!d.configured && (
          <Notice tone="pending">
            Choose the AMS company in{' '}
            <Link to="/requisitions/float/settings" className="underline">
              AMS settings
            </Link>{' '}
            first.
          </Notice>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {editing && (
          <BranchForm
            branch={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={(text) => {
              setEditing(null);
              setMsg({ tone: 'ok', text });
              qc.invalidateQueries({ queryKey: ['float-branches'] });
              qc.invalidateQueries({ queryKey: ['float-dashboard'] });
            }}
          />
        )}
        {d.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No AMS branches yet." />
          </div>
        ) : (
          <Table title="AMS branches">
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th>Location</Th>
                <Th>Days and hours</Th>
                <Th className="text-right">Cash</Th>
                <Th className="text-right">Airtel Money</Th>
                <Th className="text-right">MTN MoMo</Th>
                <Th>Staff</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Action</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((b) => (
                <tr key={b.id}>
                  <Td className="font-semibold">
                    <Link to={`/requisitions/float/branches/${b.id}`} className="text-brand hover:underline">
                      {b.name}
                    </Link>
                  </Td>
                  <Td>{b.location ?? '—'}</Td>
                  <Td>{hoursText(b.hours)}</Td>
                  {b.accounts.map((a) => (
                    <Td key={a.kind} className="text-right tabular-nums">
                      {money(a.balance)}
                      {a.minBalance > 0 && (
                        <span className="block text-xs text-muted">min {money(a.minBalance)}</span>
                      )}
                    </Td>
                  ))}
                  <Td>
                    {b.staff.length ? (
                      b.staff.map((s) => (
                        <Link
                          key={s.id}
                          to={`/people/employees/${s.id}`}
                          className="block text-brand hover:underline"
                        >
                          {s.firstName} {s.lastName}
                        </Link>
                      ))
                    ) : (
                      <span className="text-muted">None posted yet</span>
                    )}
                  </Td>
                  <Td>{b.isActive ? <Badge tone="ok">Open</Badge> : <Badge tone="neutral">Closed</Badge>}</Td>
                  <Td>
                    {d.canEdit && (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(b)}>
                        Change
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="text-sm text-muted">
          To post a member of staff to a branch, set the branch on their record in{' '}
          <Link to="/people/employees" className="text-brand hover:underline">
            Employee management
          </Link>
          , then give them the “AMS Branch Staff” role under Users.
        </p>
      </div>
    </div>
  );
}

function BranchForm({ branch, onDone, onCancel }) {
  const [v, setV] = useState(() =>
    branch
      ? {
          name: branch.name,
          location: branch.location ?? '',
          isActive: branch.isActive,
          openings: Object.fromEntries(branch.accounts.map((a) => [a.kind, String(a.balance)])),
          minimums: Object.fromEntries(branch.accounts.map((a) => [a.kind, String(a.minBalance)])),
        }
      : emptyBranch,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const canOpen = (k) => !branch || branch.accounts.find((a) => a.kind === k)?.canSetOpening;
  const num = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Number(x) || 0]));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...v,
        location: v.location || null,
        openings: num(v.openings),
        minimums: num(v.minimums),
      };
      if (branch) await api.put(`/api/float/branches/${branch.id}`, body);
      else await api.post('/api/float/branches', body);
      onDone(
        branch ? `${v.name} saved.` : `${v.name} added with its Cash, Airtel Money and MTN MoMo accounts.`,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const setIn = (group, k) => (e) => setV({ ...v, [group]: { ...v[group], [k]: e.target.value } });
  return (
    <Section title={branch ? `Change ${branch.name}` : 'Add AMS branch'}>
      <form onSubmit={save} className="stack">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="form-row">
          <Field id="br-name" label="Branch name">
            <Input
              id="br-name"
              required
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          </Field>
          <Field id="br-loc" label="Location" optional>
            <Input
              id="br-loc"
              value={v.location}
              onChange={(e) => setV({ ...v, location: e.target.value })}
            />
          </Field>
          {branch && (
            <Field id="br-st" label="Status">
              <Select
                id="br-st"
                value={v.isActive ? '1' : '0'}
                onChange={(e) => setV({ ...v, isActive: e.target.value === '1' })}
              >
                <option value="1">Open</option>
                <option value="0">Closed</option>
              </Select>
            </Field>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Opening balances</p>
          <div className="form-row">
            {Object.entries(ACCOUNT).map(([k, l]) => (
              <Field
                key={k}
                id={`op-${k}`}
                label={`${l} (K)`}
                hint={canOpen(k) ? undefined : 'Already in use: change it by counting at the branch.'}
              >
                <Input
                  id={`op-${k}`}
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={!canOpen(k)}
                  value={v.openings[k]}
                  onChange={setIn('openings', k)}
                />
              </Field>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Minimum balances (low-float warning below these)</p>
          <div className="form-row">
            {Object.entries(ACCOUNT).map(([k, l]) => (
              <Field key={k} id={`mn-${k}`} label={`${l} (K)`}>
                <Input
                  id={`mn-${k}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={v.minimums[k]}
                  onChange={setIn('minimums', k)}
                />
              </Field>
            ))}
          </div>
        </div>
        <div className="form-actions">
          <Button type="submit" busy={busy}>
            {branch ? 'Save changes' : 'Add branch'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ── AMS settings ───────────────────────────────────────────────────────────────────────────────
export function FloatSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['float-settings'], queryFn: () => api.get('/api/float/settings') });
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (q.data) setV({ ...q.data, companyId: String(q.data.companyId ?? '') });
  }, [q.data]);
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  if (q.isPending || !v) return <Loading />;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.put('/api/float/settings', { ...v, companyId: v.companyId ? Number(v.companyId) : null });
      setMsg({ tone: 'ok', text: 'Saved. It applies straight away.' });
      qc.invalidateQueries({ queryKey: ['float-settings'] });
      qc.invalidateQueries({ queryKey: ['float-me'] });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="AMS settings"
        actions={
          <Button busy={busy} onClick={save}>
            Save changes
          </Button>
        }
      />
      <div className="stack">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Section title="Company" description="AMS cash and float applies to this company only">
          <Field id="st-co" label="Company">
            <Select id="st-co" value={v.companyId} onChange={set('companyId')}>
              <option value="">Choose the company</option>
              {v.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </Section>
        <Section
          title="Defaults for new branches, and the daily report"
          description="Each branch has its own days and hours, set on the branch's page. These are what a new branch starts with."
        >
          <div className="stack">
            <div>
              <p className="mb-2 text-sm font-semibold">Trading days</p>
              <div className="flex flex-wrap gap-3">
                {DAYS.map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      checked={v.workingDays.includes(k)}
                      onChange={(e) =>
                        setV({
                          ...v,
                          workingDays: e.target.checked
                            ? [...v.workingDays, k]
                            : v.workingDays.filter((x) => x !== k),
                        })
                      }
                    />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-row">
              <Field id="st-ds" label="Opens at">
                <Input id="st-ds" type="time" value={v.dayStart} onChange={set('dayStart')} />
              </Field>
              <Field id="st-ev" label="Evening transactions from" hint="Counted separately in the report.">
                <Input id="st-ev" type="time" value={v.eveningFrom} onChange={set('eveningFrom')} />
              </Field>
              <Field id="st-ct" label="Closes at" hint="Branches not signed out by then are reminded.">
                <Input
                  id="st-ct"
                  type="time"
                  value={v.closeReminderTime}
                  onChange={set('closeReminderTime')}
                />
              </Field>
              <Field
                id="st-rt"
                label="Daily report time"
                hint="Sent to managers and directors on trading days."
              >
                <Input id="st-rt" type="time" value={v.reportTime} onChange={set('reportTime')} />
              </Field>
            </div>
          </div>
        </Section>
        <Section title="Limits">
          <div className="form-row">
            <Field
              id="st-tol"
              label="Count difference allowed (K)"
              hint="Smaller differences are not recorded as surplus or deficit."
            >
              <Input
                id="st-tol"
                type="number"
                min={0}
                value={v.cashTolerance}
                onChange={set('cashTolerance')}
              />
            </Field>
            <Field id="st-large" label="Large transaction from (K)" hint="Flagged for a manager to review.">
              <Input
                id="st-large"
                type="number"
                min={1}
                value={v.largeAmount}
                onChange={set('largeAmount')}
              />
            </Field>
            <Field id="st-dir" label="Director approves write-offs above (K)">
              <Input
                id="st-dir"
                type="number"
                min={0}
                value={v.directorLimit}
                onChange={set('directorLimit')}
              />
            </Field>
            <Field id="st-dup" label="Warn of a repeat within (minutes)">
              <Input
                id="st-dup"
                type="number"
                min={0}
                max={60}
                value={v.duplicateMinutes}
                onChange={set('duplicateMinutes')}
              />
            </Field>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── Phone sign-in for AMS branch staff (D119) ──────────────────────────────────────────────────
const PHONE_STATUS = {
  NOT_SET_UP: ['Not set up', 'neutral'],
  CODE_GIVEN: ['Code given', 'pending'],
  CODE_EXPIRED: ['Code expired', 'danger'],
  ACTIVE: ['Active', 'ok'],
  LOCKED: ['Locked', 'danger'],
};
export function FloatPhoneAccessPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['float-phone'], queryFn: () => api.get('/api/float/phone-access') });
  const [busy, setBusy] = useState(null);
  const [given, setGiven] = useState(null);
  const [msg, setMsg] = useState(null);
  const act = async (id, path) => {
    setBusy(`${id}${path}`);
    setMsg(null);
    setGiven(null);
    try {
      const r = await api.post(`/api/float/phone-access/${id}/${path}`);
      if (path === 'code') setGiven(r);
      else setMsg({ tone: 'ok', text: 'Phone sign-in turned off.' });
      qc.invalidateQueries({ queryKey: ['float-phone'] });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <PageHeader
        title="Phone sign-in"
        description="AMS branch staff sign in with their phone number and a 6-digit PIN. Give each one a one-time code: they sign in with it once, then choose their PIN."
      />
      <div className="stack">
        {given && (
          <Notice tone="ok" title={`One-time code for ${given.name}: ${given.code}`}>
            Give it to them in person or by phone. They sign in with {given.phone} and this code, then choose
            their PIN. It works once and expires {formatDateTime(given.expiresAt)}. It is not shown again.
          </Notice>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {q.isPending && <Loading />}
        {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
        {q.data &&
          (q.data.items.length === 0 ? (
            <div className="card p-0">
              <EmptyState title="No AMS branch staff yet.">
                Post staff to an AMS branch on their employee record in Employee management.
              </EmptyState>
            </div>
          ) : (
            <Table title="Phone sign-in">
              <thead>
                <tr>
                  <Th>First name</Th>
                  <Th>Last name</Th>
                  <Th>Branch</Th>
                  <Th>Phone number</Th>
                  <Th>Status</Th>
                  <Th>Last sign-in</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-semibold">{p.firstName}</Td>
                    <Td className="font-semibold">{p.lastName}</Td>
                    <Td>{p.branch}</Td>
                    <Td>
                      {p.phone ?? <span className="text-muted">None</span>}
                      {!p.hasPhone && (
                        <Link
                          to={`/people/employees/${p.id}`}
                          className="block text-xs text-brand hover:underline"
                        >
                          Add it on their record
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={PHONE_STATUS[p.status][1]}>{PHONE_STATUS[p.status][0]}</Badge>
                      {p.status === 'CODE_GIVEN' && (
                        <span className="block text-xs text-muted">
                          until {formatDateTime(p.codeExpiresAt)}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {p.lastSignInAt ? formatDateTime(p.lastSignInAt) : '—'}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {p.hasPhone && (
                          <Button
                            size="sm"
                            variant={p.status === 'ACTIVE' ? 'secondary' : 'primary'}
                            busy={busy === `${p.id}code`}
                            onClick={() => act(p.id, 'code')}
                          >
                            {p.status === 'NOT_SET_UP'
                              ? 'Set up'
                              : p.status === 'LOCKED'
                                ? 'Unlock: new code'
                                : 'New code'}
                          </Button>
                        )}
                        {p.status !== 'NOT_SET_UP' && (
                          <Button
                            size="sm"
                            variant="danger"
                            busy={busy === `${p.id}off`}
                            onClick={() => act(p.id, 'off')}
                          >
                            Turn off
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
      </div>
    </div>
  );
}

// ── One AMS branch: details, days and hours, staff (D120) ──────────────────────────────────────
export function FloatBranchAdminPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['float-branch-admin', id],
    queryFn: () => api.get(`/api/float/branches/${id}`),
  });
  const list = useQuery({ queryKey: ['float-branches'], queryFn: () => api.get('/api/float/branches') });
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(null);
  if (q.isPending || list.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const b = q.data;
  const listed = list.data?.items.find((x) => x.id === b.id);
  const refresh = (text, tone = 'ok') => {
    if (text) setMsg({ tone, text });
    qc.invalidateQueries({ queryKey: ['float-branch-admin', id] });
    qc.invalidateQueries({ queryKey: ['float-branches'] });
    qc.invalidateQueries({ queryKey: ['float-phone'] });
  };
  return (
    <div>
      <PageHeader
        title={b.name}
        description={`${b.location ? `${b.location} · ` : ''}${hoursText(b.hours)}`}
        actions={
          <>
            <Badge tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Open' : 'Closed'}</Badge>
            {!editing && listed && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Change name, balances or minimums
              </Button>
            )}
          </>
        }
      />
      <div className="stack">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {editing && listed && (
          <BranchForm
            branch={listed}
            onCancel={() => setEditing(false)}
            onDone={(text) => {
              setEditing(false);
              refresh(text);
            }}
          />
        )}
        <HoursForm branch={b} onDone={refresh} />
        <BranchStaff branch={b} onDone={refresh} />
      </div>
    </div>
  );
}

function HoursForm({ branch, onDone }) {
  const [v, setV] = useState(branch.hours);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const changed = JSON.stringify(v) !== JSON.stringify(branch.hours);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/float/branches/${branch.id}/hours`, v);
      onDone(`${branch.name}'s days and hours saved.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Working days and hours"
      description="Staff are reminded to sign out at the closing time on trading days. Transactions after the evening time are counted as evening transactions in the daily report."
    >
      <div className="stack">
        <div className="flex flex-wrap gap-3">
          {DAYS.map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-brand"
                checked={v.workingDays.includes(k)}
                onChange={(e) =>
                  setV({
                    ...v,
                    workingDays: e.target.checked
                      ? [...v.workingDays, k]
                      : v.workingDays.filter((x) => x !== k),
                  })
                }
              />
              {l}
            </label>
          ))}
        </div>
        <div className="form-row">
          <Field id="bh-open" label="Opens at">
            <Input
              id="bh-open"
              type="time"
              value={v.opensAt}
              onChange={(e) => setV({ ...v, opensAt: e.target.value })}
            />
          </Field>
          <Field id="bh-close" label="Closes at">
            <Input
              id="bh-close"
              type="time"
              value={v.closesAt}
              onChange={(e) => setV({ ...v, closesAt: e.target.value })}
            />
          </Field>
          <Field id="bh-eve" label="Evening transactions from">
            <Input
              id="bh-eve"
              type="time"
              value={v.eveningFrom}
              onChange={(e) => setV({ ...v, eveningFrom: e.target.value })}
            />
          </Field>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <div>
          <Button busy={busy} disabled={!changed} onClick={save}>
            Save days and hours
          </Button>
        </div>
      </div>
    </Section>
  );
}

function BranchStaff({ branch, onDone }) {
  const [adding, setAdding] = useState('');
  const [giveRole, setGiveRole] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [given, setGiven] = useState(null);
  const run = async (key, fn, text) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      onDone(text?.(r));
      return r;
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      setBusy(null);
    }
  };
  const add = () =>
    run(
      'add',
      () => api.post(`/api/float/branches/${branch.id}/staff`, { employeeId: Number(adding), giveRole }),
      () => 'Added to the branch.',
    ).then((r) => r && setAdding(''));
  const code = (p) =>
    run(`code${p.id}`, () => api.post(`/api/float/phone-access/${p.id}/code`)).then((r) => r && setGiven(r));
  return (
    <Section title="Staff" description="The people who work at this branch and record its transactions.">
      <div className="stack">
        {given && (
          <Notice tone="ok" title={`One-time code for ${given.name}: ${given.code}`}>
            They sign in with {given.phone} and this code, then choose their PIN. It works once and expires{' '}
            {formatDateTime(given.expiresAt)}. It is not shown again.
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {branch.staff.length === 0 ? (
          <p className="muted-text">Nobody works here yet.</p>
        ) : (
          <Table title={`${branch.name} staff`} tools={false}>
            <thead>
              <tr>
                <Th>First name</Th>
                <Th>Last name</Th>
                <Th>Phone number</Th>
                <Th>Inventory role</Th>
                <Th>Phone sign-in</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {branch.staff.map((p) => (
                <tr key={p.id}>
                  <Td className="font-semibold">
                    <Link to={`/people/employees/${p.id}`} className="text-brand hover:underline">
                      {p.firstName}
                    </Link>
                  </Td>
                  <Td className="font-semibold">{p.lastName}</Td>
                  <Td>
                    {p.phone ?? <span className="text-muted">None</span>}
                    {!p.hasPhone && (
                      <Link
                        to={`/people/employees/${p.id}`}
                        className="block text-xs text-brand hover:underline"
                      >
                        Add it on their record
                      </Link>
                    )}
                  </Td>
                  <Td>{p.role ?? <span className="text-muted">None: give one under Users</span>}</Td>
                  <Td>
                    <Badge tone={PHONE_STATUS[p.phoneSignIn][1]}>{PHONE_STATUS[p.phoneSignIn][0]}</Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {p.hasPhone && (
                        <Button
                          size="sm"
                          variant={p.phoneSignIn === 'ACTIVE' ? 'secondary' : 'primary'}
                          busy={busy === `code${p.id}`}
                          onClick={() => code(p)}
                        >
                          {p.phoneSignIn === 'NOT_SET_UP'
                            ? 'Set up phone sign-in'
                            : p.phoneSignIn === 'LOCKED'
                              ? 'Unlock: new code'
                              : 'New code'}
                        </Button>
                      )}
                      <Button size="sm" variant="danger" onClick={() => setRemoving(p)}>
                        Take off branch
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field
              id="bs-add"
              label="Add someone to this branch"
              hint="Altus Money Solutions staff. Their branch is set on their employee record."
            >
              <Select id="bs-add" value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Choose a member of staff</option>
                {branch.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                    {c.jobTitle ? ` · ${c.jobTitle}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand"
              checked={giveRole}
              onChange={(e) => setGiveRole(e.target.checked)}
            />
            Give them the AMS Branch Staff role
          </label>
          <Button busy={busy === 'add'} disabled={!adding} onClick={add}>
            Add to branch
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(removing)}
        title="Take off this branch"
        confirmLabel="Take off branch"
        tone="danger"
        busy={busy === 'remove'}
        onConfirm={() =>
          run(
            'remove',
            () => api.del(`/api/float/branches/${branch.id}/staff/${removing.id}`),
            () => `${removing.firstName} ${removing.lastName} taken off ${branch.name}.`,
          ).then(() => setRemoving(null))
        }
        onCancel={() => setRemoving(null)}
      >
        {removing?.firstName} {removing?.lastName} will no longer be posted to {branch.name}. Their phone
        sign-in ends and the AMS Branch Staff role is removed.
      </ConfirmDialog>
    </Section>
  );
}
