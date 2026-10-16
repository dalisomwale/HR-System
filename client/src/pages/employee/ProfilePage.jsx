import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, ROLE_LABELS } from '../../lib/format.js';
import { Details, LoadError, Loading, PageHeader, Section } from '../../components/ui.jsx';
import AppFrame from '../../layouts/AppFrame.jsx';

/** The My profile application: the signed-in person's employee details, nothing else. */
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
      )}
    </AppFrame>
  );
}
