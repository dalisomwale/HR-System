import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { PERIOD_LABELS, days } from '../../lib/leave.js';
import { Button, Field, Input, Notice, Select, Textarea, applyServerErrors } from '../../components/ui.jsx';

/* Shared by the Leave types list and a leave type's own page. */

export const ACCRUAL = {
  NONE: 'No accrual',
  ANNUAL_GRANT: 'Granted at the start of the year',
  FIXED_MONTHLY: 'Fixed amount each month',
  ENTITLEMENT_DIV_12: 'Entitlement ÷ 12 each month',
};
export const NOTICE = { NONE: 'Not enforced', WARN_WITH_REASON: 'Warn and ask for a reason', BLOCK: 'Block' };

export function allowance(p) {
  if (p.consumesBalance) return `${p.entitlementDays != null ? days(p.entitlementDays) : 'Not set'} a year`;
  if (p.entitlementDays == null) return 'No fixed allowance';
  const period =
    PERIOD_LABELS[p.entitlementPeriod] ?? (p.entitlementPeriod === 'PER_OCCASION' ? 'per occasion' : '');
  return `${days(p.entitlementDays)} ${period}`;
}

export function summary(p) {
  const rows = [
    ['Paid', p.isPaid ? 'Yes' : 'No'],
    ['Counted in', p.dayBasis === 'CALENDAR_DAYS' ? 'Calendar days' : 'Working days'],
    ['Allowance', p.consumesBalance ? `Balance: ${allowance(p)}` : allowance(p)],
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

export function PolicyForm({ type: t, onDone }) {
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
      qc.invalidateQueries({ queryKey: ['admin-leave-type', String(t.id)] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      onDone();
    } catch (err) {
      const left = applyServerErrors(err, setError, [...ALL, 'effectiveFrom', 'note']);
      if (left) setMessage(left);
    }
  };
  const err = (f) => errors[f]?.message;
  const num = (name, label, hint) => (
    <Field id={`${t.id}-${name}`} label={label} hint={hint} error={err(name)}>
      <Input id={`${t.id}-${name}`} inputMode="decimal" invalid={!!err(name)} {...register(name)} />
    </Field>
  );
  const check = (name, label) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4" {...register(name)} /> {label}
    </label>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-3">
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
      <Field id={`${t.id}-documentDescription`} label="Document needed" className="sm:col-span-3">
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
