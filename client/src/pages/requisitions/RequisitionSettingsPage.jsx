import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { Button, LoadError, Loading, Notice, PageHeader, Section } from '../../components/ui.jsx';

const FUNCTIONS = [
  {
    code: 'IT',
    title: 'IT',
    text: 'Staff in these departments attach quotations to IT-related requisitions and send them to the Director.',
  },
  {
    code: 'ACCOUNTS',
    title: 'Accounts',
    text: 'Staff prepare payments and attach the proof of payment. Their Department Manager (or line manager) is the Accounts Manager, who checks payments before the CFO (the Accounts Director).',
  },
  {
    code: 'STORES',
    title: 'Stores',
    text: 'Staff receive deliveries, issue stock to departments and manage items and categories.',
  },
];

/**
 * Which departments do the IT, Accounts and Stores steps (D105). A department serves its own
 * company; a company without one is served by every department with that function.
 */
export default function RequisitionSettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['rq-settings'], queryFn: () => api.get('/api/stock/settings') });
  const opts = useQuery({ queryKey: ['stock-options'], queryFn: () => api.get('/api/stock/options') });
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (settings.data) setV(settings.data);
  }, [settings.data]);
  if (settings.isPending || opts.isPending || !v) {
    return settings.isError ? <LoadError error={settings.error} onRetry={settings.refetch} /> : <Loading />;
  }
  if (opts.isError) return <LoadError error={opts.error} onRetry={opts.refetch} />;
  const byCompany = new Map();
  for (const d of opts.data.departments) byCompany.set(d.company, [...(byCompany.get(d.company) ?? []), d]);
  const toggle = (code, id) =>
    setV((x) => ({
      ...x,
      [code]: x[code].includes(id) ? x[code].filter((y) => y !== id) : [...x[code], id],
    }));
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.put('/api/stock/settings', v);
      setMsg({ tone: 'ok', text: 'Saved. The change applies straight away.' });
      qc.invalidateQueries({ queryKey: ['rq-settings'] });
      qc.invalidateQueries({ queryKey: ['rq-me'] });
    } catch (err) {
      setMsg({ tone: 'danger', text: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Requisition departments"
        description="Choose the departments that do the IT, Accounts and Stores steps. Each department serves its own company; a company with none is served by all the departments with that step."
      />
      <div className="stack">
        {FUNCTIONS.map((f) => (
          <Section key={f.code} title={f.title} description={f.text}>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {[...byCompany.entries()].map(([company, depts]) => (
                <fieldset key={company}>
                  <legend className="mb-1.5 text-xs font-medium text-muted uppercase">{company}</legend>
                  {depts.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand"
                        checked={v[f.code].includes(d.id)}
                        onChange={() => toggle(f.code, d.id)}
                      />
                      {d.name}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </Section>
        ))}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Button busy={busy} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
