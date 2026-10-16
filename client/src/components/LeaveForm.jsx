import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, Paperclip, X } from 'lucide-react';
import { api, newActionKey } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import { days } from '../lib/leave.js';
import {
  Button,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  Section,
  Select,
  Textarea,
  applyServerErrors,
} from './ui.jsx';

export const LEAVE_FIELDS = [
  'leaveTypeId',
  'startDate',
  'endDate',
  'startPortion',
  'endPortion',
  'eventDate',
  'multipleBirth',
  'reason',
  'handoverNotes',
  'handoverContactId',
  'noticeShortfallReason',
  'sensitive',
];

const BLANK = {
  leaveTypeId: '',
  startDate: '',
  endDate: '',
  startPortion: 'FULL',
  endPortion: 'FULL',
  eventDate: '',
  multipleBirth: false,
  reason: '',
  handoverNotes: '',
  handoverContactId: '',
  noticeShortfallReason: '',
  sensitive: false,
};

export function toLeavePayload(v) {
  const text = (s) => (s && s.trim() ? s.trim() : null);
  return {
    leaveTypeId: Number(v.leaveTypeId),
    startDate: v.startDate,
    endDate: v.endDate,
    startPortion: v.startPortion,
    endPortion: v.endPortion,
    eventDate: v.eventDate || null,
    multipleBirth: Boolean(v.multipleBirth),
    reason: text(v.reason),
    handoverNotes: text(v.handoverNotes),
    handoverContactId: v.handoverContactId ? Number(v.handoverContactId) : null,
    noticeShortfallReason: text(v.noticeShortfallReason),
    sensitive: Boolean(v.sensitive),
  };
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Leave request form with a live calculation from the server. The server repeats every check
 * on submit; the preview only helps the employee see the result before sending.
 * `onSubmit(payload, idempotencyKey, files)` should send the request (then upload `files`) and
 * throw ApiError if the request itself is refused.
 */
export function LeaveForm({ initial, lockType = false, submitLabel, onSubmit, onCancel }) {
  const types = useQuery({ queryKey: ['leave-types'], queryFn: () => api.get('/api/leave/types') });
  const colleagues = useQuery({
    queryKey: ['colleagues'],
    queryFn: () => api.get('/api/leave/colleagues'),
    staleTime: 5 * 60_000,
  });
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { ...BLANK, ...initial } });
  const [message, setMessage] = useState(null);
  const [files, setFiles] = useState([]);
  const actionKey = useRef(newActionKey());

  const ready = types.isSuccess && colleagues.isSuccess;
  useEffect(() => {
    if (ready && initial) reset({ ...BLANK, ...initial });
  }, [ready, initial, reset]);

  const values = useWatch({ control });
  const type = types.data?.items.find((t) => String(t.id) === String(values.leaveTypeId));
  const sameDay = values.startDate && values.startDate === values.endDate;

  // Keep the end date sensible when the start date moves past it.
  useEffect(() => {
    if (values.startDate && (!values.endDate || values.endDate < values.startDate)) {
      setValue('endDate', values.startDate);
    }
  }, [values.startDate, values.endDate, setValue]);
  // Half days only where the policy allows them.
  useEffect(() => {
    if (type && !type.allowHalfDay) {
      setValue('startPortion', 'FULL');
      setValue('endPortion', 'FULL');
    }
  }, [type, setValue]);

  const canPreview = Boolean(values.leaveTypeId && values.startDate && values.endDate);
  const payload = canPreview ? toLeavePayload(values) : null;
  const debounced = useDebounced(payload, 350);
  const preview = useQuery({
    queryKey: ['leave-preview', debounced],
    queryFn: () => api.post('/api/leave/requests/preview', debounced),
    enabled: Boolean(debounced),
    placeholderData: keepPreviousData,
    retry: false,
  });

  if (!ready) {
    const failed = [types, colleagues].find((q) => q.isError);
    return failed ? <LoadError error={failed.error} onRetry={() => failed.refetch()} /> : <Loading />;
  }

  const available = types.data.items;
  const send = async (v) => {
    setMessage(null);
    try {
      await onSubmit(toLeavePayload(v), actionKey.current, files);
    } catch (err) {
      // A definite refusal means the same key may be reused safely with corrected input,
      // but a new key avoids a "different body" refusal from the server.
      actionKey.current = newActionKey();
      const left = applyServerErrors(err, setError, LEAVE_FIELDS);
      if (left) setMessage(left);
    }
  };
  const err = (f) => errors[f]?.message;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Section title="Request details">
        {available.length === 0 ? (
          <Notice tone="pending" title="No leave types are available yet.">
            HR is still reviewing the leave policy settings. Leave types appear here once HR has activated
            them.
          </Notice>
        ) : (
          <form onSubmit={handleSubmit(send)} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field
              id="leaveTypeId"
              label="Leave type"
              error={err('leaveTypeId')}
              className="sm:col-span-2"
              hint={type?.description}
            >
              <Select
                id="leaveTypeId"
                disabled={lockType}
                invalid={!!err('leaveTypeId')}
                {...register('leaveTypeId', { required: 'Choose a leave type.' })}
              >
                <option value="">Choose…</option>
                {available.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.notAvailableReason ? ' (not available to you)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {type?.notAvailableReason && (
              <div className="sm:col-span-2">
                <Notice tone="pending">{type.notAvailableReason}</Notice>
              </div>
            )}

            {type?.eventRequired && (
              <Field id="eventDate" label="Date of birth" error={err('eventDate')} className="sm:col-span-2">
                <Input
                  id="eventDate"
                  type="date"
                  className="w-48"
                  invalid={!!err('eventDate')}
                  {...register('eventDate')}
                />
              </Field>
            )}

            <Field id="startDate" label="First day" error={err('startDate')}>
              <Input
                id="startDate"
                type="date"
                invalid={!!err('startDate')}
                {...register('startDate', { required: 'Enter the first day.' })}
              />
            </Field>
            <Field id="endDate" label="Last day" error={err('endDate')}>
              <Input
                id="endDate"
                type="date"
                min={values.startDate || undefined}
                invalid={!!err('endDate')}
                {...register('endDate', { required: 'Enter the last day.' })}
              />
            </Field>

            {type?.allowHalfDay && (
              <>
                <Field
                  id="startPortion"
                  label={sameDay ? 'Part of day' : 'First day is'}
                  error={err('startPortion')}
                >
                  <Select id="startPortion" {...register('startPortion')}>
                    <option value="FULL">Full day</option>
                    <option value="PM_ONLY">Afternoon only</option>
                  </Select>
                </Field>
                <Field
                  id="endPortion"
                  label={sameDay ? 'Or' : 'Last day is'}
                  error={err('endPortion')}
                  hint={sameDay ? 'For a morning off, choose "Morning only" here.' : undefined}
                >
                  <Select id="endPortion" {...register('endPortion')}>
                    <option value="FULL">Full day</option>
                    <option value="AM_ONLY">Morning only</option>
                  </Select>
                </Field>
              </>
            )}

            {type?.multipleBirthAllowed && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="size-4" {...register('multipleBirth')} />
                Multiple birth (twins or more) – longer leave applies
              </label>
            )}

            {preview.data?.warnings?.some((w) => w.includes('notice')) && (
              <Field
                id="noticeShortfallReason"
                label="Why is this at short notice?"
                error={err('noticeShortfallReason')}
                className="sm:col-span-2"
              >
                <Textarea
                  id="noticeShortfallReason"
                  rows={2}
                  invalid={!!err('noticeShortfallReason')}
                  {...register('noticeShortfallReason')}
                />
              </Field>
            )}

            <Field id="reason" label="Reason" error={err('reason')} className="sm:col-span-2">
              <Textarea id="reason" rows={3} invalid={!!err('reason')} {...register('reason')} />
            </Field>

            <Field id="handoverContactId" label="Who will cover your work?" error={err('handoverContactId')}>
              <Select
                id="handoverContactId"
                invalid={!!err('handoverContactId')}
                {...register('handoverContactId')}
              >
                <option value="">Not arranged</option>
                {colleagues.data.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="handoverNotes"
              label="Handover notes"
              error={err('handoverNotes')}
              className="sm:col-span-2"
            >
              <Textarea
                id="handoverNotes"
                rows={3}
                invalid={!!err('handoverNotes')}
                {...register('handoverNotes', {
                  validate: (v) =>
                    !!v?.trim() || 'Add handover notes: what needs covering and who will cover it.',
                })}
              />
            </Field>

            <div className="sm:col-span-2">
              <AttachmentPicker
                files={files}
                onChange={setFiles}
                type={type}
                sensitiveField={register('sensitive')}
                sensitive={Boolean(values.sensitive)}
                lockSensitive={Boolean(initial?.sensitive)}
              />
            </div>

            {message && (
              <div className="sm:col-span-2">
                <Notice tone="danger">{message}</Notice>
              </div>
            )}
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <Button type="submit" busy={isSubmitting}>
                {submitLabel}
              </Button>
              {onCancel && (
                <Button variant="secondary" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </Section>

      <PreviewPanel canPreview={canPreview} preview={preview} />
    </div>
  );
}

function PreviewPanel({ canPreview, preview }) {
  const p = preview.data;
  return (
    <Section title="Calculation" className="content-start self-start">
      {!canPreview ? (
        <p className="text-sm text-muted">
          Choose a leave type and dates to see how many days will be charged.
        </p>
      ) : preview.isError ? (
        <p className="text-sm text-danger">{preview.error.message}</p>
      ) : !p ? (
        <Loading label="Calculating" />
      ) : (
        <div className={`space-y-4 text-sm ${preview.isFetching ? 'opacity-60' : ''}`}>
          {p.chargeableDays != null && (
            <div>
              <p className="text-2xl font-semibold">{days(p.chargeableDays)}</p>
              <p className="text-muted">
                {p.dayBasis === 'CALENDAR_DAYS'
                  ? 'Counted in calendar days.'
                  : `Working days${p.schedule ? ` on your schedule (${p.schedule})` : ''}.`}
              </p>
            </div>
          )}
          {(p.nonWorkingDaysExcluded > 0 || p.holidaysExcluded.length > 0) && (
            <ul className="space-y-1 text-muted">
              {p.nonWorkingDaysExcluded > 0 && (
                <li>{days(p.nonWorkingDaysExcluded)} off your schedule not charged</li>
              )}
              {p.holidaysExcluded.map((h) => (
                <li key={h.date}>
                  {formatDate(h.date)}: {h.name} (public holiday, not charged)
                </li>
              ))}
            </ul>
          )}
          {p.balances.map((b) => (
            <div key={b.year ?? b.window?.label} className="rounded-md bg-canvas px-3 py-2">
              {b.year ? (
                <>
                  <p className="font-medium">Annual leave {b.year}</p>
                  <p>
                    {days(b.available)} available, {days(b.remainingAfter)} left after this request
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">
                    Allowance: {days(b.entitlement)} {b.window?.label}
                  </p>
                  <p>
                    {days(b.used)} used, {days(b.available)} left
                  </p>
                </>
              )}
            </div>
          ))}
          {p.errors.length > 0 && (
            <Notice tone="danger" title="This request cannot be submitted yet">
              <ul className="list-disc space-y-0.5 pl-4">
                {p.errors.map((e) => (
                  <li key={`${e.field}-${e.message}`}>{e.message}</li>
                ))}
              </ul>
            </Notice>
          )}
          {p.warnings.length > 0 && (
            <Notice tone="pending">
              <ul className="space-y-0.5">
                {p.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}
    </Section>
  );
}

const MAX_FILES = 10;
const MAX_MB = 5;
const OK_TYPES = /\.(pdf|jpe?g|png)$/i;
const size = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Files chosen while applying. They are uploaded straight after the request is created; the
 * server checks each file's real type and size again.
 */
function AttachmentPicker({ files, onChange, type, sensitiveField, sensitive, lockSensitive }) {
  const input = useRef(null);
  const [problem, setProblem] = useState(null);

  const add = (list) => {
    setProblem(null);
    const next = [...files];
    for (const f of list) {
      if (!OK_TYPES.test(f.name)) {
        setProblem(`${f.name}: only PDF, JPEG and PNG files can be uploaded.`);
        continue;
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        setProblem(`${f.name} is larger than ${MAX_MB} MB.`);
        continue;
      }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      if (next.length >= MAX_FILES) {
        setProblem(`You can attach up to ${MAX_FILES} files.`);
        break;
      }
      next.push(f);
    }
    onChange(next);
    if (input.current) input.current.value = '';
  };

  return (
    <div className="rounded-md border border-rule p-4">
      <p className="text-sm font-medium">Supporting documents</p>
      <p className="mt-1 text-xs text-muted">
        {type?.documentRequired
          ? `Required: ${type.documentDescription ?? 'a supporting document'}. If you do not have it yet, you can upload it later from the request page.`
          : 'PDF, JPEG or PNG, up to 5 MB each.'}
      </p>
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-rule rounded-md border border-rule">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted">{size(f.size)}</span>
              <button
                type="button"
                className="rounded-sm p-1 text-muted hover:bg-canvas hover:text-danger"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="mt-2 text-xs text-danger">{problem}</p>}
      <input
        ref={input}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => add([...(e.target.files ?? [])])}
      />
      <Button variant="secondary" className="mt-3" onClick={() => input.current?.click()}>
        <Paperclip className="size-4" aria-hidden /> {files.length ? 'Add another file' : 'Attach files'}
      </Button>
      <label className="mt-4 flex items-start gap-2.5 border-t border-rule pt-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-brand"
          disabled={lockSensitive}
          {...sensitiveField}
        />
        <span>
          <span className="font-medium">Sensitive</span>
          <span className="block text-xs text-muted">
            {sensitive
              ? 'Goes straight to HR, not your manager. Only you and HR see the reason and documents.'
              : 'Tick to send this request straight to HR instead of your manager.'}
          </span>
        </span>
      </label>
    </div>
  );
}
