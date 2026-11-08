import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Textarea,
} from '../../components/ui.jsx';
import { RecentMovements } from './TransactionsPage.jsx';
import { errorText, today, units } from './rq.js';

/** Record a delivery: a new item or more of an existing one, at a branch; optionally a paid requisition. */
export default function ReceivePage() {
  const [search] = useSearchParams();
  const requisitionId = search.get('requisition') ?? '';
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['stock-options'], queryFn: () => api.get('/api/stock/options') });
  const form = useQuery({
    queryKey: ['receive-form', requisitionId],
    queryFn: () =>
      api.get(`/api/stock/receive/form${requisitionId ? `?requisitionId=${requisitionId}` : ''}`),
  });
  const [msg, setMsg] = useState(null);
  const [done, setDone] = useState(false);
  if (opts.isPending || form.isPending) return <Loading />;
  if (opts.isError) return <LoadError error={opts.error} onRetry={opts.refetch} />;
  if (form.isError) return <LoadError error={form.error} onRetry={form.refetch} />;
  const branches = opts.data.branches.filter((b) => b.isActive);
  const r = done ? null : form.data.requisition;
  const finished = (text) => {
    setMsg({ tone: 'ok', text });
    if (r) setDone(true);
    qc.invalidateQueries({ queryKey: ['receive-form'] });
    qc.invalidateQueries({ queryKey: ['stock-items'] });
    qc.invalidateQueries({ queryKey: ['stock-movements'] });
    qc.invalidateQueries({ queryKey: ['requisition'] });
    qc.invalidateQueries({ queryKey: ['requisitions'] });
    qc.invalidateQueries({ queryKey: ['rq-me'] });
  };
  return (
    <div>
      <PageHeader title="Receive stock" description="Record a delivery at a branch." />
      {requisitionId && !form.data.requisition && !done && (
        <div className="mb-4">
          <Notice tone="pending">
            That requisition isn't waiting to be received. Only paid requisitions can be received.
          </Notice>
        </div>
      )}
      {r && (
        <div className="mb-4">
          <Notice
            tone="neutral"
            title={`Receiving ${r.ref}: ${r.quantity} × ${r.itemName}${r.supplier ? ` from ${r.supplier}` : ''}`}
          >
            Check the quantity that actually arrived. Receiving it marks the requisition as received.{' '}
            <Link to={`/requisitions/requests/${r.id}`} className="font-medium text-brand underline">
              Open {r.ref}
            </Link>
          </Notice>
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {branches.length === 0 ? (
        <Notice tone="danger">
          No branches are set up yet. The System Administrator adds them under Administration › Branches.
        </Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <NewItemForm
            key={`new-${r?.id ?? ''}-${done}`}
            opts={opts.data}
            branches={branches}
            r={r && !r.itemId ? r : null}
            onDone={finished}
          />
          <ExistingForm
            key={`ex-${r?.id ?? ''}-${done}`}
            form={form.data}
            branches={branches}
            r={r && r.itemId ? r : null}
            onDone={finished}
          />
        </div>
      )}
      <div className="mt-8">
        <RecentMovements type="received" title="Recent deliveries" />
      </div>
    </div>
  );
}

function defaultBranch(branches, r) {
  if (r?.branchId && branches.some((b) => b.id === r.branchId)) return String(r.branchId);
  const own = r?.companyId ? branches.filter((b) => b.companyId === r.companyId) : [];
  if (own.length === 1) return String(own[0].id);
  return branches.length === 1 ? String(branches[0].id) : '';
}

function BranchField({ id, branches, value, onChange }) {
  if (branches.length === 1) return null;
  return (
    <Field id={id} label="Receiving at branch">
      <Select id={id} value={value} onChange={onChange}>
        <option value="">Choose a branch</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.company} › {b.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function useSubmit(build, onDone) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.post('/api/stock/receive', build());
      setOpen(false);
      onDone(
        `Stock received at ${out.branch}. Previous: ${units(out.oldStock)} → New: ${units(out.newStock)}.${out.requisition ? ` ${out.requisition} is marked as received.` : ''}`,
      );
    } catch (err) {
      setError(errorText(err));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return { open, setOpen, busy, error, setError, go };
}

function NewItemForm({ opts, branches, r, onDone }) {
  const [v, setV] = useState({
    branchId: defaultBranch(branches, r),
    categoryId: r?.categoryId ? String(r.categoryId) : '',
    name: r?.itemName ?? '',
    description: '',
    supplier: r?.supplier ?? '',
    quantity: r ? String(r.quantity) : '',
    unitPrice: '',
    reorderLevel: '5',
    dateReceived: today(),
  });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const s = useSubmit(
    () => ({
      newItem: {
        name: v.name.trim(),
        categoryId: Number(v.categoryId) || 0,
        description: v.description.trim(),
      },
      branchId: Number(v.branchId) || 0,
      supplier: v.supplier.trim(),
      quantity: Number(v.quantity),
      unitPrice: Number(v.unitPrice) || 0,
      reorderLevel: Number(v.reorderLevel),
      dateReceived: v.dateReceived,
      ...(r ? { requisitionId: r.id } : {}),
    }),
    onDone,
  );
  const cat = opts.categories.find((c) => String(c.id) === v.categoryId)?.name;
  return (
    <Section title="Receive new item" description="For something that isn't in stock yet.">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !v.name.trim() ||
            !v.categoryId ||
            !v.supplier.trim() ||
            !(Number(v.quantity) > 0) ||
            !v.branchId
          ) {
            s.setError('Fill in the branch, category, item name, supplier and quantity.');
          } else s.setOpen(true);
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <BranchField id="n-branch" branches={branches} value={v.branchId} onChange={set('branchId')} />
        </div>
        <Field id="n-cat" label="Category">
          <Select id="n-cat" value={v.categoryId} onChange={set('categoryId')}>
            <option value="">Choose a category</option>
            {opts.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="n-name" label="Item name">
          <Input
            id="n-name"
            value={v.name}
            onChange={set('name')}
            maxLength={200}
            placeholder="e.g. A4 paper ream"
          />
        </Field>
        <Field id="n-desc" label="Description" optional className="sm:col-span-2">
          <Textarea
            id="n-desc"
            rows={2}
            maxLength={500}
            value={v.description}
            onChange={set('description')}
          />
        </Field>
        <Field id="n-supplier" label="Supplier">
          <Input id="n-supplier" value={v.supplier} onChange={set('supplier')} maxLength={200} />
        </Field>
        <Field id="n-qty" label="Quantity received">
          <Input id="n-qty" type="number" min="1" step="1" value={v.quantity} onChange={set('quantity')} />
        </Field>
        <Field id="n-price" label="Unit price (K)">
          <Input
            id="n-price"
            type="number"
            min="0"
            step="0.01"
            value={v.unitPrice}
            onChange={set('unitPrice')}
            placeholder="0.00"
          />
        </Field>
        <Field id="n-reorder" label="Reorder level" hint="Alert threshold for low stock.">
          <Input
            id="n-reorder"
            type="number"
            min="0"
            step="1"
            value={v.reorderLevel}
            onChange={set('reorderLevel')}
          />
        </Field>
        <Field id="n-date" label="Date received">
          <Input
            id="n-date"
            type="date"
            max={today()}
            value={v.dateReceived}
            onChange={set('dateReceived')}
          />
        </Field>
        {s.error && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{s.error}</Notice>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit">Receive new item</Button>
        </div>
      </form>
      <ConfirmDialog
        open={s.open}
        title="Receive new item"
        confirmLabel="Receive new item"
        busy={s.busy}
        onConfirm={s.go}
        onCancel={() => s.setOpen(false)}
      >
        Add {v.name.trim()} to {cat} and receive {v.quantity} from {v.supplier.trim()}?
      </ConfirmDialog>
    </Section>
  );
}

function ExistingForm({ form, branches, r, onDone }) {
  const [v, setV] = useState({
    branchId: defaultBranch(branches, r),
    itemId: r?.itemId ? String(r.itemId) : '',
    supplier: r?.supplier ?? '',
    quantity: r ? String(r.quantity) : '',
    unitPrice: '',
    reorderLevel: '',
    dateReceived: today(),
  });
  const [typedSupplier, setTypedSupplier] = useState(Boolean(r?.supplier));
  const item = form.items.find((i) => String(i.id) === v.itemId);
  // Price and reorder level start at the item's current values; the supplier at its last one.
  useEffect(() => {
    if (!item) return;
    setV((x) => ({
      ...x,
      unitPrice: x.unitPrice === '' || x.prevItem !== item.id ? String(item.unitPrice) : x.unitPrice,
      reorderLevel:
        x.reorderLevel === '' || x.prevItem !== item.id ? String(item.reorderLevel) : x.reorderLevel,
      supplier: !typedSupplier && item.lastSupplier ? item.lastSupplier : x.supplier,
      prevItem: item.id,
    }));
  }, [item, typedSupplier]);
  const available = useMemo(() => {
    if (!item || !v.branchId) return '—';
    return units(
      form.stock.find((s) => s.itemId === item.id && String(s.branchId) === v.branchId)?.quantity ?? 0,
    );
  }, [form.stock, item, v.branchId]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const groups = useMemo(() => {
    const g = new Map();
    for (const i of form.items) g.set(i.category, [...(g.get(i.category) ?? []), i]);
    return [...g.entries()];
  }, [form.items]);
  const s = useSubmit(
    () => ({
      itemId: Number(v.itemId),
      branchId: Number(v.branchId) || 0,
      supplier: v.supplier.trim(),
      quantity: Number(v.quantity),
      unitPrice: Number(v.unitPrice) || 0,
      reorderLevel: Number(v.reorderLevel) || 0,
      dateReceived: v.dateReceived,
      ...(r ? { requisitionId: r.id } : {}),
    }),
    onDone,
  );
  return (
    <Section title="Receive existing item" description="For something already in stock.">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !v.itemId ||
            !v.supplier.trim() ||
            !(Number(v.quantity) > 0) ||
            !v.branchId ||
            v.unitPrice === ''
          ) {
            s.setError('Fill in the branch, item, supplier, quantity and unit price.');
          } else s.setOpen(true);
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <BranchField id="e-branch" branches={branches} value={v.branchId} onChange={set('branchId')} />
        </div>
        <Field
          id="e-item"
          label="Item"
          hint={form.items.length ? undefined : 'No items yet. Add one with Receive new item.'}
        >
          <Select id="e-item" value={v.itemId} onChange={set('itemId')}>
            <option value="">Choose an item</option>
            {groups.map(([cat, items]) => (
              <optgroup key={cat} label={cat}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field id="e-avail" label="Available at this branch">
          <Input id="e-avail" value={available} readOnly tabIndex={-1} className="bg-canvas" />
        </Field>
        <Field id="e-supplier" label="Supplier">
          <Input
            id="e-supplier"
            value={v.supplier}
            onChange={(e) => {
              setTypedSupplier(e.target.value !== '');
              set('supplier')(e);
            }}
            maxLength={200}
          />
        </Field>
        <Field id="e-qty" label="Quantity received">
          <Input id="e-qty" type="number" min="1" step="1" value={v.quantity} onChange={set('quantity')} />
        </Field>
        <Field id="e-price" label="Unit price (K)">
          <Input
            id="e-price"
            type="number"
            min="0"
            step="0.01"
            value={v.unitPrice}
            onChange={set('unitPrice')}
            placeholder="0.00"
          />
        </Field>
        <Field id="e-reorder" label="Reorder level" hint="You'll be warned when stock falls to this level.">
          <Input
            id="e-reorder"
            type="number"
            min="0"
            step="1"
            value={v.reorderLevel}
            onChange={set('reorderLevel')}
          />
        </Field>
        <Field id="e-date" label="Date received">
          <Input
            id="e-date"
            type="date"
            max={today()}
            value={v.dateReceived}
            onChange={set('dateReceived')}
          />
        </Field>
        {s.error && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{s.error}</Notice>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit">Receive stock</Button>
        </div>
      </form>
      <ConfirmDialog
        open={s.open}
        title="Receive stock"
        confirmLabel="Receive stock"
        busy={s.busy}
        onConfirm={s.go}
        onCancel={() => s.setOpen(false)}
      >
        Record {v.quantity} × {item?.name} received from {v.supplier.trim()}? This will be added to stock.
      </ConfirmDialog>
    </Section>
  );
}
