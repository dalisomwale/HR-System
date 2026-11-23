import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { LoadError, Loading, Notice, PageHeader, Section } from '../../components/ui.jsx';
import { RequestList, Stat, Stats, Waiting } from './dashboard-ui.jsx';
import { MonthlyLeaveChart, PeopleOffChart, TeamTodayDonut } from './dashboard-charts.jsx';

export default function TeamPage() {
  const q = useQuery({
    queryKey: ['dashboard', 'manager'],
    queryFn: () => api.get('/api/dashboard/manager'),
  });
  return (
    <div className="stack">
      <PageHeader title="Departmental Overview" />
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
        <Notice tone="neutral" title={`You Are Covering Approvals For ${d.coveringFor.join(', ')}.`} />
      )}
      <Stats color>
        <Stat label="Waiting For You" value={d.awaiting.length + d.awaitingChanges} to="/approvals" />
        <Stat label="Overdue" value={overdue} tone="danger" to="/approvals" />
        <Stat label="On Leave Today" value={d.onLeave.length} />
        <Stat label="People In Your Team" value={d.teamSize} />
      </Stats>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Your Team Today">
          <TeamTodayDonut size={d.teamSize} onLeave={d.onLeave.length} />
        </Section>
        <Section title="Who Is Off In The Next 30 Days" className="xl:col-span-2">
          <PeopleOffChart daily={d.charts.offDaily} />
        </Section>
      </div>

      <Section title={`Team Leave By Month, ${d.charts.year}`}>
        <MonthlyLeaveChart months={d.charts.monthly} year={d.charts.year} />
      </Section>

      <Section
        title="Waiting For Your Review"
        actions={
          <Link to="/approvals" className="card-link">
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

      <div className="grid-2">
        <Section title="On Leave Today">
          <RequestList items={d.onLeave} showEmployee empty="Nobody in your team is on leave today." />
        </Section>
        <Section title="Coming Up In The Next 30 Days">
          <RequestList items={d.upcoming} showEmployee empty="No leave planned in the next 30 days." />
        </Section>
      </div>

      <div className="grid-2">
        <Section title="Overlapping Absences">
          {d.overlaps.length === 0 ? (
            <p className="muted-text">No overlaps in the next 30 days.</p>
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
        <Section title="Cover Not Arranged">
          <RequestList
            items={d.handoversOutstanding}
            showEmployee
            empty="Every upcoming absence has cover named."
            extra={(r) => (!r.hasNotes ? <span className="text-xs text-muted">No handover</span> : null)}
          />
        </Section>
      </div>
    </>
  );
}
