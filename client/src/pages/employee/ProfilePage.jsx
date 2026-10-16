import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDate, ROLE_LABELS } from '../../lib/format.js';
import {
  Button,
  Details,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Textarea,
  applyServerErrors,
} from '../../components/ui.jsx';
import AppFrame from '../../layouts/AppFrame.jsx';

/*
 * The My profile application. Employment details are kept by HR and shown read-only;
 * the person keeps their own personal details up to date (D48).
 */

export const PERSONAL_FIELDS = [
  ['mobilePhone', 'Mobile number'],
  ['personalEmail', 'Personal email'],
  ['homeAddress', 'Home address'],
  ['emergencyContactName', 'Emergency contact'],
  ['emergencyContactRelationship', 'Relationship'],
  ['emergencyContactPhone', 'Emergency contact number'],
];

export default function ProfilePage() {
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api.get('/api/me/profile') });
  return (
    <AppFrame back>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="max-w-3xl">
          <PageHeader title={`${q.data.firstName} ${q.data.lastName}`} />
          <div className="grid gap-6">
            <PersonalDetails personal={q.data.personal} />
            <Section title="Employment details">
              <Details
                items={[
                  ['Employee number', q.data.employeeNumber],
                  ['Job title', q.data.jobTitle],
                  ['Company', q.data.company],
                  ['Department', q.data.department],
                  ['Manager', q.data.lineManager],
                  ['Work email', q.data.email],
                  ['Start date', formatDate(q.data.employmentStartDate)],
                  ['Working schedule', q.data.workSchedule ?? 'Group default'],
                  [
                    'System access',
                    q.data.roles.length ? q.data.roles.map((r) => ROLE_LABELS[r]).join(', ') : 'Employee',
                  ],
                ]}
              />
            </Section>
          </div>
        </div>
      )}
    </AppFrame>
  );
}

function PersonalDetails({ personal }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState(null);
  const blank = Object.fromEntries(PERSONAL_FIELDS.map(([k]) => [k, personal[k] ?? '']));
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
        PERSONAL_FIELDS.map(([k]) => k),
      );
      if (left) setMessage(left);
    }
  };
  const err = (f) => errors[f]?.message;

  return (
    <Section
      title="Personal details"
      actions={
        !editing && (
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-md border border-rule bg-white text-ink hover:border-muted"
            aria-label="Edit personal details"
            title="Edit personal details"
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
          <Field id="mobilePhone" label="Mobile number" optional error={err('mobilePhone')}>
            <Input id="mobilePhone" type="tel" invalid={!!err('mobilePhone')} {...register('mobilePhone')} />
          </Field>
          <Field id="personalEmail" label="Personal email" optional error={err('personalEmail')}>
            <Input
              id="personalEmail"
              type="email"
              invalid={!!err('personalEmail')}
              {...register('personalEmail')}
            />
          </Field>
          <Field
            id="homeAddress"
            label="Home address"
            optional
            error={err('homeAddress')}
            className="sm:col-span-2"
          >
            <Textarea id="homeAddress" rows={2} invalid={!!err('homeAddress')} {...register('homeAddress')} />
          </Field>
          <Field
            id="emergencyContactName"
            label="Emergency contact"
            optional
            error={err('emergencyContactName')}
          >
            <Input
              id="emergencyContactName"
              invalid={!!err('emergencyContactName')}
              {...register('emergencyContactName')}
            />
          </Field>
          <Field
            id="emergencyContactRelationship"
            label="Relationship"
            optional
            error={err('emergencyContactRelationship')}
          >
            <Input
              id="emergencyContactRelationship"
              invalid={!!err('emergencyContactRelationship')}
              {...register('emergencyContactRelationship')}
            />
          </Field>
          <Field
            id="emergencyContactPhone"
            label="Emergency contact number"
            optional
            error={err('emergencyContactPhone')}
          >
            <Input
              id="emergencyContactPhone"
              type="tel"
              invalid={!!err('emergencyContactPhone')}
              {...register('emergencyContactPhone')}
            />
          </Field>
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
          <Details items={PERSONAL_FIELDS.map(([k, label]) => [label, personal[k]])} />
        </>
      )}
    </Section>
  );
}
