import { CalendarRange, ClipboardCheck, Target, UserCheck, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import {
  ActionTile,
  ActionTiles,
  Badge,
  EmptyState,
  LoadError,
  Loading,
  PageHeader,
  Section,
  Table,
  Td,
  Th,
  TodayDate,
} from '../../components/ui.jsx';
import { BarList } from '../../components/charts.jsx';
import { PHASE, STATUS, nextText, usePf } from './pf.js';

/** Performance home (D115): your appraisal, your team's, and how the year is going. */
export default function PerformanceHomePage() {
  const { data: me } = useMe();
  const pf = usePf();
  const sum = useQuery({ queryKey: ['pf-summary'], queryFn: () => api.get('/api/performance/summary') });
  if (pf.isPending || sum.isPending) return <Loading />;
  if (pf.isError || sum.isError)
    return <LoadError error={pf.error ?? sum.error} onRetry={() => sum.refetch()} />;
  const a = pf.data;
  const c = a.counts;
  const s = sum.data;
  const tiles = [
    {
      to: '/performance/mine',
      icon: Target,
      title: c.mine ? `My appraisal: your turn (${c.mine})` : 'My appraisals',
      desc: 'Goals, mid-year and year-end',
      tone: c.mine ? 'issue' : 'receive',
    },
    (a.isManager || s.team.length > 0) && {
      to: '/performance/team',
      icon: UsersRound,
      title: c.team ? `My team: your turn (${c.team})` : 'My team',
      desc: 'Agree goals, review and rate',
      tone: c.team ? 'issue' : 'stock',
    },
    a.signoff && {
      to: '/performance/team?scope=all&status=FINAL_MANAGER_DONE',
      icon: ClipboardCheck,
      title: `To sign off (${c.signoff})`,
      desc: 'Year-end appraisals waiting for HR',
      tone: c.signoff ? 'issue' : 'reports',
    },
    (a.isManager || a.probation || c.probation > 0) && {
      to: '/performance/probation',
      icon: UserCheck,
      title: `Probation reviews${c.probation ? ` (${c.probation})` : ''}`,
      desc: a.probation ? 'Recommendations and decisions' : 'Your team’s probation reviews',
      tone: c.probation ? 'issue' : 'request',
    },
    a.cycles && {
      to: '/performance/cycles',
      icon: CalendarRange,
      title: 'Review cycles',
      desc: 'Start the year and move it on',
      tone: 'reports',
    },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader title="Dashboard" actions={<TodayDate />} />
      <div className="stack">
        <ActionTiles>
          {tiles.map((t) => (
            <ActionTile key={t.to} {...t} />
          ))}
        </ActionTiles>

        {s.mine.map((m) => {
          const n = nextText(m, me?.id);
          return (
            <Section
              key={m.id}
              title={`My appraisal · ${m.cycle.name}`}
              description={PHASE[m.cycle.phase][0]}
              actions={
                <Link
                  to={`/performance/appraisals/${m.id}`}
                  className={`btn btn-sm ${n?.mine ? 'btn-primary' : ''}`}
                >
                  {n?.mine ? n.text : 'Open'}
                </Link>
              }
            >
              <p className="text-sm">
                <Badge tone={STATUS[m.status][1]}>{STATUS[m.status][0]}</Badge>
                {n && !n.mine && <span className="ml-2 text-muted">Next: {n.text}</span>}
              </p>
            </Section>
          );
        })}

        {s.team.length > 0 && (
          <Section title="My team" description="Appraisals in the current review cycle">
            <Table title="My team" tools={false}>
              <thead>
                <tr>
                  <Th>First name</Th>
                  <Th>Last name</Th>
                  <Th>Status</Th>
                  <Th>Next</Th>
                  <Th>
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {s.team.map((t) => {
                  const n = nextText(t, me?.id);
                  return (
                    <tr key={t.id}>
                      <Td className="font-semibold">{t.employee.firstName}</Td>
                      <Td className="font-semibold">{t.employee.lastName}</Td>
                      <Td>
                        <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>
                      </Td>
                      <Td>{n?.text ?? '—'}</Td>
                      <Td>
                        <Link
                          to={`/performance/appraisals/${t.id}`}
                          className={`btn btn-sm whitespace-nowrap ${n?.mine ? 'btn-primary' : ''}`}
                        >
                          {n?.mine ? 'Your turn' : 'View'}
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Section>
        )}

        {a.viewAll &&
          s.cycles.map((cy) => (
            <Section key={cy.id} title={`${cy.name}: where everyone is`} description={PHASE[cy.status][0]}>
              <BarList
                items={Object.entries(STATUS).map(([k, [label]]) => ({
                  key: k,
                  label,
                  value: cy.progress?.[k] ?? 0,
                  to: `/performance/team?scope=all&cycleId=${cy.id}&status=${k}`,
                }))}
                format={(x) => String(x)}
              />
            </Section>
          ))}

        {s.mine.length === 0 && s.team.length === 0 && !a.viewAll && (
          <div className="card p-0">
            <EmptyState title="No review cycle is running at the moment." />
          </div>
        )}
      </div>
    </div>
  );
}
