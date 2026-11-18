import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ACCOUNT, DAYS, money, timeOf } from './fl.js';
import { DayReportCard } from './FloatEntryPages.jsx';

// ── Daily reports (D118) ───────────────────────────────────────────────────────────────────────
const today = () => new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10); // Lusaka

export function FloatDailyPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || today();
  const q = useQuery({
    queryKey: ['float-daily', date],
    queryFn: () => api.get(`/api/float/daily?date=${date}`),
  });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [range, setRange] = useState({ from: date.slice(0, 8) + '01', to: date });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const t = d.totals;
  const sign = async () => {
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
  const pair = (x) => (
    <>
      {x.count}
      <span className="block text-xs text-muted">{money(x.amount)}</span>
    </>
  );
  return (
    <div>
      <PageHeader
        title="AMS daily report"
        description={
          d.signedOff
            ? `Signed off by ${d.signedOff.by}, ${formatDateTime(d.signedOff.at)}${d.signedOff.comment ? `: “${d.signedOff.comment}”` : ''}`
            : `${t.signedOut} of ${t.branches} branches signed out`
        }
        actions={
          <div className="w-44">
            <Input
              type="date"
              aria-label="Day"
              value={date}
              max={today()}
              onChange={(e) => setParams({ date: e.target.value })}
            />
          </div>
        }
      />
      <div className="stack">
        {d.unsigned.length > 0 && (
          <Notice tone="pending" title="Days not yet signed off">
            {d.unsigned.map((x) => (
              <button
                key={x}
                type="button"
                className="mr-3 font-medium underline"
                onClick={() => setParams({ date: x })}
              >
                {formatDate(x)}
              </button>
            ))}
          </Notice>
        )}
        {d.canSignOff && (
          <Section title="Sign off this day" className="border-brand ring-1 ring-brand">
            <div className="space-y-3">
              <p className="text-sm">
                Check each branch below. Once signed off the report goes to the directors and nothing on this
                day can change.
                {t.signedOut < t.branches &&
                  ` ${t.branches - t.signedOut} branch(es) have not signed out yet.`}
              </p>
              <Field id="dy-c" label="Note to the directors" optional>
                <Textarea id="dy-c" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              {error && <Notice tone="danger">{error}</Notice>}
              <Button busy={busy} onClick={sign}>
                Sign off {formatDate(date)}
              </Button>
            </div>
          </Section>
        )}
        <KpiRow cols={4}>
          <Kpi
            label="Total transactions"
            value={t.transactions.total}
            note={`${t.walkIns} walk-ins · ${t.turnedDown} turned down`}
            small
          />
          <Kpi
            label="Float + cash"
            value={money(t.total)}
            note={`Cash ${money(t.cash)} · float ${money(t.float)}`}
            small
          />
          <Kpi
            label="Daily commission"
            value={money(t.commission)}
            note={`This month ${money(t.commissionMonth)}`}
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
        {d.branches.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No AMS branches." />
          </div>
        ) : (
          <Table title={`AMS daily ${date}`}>
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th>Status</Th>
                <Th className="text-right">Deposits</Th>
                <Th className="text-right">Withdrawals</Th>
                <Th className="text-right">Float transfers</Th>
                <Th className="text-right">Cash to finance</Th>
                <Th className="text-right">{`${d.settings.dayStart}–${d.settings.eveningFrom}`}</Th>
                <Th className="text-right">{`After ${d.settings.eveningFrom}`}</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Turned down</Th>
                <Th className="text-right">Cash</Th>
                <Th className="text-right">Float</Th>
                <Th className="text-right">Float + cash</Th>
                <Th className="text-right">Commission</Th>
                <Th className="text-right">This month</Th>
              </tr>
            </thead>
            <tbody>
              {d.branches.map((b) => (
                <tr key={b.id}>
                  <Td className="font-semibold">{b.name}</Td>
                  <Td>
                    {b.signedOut ? (
                      <Badge tone="ok">Signed out {timeOf(b.signedOutAt)}</Badge>
                    ) : (
                      <Badge tone="pending">Open</Badge>
                    )}
                    {b.signedOutBy && (
                      <span className="block text-xs text-muted">
                        {b.signedOutBy.firstName} {b.signedOutBy.lastName}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{pair(b.deposits)}</Td>
                  <Td className="text-right tabular-nums">{pair(b.withdrawals)}</Td>
                  <Td className="text-right tabular-nums">{pair(b.floatTransfers)}</Td>
                  <Td className="text-right tabular-nums">{pair(b.cashCollections)}</Td>
                  <Td className="text-right">{b.transactions.daytime}</Td>
                  <Td className="text-right">{b.transactions.evening}</Td>
                  <Td className="text-right font-semibold">{b.transactions.total}</Td>
                  <Td className="text-right">{b.turnedDown}</Td>
                  <Td className="text-right tabular-nums">{money(b.cash)}</Td>
                  <Td className="text-right tabular-nums">{money(b.float)}</Td>
                  <Td className="text-right font-semibold tabular-nums">{money(b.total)}</Td>
                  <Td className="text-right tabular-nums">
                    {b.commission == null ? '—' : money(b.commission)}
                  </Td>
                  <Td className="text-right tabular-nums">{money(b.commissionMonth)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {d.branches.map((b) => (
            <DayReportCard key={b.id} report={b} />
          ))}
        </div>
        <Section title="Download a period" description="One row per branch and day, as kept in Excel">
          <div className="flex flex-wrap items-end gap-3">
            <Field id="hx-from" label="From">
              <Input
                id="hx-from"
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </Field>
            <Field id="hx-to" label="To">
              <Input
                id="hx-to"
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() =>
                downloadFile(`/api/float/history?from=${range.from}&to=${range.to}&format=xlsx`).catch((e) =>
                  setError(e.message),
                )
              }
            >
              Export to Excel
            </Button>
          </div>
        </Section>
      </div>
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
        <Section title="Trading days and the daily report">
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
              <Field id="st-ds" label="The day starts at">
                <Input id="st-ds" type="time" value={v.dayStart} onChange={set('dayStart')} />
              </Field>
              <Field id="st-ev" label="Evening transactions from" hint="Counted separately in the report.">
                <Input id="st-ev" type="time" value={v.eveningFrom} onChange={set('eveningFrom')} />
              </Field>
              <Field id="st-ct" label="Sign-out reminder" hint="Branches not signed out are reminded.">
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
