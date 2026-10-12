import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Button,
  ConfirmDialog,
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
          {list.data.roles.map((role) => (
            <RoleSection key={role.code} role={role} people={people.data.items} />
          ))}
          <ManagersSection managers={list.data.managers} people={people.data.items} />
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
      <p className="text-xs text-muted">{[p.jobTitle, p.company].filter(Boolean).join(' · ')}</p>
    </Td>
  );
}

function RoleSection({ role, people }) {
  const refresh = useRefresh();
  const [adding, setAdding] = useState('');
  const [removing, setRemoving] = useState(null);
  const add = useMutation({
    mutationFn: () => api.post(`/api/admin/roles/${role.code}/holders`, { employeeId: Number(adding) }),
    onSuccess: () => {
      setAdding('');
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (p) => api.del(`/api/admin/roles/${role.code}/holders/${p.id}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });
  const holderIds = new Set(role.holders.map((h) => h.id));

  return (
    <Section title={role.name} description={role.description}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (adding) add.mutate();
        }}
      >
        <Field id={`add-${role.code}`} label={`Give the ${role.name} role to`} className="w-full max-w-md">
          <Select id={`add-${role.code}`} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Choose a person</option>
            {people
              .filter((p) => !holderIds.has(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </Select>
        </Field>
        <Button type="submit" busy={add.isPending} disabled={!adding}>
          Add
        </Button>
      </form>
      {add.isError && (
        <div className="mt-3">
          <Notice tone="danger">{add.error.message}</Notice>
        </div>
      )}
      {remove.isError && (
        <div className="mt-3">
          <Notice tone="danger">{remove.error.message}</Notice>
        </div>
      )}
      <div className="mt-4">
        {role.holders.length === 0 ? (
          <p className="text-sm text-muted">Nobody has this role.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Employee no.</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {role.holders.map((p) => (
                <tr key={p.id}>
                  <PersonCell p={p} />
                  <Td>{p.employeeNumber}</Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => {
                        remove.reset();
                        setRemoving(p);
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
      </div>
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${role.name} role?`}
        confirmLabel="Remove role"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      >
        {removing?.name} will lose the {role.name} role straight away.
      </ConfirmDialog>
    </Section>
  );
}

function ManagersSection({ managers, people }) {
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
    <Section
      title="Managers"
      description="Anyone with direct reports is a manager and approves their leave. Choose a person and who reports to them."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (managerId && chosen.size) assign.mutate();
        }}
      >
        <Field id="mgr" label="Manager" className="max-w-md">
          <Select
            id="mgr"
            value={managerId}
            onChange={(e) => {
              setManagerId(e.target.value);
              setChosen(new Set());
              assign.reset();
            }}
          >
            <option value="">Choose a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {managerId && (
          <div>
            <p className="text-sm font-medium">Reports to them</p>
            <Input
              aria-label="Search people"
              placeholder="Search by name or employee number"
              className="mt-1 max-w-md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul className="mt-2 max-h-64 max-w-md overflow-y-auto rounded-md border border-rule bg-white">
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
        <div>
          <Button type="submit" busy={assign.isPending} disabled={!managerId || chosen.size === 0}>
            {chosen.size
              ? `Add ${chosen.size} direct ${chosen.size === 1 ? 'report' : 'reports'}`
              : 'Add direct reports'}
          </Button>
        </div>
      </form>

      {unlink.isError && (
        <div className="mt-3">
          <Notice tone="danger">{unlink.error.message}</Notice>
        </div>
      )}
      <div className="mt-6">
        {managers.length === 0 ? (
          <p className="text-sm text-muted">Nobody has direct reports yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Manager</Th>
                <Th>Direct reports</Th>
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
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
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
    </Section>
  );
}
