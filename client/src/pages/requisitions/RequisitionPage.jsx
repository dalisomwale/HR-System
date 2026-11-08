import { useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  ButtonLink,
  ConfirmDialog,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  Section,
  Textarea,
} from '../../components/ui.jsx';
import { STATUS_TONES, STEPS, fileSize, kwacha, lusakaDate, stepOf, units } from './rq.js';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';

/** One requisition: where it is, its quotations and payment, the next action and its history. */
export default function RequisitionPage() {
  const { id } = useParams();
  const { state } = useLocation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['requisition', id], queryFn: () => api.get(`/api/requisitions/${id}`) });
  const [flash, setFlash] = useState(
    state?.raised
      ? {
          tone: state.failed?.length ? 'pending' : 'ok',
          text: `${state.raised} raised. ${state.isIt ? 'It is now with IT for quotations.' : 'Attach the quotations below, then send it to the Director.'}${state.failed?.length ? ` These files could not be attached: ${state.failed.join('; ')}` : ''}`,
        }
      : null,
  );
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['requisition', id] });
    qc.invalidateQueries({ queryKey: ['requisitions'] });
    qc.invalidateQueries({ queryKey: ['rq-me'] });
  };
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const r = q.data;
  const c = r.can;
  const done = (text) => {
    setFlash({ tone: 'ok', text });
    refresh();
  };
  const curStep = stepOf(r.status);
  const curIdx = r.status === 'RECEIVED' ? STEPS.length : STEPS.findIndex(([k]) => k === curStep);
  const open = !['RECEIVED', 'CANCELLED'].includes(r.status);
  const anyAction =
    c.toDirector ||
    c.backToIt ||
    c.approve ||
    c.toAm ||
    c.amApprove ||
    c.cfoApprove ||
    c.pop ||
    c.receive ||
    c.removeQuote;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4">
        <div>
          <h1 className="text-xl font-semibold">
            {r.ref} · {r.itemName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={STATUS_TONES[r.status]}>{r.statusLabel}</Badge>
            {open && <span>since {formatDateTime(r.stageAt)}</span>}
          </p>
        </div>
        <ButtonLink to="/requisitions/requests">All requisitions</ButtonLink>
      </div>

      {flash && (
        <div className="mb-4">
          <Notice tone={flash.tone}>{flash.text}</Notice>
        </div>
      )}

      {r.status !== 'CANCELLED' && (
        <ol className="mb-6 grid grid-cols-4 gap-y-3 sm:grid-cols-8" aria-label="Progress">
          {STEPS.map(([k, label], i) => {
            const isDone = i < curIdx;
            const isCur = i === curIdx;
            return (
              <li key={k} className="flex flex-col items-center gap-1 text-center text-xs">
                <span
                  className={`flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${
                    isDone
                      ? 'border-brand bg-brand text-white'
                      : isCur
                        ? 'border-brand bg-white text-brand ring-2 ring-brand/20'
                        : 'border-rule bg-white text-muted'
                  }`}
                  aria-hidden
                >
                  {isDone ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={isCur ? 'font-medium text-brand' : isDone ? 'text-ink' : 'text-muted'}>
                  {label}
                  {isCur && <span className="sr-only"> (current)</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {r.rejection && open && (
        <div className="mb-4">
          <Notice tone="pending" title={`${r.rejection.action} by ${r.rejection.by}`}>
            {r.rejection.note}
          </Notice>
        </div>
      )}
      {r.rejection && r.status === 'CANCELLED' && (
        <div className="mb-4">
          <Notice tone="neutral" title={`Cancelled by ${r.rejection.by}`}>
            {r.rejection.note}
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {anyAction ? (
            <Section title="Your action">
              <YourAction r={r} onDone={done} />
            </Section>
          ) : (
            open && (
              <div className="rounded-md border border-rule bg-white px-4 py-3 text-sm">
                Waiting for <strong>{r.waitingFor}</strong>. There is nothing for you to do on it right now.
              </div>
            )
          )}

          <Section
            title="Quotations"
            description={
              r.isIt ? 'IT-related: IT gets the quotations.' : 'The department attaches the quotations.'
            }
          >
            <Quotes r={r} onDone={done} />
          </Section>

          {(r.docs.length > 0 || c.addDoc) && (
            <Section title="Supporting documents" description="Added by the department">
              {r.docs.length > 0 ? (
                <FileList files={r.docs} />
              ) : (
                <p className="text-sm text-muted">None yet.</p>
              )}
              {c.addDoc && r.docs.length < 5 && <UploadDoc r={r} onDone={done} />}
            </Section>
          )}

          {r.pops.length > 0 && (
            <Section title="Proof of payment">
              <FileList files={r.pops} />
            </Section>
          )}

          {c.cancel && <CancelBox r={r} onDone={done} />}
        </div>

        <aside className="space-y-6">
          <Section title="Details">
            <SideDetails
              items={[
                ['Item', r.itemName],
                ['Quantity', units(r.quantity)],
                ['Category', r.category?.name],
                ['Company', r.company?.name],
                ['Department', r.department?.name],
                ['IT-related', r.isIt ? 'Yes' : 'No'],
                ['Raised by', r.raisedBy],
                ['Raised on', formatDate(lusakaDate(r.createdAt))],
                ['Reason', r.reason],
                ...(r.approvedQuote
                  ? [
                      [
                        'Approved quotation',
                        `${r.approvedQuote.supplier} · ${kwacha(r.approvedQuote.amount)}`,
                      ],
                    ]
                  : []),
                ...(r.itemId
                  ? [
                      [
                        'Stock item',
                        <Link
                          key="i"
                          to={`/requisitions/stock/${r.itemId}`}
                          className="text-brand hover:underline"
                        >
                          View in stock
                        </Link>,
                      ],
                    ]
                  : []),
              ]}
            />
          </Section>
          <Section title="History">
            <ol className="space-y-4 text-sm">
              {[...r.events].reverse().map((e) => (
                <li key={e.id} className="border-l-2 border-rule pl-3">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-xs text-muted">
                    {[e.by, e.jobTitle, formatDateTime(e.at)].filter(Boolean).join(' · ')}
                  </p>
                  {e.note && <p className="mt-1 whitespace-pre-line text-ink/90">{e.note}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </aside>
      </div>
    </div>
  );
}

/** Label above value: the side column is too narrow for two columns. */
function SideDetails({ items }) {
  return (
    <dl className="space-y-3 text-sm">
      {items
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-medium whitespace-pre-line">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function FileLink({ f }) {
  return (
    <a
      href={`/api/requisitions/files/${f.id}/download${f.viewable ? '?view=1' : ''}`}
      target={f.viewable ? '_blank' : undefined}
      rel="noopener noreferrer"
      className="text-brand hover:underline"
    >
      {f.name}
    </a>
  );
}

function FileList({ files }) {
  return (
    <ul className="divide-y divide-rule rounded-md border border-rule">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <FileLink f={f} />
            <p className="text-xs text-muted">
              {fileSize(f.sizeBytes)} · {f.uploadedBy}, {formatDate(lusakaDate(f.uploadedAt))}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A button that asks first, with an optional or required note. */
function ActionButton({
  r,
  action,
  label,
  confirm,
  note,
  noteRequired,
  placeholder,
  variant = 'primary',
  extra,
  onDone,
  success,
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ask = () => {
    if (noteRequired && text.trim().length < 3) {
      setError('Please give a reason (at least 3 characters).');
      return;
    }
    setError(null);
    setOpen(true);
  };
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/requisitions/${r.id}/actions`, {
        action,
        note: text.trim(),
        ...(extra?.() ?? {}),
      });
      setOpen(false);
      setText('');
      onDone(success);
    } catch (err) {
      setError(err.message);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      {note && (
        <Field id={`note-${action}`} label={note} optional={!noteRequired}>
          <Textarea
            id={`note-${action}`}
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
          />
        </Field>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button variant={variant} onClick={ask}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        title={label}
        confirmLabel={label}
        tone={variant === 'danger' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={go}
        onCancel={() => setOpen(false)}
      >
        {confirm}
      </ConfirmDialog>
    </div>
  );
}

function YourAction({ r, onDone }) {
  const c = r.can;
  const [quoteId, setQuoteId] = useState(r.quotes.length === 1 ? String(r.quotes[0].id) : '');
  const sep = <hr className="my-5 border-rule" />;
  const parts = [];
  if (c.removeQuote) {
    parts.push(
      <div key="quotes">
        <p className="mb-3 text-sm text-muted">
          {r.quotes.length
            ? 'When the quotations are all attached, send it to the Director.'
            : 'Attach at least one quotation below, then send it to the Director.'}
        </p>
        {c.toDirector && (
          <ActionButton
            r={r}
            action="TO_DIRECTOR"
            label={r.status === 'RETURNED' ? 'Resubmit to Director' : 'Send to Director'}
            note="Note for the Director"
            placeholder={r.status === 'RETURNED' ? 'What you changed' : ''}
            confirm={`Send ${r.ref} with ${r.quotes.length} ${r.quotes.length === 1 ? 'quotation' : 'quotations'} to the Director?`}
            success={`${r.ref} sent to the Director for approval.`}
            onDone={onDone}
          />
        )}
      </div>,
    );
  }
  if (c.backToIt) {
    parts.push(
      <ActionButton
        key="it"
        r={r}
        action="BACK_TO_IT"
        label="Ask IT for new quotations"
        variant="secondary"
        confirm={`Send ${r.ref} back to IT for new quotations?`}
        success={`${r.ref} sent back to IT for new quotations.`}
        onDone={onDone}
      />,
    );
  }
  if (c.approve) {
    parts.push(
      <div key="approve" className="space-y-3">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Approve which quotation?</legend>
          <div className="space-y-2">
            {r.quotes.map((qt) => (
              <label key={qt.id} className="flex items-center gap-2.5 text-sm">
                <input
                  type="radio"
                  name="quote"
                  value={qt.id}
                  checked={quoteId === String(qt.id)}
                  onChange={(e) => setQuoteId(e.target.value)}
                  className="size-4 accent-brand"
                />
                <span>
                  <strong>{qt.supplier}</strong> · {kwacha(qt.amount)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <ActionButton
          r={r}
          action="APPROVE"
          label="Approve"
          note="Note"
          extra={() => ({ quoteId: Number(quoteId) || undefined })}
          confirm={`Approve ${r.ref} and send it to Accounts for payment?`}
          success={`${r.ref} approved and sent to Accounts.`}
          onDone={onDone}
        />
        {sep}
        <ActionButton
          r={r}
          action="REJECT"
          label="Reject"
          variant="danger"
          note="Reason for rejecting"
          noteRequired
          placeholder="The department will see this"
          confirm={`Reject ${r.ref} and return it to the department?`}
          success={`${r.ref} rejected and returned to the department.`}
          onDone={onDone}
        />
      </div>,
    );
  }
  if (c.toAm) {
    parts.push(
      <ActionButton
        key="am"
        r={r}
        action="TO_AM"
        label="Send to Accounts Manager"
        note="Payment details"
        placeholder="e.g. payment method, account, invoice number"
        confirm={`Send ${r.ref} to the Accounts Manager?`}
        success={`${r.ref} sent to the Accounts Manager.`}
        onDone={onDone}
      />,
    );
  }
  if (c.amApprove) {
    parts.push(
      <div key="amr">
        <ActionButton
          r={r}
          action="AM_APPROVE"
          label="Approve and send to CFO"
          note="Note"
          confirm={`Approve ${r.ref} and send it to the CFO?`}
          success={`${r.ref} sent to the CFO for final approval.`}
          onDone={onDone}
        />
        {sep}
        <ActionButton
          r={r}
          action="AM_REJECT"
          label="Send back to Accounts"
          variant="danger"
          note="Reason"
          noteRequired
          placeholder="What needs fixing"
          confirm={`Send ${r.ref} back to Accounts?`}
          success={`${r.ref} sent back to Accounts.`}
          onDone={onDone}
        />
      </div>,
    );
  }
  if (c.cfoApprove) {
    parts.push(
      <div key="cfo">
        <ActionButton
          r={r}
          action="CFO_APPROVE"
          label="Give final approval"
          note="Note"
          confirm={`Give final approval to pay for ${r.ref}?`}
          success={`${r.ref} approved for payment. Accounts can now pay and attach the proof of payment.`}
          onDone={onDone}
        />
        {sep}
        <ActionButton
          r={r}
          action="CFO_REJECT"
          label="Send back to Accounts Manager"
          variant="danger"
          note="Reason"
          noteRequired
          placeholder="What needs fixing"
          confirm={`Send ${r.ref} back to the Accounts Manager?`}
          success={`${r.ref} sent back to the Accounts Manager.`}
          onDone={onDone}
        />
      </div>,
    );
  }
  if (c.pop) parts.push(<ProofOfPayment key="pop" r={r} onDone={onDone} />);
  if (c.receive) {
    parts.push(
      <div key="recv">
        <p className="mb-3 text-sm text-muted">When the items arrive, receive them into stock.</p>
        <ButtonLink to={`/requisitions/receive?requisition=${r.id}`} variant="primary">
          Receive into stock
        </ButtonLink>
      </div>,
    );
  }
  return <div className="space-y-6">{parts}</div>;
}

function ProofOfPayment({ r, onDone }) {
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.upload(
        `/api/requisitions/${r.id}/files?kind=pop&note=${encodeURIComponent(note.trim())}`,
        file,
      );
      setOpen(false);
      onDone(`Proof of payment sent to ${r.raisedBy}. Stores can receive the items when they arrive.`);
    } catch (err) {
      setError(err.message);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <Field id="pop-file" label="Proof of payment" hint="PDF, image, Word or Excel, up to 10 MB.">
        <input
          id="pop-file"
          type="file"
          accept={ACCEPT}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-rule file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
      </Field>
      <Field id="pop-note" label="Note" optional>
        <Input
          id="pop-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder="e.g. payment reference"
        />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button disabled={!file} onClick={() => setOpen(true)}>
        Send proof of payment
      </Button>
      <ConfirmDialog
        open={open}
        title="Send proof of payment"
        confirmLabel="Send proof of payment"
        busy={busy}
        onConfirm={go}
        onCancel={() => setOpen(false)}
      >
        Attach this proof of payment and send it to {r.raisedBy}?
      </ConfirmDialog>
    </div>
  );
}

function Quotes({ r, onDone }) {
  const [remove, setRemove] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true);
    try {
      await api.post(`/api/requisitions/files/${remove.id}/remove`);
      onDone(`Quotation from ${remove.supplier} removed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setRemove(null);
    }
  };
  return (
    <div className="space-y-4">
      {r.quotes.length === 0 ? (
        <p className="text-sm text-muted">No quotations yet.</p>
      ) : (
        <ul className="divide-y divide-rule rounded-md border border-rule">
          {r.quotes.map((qt) => (
            <li
              key={qt.id}
              className={`flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm ${qt.approved ? 'bg-ok-bg/50' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {qt.supplier} {qt.approved && <Badge tone="ok">Approved</Badge>}
                </p>
                <p className="text-xs text-muted">
                  <FileLink f={qt} /> · {fileSize(qt.sizeBytes)} · {qt.uploadedBy},{' '}
                  {formatDate(lusakaDate(qt.uploadedAt))}
                </p>
              </div>
              <span className="font-semibold tabular-nums">{kwacha(qt.amount)}</span>
              {r.can.removeQuote && (
                <button
                  type="button"
                  onClick={() => setRemove(qt)}
                  className="rounded-sm p-1 text-muted hover:bg-danger-bg hover:text-danger"
                  aria-label={`Remove quotation from ${qt.supplier}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {r.can.addQuote && <AddQuote r={r} onDone={onDone} />}
      <ConfirmDialog
        open={Boolean(remove)}
        title="Remove quotation"
        confirmLabel="Remove"
        tone="danger"
        busy={busy}
        onConfirm={go}
        onCancel={() => setRemove(null)}
      >
        Remove the quotation from {remove?.supplier}?
      </ConfirmDialog>
    </div>
  );
}

function AddQuote({ r, onDone }) {
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const go = async (e) => {
    e.preventDefault();
    if (supplier.trim().length < 2) return setError('Enter the supplier.');
    if (!(Number(amount) > 0)) return setError('Enter the amount, more than zero.');
    if (!file) return setError('Choose the quotation file.');
    setBusy(true);
    setError(null);
    try {
      await api.upload(
        `/api/requisitions/${r.id}/files?kind=quote&supplier=${encodeURIComponent(supplier.trim())}&amount=${encodeURIComponent(amount)}`,
        file,
      );
      setSupplier('');
      setAmount('');
      setFile(null);
      if (input.current) input.current.value = '';
      onDone(`Quotation from ${supplier.trim()} attached.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  return (
    <form onSubmit={go} noValidate className="rounded-md border border-dashed border-rule p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="q-supplier" label="Supplier">
          <Input
            id="q-supplier"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field id="q-amount" label="Amount (K)">
          <Input
            id="q-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field id="q-file" label="Quotation file">
          <input
            ref={input}
            id="q-file"
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-rule file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
        </Field>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <Button type="submit" className="mt-4" busy={busy}>
        Attach quotation
      </Button>
    </form>
  );
}

function UploadDoc({ r, onDone }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const up = async (f) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      await api.upload(`/api/requisitions/${r.id}/files?kind=doc`, f);
      onDone(`${f.name} attached.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="mt-3">
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        id="doc-up"
        onChange={(e) => up(e.target.files?.[0])}
      />
      {error && (
        <div className="mb-2">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <Button variant="secondary" busy={busy} onClick={() => input.current?.click()}>
        Attach a document
      </Button>
    </div>
  );
}

function CancelBox({ r, onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-md border border-rule bg-white"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-danger">
        Cancel this requisition
      </summary>
      <div className="border-t border-rule p-4">
        <ActionButton
          r={r}
          action="CANCEL"
          label="Cancel requisition"
          variant="danger"
          note="Reason"
          noteRequired
          confirm={`Cancel ${r.ref}? This can't be undone.`}
          success={`${r.ref} cancelled.`}
          onDone={onDone}
        />
      </div>
    </details>
  );
}
