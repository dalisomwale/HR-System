import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { errorText, kwachaWhole, units } from './rq.js';

/** Branches: where stock is held, under each company. The System Administrator manages them. */
export default function BranchesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stock-branches'], queryFn: () => api.get('/api/stock/branches') });
  const opts = useQuery({ queryKey: ['stock-options'], queryFn: () => api.get('/api/stock/options') });
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);
  const done = (text) => {
    setMsg({ tone: 'ok', text });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ['stock-branches'] });
    qc.invalidateQueries({ queryKey: ['stock-options'] });
  };
  return (
    <div>
      <PageHeader
        title="Branches"
        description="Where stock is held. Each branch belongs to a company; stock is received at and issued from a branch."
        actions={editing !== 'new' && <Button onClick={() => setEditing('new')}>Add branch</Button>}
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {editing && opts.data && (
        <div className="mb-6">
          <BranchForm
            branch={editing === 'new' ? null : editing}
            companies={opts.data.companies}
            onDone={done}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No branches yet.">Add one so Stores can receive stock.</EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th>Company</Th>
                <Th>Location</Th>
                <Th className="text-right">Units held</Th>
                <Th className="text-right">Stock value</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((b) => (
                <tr key={b.id}>
                  <Td className="font-medium">{b.name}</Td>
                  <Td>{b.company}</Td>
                  <Td>{b.location ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{units(b.units)}</Td>
                  <Td className="text-right tabular-nums">{kwachaWhole(b.value)}</Td>
                  <Td>
                    <Badge tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Active' : 'Disabled'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(b)}
                      className="rounded-sm p-1.5 text-muted hover:bg-canvas hover:text-ink"
                      aria-label={`Edit ${b.name}`}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}
    </div>
  );
}

function BranchForm({ branch, companies, onDone, onCancel }) {
  const [v, setV] = useState({
    companyId: branch ? String(branch.companyId) : companies.length === 1 ? String(companies[0].id) : '',
    name: branch?.name ?? '',
    location: branch?.location ?? '',
    isActive: branch?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) =>
    setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        companyId: Number(v.companyId) || 0,
        name: v.name.trim(),
        location: v.location.trim(),
        isActive: v.isActive,
      };
      if (branch) await api.put(`/api/stock/branches/${branch.id}`, body);
      else await api.post('/api/stock/branches', body);
      onDone(`Branch "${body.name}" ${branch ? 'saved' : 'added'}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={branch ? `Edit ${branch.name}` : 'Add branch'}>
      <form onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-3">
        <Field id="b-co" label="Company">
          <Select id="b-co" value={v.companyId} onChange={set('companyId')}>
            <option value="">Choose a company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="b-name" label="Branch name">
          <Input
            id="b-name"
            value={v.name}
            onChange={set('name')}
            maxLength={150}
            placeholder="e.g. Head Office"
          />
        </Field>
        <Field id="b-loc" label="Location" optional>
          <Input
            id="b-loc"
            value={v.location}
            onChange={set('location')}
            maxLength={200}
            placeholder="e.g. Cairo Road, Lusaka"
          />
        </Field>
        {branch && (
          <label className="flex items-center gap-2.5 text-sm sm:col-span-3">
            <input
              type="checkbox"
              className="size-4 accent-brand"
              checked={v.isActive}
              onChange={set('isActive')}
            />
            Active (stock can be received at and issued from it)
          </label>
        )}
        {error && (
          <div className="sm:col-span-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" busy={busy}>
            {branch ? 'Save' : 'Add branch'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}
