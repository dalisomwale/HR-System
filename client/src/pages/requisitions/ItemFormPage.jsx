import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import {
  Button,
  ButtonLink,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '../../components/ui.jsx';
import { errorText } from './rq.js';

/** Edit a stock item. New items are added by receiving them (Receive Stock › Receive New Item). */
export default function ItemFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['stock-options'], queryFn: () => api.get('/api/stock/options') });
  const item = useQuery({
    queryKey: ['stock-item', id],
    queryFn: () => api.get(`/api/stock/items/${id}`),
  });
  const [v, setV] = useState({
    name: '',
    categoryId: '',
    description: '',
    reorderLevel: '5',
    unitPrice: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item.data) {
      const it = item.data;
      setV((x) => ({
        ...x,
        name: it.name,
        categoryId: String(it.categoryId),
        description: it.description ?? '',
        reorderLevel: String(it.reorderLevel),
        unitPrice: String(it.unitPrice),
      }));
    }
  }, [item.data]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  if (opts.isPending || item.isPending) return <Loading />;
  if (opts.isError) return <LoadError error={opts.error} onRetry={opts.refetch} />;
  if (item.isError) return <LoadError error={item.error} onRetry={item.refetch} />;
  const locked = item.data.hasHistory;

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: v.name.trim(),
        categoryId: Number(v.categoryId) || 0,
        description: v.description.trim(),
        reorderLevel: Number(v.reorderLevel),
        ...(locked ? {} : { unitPrice: Number(v.unitPrice) || 0 }),
      };
      const r = await api.put(`/api/stock/items/${id}`, body);
      qc.invalidateQueries({ queryKey: ['stock-items'] });
      qc.invalidateQueries({ queryKey: ['stock-item'] });
      navigate(`/inventory/stock/${r.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${item.data.name}`} />
      <form onSubmit={save} noValidate>
        <Section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="i-name" label="Item Name">
              <Input
                id="i-name"
                value={v.name}
                onChange={set('name')}
                maxLength={200}
                placeholder="e.g. A4 paper ream"
              />
            </Field>
            <Field id="i-cat" label="Category">
              <Select id="i-cat" value={v.categoryId} onChange={set('categoryId')}>
                <option value="">Choose A Category</option>
                {opts.data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="i-desc" label="Description" optional className="sm:col-span-2">
              <Textarea
                id="i-desc"
                rows={2}
                maxLength={500}
                value={v.description}
                onChange={set('description')}
              />
            </Field>
            <Field
              id="i-price"
              label="Unit Price (K)"
              hint={locked ? 'Set by deliveries now that the item has stock history.' : undefined}
            >
              <Input
                id="i-price"
                type="number"
                min="0"
                step="0.01"
                value={v.unitPrice}
                onChange={set('unitPrice')}
                disabled={locked}
                placeholder="0.00"
              />
            </Field>
            <Field
              id="i-reorder"
              label="Reorder Level"
              hint="You'll be warned when stock falls to this level."
            >
              <Input
                id="i-reorder"
                type="number"
                min="0"
                step="1"
                value={v.reorderLevel}
                onChange={set('reorderLevel')}
              />
            </Field>
          </div>
          {error && (
            <div className="mt-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          <div className="mt-5 flex gap-2">
            <Button type="submit" busy={busy}>
              Save Changes
            </Button>
            <ButtonLink to={`/inventory/stock/${id}`}>Cancel</ButtonLink>
          </div>
        </Section>
      </form>
    </div>
  );
}
