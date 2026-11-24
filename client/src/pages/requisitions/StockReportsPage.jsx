import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadError,
  Loading,
  PageHeader,
  Section,
  Table,
  Tabs,
  Td,
  Th,
} from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { kwacha, kwachaWhole, today, units, useRq } from './rq.js';

const VIEWS = [
  { id: 'category', label: 'By Category' },
  { id: 'company', label: 'By Company' },
  { id: 'branch', label: 'By Branch' },
  { id: 'department', label: 'By Department' },
];
const NAMES = { category: 'Category', company: 'Company', branch: 'Branch', department: 'Department' };
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

// Department staff's reports (D140): their own department only.
export const DEPT_VIEWS = [
  { id: 'department', label: 'Issued To My Department' },
  { id: 'dept-category', label: 'By Category' },
  { id: 'dept-items', label: 'Most Used Items' },
  { id: 'dept-spend', label: 'Spend By Month' },
];

/** Monthly reports: the stores' four views, or a department's own reports for its staff. */
export default function StockReportsPage() {
  const [search] = useSearchParams();
  const rq = useRq();
  const by = search.get('by') ?? '';
  if (rq.isPending) return <Loading />;
  if (rq.data?.stockDepartment && by.startsWith('dept-')) return <DepartmentReport view={by.slice(5)} />;
  return <MonthlyReport />;
}

