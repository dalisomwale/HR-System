import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
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
  Th,
} from '../../components/ui.jsx';

/* Laid out like Companies: a form card at the top, then a table with actions on each row. */

export default function RolesPage() {
  const list = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/api/admin/roles') });
  const people = useQuery({
    queryKey: ['employee-options'],
    queryFn: () => api.get('/api/admin/employees/options'),
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title="Roles" />
      {list.isPending || people.isPending ? (
        <Loading />
      ) : list.isError || people.isError ? (
        <LoadError
          error={list.error ?? people.error}
          onRetry={() => {
            list.refetch();
            people.refetch();
          }}
        />
      ) : (
        <div className="grid gap-6">
          <RoleHolders roles={list.data.roles} people={people.data.items} />
          <Managers managers={list.data.managers} people={people.data.items} />
        </div>
      )}
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['roles'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['employee'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
}

function PersonCell({ p }) {
  return (
    <Td>
      <Link to={`/admin/employees/${p.id}`} className="font-medium text-brand hover:underline">
        {p.name}
      </Link>
      {(p.jobTitle || p.company) && (
        <p className="text-xs text-muted">{[p.jobTitle, p.company].filter(Boolean).join(' · ')}</p>
      )}
    </Td>
  );
}

function RoleHolders({ roles, people }) {
  const refresh = useRefresh();
  const [form, setForm] = useState({ employeeId: '', code: '' });
  const [removing, setRemoving] = useState(null);
  const add = useMutation({
    mutationFn: () =>
      api.post(`/api/admin/roles/${form.code}/holders`, { employeeId: Number(form.employeeId) }),
    onSuccess: () => {
      setForm({ employeeId: '', code: '' });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (row) => api.del(`/api/admin/roles/${row.code}/holders/${row.person.id}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });

  const rows = roles.flatMap((r) => r.holders.map((person) => ({ code: r.code, role: r.name, person })));
  const chosenRole = roles.find((r) => r.code === form.code);
  const alreadyHas = chosenRole?.holders.some((h) => String(h.id) === form.employeeId);

  return (
    <>
      <Section title="Give a role">
        <form
          className="grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field id="rolePerson" label="Person">
            <Select
              id="rolePerson"
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              required
            >
              <option value="">Choose</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="roleCode" label="Role">
            <Select
              id="roleCode"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
            >
              <option value="">Choose</option>
              {roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" busy={add.isPending} disabled={!form.employeeId || !form.code || alreadyHas}>
            Add role
          </Button>
        </form>
        {alreadyHas && (
          <p className="mt-2 text-sm text-muted">This person already has the {chosenRole.name} role.</p>
        )}
        {add.isError && (
          <div className="mt-3">
            <Notice tone="danger">{add.error.message}</Notice>
          </div>
        )}
      </Section>

      {remove.isError && <Notice tone="danger">{remove.error.message}</Notice>}
      {rows.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title="Nobody has a role yet." />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Employee no.</Th>
              <Th>Role</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.code}-${row.person.id}`}>
                <PersonCell p={row.person} />
                <Td>{row.person.employeeNumber}</Td>
                <Td>
                  <Badge tone="brand">{row.role}</Badge>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => {
                      remove.reset();
                      setRemoving(row);
                    }}
                  >
                    Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.role} role?`}
        confirmLabel="Remove role"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      >
        {removing?.person.name} will lose the {removing?.role} role straight away.
      </ConfirmDialog>
    </>
  );
}

function Managers({ managers, people }) {
  const refresh = useRefresh();
  const [managerId, setManagerId] = useState('');
  const [chosen, setChosen] = useState(new Set());
  const [search, setSearch] = useState('');
  const [unlinking, setUnlinking] = useState(null);

  const assign = useMutation({
    mutationFn: () =>
      api.post('/api/admin/roles/manager/reports', {
        managerId: Number(managerId),
        employeeIds: [...chosen],
      }),
    onSuccess: () => {
      setChosen(new Set());
      setSearch('');
      refresh();
    },
  });
  const unlink = useMutation({
    mutationFn: (r) => api.del(`/api/admin/roles/manager/reports/${r.id}`),
    onSuccess: () => {
      setUnlinking(null);
      refresh();
    },
  });

  const candidates = useMemo(() => {
    const current = new Set(managers.find((m) => String(m.id) === managerId)?.reports.map((r) => r.id) ?? []);
    const q = search.trim().toLowerCase();
    return people.filter(
      (p) => String(p.id) !== managerId && !current.has(p.id) && (!q || p.label.toLowerCase().includes(q)),
    );
  }, [people, managers, managerId, search]);
  const toggle = (id) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <Section title="Add direct reports">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (managerId && chosen.size) assign.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field id="mgr" label="Manager">
              <Select
                id="mgr"
                value={managerId}
                onChange={(e) => {
                  setManagerId(e.target.value);
                  setChosen(new Set());
                  assign.reset();
                }}
              >
                <option value="">Choose</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" busy={assign.isPending} disabled={!managerId || chosen.size === 0}>
              {chosen.size
                ? `Add ${chosen.size} direct ${chosen.size === 1 ? 'report' : 'reports'}`
                : 'Add direct reports'}
            </Button>
          </div>
          {managerId && (
            <div>
              <p className="text-sm font-medium">Reports to them</p>
              <Input
                aria-label="Search people"
                placeholder="Search by name or employee number"
                className="mt-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-rule bg-white">
                {candidates.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted">Nobody else to add.</li>
                ) : (
                  candidates.map((p) => (
                    <li key={p.id} className="border-b border-rule last:border-0">
                      <label className="flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-canvas">
                        <input
                          type="checkbox"
                          className="size-4 accent-brand"
                          checked={chosen.has(p.id)}
                          onChange={() => toggle(p.id)}
                        />
                        {p.label}
                      </label>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
          {assign.isError && <Notice tone="danger">{assign.error.message}</Notice>}
        </form>
      </Section>

      {unlink.isError && <Notice tone="danger">{unlink.error.message}</Notice>}
      {managers.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title="Nobody has direct reports yet." />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Manager</Th>
              <Th>Direct reports</Th>
              <Th className="text-right">Team size</Th>
            </tr>
          </thead>
          <tbody>
            {managers.map((m) => (
              <tr key={m.id}>
                <PersonCell p={m} />
                <Td>
                  <ul className="flex flex-wrap gap-1.5">
                    {m.reports.map((r) => (
                      <li
                        key={r.id}
                        className="inline-flex items-center gap-1 rounded-sm bg-neutral-bg py-0.5 pr-1 pl-2 text-xs"
                      >
                        {r.name}
                        <button
                          type="button"
                          aria-label={`Remove ${r.name} from ${m.name}'s team`}
                          className="rounded-sm p-0.5 text-muted hover:bg-white hover:text-ink"
                          onClick={() => {
                            unlink.reset();
                            setUnlinking({ ...r, managerName: m.name });
                          }}
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Td>
                <Td className="text-right">{m.reports.length}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={!!unlinking}
        title="Remove from team?"
        confirmLabel="Remove"
        tone="danger"
        busy={unlink.isPending}
        onConfirm={() => unlink.mutate(unlinking)}
        onCancel={() => setUnlinking(null)}
      >
        {unlinking?.name} will no longer report to {unlinking?.managerName} and will have no manager until you
        choose a new one. Requests already waiting stay with the manager they were sent to.
      </ConfirmDialog>
    </>
  );
}
