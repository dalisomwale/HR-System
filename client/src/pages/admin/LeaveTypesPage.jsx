import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { PERIOD_LABELS, days } from '../../lib/leave.js';
import {
  Badge,
  Button,
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
  applyServerErrors,
} from '../../components/ui.jsx';

const ACCRUAL = {
  NONE: 'No accrual',
  ANNUAL_GRANT: 'Granted at the start of the year',
  FIXED_MONTHLY: 'Fixed amount each month',
  ENTITLEMENT_DIV_12: 'Entitlement ÷ 12 each month',
};
const NOTICE = { NONE: 'Not enforced', WARN_WITH_REASON: 'Warn and ask for a reason', BLOCK: 'Block' };

export default function LeaveTypesPage() {
  const q = useQuery({ queryKey: ['admin-leave-types'], queryFn: () => api.get('/api/admin/leave-types') });
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Leave types" />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-4">
          <AccrualNotice items={q.data.items} />
          {q.data.items.map((t) => (
            <LeaveTypeCard key={t.id} type={t} />
          ))}
        </div>
      )}
      <JobsSection />
    </div>
  );
}

function summary(p) {
  const rows = [
    ['Paid', p.isPaid ? 'Yes' : 'No'],
    ['Counted in', p.dayBasis === 'CALENDAR_DAYS' ? 'Calendar days' : 'Working days'],
    [
      'Allowance',
      p.consumesBalance
        ? `Balance: ${p.entitlementDays != null ? days(p.entitlementDays) : 'not set'} per year`
        : p.entitlementDays != null
          ? `${days(p.entitlementDays)} ${PERIOD_LABELS[p.entitlementPeriod] ?? (p.entitlementPeriod === 'PER_OCCASION' ? 'per occasion' : '')}`
          : 'No fixed allowance',
    ],
  ];
  if (p.consumesBalance) {
    rows.push([
      'Accrual',
      `${ACCRUAL[p.accrualMethod]}${p.accrualMethod === 'FIXED_MONTHLY' ? ` (${p.accrualMonthlyAmount})` : ''}${
        p.accrualMethod !== 'NONE' && !p.accrualConfirmed ? ' – not confirmed, will not run' : ''
      }`,
    ]);
    rows.push([
      'Carry forward',
      p.carryForwardMaxDays != null
        ? `Up to ${days(p.carryForwardMaxDays)}${p.carryForwardExpiryMonth ? `, use by ${p.carryForwardExpiryDay}/${p.carryForwardExpiryMonth}` : ''}`
        : 'None',
    ]);
  }
  if (p.maxSingleDurationDays != null) rows.push(['Longest request', days(p.maxSingleDurationDays)]);
  if (p.minServiceMonths) rows.push(['Service needed', `${p.minServiceMonths} months`]);
  rows.push([
    'Notice',
    p.minNoticeDays ? `${p.minNoticeDays} days (${NOTICE[p.noticeEnforcement]})` : 'None',
  ]);
  rows.push(['Half days', p.allowHalfDay ? 'Allowed' : 'Not allowed']);
  rows.push([
    'Back-dating',
    p.allowBackdate
      ? `Allowed${p.backdateMaxDays != null ? `, up to ${p.backdateMaxDays} days` : ''}`
      : 'Not allowed',
  ]);
  if (p.documentRequired) rows.push(['Document', p.documentDescription ?? 'Required']);
  if (p.extraRules?.eligibleSex)
    rows.push(['Eligible', p.extraRules.eligibleSex === 'FEMALE' ? 'Female employees' : 'Male employees']);
  return rows;
}

