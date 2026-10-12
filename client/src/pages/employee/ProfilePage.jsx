import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDate, ROLE_LABELS } from '../../lib/format.js';
import {
  Button,
  ConfirmDialog,
  Details,
  LoadError,
  Loading,
  PageHeader,
  Section,
} from '../../components/ui.jsx';

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
              ['Company', p.company],
              ['Department', p.department],
              ['Manager', p.lineManager],
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
        <SignOut />
      </div>
    </div>
  );
}

function SignOut() {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      const { logoutUrl } = await api.post('/api/auth/logout');
      window.location.assign(logoutUrl);
    } catch {
      window.location.assign('/signed-out');
    }
  };
  return (
    <div>
      <Button variant="secondary" onClick={() => setAsking(true)}>
        <LogOut className="size-4" aria-hidden /> Sign out
      </Button>
      <ConfirmDialog
        open={asking}
        title="Sign out?"
        confirmLabel="Sign out"
        busy={busy}
        onConfirm={signOut}
        onCancel={() => setAsking(false)}
      >
        You will need to sign in with Microsoft again to come back.
      </ConfirmDialog>
    </div>
  );
}
