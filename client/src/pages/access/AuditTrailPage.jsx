import { Fragment, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  LoadError,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';

// Plain-language names for audit actions; anything else is shown tidied up.
const ACTION_LABELS = {
  BOOTSTRAP_ADMIN_CREATED: 'First Administrator Created',
  SIGN_IN: 'Signed In',
  SIGN_OUT: 'Signed Out',
  SIGN_IN_NOT_CONFIGURED: 'Sign-in Refused: No Employee Record With That Email',
  SIGN_IN_REJECTED_INACTIVE: 'Sign-in Refused: Employee Inactive',
  SIGN_IN_REJECTED_TENANT: 'Sign-in Refused: Other Organisation',
  EMPLOYEE_CREATED: 'Employee Created',
  EMPLOYEE_UPDATED: 'Employee Updated',
  EMPLOYEE_DEACTIVATED: 'Employee Marked As Left',
  EMPLOYEE_REACTIVATED: 'Employee Made Active Again',
  EMPLOYEES_IMPORTED: 'Employees Imported',
  IDENTITY_LINKED: 'Microsoft Account Linked',
  IDENTITY_UNLINKED: 'Microsoft Account Unlinked',
  ROLES_CHANGED: 'Positions Changed',
  DEPARTMENT_CREATED: 'Department Created',
  DEPARTMENT_UPDATED: 'Department Updated',
  HOLIDAY_CREATED: 'Public Holiday Added',
  HOLIDAY_UPDATED: 'Public Holiday Changed',
  HOLIDAY_DELETED: 'Public Holiday Deleted',
  SCHEDULE_CREATED: 'Working Schedule Added',
  SCHEDULE_UPDATED: 'Working Schedule Changed',
  SETTING_CONFIRMED: 'Setting Confirmed',
  SETTING_CHANGED: 'Setting Changed',
  LEAVE_MANAGER_TRANSFERRED: 'Leave Transferred With Different Dates',
  LEAVE_TRANSFER_ACCEPTED: 'Offered Dates Accepted',
  ROLE_ADDED: 'Role Added',
  ROLE_UPDATED: 'Role Changed',
  ROLE_DELETED: 'Role Deleted',
  USER_ADDED: 'User Given A Role',
  USER_UPDATED: 'User’s Role Changed',
  USER_REMOVED: 'User’s Role Removed',
  REPORT_EXPORTED: 'Report Exported',
};
const tidy = (a) => a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, ' ');
const label = (a) => ACTION_LABELS[a] ?? tidy(a);
const tone = (a) =>
  /DELETED|REMOVED|REJECT|CANCEL|DEACTIVATED|UNLINKED|REFUSED/.test(a)
    ? 'danger'
    : /ADDED|CREATED|APPROVE|RAISED|LINKED|REACTIVATED|RECEIVED/.test(a)
      ? 'ok'
      : 'neutral';

const EMPTY = { q: '', action: '', from: '', to: '', page: 1 };

/** A module's Audit trail (D108): every change made in it, newest first. */
export default function AuditTrailPage({ module, title = 'Audit trail' }) {
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [open, setOpen] = useState(null);
  const q = useQuery({
    queryKey: ['access-audit', module, filters],
    queryFn: () => api.get(`/api/access/${module}/audit${qs({ ...filters, pageSize: 100 })}`),
    placeholderData: keepPreviousData,
  });
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const total = q.data?.total ?? 0;
  return (
    <div>
      <PageHeader
        title={title}
        description={
          q.data
            ? `${total.toLocaleString('en-GB')} ${total === 1 ? 'entry' : 'entries'} · who changed what, and when`
            : undefined
        }
      />
      <form
        className="card mb-4 flex flex-wrap items-end gap-3 px-4 py-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...draft, page: 1 });
        }}
      >
        <Field id="au-q" label="Who Or Record" className="min-w-56 flex-1">
          <Input id="au-q" value={draft.q} onChange={set('q')} placeholder="Name or record number" />
        </Field>
        <Field id="au-action" label="Action" className="min-w-56">
          <Select id="au-action" value={draft.action} onChange={set('action')}>
            <option value="">All Actions</option>
            {(q.data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="au-from" label="From">
          <Input id="au-from" type="date" value={draft.from} onChange={set('from')} />
        </Field>
        <Field id="au-to" label="To">
          <Input id="au-to" type="date" value={draft.to} onChange={set('to')} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <div className="card p-0">
          <EmptyState title="No audit entries match these filters." />
        </div>
      ) : (
        <>
          <Table title={title}>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Record</Th>
                <Th>
                  <span className="sr-only">Details</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((a) => (
                <Fragment key={a.id}>
                  <tr data-date={a.at}>
                    <Td className="whitespace-nowrap">{formatDateTime(a.at)}</Td>
                    <Td className="font-semibold">{a.actor}</Td>
                    <Td>
                      <Badge tone={tone(a.action)}>{label(a.action)}</Badge>
                    </Td>
                    <Td className="text-muted">
                      {tidy(a.entityType.toUpperCase())} {a.entityId}
                    </Td>
                    <Td>
                      {(a.before || a.after) && (
                        <div className="row-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={open === a.id}
                            onClick={() => setOpen(open === a.id ? null : a.id)}
                          >
                            {open === a.id ? 'Hide' : 'Details'}
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                  {open === a.id && (
                    <tr>
                      <td colSpan={5} className="bg-canvas">
                        <div className="grid gap-4 text-[0.8rem] sm:grid-cols-2">
                          {a.before && <Json title="Before" value={a.before} />}
                          {a.after && <Json title="After" value={a.after} />}
                        </div>
                        {a.ipAddress && <p className="mt-2 text-[0.8rem] text-muted">From {a.ipAddress}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={q.data.page}
            pageSize={q.data.pageSize}
            total={q.data.total}
            onPage={(page) => setFilters((f) => ({ ...f, page }))}
          />
        </>
      )}
    </div>
  );
}

function Json({ title, value }) {
  return (
    <div>
      <p className="section-divider mb-1.5 pb-1">{title}</p>
      <pre className="overflow-x-auto rounded-sm border border-rule bg-white p-2 font-mono whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
