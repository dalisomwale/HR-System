import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Pencil } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDate, ROLE_LABELS } from '../../lib/format.js';
import {
  Badge,
  Button,
  ButtonLink,
  Details,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Tabs,
  Textarea,
  applyServerErrors,
} from '../../components/ui.jsx';
import AppFrame from '../../layouts/AppFrame.jsx';
import { Trail } from '../../layouts/LeaveTrail.jsx';
import EmployeeOverview from '../people/EmployeeOverview.jsx';
import { EMPLOYMENT_TYPES, Initials, PROBATION, StatusBadge } from '../people/people-ui.jsx';
import { Balances, YearSelect } from '../leave/MyLeavePage.jsx';

/*
 * The My profile application. Employment details are kept by HR and shown read-only;
 * the person keeps their own personal details up to date (D48). The tabs match the employee
 * record HR sees in Employee management (D70).
 */

export const PERSONAL_FIELDS = [
  ['mobilePhone', 'Mobile number'],
  ['personalEmail', 'Personal email'],
  ['homeAddress', 'Home address'],
  ['emergencyContactName', 'Emergency contact'],
  ['emergencyContactRelationship', 'Relationship'],
  ['emergencyContactPhone', 'Emergency contact number'],
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'personal', label: 'Personal details' },
  { id: 'kin', label: 'Next of kin' },
  { id: 'job', label: 'Job details' },
  { id: 'leave', label: 'Leave' },
  { id: 'attendance', label: 'Attendance' },
];

const CONTACT = PERSONAL_FIELDS.slice(0, 3);
const KIN = [
  ['emergencyContactName', 'Name'],
  ['emergencyContactRelationship', 'Relationship'],
  ['emergencyContactPhone', 'Phone number'],
];

export default function ProfilePage() {
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api.get('/api/me/profile') });
  const [tab, setTab] = useState('overview');
  const [year, setYear] = useState(new Date().getFullYear());
  const p = q.data;
  return (
    <AppFrame back>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div>
          <Trail
            items={[{ label: 'My profile', to: '/profile' }, { label: TABS.find((t) => t.id === tab).label }]}
          />
          <section className="mb-6 flex flex-wrap items-center gap-4 rounded-md border border-rule bg-white p-4 sm:p-5">
            <Initials first={p.firstName} last={p.lastName} size="lg" />
            <div className="min-w-0 flex-1 basis-56">
              <h1 className="text-xl font-semibold">
                {p.firstName} {p.lastName}
              </h1>
              <p className="text-sm text-muted">
                {[p.jobTitle, p.department, p.company, p.employeeNumber].filter(Boolean).join(' · ')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge e={p} />
                {p.employmentType && <Badge tone="neutral">{EMPLOYMENT_TYPES[p.employmentType]}</Badge>}
              </div>
            </div>
          </section>

          <Tabs label="My profile" active={tab} onChange={setTab} tabs={TABS} />

          {tab === 'overview' && (
            <div id="panel-overview" role="tabpanel">
              <EmployeeOverview source="/api/me/profile/overview" />
            </div>
          )}
          {tab === 'personal' && (
            <div id="panel-personal" role="tabpanel">
              <PersonalDetails
                title="Personal details"
                note="Keep these up to date. HR uses them to reach you."
                fields={CONTACT}
                personal={p.personal}
              />
            </div>
          )}
          {tab === 'kin' && (
            <div id="panel-kin" role="tabpanel">
              <PersonalDetails
                title="Next of kin"
                note="Who to contact in an emergency."
                fields={KIN}
                personal={p.personal}
              />
            </div>
          )}
          {tab === 'job' && (
            <div id="panel-job" role="tabpanel">
              <Section title="Job details" description="Kept by HR. Ask HR if something is wrong.">
                <Details
                  items={[
                    ['Employee number', p.employeeNumber],
                    ['Job title', p.jobTitle],
                    ['Company', p.company],
                    ['Department', p.department],
                    ['Line manager', p.lineManager],
                    ['Work email', p.email],
                    ['Start date', formatDate(p.employmentStartDate)],
                    ['Employment type', EMPLOYMENT_TYPES[p.employmentType]],
                    ['Contract end date', p.contractEndDate && formatDate(p.contractEndDate)],
                    [
                      'Probation',
                      p.probationStatus &&
                        [
                          PROBATION[p.probationStatus],
                          p.probationEndDate && `ends ${formatDate(p.probationEndDate)}`,
                        ]
                          .filter(Boolean)
                          .join(', '),
                    ],
                    ['Working schedule', p.workSchedule ?? 'Group default'],
                    [
                      'System access',
                      p.roles.length ? p.roles.map((r) => ROLE_LABELS[r]).join(', ') : 'Employee',
                    ],
                  ]}
                />
              </Section>
            </div>
          )}
          {tab === 'leave' && (
            <div id="panel-leave" role="tabpanel">
              <Section
                title={`Leave balances, ${year}`}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <YearSelect year={year} setYear={setYear} />
                    <ButtonLink to="/leave/apply" variant="primary">
                      <CalendarPlus className="size-4" aria-hidden /> Apply for leave
                    </ButtonLink>
                  </div>
                }
              >
                <Balances year={year} bare />
                <p className="mt-4 text-sm">
                  <Link to="/leave" className="text-brand hover:underline">
                    See all my requests
                  </Link>
                </p>
              </Section>
            </div>
          )}
          {tab === 'attendance' && (
            <div id="panel-attendance" role="tabpanel">
              <Section title="Attendance">
                <p className="text-sm text-muted">
                  Coming soon. Your clock-in times, absences and lateness will appear here once attendance is
                  set up.
                </p>
              </Section>
            </div>
          )}
        </div>
      )}
    </AppFrame>
  );
}

