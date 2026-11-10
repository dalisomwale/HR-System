import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
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
import { errorText } from '../requisitions/rq.js';

/*
 * A module's Users page (D107, D108), as on the inventory system. Users are employees from
 * Employee management: they sign in with Microsoft, so there are no passwords here, only which
 * role each person has in this module. `module` is leave, people or inventory; `base` is where
 * the module's pages live (for the link to its Roles page).
 */
export default function AccessUsersPage({ module, base }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const users = useQuery({
    queryKey: ['access-users', module],
    queryFn: () => api.get(`/api/access/${module}/users`),
  });
  const roles = useQuery({
    queryKey: ['access-roles', module],
    queryFn: () => api.get(`/api/access/${module}/roles`),
  });
  const [editing, setEditing] = useState(null); // 'new' or a user
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const refresh = (text, tone = 'ok') => {
    setMsg({ tone, text });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ['access-users', module] });
    qc.invalidateQueries({ queryKey: ['access-candidates', module] });
    qc.invalidateQueries({ queryKey: ['access-roles', module] });
    qc.invalidateQueries({ queryKey: ['rq-me'] });
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/access/${module}/users/${removing.employeeId}`);
      refresh(`${removing.name} no longer has a role here.`);
    } catch (err) {
      setMsg({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };
  const count = users.data?.items.length ?? 0;
  return (
    <div>
      <PageHeader
        title="Users"
        description={
          <>
            {count} {count === 1 ? 'person has' : 'people have'} a role here · What each role can do is set
            under{' '}
            <Link to={`${base}/roles`} className="text-brand hover:underline">
              Roles
            </Link>
          </>
        }
        actions={editing !== 'new' && <Button onClick={() => setEditing('new')}>Add user</Button>}
      />
      {msg && (
        <div className="mb-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {editing && roles.data && (
        <div className="mb-4">
          <UserForm
            module={module}
            user={editing === 'new' ? null : editing}
            roles={roles.data.items}
            onDone={refresh}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {(users.isPending || roles.isPending) && <Loading />}
      {users.isError && <LoadError error={users.error} onRetry={users.refetch} />}
      {users.data &&
        (users.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="Nobody has a role here yet.">
              Add a user to give someone access. The System Administrator always has full access.
            </EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Company</Th>
                <Th>Department</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Added</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((u) => {
                const self = u.employeeId === me?.id;
                return (
                  <tr key={u.employeeId} data-date={u.addedAt} className={u.isActive ? '' : 'text-muted'}>
                    <Td className="font-semibold">
                      {u.name}
                      {self && <span className="muted-text"> (you)</span>}
                    </Td>
                    <Td>{u.email}</Td>
                    <Td>{u.company ?? <span className="muted-text">Not set</span>}</Td>
                    <Td>{u.department ?? <span className="muted-text">—</span>}</Td>
                    <Td>
                      <Badge tone={u.isSystemRole ? 'brand' : 'neutral'}>{u.role}</Badge>
                    </Td>
                    <Td>
                      {u.employeeLeft ? (
                        <Badge tone="danger">Left</Badge>
                      ) : (
                        <Badge tone={u.isActive ? 'ok' : 'danger'}>
                          {u.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(String(u.addedAt).slice(0, 10))}</Td>
                    <Td>
                      {!self && (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-icon"
                            title="Edit"
                            aria-label={`Edit ${u.name}`}
                            onClick={() => setEditing(u)}
                          >
                            <Pencil aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn btn-icon btn-danger-outline"
                            title="Remove"
                            aria-label={`Remove ${u.name}`}
                            onClick={() => setRemoving(u)}
                          >
                            <Trash2 aria-hidden />
                          </button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ))}
      <ConfirmDialog
        open={!!removing}
        title="Remove user"
        confirmLabel="Remove"
        tone="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      >
        Remove {removing?.name}&rsquo;s role here? They lose the access it gives them.
      </ConfirmDialog>
    </div>
  );
}

function UserForm({ module, user, roles, onDone, onCancel }) {
  const candidates = useQuery({
    queryKey: ['access-candidates', module],
    queryFn: () => api.get(`/api/access/${module}/users/candidates`),
    enabled: !user,
  });
  const [employeeId, setEmployeeId] = useState('');
  const [roleId, setRoleId] = useState(user ? String(user.roleId) : '');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await api.put(`/api/access/${module}/users/${user.employeeId}`, { roleId: Number(roleId), isActive });
        onDone(`${user.name} saved.`);
      } else {
        await api.post(`/api/access/${module}/users`, {
          employeeId: Number(employeeId),
          roleId: Number(roleId),
        });
        const who = candidates.data?.items.find((c) => String(c.id) === employeeId)?.name ?? 'The employee';
        onDone(`${who} added.`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={user ? `Edit ${user.name}` : 'Add user'}>
      <form onSubmit={save} noValidate>
        {error && (
          <div className="mb-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <div className="form-row">
          {user ? (
            <Field id="iu-status" label="Status">
              <Select
                id="iu-status"
                value={isActive ? '1' : '0'}
                onChange={(e) => setIsActive(e.target.value === '1')}
              >
                <option value="1">Active</option>
                <option value="0">Disabled</option>
              </Select>
            </Field>
          ) : (
            <Field
              id="iu-employee"
              label="Employee"
              hint="Active employees in Employee management without a role here."
            >
              <Select id="iu-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{candidates.isPending ? 'Loading…' : 'Choose an employee'}</option>
                {(candidates.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.department ? ` · ${c.department}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="iu-role" label="Role">
            <Select id="iu-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Choose a role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="form-actions">
          <Button type="submit" busy={busy} disabled={!roleId || (!user && !employeeId)}>
            {user ? 'Save changes' : 'Add user'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}
