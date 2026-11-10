import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  ButtonLink,
  EmptyState,
  LoadError,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Table,
  Tabs,
  Td,
  Th,
} from '../../components/ui.jsx';
import { STATUS_TONES, lusakaDate, units, useRq } from './rq.js';

/** Every requisition the person takes part in, by stage (D105). */
export default function RequisitionsListPage() {
  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') ?? '';
  const companyId = search.get('companyId') ?? '';
  const page = Number(search.get('page')) || 1;
  const rq = useRq();
  const list = useQuery({
    queryKey: ['requisitions', tab, companyId, page],
    queryFn: () => api.get(`/api/requisitions${qs({ tab, companyId, page })}`),
  });
  const set = (k, v) => {
    const next = new URLSearchParams(search);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setSearch(next, { replace: true });
  };
  const d = list.data;
  return (
    <div>
      <PageHeader
        title="Requisitions"
        description="Everything you raise, quote for, approve, pay or receive."
        actions={
          rq.data?.canRaise && (
            <ButtonLink to="/requisitions/requests/new" variant="primary">
              Raise a requisition
            </ButtonLink>
          )
        }
      />
      {list.isPending && <Loading />}
      {list.isError && <LoadError error={list.error} onRetry={list.refetch} />}
      {d && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-x-4">
            <Tabs
              tabs={d.tabs}
              active={d.tab}
              onChange={(id) => set('tab', id)}
              label="Requisitions by stage"
            />
            {d.companies.length > 1 && (
              <div className="mb-4 w-64">
                <label htmlFor="rq-company" className="sr-only">
                  Company
                </label>
                <Select id="rq-company" value={companyId} onChange={(e) => set('companyId', e.target.value)}>
                  <option value="">All companies</option>
                  {d.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <div id={`panel-${d.tab}`} role="tabpanel" aria-labelledby={`tab-${d.tab}`}>
            {d.items.length === 0 ? (
              <div className="card p-0">
                <EmptyState
                  title={d.tab === 'mine' ? 'Nothing is waiting for you.' : 'No requisitions here.'}
                />
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Ref</Th>
                    <Th>Raised</Th>
                    <Th>Item</Th>
                    <Th className="text-right">Qty</Th>
                    <Th>Department</Th>
                    <Th>Stage</Th>
                    <Th>
                      <span className="sr-only">Action</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((r) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">
                        <Link
                          to={`/requisitions/requests/${r.id}`}
                          className="font-medium text-brand hover:underline"
                        >
                          {r.ref}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {formatDate(lusakaDate(r.createdAt))}
                        <p className="text-xs text-muted">{r.raisedBy ?? ''}</p>
                      </Td>
                      <Td>
                        <Link to={`/requisitions/requests/${r.id}`} className="font-medium hover:underline">
                          {r.itemName}
                        </Link>
                        <p className="text-xs text-muted">
                          {[r.category?.name, r.isIt && 'IT-related'].filter(Boolean).join(' · ')}
                        </p>
                      </Td>
                      <Td className="text-right tabular-nums">{units(r.quantity)}</Td>
                      <Td>
                        {r.department?.name ?? <span className="text-muted">None</span>}
                        <p className="text-xs text-muted">{r.company?.name ?? ''}</p>
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONES[r.status]}>{r.statusLabel}</Badge>
                        <p className="mt-0.5 text-xs text-muted">since {formatDate(lusakaDate(r.stageAt))}</p>
                      </Td>
                      <Td className="text-right">
                        <ButtonLink
                          to={`/requisitions/requests/${r.id}`}
                          variant={r.yourTurn ? 'primary' : 'secondary'}
                          className="h-8 px-2.5"
                        >
                          {r.yourTurn ? 'Take action' : 'Open'}
                        </ButtonLink>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <Pagination
              page={d.page}
              pageSize={d.pageSize}
              total={d.total}
              onPage={(p) => set('page', String(p))}
            />
          </div>
        </>
      )}
    </div>
  );
}
