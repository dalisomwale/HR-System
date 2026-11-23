import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { Badge, Button, LoadError, Loading, Notice, PageHeader, Section } from '../../components/ui.jsx';

/**
 * Leave management › Admin › Notifications (D113): for each leave notification, whether it is
 * sent (in the system) and whether it is also emailed. An email always comes with the
 * notification in the system. Notifications that ask someone to act are always sent; only their
 * email can be switched off.
 */
export default function NotificationSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notification-settings'],
    queryFn: () => api.get('/api/admin/notifications'),
  });
  const [v, setV] = useState(null); // key -> { inApp, email }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (q.data) {
      setV(
        Object.fromEntries(
          q.data.groups.flatMap((g) => g.items).map((i) => [i.key, { inApp: i.inApp, email: i.email }]),
        ),
      );
    }
  }, [q.data]);

  if (q.isError) return <LoadError error={q.error} onRetry={q.refetch} />;
  if (q.isPending || !v) return <Loading />;

  const items = q.data.groups.flatMap((g) => g.items);
  const changed = items.some((i) => v[i.key].inApp !== i.inApp || v[i.key].email !== i.email);
  const set = (key, patch) =>
    setV((x) => {
      const next = { ...x[key], ...patch };
      if (!next.inApp) next.email = false; // no email without the notification
      return { ...x, [key]: next };
    });
  const reset = () =>
    setV(Object.fromEntries(items.map((i) => [i.key, { inApp: true, email: i.emailByDefault }])));
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.put('/api/admin/notifications', {
        items: items.map((i) => ({ key: i.key, ...v[i.key] })),
      });
      qc.setQueryData(['notification-settings'], r);
      setMsg({ tone: 'ok', text: 'Saved. The change applies to notifications sent from now on.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Notifications"
        description="Choose which leave notifications are sent, and which are also emailed. Each one appears under Notifications in the system; an email is sent as well where Email is ticked."
        actions={
          <>
            <Button variant="secondary" onClick={reset}>
              Restore Defaults
            </Button>
            <Button onClick={save} busy={busy} disabled={!changed}>
              Save Changes
            </Button>
          </>
        }
      />
      <div className="stack">
        {!q.data.emailEnabled && (
          <Notice tone="pending">
            Email is switched off on this server, so only the notifications in the system are sent for now.
            The choices below take effect as soon as email is switched on (see{' '}
            <Link to="/admin/emails" className="text-brand hover:underline">
              Emails
            </Link>
            ).
          </Notice>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {q.data.groups.map((g) => (
          <Section key={g.title} title={g.title} description={g.hint}>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Notification</th>
                    <th className="w-28 text-center">Sent</th>
                    <th className="w-28 text-center">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((i) => {
                    const cur = v[i.key];
                    return (
                      <tr key={i.key} className={cur.inApp ? '' : 'text-muted'}>
                        <td>
                          <div className="font-semibold">
                            {i.label}
                            {i.required && (
                              <span className="ml-2 align-middle">
                                <Badge tone="brand">Always Sent</Badge>
                              </span>
                            )}
                          </div>
                          <div className="muted-text text-sm">{i.description}</div>
                        </td>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            className="size-4 accent-brand"
                            checked={cur.inApp}
                            disabled={i.required}
                            title={i.required ? 'Asks someone to act, so it is always sent.' : undefined}
                            onChange={(e) => set(i.key, { inApp: e.target.checked })}
                            aria-label={`Send “${i.label}”`}
                          />
                        </td>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            className="size-4 accent-brand"
                            checked={cur.email}
                            disabled={!cur.inApp}
                            onChange={(e) => set(i.key, { email: e.target.checked })}
                            aria-label={`Email “${i.label}”`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        ))}
      </div>
    </div>
  );
}
