import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
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

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';
const MAX_FILES = 5;

/** Raise a requisition (D105). Supporting files go up straight after it is created. */
export default function RaisePage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['rq-options'], queryFn: () => api.get('/api/requisitions/options') });
  const [v, setV] = useState({
    itemName: search.get('item') ?? '',
    categoryId: search.get('category') ?? '',
    quantity: search.get('qty') ?? '1',
    reason: '',
    isIt: false,
    companyId: '',
    departmentId: '',
  });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) =>
    setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const o = opts.data;
  const fixedDept = o?.myDepartmentId ? o.departments.find((d) => d.id === o.myDepartmentId) : null;
  const companyId = fixedDept
    ? fixedDept.companyId
    : Number(v.companyId) || (o?.companies.length === 1 ? o.companies[0].id : 0);
  const depts = useMemo(
    () => (o ? o.departments.filter((d) => d.companyId === companyId) : []),
    [o, companyId],
  );
  const companyName = o?.companies.find((c) => c.id === companyId)?.name;
  const deptName = fixedDept?.name ?? depts.find((d) => String(d.id) === v.departmentId)?.name;
  const category = o?.categories.find((c) => String(c.id) === v.categoryId)?.name;

  const check = () => {
    if (!companyId) return 'Choose the company.';
    if (!fixedDept && depts.length && !v.departmentId) return 'Choose the department that needs this.';
    if (v.itemName.trim().length < 2) return 'Enter the item (at least 2 characters).';
    if (!v.categoryId) return 'Choose a category.';
    const q = Number(v.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 100000) return 'Enter a quantity from 1 to 100,000.';
    if (v.reason.trim().length < 3) return 'Give the reason (at least 3 characters).';
    if (files.length > MAX_FILES) return `You can attach up to ${MAX_FILES} files.`;
    if (files.some((f) => f.size > 10 * 1024 * 1024)) return 'Each file must be 10 MB or less.';
    return null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/requisitions', {
        itemName: v.itemName.trim(),
        categoryId: Number(v.categoryId),
        quantity: Number(v.quantity),
        reason: v.reason.trim(),
        isIt: v.isIt,
        companyId: fixedDept ? undefined : companyId,
        departmentId: fixedDept ? undefined : Number(v.departmentId) || undefined,
      });
      const failed = [];
      if (!v.isIt) {
        for (const f of files) {
          try {
            await api.upload(`/api/requisitions/${r.id}/files?kind=doc`, f);
          } catch (err) {
            failed.push(`${f.name}: ${err.message}`);
          }
        }
      }
      qc.invalidateQueries({ queryKey: ['requisitions'] });
      qc.invalidateQueries({ queryKey: ['rq-me'] });
      navigate(`/requisitions/requests/${r.id}`, { state: { raised: r.ref, isIt: v.isIt, failed } });
    } catch (err) {
      setError(err.message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  if (opts.isPending) return <Loading />;
  if (opts.isError) return <LoadError error={opts.error} onRetry={opts.refetch} />;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Raise a requisition"
        description="Ask for something to be bought for your department."
      />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const problem = check();
          if (problem) setError(problem);
          else {
            setError(null);
            setConfirm(true);
          }
        }}
      >
        <Section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="rq-company" label="Company">
              {fixedDept || o.companies.length === 1 ? (
                <Input id="rq-company" value={companyName ?? ''} readOnly className="bg-canvas" />
              ) : (
                <Select
                  id="rq-company"
                  value={v.companyId}
                  onChange={(e) => setV((x) => ({ ...x, companyId: e.target.value, departmentId: '' }))}
                >
                  <option value="">Choose a company</option>
                  {o.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="rq-dept" label="Department">
              {fixedDept ? (
                <Input id="rq-dept" value={fixedDept.name} readOnly className="bg-canvas" />
              ) : (
                <Select
                  id="rq-dept"
                  value={v.departmentId}
                  onChange={set('departmentId')}
                  disabled={!companyId || !depts.length}
                >
                  <option value="">
                    {!companyId
                      ? 'Choose the company first'
                      : depts.length
                        ? 'Choose a department'
                        : 'No departments in this company'}
                  </option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="rq-item" label="Item">
              <Input
                id="rq-item"
                list="rq-items"
                value={v.itemName}
                onChange={set('itemName')}
                maxLength={200}
                placeholder="Start typing an item"
              />
              <datalist id="rq-items">
                {o.items.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </Field>
            <Field id="rq-category" label="Category">
              <Select id="rq-category" value={v.categoryId} onChange={set('categoryId')}>
                <option value="">Choose a category</option>
                {o.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="rq-qty" label="Quantity">
              <Input
                id="rq-qty"
                type="number"
                min={1}
                max={100000}
                step={1}
                value={v.quantity}
                onChange={set('quantity')}
              />
            </Field>
            <Field
              id="rq-files"
              label="Supporting documents"
              optional
              hint={
                v.isIt
                  ? 'Not needed: IT will get the quotations.'
                  : `Specifications, photos or a quotation you already have. Up to ${MAX_FILES} files, 10 MB each.`
              }
            >
              <input
                id="rq-files"
                type="file"
                multiple
                accept={ACCEPT}
                disabled={v.isIt}
                onChange={(e) => setFiles([...(e.target.files ?? [])])}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-rule file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium disabled:opacity-50"
              />
            </Field>
            <Field id="rq-reason" label="Reason" className="sm:col-span-2">
              <Textarea
                id="rq-reason"
                rows={3}
                maxLength={500}
                value={v.reason}
                onChange={set('reason')}
                placeholder="Why it is needed, e.g. toner for the Credit department printer"
              />
            </Field>
            <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-brand"
                checked={v.isIt}
                onChange={set('isIt')}
              />
              <span>
                <span className="font-medium">IT-related</span>
                <span className="block text-xs text-muted">
                  IT will get the quotations. Leave unticked to attach the quotations yourself.
                </span>
              </span>
            </label>
          </div>
          {error && (
            <div className="mt-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          <div className="mt-5">
            <Button type="submit">Raise requisition</Button>
          </div>
        </Section>
      </form>
      <ConfirmDialog
        open={confirm}
        title="Raise requisition"
        confirmLabel="Raise requisition"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
      >
        Raise a requisition for {v.quantity} × {v.itemName.trim()} ({category}) for {deptName ?? companyName}?
      </ConfirmDialog>
    </div>
  );
}
