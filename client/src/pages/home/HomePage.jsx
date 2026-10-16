import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { seesWholeGroup, useMe } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import { days } from '../../lib/leave.js';
import { ButtonLink, LoadError, Loading, Notice, PageHeader, Section } from '../../components/ui.jsx';
import { Activity, RequestList } from './dashboard-ui.jsx';

export default function HomePage() {
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['dashboard', 'employee'],
    queryFn: () => api.get('/api/dashboard/employee'),
  });

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={`Welcome, ${me.firstName}`}
        description={[me.jobTitle, me.department, me.company].filter(Boolean).join(' · ') || undefined}
        actions={
          <ButtonLink to="/leave/apply" variant="primary">
            <Plus className="size-4" aria-hidden /> Apply for leave
          </ButtonLink>
        }
      />
      {(me.isManager || me.isDelegate || seesWholeGroup(me)) && <RoleLinks me={me} />}
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

function RoleLinks({ me }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {(me.isManager || me.isDelegate || me.roles.includes('HR_ADMIN')) && (
        <Link to="/team" className="rounded-md border border-rule bg-white px-3 py-2 hover:border-muted">
          Team overview
        </Link>
      )}
      {seesWholeGroup(me) && (
        <Link to="/hr" className="rounded-md border border-rule bg-white px-3 py-2 hover:border-muted">
          {me.roles.includes('HR_OFFICER') ? 'HR overview' : 'Group overview'}
        </Link>
      )}
    </div>
  );
}

function Body({ d }) {
  return (
    <>
      <Insights i={d.insights} year={d.year} />

      {d.actions.length > 0 && (
        <Notice tone="pending" title="Needs your attention">
          <ul className="mt-1 space-y-1">
            {d.actions.map((a) => (
              <li key={`${a.kind}-${a.requestId}`}>
                <Link to={`/leave/requests/${a.requestId}`} className="underline">
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Waiting for a decision">
          <RequestList items={d.pending} empty="No requests are waiting for a decision." />
        </Section>
        <Section title="Upcoming approved leave">
          <RequestList items={d.upcoming} empty="No approved leave coming up." />
        </Section>
      </div>

      <Section title="Recent activity">
        <Activity items={d.activity} />
      </Section>
    </>
  );
}

function Insights({ i, year }) {
  const cards = [];
  if (i.teamApprovals != null) {
    cards.push({
      key: 'team',
      value: i.teamApprovals,
      label: 'Awaiting your approval',
      to: '/approvals',
      alert: i.teamApprovals > 0,
    });
  }
  if (i.hrApprovals != null) {
    cards.push({
      key: 'hr',
      value: i.hrApprovals,
      label: 'Awaiting HR approval',
      to: '/hr/approvals',
      alert: i.hrApprovals > 0,
    });
  }
  if (i.main) {
    cards.push({
      key: 'main',
      value: i.main.available,
      label: `${i.main.leaveType} days available`,
      to: '/leave/balances',
    });
  }
  cards.push(
    {
      key: 'taken',
      value: i.takenThisYear,
      label: `Days taken in ${year}`,
      to: '/leave/balances',
    },
    {
      key: 'awaiting',
      value: i.awaitingDecision,
      label: 'Your pending requests',
      to: '/leave',
    },
    i.onLeaveNow
      ? {
          key: 'next',
          value: 'On leave',
          label: `Until ${formatDate(i.onLeaveNow.endDate)}`,
          to: `/leave/requests/${i.onLeaveNow.id}`,
        }
      : {
          key: 'next',
          value: i.nextLeave ? formatDate(i.nextLeave.startDate) : 'None booked',
          label: i.nextLeave ? `Next leave · ${days(i.nextLeave.chargeableDays)}` : 'Next leave',
          to: i.nextLeave ? `/leave/requests/${i.nextLeave.id}` : '/leave/apply',
        },
  );
  const cols = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-3' }[
    cards.length
  ];

  return (
    <ul className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${cols}`}>
      {cards.map(({ key, value, label, to, alert }) => (
        <li key={key}>
          <Link
            to={to}
            className={`block h-full rounded-lg border bg-white p-4 hover:border-brand ${alert ? 'border-pending/40' : 'border-rule'}`}
          >
            <span className="block">
              <span className={`block text-xl font-semibold ${alert ? 'text-pending' : ''}`}>{value}</span>
              <span className="block text-sm text-muted">{label}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
