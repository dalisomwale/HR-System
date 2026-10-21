import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Pencil } from 'lucide-react';
import { api } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import EmployeeBalances from '../admin/EmployeeBalances.jsx';
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
  Tabs,
  Textarea,
  applyServerErrors,
} from '../../components/ui.jsx';
import {
  EMPLOYMENT_TYPES,
  FIELD_LABELS,
  Initials,
  PROBATION,
  StatusBadge,
  historyValue,
  useEmployeeBase,
} from './people-ui.jsx';
import DepartmentOptions from '../../components/DepartmentOptions.jsx';
import { PERSONAL_FIELDS } from '../employee/ProfilePage.jsx';
import PeopleTrail from './PeopleTrail.jsx';

const FIELDS = [
  'employeeNumber',
  'firstName',
  'lastName',
  'email',
  'jobTitle',
  'sex',
  'companyId',
  'departmentId',
  'lineManagerId',
  'workScheduleId',
  'employmentStartDate',
  'employmentEndDate',
  'employmentType',
  'contractEndDate',
  'probationEndDate',
  'probationStatus',
  'payGrade',
];

const blank = Object.fromEntries(FIELDS.map((f) => [f, '']));
const toForm = (e) => Object.fromEntries(FIELDS.map((f) => [f, e[f] ?? '']));
const toPayload = (values, only) => {
  const out = {};
  for (const f of only ?? FIELDS) {
    const v = values[f];
    out[f] = ['companyId', 'departmentId', 'lineManagerId', 'workScheduleId'].includes(f)
      ? v
        ? Number(v)
        : null
      : v === ''
        ? null
        : v;
  }
  return out;
};

