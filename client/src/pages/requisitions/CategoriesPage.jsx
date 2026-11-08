import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
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
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { errorText, kwachaWhole, units, useRq } from './rq.js';

/** Stock categories: Stores add, rename and delete them. */
export default function CategoriesPage() {
  const qc = useQueryClient();
  const rq = useRq();
  const q = useQuery({ queryKey: ['stock-categories'], queryFn: () => api.get('/api/stock/categories') });
  const [editing, setEditing] = useState(null); // null, 'new' or a category
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const canEdit = rq.data?.stores;
  const refresh = (text) => {
    setMsg({ tone: 'ok', text });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ['stock-categories'] });
    qc.invalidateQueries({ queryKey: ['stock-options'] });
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/stock/categories/${del.id}`);
      refresh(`Category "${del.name}" deleted.`);
    } catch (err) {
      setMsg({ tone: 'danger', text: err.message });
    } finally {
      setBusy(false);
      setDel(null);
    }
  };
  return (
    <div>
      <PageHeader
        title="Categories"
        description="How stock items are grouped."
        actions={
          canEdit && editing !== 'new' && <Button onClick={() => setEditing('new')}>Add category</Button>
        }
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {editing === 'new' && (
        <div className="mb-6">
          <CategoryForm onDone={refresh} onCancel={() => setEditing(null)} />
        </div>
      )}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="rounded-md border border-rule bg-white">
            <EmptyState title="No categories yet." />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th className="text-right">Items</Th>
                <Th className="text-right">Units in stock</Th>
                <Th className="text-right">Stock value</Th>
                {canEdit && (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((c) =>
                editing?.id === c.id ? (
                  <tr key={c.id}>
                    <Td className="p-0" colSpan={canEdit ? 5 : 4}>
                      <CategoryForm category={c} onDone={refresh} onCancel={() => setEditing(null)} />
                    </Td>
                  </tr>
                ) : (
                  <tr key={c.id}>
                    <Td>
                      <Link
                        to={`/requisitions/stock?categoryId=${c.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {c.name}
                      </Link>
                      {c.description && <p className="text-xs text-muted">{c.description}</p>}
                    </Td>
                    <Td className="text-right tabular-nums">{units(c.items)}</Td>
                    <Td className="text-right tabular-nums">{units(c.units)}</Td>
                    <Td className="text-right tabular-nums">{kwachaWhole(c.value)}</Td>
                    {canEdit && (
                      <Td className="text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEditing(c)}
                          className="rounded-sm p-1.5 text-muted hover:bg-canvas hover:text-ink"
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={!c.canDelete}
                          title={c.canDelete ? undefined : "Can't delete: it has items or requisitions"}
                          onClick={() => setDel(c)}
                          className="rounded-sm p-1.5 text-muted hover:bg-danger-bg hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                          aria-label={
                            c.canDelete
                              ? `Delete ${c.name}`
                              : `Can't delete ${c.name}: it has items or requisitions`
                          }
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </Td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </Table>
        ))}
      <ConfirmDialog
        open={Boolean(del)}
        title="Delete category"
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDel(null)}
      >
        Delete the category {del?.name}?
      </ConfirmDialog>
    </div>
  );
}

function CategoryForm({ category, onDone, onCancel }) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), description: description.trim() };
      if (category) await api.put(`/api/stock/categories/${category.id}`, body);
      else await api.post('/api/stock/categories', body);
      onDone(`Category "${body.name}" ${category ? 'saved' : 'added'}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={category ? `Edit ${category.name}` : 'Add category'} className="border-0">
      <form onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id={`c-name-${category?.id ?? 'new'}`} label="Category name">
          <Input
            id={`c-name-${category?.id ?? 'new'}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </Field>
        <Field id={`c-desc-${category?.id ?? 'new'}`} label="Description" optional>
          <Input
            id={`c-desc-${category?.id ?? 'new'}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={255}
          />
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" busy={busy}>
            {category ? 'Save' : 'Add category'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}
