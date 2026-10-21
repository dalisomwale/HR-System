import { useState } from 'react';
import { Link } from 'react-router';
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
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';

const empty = { code: '', name: '' };

export default function CompaniesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['companies'], queryFn: () => api.get('/api/admin/companies') });
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['companies'] });
    qc.invalidateQueries({ queryKey: ['departments'] });
    qc.invalidateQueries({ queryKey: ['people-organisation'] });
    qc.invalidateQueries({ queryKey: ['people-companies'] });
    qc.invalidateQueries({ queryKey: ['people-departments'] });
  };
  const save = useMutation({
    mutationFn: (body) =>
      editingId
        ? api.patch(`/api/admin/companies/${editingId}`, body)
        : api.post('/api/admin/companies', body),
    onSuccess: () => {
      setForm(empty);
      setEditingId(null);
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (c) => api.patch(`/api/admin/companies/${c.id}`, { isActive: !c.isActive }),
    onSuccess: refresh,
  });

  const startEdit = (c) => {
    save.reset();
    setEditingId(c.id);
    setForm({ code: c.code, name: c.name });
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title="Companies" />
      <div className="grid gap-6">
        <Section title={editingId ? 'Edit company' : 'Add a company'}>
          <form
            className="grid gap-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ code: form.code, name: form.name });
            }}
          >
            <Field id="coCode" label="Code">
              <Input
                id="coCode"
                value={form.code}
                maxLength={20}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
              />
            </Field>
            <Field id="coName" label="Registered name">
              <Input
                id="coName"
                value={form.name}
                maxLength={160}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" busy={save.isPending}>
                {editingId ? 'Save' : 'Add company'}
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
        </Section>

        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <LoadError error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <>
            {list.data.activeWithoutCompany > 0 && (
              <Notice tone="pending" title="Staff without a company">
                {list.data.activeWithoutCompany} active employee
                {list.data.activeWithoutCompany === 1 ? ' has' : 's have'} no company.{' '}
                <Link to="/people/employees?companyId=none" className="underline">
                  Show them
                </Link>
              </Notice>
            )}
            {list.data.items.length === 0 ? (
              <div className="rounded-md border border-rule bg-white">
                <EmptyState title="No companies yet.">Add the companies in the group above.</EmptyState>
              </div>
            ) : (
              <>
                {toggle.isError && <Notice tone="danger">{toggle.error.message}</Notice>}
                <Table>
                  <thead>
                    <tr>
                      <Th>Code</Th>
                      <Th>Name</Th>
                      <Th className="text-right">Departments</Th>
                      <Th className="text-right">Active staff</Th>
                      <Th>Status</Th>
                      <Th>
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((c) => (
                      <tr key={c.id}>
                        <Td className="font-medium">{c.code}</Td>
                        <Td>{c.name}</Td>
                        <Td className="text-right">{c.departments}</Td>
                        <Td className="text-right">
                          <Link
                            to={`/people/employees?companyId=${c.id}`}
                            className="text-brand hover:underline"
                          >
                            {c.activeEmployees}
                          </Link>
                        </Td>
                        <Td>{c.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                        <Td className="text-right whitespace-nowrap">
                          <Button variant="ghost" className="h-7 px-2" onClick={() => startEdit(c)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="h-7 px-2"
                            busy={toggle.isPending && toggle.variables?.id === c.id}
                            onClick={() => toggle.mutate(c)}
                          >
                            {c.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
