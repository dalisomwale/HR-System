import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, downloadFile } from '../../../lib/api.js';
import { formatDate, formatDateTime } from '../../../lib/format.js';
import {
  Badge,
  Button,
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
import { ACCOUNT, DAYS, NETWORK, money, signed } from './fl.js';

// ── Weekly reports ─────────────────────────────────────────────────────────────────────────────
export function FloatWeeksPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['float-weeks'], queryFn: () => api.get('/api/float/weeks') });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const make = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/api/float/weeks/generate');
      qc.invalidateQueries({ queryKey: ['float-weeks'] });
      setMsg({ tone: 'ok', text: 'The report for the last finished week is ready.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader
        title="AMS weekly reports"
        description="Made automatically at the report time on the last day of the week. A manager signs each one off; it then goes to the director and the week is locked."
        actions={
          q.data?.canSignOff && (
            <Button variant="secondary" busy={busy} onClick={make}>
              Make last week's report now
            </Button>
          )
        }
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No weekly reports yet." />
          </div>
        ) : (
          <Table title="AMS weekly reports">
            <thead>
              <tr>
                <Th>Week</Th>
                <Th className="text-right">Deposits</Th>
                <Th className="text-right">Withdrawals</Th>
                <Th className="text-right">Commission</Th>
                <Th className="text-right">Deficits</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Action</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((w) => (
                <tr key={w.id} data-date={w.end}>
                  <Td className="whitespace-nowrap font-semibold">
                    {formatDate(w.start)} – {formatDate(w.end)}
                  </Td>
                  <Td className="text-right tabular-nums">{money(w.totals.depositAmount)}</Td>
                  <Td className="text-right tabular-nums">{money(w.totals.withdrawalAmount)}</Td>
                  <Td className="text-right tabular-nums">{money(w.totals.commission)}</Td>
                  <Td className="text-right tabular-nums">{money(w.totals.deficit)}</Td>
                  <Td>
                    {w.status === 'SIGNED_OFF' ? (
                      <Badge tone="ok">Signed off · {w.signedBy}</Badge>
                    ) : (
                      <Badge tone="pending">To sign off</Badge>
                    )}
                  </Td>
                  <Td>
                    <Link
                      to={`/requisitions/float/reports/${w.id}`}
                      className={`btn btn-sm ${w.status === 'GENERATED' && q.data.canSignOff ? 'btn-primary' : ''}`}
                    >
                      {w.status === 'GENERATED' && q.data.canSignOff ? 'Sign off' : 'Open'}
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

export function FloatWeekPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['float-week', id], queryFn: () => api.get(`/api/float/weeks/${id}`) });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const w = q.data;
  const t = w.data.totals;
  const p = w.data.previous;
  const change = (now, before) =>
    before
      ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}% on last week`
      : undefined;
  const sign = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/float/weeks/${w.id}/sign-off`, { comment: comment.trim() || null });
      qc.invalidateQueries({ queryKey: ['float-week', id] });
      qc.invalidateQueries({ queryKey: ['float-weeks'] });
      qc.invalidateQueries({ queryKey: ['float-me'] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader
        title={`AMS weekly report · ${formatDate(w.start)} – ${formatDate(w.end)}`}
        description={
          w.status === 'SIGNED_OFF'
            ? `Signed off by ${w.signedBy}, ${formatDateTime(w.signedAt)}${w.signComment ? `: “${w.signComment}”` : ''}`
            : 'Waiting for a manager to sign it off'
        }
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              downloadFile(`/api/float/weeks/${w.id}?format=xlsx`).catch((e) => setError(e.message))
            }
          >
            Export to Excel
          </Button>
        }
      />
      <div className="stack">
        {w.canSignOff && (
          <Section title="Sign off" className="border-brand ring-1 ring-brand">
            <div className="space-y-3">
              <p className="text-sm">
                Once signed off it goes to the director and nothing in this week can change.
              </p>
              <Field id="wk-c" label="Note to the director" optional>
                <Textarea id="wk-c" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              {error && <Notice tone="danger">{error}</Notice>}
              <Button busy={busy} onClick={sign}>
                Sign off
              </Button>
            </div>
          </Section>
        )}
        <KpiRow cols={4}>
          <Kpi
            label={`Deposits (${t.depositCount})`}
            value={money(t.depositAmount)}
            note={change(t.depositAmount, p.depositAmount)}
            small
          />
          <Kpi
            label={`Withdrawals (${t.withdrawalCount})`}
            value={money(t.withdrawalAmount)}
            note={change(t.withdrawalAmount, p.withdrawalAmount)}
            small
          />
          <Kpi
            label="Commission earned"
            value={money(t.commission)}
            note={change(t.commission, p.commission)}
            small
          />
          <Kpi
            label="Deficits"
            value={money(t.deficit)}
            note={`Surpluses ${money(t.surplus)}`}
            tone={t.deficit > 0 ? 'bad' : undefined}
            small
          />
        </KpiRow>
        <KpiRow cols={3}>
          {['AIRTEL', 'MTN'].map((n) => (
            <Kpi
              key={n}
              label={`${NETWORK[n]} (${t.byNetwork[n].count})`}
              value={money(t.byNetwork[n].amount)}
              small
            />
          ))}
        </KpiRow>
        {w.data.branches.map((b) => (
          <Section
            key={b.id}
            title={b.name}
            description={`${b.depositCount + b.withdrawalCount} transactions · commission ${money(b.commission)}${b.deficit ? ` · deficits ${money(b.deficit)}` : ''}`}
          >
            <Table title={b.name} tools={false}>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th className="text-right">Opening</Th>
                  <Th className="text-right">Deposits</Th>
                  <Th className="text-right">Withdrawals</Th>
                  <Th className="text-right">Top-ups</Th>
                  <Th className="text-right">Transfers</Th>
                  <Th className="text-right">Reversals</Th>
                  <Th className="text-right">Count differences</Th>
                  <Th className="text-right">Closing</Th>
                </tr>
              </thead>
              <tbody>
                {b.accounts.map((a) => (
                  <tr key={a.kind}>
                    <Td className="font-semibold">{ACCOUNT[a.kind]}</Td>
                    <Td className="text-right tabular-nums">{money(a.opening)}</Td>
                    <Td className="text-right tabular-nums">{signed(a.deposits)}</Td>
                    <Td className="text-right tabular-nums">{signed(a.withdrawals)}</Td>
                    <Td className="text-right tabular-nums">{signed(a.topups)}</Td>
                    <Td className="text-right tabular-nums">{signed(a.transfersIn + a.transfersOut)}</Td>
                    <Td className="text-right tabular-nums">{signed(a.reversals)}</Td>
                    <Td className="text-right tabular-nums">{signed(a.countDifferences)}</Td>
                    <Td className="text-right font-semibold tabular-nums">{money(a.closing)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
        ))}
      </div>
    </div>
  );
}

// ── Commission ─────────────────────────────────────────────────────────────────────────────────
export function FloatCommissionPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const q = useQuery({
    queryKey: ['float-commission', month],
    queryFn: () => api.get(`/api/float/commission?month=${month}`),
  });
  const [v, setV] = useState({
    network: 'AIRTEL',
    branchId: '',
    amount: '',
    receivedOn: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const record = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/api/float/commission/receipts', {
        ...v,
        month,
        branchId: v.branchId || null,
        amount: Number(v.amount),
        notes: v.notes || null,
      });
      setV({ ...v, amount: '', notes: '' });
      setMsg({ tone: 'ok', text: 'Commission received recorded.' });
      qc.invalidateQueries({ queryKey: ['float-commission', month] });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader
        title="AMS commission"
        description="Expected commission is worked out on every transaction from the commission tables; record what the networks pay each month to see any shortfall."
      />
      <div className="mb-4 w-48">
        <Field id="cm-month" label="Month">
          <Input id="cm-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
      </div>
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data && (
        <div className="stack">
          <KpiRow cols={3}>
            {q.data.byNetwork.map((n) => (
              <Kpi
                key={n.network}
                label={`${NETWORK[n.network]}: expected ${money(n.expected)}`}
                value={money(n.received)}
                note={
                  n.difference === 0
                    ? 'Received in full'
                    : `${n.difference < 0 ? 'Short' : 'Over'} by ${money(Math.abs(n.difference))}`
                }
                tone={n.difference < 0 ? 'warn' : undefined}
                small
              />
            ))}
          </KpiRow>
          <Table title={`AMS commission ${month}`}>
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th className="text-right">Airtel transactions</Th>
                <Th className="text-right">Airtel commission</Th>
                <Th className="text-right">MTN transactions</Th>
                <Th className="text-right">MTN commission</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.branches.map((b) => (
                <tr key={b.id}>
                  <Td className="font-semibold">{b.name}</Td>
                  {b.networks.map((n) => [
                    <Td key={`${n.network}-n`} className="text-right">
                      {n.transactions}
                    </Td>,
                    <Td key={`${n.network}-c`} className="text-right tabular-nums">
                      {money(n.commission)}
                    </Td>,
                  ])}
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data.receipts.length > 0 && (
            <Section title="Received this month">
              <ul className="divide-y divide-rule text-sm">
                {q.data.receipts.map((r) => (
                  <li key={r.id} className="py-2">
                    {NETWORK[r.network]} {money(r.amount)} on {formatDate(r.receivedOn)}
                    {r.branch ? ` · ${r.branch}` : ' · all branches'}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {q.data.canRecord && (
            <Section title="Record commission received">
              <div className="stack">
                {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
                <div className="form-row">
                  <Field id="cr-net" label="Network">
                    <Select
                      id="cr-net"
                      value={v.network}
                      onChange={(e) => setV({ ...v, network: e.target.value })}
                    >
                      {Object.entries(NETWORK).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="cr-br" label="Branch" optional>
                    <Select
                      id="cr-br"
                      value={v.branchId}
                      onChange={(e) => setV({ ...v, branchId: e.target.value })}
                    >
                      <option value="">All branches</option>
                      {q.data.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="cr-amt" label="Amount (K)">
                    <Input
                      id="cr-amt"
                      type="number"
                      min={0}
                      value={v.amount}
                      onChange={(e) => setV({ ...v, amount: e.target.value })}
                    />
                  </Field>
                  <Field id="cr-on" label="Received on">
                    <Input
                      id="cr-on"
                      type="date"
                      value={v.receivedOn}
                      onChange={(e) => setV({ ...v, receivedOn: e.target.value })}
                    />
                  </Field>
                </div>
                <Field id="cr-notes" label="Notes" optional>
                  <Input
                    id="cr-notes"
                    value={v.notes}
                    onChange={(e) => setV({ ...v, notes: e.target.value })}
                  />
                </Field>
                <div>
                  <Button busy={busy} disabled={!(Number(v.amount) > 0)} onClick={record}>
                    Record
                  </Button>
                </div>
              </div>
            </Section>
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
                  <Td className="font-semibold">{b.name}</Td>
                  <Td>{b.location ?? '—'}</Td>
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

// ── AMS settings and commission tables ─────────────────────────────────────────────────────────
export function FloatSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['float-settings'], queryFn: () => api.get('/api/float/settings') });
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (q.data) {
      setV({
        ...q.data,
        companyId: String(q.data.companyId ?? ''),
        rules: q.data.rules.map((r) => ({ ...r, maxAmount: r.maxAmount ?? '' })),
      });
    }
  }, [q.data]);
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  if (q.isPending || !v) return <Loading />;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const setRule = (i, k) => (e) =>
    setV({ ...v, rules: v.rules.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)) });
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.put('/api/float/settings', {
        ...v,
        companyId: v.companyId ? Number(v.companyId) : null,
        rules: v.rules.map((r) => ({ ...r, maxAmount: r.maxAmount === '' ? null : Number(r.maxAmount) })),
      });
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
        <Section title="The working week and the report">
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
              <Field
                id="st-end"
                label="The week ends on"
                hint="The weekly report covers the 7 days to this day."
              >
                <Select id="st-end" value={v.weekEndDay} onChange={set('weekEndDay')}>
                  {DAYS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="st-rt" label="Report time" hint="On that day, the report is made from this time.">
                <Input id="st-rt" type="time" value={v.reportTime} onChange={set('reportTime')} />
              </Field>
              <Field id="st-ct" label="Close-the-day reminder" hint="Branches not yet closed are reminded.">
                <Input
                  id="st-ct"
                  type="time"
                  value={v.closeReminderTime}
                  onChange={set('closeReminderTime')}
                />
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
        <Section
          title="Commission tables"
          description="What each network pays per transaction. The first band that fits the amount is used."
        >
          <div className="stack">
            {v.rules.length === 0 && <p className="muted-text">No commission set up yet.</p>}
            {v.rules.map((r, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_auto]">
                <Field id={`r-n-${i}`} label="Network">
                  <Select id={`r-n-${i}`} value={r.network} onChange={setRule(i, 'network')}>
                    <option value="AIRTEL">Airtel Money</option>
                    <option value="MTN">MTN MoMo</option>
                  </Select>
                </Field>
                <Field id={`r-k-${i}`} label="Type">
                  <Select id={`r-k-${i}`} value={r.kind} onChange={setRule(i, 'kind')}>
                    <option value="DEPOSIT">Deposit</option>
                    <option value="WITHDRAWAL">Withdrawal</option>
                  </Select>
                </Field>
                <Field id={`r-min-${i}`} label="From (K)">
                  <Input
                    id={`r-min-${i}`}
                    type="number"
                    min={0}
                    value={r.minAmount}
                    onChange={setRule(i, 'minAmount')}
                  />
                </Field>
                <Field id={`r-max-${i}`} label="To (K)" optional>
                  <Input
                    id={`r-max-${i}`}
                    type="number"
                    min={0}
                    value={r.maxAmount}
                    onChange={setRule(i, 'maxAmount')}
                  />
                </Field>
                <Field id={`r-t-${i}`} label="Pays">
                  <Select id={`r-t-${i}`} value={r.feeType} onChange={setRule(i, 'feeType')}>
                    <option value="FLAT">Flat (K)</option>
                    <option value="PERCENT">Percent (%)</option>
                  </Select>
                </Field>
                <Field id={`r-v-${i}`} label={r.feeType === 'FLAT' ? 'Amount (K)' : 'Percent'}>
                  <Input
                    id={`r-v-${i}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={r.value}
                    onChange={setRule(i, 'value')}
                  />
                </Field>
                <Button
                  variant="ghost"
                  aria-label="Remove band"
                  onClick={() => setV({ ...v, rules: v.rules.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                onClick={() =>
                  setV({
                    ...v,
                    rules: [
                      ...v.rules,
                      {
                        network: 'AIRTEL',
                        kind: 'DEPOSIT',
                        minAmount: 0,
                        maxAmount: '',
                        feeType: 'FLAT',
                        value: 0,
                      },
                    ],
                  })
                }
              >
                <Plus aria-hidden /> Add band
              </Button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
