import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import EmployeeBalances from './EmployeeBalances.jsx';
import { formatDate, formatDateTime, ROLE_LABELS } from '../../lib/format.js';
import {
  Badge,
  Button,
  Details,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Select,
  Textarea,
  applyServerErrors,
} from '../../components/ui.jsx';

const FIELDS = [
  'employeeNumber',
  'firstName',
  'lastName',
  'email',
  'jobTitle',
  'sex',
  'departmentId',
  'lineManagerId',
  'workScheduleId',
  'employmentStartDate',
  'employmentEndDate',
];

const blank = Object.fromEntries(FIELDS.map((f) => [f, '']));
const toForm = (e) => Object.fromEntries(FIELDS.map((f) => [f, e[f] ?? '']));
const toPayload = (values, only) => {
  const out = {};
  for (const f of only ?? FIELDS) {
    const v = values[f];
    out[f] = ['departmentId', 'lineManagerId', 'workScheduleId'].includes(f)
      ? v
        ? Number(v)
        : null
      : v === ''
        ? null
        : v;
  }
  return out;
};

export default function EmployeePage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const isNew = id === 'new';
  const employee = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/api/admin/employees/${id}`),
    enabled: !isNew,
  });

  if (!isNew && employee.isPending) return <Loading />;
  if (!isNew && employee.isError)
    return <LoadError error={employee.error} onRetry={() => employee.refetch()} />;
  const e = employee.data;

  return (
    <div className="max-w-6xl">
      <Link
        to="/admin/employees"
        className="mb-3 inline-flex items-center gap-1 text-sm text-brand hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Employees
      </Link>
      <PageHeader
        title={isNew ? 'Add employee' : `${e.firstName} ${e.lastName}`}
        description={
          isNew
            ? 'Create the record first; link their Microsoft account and give roles afterwards.'
            : e.jobTitle
        }
        actions={
          !isNew && (e.status === 'ACTIVE' ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>)
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <EmployeeForm employee={e} isNew={isNew} />
        {!isNew && (
          <div className="grid content-start gap-6">
            <IdentityPanel employee={e} />
            <RolesPanel employee={e} />
            <StatusPanel employee={e} />
            {e.directReports.length > 0 && (
              <Section title="Direct reports">
                <ul className="space-y-1.5 text-sm">
                  {e.directReports.map((r) => (
                    <li key={r.id}>
                      <Link to={`/admin/employees/${r.id}`} className="text-brand hover:underline">
                        {r.name}
                      </Link>{' '}
                      <span className="text-muted">{r.employeeNumber}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}
      </div>
      {!isNew && (
        <div className="mt-6">
          {me.roles.includes('HR_OFFICER') ? (
            <EmployeeBalances employeeId={e.id} />
          ) : (
            <Notice tone="neutral" title="Leave balances">
              Balances and adjustments are managed by HR Officers. Add the HR Officer role to see them here.
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}

function useInvalidateEmployee(id) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['employee', String(id)] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['employee-options'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
}

function EmployeeForm({ employee, isNew }) {
  const navigate = useNavigate();
  const invalidate = useInvalidateEmployee(employee?.id);
  const [message, setMessage] = useState(null);
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/api/admin/departments'),
  });
  const people = useQuery({
    queryKey: ['employee-options'],
    queryFn: () => api.get('/api/admin/employees/options'),
  });
  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get('/api/admin/work-schedules'),
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields, isDirty, isSubmitting },
  } = useForm({ defaultValues: employee ? toForm(employee) : blank });
  // Fill the form once the dropdown options exist, so selected values show correctly.
  const lookupsReady = departments.isSuccess && people.isSuccess && schedules.isSuccess;
  useEffect(() => {
    if (employee && lookupsReady) reset(toForm(employee));
  }, [employee, lookupsReady, reset]);

  const onSubmit = async (values) => {
    setMessage(null);
    try {
      if (isNew) {
        const { id } = await api.post('/api/admin/employees', toPayload(values));
        invalidate();
        navigate(`/admin/employees/${id}`, { replace: true });
      } else {
        await api.patch(`/api/admin/employees/${employee.id}`, toPayload(values, Object.keys(dirtyFields)));
        invalidate();
        setMessage({ tone: 'ok', text: 'Changes saved.' });
      }
    } catch (err) {
      const left = applyServerErrors(err, setError, FIELDS);
      if (left) setMessage({ tone: 'danger', text: left });
    }
  };

  const err = (f) => errors[f]?.message;
  const req = { required: 'Required' };
  const activeDepartments =
    departments.data?.items.filter((d) => d.isActive || d.id === employee?.departmentId) ?? [];

  if (!lookupsReady) {
    const failed = [departments, people, schedules].find((q) => q.isError);
    return (
      <Section title="Employment details">
        {failed ? <LoadError error={failed.error} onRetry={() => failed.refetch()} /> : <Loading />}
      </Section>
    );
  }

  return (
    <Section title="Employment details">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id="firstName" label="First name" error={err('firstName')}>
          <Input
            id="firstName"
            autoComplete="off"
            invalid={!!err('firstName')}
            {...register('firstName', req)}
          />
        </Field>
        <Field id="lastName" label="Last name" error={err('lastName')}>
          <Input
            id="lastName"
            autoComplete="off"
            invalid={!!err('lastName')}
            {...register('lastName', req)}
          />
        </Field>
        <Field id="employeeNumber" label="Employee number" error={err('employeeNumber')}>
          <Input id="employeeNumber" invalid={!!err('employeeNumber')} {...register('employeeNumber', req)} />
        </Field>
        <Field
          id="email"
          label="Work email"
          optional
          error={err('email')}
          hint="Used for notifications, not for sign-in."
        >
          <Input id="email" type="email" invalid={!!err('email')} {...register('email')} />
        </Field>
        <Field id="jobTitle" label="Job title" optional error={err('jobTitle')} className="sm:col-span-2">
          <Input id="jobTitle" invalid={!!err('jobTitle')} {...register('jobTitle')} />
        </Field>
        <Field
          id="sex"
          label="Sex"
          optional
          error={err('sex')}
          hint="Used only for maternity, paternity and Mother’s Day leave eligibility."
        >
          <Select id="sex" invalid={!!err('sex')} {...register('sex')}>
            <option value="">Not recorded</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
          </Select>
        </Field>
        <Field id="departmentId" label="Department" optional error={err('departmentId')}>
          <Select id="departmentId" invalid={!!err('departmentId')} {...register('departmentId')}>
            <option value="">No department</option>
            {activeDepartments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="lineManagerId"
          label="Line manager"
          optional
          error={err('lineManagerId')}
          hint="Reviews this person’s leave first."
        >
          <Select id="lineManagerId" invalid={!!err('lineManagerId')} {...register('lineManagerId')}>
            <option value="">No line manager</option>
            {people.data?.items
              .filter((p) => p.id !== employee?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="employmentStartDate" label="Start date" error={err('employmentStartDate')}>
          <Input
            id="employmentStartDate"
            type="date"
            invalid={!!err('employmentStartDate')}
            {...register('employmentStartDate', req)}
          />
        </Field>
        <Field id="employmentEndDate" label="End date" optional error={err('employmentEndDate')}>
          <Input
            id="employmentEndDate"
            type="date"
            invalid={!!err('employmentEndDate')}
            {...register('employmentEndDate')}
          />
        </Field>
        <Field
          id="workScheduleId"
          label="Working schedule"
          optional
          error={err('workScheduleId')}
          hint="Leave blank for the company default."
        >
          <Select id="workScheduleId" invalid={!!err('workScheduleId')} {...register('workScheduleId')}>
            <option value="">Company default</option>
            {schedules.data?.items
              .filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" busy={isSubmitting} disabled={!isNew && !isDirty}>
            {isNew ? 'Create employee' : 'Save changes'}
          </Button>
          {message && (
            <span className={message.tone === 'ok' ? 'text-sm text-ok' : 'text-sm text-danger'}>
              {message.text}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

function IdentityPanel({ employee }) {
  const invalidate = useInvalidateEmployee(employee.id);
  const [objectId, setObjectId] = useState('');
  const link = useMutation({
    mutationFn: () => api.put(`/api/admin/employees/${employee.id}/identity`, { objectId: objectId.trim() }),
    onSuccess: () => {
      setObjectId('');
      invalidate();
    },
  });
  const unlink = useMutation({
    mutationFn: () => api.del(`/api/admin/employees/${employee.id}/identity`),
    onSuccess: invalidate,
  });
  const id = employee.identity;

  return (
    <Section title="Microsoft account" description="How this person signs in.">
      {id ? (
        <div className="space-y-3 text-sm">
          <Badge tone="ok">Linked</Badge>
          <Details
            items={[
              ['Account', id.email],
              ['Last sign-in', id.lastSignInAt ? formatDateTime(id.lastSignInAt) : 'Never'],
            ]}
          />
          {unlink.isError && <Notice tone="danger">{unlink.error.message}</Notice>}
          <Button
            variant="danger"
            busy={unlink.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Unlink this Microsoft account? The person will be signed out and cannot sign in until it is linked again.',
                )
              ) {
                unlink.mutate();
              }
            }}
          >
            Unlink account
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            link.mutate();
          }}
        >
          <p className="text-sm text-muted">
            Not linked. The easiest way: ask them to sign in once, then link them from{' '}
            <Link to="/admin/sign-in-requests" className="text-brand underline">
              Sign-in requests
            </Link>
            . Or enter their Object ID from the Microsoft Entra admin centre.
          </p>
          <Field id="objectId" label="Entra Object ID" error={link.isError ? link.error.message : null}>
            <Input
              id="objectId"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={objectId}
              onChange={(ev) => setObjectId(ev.target.value)}
              invalid={link.isError}
            />
          </Field>
          <Button type="submit" variant="secondary" busy={link.isPending} disabled={!objectId.trim()}>
            Link account
          </Button>
        </form>
      )}
    </Section>
  );
}

function RolesPanel({ employee }) {
  const invalidate = useInvalidateEmployee(employee.id);
  const [roles, setRoles] = useState(employee.roles);
  useEffect(() => setRoles(employee.roles), [employee.roles]);
  const save = useMutation({
    mutationFn: () => api.put(`/api/admin/employees/${employee.id}/roles`, { roles }),
    onSuccess: invalidate,
  });
  const changed = [...roles].sort().join() !== [...employee.roles].sort().join();
  const toggle = (r) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  return (
    <Section
      title="System roles"
      description="Everyone can apply for leave. Line managers are set by the reporting line."
    >
      <fieldset className="space-y-2.5" disabled={employee.status !== 'ACTIVE'}>
        <legend className="sr-only">Roles</legend>
        {[
          ['HR_OFFICER', 'Gives final approval and manages leave balances.'],
          ['HR_ADMIN', 'Manages employees, roles, calendars and settings.'],
        ].map(([code, help]) => (
          <label key={code} className="flex gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-brand"
              checked={roles.includes(code)}
              onChange={() => toggle(code)}
            />
            <span>
              <span className="font-medium">{ROLE_LABELS[code]}</span>
              <span className="block text-xs text-muted">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {save.isError && (
        <div className="mt-3">
          <Notice tone="danger">{save.error.message}</Notice>
        </div>
      )}
      <Button
        className="mt-4"
        variant="secondary"
        busy={save.isPending}
        disabled={!changed}
        onClick={() => save.mutate()}
      >
        Save roles
      </Button>
    </Section>
  );
}

function StatusPanel({ employee }) {
  const invalidate = useInvalidateEmployee(employee.id);
  const { data: me } = useMe();
  const [reason, setReason] = useState('');
  const deactivate = useMutation({
    mutationFn: () => api.post(`/api/admin/employees/${employee.id}/deactivate`, { reason }),
    onSuccess: () => {
      setReason('');
      invalidate();
    },
  });
  const reactivate = useMutation({
    mutationFn: () => api.post(`/api/admin/employees/${employee.id}/reactivate`),
    onSuccess: invalidate,
  });
  if (me?.id === employee.id) return null;

  return employee.status === 'ACTIVE' ? (
    <Section
      title="Deactivate"
      description="Use when someone leaves. They are signed out and cannot sign in. History is kept."
    >
      <Field id="deactivateReason" label="Reason" optional>
        <Textarea id="deactivateReason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {deactivate.isError && (
        <div className="mt-3">
          <Notice tone="danger">{deactivate.error.message}</Notice>
        </div>
      )}
      <Button
        className="mt-3"
        variant="danger"
        busy={deactivate.isPending}
        onClick={() =>
          window.confirm(`Deactivate ${employee.firstName} ${employee.lastName}?`) && deactivate.mutate()
        }
      >
        Deactivate employee
      </Button>
    </Section>
  ) : (
    <Section
      title="Inactive"
      description={employee.deactivatedAt ? `Deactivated ${formatDateTime(employee.deactivatedAt)}.` : null}
    >
      {employee.employmentEndDate && (
        <p className="mb-3 text-sm">End date: {formatDate(employee.employmentEndDate)}</p>
      )}
      {reactivate.isError && <Notice tone="danger">{reactivate.error.message}</Notice>}
      <Button variant="secondary" busy={reactivate.isPending} onClick={() => reactivate.mutate()}>
        Reactivate employee
      </Button>
    </Section>
  );
}
