import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CalendarPlus, ClipboardCheck, LayoutGrid, Scale, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { can, hasRole, seesWholeGroup, useMe } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import { days } from '../../lib/leave.js';
import {
  ActionTile,
  ActionTiles,
  Kpi,
  KpiRow,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  TodayDate,
} from '../../components/ui.jsx';
import { RequestList } from './dashboard-ui.jsx';
import { BalanceDonut, MonthlyLeaveChart, TypeDonut } from './dashboard-charts.jsx';

export default function HomePage() {
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['dashboard', 'employee'],
    queryFn: () => api.get('/api/dashboard/employee'),
  });

  return (
    <div className="stack">
      <PageHeader title="Home" actions={<TodayDate />} />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Body d={q.data} me={me} />
      )}
    </div>
  );
}

/** Shortcuts, as the inventory dashboard's solid tiles. Approvers get their queues too. */
function Shortcuts({ me, i }) {
  const waiting = (n) => (n > 0 ? `${n} waiting` : undefined);
  return (
    <ActionTiles>
      <ActionTile
        to="/leave/apply"
        icon={CalendarPlus}
        title="Apply for leave"
        desc="Book time off"
        tone="receive"
      />
      <ActionTile to="/leave" icon={CalendarCheck} title="My leave" desc="Your requests" tone="stock" />
      <ActionTile
        to="/leave/balances"
        icon={Scale}
        title="My balances"
        desc="Days you have left"
        tone="reports"
      />
      {(me.isManager || me.isDelegate || hasRole(me, 'HR_ADMIN')) && (
        <ActionTile
          to="/approvals"
          icon={ClipboardCheck}
          title="Approvals"
          desc="Your team's requests"
          badge={waiting(i.teamApprovals)}
          tone="issue"
        />
      )}
      {can(me, 'leave.approve_final') && (
        <ActionTile
          to="/hr/approvals"
          icon={ShieldCheck}
          title="HR approvals"
          desc="Final decisions"
          badge={waiting(i.hrApprovals)}
          tone="request"
        />
      )}
      {seesWholeGroup(me) && !can(me, 'leave.approve_final') && (
        <ActionTile
          to="/hr"
          icon={LayoutGrid}
          title="Group overview"
          desc="Leave across the group"
          tone="request"
        />
      )}
    </ActionTiles>
  );
}

function Body({ d, me }) {
  const main = d.balances.find((b) => b.kind === 'BALANCE');
  return (
    <>
      <Insights i={d.insights} year={d.year} />
      <Shortcuts me={me} i={d.insights} />

      {d.actions.length > 0 && (
        <Notice tone="pending" title="Needs your attention">
          <ul className="space-y-0.5">
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

      <div className="grid-2">
        {main && (
          <Section
            title={`${main.leaveType.name}, ${d.year}`}
            actions={
              <Link to="/leave/balances" className="card-link">
                All balances
              </Link>
            }
          >
            <BalanceDonut b={main} />
          </Section>
        )}
        <Section title={`Days taken by leave type, ${d.year}`}>
          <TypeDonut
            label={`Days taken by leave type, ${d.year}`}
            empty={`No leave taken yet in ${d.year}.`}
            items={d.balances.map((b) => ({
              key: b.leaveType.id,
              name: b.leaveType.name,
              value: b.taken ?? 0,
            }))}
          />
        </Section>
      </div>

      <Section title={`Your leave by month, ${d.year}`}>
        <MonthlyLeaveChart months={d.charts.monthly} year={d.year} />
      </Section>

      <div className="grid-2">
        <Section title="Waiting for a decision">
          <RequestList items={d.pending} empty="No requests are waiting for a decision." />
        </Section>
        <Section title="Upcoming approved leave">
          <RequestList items={d.upcoming} empty="No approved leave coming up." />
        </Section>
      </div>
    </>
  );
}

function Insights({ i, year }) {
  return (
    <KpiRow>
      <Kpi
        label={i.main ? `${i.main.leaveType} available` : 'Days available'}
        value={i.main ? i.main.available : '—'}
        unit={i.main ? 'days' : undefined}
        to="/leave/balances"
      />
      <Kpi label={`Taken in ${year}`} value={i.takenThisYear} unit="days" to="/leave/balances" />
      <Kpi
        label="Your pending requests"
        value={i.awaitingDecision}
        tone={i.awaitingDecision > 0 ? 'warn' : undefined}
        to="/leave"
      />
      {i.onLeaveNow ? (
        <Kpi
          label="On leave"
          value={`Until ${formatDate(i.onLeaveNow.endDate)}`}
          small
          to={`/leave/requests/${i.onLeaveNow.id}`}
        />
      ) : (
        <Kpi
          label="Next leave"
          value={i.nextLeave ? formatDate(i.nextLeave.startDate) : 'None booked'}
          note={i.nextLeave ? days(i.nextLeave.chargeableDays) : undefined}
          small
          to={i.nextLeave ? `/leave/requests/${i.nextLeave.id}` : '/leave/apply'}
        />
      )}
    </KpiRow>
  );
}
