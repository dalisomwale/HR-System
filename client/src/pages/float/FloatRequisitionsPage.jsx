import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '../../components/ui.jsx';
import { errorText } from '../requisitions/rq.js';
import { ACCOUNT, money, useWorkingBranch } from './fl.js';

/*
 * AMS requisitions (D121): a dead or faulty device, or cash or float run out. Branch staff raise
 * them with the reason; the Operations Officer, then the manager, then a director approve. Cash
 * or float is added when the branch confirms it arrived; a device one is marked done.
 */

const STATUS = {
  PENDING_SUPERVISOR: ['With the Operations Officer', 'pending'],
  PENDING_MANAGER: ['With the manager', 'pending'],
  PENDING_DIRECTOR: ['With a director', 'pending'],
  APPROVED: ['Approved', 'ok'],
  RECEIVED: ['Received', 'ok'],
  DONE: ['Done', 'ok'],
  REJECTED: ['Turned down', 'danger'],
  CANCELLED: ['Cancelled', 'neutral'],
};
const KINDS = [
  ['FLOAT', 'Float run out'],
  ['CASH', 'Cash run out'],
  ['DEVICE', 'Device dead or faulty'],
];

export default function FloatRequisitionsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['float-requisitions', status],
    queryFn: () => api.get(`/api/float/requisitions${status ? `?status=${status}` : ''}`),
  });
  const [raising, setRaising] = useState(false);
  const [msg, setMsg] = useState(null);
  const refresh = (text, tone = 'ok') => {
    if (text) setMsg({ tone, text });
    qc.invalidateQueries({ queryKey: ['float-requisitions'] });
    qc.invalidateQueries({ queryKey: ['float-me'] });
    qc.invalidateQueries({ queryKey: ['float-branch'] });
  };
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="AMS requisitions"
        description="When a device dies or is faulty, or cash or float runs out. Approved by the Operations Officer, then the manager, then a director."
        actions={
          d.canRaise && !raising && <Button onClick={() => setRaising(true)}>Raise a requisition</Button>
        }
      />
      <div className="stack">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {raising && (
          <RaiseForm
            branch={d.branch}
            branches={d.branches}
            onCancel={() => setRaising(false)}
            onDone={(text) => {
              setRaising(false);
              refresh(text);
            }}
          />
        )}
        <div className="w-64">
          <Field id="frq-status" label="Status">
            <Select id="frq-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {Object.entries(STATUS).map(([k, [l]]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {d.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No requisitions." />
          </div>
        ) : (
          d.items.map((r) => <RequisitionCard key={r.id} r={r} onDone={refresh} />)
        )}
      </div>
    </div>
  );
}

function RaiseForm({ branch, branches, onDone, onCancel }) {
  const [chosen, choose] = useWorkingBranch();
  const [v, setV] = useState({ kind: 'FLOAT', account: 'AIRTEL', amount: '', device: '', reason: '' });
  const branchId = branches ? Number(chosen) || branch?.id || branches[0]?.id : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/float/requisitions', {
        kind: v.kind,
        account: v.kind === 'FLOAT' ? v.account : null,
        amount: v.kind === 'DEVICE' ? null : Number(v.amount),
        device: v.kind === 'DEVICE' ? v.device : null,
        reason: v.reason,
        branchId,
      });
      onDone('Requisition sent to the Operations Officer.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const ready = v.reason.trim() && (v.kind === 'DEVICE' ? v.device.trim() : Number(v.amount) > 0);
  return (
    <Section
      title={`Raise a requisition${branch ? ` · ${branch.name}` : ''}`}
      className="border-brand ring-1 ring-brand"
    >
      <div className="stack">
        {branches && (
          <Field id="rq-branch" label="For branch">
            <Select id="rq-branch" value={String(branchId ?? '')} onChange={(e) => choose(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-3 gap-2">
          {KINDS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={`min-h-12 rounded-md border-2 px-2 font-semibold ${v.kind === k ? 'border-brand bg-brand text-white' : 'border-rule bg-white'}`}
              onClick={() => setV({ ...v, kind: k })}
            >
              {l}
            </button>
          ))}
        </div>
        {v.kind === 'FLOAT' && (
          <div className="grid grid-cols-2 gap-2">
            {['AIRTEL', 'MTN'].map((k) => (
              <button
                key={k}
                type="button"
                className={`min-h-11 rounded-md border-2 font-semibold ${v.account === k ? 'border-brand bg-brand-soft text-brand' : 'border-rule bg-white'}`}
                onClick={() => setV({ ...v, account: k })}
              >
                {ACCOUNT[k]}
              </button>
            ))}
          </div>
        )}
        {v.kind === 'DEVICE' ? (
          <Field id="rq-dev" label="Which device">
            <Input
              id="rq-dev"
              placeholder="e.g. Airtel agent phone"
              value={v.device}
              onChange={(e) => setV({ ...v, device: e.target.value })}
            />
          </Field>
        ) : (
          <Field id="rq-amt" label="Amount needed (K)">
            <Input
              id="rq-amt"
              type="number"
              min={1}
              inputMode="decimal"
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
            />
          </Field>
        )}
        <Field id="rq-why" label="Reason">
          <Textarea
            id="rq-why"
            rows={3}
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.target.value })}
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button busy={busy} disabled={!ready} onClick={send}>
            Send to the Operations Officer
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Section>
  );
}

