import { useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, newActionKey } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import {
  ACTION_LABELS,
  CHANGE_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  dateRange,
  days,
} from '../../lib/leave.js';
import {
  Badge,
  Button,
  Details,
  Field,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '../../components/ui.jsx';
import { LeaveForm } from '../../components/LeaveForm.jsx';
import DocumentsPanel from '../../components/DocumentsPanel.jsx';

export default function RequestPage() {
  const { id } = useParams();
  const location = useLocation();
  const q = useQuery({
    queryKey: ['leave-request', id],
    queryFn: () => api.get(`/api/leave/requests/${id}`),
  });
  const [editing, setEditing] = useState(false);

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const can = r.can;
  const openChange = r.changes.find((c) => c.status.startsWith('PENDING'));

  return (
    <div className="max-w-6xl">
      <BackLink />
      <PageHeader
        title={`${r.leaveType.name} · ${r.reference}`}
        description={`${r.employee.name} · ${dateRange(r)}`}
        actions={<Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>}
      />
      {location.state?.submitted && (
        <div className="mb-6">
          <Notice tone="ok" title="Request submitted.">
            {r.status === 'PENDING_HR_APPROVAL'
              ? 'No active manager is recorded for you, so it has gone straight to HR.'
              : 'Your manager has been asked to review it.'}
            {location.state.uploaded > 0 &&
              ` ${location.state.uploaded} ${location.state.uploaded === 1 ? 'document was' : 'documents were'} attached.`}
          </Notice>
          {location.state.uploadFailed?.length > 0 && (
            <div className="mt-3">
              <Notice tone="danger" title="Some documents could not be attached">
                <ul className="list-disc pl-4">
                  {location.state.uploadFailed.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <p className="mt-1">
                  Your request was still submitted. Upload them again under Supporting documents.
                </p>
              </Notice>
            </div>
          )}
        </div>
      )}

      {editing ? (
        <ResubmitForm request={r} onDone={() => setEditing(false)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid content-start gap-6">
            <Section title="Request">
              <Details
                items={[
                  ['Employee', `${r.employee.name} (${r.employee.employeeNumber})`],
                  ['Department', r.employee.department],
                  ['Leave type', r.leaveType.name],
                  ['Dates', dateRange(r)],
                  ['Days charged', days(r.chargeableDays)],
                  ...(r.eventDate ? [['Date of birth', formatDate(r.eventDate)]] : []),
                  ...(r.multipleBirth ? [['Multiple birth', 'Yes']] : []),
                  [
                    'Reason',
                    r.reasonHidden ? (
                      <span className="font-normal text-muted">Visible to HR only</span>
                    ) : (
                      r.reason
                    ),
                  ],
                  ...(r.noticeShortfallReason ? [['Short notice reason', r.noticeShortfallReason]] : []),
                  ['Covering', r.handoverContact],
                  ['Handover notes', r.handoverNotes],
                  [
                    'Manager',
                    r.routedWithoutManager ? 'None recorded – sent straight to HR' : r.assignedManager,
                  ],
                  ['Submitted', formatDateTime(r.submittedAt)],
                ]}
              />
            </Section>
            <DocumentsPanel request={r} />
            <History items={r.history} />
            {r.changes.length > 0 && <Changes items={r.changes} />}
            <DayBreakdown items={r.days} />
          </div>

          <div className="grid content-start gap-6">
            {can.managerDecide && <DecisionPanel request={r} stage="manager" />}
            {can.hrDecide && <DecisionPanel request={r} stage="hr" />}
            {openChange && can.changeManagerDecide && (
              <ChangeDecisionPanel request={r} change={openChange} stage="manager" />
            )}
            {openChange && can.changeHrDecide && (
              <ChangeDecisionPanel request={r} change={openChange} stage="hr" />
            )}
            {can.resubmit && (
              <Section title="Returned for correction">
                <p className="mb-3 text-sm">
                  HR returned this request. Check the comment in the history, correct the details and send it
                  again.
                </p>
                <Button onClick={() => setEditing(true)}>Correct and resubmit</Button>
              </Section>
            )}
            {can.withdraw && <WithdrawPanel request={r} />}
            {can.cancel && <CancelPanel request={r} />}
            {openChange && !can.changeManagerDecide && !can.changeHrDecide && (
              <Notice tone="pending" title="Cancellation in progress">
                {CHANGE_LABELS[openChange.reasonType]} – {STATUS_LABELS[openChange.status].toLowerCase()}.
              </Notice>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/leave'))}
      className="mb-3 inline-flex items-center gap-1 text-sm text-brand hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden /> Back
    </button>
  );
}

function useRefresh(id) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['leave-request', String(id)] });
    qc.invalidateQueries({ queryKey: ['my-requests'] });
    qc.invalidateQueries({ queryKey: ['balances'] });
    qc.invalidateQueries({ queryKey: ['approvals'] });
  };
}

/** Runs one action with its own idempotency key; a failed attempt gets a fresh key. */
function useAction(id) {
  const refresh = useRefresh(id);
  const key = useRef(newActionKey());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = async (name, path, body) => {
    setBusy(name);
    setError(null);
    try {
      const out = await api.post(path, body, { idempotencyKey: key.current });
      key.current = newActionKey();
      refresh();
      return out;
    } catch (err) {
      key.current = newActionKey();
      setError(err.status === 409 ? `${err.message} The page has been refreshed.` : err.message);
      if (err.status === 409) refresh();
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, error };
}

function DecisionPanel({ request: r, stage }) {
  const { run, busy, error } = useAction(r.id);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(null);
  const isHr = stage === 'hr';
  const decide = (action) => {
    if (action !== 'APPROVE' && !comment.trim()) {
      setMissing(action === 'REJECT' ? 'Give a reason for rejecting.' : 'Say what needs correcting.');
      return;
    }
    setMissing(null);
    run(action, `/api/approvals/requests/${r.id}/${stage}`, {
      action,
      comment: comment.trim() || null,
      version: r.version,
    });
  };
  return (
    <Section title={isHr ? 'HR decision' : 'Your decision'}>
      <div className="space-y-3">
        {isHr && r.documentRequirement && !r.documentRequirement.provided && (
          <Notice tone="pending">
            The policy asks for {r.documentRequirement.description ?? 'a supporting document'}, and none has
            been uploaded. Check before approving, or return the request.
          </Notice>
        )}
        <Field
          id={`comment-${stage}`}
          label="Comment"
          optional
          error={missing}
          hint={isHr ? 'Required to reject or return.' : 'Required to reject.'}
        >
          <Textarea
            id={`comment-${stage}`}
            rows={3}
            value={comment}
            invalid={!!missing}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button busy={busy === 'APPROVE'} disabled={!!busy} onClick={() => decide('APPROVE')}>
            Approve
          </Button>
          {isHr && (
            <Button
              variant="secondary"
              busy={busy === 'RETURN'}
              disabled={!!busy}
              onClick={() => decide('RETURN')}
            >
              Return for correction
            </Button>
          )}
          <Button
            variant="danger"
            busy={busy === 'REJECT'}
            disabled={!!busy}
            onClick={() => decide('REJECT')}
          >
            Reject
          </Button>
        </div>
      </div>
    </Section>
  );
}

function ChangeDecisionPanel({ request: r, change, stage }) {
  const { run, busy, error } = useAction(r.id);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(null);
  const decide = (action) => {
    if (action === 'REJECT' && !comment.trim()) return setMissing('Give a reason for rejecting.');
    setMissing(null);
    run(action, `/api/approvals/changes/${change.id}/${stage}`, {
      action,
      comment: comment.trim() || null,
      version: change.version,
    });
  };
  return (
    <Section
      title="Cancellation request"
      description={`${change.reference} · ${CHANGE_LABELS[change.reasonType]}`}
    >
      <div className="space-y-3 text-sm">
        {change.reason && <p>{change.reason}</p>}
        <p className="text-muted">
          {change.daysToReverse > 0
            ? `${days(change.daysToReverse)} will be returned if approved.`
            : 'No days are returned for this cancellation.'}
        </p>
        <Field id={`change-comment-${stage}`} label="Comment" optional error={missing}>
          <Textarea
            id={`change-comment-${stage}`}
            rows={2}
            value={comment}
            invalid={!!missing}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button busy={busy === 'APPROVE'} disabled={!!busy} onClick={() => decide('APPROVE')}>
            Approve cancellation
          </Button>
          <Button
            variant="danger"
            busy={busy === 'REJECT'}
            disabled={!!busy}
            onClick={() => decide('REJECT')}
          >
            Reject
          </Button>
        </div>
      </div>
    </Section>
  );
}

function WithdrawPanel({ request: r }) {
  const { run, busy, error } = useAction(r.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <Section title="Withdraw">
      {error && (
        <div className="mb-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {confirming ? (
        <div className="flex gap-2">
          <Button
            variant="danger"
            busy={!!busy}
            onClick={() => run('WITHDRAW', `/api/leave/requests/${r.id}/withdraw`, { version: r.version })}
          >
            Yes, withdraw it
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Withdraw request
        </Button>
      )}
    </Section>
  );
}

function CancelPanel({ request: r }) {
  const { run, busy, error } = useAction(r.id);
  const options = r.started ? ['RECALLED_BY_MANAGEMENT', 'EARLY_RETURN_BY_CHOICE'] : ['PLANS_CHANGED'];
  const [open, setOpen] = useState(false);
  const [reasonType, setReasonType] = useState(options[0]);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(null);
  const submit = async () => {
    if (!reason.trim()) return setMissing('Explain why.');
    setMissing(null);
    const out = await run('CANCEL', `/api/leave/requests/${r.id}/cancel`, {
      reasonType,
      reason: reason.trim(),
    });
    if (out) setOpen(false);
  };
  return (
    <Section title={r.started ? 'Return early' : 'Cancel approved leave'}>
      <p className="mb-3 text-sm text-muted">
        {r.started
          ? 'Your leave has started. Days are returned only if management recalled you.'
          : 'Cancelling needs your manager’s and HR’s approval. The days are returned once approved.'}
      </p>
      {error && (
        <div className="mb-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {open ? (
        <div className="space-y-3">
          {options.length > 1 && (
            <Field id="reasonType" label="What happened?">
              <Select id="reasonType" value={reasonType} onChange={(e) => setReasonType(e.target.value)}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {CHANGE_LABELS[o]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="cancelReason" label="Reason" error={missing}>
            <Textarea
              id="cancelReason"
              rows={3}
              value={reason}
              invalid={!!missing}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button busy={!!busy} onClick={submit}>
              Send for approval
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {r.started ? 'Request early return' : 'Request cancellation'}
        </Button>
      )}
    </Section>
  );
}

function ResubmitForm({ request: r, onDone }) {
  const refresh = useRefresh(r.id);
  const [initial] = useState(() => ({
    leaveTypeId: String(r.leaveType.id),
    startDate: r.startDate,
    endDate: r.endDate,
    startPortion: r.startPortion,
    endPortion: r.endPortion,
    eventDate: r.eventDate ?? '',
    multipleBirth: r.multipleBirth,
    reason: r.reason ?? '',
    handoverNotes: r.handoverNotes ?? '',
    handoverContactId: r.handoverContactId ? String(r.handoverContactId) : '',
    noticeShortfallReason: r.noticeShortfallReason ?? '',
  }));
  const submit = async (payload, idempotencyKey, files = []) => {
    await api.post(
      `/api/leave/requests/${r.id}/resubmit`,
      { ...payload, version: r.version },
      { idempotencyKey },
    );
    // Files that fail here can be uploaded again from the Supporting documents panel.
    for (const file of files) {
      await api.upload(`/api/documents/requests/${r.id}`, file).catch(() => {});
    }
    refresh();
    onDone();
  };
  return (
    <LeaveForm
      initial={initial}
      lockType
      submitLabel="Resubmit request"
      onSubmit={submit}
      onCancel={onDone}
    />
  );
}

function History({ items }) {
  return (
    <Section title="History">
      {items.length === 0 ? (
        <p className="text-sm text-muted">No actions yet.</p>
      ) : (
        <ol className="space-y-3 text-sm">
          {items.map((a, i) => (
            <li key={i} className="border-l-2 border-rule pl-3">
              <p>
                <span className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</span> by {a.actor}
                {a.onBehalfOf && <span className="text-muted"> on behalf of {a.onBehalfOf}</span>}
                <span className="text-muted"> · {STAGE_LABELS[a.stage]}</span>
              </p>
              <p className="text-xs text-muted">{formatDateTime(a.at)}</p>
              {a.comment && <p className="mt-1 whitespace-pre-line">{a.comment}</p>}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function Changes({ items }) {
  return (
    <Section title="Cancellation requests">
      <ul className="space-y-4 text-sm">
        {items.map((c) => (
          <li key={c.id}>
            <p>
              <span className="font-medium">{c.reference}</span> ·{' '}
              {CHANGE_LABELS[c.reasonType] ?? CHANGE_LABELS[c.type]}{' '}
              <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status] ?? c.status}</Badge>
            </p>
            {c.reason && <p className="mt-1 text-muted">{c.reason}</p>}
            <ul className="mt-2 space-y-1 border-l-2 border-rule pl-3">
              {c.history.map((a, i) => (
                <li key={i}>
                  {ACTION_LABELS[a.action] ?? a.action} by {a.actor}{' '}
                  <span className="text-xs text-muted">{formatDateTime(a.at)}</span>
                  {a.comment && <span className="block text-muted">{a.comment}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DayBreakdown({ items }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <Section
      title="Day by day"
      actions={
        <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      }
    >
      {open ? (
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {items.map((d) => (
            <li key={d.date} className="flex justify-between gap-3">
              <span>{formatDate(d.date)}</span>
              <span className="text-muted">
                {d.charged > 0
                  ? days(d.charged)
                  : d.exclusion === 'PUBLIC_HOLIDAY'
                    ? (d.holiday ?? 'Public holiday')
                    : 'Not a working day'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          {items.length} calendar {items.length === 1 ? 'day' : 'days'},{' '}
          {days(Math.round(items.reduce((s, d) => s + d.charged, 0) * 100) / 100)} charged.
        </p>
      )}
    </Section>
  );
}
