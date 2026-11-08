import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, downloadFile, qs } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Table,
  Tabs,
  Td,
  Th,
} from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { kwacha, kwachaShort, kwachaWhole, today, units } from './rq.js';

const VIEWS = [
  { id: 'category', label: 'By category' },
  { id: 'company', label: 'By company' },
  { id: 'branch', label: 'By branch' },
  { id: 'department', label: 'By department' },
];
const NAMES = { category: 'Category', company: 'Company', branch: 'Branch', department: 'Department' };
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

/** Monthly reports, worked out from deliveries and issues for any month (D105). */
export default function StockReportsPage() {
  const [search, setSearch] = useSearchParams();
  const by = search.get('by') ?? 'category';
  const month = search.get('month') ?? today().slice(0, 7);
  const id = search.get('id') ?? '';
  const params = { by, month, id };
  const q = useQuery({
    queryKey: ['stock-report', params],
    queryFn: () => api.get(`/api/stock/reports${qs(params)}`),
  });
  const [error, setError] = useState(null);
  const set = (changes) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearch(next, { replace: true });
  };
  const d = q.data;
  const exportIt = (part) =>
    downloadFile(`/api/stock/reports${qs({ by: d.by, month: d.month, id, part, format: 'xlsx' })}`).catch(
      (e) => setError(e.message),
    );
  const issue = d?.by === 'department';
  const kpiRows = d ? (d.selected ? d.rows : d.groups) : [];
  return (
    <div>
      <PageHeader
        title={
          d?.scoped
            ? `Monthly report${d.selected ? ` — ${d.selected.name}` : ''}`
            : `Monthly report ${NAMES[by].toLowerCase() === 'category' ? 'by category' : `by ${NAMES[by].toLowerCase()}`}${d?.selected ? ` — ${d.selected.name}` : ''}`
        }
        description={
          issue
            ? 'Stock issued to each department in the month.'
            : 'Opening and closing stock for the month, worked out from deliveries and issues. For the current month, closing is stock today.'
        }
      />
      {!d?.scoped && (
        <Tabs tabs={VIEWS} active={by} onChange={(v) => set({ by: v, id: '' })} label="Report views" />
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <label htmlFor="r-month" className="mb-1 block text-sm font-medium">
            Month
          </label>
          <Input
            id="r-month"
            type="month"
            max={today().slice(0, 7)}
            value={month}
            onChange={(e) => set({ month: e.target.value })}
          />
        </div>
        {id && !d?.scoped && (
          <Button variant="secondary" onClick={() => set({ id: '' })}>
            All {NAMES[by].toLowerCase() === 'category' ? 'categories' : `${NAMES[by].toLowerCase()}s`}
          </Button>
        )}
        {d && (
          <p className="pb-2 text-sm text-muted">
            {formatDate(d.from)} to {formatDate(d.to)}
          </p>
        )}
      </div>
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {d && (
        <div className="space-y-6">
          <Stats>
            {issue ? (
              <>
                <Stat
                  label={d.selected ? 'Items' : 'Departments'}
                  value={units(d.selected ? d.rows.length : d.groups.length)}
                />
                <Stat label="Units issued" value={units(sum(kpiRows, 'units'))} />
                <Stat label="Value issued" value={kwachaShort(sum(kpiRows, 'value'))} />
                <Stat label="Times issued" value={units(sum(kpiRows, 'times'))} />
              </>
            ) : (
              <>
                <Stat label="Received" value={units(sum(kpiRows, 'received'))} />
                <Stat label="Issued" value={units(sum(kpiRows, 'issued'))} />
                <Stat label="Closing stock" value={units(sum(kpiRows, 'closing'))} />
                <Stat label="Closing value" value={kwachaShort(sum(kpiRows, 'value'))} />
              </>
            )}
          </Stats>

          {!d.selected && (
            <Section
              title={`By ${NAMES[d.by].toLowerCase()}`}
              actions={
                d.groups.length > 0 && (
                  <Button variant="secondary" onClick={() => exportIt('')}>
                    <Download className="size-4" aria-hidden /> Export to Excel
                  </Button>
                )
              }
            >
              {d.groups.length === 0 ? (
                <EmptyState
                  title={issue ? 'Nothing was issued in this month.' : 'No stock movements in this month.'}
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{NAMES[d.by]}</Th>
                      <Th className="text-right">Items</Th>
                      {issue ? (
                        <>
                          <Th className="text-right">Units issued</Th>
                          <Th className="text-right">Value issued</Th>
                          <Th className="text-right">Times issued</Th>
                        </>
                      ) : (
                        <>
                          <Th className="text-right">Opening</Th>
                          <Th className="text-right">Received</Th>
                          <Th className="text-right">Issued</Th>
                          <Th className="text-right">Closing</Th>
                          <Th className="text-right">Closing value</Th>
                          {d.by === 'category' && <Th className="text-right">Low or out</Th>}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {d.groups.map((g) => (
                      <tr key={g.id}>
                        <Td>
                          <Link
                            to={`?${new URLSearchParams({ by: d.by, month: d.month, id: String(g.id) })}`}
                            className="font-medium text-brand hover:underline"
                          >
                            {g.name}
                          </Link>
                          {g.sub && <p className="text-xs text-muted">{g.sub}</p>}
                        </Td>
                        <Td className="text-right tabular-nums">{units(g.items)}</Td>
                        {issue ? (
                          <>
                            <Td className="text-right tabular-nums">{units(g.units)}</Td>
                            <Td className="text-right tabular-nums">{kwachaWhole(g.value)}</Td>
                            <Td className="text-right tabular-nums">{units(g.times)}</Td>
                          </>
                        ) : (
                          <>
                            <Td className="text-right tabular-nums">{units(g.opening)}</Td>
                            <Td className="text-right tabular-nums">{units(g.received)}</Td>
                            <Td className="text-right tabular-nums">{units(g.issued)}</Td>
                            <Td className="text-right font-semibold tabular-nums">{units(g.closing)}</Td>
                            <Td className="text-right tabular-nums">{kwachaWhole(g.value)}</Td>
                            {d.by === 'category' && (
                              <Td className="text-right tabular-nums">
                                {g.low ? <Badge tone="pending">{g.low}</Badge> : '—'}
                              </Td>
                            )}
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Section>
          )}

          {(d.selected || d.by === 'category') && d.rows.length > 0 && (
            <Section
              title={d.selected ? `By item — ${d.selected.name}` : 'By item'}
              actions={
                <Button variant="secondary" onClick={() => exportIt('items')}>
                  <Download className="size-4" aria-hidden /> Export to Excel
                </Button>
              }
            >
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Category</Th>
                    {issue ? (
                      <>
                        <Th className="text-right">Units issued</Th>
                        <Th className="text-right">Unit price</Th>
                        <Th className="text-right">Value issued</Th>
                        <Th className="text-right">Times issued</Th>
                      </>
                    ) : (
                      <>
                        <Th className="text-right">Opening</Th>
                        <Th className="text-right">Received</Th>
                        <Th className="text-right">Issued</Th>
                        <Th className="text-right">Closing</Th>
                        {d.by === 'category' && <Th>Status</Th>}
                        <Th className="text-right">Closing value</Th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <Link
                          to={`/requisitions/stock/${r.id}`}
                          className="font-medium text-brand hover:underline"
                        >
                          {r.name}
                        </Link>
                      </Td>
                      <Td>{r.category}</Td>
                      {issue ? (
                        <>
                          <Td className="text-right tabular-nums">{units(r.units)}</Td>
                          <Td className="text-right tabular-nums">{kwacha(r.unitPrice)}</Td>
                          <Td className="text-right tabular-nums">{kwachaWhole(r.value)}</Td>
                          <Td className="text-right tabular-nums">{units(r.times)}</Td>
                        </>
                      ) : (
                        <>
                          <Td className="text-right tabular-nums">{units(r.opening)}</Td>
                          <Td className="text-right tabular-nums">{units(r.received)}</Td>
                          <Td className="text-right tabular-nums">{units(r.issued)}</Td>
                          <Td className="text-right font-semibold tabular-nums">{units(r.closing)}</Td>
                          {d.by === 'category' && (
                            <Td>
                              <Badge
                                tone={
                                  r.status === 'OK'
                                    ? 'ok'
                                    : r.status === 'Out of stock'
                                      ? 'danger'
                                      : 'pending'
                                }
                              >
                                {r.status}
                              </Badge>
                            </Td>
                          )}
                          <Td className="text-right tabular-nums">{kwachaWhole(r.value)}</Td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
