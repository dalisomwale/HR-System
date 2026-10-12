import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { seesWholeGroup, useMe } from '../../lib/auth.jsx';
import { formatDateTime } from '../../lib/format.js';
import { ACTION_LABELS, STAGE_LABELS } from '../../lib/leave.js';
import { ButtonLink, LoadError, Loading, Notice, PageHeader, Section } from '../../components/ui.jsx';
import { BalanceCards } from '../leave/MyLeavePage.jsx';
import { RequestList } from './dashboard-ui.jsx';

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

      <Section
        title={`Your balances ${d.year}`}
        actions={
          <Link to="/leave" className="text-sm text-brand hover:underline">
            My leave
          </Link>
        }
      >
        <BalanceCards items={d.balances} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Waiting for a decision">
          <RequestList items={d.pending} empty="No requests are waiting for a decision." />
        </Section>
        <Section title="Upcoming approved leave">
          <RequestList items={d.upcoming} empty="No approved leave coming up." />
        </Section>
      </div>

      <Section title="Recent decisions">
        {d.recentDecisions.length === 0 ? (
          <p className="text-sm text-muted">No decisions yet.</p>
        ) : (
          <ul className="divide-y divide-rule text-sm">
            {d.recentDecisions.map((a, i) => (
              <li key={i} className="py-2">
                <Link
                  to={`/leave/requests/${a.requestId}`}
                  className="font-medium text-brand hover:underline"
                >
                  {a.reference}
                </Link>{' '}
                {a.leaveType}: <span className="font-medium">{ACTION_LABELS[a.action]}</span> by {a.by}
                <span className="text-muted"> · {STAGE_LABELS[a.stage]} · </span>
                <span className="text-xs text-muted">{formatDateTime(a.at)}</span>
                {a.comment && <p className="mt-0.5 text-muted">{a.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