function LeaveTypeCard({ type: t }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const p = t.current;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/leave-types/${t.id}/${t.isActive ? 'deactivate' : 'activate'}`);
      qc.invalidateQueries({ queryKey: ['admin-leave-types'] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      qc.invalidateQueries({ queryKey: ['balances'] });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t.name}
          {t.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}
          {p?.requiresHrConfirmation && <Badge tone="pending">Awaiting HR review</Badge>}
          {t.isConfidential && <Badge tone="brand">Confidential</Badge>}
        </span>
      }
      description={
        p
          ? `Version ${p.versionNo}, in force from ${formatDate(p.effectiveFrom)}${p.sourceReference ? ` · ${p.sourceReference}` : ''}`
          : 'No policy recorded'
      }
      actions={
        p && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing((e) => !e)}>
              {editing ? 'Close' : 'Change rules'}
            </Button>
            <Button variant={t.isActive ? 'danger' : 'primary'} busy={busy} onClick={toggle}>
              {t.isActive ? 'Deactivate' : 'Review done – activate'}
            </Button>
          </div>
        )
      }
    >
      {t.description && <p className="mb-3 text-sm text-muted">{t.description}</p>}
      {error && (
        <div className="mb-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {p && (
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
          {summary(p).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {editing && p && <PolicyForm type={t} onDone={() => setEditing(false)} />}
      {t.versions.length > 1 && (
        <p className="mt-3 text-xs text-muted">
          Earlier versions:{' '}
          {t.versions
            .slice(1)
            .map((v) => `v${v.versionNo} ${formatDate(v.effectiveFrom)}–${formatDate(v.effectiveTo)}`)
            .join('; ')}
        </p>
      )}
    </Section>
  );
}

const NUMBER_FIELDS = [
  'entitlementDays',
  'accrualMonthlyAmount',
  'carryForwardMaxDays',
  'backdateMaxDays',
  'minNoticeDays',
  'maxSingleDurationDays',
  'minServiceMonths',
];
const BOOL_FIELDS = [
  'isPaid',
  'accrualConfirmed',
  'allowHalfDay',
  'allowBackdate',
  'handoverRequired',
  'documentRequired',
];
const ALL = [
  ...NUMBER_FIELDS,
  ...BOOL_FIELDS,
  'dayBasis',
  'accrualMethod',
  'accrualRounding',
  'noticeEnforcement',
  'documentDescription',
];

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function PolicyForm({ type: t, onDone }) {
  const qc = useQueryClient();
  const p = t.current;
  const defaults = {
    effectiveFrom: tomorrow(),
    note: '',
    ...Object.fromEntries(
      ALL.map((k) => [k, BOOL_FIELDS.includes(k) ? Boolean(p[k]) : p[k] == null ? '' : String(p[k])]),
    ),
  };
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, dirtyFields, isSubmitting },
  } = useForm({ defaultValues: defaults });
  const [message, setMessage] = useState(null);

  const onSubmit = async (v) => {
    setMessage(null);
    const body = { effectiveFrom: v.effectiveFrom, note: v.note };
    for (const k of ALL) {
      if (!dirtyFields[k]) continue;
      if (NUMBER_FIELDS.includes(k)) body[k] = v[k] === '' ? null : Number(v[k]);
      else if (k === 'documentDescription') body[k] = v[k] || null;
      else body[k] = v[k];
    }
    if (Object.keys(body).length === 2) {
      setMessage('Change at least one rule.');
      return;
    }
    try {
      await api.post(`/api/admin/leave-types/${t.id}/policy`, body);
      qc.invalidateQueries({ queryKey: ['admin-leave-types'] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      onDone();
    } catch (err) {
      const left = applyServerErrors(err, setError, [...ALL, 'effectiveFrom', 'note']);
      if (left) setMessage(left);
    }
  };
  const err = (f) => errors[f]?.message;
  const num = (name, label, hint) => (
    <Field id={`${t.id}-${name}`} label={label} hint={hint} optional error={err(name)}>
      <Input id={`${t.id}-${name}`} inputMode="decimal" invalid={!!err(name)} {...register(name)} />
    </Field>
  );
  const check = (name, label) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4" {...register(name)} /> {label}
    </label>
  );

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="mt-4 grid gap-4 border-t border-rule pt-4 sm:grid-cols-3"
    >
      <p className="text-sm text-muted sm:col-span-3">
        New rules apply to requests starting on or after the date you choose. Requests already made keep the
        rules they were made under.
      </p>
      <Field id={`${t.id}-effectiveFrom`} label="Rules apply from" error={err('effectiveFrom')}>
        <Input
          id={`${t.id}-effectiveFrom`}
          type="date"
          invalid={!!err('effectiveFrom')}
          {...register('effectiveFrom', { required: 'Required' })}
        />
      </Field>
      <Field id={`${t.id}-dayBasis`} label="Counted in">
        <Select id={`${t.id}-dayBasis`} {...register('dayBasis')}>
          <option value="WORKING_DAYS">Working days</option>
          <option value="CALENDAR_DAYS">Calendar days</option>
        </Select>
      </Field>
      {num('entitlementDays', 'Allowance (days)')}
      {num('maxSingleDurationDays', 'Longest single request (days)')}
      {p.consumesBalance && (
        <>
          <Field id={`${t.id}-accrualMethod`} label="Accrual">
            <Select id={`${t.id}-accrualMethod`} {...register('accrualMethod')}>
              {Object.entries(ACCRUAL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {watch('accrualMethod') === 'FIXED_MONTHLY' && num('accrualMonthlyAmount', 'Days per month')}
          <Field id={`${t.id}-accrualRounding`} label="Accrual rounding">
            <Select id={`${t.id}-accrualRounding`} {...register('accrualRounding')}>
              <option value="NONE">None</option>
              <option value="NEAREST_HALF">Nearest half day</option>
              <option value="NEAREST_TENTH">Nearest tenth</option>
              <option value="DOWN_HALF">Down to half day</option>
            </Select>
          </Field>
          {num('carryForwardMaxDays', 'Carry forward limit (days)')}
        </>
      )}
      {num('minNoticeDays', 'Notice (days)')}
      <Field id={`${t.id}-noticeEnforcement`} label="If notice is short">
        <Select id={`${t.id}-noticeEnforcement`} {...register('noticeEnforcement')}>
          {Object.entries(NOTICE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      {num('minServiceMonths', 'Months of service needed')}
      {num('backdateMaxDays', 'Back-dating limit (days)')}
      <div className="grid content-start gap-2 sm:col-span-3 sm:grid-cols-3">
        {check('isPaid', 'Paid leave')}
        {check('allowHalfDay', 'Half days allowed')}
        {check('allowBackdate', 'Back-dating allowed')}
        {check('documentRequired', 'Supporting document required')}
        {p.consumesBalance && check('accrualConfirmed', 'Accrual rule confirmed by HR')}
      </div>
      <Field id={`${t.id}-documentDescription`} label="Document needed" optional className="sm:col-span-3">
        <Input id={`${t.id}-documentDescription`} {...register('documentDescription')} />
      </Field>
      <Field id={`${t.id}-note`} label="Why is this changing?" error={err('note')} className="sm:col-span-3">
        <Textarea
          id={`${t.id}-note`}
          rows={2}
          invalid={!!err('note')}
          {...register('note', { required: 'Required' })}
        />
      </Field>
      {message && (
        <div className="sm:col-span-3">
          <Notice tone="danger">{message}</Notice>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" busy={isSubmitting}>
          Save new version
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const JOB_LABELS = {
  MONTHLY_ACCRUAL: 'Monthly accrual',
  CARRY_FORWARD: 'Year-end carry forward',
  CARRY_FORWARD_EXPIRY: 'Carry-forward expiry',
};

function JobsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['jobs'], queryFn: () => api.get('/api/admin/jobs') });
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [period, setPeriod] = useState(
    `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`,
  );
  const [year, setYear] = useState(String(now.getFullYear() - 1));
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);

  const run = async (name, path, body) => {
    setBusy(name);
    setResult(null);
    try {
      const out = await api.post(path, body);
      setResult({ tone: 'ok', text: `${JOB_LABELS[name]} finished: ${describe(out)}` });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['balances'] });
    } catch (err) {
      setResult({ tone: 'danger', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Balance jobs">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Field id="accrual-period" label="Monthly accrual for">
            <Input
              id="accrual-period"
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            busy={busy === 'MONTHLY_ACCRUAL'}
            onClick={() => run('MONTHLY_ACCRUAL', '/api/admin/jobs/monthly-accrual', { period })}
          >
            Run accrual
          </Button>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Field id="cf-year" label="Leave year ending">
            <Input
              id="cf-year"
              className="w-32"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              busy={busy === 'CARRY_FORWARD'}
              onClick={() => run('CARRY_FORWARD', '/api/admin/jobs/carry-forward', { year: Number(year) })}
            >
              Run carry forward
            </Button>
            <Button
              variant="secondary"
              busy={busy === 'CARRY_FORWARD_EXPIRY'}
              onClick={() =>
                run('CARRY_FORWARD_EXPIRY', '/api/admin/jobs/carry-forward-expiry', { year: Number(year) })
              }
            >
              Run expiry
            </Button>
          </div>
        </div>
      </div>
      {result && (
        <div className="mt-4">
          <Notice tone={result.tone}>{result.text}</Notice>
        </div>
      )}
      <h3 className="mt-6 mb-2 text-sm font-semibold">Recent runs</h3>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="text-sm text-muted">No jobs have run yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th>Finished</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((j, i) => (
              <tr key={i}>
                <Td>{JOB_LABELS[j.job] ?? j.job}</Td>
                <Td>{j.period}</Td>
                <Td>
                  <Badge
                    tone={j.status === 'SUCCEEDED' ? 'ok' : j.status === 'FAILED' ? 'danger' : 'pending'}
                  >
                    {j.status}
                  </Badge>
                </Td>
                <Td>{formatDateTime(j.finishedAt)}</Td>
                <Td className="text-xs">{j.error ?? describe(j.summary)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

function describe(summary) {
  if (!summary || typeof summary !== 'object') return '';
  return Object.entries(summary)
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v}`)
    .join(', ');
}

/** Shown while a balance accrual rule is unconfirmed; accrual will not run until it is. */
function AccrualNotice({ items }) {
  const names = items
    .filter(
      (t) => t.current?.consumesBalance && t.current.accrualMethod !== 'NONE' && !t.current.accrualConfirmed,
    )
    .map((t) => t.name);
  if (!names.length) return null;
  return (
    <Notice
      tone="pending"
      title={`Accrual is off until the ${names.join(', ').toLowerCase()} rule is confirmed.`}
    >
      Choose the rule under Change rules and tick “Accrual rule confirmed by HR”.
    </Notice>
  );
}
