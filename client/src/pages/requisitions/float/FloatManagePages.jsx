import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFile } from '../../../lib/api.js';
import { formatDate } from '../../../lib/format.js';
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
  Th,
  TodayDate,
} from '../../../components/ui.jsx';
import { errorText } from '../rq.js';
import {
  ACCOUNT,
  KIND,
  NETWORK,
  TXN_STATUS,
  VARIANCE_STATUS,
  money,
  signed,
  timeOf,
  useFloat,
} from './fl.js';

/** Every AMS branch live (D117): balances, today's business, closes, and what needs doing. */
export function FloatDashboardPage() {
  const qc = useQueryClient();
  const me = useFloat();
  const q = useQuery({
    queryKey: ['float-dashboard'],
    queryFn: () => api.get('/api/float/dashboard'),
    refetchInterval: 60_000,
  });
  const [transfer, setTransfer] = useState(null);
  const [msg, setMsg] = useState(null);
  if (q.isPending || me.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const r = me.data.rights;
  const c = me.data.counts;
  if (!me.data.configured) {
    return (
      <Notice tone="pending" title="AMS is not set up yet">
        {r.admin ? (
          <>
            Choose the AMS company in{' '}
            <Link to="/requisitions/float/settings" className="underline">
              AMS settings
            </Link>
            , then add the branches.
          </>
        ) : (
          'The System Administrator needs to set up AMS first.'
        )}
      </Notice>
    );
  }
  return (
    <div>
      <PageHeader title="AMS cash and float" description={`Business day ${d.date}`} actions={<TodayDate />} />
      <div className="stack">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <KpiRow cols={3}>
          <Kpi label="Cash at all branches" value={money(d.totals.CASH)} small />
          <Kpi label="Airtel Money float" value={money(d.totals.AIRTEL)} small />
          <Kpi label="MTN MoMo float" value={money(d.totals.MTN)} small />
        </KpiRow>
        <KpiRow cols={4}>
          <Kpi label="Deposits today" value={money(d.totals.deposits)} small />
          <Kpi label="Withdrawals today" value={money(d.totals.withdrawals)} small />
          <Kpi label="Transactions today" value={d.totals.transactions} small />
          <Kpi
            label="Waiting for you"
            value={c.approvals}
            to="/requisitions/float/approvals"
            tone={c.approvals ? 'warn' : undefined}
            small
          />
        </KpiRow>
        {d.unsignedDays > 0 && (
          <Notice tone="pending" title="Daily reports waiting for sign-off">
            {d.unsignedDays} {d.unsignedDays === 1 ? 'day' : 'days'} not yet signed off.{' '}
            <Link to="/requisitions/float/daily" className="font-medium underline">
              Open the daily report
            </Link>
          </Notice>
        )}
        {d.suggestions.length > 0 && (
          <Section title="Suggested top-ups" description="Accounts below their minimum, or running out today">
            <ul className="divide-y divide-rule text-sm">
              {d.suggestions.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold">{s.toBranch.name}</span> needs about {money(s.need)}{' '}
                    {ACCOUNT[s.account]}
                    {s.runsOutAt && <span className="text-danger"> · runs out about {s.runsOutAt}</span>}
                    {s.from && (
                      <span className="block text-xs text-muted">
                        {s.from.name} has {money(s.from.spare)} to spare.
                      </span>
                    )}
                  </span>
                  {r.approve && (
                    <Button
                      size="sm"
                      onClick={() =>
                        setTransfer({
                          kind: s.from ? 'TRANSFER' : 'TOPUP',
                          fromBranchId: s.from?.id ?? '',
                          fromAccount: s.account,
                          toBranchId: s.toBranch.id,
                          toAccount: s.account,
                          amount: String(s.need),
                          reason: 'Suggested top-up',
                        })
                      }
                    >
                      {s.from ? 'Move it' : 'Top up'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {r.approve && (
          <div>
            {!transfer && (
              <Button
                variant="secondary"
                onClick={() =>
                  setTransfer({
                    kind: 'TRANSFER',
                    fromBranchId: '',
                    fromAccount: 'CASH',
                    toBranchId: '',
                    toAccount: 'CASH',
                    amount: '',
                    reason: '',
                  })
                }
              >
                Move money between branches
              </Button>
            )}
            {transfer && (
              <MoveForm
                initial={transfer}
                branches={d.branches}
                onCancel={() => setTransfer(null)}
                onDone={(text) => {
                  setTransfer(null);
                  setMsg({ tone: 'ok', text });
                  qc.invalidateQueries({ queryKey: ['float-dashboard'] });
                  qc.invalidateQueries({ queryKey: ['float-me'] });
                }}
              />
            )}
          </div>
        )}
        {d.branches.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No AMS branches yet.">
              {r.admin && <Link to="/requisitions/float/branches">Add the AMS branches</Link>}
            </EmptyState>
          </div>
        ) : (
          <Table title="AMS branches today">
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th className="text-right">Cash</Th>
                <Th className="text-right">Airtel Money</Th>
                <Th className="text-right">MTN MoMo</Th>
                <Th className="text-right">Transactions</Th>
                <Th>Day</Th>
                <Th className="text-right">To resolve</Th>
              </tr>
            </thead>
            <tbody>
              {d.branches.map((b) => (
                <tr key={b.id}>
                  <Td className="font-semibold">
                    <Link
                      to={`/requisitions/float/branch?branch=${b.id}`}
                      className="text-brand hover:underline"
                    >
                      {b.name}
                    </Link>
                  </Td>
                  {['CASH', 'AIRTEL', 'MTN'].map((k) => {
                    const a = b.accounts.find((x) => x.kind === k);
                    return (
                      <Td
                        key={k}
                        className={`text-right tabular-nums ${a?.low ? 'font-semibold text-danger' : ''}`}
                      >
                        {a ? money(a.balance) : '—'}
                        {a?.runsOutAt && <span className="block text-xs">out ~{a.runsOutAt}</span>}
                      </Td>
                    );
                  })}
                  <Td className="text-right">{b.totals.reduce((s, t) => s + t.count, 0)}</Td>
                  <Td>
                    {b.closed ? (
                      <Badge tone="ok">Signed out</Badge>
                    ) : b.tradingToday ? (
                      <Badge tone="pending">Open</Badge>
                    ) : (
                      <Badge tone="neutral">Closed today</Badge>
                    )}
                    <span className="block text-xs text-muted">
                      {b.hours.opensAt}–{b.hours.closesAt}
                    </span>
                  </Td>
                  <Td className="text-right">{b.openVariances || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

function MoveForm({ initial, branches, onDone, onCancel }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/float/movements', {
        ...v,
        fromBranchId: v.kind === 'TRANSFER' ? Number(v.fromBranchId) : null,
        fromAccount: v.kind === 'TRANSFER' ? v.fromAccount : null,
        toBranchId: Number(v.toBranchId),
        amount: Number(v.amount),
        reason: v.reason || null,
      });
      onDone('Sent for approval. Another manager approves it, then both balances change.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const branchSelect = (id, value, key) => (
    <Select id={id} value={value} onChange={set(key)}>
      <option value="">Choose a branch</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  );
  const accountSelect = (id, value, key) => (
    <Select id={id} value={value} onChange={set(key)}>
      {Object.entries(ACCOUNT).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </Select>
  );
  return (
    <Section
      title={v.kind === 'TOPUP' ? 'Top up a branch' : 'Move money'}
      className="border-brand ring-1 ring-brand"
    >
      <div className="stack">
        <Field id="mv-kind" label="What">
          <Select id="mv-kind" value={v.kind} onChange={set('kind')}>
            <option value="TRANSFER">Move from another branch or account</option>
            <option value="TOPUP">Top up from head office or the network</option>
          </Select>
        </Field>
        {v.kind === 'TRANSFER' && (
          <div className="form-row">
            <Field id="mv-fb" label="From branch">
              {branchSelect('mv-fb', v.fromBranchId, 'fromBranchId')}
            </Field>
            <Field id="mv-fa" label="From account">
              {accountSelect('mv-fa', v.fromAccount, 'fromAccount')}
            </Field>
          </div>
        )}
        <div className="form-row">
          <Field id="mv-tb" label="To branch">
            {branchSelect('mv-tb', v.toBranchId, 'toBranchId')}
          </Field>
          <Field id="mv-ta" label="To account">
            {accountSelect('mv-ta', v.toAccount, 'toAccount')}
          </Field>
          <Field id="mv-amount" label="Amount (K)">
            <Input id="mv-amount" type="number" min={1} value={v.amount} onChange={set('amount')} />
          </Field>
        </div>
        <Field id="mv-reason" label="Reason" optional>
          <Input id="mv-reason" value={v.reason} onChange={set('reason')} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button busy={busy} disabled={!v.toBranchId || !(Number(v.amount) > 0)} onClick={send}>
            Send for approval
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** Everything waiting for a manager or a director, each with its buttons. */
export function FloatApprovalsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['float-approvals'], queryFn: () => api.get('/api/float/approvals') });
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [resolving, setResolving] = useState(null);
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const act = async (key, path, body, text) => {
    setBusy(key);
    setMsg(null);
    try {
      await api.post(path, body);
      setMsg({ tone: 'ok', text });
      qc.invalidateQueries({ queryKey: ['float-approvals'] });
      qc.invalidateQueries({ queryKey: ['float-me'] });
      qc.invalidateQueries({ queryKey: ['float-dashboard'] });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };
  const nothing = !d.movements.length && !d.reversals.length && !d.large.length && !d.variances.length;
  const yesNo = (key, path, extra = {}) => (
    <div className="flex gap-2">
      <Button
        size="sm"
        busy={busy === `${key}-y`}
        onClick={() => act(`${key}-y`, path, { approve: true, ...extra }, 'Approved.')}
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="danger"
        busy={busy === `${key}-n`}
        onClick={() => act(`${key}-n`, path, { approve: false, ...extra }, 'Not approved.')}
      >
        Refuse
      </Button>
    </div>
  );
  return (
    <div>
      <PageHeader title="AMS approvals" />
      <div className="stack">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {nothing && (
          <div className="card p-0">
            <EmptyState title="Nothing waiting for you." />
          </div>
        )}
        {d.movements.length > 0 && (
          <Section title="Top-ups and transfers">
            <ul className="divide-y divide-rule text-sm">
              {d.movements.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="font-semibold">
                      {{ TOPUP: 'Top-up', TRANSFER: 'Transfer', COLLECTION: 'Cash to finance' }[m.kind]}{' '}
                      {money(m.amount)} {ACCOUNT[m.toAccount]} {m.kind === 'COLLECTION' ? 'from' : 'to'}{' '}
                      {m.toBranch}
                    </span>
                    {m.fromBranch && (
                      <span className="block text-muted">
                        From {m.fromBranch} ({ACCOUNT[m.fromAccount]})
                      </span>
                    )}
                    <span className="block text-xs text-muted">
                      {m.requestedByName} · {timeOf(m.requestedAt)}
                      {m.reason ? ` · ${m.reason}` : ''}
                    </span>
                  </span>
                  {m.requestedBy === d.me ? (
                    <Badge tone="neutral">Your request</Badge>
                  ) : (
                    yesNo(`m${m.id}`, `/api/float/movements/${m.id}/decide`)
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {d.reversals.length > 0 && (
          <Section title="Reversals">
            <ul className="divide-y divide-rule text-sm">
              {d.reversals.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="font-semibold">
                      {NETWORK[t.network]} {KIND[t.kind].toLowerCase()} {money(t.amount)} at {t.branch}
                    </span>
                    <span className="block text-muted">
                      “{t.reason}” · {t.requestedByName}
                    </span>
                  </span>
                  {t.requestedBy === d.me ? (
                    <Badge tone="neutral">Your request</Badge>
                  ) : (
                    yesNo(`r${t.id}`, `/api/float/transactions/${t.id}/reversal`)
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {d.variances.length > 0 && (
          <Section title="Surpluses and deficits">
            <ul className="divide-y divide-rule text-sm">
              {d.variances.map((v) => (
                <li key={v.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <span className={`font-semibold ${v.amount < 0 ? 'text-danger' : ''}`}>
                        {v.type === 'SURPLUS' ? 'Surplus' : 'Deficit'} {money(Math.abs(v.amount))}{' '}
                        {ACCOUNT[v.account]}
                      </span>{' '}
                      at {v.branch} · {formatDate(v.date)}
                      <span className="block text-muted">
                        {v.countKind === 'CLOSE' ? 'Day close' : 'Handover'} by{' '}
                        {v.employee ? `${v.employee.firstName} ${v.employee.lastName}` : '—'}
                        {v.status === 'PENDING_DIRECTOR' && ` · Write-off asked: “${v.comment}”`}
                      </span>
                    </span>
                    {v.status === 'PENDING_DIRECTOR'
                      ? yesNo(`v${v.id}`, `/api/float/variances/${v.id}/director`)
                      : resolving !== v.id && (
                          <Button size="sm" onClick={() => setResolving(v.id)}>
                            Resolve
                          </Button>
                        )}
                  </div>
                  {resolving === v.id && (
                    <ResolveForm
                      variance={v}
                      busy={busy === `v${v.id}`}
                      onCancel={() => setResolving(null)}
                      onSend={(body) => {
                        setResolving(null);
                        act(`v${v.id}`, `/api/float/variances/${v.id}/resolve`, body, 'Resolved.');
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {d.large.length > 0 && (
          <Section title="Large transactions to review">
            <ul className="divide-y divide-rule text-sm">
              {d.large.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="font-semibold">
                      {NETWORK[t.network]} {KIND[t.kind].toLowerCase()} {money(t.amount)} at {t.branch}
                    </span>
                    <span className="block text-muted">
                      {t.by} · {timeOf(t.at)}
                      {t.reference ? ` · Ref ${t.reference}` : ''}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={busy === `l${t.id}`}
                    onClick={() =>
                      act(`l${t.id}`, `/api/float/transactions/${t.id}/reviewed`, {}, 'Marked as reviewed.')
                    }
                  >
                    Reviewed
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function ResolveForm({ variance: v, busy, onSend, onCancel }) {
  const [resolution, setResolution] = useState('EXPLAINED');
  const [comment, setComment] = useState('');
  return (
    <div className="mt-3 space-y-3 rounded-md border border-rule p-3">
      <Field id={`res-${v.id}`} label="Outcome">
        <Select id={`res-${v.id}`} value={resolution} onChange={(e) => setResolution(e.target.value)}>
          <option value="EXPLAINED">Explained (an error was found)</option>
          {v.amount < 0 && <option value="RECOVERED">Recovered (the money was paid back)</option>}
          <option value="WRITTEN_OFF">Written off</option>
        </Select>
      </Field>
      <Field id={`resc-${v.id}`} label="What happened">
        <Input id={`resc-${v.id}`} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          busy={busy}
          disabled={!comment.trim()}
          onClick={() => onSend({ resolution, comment: comment.trim() })}
        >
          Save
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Surpluses and deficits: the record, per member of staff too. */
export function FloatVariancesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = useQuery({
    queryKey: ['float-variances', status],
    queryFn: () => api.get(`/api/float/variances${status ? `?status=${status}` : ''}`),
  });
  return (
    <div>
      <PageHeader
        title="Surplus and deficit"
        description="Differences found at day closes and handovers. Resolve them on AMS approvals."
      />
      <div className="mb-4 w-64">
        <Field id="vr-status" label="Status">
          <Select
            id="vr-status"
            value={status}
            onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
          >
            <option value="">All</option>
            {Object.entries(VARIANCE_STATUS).map(([k, [l]]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data && (
        <div className="stack">
          {q.data.byStaff.length > 0 && (
            <Section title="Deficits by member of staff">
              <Table title="Deficits by staff" tools={false}>
                <thead>
                  <tr>
                    <Th>First name</Th>
                    <Th>Last name</Th>
                    <Th className="text-right">Deficits</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.byStaff.map((s) => (
                    <tr key={s.id}>
                      <Td className="font-semibold">{s.firstName}</Td>
                      <Td className="font-semibold">{s.lastName}</Td>
                      <Td className="text-right">{s.count}</Td>
                      <Td className="text-right tabular-nums">{money(s.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}
          {q.data.items.length === 0 ? (
            <div className="card p-0">
              <EmptyState title="No surpluses or deficits." />
            </div>
          ) : (
            <Table title="Surplus and deficit">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Branch</Th>
                  <Th>Account</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>First name</Th>
                  <Th>Last name</Th>
                  <Th>Count</Th>
                  <Th>Status</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((v) => (
                  <tr key={v.id} data-date={v.date}>
                    <Td className="whitespace-nowrap">{formatDate(v.date)}</Td>
                    <Td>{v.branch}</Td>
                    <Td>{ACCOUNT[v.account]}</Td>
                    <Td>
                      <Badge tone={v.type === 'SURPLUS' ? 'pending' : 'danger'}>
                        {v.type === 'SURPLUS' ? 'Surplus' : 'Deficit'}
                      </Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{signed(v.amount)}</Td>
                    <Td>{v.employee?.firstName ?? '—'}</Td>
                    <Td>{v.employee?.lastName ?? ''}</Td>
                    <Td>{v.countKind === 'CLOSE' ? 'Day close' : 'Handover'}</Td>
                    <Td>
                      <Badge tone={VARIANCE_STATUS[v.status][1]}>{VARIANCE_STATUS[v.status][0]}</Badge>
                    </Td>
                    <Td>
                      {v.comment ?? '—'}
                      {v.resolvedBy && <span className="block text-xs text-muted">{v.resolvedBy}</span>}
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

/** All AMS transactions over a period, with Excel. */
export function FloatTransactionsPage() {
  const me = useFloat();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState('');
  const branches = useQuery({
    queryKey: ['float-branches'],
    queryFn: () => api.get('/api/float/branches'),
    enabled: Boolean(me.data?.rights.viewAll),
  });
  const qs = `from=${from}&to=${to}${branch ? `&branch=${branch}` : ''}`;
  const q = useQuery({
    queryKey: ['float-transactions', qs],
    queryFn: () => api.get(`/api/float/transactions?${qs}`),
  });
  const [error, setError] = useState(null);
  return (
    <div>
      <PageHeader
        title="AMS transactions"
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              downloadFile(`/api/float/transactions?${qs}&format=xlsx`).catch((e) => setError(e.message))
            }
          >
            Export to Excel
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field id="tx-from" label="From">
          <Input id="tx-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="tx-to" label="To">
          <Input id="tx-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {me.data?.rights.viewAll && (
          <div className="w-60">
            <Field id="tx-branch" label="Branch">
              <Select id="tx-branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">All branches</option>
                {(branches.data?.items ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No transactions in this period." />
          </div>
        ) : (
          <Table title="AMS transactions" tools={false}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Time</Th>
                <Th>Branch</Th>
                <Th>Network</Th>
                <Th>Type</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Commission</Th>
                <Th>Reference</Th>
                <Th>First name</Th>
                <Th>Last name</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((t) => (
                <tr key={t.id}>
                  <Td className="whitespace-nowrap">{formatDate(t.date)}</Td>
                  <Td>{timeOf(t.at)}</Td>
                  <Td>{t.branch}</Td>
                  <Td>{NETWORK[t.network]}</Td>
                  <Td>{KIND[t.kind]}</Td>
                  <Td className="text-right tabular-nums">{money(t.amount)}</Td>
                  <Td className="text-right tabular-nums">{money(t.commission)}</Td>
                  <Td>{t.reference ?? '—'}</Td>
                  <Td>{t.firstName}</Td>
                  <Td>{t.lastName}</Td>
                  <Td>
                    <Badge tone={TXN_STATUS[t.status][1]}>{TXN_STATUS[t.status][0]}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}
    </div>
  );
}
