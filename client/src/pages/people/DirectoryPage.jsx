import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { FileUp, Plus, Search } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import DepartmentOptions from '../../components/DepartmentOptions.jsx';
import {
  ButtonLink,
  EmptyState,
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
import { EMPLOYMENT_TYPES, Initials, StatusBadge } from './people-ui.jsx';

/** Everyone in the group, searchable and filterable (D52). */
export default function DirectoryPage() {
  const { data: me } = useMe();
  const canEdit = hasRole(me, 'HR_OFFICER');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? 'ACTIVE',
    companyId: params.get('companyId') ?? '',
    departmentId: params.get('departmentId') ?? '',
    employmentType: params.get('employmentType') ?? '',
    filter: params.get('filter') ?? '',
    page: Number(params.get('page') ?? 1),
  };
  const update = (patch) => {
    const next = { ...filters, page: 1, ...patch };
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '' && v !== 1)), {
      replace: true,
    });
  };

  const org = useQuery({
    queryKey: ['people-organisation'],
    queryFn: () => api.get('/api/people/organisation'),
  });
  const quick = useQuery({
    queryKey: ['people-quick', filters.companyId],
    queryFn: () => api.get(`/api/people/quick-filters${qs({ companyId: filters.companyId })}`),
  });
  const list = useQuery({
    queryKey: ['employees', filters],
    queryFn: () =>
      api.get(
        `/api/people/employees${qs({ ...filters, status: filters.status === 'ALL' ? '' : filters.status })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const filtered =
    filters.search ||
    filters.companyId ||
    filters.departmentId ||
    filters.employmentType ||
    filters.filter ||
    filters.status !== 'ACTIVE';
  const departmentChoices = (org.data?.departments ?? []).filter(
    (d) => !filters.companyId || String(d.companyId ?? 'none') === filters.companyId,
  );

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Employees"
        description={
          list.data ? `${list.data.total} ${list.data.total === 1 ? 'person' : 'people'}` : undefined
        }
        actions={
          canEdit && (
            <>
              <ButtonLink to="/people/import">
                <FileUp className="size-4" aria-hidden /> Import
              </ButtonLink>
              <ButtonLink to="/people/employees/new" variant="primary">
                <Plus className="size-4" aria-hidden /> Add employee
              </ButtonLink>
            </>
          )
        }
      />

      <form
        className="mb-3 flex flex-wrap gap-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ search: search.trim() });
        }}
      >
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
          <Input
            aria-label="Search by name, job title, employee number or email"
            placeholder="Name, job title, number or email"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => search.trim() !== filters.search && update({ search: search.trim() })}
          />
        </div>
        <Select
          aria-label="Company"
          className="w-full sm:w-56"
          value={filters.companyId}
          onChange={(e) => update({ companyId: e.target.value, departmentId: '' })}
        >
          <option value="">All companies</option>
          {org.data?.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {(org.data?.employeesWithoutCompany || filters.companyId === 'none') && (
            <option value="none">No company set</option>
          )}
        </Select>
        <Select
          aria-label="Department"
          className="w-full sm:w-48"
          value={filters.departmentId}
          onChange={(e) => update({ departmentId: e.target.value })}
        >
          <option value="">All departments</option>
          <DepartmentOptions departments={departmentChoices} />
        </Select>
        <Select
          aria-label="Employment type"
          className="w-full sm:w-44"
          value={filters.employmentType}
          onChange={(e) => update({ employmentType: e.target.value })}
        >
          <option value="">All types</option>
          {Object.entries(EMPLOYMENT_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Status"
          className="w-full sm:w-36"
          value={filters.status}
          onChange={(e) => update({ status: e.target.value })}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Left</option>
          <option value="ALL">Everyone</option>
        </Select>
      </form>

      {quick.data && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Quick filters">
          <Chip active={!filters.filter} onClick={() => update({ filter: '' })}>
            All
          </Chip>
          {Object.entries(quick.data)
            .filter(([k, f]) => f.count > 0 || filters.filter === k)
            .map(([k, f]) => (
              <Chip
                key={k}
                active={filters.filter === k}
                onClick={() => update({ filter: k, status: 'ACTIVE' })}
              >
                {f.label} <span className="ml-1 font-semibold">{f.count}</span>
              </Chip>
            ))}
        </div>
      )}

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          {filtered ? (
            <EmptyState title="Nobody matches these filters." />
          ) : (
            <EmptyState
              title="No employees yet."
              action={
                canEdit && (
                  <>
                    <ButtonLink to="/people/import">Import from a spreadsheet</ButtonLink>
                    <ButtonLink to="/people/employees/new" variant="primary">
                      Add employee
                    </ButtonLink>
                  </>
                )
              }
            >
              Add staff one at a time, or import your staff list from a CSV file.
            </EmptyState>
          )}
        </div>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Job title</Th>
                <Th>Department</Th>
                <Th>Line manager</Th>
                <Th>Type</Th>
                <Th>Started</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((e) => (
                <tr key={e.id} className="hover:bg-canvas">
                  <Td>
                    <div className="flex items-center gap-3">
                      <Initials first={e.firstName} last={e.lastName} />
                      <div className="min-w-0">
                        <Link
                          to={`/people/employees/${e.id}`}
                          className="font-medium text-brand hover:underline"
                        >
                          {e.firstName} {e.lastName}
                        </Link>
                        <p className="text-xs text-muted">
                          {[e.employeeNumber, e.company].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>{e.jobTitle ?? <span className="text-muted">Not set</span>}</Td>
                  <Td>{e.department ?? <span className="text-muted">None</span>}</Td>
                  <Td>
                    {e.lineManagerId ? (
                      <Link to={`/people/employees/${e.lineManagerId}`} className="hover:underline">
                        {e.lineManager}
                      </Link>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </Td>
                  <Td>{EMPLOYMENT_TYPES[e.employmentType] ?? <span className="text-muted">Not set</span>}</Td>
                  <Td className="whitespace-nowrap">{formatDate(e.employmentStartDate)}</Td>
                  <Td>
                    <StatusBadge e={e} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPage={(page) => update({ page })}
          />
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? 'border-brand bg-brand-soft font-medium text-brand'
          : 'border-rule bg-white text-ink hover:border-muted'
      }`}
    >
      {children}
    </button>
  );
}
