import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Select,
} from '../../components/ui.jsx';

const TITLES = {
  manager_scope: 'Who a manager can approve for',
  no_manager_routing: 'Staff with no manager',
  resubmission_routing: 'After HR returns a request for correction',
  handover_signoff_by: 'Handover sign-off',
  weekend_holiday_substitution: 'Public holidays that fall on a weekend',
  overdue_manager_working_days: 'Manager approval overdue after',
  overdue_hr_working_days: 'HR approval overdue after',
  uncommunicated_decision_escalation_days: 'Escalate undecided requests after',
  leave_reservations_enabled: 'Hold balance while a request is pending',
  email_max_attempts: 'Email delivery attempts',
  idempotency_ttl_hours: 'Duplicate-request protection window',
  leave_year_start: 'Leave year starts',
  business_timezone: 'Business timezone',
};

// Plain-language explanations shown to HR (the database descriptions are for administrators).
const HELP = {
  manager_scope:
    'Whether a manager approves only the people who report to them directly, or everyone below them.',
  no_manager_routing: 'Requests from someone with no manager, for example the Executive Director.',
  resubmission_routing: 'Where a corrected request goes after HR sends it back.',
  handover_signoff_by: 'The policy says handover notes are signed off by the Head of Department.',
  weekend_holiday_substitution:
    'When a public holiday falls on a weekend, any substitute day is added under Public holidays.',
  overdue_manager_working_days: 'After this, the request is flagged as overdue for the manager.',
  overdue_hr_working_days: 'After this, the request is flagged as overdue for HR.',
  uncommunicated_decision_escalation_days: 'Undecided requests are escalated, never approved automatically.',
  leave_reservations_enabled: 'If yes, days in a pending request are held so they cannot be requested twice.',
  email_max_attempts: 'How many times an email is retried before it is reported as failed.',
  idempotency_ttl_hours: 'How long a submitted action is remembered so a double-click cannot repeat it.',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
function display(s) {
  if (s.key === 'leave_year_start') return `${s.value.day} ${MONTHS[s.value.month - 1]}`;
  if (s.options) return s.options.find((o) => o.value === s.value)?.label ?? String(s.value);
  if (typeof s.value === 'boolean') return s.value ? 'Yes' : 'No';
  return s.unit ? `${s.value} ${s.unit}` : String(s.value);
}

export default function SettingsPage() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/api/admin/settings') });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const toConfirm = q.data.items.filter((s) => s.requiresConfirmation);
  const rest = q.data.items.filter((s) => !s.requiresConfirmation && s.editable);
  const fixed = q.data.items.filter((s) => !s.editable);

  return (
    <div className="max-w-4xl">
      <PageHeader title="Workflow settings" />
      {toConfirm.length > 0 && (
        <div className="mb-8">
          <Notice
            tone="pending"
            title={`${toConfirm.length} setting${toConfirm.length === 1 ? '' : 's'} need HR confirmation`}
          >
            Check each against the leave policy and confirm.
          </Notice>
          <SettingsList items={toConfirm} />
        </div>
      )}
      {rest.length > 0 && (
        <>
          <h2 className="mb-1 text-[15px] font-semibold">Confirmed settings</h2>
          <SettingsList items={rest} />
        </>
      )}
      <h2 className="mt-8 mb-1 text-[15px] font-semibold">Fixed by policy</h2>
      <ul className="divide-y divide-rule rounded-md border border-rule bg-white text-sm">
        {fixed.map((s) => (
          <li key={s.key} className="flex justify-between gap-4 px-4 py-3">
            <span>{TITLES[s.key] ?? s.key}</span>
            <span className="font-medium">{display(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingsList({ items }) {
  return (
    <ul className="mt-3 divide-y divide-rule rounded-md border border-rule bg-white">
      {items.map((s) => (
        <SettingRow key={s.key} setting={s} />
      ))}
    </ul>
  );
}

function SettingRow({ setting: s }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(s.value);
  useEffect(() => setValue(s.value), [s.value]);
  const save = useMutation({
    mutationFn: () => api.put(`/api/admin/settings/${s.key}`, { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const changed = JSON.stringify(value) !== JSON.stringify(s.value);
  const id = `setting-${s.key}`;

  return (
    <li className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_16rem_auto] sm:items-start">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {TITLES[s.key] ?? s.key}
        </label>
        <p className="mt-0.5 text-xs text-muted">{HELP[s.key] ?? s.description}</p>
        {s.updatedBy && !s.requiresConfirmation && (
          <p className="mt-1 text-xs text-muted">
            Last set by {s.updatedBy}, {formatDateTime(s.updatedAt)}
          </p>
        )}
      </div>
      <div>
        {s.type === 'choice' ? (
          <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : s.type === 'boolean' ? (
          <Select id={id} value={value ? 'yes' : 'no'} onChange={(e) => setValue(e.target.value === 'yes')}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              id={id}
              type="number"
              className="w-24"
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
            <span className="text-sm text-muted">{s.unit}</span>
          </div>
        )}
        {save.isError && <p className="mt-1 text-xs text-danger">{save.error.message}</p>}
      </div>
      <div className="flex items-center gap-2">
        {s.requiresConfirmation ? (
          <Button
            variant={changed ? 'primary' : 'secondary'}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            {changed ? 'Save and confirm' : 'Confirm'}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              busy={save.isPending}
              disabled={!changed}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
            {save.isSuccess && !changed && <Badge tone="ok">Saved</Badge>}
          </>
        )}
      </div>
    </li>
  );
}
