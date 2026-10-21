import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import {
  Badge,
  Button,
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

const empty = { companyId: '', code: '', name: '', parentId: '' };

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['departments'], queryFn: () => api.get('/api/admin/departments') });
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get('/api/admin/companies') });
  const [companyFilter, setCompanyFilter] = useState('');
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);

  const save = useMutation({
    mutationFn: (body) =>
      editingId
        ? api.patch(`/api/admin/departments/${editingId}`, body)
        : api.post('/api/admin/departments', body),
    onSuccess: () => {
      setForm(empty);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['people-organisation'] });
      qc.invalidateQueries({ queryKey: ['people-companies'] });
      qc.invalidateQueries({ queryKey: ['people-departments'] });
    },
  });
  const toggle = useMutation({
    mutationFn: (d) => api.patch(`/api/admin/departments/${d.id}`, { isActive: !d.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  });

  const startEdit = (d) => {
    save.reset();
    setEditingId(d.id);
    setForm({
      companyId: d.companyId ? String(d.companyId) : '',
      code: d.code,
      name: d.name,
      parentId: d.parentId ? String(d.parentId) : '',
    });
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title="Departments" />
      <div className="grid gap-6">
        <Section title={editingId ? 'Edit department' : 'Add a department'}>
          <form
            className="grid gap-4 lg:grid-cols-[1fr_8rem_1fr_1fr_auto] lg:items-end sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({
                companyId: Number(form.companyId),
                code: form.code,
                name: form.name,
                parentId: form.parentId ? Number(form.parentId) : null,
              });
            }}
          >
            <Field id="deptCompany" label="Company">
              <Select
                id="deptCompany"
                value={form.companyId}
                onChange={(e) => setForm({ ...form, companyId: e.target.value, parentId: '' })}
                required
              >
                <option value="">Choose</option>
                {companies.data?.items
                  .filter((c) => c.isActive || String(c.id) === form.companyId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field id="deptCode" label="Code">
              <Input
                id="deptCode"
                placeholder="e.g. CRD"
                value={form.code}
                maxLength={20}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
              />
            </Field>
            <Field id="deptName" label="Name">
              <Input
                id="deptName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field id="deptParent" label="Part of">
              <Select
                id="deptParent"
                value={form.parentId}
                onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              >
                <option value="">None</option>
                {list.data?.items
                  .filter(
                    (d) => d.id !== editingId && d.isActive && String(d.companyId ?? '') === form.companyId,
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button type="submit" busy={save.isPending}>
                {editingId ? 'Save' : 'Add department'}
              </Button>
              {editingId && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingId(null);
                    setForm(empty);
                    save.reset();
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
          {save.isError && <Notice tone="danger">{save.error.message}</Notice>}
          {companies.data?.items.length === 0 && (
            <Notice tone="pending">
              Add the group&apos;s companies on the Companies page first; every department belongs to one.
            </Notice>
          )}
        </Section>

        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <LoadError error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <div className="rounded-md border border-rule bg-white">
            <EmptyState title="No departments yet.">Add your first department above.</EmptyState>
          </div>
        ) : (
          <>
            {toggle.isError && <Notice tone="danger">{toggle.error.message}</Notice>}
            <div className="flex items-end gap-3">
              <Field id="deptFilter" label="Company">
                <Select
                  id="deptFilter"
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                >
                  <option value="">All companies</option>
                  {companies.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  {(list.data.items.some((d) => !d.companyId) || companyFilter === 'none') && (
                    <option value="none">No company set</option>
                  )}
                </Select>
              </Field>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Company</Th>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Part of</Th>
                  <Th className="text-right">Active staff</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items
                  .filter((d) =>
                    companyFilter === 'none'
                      ? !d.companyId
                      : !companyFilter || String(d.companyId) === companyFilter,
                  )
                  .map((d) => (
                    <tr key={d.id}>
                      <Td>{d.company ?? <Badge tone="pending">Not set</Badge>}</Td>
                      <Td className="font-medium">{d.code}</Td>
                      <Td>{d.name}</Td>
                      <Td>{d.parentName ?? <span className="text-muted">None</span>}</Td>
                      <Td className="text-right">{d.activeEmployees}</Td>
                      <Td>{d.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                      <Td className="text-right whitespace-nowrap">
                        <Button variant="ghost" className="h-7 px-2" onClick={() => startEdit(d)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-7 px-2"
                          busy={toggle.isPending && toggle.variables?.id === d.id}
                          onClick={() => toggle.mutate(d)}
                        >
                          {d.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </>
        )}
      </div>
    </div>
  );
}
