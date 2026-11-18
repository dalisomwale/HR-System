import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Delete, Repeat } from 'lucide-react';
import { api } from '../../../lib/api.js';
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
} from '../../../components/ui.jsx';
import { errorText } from '../rq.js';
import { ACCOUNT, DENOMINATIONS, KIND, NETWORK, TXN_STATUS, money, signed, timeOf, useFloat } from './fl.js';

const QUICK = [50, 100, 200, 500, 1000];

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
  const today = useQuery({
    queryKey: ['float-branch', ''],
    queryFn: () => api.get('/api/float/branch'),
    enabled: Boolean(me.data?.branch),
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
  if (!me.data.branch) {
    return (
      <Notice tone="pending" title="No AMS branch on your record">
        Ask HR to set your branch on your employee record in Employee management. Then you can record here.
      </Notice>
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
    const body = override ?? { network, kind, amount: Number(amount), reference: reference.trim() || null };
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/api/float/transactions', { ...body, confirm });
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
  const ready = network && kind && Number(amount) > 0;
  const big = 'min-h-14 rounded-md border-2 px-3 py-3 text-base font-semibold transition-colors';
  const pick = (on) =>
    on
      ? `${big} border-brand bg-brand text-white`
      : `${big} border-rule bg-white text-ink hover:border-brand`;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Record a transaction" description={me.data.branch.name} />
      <div className="stack">
        {today.data && <Balances accounts={today.data.accounts} />}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="card stack">
          <div>
            <p className="mb-2 text-sm font-semibold">1. Network</p>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(NETWORK).map(([k, l]) => (
                <button key={k} type="button" className={pick(network === k)} onClick={() => setNetwork(k)}>
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
                <Repeat aria-hidden /> Repeat last
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm">
          <Link to="/requisitions/float/branch" className="text-brand hover:underline">
            Today at the branch: transactions, close the day, ask for a top-up
          </Link>
        </p>
      </div>
      <ConfirmDialog
        open={Boolean(dup)}
        title="Same transaction again?"
        confirmLabel="Record it again"
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
  const [params] = useSearchParams();
  const branchParam = params.get('branch') ?? '';
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['float-branch', branchParam],
    queryFn: () => api.get(`/api/float/branch${branchParam ? `?branch=${branchParam}` : ''}`),
  });
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
        description={`Business day ${d.date}${d.closed ? ' · Day closed' : ''}`}
        actions={
          d.canRecord && (
            <>
              <Link to="/requisitions/float/record" className="btn btn-primary">
                Record a transaction
              </Link>
              <Button variant="secondary" onClick={() => setPanel('TOPUP')}>
                Ask for a top-up
              </Button>
              <Button variant="secondary" onClick={() => setPanel('HANDOVER')}>
                Hand over
              </Button>
              <Button variant={d.closed ? 'secondary' : 'primary'} onClick={() => setPanel('CLOSE')}>
                {d.closed ? 'Count again' : 'Close the day'}
              </Button>
            </>
          )
        }
      />
      <div className="stack">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Balances accounts={d.accounts} />
        {(panel === 'CLOSE' || panel === 'HANDOVER') && (
          <CountForm data={d} kind={panel} onDone={refresh} onCancel={() => setPanel(null)} />
        )}
        {panel === 'TOPUP' && <TopUpForm onDone={refresh} onCancel={() => setPanel(null)} />}
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
          <Section title="Top-ups and transfers">
            <ul className="divide-y divide-rule text-sm">
              {d.movements.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {m.kind === 'TOPUP' ? 'Top-up' : 'Transfer'} · {ACCOUNT[m.toAccount]} {money(m.amount)}
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
                        PENDING: 'Waiting for a manager',
                        APPROVED: 'Approved',
                        REJECTED: 'Not approved',
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
                <Th>Recorded by</Th>
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
          <Section title="Counts today">
            <ul className="text-sm">
              {d.counts.map((c) => (
                <li key={c.id}>
                  {c.kind === 'CLOSE' ? 'Day close' : `Handover to ${c.handedTo}`} by {c.by} at {timeOf(c.at)}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(reversing)}
        title="Reverse this transaction"
        confirmLabel="Ask to reverse"
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
  const cash = Math.round(DENOMINATIONS.reduce((s, dn) => s + dn * (Number(notes[dn]) || 0), 0) * 100) / 100;
  const expected = Object.fromEntries(data.accounts.map((a) => [a.kind, a.balance]));
  const lines = [
    { kind: 'CASH', counted: cash },
    ...['AIRTEL', 'MTN']
      .filter((k) => phones[k] !== '')
      .map((k) => ({ kind: k, counted: Number(phones[k]) })),
  ];
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/float/counts', {
        kind,
        handedTo: kind === 'HANDOVER' ? Number(handedTo) : null,
        lines,
        denominations: Object.fromEntries(Object.entries(notes).filter(([, v]) => Number(v) > 0)),
        notes: comment.trim() || null,
      });
      setResult(r.results);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (result) {
    const off = result.filter((r) => r.recorded);
    return (
      <Section
        title={kind === 'CLOSE' ? 'Day closed' : 'Handed over'}
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
                  {r.recorded ? '' : ' (within tolerance)'}
                </Badge>
              )}
            </li>
          ))}
        </ul>
        <p className="mb-3 text-sm text-muted">
          {off.length ? 'The manager has been told about the difference.' : 'Everything balanced.'} The
          balances now match what you counted.
        </p>
        <Button onClick={() => onDone(null)}>Done</Button>
      </Section>
    );
  }
  return (
    <Section
      title={kind === 'CLOSE' ? 'Close the day' : 'Hand over'}
      className="border-brand ring-1 ring-brand"
    >
      <div className="stack">
        {kind === 'HANDOVER' && (
          <Field id="ho-to" label="Handing over to">
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
          <p className="mb-2 text-sm font-semibold">Cash: how many of each</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
          <p className="mt-2 text-sm">
            Cash counted: <span className="font-semibold">{money(cash)}</span>{' '}
            <span className="text-muted">(the books say {money(expected.CASH ?? 0)})</span>
          </p>
        </div>
        <div className="form-row">
          {['AIRTEL', 'MTN'].map((k) => (
            <Field
              key={k}
              id={`ph-${k}`}
              label={`${ACCOUNT[k]} balance on the phone`}
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
        <Field id="ct-notes" label="Notes" optional>
          <Textarea id="ct-notes" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button busy={busy} disabled={kind === 'HANDOVER' && !handedTo} onClick={send}>
            {kind === 'CLOSE' ? 'Close the day' : 'Hand over'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Section>
  );
}

function TopUpForm({ onDone, onCancel }) {
  const [account, setAccount] = useState('AIRTEL');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/float/movements', {
        kind: 'TOPUP',
        toAccount: account,
        amount: Number(amount),
        reason: reason.trim() || null,
      });
      onDone('Top-up asked for. A manager will approve it.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Ask for a top-up" className="border-brand ring-1 ring-brand">
      <div className="stack">
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(ACCOUNT).map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={`min-h-12 rounded-md border-2 font-semibold ${account === k ? 'border-brand bg-brand text-white' : 'border-rule bg-white'}`}
              onClick={() => setAccount(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <Field id="tu-amount" label="Amount (K)">
          <Input
            id="tu-amount"
            type="number"
            min={1}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field id="tu-reason" label="Reason" optional>
          <Input id="tu-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button busy={busy} disabled={!(Number(amount) > 0)} onClick={send}>
            Send to the manager
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Section>
  );
}
