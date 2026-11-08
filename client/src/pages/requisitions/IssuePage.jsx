import { useEffect, useMemo, useState } from 'react';
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

/** Issue stock to a department: pick the company, an item in stock there, and the branch it comes from. */
export default function IssuePage() {
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['stock-options'], queryFn: () => api.get('/api/stock/options') });
  const companies = useMemo(() => {
    const m = new Map();
    for (const b of opts.data?.branches ?? []) if (b.isActive) m.set(b.companyId, b.company);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [opts.data]);
  const [companyId, setCompanyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [itemId, setItemId] = useState('');
  const co = companyId || (companies[0] ? String(companies[0].id) : '');
  const avail = useQuery({
    queryKey: ['issue-available', co],
    queryFn: () => api.get(`/api/stock/issue/available?companyId=${co}`),
    enabled: !!co,
  });
  const [msg, setMsg] = useState(null);
  if (opts.isPending) return <Loading />;
  if (opts.isError) return <LoadError error={opts.error} onRetry={opts.refetch} />;
  const items = (avail.data?.items ?? []).filter((i) => !categoryId || String(i.categoryId) === categoryId);
  const item = items.find((i) => String(i.id) === itemId) ?? null;
  return (
    <div>
      <PageHeader
        title="Issue stock"
        description="Give items to a department. Stock comes out of the branch you choose."
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {companies.length === 0 ? (
        <Notice tone="danger">
          No branches are set up yet. The System Administrator adds them under Administration › Branches.
        </Notice>
      ) : (
        <>
          <Section title="Select item">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="is-co" label="Issuing from company">
                <Select
                  id="is-co"
                  value={co}
                  disabled={companies.length === 1}
                  onChange={(e) => {
                    setCompanyId(e.target.value);
                    setItemId('');
                  }}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="is-cat" label="Category">
                <Select
                  id="is-cat"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setItemId('');
                  }}
                >
                  <option value="">All categories</option>
                  {opts.data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="is-item"
                label="Item in stock"
                hint={
                  avail.isSuccess && items.length === 0
                    ? `Nothing in stock in this company${categoryId ? ' in this category' : ''}.`
                    : undefined
                }
              >
                <Select id="is-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">Choose an item</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (available: {units(i.available)})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Section>
          {item && (
            <div className="mt-6">
              <IssueForm
                key={item.id}
                item={item}
                companyId={Number(co)}
                departments={opts.data.departments}
                onDone={(out) => {
                  setMsg({
                    tone: 'ok',
                    text: `Issued ${units(out.quantity)} × ${out.item} to ${out.issuedTo}. ${out.branch} stock: ${units(out.oldStock)} → ${units(out.newStock)}.`,
                  });
                  setItemId('');
                  qc.invalidateQueries({ queryKey: ['issue-available'] });
                  qc.invalidateQueries({ queryKey: ['stock-items'] });
                  qc.invalidateQueries({ queryKey: ['stock-movements'] });
                }}
              />
            </div>
          )}
        </>
      )}
      <div className="mt-8">
        <RecentMovements type="issued" title="Recently issued" />
      </div>
    </div>
  );
}

function IssueForm({ item, companyId, departments, onDone }) {
  const [v, setV] = useState({
    branchId: String(item.branches[0]?.id ?? ''),
    quantity: '',
    departmentId: '',
    recipient: '',
    dateIssued: today(),
    purpose: '',
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => setError(null), [v.quantity, v.branchId]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const branch = item.branches.find((b) => String(b.id) === v.branchId);
  const max = branch?.quantity ?? 0;
  const q = Number(v.quantity) || 0;
  // This company's departments first.
  const groups = useMemo(() => {
    const g = new Map();
    for (const d of departments)
      g.set(d.companyId, { company: d.company, items: [...(g.get(d.companyId)?.items ?? []), d] });
    return [...g.entries()].sort(([a], [b]) => (b === companyId) - (a === companyId)).map(([, x]) => x);
  }, [departments, companyId]);
  const dept = departments.find((d) => String(d.id) === v.departmentId);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.post('/api/stock/issue', {
        itemId: item.id,
        branchId: Number(v.branchId),
        departmentId: Number(v.departmentId),
        quantity: q,
        recipient: v.recipient.trim(),
        dateIssued: v.dateIssued,
        purpose: v.purpose.trim(),
      });
      setOpen(false);
      onDone(out);
    } catch (err) {
      setError(errorText(err));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title={item.name}
      description={`${item.category} · reorder level ${units(item.reorderLevel)} · ${units(item.available)} across the company`}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!(q >= 1)) return setError('Enter the quantity to issue.');
          if (q > max)
            return setError(`Only ${units(max)} in stock at ${branch?.name}. You cannot issue ${units(q)}.`);
          if (!v.departmentId) return setError('Choose the department receiving the stock.');
          if (v.recipient.trim().length < 2) return setError('Enter the name of the person receiving it.');
          setOpen(true);
          return undefined;
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field id="if-branch" label="Issue from branch">
          <Select
            id="if-branch"
            value={v.branchId}
            onChange={set('branchId')}
            disabled={item.branches.length === 1}
          >
            {item.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({units(b.quantity)} in stock)
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="if-qty"
          label="Quantity to issue"
          hint={
            q > 0 && q <= max ? `${branch?.name} will have ${units(max - q)} left.` : `Up to ${units(max)}.`
          }
        >
          <Input
            id="if-qty"
            type="number"
            min="1"
            max={max}
            step="1"
            value={v.quantity}
            onChange={set('quantity')}
          />
        </Field>
        <Field id="if-dept" label="Department">
          <Select id="if-dept" value={v.departmentId} onChange={set('departmentId')}>
            <option value="">Choose a department</option>
            {groups.map((g) => (
              <optgroup key={g.company} label={g.company}>
                {g.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field id="if-recipient" label="Person receiving">
          <Input
            id="if-recipient"
            value={v.recipient}
            onChange={set('recipient')}
            maxLength={150}
            placeholder="Full name, e.g. Mary Phiri"
          />
        </Field>
        <Field id="if-date" label="Date issued">
          <Input id="if-date" type="date" max={today()} value={v.dateIssued} onChange={set('dateIssued')} />
        </Field>
        <Field id="if-purpose" label="Purpose" optional>
          <Textarea id="if-purpose" rows={2} maxLength={255} value={v.purpose} onChange={set('purpose')} />
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit">Issue stock</Button>
        </div>
      </form>
      <ConfirmDialog
        open={open}
        title="Issue stock"
        confirmLabel="Issue stock"
        busy={busy}
        onConfirm={go}
        onCancel={() => setOpen(false)}
      >
        Issue {units(q)} × {item.name} from {branch?.name} to {dept?.name}, {dept?.company}? This will be
        deducted from stock.
      </ConfirmDialog>
    </Section>
  );
}
