import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Badge,
  Button,
  ButtonLink,
  ConfirmDialog,
  Details,
  EmptyState,
  LoadError,
  Loading,
  Notice,
  Section,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { STATE_LABELS, STATE_TONES, daysLeftLabel, kwacha, units } from './rq.js';

/** One stock item: its levels, where it is held, and every receipt and issue. */
export default function ItemPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['stock-item', id], queryFn: () => api.get(`/api/stock/items/${id}`) });
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  const it = q.data;
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/stock/items/${it.id}`);
      navigate('/inventory/stock');
    } catch (err) {
      setError(err.message);
      setDel(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4">
        <div>
          <h1 className="text-[1.3rem] leading-snug">{it.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            {it.category}
            {!it.scoped && <Badge tone={STATE_TONES[it.state]}>{STATE_LABELS[it.state]}</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {it.canEdit && <ButtonLink to={`/inventory/stock/${it.id}/edit`}>Edit</ButtonLink>}
          {it.canEdit && (
            <Button
              variant="danger"
              disabled={it.hasHistory}
              title={it.hasHistory ? "Items With Stock History Can't Be Deleted" : undefined}
              onClick={() => setDel(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <div className="grid-2">
        <Section title={it.scoped ? 'Issued To Your Department' : 'Stock'}>
          {it.scoped ? (
            <Details
              items={[
                ['Total Issued', units(it.issued)],
                ['Times Issued', units(it.history.length)],
                ['Value Issued', kwacha(it.issued * it.unitPrice)],
              ]}
            />
          ) : (
            <Details
              items={[
                [
                  'In Stock',
                  <span key="q" className="text-lg">
                    {units(it.quantity)}
                  </span>,
                ],
                ['Reorder Level', units(it.reorderLevel)],
                ['Days Left', daysLeftLabel(it.daysLeft, it.quantity)],
                ['Used Per Week', it.perWeek > 0 ? it.perWeek.toFixed(it.perWeek < 10 ? 1 : 0) : '—'],
                ['Suggested Order', it.suggest > 0 ? units(it.suggest) : '—'],
              ]}
            />
          )}
        </Section>
        <Section title="Details">
          <Details
            items={[
              ['Category', it.category],
              ['Description', it.description],
              ['Unit Price', kwacha(it.unitPrice)],
              ...(it.scoped
                ? []
                : [
                    ['Received In Total', units(it.received)],
                    ['Issued In Total', units(it.issued)],
                  ]),
            ]}
          />
          {!it.scoped && it.perBranch.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">Held at</p>
              <ul className="divide-y divide-rule rounded-md border border-rule text-sm">
                {it.perBranch.map((b) => (
                  <li key={b.id} className="flex justify-between px-3 py-1.5">
                    <span>
                      {b.name} <span className="text-xs text-muted">· {b.company}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{units(b.quantity)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="mb-3 font-head text-base font-semibold text-ink">Stock History</h2>
          {it.history.length > 0 && (
            <Button
              variant="secondary"
              onClick={() =>
                downloadFile(`/api/stock/items/${it.id}?format=xlsx`).catch((e) => setError(e.message))
              }
            >
              {' '}
              Export To Excel
            </Button>
          )}
        </div>
        {it.history.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No stock received or issued yet." />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th className="text-right">Qty</Th>
                <Th>Branch</Th>
                <Th>Supplier Or Department</Th>
                <Th className="text-right">Branch Stock</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {it.history.map((h, i) => (
                <tr key={`${h.type}-${h.at}-${i}`}>
                  <Td className="whitespace-nowrap">{formatDateTime(h.at)}</Td>
                  <Td>
                    <Badge tone={h.type === 'Received' ? 'ok' : 'brand'}>{h.type}</Badge>
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">
                    {h.type === 'Issued' ? '−' : '+'}
                    {units(h.quantity)}
                  </Td>
                  <Td>{h.branch ?? '—'}</Td>
                  <Td>
                    {h.party ?? '—'}
                    {(h.recipient || h.purpose) && (
                      <p className="text-xs text-muted">
                        {[h.recipient, h.purpose].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </Td>
                  <Td className="text-right text-muted tabular-nums">
                    {h.oldStock ?? '—'} → {h.newStock ?? '—'}
                  </Td>
                  <Td>{h.by ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      <ConfirmDialog
        open={del}
        title="Delete Item"
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDel(false)}
      >
        Delete {it.name}? This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
