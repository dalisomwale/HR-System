import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import {
  Badge,
  Button,
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

const DAYS = [
  ['mon', 'Mon'],
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
  ['sun', 'Sun'],
];
const FRACTION = { 1: 'Full', 0.5: 'Half', 0: 'Off' };
const empty = {
  name: '',
  isCompanyDefault: false,
  days: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 0, sun: 0 },
};

export default function SchedulesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['schedules'], queryFn: () => api.get('/api/admin/work-schedules') });
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const save = useMutation({
    mutationFn: (body) =>
      editingId
        ? api.put(`/api/admin/work-schedules/${editingId}`, body)
        : api.post('/api/admin/work-schedules', body),
    onSuccess: () => {
      setForm(empty);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title="Working schedules" />
      <div className="grid gap-6">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <LoadError error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Schedule</Th>
                {DAYS.map(([, l]) => (
                  <Th key={l} className="text-center">
                    {l}
                  </Th>
                ))}
                <Th className="text-right">Staff</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <span className="font-medium">{s.name}</span>{' '}
                    {s.isCompanyDefault && <Badge tone="brand">Company default</Badge>}
                  </Td>
                  {DAYS.map(([d]) => (
                    <Td key={d} className={s.days[d] === 0 ? 'text-center text-muted' : 'text-center'}>
                      {FRACTION[s.days[d]]}
                    </Td>
                  ))}
                  <Td className="text-right">{s.employees}</Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => {
                        save.reset();
                        setEditingId(s.id);
                        setForm({ name: s.name, isCompanyDefault: s.isCompanyDefault, days: { ...s.days } });
                      }}
                    >
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <Section title={editingId ? 'Edit schedule' : 'Add a schedule'}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
            className="space-y-4"
          >
            <Field id="sName" label="Name" className="max-w-sm">
              <Input
                id="sName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Working days</legend>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {DAYS.map(([d, l]) => (
                  <label key={d} className="text-xs text-muted">
                    {l}
                    <Select
                      className="mt-1"
                      value={form.days[d]}
                      onChange={(e) =>
                        setForm({ ...form, days: { ...form.days, [d]: Number(e.target.value) } })
                      }
                    >
                      <option value={1}>Full</option>
                      <option value={0.5}>Half</option>
                      <option value={0}>Off</option>
                    </Select>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-brand"
                checked={form.isCompanyDefault}
                onChange={(e) => setForm({ ...form, isCompanyDefault: e.target.checked })}
              />
              Company default
            </label>
            {save.isError && <Notice tone="danger">{save.error.message}</Notice>}
            <div className="flex gap-2">
              <Button type="submit" busy={save.isPending}>
                {editingId ? 'Save' : 'Add schedule'}
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
        </Section>
      </div>
    </div>
  );
}
