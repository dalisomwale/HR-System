import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Plus, Search, FileUp } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import DepartmentOptions from '../../components/DepartmentOptions.jsx';
import { ROLE_LABELS } from '../../lib/format.js';
import {
  Badge,
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

export default function EmployeesPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? 'ACTIVE',
    companyId: params.get('companyId') ?? '',
    departmentId: params.get('departmentId') ?? '',
    page: Number(params.get('page') ?? 1),
  };
  const update = (patch) => {
    const next = { ...filters, page: 1, ...patch };
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '' && v !== 1)), {
      replace: true,
    });
  };

  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get('/api/admin/companies') });
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/api/admin/departments'),
  });
  const list = useQuery({
    queryKey: ['employees', filters],
    queryFn: () =>
      api.get(
        `/api/admin/employees${qs({ ...filters, status: filters.status === 'ALL' ? '' : filters.status })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const filtered = filters.search || filters.companyId || filters.departmentId || filters.status !== 'ACTIVE';
  const departmentChoices = (departments.data?.items ?? []).filter(
    (d) => !filters.companyId || String(d.companyId ?? 'none') === filters.companyId,
  );

  return (
    <div>
      <PageHeader
        title="Employees"
        actions={
          <>
            <ButtonLink to="/admin/import">
              <FileUp className="size-4" aria-hidden /> Import
            </ButtonLink>
            <ButtonLink to="/admin/employees/new" variant="primary">
              <Plus className="size-4" aria-hidden /> Add employee
            </ButtonLink>
          </>
        }
      />

      <form
        className="mb-4 flex flex-wrap gap-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ search: search.trim() });
        }}
      >
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
          <Input
            aria-label="Search by name, employee number or email"
            placeholder="Name, employee number or email"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => search.trim() !== filters.search && update({ search: search.trim() })}
          />
        </div>
        <Select
          aria-label="Status"
          className="w-40"
          value={filters.status}
          onChange={(e) => update({ status: e.target.value })}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ALL">All statuses</option>
        </Select>
        <Select
          aria-label="Company"
          className="w-64"
          value={filters.companyId}
          onChange={(e) => update({ companyId: e.target.value, departmentId: '' })}
        >
          <option value="">All companies</option>
          {companies.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {(companies.data?.employeesWithoutCompany || filters.companyId === 'none') && (
            <option value="none">No company set</option>
          )}
        </Select>
        <Select
          aria-label="Department"
          className="w-56"
          value={filters.departmentId}
          onChange={(e) => update({ departmentId: e.target.value })}
        >
          <option value="">All departments</option>
          <DepartmentOptions departments={departmentChoices} />
        </Select>
      </form>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          {filtered ? (
            <EmptyState title="No employees match these filters." />
          ) : (
            <EmptyState
              title="No employees found."
              action={
                <>
                  <ButtonLink to="/admin/import">Import from a spreadsheet</ButtonLink>
                  <ButtonLink to="/admin/employees/new" variant="primary">
                    Add employee
                  </ButtonLink>
                </>
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
                <Th>Name</Th>
                <Th>Employee no.</Th>
                <Th>Company</Th>
                <Th>Department</Th>
                <Th>Manager</Th>
                <Th>Microsoft account</Th>
                <Th>Roles</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((e) => (
                <tr key={e.id} className="hover:bg-canvas">
                  <Td>
                    <Link to={`/admin/employees/${e.id}`} className="font-medium text-brand hover:underline">
                      {e.firstName} {e.lastName}
                    </Link>
                    {e.jobTitle && <p className="text-xs text-muted">{e.jobTitle}</p>}
                  </Td>
                  <Td>{e.employeeNumber}</Td>
                  <Td>{e.company ?? <Badge tone="pending">Not set</Badge>}</Td>
                  <Td>{e.department ?? <span className="text-muted">None</span>}</Td>
                  <Td>{e.lineManager ?? <span className="text-muted">None</span>}</Td>
                  <Td>
                    {e.linked ? <Badge tone="ok">Linked</Badge> : <Badge tone="pending">Not linked</Badge>}
                  </Td>
                  <Td>
                    {e.roles.length ? (
                      <div className="flex flex-wrap gap-1">
                        {e.roles.map((r) => (
                          <Badge key={r} tone="brand">
                            {ROLE_LABELS[r]}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">Employee</span>
                    )}
                  </Td>
                  <Td>{e.status === 'ACTIVE' ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</Td>
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
