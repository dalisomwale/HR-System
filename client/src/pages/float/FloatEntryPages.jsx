import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Delete, Repeat } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge,
  Button,
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
  Textarea,
  Th,
} from '../../components/ui.jsx';
import { errorText } from '../requisitions/rq.js';
import {
  ACCOUNT,
  DENOMINATIONS,
  KIND,
  NETWORK,
  TXN_STATUS,
  money,
  signed,
  timeOf,
  useFloat,
  useWorkingBranch,
} from './fl.js';

const QUICK = [50, 100, 200, 500, 1000];
const TURN_DOWN = [
  ['NO_FLOAT', 'No Float'],
  ['NO_CASH', 'No Cash'],
  ['NETWORK_DOWN', 'Network Down'],
  ['OTHER', 'Other'],
];

/** One tap to count a customer who could not be served, with why. */
function TurnedDown({ branchId }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const tap = async (reason) => {
    setBusy(reason);
    try {
      const r = await api.post('/api/float/turned-down', { reason, branchId });
      setMsg(`Recorded. ${r.today} turned down today.`);
    } catch (err) {
      setMsg(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="card">
      <p className="mb-2 text-sm font-semibold">Customer turned down?</p>
      <div className="flex flex-wrap gap-2">
        {TURN_DOWN.map(([k, l]) => (
          <Button key={k} variant="secondary" size="sm" busy={busy === k} onClick={() => tap(k)}>
            {l}
          </Button>
        ))}
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </div>
  );
}

/** For those who work across branches: which branch they are working on (D122). */
export function BranchPicker({ branches, value, onChange }) {
  if (!branches?.length) return null;
  return (
    <div className="mb-4 max-w-sm">
      <Field id="work-branch" label="Branch You Are Working On">
        <Select id="work-branch" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** Opening the store (D121): one tap clocks the time and the balances it opens with. */
function OpenStore({ data, onDone }) {
  // Filled in from the last closing (D123); anyone opening checks it and corrects what differs.
  const start =
    data.previousClose?.balances ?? Object.fromEntries(data.accounts.map((a) => [a.kind, a.balance]));
  const kinds = data.accounts.map((a) => a.kind);
  const [v, setV] = useState(() => Object.fromEntries(kinds.map((k) => [k, String(start[k] ?? 0)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/float/open', {
        branchId: data.branch.id,
        lines: Object.entries(v).map(([kind, x]) => ({ kind, counted: Number(x) || 0 })),
      });
      if (r.pending) {
        onDone(
          'Opening sent to the Operations Officer. You can start recording once they confirm it.',
          'pending',
        );
        return;
      }
      const off = r.results.filter((x) => x.difference !== 0);
      onDone(
        off.length
          ? `Store open. ${off
              .map(
                (x) =>
                  `${ACCOUNT[x.kind]} ${x.difference > 0 ? 'over' : 'short'} by ${money(Math.abs(x.difference))}`,
              )
              .join(
                ', ',
              )} compared with the last closing${off.some((x) => x.recorded) ? '; the Operations Officer has been told' : ''}.`
          : 'Store open. You can record transactions now.',
        off.some((x) => x.recorded) ? 'pending' : 'ok',
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const valid = Object.values(v).every((x) => x !== '' && Number(x) >= 0);
  return (
    <Section
      title="Open The Store"
      description={
        data.previousClose
          ? `Filled in from the closing on ${data.previousClose.date}. Count and correct anything that is different.`
          : 'Count what you are opening with.'
      }
      className="border-brand ring-1 ring-brand"
    >
      <div className="stack">
        <div className="form-row">
          {kinds.map((k) => (
            <Field
              key={k}
              id={`op-${k}`}
              label={`Opening ${k === 'CASH' ? 'cash' : `${ACCOUNT[k]} float`} (K)`}
            >
              <Input
                id={`op-${k}`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={v[k]}
                onChange={(e) => setV({ ...v, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button className="min-h-12 text-base" busy={busy} disabled={!valid} onClick={open}>
          Open Store
        </Button>
      </div>
    </Section>
  );
}

/** The branch's balances as a strip of cards. */
function Balances({ accounts }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {accounts.map((a) => (
        <div key={a.kind} className={`kpi ${a.low ? 'kpi-bad' : ''}`}>
          <div className="kpi-label">{a.label}</div>
          <div className={`kpi-value small ${a.low ? 'is-bad' : ''}`}>{money(a.balance)}</div>
          {(a.low || a.runsOutAt) && (
            <div className="kpi-note">
              {a.low ? `Below ${money(a.minBalance)}` : ''}
              {a.runsOutAt ? `${a.low ? ' · ' : ''}runs out about ${a.runsOutAt}` : ''}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Record a transaction (D117): tap the network, tap Deposit or Withdraw, type the amount on the
 * pad (or tap a quick amount), Save. Branch, date, time and who did it are filled in.
 */
export function FloatRecordPage() {
  const qc = useQueryClient();
  const me = useFloat();
  const [chosen, choose] = useWorkingBranch();
  const today = useQuery({
    queryKey: ['float-branch', chosen],
    queryFn: () => api.get(`/api/float/branch${chosen ? `?branch=${chosen}` : ''}`),
    enabled: Boolean(me.data),
    retry: false,
  });
  const [network, setNetwork] = useState(null);
  const [kind, setKind] = useState(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dup, setDup] = useState(false);
  const [last, setLast] = useState(null);

  if (me.isPending) return <Loading />;
  if (me.isError) return <LoadError error={me.error} onRetry={me.refetch} />;
  if (today.isPending) return <Loading />;
  if (today.isError) {
    return (
      <Notice tone="pending" title="No AMS Branch To Work On">
        {today.error.message}
      </Notice>
    );
  }
  const branch = today.data.branch;
  const picker = <BranchPicker branches={today.data.branches} value={branch.id} onChange={choose} />;
  if (today.data && !today.data.opened) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Record A Transaction" description={branch.name} />
        {picker}
        <OpenStore
          data={today.data}
          onDone={(text, tone = 'ok') => {
            setMsg({ tone, text });
            qc.invalidateQueries({ queryKey: ['float-branch'] });
          }}
        />
      </div>
    );
  }
  if (today.data.opened?.pending) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Record A Transaction" description={branch.name} />
        {picker}
        {msg && (
          <div className="mb-4">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        )}
        <Notice tone="pending" title="Waiting For The Operations Officer">
          Your opening figures have been sent. You can record transactions once the Operations Officer
          confirms them.
        </Notice>
      </div>
    );
  }
  if (today.data?.closed) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Record A Transaction" description={branch.name} />
        {picker}
        <Notice tone="neutral" title="The Store Is Closed For Today">
          The day's transactions are closed and the daily report has been sent. Open the store again on the
          next working day.
        </Notice>
      </div>
    );
  }
  const press = (k) =>
    setAmount((a) => {
      if (k === 'back') return a.slice(0, -1);
      if (k === '.' && a.includes('.')) return a;
      if (a.includes('.') && a.split('.')[1].length >= 2) return a;
      const next = a === '0' && k !== '.' ? k : a + k;
      return next.length > 10 ? a : next;
    });
  const save = async (confirm = false, override = null) => {
    const body = override ?? {
      network: net,
      kind,
      amount: Number(amount),
      reference: reference.trim() || null,
    };
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/api/float/transactions', { ...body, confirm, branchId: branch.id });
      setMsg({
        tone: 'ok',
        text: `${NETWORK[body.network]} ${KIND[body.kind].toLowerCase()} of ${money(body.amount)} recorded.`,
      });
      setLast(body);
      setAmount('');
      setReference('');
      setDup(false);
      qc.invalidateQueries({ queryKey: ['float-branch'] });
    } catch (err) {
      if (err.code === 'POSSIBLE_DUPLICATE') {
        setDup(body);
      } else {
        setMsg({ tone: 'danger', text: errorText(err) });
      }
    } finally {
      setBusy(false);
    }
  };
  // A branch with one network has it chosen already (D125).
  const usable = today.data.networks ?? ['AIRTEL', 'MTN'];
  const net = usable.length === 1 ? usable[0] : network;
  const ready = net && kind && Number(amount) > 0;
  const big = 'min-h-14 rounded-md border-2 px-3 py-3 text-base font-semibold transition-colors';
  const pick = (on) =>
    on
      ? `${big} border-brand bg-brand text-white`
      : `${big} border-rule bg-white text-ink hover:border-brand`;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Record A Transaction" description={branch.name} />
      {picker}
      <div className="stack">
        {today.data && <Balances accounts={today.data.accounts} />}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="card stack">
          <div>
            <p className="mb-2 text-sm font-semibold">1. Network</p>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(NETWORK)
                .filter(([k]) => today.data.networks?.includes(k) ?? true)
                .map(([k, l]) => (
                  <button key={k} type="button" className={pick(net === k)} onClick={() => setNetwork(k)}>
                    {l}
                  </button>
                ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">2. Type</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className={pick(kind === 'DEPOSIT')} onClick={() => setKind('DEPOSIT')}>
                Deposit
                <span className="block text-xs font-normal opacity-80">Customer gives cash</span>
              </button>
              <button
                type="button"
                className={pick(kind === 'WITHDRAWAL')}
                onClick={() => setKind('WITHDRAWAL')}
              >
                Withdraw
                <span className="block text-xs font-normal opacity-80">Customer takes cash</span>
              </button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">3. Amount</p>
            <div className="mb-3 rounded-md border border-rule bg-canvas px-4 py-3 text-right font-mono text-3xl tabular-nums">
              K{amount || '0'}
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <button key={q} type="button" className="btn btn-sm" onClick={() => setAmount(String(q))}>
                  K{q.toLocaleString('en-GB')}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className="min-h-12 rounded-md border border-rule bg-white text-xl font-semibold hover:bg-hover"
                  onClick={() => press(k)}
                  aria-label={k === 'back' ? 'Delete last digit' : k}
                >
                  {k === 'back' ? <Delete className="mx-auto size-5" aria-hidden /> : k}
                </button>
              ))}
            </div>
          </div>
          <Field
            id="fl-ref"
            label="Reference"
            optional
            hint="The transaction ID from the phone, if you have it."
          >
            <Input id="fl-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-12 flex-1 text-base"
              busy={busy}
              disabled={!ready}
              onClick={() => save()}
            >
              Save {ready ? `${KIND[kind].toLowerCase()} ${money(amount)}` : ''}
            </Button>
            {last && (
              <Button variant="secondary" className="min-h-12" busy={busy} onClick={() => save(false, last)}>
                <Repeat aria-hidden /> Repeat Last
              </Button>
            )}
          </div>
        </div>
        <TurnedDown branchId={branch.id} />
        <p className="text-sm">
          <Link to="/float/branch" className="text-brand hover:underline">
            Today at the branch: transactions, cash to finance, hand over, close the store
          </Link>
        </p>
      </div>
      <ConfirmDialog
        open={Boolean(dup)}
        title="Same transaction again?"
        confirmLabel="Record It Again"
        busy={busy}
        onConfirm={() => save(true, dup)}
        onCancel={() => setDup(false)}
      >
        A {dup && NETWORK[dup.network]} {dup && KIND[dup.kind].toLowerCase()} of {dup && money(dup.amount)}{' '}
        was recorded a moment ago. Record another one?
      </ConfirmDialog>
    </div>
  );
}

/** A branch today: balances, transactions, day close and handover, top-up requests. */
export function FloatBranchPage() {
  const [params, setParams] = useSearchParams();
  const [chosen, choose] = useWorkingBranch();
  const branchParam = params.get('branch') ?? chosen ?? '';
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['float-branch', branchParam],
    queryFn: () => api.get(`/api/float/branch${branchParam ? `?branch=${branchParam}` : ''}`),
  });
  const pick = (v) => {
    choose(v);
    setParams(v ? { branch: v } : {});
  };
  const [panel, setPanel] = useState(null); // 'CLOSE' | 'HANDOVER' | 'TOPUP'
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const refresh = (text, tone = 'ok') => {
    setMsg(text ? { tone, text } : null);
    setPanel(null);
    qc.invalidateQueries({ queryKey: ['float-branch'] });
    qc.invalidateQueries({ queryKey: ['float-me'] });
  };
  const reverse = async () => {
    setBusy(true);
    try {
      await api.post(`/api/float/transactions/${reversing.id}/reverse`, { reason });
      setReversing(null);
      setReason('');
      refresh('Reversal asked for. A manager will approve it.');
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader
        title={d.branch.name}
        description={`Business day ${d.date} · ${d.tradingToday ? `hours ${d.hours.opensAt}–${d.hours.closesAt}` : 'not a trading day'}${d.opened ? ` · opened ${timeOf(d.opened.at)} by ${d.opened.by}` : ' · not opened yet'}${d.closed ? ' · closed' : ''}`}
        actions={
          d.canRecord &&
          d.opened &&
          !d.opened.pending &&
          !d.closed && (
            <>
              <Link
                to="/float/record"
                className="btn btn-primary"
                onClick={() => choose(String(d.branch.id))}
              >
                Record a transaction
              </Link>
              <Button variant="secondary" onClick={() => setPanel('COLLECT')}>
                Cash To Finance
              </Button>
              <Button variant="secondary" onClick={() => setPanel('HANDOVER')}>
                Hand Over
              </Button>
              <Link to="/float/requisitions" className="btn">
                Raise a requisition
              </Link>
              <Button onClick={() => setPanel('CLOSE')}>Close Store</Button>
            </>
          )
        }
      />
      <BranchPicker branches={d.branches} value={d.branch.id} onChange={pick} />
      <div className="stack">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {d.canRecord && !d.opened && !d.closed && <OpenStore data={d} onDone={refresh} />}
        {d.opened?.pending && (
          <Notice tone="pending" title="Opening Waiting For The Operations Officer">
            Recording starts once the Operations Officer confirms the opening figures.
          </Notice>
        )}
        {d.closed &&
          (d.closePending ? (
            <Notice tone="pending" title="Closing Waiting For The Operations Officer">
              The day's transactions are closed. The daily report goes out once the Operations Officer
              confirms the closing figures.
            </Notice>
          ) : (
            <Notice tone="neutral" title="Store Closed">
              The day's transactions are closed and the daily report has gone to the Operations Officer, the
              managers, the directors and the System Admin.
            </Notice>
          ))}
        <Balances accounts={d.accounts} />
        {(panel === 'CLOSE' || panel === 'HANDOVER') && (
          <CountForm data={d} kind={panel} onDone={refresh} onCancel={() => setPanel(null)} />
        )}
        {panel === 'COLLECT' && (
          <CollectionForm branchId={d.branch.id} onDone={refresh} onCancel={() => setPanel(null)} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {d.totals.map((t) => (
            <div key={t.network} className="card">
              <p className="font-semibold">{NETWORK[t.network]} today</p>
              <p className="mt-1 text-sm text-muted">
                {t.count} transactions · Deposits {money(t.deposits)} · Withdrawals {money(t.withdrawals)}
              </p>
            </div>
          ))}
        </div>
        {d.movements.length > 0 && (
          <Section title="Top-ups And Transfers">
            <ul className="divide-y divide-rule text-sm">
              {d.movements.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {{ TOPUP: 'Top-up', TRANSFER: 'Transfer', COLLECTION: 'Cash To Finance' }[m.kind]} ·{' '}
                    {ACCOUNT[m.toAccount]} {money(m.amount)}
                    {m.reason && <span className="block text-xs text-muted">{m.reason}</span>}
                  </span>
                  <Badge
                    tone={
                      { PENDING: 'pending', APPROVED: 'ok', REJECTED: 'danger', CANCELLED: 'neutral' }[
                        m.status
                      ]
                    }
                  >
                    {
                      {
                        PENDING: 'Waiting For A Manager',
                        APPROVED: 'Approved',
                        REJECTED: 'Not Approved',
                        CANCELLED: 'Cancelled',
                      }[m.status]
                    }
                  </Badge>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {d.transactions.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No transactions yet today." />
          </div>
        ) : (
          <Table title={`${d.branch.name} ${d.date}`}>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Network</Th>
                <Th>Type</Th>
                <Th className="text-right">Amount</Th>
                <Th>Reference</Th>
                <Th>Recorded By</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Action</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {d.transactions.map((t) => (
                <tr key={t.id} className={t.status === 'REVERSED' ? 'text-muted line-through' : ''}>
                  <Td className="whitespace-nowrap">{timeOf(t.at)}</Td>
                  <Td>{NETWORK[t.network]}</Td>
                  <Td>{KIND[t.kind]}</Td>
                  <Td className="text-right tabular-nums">{money(t.amount)}</Td>
                  <Td>{t.reference ?? '—'}</Td>
                  <Td>{t.by}</Td>
                  <Td>
                    <Badge tone={TXN_STATUS[t.status][1]}>{TXN_STATUS[t.status][0]}</Badge>
                    {t.isLarge && (
                      <span className="ml-1">
                        <Badge tone="brand">Large</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    {d.canRecord && t.status === 'POSTED' && (
                      <Button size="sm" variant="ghost" onClick={() => setReversing(t)}>
                        Reverse
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {d.counts.length > 0 && (
          <Section title="Counts Today">
            <ul className="text-sm">
              {d.counts.map((c) => (
                <li key={c.id}>
                  {{ OPEN: 'Store Opened', CLOSE: 'Store Closed' }[c.kind] ?? `Handover to ${c.handedTo}`} by{' '}
                  {c.by} at {timeOf(c.at)}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(reversing)}
        title="Reverse This Transaction"
        confirmLabel="Ask To Reverse"
        busy={busy}
        onConfirm={reverse}
        onCancel={() => setReversing(null)}
      >
        <p className="mb-3">
          {reversing &&
            `${NETWORK[reversing.network]} ${KIND[reversing.kind].toLowerCase()} of ${money(reversing.amount)}.`}{' '}
          A manager approves it, then the balances are put back.
        </p>
        <Field id="rev-reason" label="Why">
          <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/** Count at close or handover: cash by notes and coins, and the balances on the phones. */
function CountForm({ data, kind, onDone, onCancel }) {
  const [notes, setNotes] = useState({});
  const [phones, setPhones] = useState({ AIRTEL: '', MTN: '' });
  const [handedTo, setHandedTo] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [report, setReport] = useState(null);
  const [commission, setCommission] = useState('');
  const [byNotes, setByNotes] = useState(false);
  const [cashTyped, setCashTyped] = useState('');
  const noteTotal =
    Math.round(DENOMINATIONS.reduce((s, dn) => s + dn * (Number(notes[dn]) || 0), 0) * 100) / 100;
  const cash = byNotes ? noteTotal : Number(cashTyped) || 0;
  const expected = Object.fromEntries(data.accounts.map((a) => [a.kind, a.balance]));
  const lines = [
    { kind: 'CASH', counted: cash },
    ...(data.networks ?? ['AIRTEL', 'MTN'])
      .filter((k) => phones[k] !== '')
      .map((k) => ({ kind: k, counted: Number(phones[k]) })),
  ];
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/float/counts', {
        branchId: data.branch.id,
        kind,
        handedTo: kind === 'HANDOVER' ? Number(handedTo) : null,
        lines,
        denominations: byNotes
          ? Object.fromEntries(Object.entries(notes).filter(([, v]) => Number(v) > 0))
          : null,
        notes: comment.trim() || null,
        commission: kind === 'CLOSE' && commission !== '' ? Number(commission) : null,
      });
      setResult(r.results);
      setReport(r.report);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (result && result.length === 0 && kind === 'CLOSE') {
    return (
      <Section title="Store Closed" className="border-brand ring-1 ring-brand">
        <Notice tone="pending" title="Sent To The Operations Officer">
          The day's transactions are closed. Your closing figures have gone to the Operations Officer; the
          daily report goes out once they confirm them.
        </Notice>
        <div className="mt-3">
          <Button onClick={() => onDone(null)}>Done</Button>
        </div>
      </Section>
    );
  }
  if (result) {
    const off = result.filter((r) => r.recorded);
    return (
      <Section
        title={kind === 'CLOSE' ? 'Store Closed' : 'Handed Over'}
        className="border-brand ring-1 ring-brand"
      >
        <ul className="mb-3 space-y-1 text-sm">
          {result.map((r) => (
            <li key={r.kind}>
              {ACCOUNT[r.kind]}: counted {money(r.counted)}, expected {money(r.expected)}{' '}
              {r.difference === 0 ? (
                <Badge tone="ok">Balanced</Badge>
              ) : (
                <Badge tone={r.recorded ? (r.difference > 0 ? 'pending' : 'danger') : 'neutral'}>
                  {r.difference > 0 ? 'Surplus' : 'Deficit'} {signed(r.difference)}
                  {r.recorded ? '' : ' (Within Tolerance)'}
                </Badge>
              )}
            </li>
          ))}
        </ul>
        <p className="mb-3 text-sm text-muted">
          {off.length ? 'The Operations Officer has been told about the difference.' : 'Everything balanced.'}{' '}
          The balances now match what you counted.
        </p>
        {report && (
          <Notice tone="ok" title="Store Closed And The Daily Report Sent">
            Opened {report.openedAt ? timeOf(report.openedAt) : '—'}, closed {timeOf(report.signedOutAt)}.
            Deposits {report.deposits.count} ({money(report.deposits.amount)}), withdrawals{' '}
            {report.withdrawals.count} ({money(report.withdrawals.amount)}). Closing cash {money(report.cash)}
            , float {money(report.float)}.
          </Notice>
        )}
        <div className="mt-3">
          <Button onClick={() => onDone(null)}>Done</Button>
        </div>
      </Section>
    );
  }
  return (
    <Section
      title={kind === 'CLOSE' ? 'Close The Store' : 'Hand Over'}
      className="border-brand ring-1 ring-brand"
    >
      <div className="stack">
        {kind === 'HANDOVER' && (
          <Field id="ho-to" label="Handing Over To">
            <Select id="ho-to" value={handedTo} onChange={(e) => setHandedTo(e.target.value)}>
              <option value="">Choose</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div>
          <div className="flex flex-wrap items-end gap-3">
            <Field
              id="ct-cash"
              label={`${kind === 'CLOSE' ? 'Closing cash' : 'Cash'} (K)`}
              hint={`The books say ${money(expected.CASH ?? 0)}.`}
            >
              <Input
                id="ct-cash"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                disabled={byNotes}
                value={byNotes ? String(noteTotal) : cashTyped}
                onChange={(e) => setCashTyped(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-brand"
                checked={byNotes}
                onChange={(e) => setByNotes(e.target.checked)}
              />
              Count It Note By Note
            </label>
          </div>
          {byNotes && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DENOMINATIONS.map((dn) => (
                <Field key={dn} id={`dn-${dn}`} label={dn < 1 ? '50n' : `K${dn}`}>
                  <Input
                    id={`dn-${dn}`}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={notes[dn] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [dn]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          )}
        </div>
        <div className="form-row">
          {(data.networks ?? ['AIRTEL', 'MTN']).map((k) => (
            <Field
              key={k}
              id={`ph-${k}`}
              label={`${kind === 'CLOSE' ? 'Closing ' : ''}${ACCOUNT[k]} Float On The Phone (K)`}
              hint={`The books say ${money(expected[k] ?? 0)}.`}
            >
              <Input
                id={`ph-${k}`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={phones[k]}
                onChange={(e) => setPhones({ ...phones, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        {kind === 'CLOSE' && (
          <Field id="ct-comm" label="Today's Commission (K)" optional hint="As shown on the phones.">
            <Input
              id="ct-comm"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
          </Field>
        )}
        <Field id="ct-notes" label="Notes" optional>
          <Textarea id="ct-notes" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button busy={busy} disabled={kind === 'HANDOVER' && !handedTo} onClick={send}>
            {kind === 'CLOSE' ? 'Close Store And Send The Report' : 'Hand Over'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Section>
  );
}

function CollectionForm({ branchId, onDone, onCancel }) {
  const [amount, setAmount] = useState('');
  const [by, setBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/float/collections', {
        amount: Number(amount),
        collectedBy: by.trim() || null,
        branchId,
      });
      onDone('Cash to finance recorded. A manager confirms finance received it.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Cash Retired To Finance" className="border-brand ring-1 ring-brand">
      <div className="stack">
        <div className="form-row">
          <Field id="cc-amount" label="Amount (K)">
            <Input
              id="cc-amount"
              type="number"
              min={1}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field id="cc-by" label="Collected By" optional>
            <Input id="cc-by" value={by} onChange={(e) => setBy(e.target.value)} />
          </Field>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button busy={busy} disabled={!(Number(amount) > 0)} onClick={send}>
            Record Cash To Finance
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Section>
  );
}
