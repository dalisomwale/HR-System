import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Pencil } from 'lucide-react';
import { api } from '../../lib/api.js';
import { can, useMe } from '../../lib/auth.jsx';
import EmployeeBalances from '../admin/EmployeeBalances.jsx';
import { ImportEmployees } from './ImportEmployees.jsx';
import { formatDate, formatDateTime, ROLE_LABELS } from '../../lib/format.js';
import {
  Badge,
  Button,
  ConfirmDialog,
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
  PROBATION,
  ProfileHeader,
  StatusBadge,
  historyValue,
  useEmployeeBase,
} from './people-ui.jsx';
import DepartmentOptions from '../../components/DepartmentOptions.jsx';
import { PERSONAL_FIELDS } from '../employee/ProfilePage.jsx';
import PeopleTrail from './PeopleTrail.jsx';
import EmployeeOverview from './EmployeeOverview.jsx';

const FIELDS = [
  'employeeNumber',
  'firstName',
  'lastName',
  'email',
  'mobilePhone',
  'jobTitle',
  'sex',
  'companyId',
  'departmentId',
  'branchId',
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
    out[f] = ['companyId', 'departmentId', 'branchId', 'lineManagerId', 'workScheduleId'].includes(f)
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
  const canEdit = can(me, 'people.edit');
  const isNew = id === 'new';
  // Add employee: one person through the form, or many from a CSV (D69).
  const [params, setParams] = useSearchParams();
  const addMode = params.get('mode') === 'import' ? 'import' : 'single';
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
  const sidePanels = !isNew && (can(me, ['people.edit', 'people.positions']) || e.directReports.length > 0);

  return (
    <div className="max-w-6xl">
      <PeopleTrail />
      {isNew ? (
        <>
          <PageHeader title="Add Employee" />
          <Tabs
            label="How To Add"
            active={addMode}
            onChange={(m) => setParams(m === 'import' ? { mode: 'import' } : {}, { replace: true })}
            tabs={[
              { id: 'single', label: 'One Employee' },
              { id: 'import', label: 'Import From A File' },
            ]}
          />
        </>
      ) : (
        <ProfileHeader
          person={e}
          action={
            canEdit &&
            !editing && (
              <button
                type="button"
                aria-label="Edit details"
                title="Edit Details"
                className="btn btn-icon"
                onClick={() => {
                  setTab('job');
                  setSaved(false);
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden />
              </button>
            )
          }
        />
      )}
      {!isNew && (
        <Tabs
          label="Employee Record"
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'personal', label: 'Personal Details' },
            { id: 'kin', label: 'Next Of Kin' },
            { id: 'job', label: 'Job Details' },
            { id: 'leave', label: 'Leave' },
            { id: 'attendance', label: 'Attendance' },
          ]}
        />
      )}
      {!isNew && tab === 'overview' && (
        <div id="panel-overview" role="tabpanel">
          <EmployeeOverview employee={e} />
        </div>
      )}
      {!isNew && tab === 'personal' && (
        <div id="panel-personal" role="tabpanel">
          <InfoList
            title="Personal Details"
            note="The employee keeps these up to date on My Profile; HR records sex."
            rows={[
              ['Mobile Number', e.personal?.mobilePhone],
              ['Personal Email', e.personal?.personalEmail],
              ['Home Address', e.personal?.homeAddress],
              ['Sex', SEX[e.sex]],
            ]}
          />
        </div>
      )}
      {!isNew && tab === 'kin' && (
        <div id="panel-kin" role="tabpanel">
          <InfoList
            title="Next Of Kin"
            note="Who to contact in an emergency. The employee keeps this up to date on My Profile."
            rows={[
              ['Name', e.personal?.emergencyContactName],
              ['Relationship', e.personal?.emergencyContactRelationship],
              ['Phone Number', e.personal?.emergencyContactPhone],
            ]}
          />
        </div>
      )}
      {!isNew && tab === 'attendance' && (
        <div id="panel-attendance" role="tabpanel">
          <Section title="Attendance">
            <p className="muted-text">
              Coming soon. Clock-in times, absences and lateness will appear here once attendance is set up.
            </p>
          </Section>
        </div>
      )}
      {isNew && addMode === 'import' && (
        <div id="panel-import" role="tabpanel">
          <ImportEmployees />
        </div>
      )}
      {((isNew && addMode === 'single') || (!isNew && tab === 'job')) && (
        <div
          id={isNew ? 'panel-single' : 'panel-job'}
          role="tabpanel"
          className={sidePanels ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]' : 'grid gap-4'}
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
            <EmployeeDetails employee={e} saved={saved} personal={false} title="Job Details" />
          )}
          {sidePanels && (
            <div className="grid content-start gap-4">
              {e.directReports.length > 0 && (
                <Section title="Direct Reports">
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
              {/* Employment status is for whoever edits employees (D91); Microsoft account and positions
                  for whoever manages positions (D108). */}
              {can(me, 'people.edit') && <StatusPanel employee={e} />}
              {can(me, 'people.positions') && (
                <>
                  <IdentityPanel employee={e} />
                  <RolesPanel employee={e} />
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
            <Notice tone="neutral" title="Leave Balances">
              Balances and adjustments are managed by HR Officers.
            </Notice>
          )}
        </div>
      )}
      {/* Every change to the record stays with the job details it mostly concerns. */}
      {!isNew && tab === 'job' && (
        <div className="mt-6">
          <History employeeId={e.id} />
        </div>
      )}
    </div>
  );
}

/** A titled list of label and value pairs. */
function InfoList({ title, note, rows }) {
  return (
    <Section title={title} description={note}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="whitespace-pre-line">{v || <span className="text-muted">Not recorded</span>}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

const EVENTS = {
  CREATED: 'Record Created',
  DEACTIVATED: 'Marked As Left',
  REACTIVATED: 'Made Active Again',
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
    <Section title="Change History" description="Every change to this record, with who made it">
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
    qc.invalidateQueries({ queryKey: ['employee-overview'] });
    qc.invalidateQueries({ queryKey: ['people-dashboard'] });
    qc.invalidateQueries({ queryKey: ['people-quick'] });
    qc.invalidateQueries({ queryKey: ['employee-options'] });
    qc.invalidateQueries({ queryKey: ['companies'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
}

const SEX = { FEMALE: 'Female', MALE: 'Male' };

/** Read-only employment details; the pencil in the page header switches to the form. */
export function EmployeeDetails({ employee: e, saved, personal = true, title = 'Employment details' }) {
  const none = <span className="text-muted">Not recorded</span>;
  const rows = [
    ['Employee Number', e.employeeNumber],
    ['Work Email', e.email],
    ['Job Title', e.jobTitle],
    ['Company', e.company],
    ['Branch', e.branch],
    ['Department', e.department],
    ['Manager', e.lineManager],
    ...(personal ? [['Sex', SEX[e.sex]]] : []),
    ['Start Date', e.employmentStartDate && formatDate(e.employmentStartDate)],
    ['End Date', e.employmentEndDate && formatDate(e.employmentEndDate)],
    ['Employment Type', EMPLOYMENT_TYPES[e.employmentType]],
    ['Contract End', e.contractEndDate && formatDate(e.contractEndDate)],
    [
      'Probation',
      e.probationStatus &&
        [PROBATION[e.probationStatus], e.probationEndDate && `ends ${formatDate(e.probationEndDate)}`]
          .filter(Boolean)
          .join(', '),
    ],
    ['Pay Grade', e.payGrade],
    ['Working Schedule', e.workSchedule ?? 'Group default'],
  ];
  return (
    <Section title={title}>
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
      {personal && e.personal && (
        <>
          <h3 className="section-divider mt-5">Personal Details</h3>
          <p className="mb-3 text-xs text-muted">Kept up to date by the employee on My Profile.</p>
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
  // Branches (D110): each belongs to a company; the employee's is one of their company's.
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/api/admin/branches') });

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
    departments.isSuccess &&
    companies.isSuccess &&
    people.isSuccess &&
    schedules.isSuccess &&
    branches.isSuccess;
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
  const branchId = watch('branchId');
  const companyBranches = (branches.data?.items ?? []).filter(
    (b) =>
      String(b.companyId) === String(companyId) &&
      (b.isActive || String(b.id) === String(employee?.branchId)),
  );
  // A branch of another company no longer fits once the company changes.
  const clearOtherBranch = (nextCompanyId) => {
    const b = (branches.data?.items ?? []).find((x) => String(x.id) === String(branchId));
    if (b && String(b.companyId) !== String(nextCompanyId)) setValue('branchId', '', { shouldDirty: true });
  };
  const activeDepartments =
    departments.data?.items.filter(
      (d) =>
        (d.isActive || d.id === employee?.departmentId) &&
        (!companyId || String(d.companyId) === String(companyId)),
    ) ?? [];
  const companyField = register('companyId', req);
  const departmentField = register('departmentId');
  // Managers come from the chosen department, plus the executives (D84, D85). With no department,
  // anyone can be chosen; someone already set as manager stays in the list so it is never lost.
  const departmentId = watch('departmentId');
  const currentManagerId = String(watch('lineManagerId') ?? '');
  const managerChoices = (people.data?.items ?? []).filter(
    (p) =>
      p.id !== employee?.id &&
      (!departmentId ||
        p.executive ||
        String(p.departmentId) === String(departmentId) ||
        String(p.id) === String(employee?.lineManagerId ?? '')),
  );

  if (!lookupsReady) {
    const failed = [departments, companies, people, schedules].find((q) => q.isError);
    return (
      <Section title="Employment Details">
        {failed ? <LoadError error={failed.error} onRetry={() => failed.refetch()} /> : <Loading />}
      </Section>
    );
  }

  return (
    <Section title={title ?? (isNew ? 'Employment Details' : 'Edit Employment Details')}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id="firstName" label="First Name" error={err('firstName')}>
          <Input
            id="firstName"
            autoComplete="off"
            invalid={!!err('firstName')}
            {...register('firstName', req)}
          />
        </Field>
        <Field id="lastName" label="Last Name" error={err('lastName')}>
          <Input
            id="lastName"
            autoComplete="off"
            invalid={!!err('lastName')}
            {...register('lastName', req)}
          />
        </Field>
        <Field id="employeeNumber" label="Employee Number" error={err('employeeNumber')}>
          <Input id="employeeNumber" invalid={!!err('employeeNumber')} {...register('employeeNumber', req)} />
        </Field>
        <Field id="email" label="Work Email" error={err('email')}>
          <Input id="email" type="email" invalid={!!err('email')} {...register('email')} />
        </Field>
        <Field
          id="mobilePhone"
          label="Phone Number"
          optional
          error={err('mobilePhone')}
          hint="Mobile, e.g. 097 123 4567. AMS branch staff sign in with it."
        >
          <Input id="mobilePhone" type="tel" invalid={!!err('mobilePhone')} {...register('mobilePhone')} />
        </Field>
        <Field id="jobTitle" label="Job Title" error={err('jobTitle')} className="sm:col-span-2">
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
              clearOtherBranch(ev.target.value);
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
              // A manager from another department no longer fits, so clear them.
              const manager = people.data?.items.find((p) => String(p.id) === currentManagerId);
              if (
                manager &&
                ev.target.value &&
                !manager.executive &&
                String(manager.departmentId) !== ev.target.value
              ) {
                setValue('lineManagerId', '', { shouldDirty: true });
              }
              // A department belongs to one company, so choosing it also sets the company.
              const dept = departments.data.items.find((d) => String(d.id) === ev.target.value);
              if (dept?.companyId && String(dept.companyId) !== String(watch('companyId'))) {
                setValue('companyId', String(dept.companyId), { shouldDirty: true, shouldValidate: true });
                clearOtherBranch(String(dept.companyId));
              }
            }}
          >
            <option value="">No Department</option>
            <DepartmentOptions departments={activeDepartments} />
          </Select>
        </Field>
        <Field
          id="branchId"
          label="Branch"
          error={err('branchId')}
          hint={companyId ? undefined : 'Choose the company first.'}
        >
          <Select id="branchId" invalid={!!err('branchId')} disabled={!companyId} {...register('branchId')}>
            <option value="">No Branch</option>
            {companyBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.location ? ` · ${b.location}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="lineManagerId"
          label="Manager"
          error={err('lineManagerId')}
          hint={
            departmentId
              ? managerChoices.length === 0
                ? 'Nobody else is in this department yet.'
                : 'People in the chosen department, and the executives.'
              : 'Choose a department to list its people.'
          }
        >
          <Select id="lineManagerId" invalid={!!err('lineManagerId')} {...register('lineManagerId')}>
            <option value="">No Manager</option>
            {departmentId ? (
              <>
                {[
                  ['This Department', managerChoices.filter((p) => !p.executive)],
                  ['Executives', managerChoices.filter((p) => p.executive)],
                ]
                  .filter(([, list]) => list.length > 0)
                  .map(([group, list]) => (
                    <optgroup key={group} label={group}>
                      {list.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </>
            ) : (
              managerChoices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))
            )}
          </Select>
        </Field>
        <Field
          id="sex"
          label="Sex"
          error={err('sex')}
          hint="Used for maternity, paternity and Mother’s Day leave eligibility, and for staff statistics."
        >
          <Select id="sex" invalid={!!err('sex')} {...register('sex')}>
            <option value="">Not Recorded</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
          </Select>
        </Field>
        <Field id="employmentStartDate" label="Start Date" error={err('employmentStartDate')}>
          <Input
            id="employmentStartDate"
            type="date"
            invalid={!!err('employmentStartDate')}
            {...register('employmentStartDate', req)}
          />
        </Field>
        <Field id="employmentEndDate" label="End Date" error={err('employmentEndDate')}>
          <Input
            id="employmentEndDate"
            type="date"
            invalid={!!err('employmentEndDate')}
            {...register('employmentEndDate')}
          />
        </Field>
        <Field id="employmentType" label="Employment Type" error={err('employmentType')}>
          <Select id="employmentType" invalid={!!err('employmentType')} {...register('employmentType')}>
            <option value="">Not Recorded</option>
            {Object.entries(EMPLOYMENT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="contractEndDate"
          label="Contract End"
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
            <option value="">Not Recorded</option>
            {Object.entries(PROBATION).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="probationEndDate" label="Probation End" error={err('probationEndDate')}>
          <Input
            id="probationEndDate"
            type="date"
            invalid={!!err('probationEndDate')}
            {...register('probationEndDate')}
          />
        </Field>
        <Field id="payGrade" label="Pay Grade" error={err('payGrade')} hint="Seen only by HR and directors.">
          <Input id="payGrade" invalid={!!err('payGrade')} {...register('payGrade')} />
        </Field>
        <Field
          id="workScheduleId"
          label="Working Schedule"
          error={err('workScheduleId')}
          hint="Leave blank for the group default."
        >
          <Select id="workScheduleId" invalid={!!err('workScheduleId')} {...register('workScheduleId')}>
            <option value="">Group Default</option>
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
            {isNew ? 'Create Employee' : 'Save Changes'}
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
    <Section title="Microsoft Account">
      {id ? (
        <div className="space-y-3 text-sm">
          <Badge tone="ok">Linked</Badge>
          <Details
            items={[
              ['Account', id.email],
              ['Last Sign-in', id.lastSignInAt ? formatDateTime(id.lastSignInAt) : 'Never'],
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
            Unlink Account
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
          <p className="muted-text">
            Not linked yet. It links by itself the first time they sign in, if the work email on this record
            matches their Microsoft account. Or enter their Object ID from the Microsoft Entra admin centre.
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
            Link Account
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
    <Section title="Positions">
      <fieldset className="space-y-2.5" disabled={employee.status !== 'ACTIVE'}>
        <legend className="sr-only">Roles</legend>
        {[
          ['HR_ADMIN', 'Every right in the system, including settings and roles.'],
          [
            'DEPARTMENT_MANAGER',
            'Approves leave and sees the team pages for everyone in their own department.',
          ],
          ['EXECUTIVE_DIRECTOR', 'Sees leave across the group and every report. Cannot approve.'],
          ['MANAGING_DIRECTOR', 'Sees leave across the group and every report. Cannot approve.'],
          ['ACCOUNTS_DIRECTOR', 'Sees leave across the group and every report. Cannot approve.'],
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
        Save Roles
      </Button>
    </Section>
  );
}

/** Active or Left: HR records a leaver with their leaving date, or makes them active again (D91). */
function StatusPanel({ employee }) {
  const invalidate = useInvalidateEmployee(employee.id);
  const { data: me } = useMe();
  const [reason, setReason] = useState('');
  // Today on this computer's calendar, not UTC, so late evening still gives today's date.
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [confirming, setConfirming] = useState(null);
  const deactivate = useMutation({
    mutationFn: () => api.post(`/api/admin/employees/${employee.id}/deactivate`, { reason, endDate }),
    onSuccess: () => {
      setReason('');
      setConfirming(null);
      invalidate();
    },
  });
  const reactivate = useMutation({
    mutationFn: () => api.post(`/api/admin/employees/${employee.id}/reactivate`),
    onSuccess: () => {
      setConfirming(null);
      invalidate();
    },
  });
  const name = `${employee.firstName} ${employee.lastName}`;
  const active = employee.status === 'ACTIVE';

  return (
    <Section
      title="Employment Status"
      actions={active ? <Badge tone="ok">Active</Badge> : <Badge>Left</Badge>}
    >
      {me?.id === employee.id ? (
        <p className="muted-text">You cannot change the status of your own record.</p>
      ) : active ? (
        <>
          <p className="mb-3 text-sm text-muted">
            When someone leaves, mark them as left. They are signed out and can no longer sign in; their
            record and history are kept.
          </p>
          <div className="grid gap-3">
            <Field id="endDate" label="Leaving Date">
              <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field id="deactivateReason" label="Reason">
              <Textarea
                id="deactivateReason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          {deactivate.isError && (
            <div className="mt-3">
              <Notice tone="danger">{deactivate.error.message}</Notice>
            </div>
          )}
          <Button className="mt-3" variant="danger" onClick={() => setConfirming('leave')}>
            Mark As Left
          </Button>
        </>
      ) : (
        <>
          <dl className="mb-3 grid gap-1 text-sm">
            {employee.employmentEndDate && (
              <div>
                <dt className="inline text-muted">Leaving Date: </dt>
                <dd className="inline">{formatDate(employee.employmentEndDate)}</dd>
              </div>
            )}
            {employee.deactivatedAt && (
              <div>
                <dt className="inline text-muted">Recorded: </dt>
                <dd className="inline">{formatDateTime(employee.deactivatedAt)}</dd>
              </div>
            )}
          </dl>
          {reactivate.isError && (
            <div className="mb-3">
              <Notice tone="danger">{reactivate.error.message}</Notice>
            </div>
          )}
          <Button variant="secondary" onClick={() => setConfirming('return')}>
            Make Active Again
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirming === 'leave'}
        title={`Mark ${name} as left?`}
        confirmLabel="Mark As Left"
        tone="danger"
        busy={deactivate.isPending}
        onConfirm={() => deactivate.mutate()}
        onCancel={() => setConfirming(null)}
      >
        They will be signed out and will not be able to sign in. Leaving date: {formatDate(endDate)}.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === 'return'}
        title={`Make ${name} active again?`}
        confirmLabel="Make Active"
        busy={reactivate.isPending}
        onConfirm={() => reactivate.mutate()}
        onCancel={() => setConfirming(null)}
      >
        They will be able to sign in again.
      </ConfirmDialog>
    </Section>
  );
}
