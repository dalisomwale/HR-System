import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate, ROLE_LABELS } from '../../lib/format.js';
import { Details, LoadError, Loading, PageHeader, Section } from '../../components/ui.jsx';

export default function ProfilePage() {
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api.get('/api/me/profile') });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={`${p.firstName} ${p.lastName}`}
        description="Your employee record. If anything here is wrong, contact HR."
      />
      <div className="grid gap-6">
        <Section title="Employment">
          <Details
            items={[
              ['Employee number', p.employeeNumber],
              ['Job title', p.jobTitle],
              ['Department', p.department],
              ['Line manager', p.lineManager],
              ['Work email', p.email],
              ['Start date', formatDate(p.employmentStartDate)],
              ['Working schedule', p.workSchedule],
              ['System access', p.roles.length ? p.roles.map((r) => ROLE_LABELS[r]).join(', ') : 'Employee'],
            ]}
          />
        </Section>
        {p.directReports.length > 0 && (
          <Section title="People who report to you">
            <ul className="divide-y divide-rule text-sm">
              {p.directReports.map((r) => (
                <li key={r.name} className="flex justify-between py-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted">{r.jobTitle}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