/** Some of the person's own details, read-only until the pencil is pressed. */
function PersonalDetails({ title, note, fields, personal }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState(null);
  const blank = Object.fromEntries(fields.map(([k]) => [k, personal[k] ?? '']));
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm({ defaultValues: blank });

  const onSubmit = async (values) => {
    setMessage(null);
    try {
      await api.patch('/api/me/profile/personal', values);
      await qc.invalidateQueries({ queryKey: ['profile'] });
      setEditing(false);
      setSaved(true);
    } catch (err) {
      const left = applyServerErrors(
        err,
        setError,
        fields.map(([k]) => k),
      );
      if (left) setMessage(left);
    }
  };
  const err = (f) => errors[f]?.message;

  return (
    <Section
      title={title}
      description={note}
      actions={
        !editing && (
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-md border border-rule bg-white text-ink hover:border-muted"
            aria-label={`Edit ${title.toLowerCase()}`}
            title={`Edit ${title.toLowerCase()}`}
            onClick={() => {
              reset(blank);
              setSaved(false);
              setEditing(true);
            }}
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        )
      }
    >
      {editing ? (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
          {fields.map(([k, label]) => (
            <Field
              key={k}
              id={k}
              label={label}
              error={err(k)}
              className={k === 'homeAddress' ? 'sm:col-span-2' : undefined}
            >
              {k === 'homeAddress' ? (
                <Textarea id={k} rows={2} invalid={!!err(k)} {...register(k)} />
              ) : (
                <Input
                  id={k}
                  type={/Phone$/.test(k) ? 'tel' : k === 'personalEmail' ? 'email' : 'text'}
                  invalid={!!err(k)}
                  {...register(k)}
                />
              )}
            </Field>
          ))}
          {message && (
            <div className="sm:col-span-2">
              <Notice tone="danger">{message}</Notice>
            </div>
          )}
          <div className="flex gap-3 sm:col-span-2">
            <Button type="submit" busy={isSubmitting} disabled={!isDirty}>
              Save changes
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {saved && (
            <div className="mb-4">
              <Notice tone="ok">Changes saved.</Notice>
            </div>
          )}
          <Details items={fields.map(([k, label]) => [label, personal[k]])} />
        </>
      )}
    </Section>
  );
}
