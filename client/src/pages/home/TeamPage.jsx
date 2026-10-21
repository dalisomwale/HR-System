import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { FileBarChart } from 'lucide-react';
import { ButtonLink, LoadError, Loading, Notice, PageHeader, Section } from '../../components/ui.jsx';
import { RequestList, Stat, Stats, Waiting } from './dashboard-ui.jsx';
import { MonthlyLeaveChart, PeopleOffChart, TeamTodayDonut } from './dashboard-charts.jsx';

export default function TeamPage() {
  const q = useQuery({
    queryKey: ['dashboard', 'manager'],
    queryFn: () => api.get('/api/dashboard/manager'),
  });
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Departmental overview"
        actions={
          <ButtonLink to="/reports">
            <FileBarChart className="size-4" aria-hidden /> Team reports
          </ButtonLink>
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Body d={q.data} />
      )}
    </div>
  );
}

function Body({ d }) {
  const overdue = d.awaiting.filter((r) => r.overdue).length;
  return (
    <>
      {d.coveringFor.length > 0 && (
        <Notice tone="neutral" title={`You are covering approvals for ${d.coveringFor.join(', ')}.`} />
      )}
      <Stats>
        <Stat label="Waiting for you" value={d.awaiting.length + d.awaitingChanges} to="/approvals" />
        <Stat label="Overdue" value={overdue} tone="danger" to="/approvals" />
        <Stat label="On leave today" value={d.onLeave.length} />
        <Stat label="People in your team" value={d.teamSize} />
      </Stats>

      <div className="grid gap-6 xl:grid-cols-3">
        <Section title="Your team today">
          <TeamTodayDonut size={d.teamSize} onLeave={d.onLeave.length} />
        </Section>
        <Section title="Who is off in the next 30 days" className="xl:col-span-2">
          <PeopleOffChart daily={d.charts.offDaily} />
        </Section>
      </div>

      <Section title={`Team leave by month, ${d.charts.year}`}>
        <MonthlyLeaveChart months={d.charts.monthly} year={d.charts.year} />
      </Section>

      <Section
        title="Waiting for your review"
        actions={
          <Link to="/approvals" className="text-sm text-brand hover:underline">
            All approvals
          </Link>
        }
      >
        <RequestList
          items={d.awaiting}
          yourTurn="PENDING_MANAGER_APPROVAL"
          showEmployee
          empty="Nothing is waiting for you."
          extra={(r) => <Waiting r={r} />}
        />
        {d.awaitingChanges > 0 && (
          <p className="mt-2 text-sm">
            <Link to="/approvals" className="text-brand underline">
              {d.awaitingChanges} cancellation {d.awaitingChanges === 1 ? 'request' : 'requests'}
            </Link>{' '}
            also waiting.
          </p>
        )}
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="On leave today">
          <RequestList items={d.onLeave} showEmployee empty="Nobody in your team is on leave today." />
        </Section>
        <Section title="Coming up in the next 30 days">
          <RequestList items={d.upcoming} showEmployee empty="No leave planned in the next 30 days." />
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Overlapping absences">
          {d.overlaps.length === 0 ? (
            <p className="text-sm text-muted">No overlaps in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {d.overlaps.map((o) => (
                <li key={`${o.startDate}-${o.people.join()}`} className="py-2">
                  <span className="font-medium">
                    {formatDate(o.startDate)}
                    {o.endDate !== o.startDate && ` – ${formatDate(o.endDate)}`}
                  </span>
                  <span className="text-muted">: {o.people.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Cover not arranged">
          <RequestList
            items={d.handoversOutstanding}
            showEmployee
            empty="Every upcoming absence has cover named."
            extra={(r) =>
              !r.hasNotes ? <span className="text-xs text-muted">No handover notes</span> : null
            }
          />
        </Section>
      </div>
    </>
  );
}
