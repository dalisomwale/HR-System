import { Fragment, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
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

// Plain-language names for audit actions.
const ACTION_LABELS = {
  BOOTSTRAP_ADMIN_CREATED: 'First administrator created',
  SIGN_IN: 'Signed in',
  SIGN_OUT: 'Signed out',
  SIGN_IN_NOT_CONFIGURED: 'Sign-in refused: account not linked',
  SIGN_IN_REJECTED_INACTIVE: 'Sign-in refused: employee inactive',
  SIGN_IN_REJECTED_TENANT: 'Sign-in refused: other organisation',
  EMPLOYEE_CREATED: 'Employee created',
  EMPLOYEE_UPDATED: 'Employee updated',
  EMPLOYEE_DEACTIVATED: 'Employee deactivated',
  EMPLOYEE_REACTIVATED: 'Employee reactivated',
  EMPLOYEES_IMPORTED: 'Employees imported',
  IDENTITY_LINKED: 'Microsoft account linked',
  IDENTITY_UNLINKED: 'Microsoft account unlinked',
  ROLES_CHANGED: 'Roles changed',
  DEPARTMENT_CREATED: 'Department created',
  DEPARTMENT_UPDATED: 'Department updated',
  HOLIDAY_CREATED: 'Public holiday added',
  HOLIDAY_UPDATED: 'Public holiday changed',
  HOLIDAY_DELETED: 'Public holiday deleted',
  SCHEDULE_CREATED: 'Working schedule added',
  SCHEDULE_UPDATED: 'Working schedule changed',
  SETTING_CONFIRMED: 'Setting confirmed',
  SETTING_CHANGED: 'Setting changed',
  LEAVE_MANAGER_TRANSFERRED: 'Leave transferred with different dates',
  LEAVE_TRANSFER_ACCEPTED: 'Offered dates accepted',
};
const label = (a) => ACTION_LABELS[a] ?? a;

export default function AuditPage() {
  const [filters, setFilters] = useState({ action: '', from: '', to: '', page: 1 });
  const [open, setOpen] = useState(null);
  const q = useQuery({
    queryKey: ['audit', filters],
    queryFn: () => api.get(`/api/admin/audit${qs(filters)}`),
    placeholderData: keepPreviousData,
  });
  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  return (
    <div>
      <PageHeader title="Audit log" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field id="aAction" label="Event">
          <Select
            id="aAction"
            className="w-72"
            value={filters.action}
            onChange={(e) => set({ action: e.target.value })}
          >
            <option value="">All events</option>
            {q.data?.actions.map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="aFrom" label="From">
          <Input
            id="aFrom"
            type="date"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </Field>
        <Field id="aTo" label="To">
          <Input id="aTo" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
      </div>

      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title="No audit entries match these filters." />
        </div>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Event</Th>
                <Th>Record</Th>
                <Th>
                  <span className="sr-only">Details</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <Td className="whitespace-nowrap">{formatDateTime(a.at)}</Td>
                    <Td>{a.actor}</Td>
                    <Td>{label(a.action)}</Td>
                    <Td className="text-muted">
                      {a.entityType.replace('_', ' ')} {a.entityId}
                    </Td>
                    <Td className="text-right">
                      {(a.before || a.after) && (
                        <Button
                          variant="ghost"
                          className="h-7 px-2"
                          aria-expanded={open === a.id}
                          onClick={() => setOpen(open === a.id ? null : a.id)}
                        >
                          {open === a.id ? 'Hide' : 'Details'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                  {open === a.id && (
                    <tr>
                      <td colSpan={5} className="border-b border-rule bg-canvas px-3 py-3">
                        <div className="grid gap-4 text-xs sm:grid-cols-2">
                          {a.before && <Json title="Before" value={a.before} />}
                          {a.after && <Json title="After" value={a.after} />}
                        </div>
                        {a.ipAddress && <p className="mt-2 text-xs text-muted">From {a.ipAddress}</p>}
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
      <p className="mb-1 font-medium">{title}</p>
      <pre className="overflow-x-auto rounded-sm border border-rule bg-white p-2 whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
