import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadError,
  Loading,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { today, units } from './rq.js';

function MovementTable({ items, showStock = true, onExport }) {
  return (
    <Table onExport={onExport}>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Type</Th>
          <Th>Item</Th>
          <Th className="text-right">Qty</Th>
          <Th>Branch</Th>
          <Th>Supplier or department</Th>
          {showStock && <Th className="text-right">Branch stock</Th>}
          <Th>By</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((t) => (
          <tr key={t.key}>
            <Td className="whitespace-nowrap">{formatDateTime(t.at)}</Td>
            <Td>
              <Badge tone={t.type === 'Received' ? 'ok' : 'brand'}>{t.type}</Badge>
            </Td>
            <Td>
              <Link to={`/requisitions/stock/${t.itemId}`} className="font-medium text-brand hover:underline">
                {t.item}
              </Link>
              <p className="text-xs text-muted">{t.category}</p>
            </Td>
            <Td className="text-right font-semibold tabular-nums">{units(t.quantity)}</Td>
            <Td>{t.branch ?? '—'}</Td>
            <Td>
              {t.party ?? '—'}
              {(t.recipient || t.purpose) && (
                <p className="text-xs text-muted">{[t.recipient, t.purpose].filter(Boolean).join(' · ')}</p>
              )}
            </Td>
            {showStock && (
              <Td className="text-right text-muted tabular-nums">
                {t.oldStock ?? '—'} → {t.newStock ?? '—'}
              </Td>
            )}
            <Td>{t.by ?? '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** The latest receipts or issues, under the Receive and Issue forms. */
export function RecentMovements({ type, title }) {
  const q = useQuery({
    queryKey: ['stock-movements', type],
    queryFn: () => api.get(`/api/stock/transactions?type=${type}`),
  });
  return (
    <section>
      <h2 className="mb-3 font-head text-base font-semibold text-ink">{title}</h2>
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="Nothing yet." />
          </div>
        ) : (
          <MovementTable items={q.data.items.slice(0, 20)} />
        ))}
    </section>
  );
}

/** Every receipt and issue on a day. */
export default function TransactionsPage() {
  const [search, setSearch] = useSearchParams();
  const date = search.get('date') ?? today();
  const type = search.get('type') ?? '';
  const categoryId = search.get('categoryId') ?? '';
  const opts = useQuery({ queryKey: ['stock-options'], queryFn: () => api.get('/api/stock/options') });
  const params = { date, type, categoryId };
  const q = useQuery({
    queryKey: ['stock-transactions', params],
    queryFn: () => api.get(`/api/stock/transactions${qs(params)}`),
  });
  const set = (k, v) => {
    const next = new URLSearchParams(search);
    if (v) next.set(k, v);
    else next.delete(k);
    setSearch(next, { replace: true });
  };
  const scoped = q.data?.scoped;
  const received =
    q.data?.items.filter((t) => t.type === 'Received').reduce((s, t) => s + t.quantity, 0) ?? 0;
  const issued = q.data?.items.filter((t) => t.type === 'Issued').reduce((s, t) => s + t.quantity, 0) ?? 0;
  return (
    <div>
      <PageHeader
        title="Transactions"
        description={
          scoped ? 'Everything issued to your department on a day.' : 'Every receipt and issue on a day.'
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-rule bg-white shadow-card p-4">
        <div className="w-44">
          <label htmlFor="t-date" className="mb-1 block text-sm font-medium">
            Date
          </label>
          <Input
            id="t-date"
            type="date"
            max={today()}
            value={date}
            onChange={(e) => set('date', e.target.value)}
          />
        </div>
        {!scoped && (
          <div className="w-44">
            <label htmlFor="t-type" className="mb-1 block text-sm font-medium">
              Type
            </label>
            <Select id="t-type" value={type} onChange={(e) => set('type', e.target.value)}>
              <option value="">Received and issued</option>
              <option value="received">Received</option>
              <option value="issued">Issued</option>
            </Select>
          </div>
        )}
        <div className="w-48">
          <label htmlFor="t-cat" className="mb-1 block text-sm font-medium">
            Category
          </label>
          <Select id="t-cat" value={categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">All categories</option>
            {(opts.data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data && (
        <>
          <p className="mb-2 text-sm text-muted">
            {formatDate(date)}: {!scoped && type !== 'issued' && `${units(received)} received`}
            {!scoped && !type && ', '}
            {type !== 'received' && `${units(issued)} issued`}
          </p>
          {q.data.items.length === 0 ? (
            <div className="card p-0">
              <EmptyState title="Nothing received or issued on this day." />
            </div>
          ) : (
            <MovementTable
              onExport={() => downloadFile(`/api/stock/transactions${qs({ ...params, format: 'xlsx' })}`)}
              items={q.data.items}
              showStock={!scoped}
            />
          )}
        </>
      )}
    </div>
  );
}
