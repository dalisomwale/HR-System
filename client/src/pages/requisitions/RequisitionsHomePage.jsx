import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  ButtonLink,
  LoadError,
  Loading,
  PageHeader,
  Section,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { BarList, COLORS, ColumnChart, Donut, Legend } from '../../components/charts.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { STATUS_TONES, daysLeftLabel, kwachaShort, kwachaWhole, lusakaDate, units, useRq } from './rq.js';

const MOVEMENT = [
  { key: 'received', name: 'Received', color: COLORS.series[2] },
  { key: 'issued', name: 'Issued', color: COLORS.taken },
];
const weekFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Requisitions home: what is waiting for you and, for those who see stock, how it stands (D105). */
export default function RequisitionsHomePage() {
  const rq = useRq();
  const a = rq.data;
  const waiting = useQuery({
    queryKey: ['requisitions', 'mine', '', 1],
    queryFn: () => api.get('/api/requisitions?tab=mine'),
  });
  const dash = useQuery({
    queryKey: ['stock-dashboard'],
    queryFn: () => api.get('/api/stock/dashboard'),
    enabled: Boolean(a?.stock),
  });
  if (rq.isPending) return <Loading />;
  if (rq.isError) return <LoadError error={rq.error} onRetry={rq.refetch} />;
  const d = dash.data;
  const mine = waiting.data?.tab === 'mine' ? waiting.data.items : [];
  return (
    <div>
      <PageHeader
        title="Requisitions"
        description={new Intl.DateTimeFormat('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'Africa/Lusaka',
        }).format(new Date())}
        actions={
          <>
            {a.canRaise && (
              <ButtonLink to="/requisitions/requests/new" variant="primary">
                Raise a requisition
              </ButtonLink>
            )}
            {a.stores && <ButtonLink to="/requisitions/receive">Receive stock</ButtonLink>}
            {a.stores && <ButtonLink to="/requisitions/issue">Issue stock</ButtonLink>}
          </>
        }
      />
      <div className="space-y-6">
        {d?.scope === 'all' && (
          <Stats>
            <Stat label="Stock value" value={kwachaShort(d.stockValue)} to="/requisitions/stock?sort=value" />
            <Stat
              label="Issued, last 30 days (units)"
              value={units(d.issued.current)}
              to="/requisitions/transactions"
            />
            <Stat
              label="Need reordering"
              value={d.needReordering}
              tone="danger"
              to="/requisitions/stock?status=low"
            />
            <Stat
              label="Requisitions waiting for you"
              value={a.waiting}
              to="/requisitions/requests?tab=mine"
            />
          </Stats>
        )}
        {d?.scope === 'department' && (
          <Stats>
            <Stat
              label={`Issued to ${d.department ?? 'your department'}, last 30 days`}
              value={units(d.issued.current)}
              to="/requisitions/stock"
            />
            <Stat label="Value issued, last 30 days" value={kwachaShort(d.valueIssued)} />
            <Stat label="Items your department uses" value={units(d.itemsUsed)} />
            <Stat
              label="Requisitions waiting for you"
              value={a.waiting}
              to="/requisitions/requests?tab=mine"
            />
          </Stats>
        )}
        {!a.stock && (
          <Stats cols={3}>
            <Stat
              label="Requisitions waiting for you"
              value={a.waiting}
              to="/requisitions/requests?tab=mine"
            />
          </Stats>
        )}

        <Section
          title="Waiting for you"
          actions={
            <Link to="/requisitions/requests" className="text-sm text-brand hover:underline">
              All requisitions
            </Link>
          }
        >
          {waiting.isPending ? (
            <Loading />
          ) : mine.length === 0 ? (
            <p className="text-sm text-muted">Nothing is waiting for you.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {mine.slice(0, 8).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/requisitions/requests/${r.id}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {r.ref} · {r.itemName}
                    </Link>
                    <span className="text-muted">
                      {' '}
                      · {units(r.quantity)} · {r.department?.name ?? r.company?.name ?? ''} · raised{' '}
                      {formatDate(lusakaDate(r.createdAt))}
                    </span>
                  </div>
                  <Badge tone={STATUS_TONES[r.status]}>{r.statusLabel}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {dash.isError && <LoadError error={dash.error} onRetry={dash.refetch} />}
        {d?.scope === 'all' && (
          <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Section title="Stock movement, last 8 weeks" description="Units received and issued each week">
                <div className="space-y-3">
                  <Legend items={MOVEMENT} />
                  <ColumnChart
                    label="Units received and issued per week"
                    series={MOVEMENT}
                    grouped
                    whole
                    unit="units"
                    empty="No stock received or issued in the last 8 weeks."
                    data={d.weeks.map((w) => ({
                      key: w.week,
                      tick: weekFmt.format(new Date(`${w.week}T12:00:00Z`)),
                      title: `Week of ${weekFmt.format(new Date(`${w.week}T12:00:00Z`))}`,
                      received: w.received,
                      issued: w.issued,
                    }))}
                  />
                </div>
              </Section>
              <Section title="Stock health" description="Items by stock level">
                <Donut
                  label="Items by stock level"
                  centre={units(d.items)}
                  centreLabel="items"
                  unit="items"
                  empty="No items yet."
                  segments={[
                    { key: 'ok', name: 'In stock', value: d.health.ok, color: COLORS.series[2] },
                    { key: 'low', name: 'Below reorder', value: d.health.low, color: COLORS.waiting },
                    { key: 'out', name: 'Out of stock', value: d.health.out, color: '#b42318' },
                  ]}
                />
              </Section>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Section title="Issued by category, last 30 days" description="Units">
                <BarList
                  items={d.byCategoryIssued.map((r) => ({ key: r.label, label: r.label, value: r.value }))}
                  format={units}
                  empty="Nothing issued in the last 30 days."
                />
              </Section>
              <Section title="Where the stock value sits" description="By category">
                <BarList
                  items={d.valueByCategory.map((r) => ({ key: r.label, label: r.label, value: r.value }))}
                  format={kwachaWhole}
                  color={COLORS.series[1]}
                  empty="Set unit prices on items to see stock value."
                />
              </Section>
            </div>
            <Section
              title={`Running low: ${d.needReordering} ${d.needReordering === 1 ? 'item' : 'items'}`}
              description="Days left is based on how much was issued in the last 30 days."
            >
              {d.runningLow.length === 0 ? (
                <p className="text-sm text-muted">Nothing is running low.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th>Category</Th>
                      <Th className="text-right">In stock</Th>
                      <Th className="text-right">Reorder at</Th>
                      <Th className="text-right">Used per week</Th>
                      <Th>Days left</Th>
                      <Th className="text-right">Suggested order</Th>
                      <Th>
                        <span className="sr-only">Action</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.runningLow.map((r) => (
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
                        <Td className="text-right font-semibold tabular-nums">{units(r.quantity)}</Td>
                        <Td className="text-right text-muted tabular-nums">{units(r.reorderLevel)}</Td>
                        <Td className="text-right text-muted tabular-nums">
                          {r.perDay > 0 ? (r.perDay * 7).toFixed(r.perDay * 7 < 10 ? 1 : 0) : '—'}
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              r.quantity <= 0 || (r.daysLeft !== null && r.daysLeft < 7)
                                ? 'danger'
                                : 'pending'
                            }
                          >
                            {daysLeftLabel(r.daysLeft, r.quantity)}
                          </Badge>
                        </Td>
                        <Td className="text-right tabular-nums">{r.suggest > 0 ? units(r.suggest) : '—'}</Td>
                        <Td className="text-right">
                          {a.canRaise && r.suggest > 0 && (
                            <Link
                              to={`/requisitions/requests/new?${new URLSearchParams({ item: r.name, category: String(r.categoryId), qty: String(r.suggest) })}`}
                              className="text-sm text-brand hover:underline"
                            >
                              Raise
                            </Link>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Section>
          </>
        )}
        {d?.scope === 'department' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Issued by category, last 30 days" description="Units">
              <BarList
                items={d.byCategoryIssued.map((r) => ({ key: r.label, label: r.label, value: r.value }))}
                format={units}
                empty="Nothing issued to your department in the last 30 days."
              />
            </Section>
            <Section title="Most issued, last 30 days" description="Units">
              <BarList
                items={d.topIssued.map((r) => ({ key: r.label, label: r.label, value: r.value }))}
                format={units}
                empty="Nothing issued to your department in the last 30 days."
              />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