/** Monthly reports, worked out from deliveries and issues for any month (D105). */
function MonthlyReport() {
  const [search, setSearch] = useSearchParams();
  const by = search.get('by') ?? 'category';
  const month = search.get('month') ?? today().slice(0, 7);
  const id = search.get('id') ?? '';
  const params = { by, month, id };
  const q = useQuery({
    queryKey: ['stock-report', params],
    queryFn: () => api.get(`/api/stock/reports${qs(params)}`),
  });
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
    downloadFile(`/api/stock/reports${qs({ by: d.by, month: d.month, id, part, format: 'xlsx' })}`);
  const issue = d?.by === 'department';
  const kpiRows = d ? (d.selected ? d.rows : d.groups) : [];
  return (
    <div>
      <PageHeader
        title={
          d?.scoped
            ? `Monthly Report${d.selected ? ` — ${d.selected.name}` : ''}`
            : `Monthly Report ${NAMES[by].toLowerCase() === 'category' ? 'by category' : `by ${NAMES[by].toLowerCase()}`}${d?.selected ? ` — ${d.selected.name}` : ''}`
        }
        description={
          issue
            ? 'Stock issued to each department in the month.'
            : 'Opening and closing stock for the month, worked out from deliveries and issues. For the current month, closing is stock today.'
        }
      />
      {d?.scoped ? (
        <Tabs
          tabs={DEPT_VIEWS}
          active="department"
          onChange={(v) => set({ by: v, id: '' })}
          label="Report Views"
        />
      ) : (
        <Tabs tabs={VIEWS} active={by} onChange={(v) => set({ by: v, id: '' })} label="Report Views" />
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
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {d && (
        <div className="stack">
          <Stats>
            {issue ? (
              <>
                <Stat
                  label={d.selected ? 'Items' : 'Departments'}
                  value={units(d.selected ? d.rows.length : d.groups.length)}
                />
                <Stat label="Units Issued" value={units(sum(kpiRows, 'units'))} />
                <Stat label="Value Issued" value={kwachaWhole(sum(kpiRows, 'value'))} />
                <Stat label="Times Issued" value={units(sum(kpiRows, 'times'))} />
              </>
            ) : (
              <>
                <Stat label="Received" value={units(sum(kpiRows, 'received'))} />
                <Stat label="Issued" value={units(sum(kpiRows, 'issued'))} />
                <Stat label="Closing Stock" value={units(sum(kpiRows, 'closing'))} />
                <Stat label="Closing Value" value={kwachaWhole(sum(kpiRows, 'value'))} />
              </>
            )}
          </Stats>

          {!d.selected && (
            <Section title={`By ${NAMES[d.by].toLowerCase()}`}>
              {d.groups.length === 0 ? (
                <EmptyState
                  title={issue ? 'Nothing was issued in this month.' : 'No stock movements in this month.'}
                />
              ) : (
                <Table onExport={() => exportIt('')}>
                  <thead>
                    <tr>
                      <Th>{NAMES[d.by]}</Th>
                      <Th className="text-right">Items</Th>
                      {issue ? (
                        <>
                          <Th className="text-right">Units Issued</Th>
                          <Th className="text-right">Value Issued</Th>
                          <Th className="text-right">Times Issued</Th>
                        </>
                      ) : (
                        <>
                          <Th className="text-right">Opening</Th>
                          <Th className="text-right">Received</Th>
                          <Th className="text-right">Issued</Th>
                          <Th className="text-right">Closing</Th>
                          <Th className="text-right">Closing Value</Th>
                          {d.by === 'category' && <Th className="text-right">Low Or Out</Th>}
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
            <Section title={d.selected ? `By Item — ${d.selected.name}` : 'By Item'}>
              <Table onExport={() => exportIt('items')}>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Category</Th>
                    {issue ? (
                      <>
                        <Th className="text-right">Units Issued</Th>
                        <Th className="text-right">Unit Price</Th>
                        <Th className="text-right">Value Issued</Th>
                        <Th className="text-right">Times Issued</Th>
                      </>
                    ) : (
                      <>
                        <Th className="text-right">Opening</Th>
                        <Th className="text-right">Received</Th>
                        <Th className="text-right">Issued</Th>
                        <Th className="text-right">Closing</Th>
                        {d.by === 'category' && <Th>Status</Th>}
                        <Th className="text-right">Closing Value</Th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <Link
                          to={`/inventory/stock/${r.id}`}
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

const monthName = (m) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/** One of a department's own reports: by category, most used items or spend by month (D140). */
function DepartmentReport({ view }) {
  const [search, setSearch] = useSearchParams();
  const month = search.get('month') ?? today().slice(0, 7);
  const params = { view, month };
  const q = useQuery({
    queryKey: ['stock-dept-report', params],
    queryFn: () => api.get(`/api/stock/reports/department${qs(params)}`),
  });
  const set = (changes) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearch(next, { replace: true });
  };
  const d = q.data;
  const title = DEPT_VIEWS.find((v) => v.id === `dept-${view}`)?.label ?? 'Report';
  const period = d
    ? view === 'category'
      ? monthName(d.month)
      : `${monthName(d.from.slice(0, 7))} – ${monthName(d.month)}`
    : '';
  const exportIt = () => downloadFile(`/api/stock/reports/department${qs({ ...params, format: 'xlsx' })}`);
  const totalUnits = sum(d?.rows ?? [], 'units');
  const totalValue = sum(d?.rows ?? [], 'value');
  return (
    <div>
      <PageHeader
        title={`${title}${d?.department ? ` — ${d.department}` : ''}`}
        description={
          view === 'category'
            ? 'What was issued to your department in the month, by stock category.'
            : view === 'items'
              ? 'The items your department used most over the last three months.'
              : 'What was issued to your department each month over the last twelve months.'
        }
      />
      <Tabs tabs={DEPT_VIEWS} active={`dept-${view}`} onChange={(v) => set({ by: v })} label="Report Views" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <label htmlFor="d-month" className="mb-1 block text-sm font-medium">
            {view === 'category' ? 'Month' : 'Up To Month'}
          </label>
          <Input
            id="d-month"
            type="month"
            max={today().slice(0, 7)}
            value={month}
            onChange={(e) => set({ month: e.target.value })}
          />
        </div>
        {d && <p className="pb-2 text-sm text-muted">{period}</p>}
      </div>
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {d && (
        <>
          <Stats>
            <Stat label="Units Issued" value={units(totalUnits)} />
            <Stat label="Value Issued" value={kwachaWhole(totalValue)} />
            <Stat label="Times Issued" value={units(sum(d.rows, 'times'))} />
          </Stats>
          {d.rows.length === 0 || (view === 'spend' && totalUnits === 0) ? (
            <div className="card p-0">
              <EmptyState title="Nothing was issued to your department in this period." />
            </div>
          ) : (
            <Table onExport={exportIt}>
              <thead>
                <tr>
                  {view === 'category' && <Th>Category</Th>}
                  {view === 'items' && (
                    <>
                      <Th>Item</Th>
                      <Th>Category</Th>
                    </>
                  )}
                  {view === 'spend' && <Th>Month</Th>}
                  {view === 'category' && <Th className="text-right">Items</Th>}
                  <Th className="text-right">Units Issued</Th>
                  {view === 'items' && <Th className="text-right">Average Per Month</Th>}
                  <Th className="text-right">Value Issued</Th>
                  <Th className="text-right">Times Issued</Th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id ?? r.month}>
                    {view === 'category' && <Td className="font-medium">{r.category}</Td>}
                    {view === 'items' && (
                      <>
                        <Td>
                          <Link
                            to={`/inventory/stock/${r.id}`}
                            className="font-medium text-brand hover:underline"
                          >
                            {r.name}
                          </Link>
                        </Td>
                        <Td>{r.category}</Td>
                      </>
                    )}
                    {view === 'spend' && <Td className="font-medium">{monthName(r.month)}</Td>}
                    {view === 'category' && <Td className="text-right tabular-nums">{r.items}</Td>}
                    <Td className="text-right tabular-nums">{units(r.units)}</Td>
                    {view === 'items' && <Td className="text-right tabular-nums">{r.perMonth}</Td>}
                    <Td className="text-right tabular-nums">{kwacha(r.value)}</Td>
                    <Td className="text-right tabular-nums">{r.times}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
