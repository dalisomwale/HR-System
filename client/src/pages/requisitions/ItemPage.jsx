import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
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
      navigate('/requisitions/stock');
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
          <h1 className="text-xl font-semibold">{it.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            {it.category}
            {!it.scoped && <Badge tone={STATE_TONES[it.state]}>{STATE_LABELS[it.state]}</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {it.canEdit && <ButtonLink to={`/requisitions/stock/${it.id}/edit`}>Edit</ButtonLink>}
          {it.canEdit && (
            <Button
              variant="danger"
              disabled={it.hasHistory}
              title={it.hasHistory ? "Items with stock history can't be deleted" : undefined}
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
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={it.scoped ? 'Issued to your department' : 'Stock'}>
          {it.scoped ? (
            <Details
              items={[
                ['Total issued', units(it.issued)],
                ['Times issued', units(it.history.length)],
                ['Value issued', kwacha(it.issued * it.unitPrice)],
              ]}
            />
          ) : (
            <Details
              items={[
                [
                  'In stock',
                  <span key="q" className="text-lg">
                    {units(it.quantity)}
                  </span>,
                ],
                ['Reorder level', units(it.reorderLevel)],
                ['Days left', daysLeftLabel(it.daysLeft, it.quantity)],
                ['Used per week', it.perWeek > 0 ? it.perWeek.toFixed(it.perWeek < 10 ? 1 : 0) : '—'],
                ['Suggested order', it.suggest > 0 ? units(it.suggest) : '—'],
              ]}
            />
          )}
        </Section>
        <Section title="Details">
          <Details
            items={[
              ['Category', it.category],
              ['Description', it.description],
              ['Unit price', kwacha(it.unitPrice)],
              ...(it.scoped
                ? []
                : [
                    ['Received in total', units(it.received)],
                    ['Issued in total', units(it.issued)],
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
          <h2 className="text-[15px] font-semibold">Stock history</h2>
          {it.history.length > 0 && (
            <Button
              variant="secondary"
              onClick={() =>
                downloadFile(`/api/stock/items/${it.id}?format=xlsx`).catch((e) => setError(e.message))
              }
            >
              <Download className="size-4" aria-hidden /> Export to Excel
            </Button>
          )}
        </div>
        {it.history.length === 0 ? (
          <div className="rounded-md border border-rule bg-white">
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
                <Th>Supplier or department</Th>
                <Th className="text-right">Branch stock</Th>
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
        title="Delete item"
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
