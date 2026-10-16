import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import {
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

const weekday = (iso) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const empty = { holidayDate: '', name: '', sourceNote: '', isSubstitute: false, substitutesForId: '' };

export default function HolidaysPage() {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const list = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api.get(`/api/admin/holidays?year=${year}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['holidays'] });
  const save = useMutation({
    mutationFn: (body) =>
      editingId ? api.put(`/api/admin/holidays/${editingId}`, body) : api.post('/api/admin/holidays', body),
    onSuccess: () => {
      setForm(empty);
      setEditingId(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id) => api.del(`/api/admin/holidays/${id}`),
    onSuccess: refresh,
  });

  const originals = list.data?.items.filter((h) => !h.isSubstitute) ?? [];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Public holidays"
        actions={
          <Select
            aria-label="Year"
            className="w-28"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        }
      />
      <div className="grid gap-6">
        <Section title={editingId ? 'Edit holiday' : 'Add a holiday'}>
          <form
            className="grid gap-4 sm:grid-cols-[11rem_1fr_1fr]"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({
                holidayDate: form.holidayDate,
                name: form.name,
                sourceNote: form.sourceNote,
                isSubstitute: form.isSubstitute,
                substitutesForId:
                  form.isSubstitute && form.substitutesForId ? Number(form.substitutesForId) : null,
              });
            }}
          >
            <Field id="hDate" label="Date">
              <Input
                id="hDate"
                type="date"
                value={form.holidayDate}
                onChange={(e) => setForm({ ...form, holidayDate: e.target.value })}
                required
              />
            </Field>
            <Field id="hName" label="Name">
              <Input
                id="hName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field id="hSource" label="Source" hint="e.g. Gazette notice or statutory instrument">
              <Input
                id="hSource"
                value={form.sourceNote}
                onChange={(e) => setForm({ ...form, sourceNote: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand"
                  checked={form.isSubstitute}
                  onChange={(e) => setForm({ ...form, isSubstitute: e.target.checked })}
                />
                This is a substitute day for a holiday that fell on a weekend
              </label>
              {form.isSubstitute && (
                <Select
                  aria-label="Holiday it substitutes for"
                  className="mt-2 w-80"
                  value={form.substitutesForId}
                  onChange={(e) => setForm({ ...form, substitutesForId: e.target.value })}
                  required
                >
                  <option value="">Choose the original holiday</option>
                  {originals.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}, {formatDate(h.holidayDate)}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" busy={save.isPending}>
                {editingId ? 'Save' : 'Add holiday'}
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
          {save.isError && (
            <div className="mt-3">
              <Notice tone="danger">{save.error.message}</Notice>
            </div>
          )}
        </Section>

        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <LoadError error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <div className="rounded-md border border-rule bg-white">
            <EmptyState title={`No public holidays recorded for ${year}.`}>
              Add each gazetted holiday for the year. Leave calculations for {year} use this list.
            </EmptyState>
          </div>
        ) : (
          <>
            {remove.isError && <Notice tone="danger">{remove.error.message}</Notice>}
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Day</Th>
                  <Th>Holiday</Th>
                  <Th>Source</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((h) => (
                  <tr key={h.id}>
                    <Td className="whitespace-nowrap">{formatDate(h.holidayDate)}</Td>
                    <Td>{weekday(h.holidayDate)}</Td>
                    <Td>
                      {h.name}
                      {h.isSubstitute && <span className="block text-xs text-muted">Substitute day</span>}
                    </Td>
                    <Td className="text-muted">{h.sourceNote}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => {
                          save.reset();
                          setEditingId(h.id);
                          setForm({
                            holidayDate: h.holidayDate,
                            name: h.name,
                            sourceNote: h.sourceNote ?? '',
                            isSubstitute: h.isSubstitute,
                            substitutesForId: h.substitutesForId ? String(h.substitutesForId) : '',
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-danger"
                        onClick={() => window.confirm(`Delete ${h.name}?`) && remove.mutate(h.id)}
                      >
                        Delete
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
