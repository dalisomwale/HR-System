import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { api, downloadFile, qs } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  Button,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { STATE_LABELS, STATE_TONES, kwachaShort, kwachaWhole, lusakaDate, units, useRq } from './rq.js';

const FILTERS = ['q', 'categoryId', 'status', 'sort', 'companyId', 'branchId', 'departmentId'];

/** Every item's stock level (Manage Stock in the inventory system), or a department's issues. */
export default function StockPage() {
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();
  const rq = useRq();
  const f = Object.fromEntries(FILTERS.map((k) => [k, search.get(k) ?? '']));
  const opts = useQuery({ queryKey: ['stock-options'], queryFn: () => api.get('/api/stock/options') });
  const list = useQuery({
    queryKey: ['stock-items', f],
    queryFn: () => api.get(`/api/stock/items${qs(f)}`),
    placeholderData: (prev) => prev,
  });
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, v) => {
    const next = new URLSearchParams(search);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'companyId') {
      next.delete('branchId');
      next.delete('departmentId');
    }
    setSearch(next, { replace: true });
  };
  const d = list.data;
  const o = opts.data;
  const scoped = d?.scoped;
  const stores = rq.data?.stores;
  const anyFilter = FILTERS.some((k) => f[k]);
  const company = Number(f.companyId) || 0;

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/stock/items/${del.id}`);
      setMsg({ tone: 'ok', text: `"${del.name}" deleted.` });
      qc.invalidateQueries({ queryKey: ['stock-items'] });
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
        title={scoped ? 'Department stock' : 'Stock'}
        description={
          scoped
            ? 'What has been issued to your department.'
            : 'Every item, how much is in stock and when it needs reordering.'
        }
        actions={
          stores && (
            <ButtonLink to="/requisitions/stock/new" variant="primary">
              Add item
            </ButtonLink>
          )
        }
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {d && !scoped && (
        <div className="mb-5">
          <Stats>
            <Stat label="Items" value={units(d.totals.items)} />
            <Stat label="Units in stock" value={units(d.totals.units)} />
            <Stat label="Stock value" value={kwachaShort(d.totals.value)} />
            <Stat label="Below reorder or out" value={d.totals.low + d.totals.out} tone="danger" />
          </Stats>
        </div>
      )}

      <div className="mb-4 rounded-md border border-rule bg-white shadow-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label htmlFor="s-q" className="mb-1 block text-sm font-medium">
              Search
            </label>
            <Input
              id="s-q"
              type="search"
              defaultValue={f.q}
              maxLength={100}
              placeholder="Item name or description"
              onChange={(e) => set('q', e.target.value)}
            />
          </div>
          {!scoped && o && o.companies.length > 1 && (
            <Filter
              id="s-co"
              label="Company"
              value={f.companyId}
              onChange={(v) => set('companyId', v)}
              all="All companies"
              options={o.companies}
            />
          )}
          {!scoped && o && o.branches.length > 1 && (
            <Filter
              id="s-br"
              label="Branch"
              value={f.branchId}
              onChange={(v) => set('branchId', v)}
              all="All branches"
              options={o.branches.filter((b) => b.isActive && (!company || b.companyId === company))}
            />
          )}
          {!scoped && o && (
            <Filter
              id="s-dept"
              label="Issued to department"
              value={f.departmentId}
              onChange={(v) => set('departmentId', v)}
              all="Any department"
              options={o.departments
                .filter((x) => !company || x.companyId === company)
                .map((x) => ({ id: x.id, name: company ? x.name : `${x.name} — ${x.company}` }))}
            />
          )}
          {o && (
            <Filter
              id="s-cat"
              label="Category"
              value={f.categoryId}
              onChange={(v) => set('categoryId', v)}
              all="All categories"
              options={o.categories}
            />
          )}
          {!scoped && (
            <Filter
              id="s-status"
              label="Status"
              value={f.status}
              onChange={(v) => set('status', v)}
              all="Any status"
              options={[
                { id: 'ok', name: 'In stock' },
                { id: 'soon', name: 'Running out in 2 weeks' },
                { id: 'low', name: 'Below reorder' },
                { id: 'out', name: 'Out of stock' },
              ]}
            />
          )}
          <Filter
            id="s-sort"
            label="Sort by"
            value={f.sort}
            onChange={(v) => set('sort', v)}
            all="Name"
            options={
              scoped
                ? [
                    { id: 'issued', name: 'Most issued' },
                    { id: 'value', name: 'Value (highest first)' },
                    { id: 'last', name: 'Last issued (newest first)' },
                  ]
                : [
                    { id: 'stock', name: 'Stock (lowest first)' },
                    { id: 'value', name: 'Value (highest first)' },
                    { id: 'added', name: 'Date added (newest first)' },
                  ]
            }
          />
          {anyFilter && (
            <Button variant="secondary" onClick={() => setSearch({}, { replace: true })}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {list.isPending && <Loading />}
      {list.isError && <LoadError error={list.error} onRetry={list.refetch} />}
      {d && (
        <>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="muted-text">
              {d.items.length === d.totals.items
                ? `${d.items.length} items`
                : `Showing ${d.items.length} of ${d.totals.items} items`}
            </p>
            {d.items.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadFile(`/api/stock/items${qs({ ...f, format: 'xlsx' })}`).catch((e) =>
                    setMsg({ tone: 'danger', text: e.message }),
                  )
                }
              >
                {' '}
                Export to Excel
              </Button>
            )}
          </div>
          {d.items.length === 0 ? (
            <div className="card p-0">
              <EmptyState
                title={
                  anyFilter
                    ? 'No items match these filters.'
                    : scoped
                      ? 'Nothing has been issued to your department yet.'
                      : 'No items yet.'
                }
              />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Category</Th>
                  {scoped ? (
                    <>
                      <Th className="text-right">Issued to department</Th>
                      <Th className="text-right">Value</Th>
                      <Th>Last issued</Th>
                    </>
                  ) : (
                    <>
                      <Th className="text-right">Initial stock</Th>
                      <Th className="text-right">In stock</Th>
                      {f.departmentId && <Th className="text-right">Issued to department</Th>}
                      <Th className="text-right">Reorder at</Th>
                      <Th className="text-right">Value</Th>
                      <Th>Date added</Th>
                    </>
                  )}
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link
                        to={`/requisitions/stock/${r.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.description && <p className="text-xs text-muted">{r.description}</p>}
                    </Td>
                    <Td>{r.category}</Td>
                    {scoped ? (
                      <>
                        <Td className="text-right font-semibold tabular-nums">
                          {units(r.issuedToDepartment)}
                        </Td>
                        <Td className="text-right tabular-nums">{kwachaWhole(r.value)}</Td>
                        <Td className="whitespace-nowrap">
                          {r.lastIssued ? formatDate(lusakaDate(r.lastIssued)) : '—'}
                        </Td>
                      </>
                    ) : (
                      <>
                        <Td className="text-right text-muted tabular-nums">
                          {r.initial === null ? '—' : units(r.initial)}
                        </Td>
                        <Td className="text-right">
                          <span className="font-semibold tabular-nums">{units(r.quantity)}</span>
                          {r.state !== 'ok' && (
                            <span className="ml-2">
                              <Badge tone={STATE_TONES[r.state]}>{STATE_LABELS[r.state]}</Badge>
                            </span>
                          )}
                        </Td>
                        {f.departmentId && (
                          <Td className="text-right tabular-nums">{units(r.issuedToDepartment)}</Td>
                        )}
                        <Td className="text-right text-muted tabular-nums">{units(r.reorderLevel)}</Td>
                        <Td className="text-right tabular-nums">{kwachaWhole(r.value)}</Td>
                        <Td className="whitespace-nowrap text-muted">
                          {formatDate(lusakaDate(r.createdAt))}
                        </Td>
                      </>
                    )}
                    <Td className="text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        <Link
                          to={`/requisitions/stock/${r.id}`}
                          className="rounded-sm p-1.5 text-muted hover:bg-canvas hover:text-ink"
                          aria-label={`View ${r.name}`}
                        >
                          <Eye className="size-4" aria-hidden />
                        </Link>
                        {stores && (
                          <>
                            <Link
                              to={`/requisitions/stock/${r.id}/edit`}
                              className="rounded-sm p-1.5 text-muted hover:bg-canvas hover:text-ink"
                              aria-label={`Edit ${r.name}`}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Link>
                            <button
                              type="button"
                              disabled={!r.canDelete}
                              title={r.canDelete ? undefined : "Can't delete: has stock history"}
                              onClick={() => setDel(r)}
                              className="rounded-sm p-1.5 text-muted hover:bg-danger-bg hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                              aria-label={
                                r.canDelete
                                  ? `Delete ${r.name}`
                                  : `Can't delete ${r.name}: it has stock history`
                              }
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
      <ConfirmDialog
        open={Boolean(del)}
        title="Delete item"
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDel(null)}
      >
        Delete {del?.name}? This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}

function Filter({ id, label, value, onChange, all, options }) {
  return (
    <div className="w-48">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