function RequisitionCard({ r, onDone }) {
  const [comment, setComment] = useState('');
  const [got, setGot] = useState(r.amount ? String(r.amount) : '');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const act = async (key, path, body, text) => {
    setBusy(key);
    setError(null);
    try {
      await api.post(`/api/float/requisitions/${r.id}/${path}`, body);
      onDone(text);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const [label, tone] = STATUS[r.status];
  const what =
    r.kind === 'DEVICE' ? r.device : `${money(r.amount)}${r.account ? ` ${ACCOUNT[r.account]}` : ''}`;
  const yourTurn = r.can.decide || r.can.receive || r.can.done;
  return (
    <Section
      title={`${r.reference} · ${r.kindLabel}`}
      description={`${r.branch} · raised by ${r.raisedBy.firstName} ${r.raisedBy.lastName}, ${formatDateTime(r.raisedAt)}`}
      actions={<Badge tone={yourTurn ? 'pending' : tone}>{yourTurn ? 'Your turn' : label}</Badge>}
      className={yourTurn ? 'border-brand ring-1 ring-brand' : undefined}
    >
      <div className="stack text-sm">
        <p>
          <span className="font-semibold">{what}</span> · {r.reason}
        </p>
        <ol className="grid gap-2 sm:grid-cols-3">
          {r.steps.map((s) => (
            <li key={s.label} className="rounded-md border border-rule p-2">
              <p className="font-semibold">{s.label}</p>
              {s.done ? (
                <p className="text-muted">
                  {s.done.by} · {formatDateTime(s.done.at)}
                  {s.done.comment && <span className="block text-ink-2">“{s.done.comment}”</span>}
                </p>
              ) : (
                <p className="text-muted">Not yet</p>
              )}
            </li>
          ))}
        </ol>
        {r.receivedAmount != null && <p>Received {money(r.receivedAmount)}.</p>}
        {r.can.decide && (
          <div className="space-y-2">
            <Field id={`rqc-${r.id}`} label="Comment" hint="Required to turn it down.">
              <Input id={`rqc-${r.id}`} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button
                busy={busy === 'y'}
                onClick={() =>
                  act('y', 'decide', { approve: true, comment: comment.trim() || null }, 'Approved.')
                }
              >
                Approve
              </Button>
              <Button
                variant="danger"
                busy={busy === 'n'}
                onClick={() =>
                  act('n', 'decide', { approve: false, comment: comment.trim() || null }, 'Turned down.')
                }
              >
                Turn down
              </Button>
            </div>
          </div>
        )}
        {r.can.receive && (
          <div className="flex flex-wrap items-end gap-2">
            <Field id={`rqr-${r.id}`} label="Amount that arrived (K)">
              <Input
                id={`rqr-${r.id}`}
                type="number"
                min={1}
                value={got}
                onChange={(e) => setGot(e.target.value)}
              />
            </Field>
            <Button
              busy={busy === 'r'}
              disabled={!(Number(got) > 0)}
              onClick={() =>
                act('r', 'received', { amount: Number(got) }, 'Received: the balance has been updated.')
              }
            >
              It has arrived
            </Button>
          </div>
        )}
        {r.can.done && (
          <Button busy={busy === 'd'} onClick={() => act('d', 'done', {}, 'Marked done.')}>
            Device sorted: mark done
          </Button>
        )}
        {r.can.cancel && (
          <Button variant="ghost" busy={busy === 'c'} onClick={() => act('c', 'cancel', {}, 'Cancelled.')}>
            Cancel requisition
          </Button>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Section>
  );
}
