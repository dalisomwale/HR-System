import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { EmptyState, LoadError, Loading, PageHeader, Table, Td, Th } from '../../components/ui.jsx';
import { kwachaWhole, units } from './rq.js';

/** Suppliers (D107), as on the inventory system: every supplier named on a delivery. */
export default function SuppliersPage() {
  const q = useQuery({
    queryKey: ['inventory-suppliers'],
    queryFn: () => api.get('/api/inventory/suppliers'),
  });
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Every supplier named when stock was received, with how much they delivered."
      />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No suppliers yet.">
              Suppliers appear here once stock is received from them.
            </EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th className="text-right">Deliveries</Th>
                <Th className="text-right">Units delivered</Th>
                <Th className="text-right">Value delivered</Th>
                <Th>Last delivery</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((s) => (
                <tr key={s.name} data-date={s.lastDelivery}>
                  <Td className="font-semibold">{s.name}</Td>
                  <Td className="text-right tabular-nums">{units(s.deliveries)}</Td>
                  <Td className="text-right tabular-nums">{units(s.units)}</Td>
                  <Td className="text-right tabular-nums">{kwachaWhole(s.value)}</Td>
                  <Td>{s.lastDelivery ? formatDate(String(s.lastDelivery).slice(0, 10)) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}
    </div>
  );
}