export default function EmployeeRecordPage() {
  const { id, companyId, departmentId } = useParams();
  const base = useEmployeeBase();
  const { data: me } = useMe();
  const canEdit = hasRole(me, 'HR_OFFICER');
  const isNew = id === 'new';
  const [tab, setTab] = useState('overview');
  // Details are read-only until Edit is pressed.
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const employee = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/api/people/employees/${id}`),
    enabled: !isNew,
  });
  useEffect(() => {
    setTab('overview');
    setEditing(false);
    setSaved(false);
  }, [id]);

  if (isNew && !canEdit) return <Notice tone="neutral" title="Only HR Officers add employees." />;
  if (!isNew && employee.isPending) return <Loading />;
  if (!isNew && employee.isError)
    return <LoadError error={employee.error} onRetry={() => employee.refetch()} />;
  const e = employee.data;
  const sidePanels = !isNew && (me.roles.includes('HR_ADMIN') || e.directReports.length > 0);

  return (
    <div className="max-w-6xl">
      <PeopleTrail />
      {isNew ? (
        <PageHeader title="Add employee" />
      ) : (
        <section className="mb-6 flex flex-wrap items-center gap-4 rounded-md border border-rule bg-white p-4 sm:p-5">
          <Initials first={e.firstName} last={e.lastName} size="lg" />
          <div className="min-w-0 flex-1 basis-56">
            <h1 className="text-xl font-semibold">
              {e.firstName} {e.lastName}
            </h1>
            <p className="text-sm text-muted">
              {[e.jobTitle, e.department, e.company, e.employeeNumber].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge e={e} />
              {e.employmentType && <Badge tone="neutral">{EMPLOYMENT_TYPES[e.employmentType]}</Badge>}
            </div>
          </div>
          {canEdit && !editing && (
            <Button
              variant="secondary"
              onClick={() => {
                setTab('overview');
                setSaved(false);
                setEditing(true);
              }}
            >
              <Pencil className="size-4" aria-hidden /> Edit details
            </Button>
          )}
        </section>
      )}
      {!isNew && (
        <Tabs
          label="Employee record"
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'leave', label: 'Leave' },
            { id: 'history', label: 'History' },
          ]}
        />
      )}
      {(isNew || tab === 'overview') && (
        <div
          id="panel-overview"
          role={isNew ? undefined : 'tabpanel'}
          className={sidePanels ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]' : 'grid gap-6'}
        >
          {isNew || editing ? (
            <EmployeeForm
              employee={e}
              isNew={isNew}
              defaults={
                isNew
                  ? Object.fromEntries(Object.entries({ companyId, departmentId }).filter(([, v]) => v))
                  : undefined
              }
              onDone={() => {
                setEditing(false);
                setSaved(true);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <EmployeeDetails employee={e} saved={saved} />
          )}
          {sidePanels && (
            <div className="grid content-start gap-6">
              {e.directReports.length > 0 && (
                <Section title="Direct reports">
                  <ul className="space-y-2 text-sm">
                    {e.directReports.map((r) => (
                      <li key={r.id}>
                        <Link to={`${base}/employees/${r.id}`} className="text-brand hover:underline">
                          {r.name}
                        </Link>
                        <span className="text-muted"> · {r.jobTitle ?? r.employeeNumber}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {/* Microsoft account, roles and deactivation are for System Administrators (D46). */}
              {me.roles.includes('HR_ADMIN') && (
                <>
                  <IdentityPanel employee={e} />
                  <RolesPanel employee={e} />
                  <StatusPanel employee={e} />
                </>
              )}
            </div>
          )}
        </div>
      )}
      {!isNew && tab === 'leave' && (
        <div id="panel-leave" role="tabpanel">
          {canEdit ? (
            <EmployeeBalances employeeId={e.id} />
          ) : (
            <Notice tone="neutral" title="Leave balances">
              Balances and adjustments are managed by HR Officers.
            </Notice>
          )}
        </div>
      )}
      {!isNew && tab === 'history' && (
        <div id="panel-history" role="tabpanel">
          <History employeeId={e.id} />
        </div>
      )}
    </div>
  );
}

const EVENTS = {
  CREATED: 'Record created',
  DEACTIVATED: 'Marked as left',
  REACTIVATED: 'Made active again',
};

/** Every change to the record, newest first (D52). */
function History({ employeeId }) {
  const q = useQuery({
    queryKey: ['employee-history', String(employeeId)],
    queryFn: () => api.get(`/api/people/employees/${employeeId}/history`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.items.length) return <Notice tone="neutral" title="No changes recorded yet." />;
  return (
    <Section title="History" description="Every change to this record, with who made it">
      <ol className="divide-y divide-rule text-sm">
        {q.data.items.map((h) => {
          const label = FIELD_LABELS[h.field] ?? h.field;
          const from = historyValue(h.field, h.from);
          const to = historyValue(h.field, h.to);
          return (
            <li key={h.id} className="flex gap-3 py-3">
              <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
              <div className="min-w-0">
                {h.event === 'UPDATED' ? (
                  <p>
                    <span className="font-medium">{label}</span>{' '}
                    {from ? (
                      <>
                        changed from <span className="text-muted line-through">{from}</span> to{' '}
                        <span className="font-medium">{to ?? 'nothing'}</span>
                      </>
                    ) : (
                      <>
                        set to <span className="font-medium">{to}</span>
                      </>
                    )}
                    {from && !to && ' (cleared)'}
                  </p>
                ) : (
                  <p className="font-medium">{EVENTS[h.event] ?? h.event}</p>
                )}
                {h.reason && <p className="text-muted">{h.reason}</p>}
                <p className="text-xs text-muted">
                  {h.by} · {formatDateTime(h.at)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function useInvalidateEmployee(id) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['employee', String(id)] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['employee-history', String(id)] });
    qc.invalidateQueries({ queryKey: ['people-dashboard'] });
    qc.invalidateQueries({ queryKey: ['people-quick'] });
    qc.invalidateQueries({ queryKey: ['employee-options'] });
    qc.invalidateQueries({ queryKey: ['companies'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
}

const SEX = { FEMALE: 'Female', MALE: 'Male' };

/** Read-only employment details; the pencil in the page header switches to the form. */
export function EmployeeDetails({ employee: e, saved }) {
  const none = <span className="text-muted">Not recorded</span>;
  const rows = [
    ['Employee number', e.employeeNumber],
    ['Work email', e.email],
    ['Job title', e.jobTitle],
    ['Company', e.company],
    ['Department', e.department],
    ['Manager', e.lineManager],
    ['Sex', SEX[e.sex]],
    ['Start date', e.employmentStartDate && formatDate(e.employmentStartDate)],
    ['End date', e.employmentEndDate && formatDate(e.employmentEndDate)],
    ['Employment type', EMPLOYMENT_TYPES[e.employmentType]],
    ['Contract end', e.contractEndDate && formatDate(e.contractEndDate)],
    [
      'Probation',
      e.probationStatus &&
        [PROBATION[e.probationStatus], e.probationEndDate && `ends ${formatDate(e.probationEndDate)}`]
          .filter(Boolean)
          .join(', '),
    ],
    ['Pay grade', e.payGrade],
    ['Working schedule', e.workSchedule ?? 'Group default'],
  ];
  return (
    <Section title="Employment details">
      {saved && (
        <div className="mb-4">
          <Notice tone="ok">Changes saved.</Notice>
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd>{v || none}</dd>
          </div>
        ))}
      </dl>
      {e.personal && (
        <>
          <h3 className="mt-6 mb-2 border-t border-rule pt-4 text-sm font-semibold">Personal details</h3>
          <p className="mb-3 text-xs text-muted">Kept up to date by the employee on My profile.</p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            {PERSONAL_FIELDS.map(([k, label]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="whitespace-pre-line">{e.personal[k] || none}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Section>
  );
}

/**
 * Add or edit an employee. `defaults` pre-fills a new record (e.g. the department it is added
 * from); `onCreated` keeps the person where they are instead of opening the new record.
 */
export function EmployeeForm({ employee, isNew, onDone, onCancel, defaults, onCreated, title }) {
  const navigate = useNavigate();
  const base = useEmployeeBase();
  const invalidate = useInvalidateEmployee(employee?.id);
  const [message, setMessage] = useState(null);
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/api/admin/departments'),
  });
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get('/api/admin/companies') });
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
    setValue,
    watch,
    formState: { errors, dirtyFields, isDirty, isSubmitting },
  } = useForm({ defaultValues: employee ? toForm(employee) : { ...blank, ...defaults } });
  // Fill the form once the dropdown options exist, so selected values show correctly.
  const lookupsReady =
    departments.isSuccess && companies.isSuccess && people.isSuccess && schedules.isSuccess;
  useEffect(() => {
    if (employee && lookupsReady) reset(toForm(employee));
  }, [employee, lookupsReady, reset]);
  // Adding from a department's page: its company is filled in too.
  useEffect(() => {
    if (!isNew || !lookupsReady || !defaults?.departmentId || defaults.companyId) return;
    const dept = departments.data.items.find((x) => String(x.id) === String(defaults.departmentId));
    if (dept?.companyId) setValue('companyId', String(dept.companyId));
  }, [isNew, lookupsReady, defaults, departments.data, setValue]);

  const onSubmit = async (values) => {
    setMessage(null);
    try {
      if (isNew) {
        const { id } = await api.post('/api/admin/employees', toPayload(values));
        invalidate();
        if (onCreated) onCreated(id, values);
        else navigate(`${base}/employees/${id}`, { replace: true });
      } else {
        await api.patch(`/api/admin/employees/${employee.id}`, toPayload(values, Object.keys(dirtyFields)));
        invalidate();
        onDone?.();
      }
    } catch (err) {
      const left = applyServerErrors(err, setError, FIELDS);
      if (left) setMessage({ tone: 'danger', text: left });
    }
  };

  const err = (f) => errors[f]?.message;
  const req = { required: 'Required' };
  // A department belongs to one company, so only the chosen company's departments are offered.
  const companyId = watch('companyId');
  const activeDepartments =
    departments.data?.items.filter(
      (d) =>
        (d.isActive || d.id === employee?.departmentId) &&
        (!companyId || String(d.companyId) === String(companyId)),
    ) ?? [];
  const companyField = register('companyId', req);
  const departmentField = register('departmentId');

  if (!lookupsReady) {
    const failed = [departments, companies, people, schedules].find((q) => q.isError);
    return (
      <Section title="Employment details">
        {failed ? <LoadError error={failed.error} onRetry={() => failed.refetch()} /> : <Loading />}
      </Section>
    );
  }

  return (
    <Section title={title ?? (isNew ? 'Employment details' : 'Edit employment details')}>
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
        <Field id="email" label="Work email" error={err('email')}>
          <Input id="email" type="email" invalid={!!err('email')} {...register('email')} />
        </Field>
        <Field id="jobTitle" label="Job title" error={err('jobTitle')} className="sm:col-span-2">
          <Input id="jobTitle" invalid={!!err('jobTitle')} {...register('jobTitle')} />
        </Field>
        <Field id="companyId" label="Company" error={err('companyId')}>
          <Select
            id="companyId"
            invalid={!!err('companyId')}
            {...companyField}
            onChange={(ev) => {
              companyField.onChange(ev);
              const dept = departments.data.items.find((d) => String(d.id) === String(watch('departmentId')));
              if (dept && String(dept.companyId) !== ev.target.value) {
                setValue('departmentId', '', { shouldDirty: true });
              }
            }}
          >
            <option value="">Choose</option>
            {companies.data.items
              .filter((c) => c.isActive || c.id === employee?.companyId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="departmentId" label="Department" error={err('departmentId')}>
          <Select
            id="departmentId"
            invalid={!!err('departmentId')}
            {...departmentField}
            onChange={(ev) => {
              departmentField.onChange(ev);
              // A department belongs to one company, so choosing it also sets the company.
              const dept = departments.data.items.find((d) => String(d.id) === ev.target.value);
              if (dept?.companyId && String(dept.companyId) !== String(watch('companyId'))) {
                setValue('companyId', String(dept.companyId), { shouldDirty: true, shouldValidate: true });
              }
            }}
          >
            <option value="">No department</option>
            <DepartmentOptions departments={activeDepartments} />
          </Select>
        </Field>
        <Field id="lineManagerId" label="Manager" error={err('lineManagerId')}>
          <Select id="lineManagerId" invalid={!!err('lineManagerId')} {...register('lineManagerId')}>
            <option value="">No manager</option>
            {people.data?.items
              .filter((p) => p.id !== employee?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          id="sex"
          label="Sex"
          error={err('sex')}
          hint="Used for maternity, paternity and Mother’s Day leave eligibility, and for staff statistics."
        >
          <Select id="sex" invalid={!!err('sex')} {...register('sex')}>
            <option value="">Not recorded</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
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
        <Field id="employmentEndDate" label="End date" error={err('employmentEndDate')}>
          <Input
            id="employmentEndDate"
            type="date"
            invalid={!!err('employmentEndDate')}
            {...register('employmentEndDate')}
          />
        </Field>
        <Field id="employmentType" label="Employment type" error={err('employmentType')}>
          <Select id="employmentType" invalid={!!err('employmentType')} {...register('employmentType')}>
            <option value="">Not recorded</option>
            {Object.entries(EMPLOYMENT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="contractEndDate"
          label="Contract end"
          error={err('contractEndDate')}
          hint="For fixed-term and temporary staff."
        >
          <Input
            id="contractEndDate"
            type="date"
            invalid={!!err('contractEndDate')}
            {...register('contractEndDate')}
          />
        </Field>
        <Field id="probationStatus" label="Probation" error={err('probationStatus')}>
          <Select id="probationStatus" invalid={!!err('probationStatus')} {...register('probationStatus')}>
            <option value="">Not recorded</option>
            {Object.entries(PROBATION).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="probationEndDate" label="Probation end" error={err('probationEndDate')}>
          <Input
            id="probationEndDate"
            type="date"
            invalid={!!err('probationEndDate')}
            {...register('probationEndDate')}
          />
        </Field>
        <Field id="payGrade" label="Pay grade" error={err('payGrade')} hint="Seen only by HR and directors.">
          <Input id="payGrade" invalid={!!err('payGrade')} {...register('payGrade')} />
        </Field>
        <Field
          id="workScheduleId"
          label="Working schedule"
          error={err('workScheduleId')}
          hint="Leave blank for the group default."
        >
          <Select id="workScheduleId" invalid={!!err('workScheduleId')} {...register('workScheduleId')}>
            <option value="">Group default</option>
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
          {(!isNew || onCancel) && (
            <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
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
    <Section title="Microsoft account">
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
    <Section title="System roles">
      <fieldset className="space-y-2.5" disabled={employee.status !== 'ACTIVE'}>
        <legend className="sr-only">Roles</legend>
        {[
          ['HR_OFFICER', 'Gives final approval and manages leave balances.'],
          ['HR_ADMIN', 'Every right in the system, including settings and roles.'],
          ['EXECUTIVE_DIRECTOR', 'Sees leave across the group and every report. Cannot approve.'],
          ['MANAGING_DIRECTOR', 'Sees leave across the group and every report. Cannot approve.'],
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
      <Field id="deactivateReason" label="Reason">
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
