import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import {
  Badge,
  Button,
  EmptyState,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { errorText } from './rq.js';

/**
 * Who gets the stock alerts (D111, D112): an email and a notification when an item falls to its
 * reorder level or runs out, and the daily reorder summary. Only inventory users whose role can
 * receive stock or manage items, or who have the System Admin role, can get them; the System
 * Admin ticks which of them do.
 */
export default function StockAlertsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['stock-alerts'], queryFn: () => api.get('/api/stock/alerts') });
  const [on, setOn] = useState(null); // Set of employee ids
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (list.data) setOn(new Set(list.data.items.filter((p) => p.receives).map((p) => p.employeeId)));
  }, [list.data]);

  if (list.isError) return <LoadError error={list.error} onRetry={list.refetch} />;
  if (list.isPending || !on) return <Loading />;

  const people = list.data.items;
  const changed = people.some((p) => p.receives !== on.has(p.employeeId));
  const allOn = people.length > 0 && people.every((p) => on.has(p.employeeId));
  const toggle = (id) =>
    setOn((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.put('/api/stock/alerts', { employeeIds: [...on] });
      qc.setQueryData(['stock-alerts'], r);
      const n = r.items.filter((p) => p.receives).length;
      setMsg({
        tone: n ? 'ok' : 'pending',
        text: n
          ? `Saved. ${n} ${n === 1 ? 'person gets' : 'people get'} the stock alerts.`
          : 'Saved. Nobody gets the stock alerts now, so low stock will not be emailed to anyone.',
      });
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Stock alerts"
        description={
          <>
            Who is emailed when an item falls to its reorder level or runs out, and gets the daily reorder
            summary at 07:00. Only people whose role can receive stock or manage items, or who have the System
            Admin role, are listed; change roles under{' '}
            <Link to="/requisitions/users" className="text-brand hover:underline">
              Users
            </Link>
            .
          </>
        }
        actions={
          people.length > 0 && (
            <Button onClick={save} busy={busy} disabled={!changed}>
              Save changes
            </Button>
          )
        }
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {people.length === 0 ? (
        <div className="card p-0">
          <EmptyState title="Nobody can get stock alerts yet.">
            Give someone a role that can receive stock or manage items, or the System Admin role, under Users.
          </EmptyState>
        </div>
      ) : (
        <Table title="Stock alerts">
          <thead>
            <tr>
              <Th>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    checked={allOn}
                    onChange={() => setOn(allOn ? new Set() : new Set(people.map((p) => p.employeeId)))}
                    aria-label="Everyone gets the alerts"
                  />
                  Gets alerts
                </label>
              </Th>
              <Th>First name</Th>
              <Th>Last name</Th>
              <Th>Email</Th>
              <Th>Company</Th>
              <Th>Branch</Th>
              <Th>Department</Th>
              <Th>Role</Th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const checked = on.has(p.employeeId);
              return (
                <tr key={p.employeeId}>
                  <Td>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand"
                        checked={checked}
                        onChange={() => toggle(p.employeeId)}
                        aria-label={`${p.name} gets the stock alerts`}
                      />
                      <span className={checked ? '' : 'muted-text'}>{checked ? 'Yes' : 'No'}</span>
                    </label>
                  </Td>
                  <Td className="font-semibold">{p.firstName}</Td>
                  <Td className="font-semibold">{p.lastName}</Td>
                  <Td>{p.email}</Td>
                  <Td>{p.company ?? <span className="muted-text">Not set</span>}</Td>
                  <Td>{p.branch ?? <span className="muted-text">—</span>}</Td>
                  <Td>{p.department ?? <span className="muted-text">—</span>}</Td>
                  <Td>
                    <Badge tone={p.role === 'System Admin' ? 'brand' : 'neutral'}>{p.role}</Badge>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
