import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Paperclip, X } from 'lucide-react';
import { HANDOVER_TEMPLATE_URL } from './DocumentsPanel.jsx';
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
  'handoverSheet',
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
    // Half days are not offered when applying (D98); every request is for whole days.
    startPortion: 'FULL',
    endPortion: 'FULL',
    eventDate: v.eventDate || null,
    multipleBirth: Boolean(v.multipleBirth),
    reason: text(v.reason),
    handoverContactId: v.handoverContactId ? Number(v.handoverContactId) : null,
    noticeShortfallReason: text(v.noticeShortfallReason),
    sensitive: Boolean(v.sensitive),
  };
}

/** A chosen file as base64, to send with the request. */
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('The handover sheet could not be read. Choose it again.'));
    r.readAsDataURL(file);
  });
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
 * `onSubmit(payload, idempotencyKey, files)` should send the request, which carries the handover
 * sheet (D99), then upload `files`; it throws ApiError if the request itself is refused.
 */
export function LeaveForm({
  initial,
  lockType = false,
  hasHandoverSheet = false,
  submitLabel,
  onSubmit,
  onCancel,
}) {
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
    clearErrors,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { ...BLANK, ...initial } });
  const [message, setMessage] = useState(null);
  const [files, setFiles] = useState([]);
  const [handoverFile, setHandoverFile] = useState(null);
  const actionKey = useRef(newActionKey());

  const ready = types.isSuccess && colleagues.isSuccess;
  useEffect(() => {
    if (ready && initial) reset({ ...BLANK, ...initial });
  }, [ready, initial, reset]);

  const values = useWatch({ control });
  const type = types.data?.items.find((t) => String(t.id) === String(values.leaveTypeId));

  // Keep the end date sensible when the start date moves past it.
  useEffect(() => {
    if (values.startDate && (!values.endDate || values.endDate < values.startDate)) {
      setValue('endDate', values.startDate);
    }
  }, [values.startDate, values.endDate, setValue]);

  // Sensitive only on leave types whose rules allow it (D100).
  useEffect(() => {
    if (type && !type.sensitiveAllowed && !initial?.sensitive) setValue('sensitive', false);
  }, [type, initial, setValue]);

  const canPreview = Boolean(values.leaveTypeId && values.startDate && values.endDate);
  const payload = canPreview
    ? { ...toLeavePayload(values), handoverSheetAttached: Boolean(handoverFile || hasHandoverSheet) }
    : null;
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
    if (!handoverFile && !hasHandoverSheet) {
      setError('handoverSheet', {
        message: 'Attach your handover sheet: download the template, fill it in and attach it.',
      });
      return;
    }
    try {
      const payload = toLeavePayload(v);
      if (handoverFile) {
        payload.handoverSheet = { name: handoverFile.name, data: await readBase64(handoverFile) };
      }
      // Supporting documents only go with leave types that require one.
      await onSubmit(payload, actionKey.current, type?.documentRequired ? files : []);
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
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

            <div className="sm:col-span-2">
              <HandoverSheetPicker
                file={handoverFile}
                onChange={(f) => {
                  setHandoverFile(f);
                  if (f) clearErrors('handoverSheet');
                }}
                attached={hasHandoverSheet}
                error={err('handoverSheet')}
              />
            </div>

            {type?.documentRequired && (
              <div className="sm:col-span-2">
                <AttachmentPicker files={files} onChange={setFiles} type={type} />
              </div>
            )}

            {(type?.sensitiveAllowed || initial?.sensitive) && (
              <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-brand"
                  disabled={Boolean(initial?.sensitive)}
                  {...register('sensitive')}
                />
                <span>
                  <span className="font-medium">Sensitive</span>
                  <span className="block text-xs text-muted">
                    {values.sensitive
                      ? 'Goes straight to HR, not your manager. Only you and HR see the reason and documents.'
                      : 'Tick to send this request straight to HR instead of your manager.'}
                  </span>
                </span>
              </label>
            )}

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
function AttachmentPicker({ files, onChange, type }) {
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
        Required: {type.documentDescription ?? 'a supporting document'}. PDF, JPEG or PNG, up to {MAX_MB} MB
        each. If you do not have it yet, you can upload it later from the request page.
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
    </div>
  );
}

/**
 * The handover sheet (D98): the Excel handover template, filled in and attached. Uploaded straight
 * after the request is created; the server checks it is a real Excel workbook.
 */
function HandoverSheetPicker({ file, onChange, attached, error }) {
  const input = useRef(null);
  const [problem, setProblem] = useState(null);
  const pick = (f) => {
    setProblem(null);
    if (input.current) input.current.value = '';
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name))
      return setProblem('Choose an Excel file (.xlsx). Use the handover template.');
    if (f.size > MAX_MB * 1024 * 1024) return setProblem(`${f.name} is larger than ${MAX_MB} MB.`);
    onChange(f);
  };
  return (
    <div className={`rounded-md border p-4 ${error ? 'border-danger' : 'border-rule'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Handover</p>
          <p className="mt-1 text-xs text-muted">
            Download the Excel template, list your tasks, deadlines and contacts, then attach it.
          </p>
        </div>
        <a href={HANDOVER_TEMPLATE_URL} className="text-sm text-brand hover:underline">
          Download template
        </a>
      </div>
      {attached && !file ? (
        <p className="mt-3 text-sm text-muted">
          Your handover sheet is already attached. Attach a new one only to replace it.
        </p>
      ) : file ? (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-rule px-3 py-2 text-sm">
          <FileSpreadsheet className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="text-xs text-muted">{size(file.size)}</span>
          <button
            type="button"
            className="rounded-sm p-1 text-muted hover:bg-canvas hover:text-danger"
            aria-label={`Remove ${file.name}`}
            onClick={() => onChange(null)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
      {(problem || error) && <p className="mt-2 text-xs text-danger">{problem || error}</p>}
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button variant="secondary" className="mt-3" onClick={() => input.current?.click()}>
        <Paperclip className="size-4" aria-hidden />{' '}
        {file ? 'Choose another file' : attached ? 'Replace handover sheet' : 'Attach handover sheet'}
      </Button>
    </div>
  );
}
