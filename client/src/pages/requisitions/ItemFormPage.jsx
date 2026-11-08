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

/** Add an item (with optional opening stock) or edit one. */
export default function ItemFormPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['stock-options'], queryFn: () => api.get('/api/stock/options') });
  const item = useQuery({
    queryKey: ['stock-item', id],
    queryFn: () => api.get(`/api/stock/items/${id}`),
    enabled: !isNew,
  });
  const [v, setV] = useState({
    name: '',
    categoryId: '',
    description: '',
    reorderLevel: '5',
    unitPrice: '',
    openingQuantity: '',
    branchId: '',
    supplier: '',
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
  if (opts.isPending || (!isNew && item.isPending)) return <Loading />;
  if (opts.isError) return <LoadError error={opts.error} onRetry={opts.refetch} />;
  if (item.isError) return <LoadError error={item.error} onRetry={item.refetch} />;
  const locked = !isNew && item.data.hasHistory;
  const branches = opts.data.branches.filter((b) => b.isActive);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    const opening = Number(v.openingQuantity) || 0;
    if (isNew && opening > 0 && !v.branchId)
      return setError('Choose the branch that holds the opening stock.');
    setBusy(true);
    try {
      const body = {
        name: v.name.trim(),
        categoryId: Number(v.categoryId) || 0,
        description: v.description.trim(),
        reorderLevel: Number(v.reorderLevel),
        ...(locked ? {} : { unitPrice: Number(v.unitPrice) || 0 }),
        ...(isNew && opening > 0
          ? { openingQuantity: opening, branchId: Number(v.branchId), supplier: v.supplier.trim() }
          : {}),
      };
      const r = isNew
        ? await api.post('/api/stock/items', body)
        : await api.put(`/api/stock/items/${id}`, body);
      qc.invalidateQueries({ queryKey: ['stock-items'] });
      qc.invalidateQueries({ queryKey: ['stock-item'] });
      navigate(`/requisitions/stock/${r.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title={isNew ? 'Add item' : `Edit ${item.data.name}`} />
      <form onSubmit={save} noValidate>
        <Section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="i-name" label="Item name">
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
                <option value="">Choose a category</option>
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
              label="Unit price (K)"
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
              label="Reorder level"
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
            {isNew && (
              <>
                <Field id="i-open" label="Opening stock" optional>
                  <Input
                    id="i-open"
                    type="number"
                    min="0"
                    step="1"
                    value={v.openingQuantity}
                    onChange={set('openingQuantity')}
                    placeholder="0"
                  />
                </Field>
                <Field id="i-branch" label="Held at branch" optional={!(Number(v.openingQuantity) > 0)}>
                  <Select
                    id="i-branch"
                    value={v.branchId}
                    onChange={set('branchId')}
                    disabled={!(Number(v.openingQuantity) > 0)}
                  >
                    <option value="">{branches.length ? 'Choose a branch' : 'No branches yet'}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.company} › {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="i-supplier" label="Supplier" optional>
                  <Input
                    id="i-supplier"
                    value={v.supplier}
                    onChange={set('supplier')}
                    maxLength={200}
                    placeholder="Opening stock"
                  />
                </Field>
              </>
            )}
          </div>
          {error && (
            <div className="mt-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          <div className="mt-5 flex gap-2">
            <Button type="submit" busy={busy}>
              {isNew ? 'Add item' : 'Save changes'}
            </Button>
            <ButtonLink to={isNew ? '/requisitions/stock' : `/requisitions/stock/${id}`}>Cancel</ButtonLink>
          </div>
        </Section>
      </form>
    </div>
  );
}
