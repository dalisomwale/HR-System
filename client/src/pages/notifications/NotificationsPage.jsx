import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Button,
  EmptyState,
  LoadError,
  Loading,
  PageHeader,
  Pagination,
  Select,
} from '../../components/ui.jsx';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['notifications', page, unread],
    queryFn: () => api.get(`/api/notifications${qs({ page, unread })}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['unread-count'] });
  };

  const open = async (n) => {
    if (!n.read) {
      try {
        await api.post(`/api/notifications/${n.id}/read`);
      } finally {
        refresh();
      }
    }
    if (n.link) navigate(n.link);
  };
  const readAll = async () => {
    setBusy(true);
    try {
      await api.post('/api/notifications/read-all');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Notifications"
        actions={
          <>
            <Select
              aria-label="Show"
              className="w-40"
              value={unread}
              onChange={(e) => {
                setUnread(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="1">Unread only</option>
            </Select>
            <Button variant="secondary" busy={busy} disabled={!q.data?.unread} onClick={readAll}>
              Mark all as read
            </Button>
          </>
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title={unread ? 'No unread notifications.' : 'No notifications yet.'} />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-rule rounded-md border border-rule bg-white">
            {q.data.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className="flex w-full gap-3 px-4 py-3 text-left hover:bg-canvas"
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read ? '' : 'font-semibold'}`}>
                      {n.title}
                      {!n.read && <span className="sr-only"> (unread)</span>}
                    </span>
                    {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
