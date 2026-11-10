import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { errorText } from '../requisitions/rq.js';

/*
 * A module's Roles page (D107, D108), as on the inventory system: each role gets one access
 * level per area (ticks where an area allows several). The System Admin role always has full
 * access and can't be changed. `module` is leave, people or inventory; `base` is where its pages live.
 */
export default function AccessRolesPage({ module, base }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['access-roles', module],
    queryFn: () => api.get(`/api/access/${module}/roles`),
  });
  const [editing, setEditing] = useState(null); // 'new' or a role
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const refresh = (text, tone = 'ok') => {
    setMsg({ tone, text });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ['access-roles', module] });
    qc.invalidateQueries({ queryKey: ['me'] });
    qc.invalidateQueries({ queryKey: ['rq-me'] });
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/access/${module}/roles/${deleting.id}`);
      refresh(`Role "${deleting.name}" deleted.`);
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };
  return (
    <div>
      <PageHeader
        title="Roles"
        description={
          <>
            What each role can do in {q.data?.module.label ?? 'this module'}. Give people a role under{' '}
            <Link to={`${base}/users`} className="text-brand hover:underline">
              Users
            </Link>
            .
          </>
        }
        actions={editing !== 'new' && <Button onClick={() => setEditing('new')}>Add role</Button>}
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {editing && q.data && (
        <div className="mb-4">
          <RoleForm
            module={module}
            role={editing === 'new' ? null : editing}
            areas={q.data.areas}
            onDone={refresh}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {q.data && (
        <Table>
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Access</Th>
              <Th className="text-right">Users</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-semibold">{r.name}</span>{' '}
                  {r.isSystem && <Badge tone="brand">Full access</Badge>}
                  {r.description && <p className="text-[0.82rem] text-muted">{r.description}</p>}
                </Td>
                <Td>
                  {r.summary.length === 0 ? (
                    <span className="muted-text">No access</span>
                  ) : (
                    <ul className="level-list">
                      {r.summary.map((s) => (
                        <li key={s.area}>
                          <span>{s.area}:</span> {s.level}
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
                <Td className="text-right tabular-nums">
                  <Link to={`${base}/users`} className="text-brand hover:underline">
                    {r.users}
                  </Link>
                </Td>
                <Td>
                  {!r.isSystem && (
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="Edit"
                        aria-label={`Edit ${r.name}`}
                        onClick={() => setEditing(r)}
                      >
                        <Pencil aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon btn-danger-outline"
                        title={r.users > 0 ? "Can't delete: people have this role" : 'Delete'}
                        aria-label={
                          r.users > 0 ? `Can't delete ${r.name}: people have this role` : `Delete ${r.name}`
                        }
                        disabled={r.users > 0}
                        onClick={() => setDeleting(r)}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete role"
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      >
        Delete the role &ldquo;{deleting?.name}&rdquo;? This can&rsquo;t be undone.
      </ConfirmDialog>
    </div>
  );
}

function RoleForm({ module, role, areas, onDone, onCancel }) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [levels, setLevels] = useState(
    () => role?.levels ?? Object.fromEntries(areas.map((a) => [a.key, a.multi ? [] : 0])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const setLevel = (key, i) => setLevels((l) => ({ ...l, [key]: i }));
  const toggle = (key, i) =>
    setLevels((l) => {
      const now = new Set(l[key] ?? []);
      if (now.has(i)) now.delete(i);
      else now.add(i);
      return { ...l, [key]: [...now].sort() };
    });
  const all = (top) =>
    setLevels(
      Object.fromEntries(
        areas.map((a) => [
          a.key,
          a.multi
            ? top
              ? a.levels.map((_, i) => i)
              : []
            : top && a.key !== 'scope'
              ? a.levels.length - 1
              : 0,
        ]),
      ),
    );
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), description: description.trim(), levels };
      if (role) await api.put(`/api/access/${module}/roles/${role.id}`, body);
      else await api.post(`/api/access/${module}/roles`, body);
      onDone(`Role "${body.name}" ${role ? 'saved' : 'added'}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={role ? `Edit ${role.name}` : 'Add role'}>
      <form onSubmit={save} noValidate>
        {error && (
          <div className="mb-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <div className="form-row mb-3.5">
          <Field id="ir-name" label="Name">
            <Input id="ir-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="ir-desc" label="Description" optional>
            <Input
              id="ir-desc"
              value={description}
              maxLength={255}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-2 mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="section-divider mb-0 border-0 pb-0">Access levels</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => all(true)}>
              Full access
            </Button>
            <Button variant="secondary" size="sm" onClick={() => all(false)}>
              No access
            </Button>
          </div>
        </div>
        <div className="perm-groups">
          {areas.map((a) => (
            <fieldset key={a.key} className="perm-group">
              <legend>
                {a.label}
                <small>{a.hint}</small>
              </legend>
              {a.levels.map(([label, desc], i) => (
                <label key={label} className="perm">
                  {a.multi ? (
                    <input
                      type="checkbox"
                      checked={(levels[a.key] ?? []).includes(i)}
                      onChange={() => toggle(a.key, i)}
                    />
                  ) : (
                    <input
                      type="radio"
                      name={`lvl-${a.key}`}
                      checked={(levels[a.key] ?? 0) === i}
                      onChange={() => setLevel(a.key, i)}
                    />
                  )}
                  <span>
                    <strong>{label}</strong>
                    <small>{desc}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="form-actions">
          <Button type="submit" busy={busy} disabled={name.trim().length < 2}>
            {role ? 'Save changes' : 'Add role'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}
