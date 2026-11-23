import { Briefcase, CalendarClock, ClipboardCheck, FilePlus2, FileText, UserSearch } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import {
  ActionTile,
  ActionTiles,
  LoadError,
  Loading,
  PageHeader,
  Section,
  TodayDate,
} from '../../components/ui.jsx';
import { BarList } from '../../components/charts.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { useRc } from './rc.js';

/** Recruitment home (D114): what is waiting for you, and how recruitment stands. */
export default function RecruitmentHomePage() {
  const rc = useRc();
  const sum = useQuery({ queryKey: ['rc-summary'], queryFn: () => api.get('/api/recruitment/summary') });
  if (rc.isPending) return <Loading />;
  if (rc.isError) return <LoadError error={rc.error} onRetry={rc.refetch} />;
  const a = rc.data;
  const c = a.counts;
  const s = sum.data;
  const tiles = [
    a.review && {
      to: '/recruitment/requests?status=PENDING_REVIEW',
      icon: ClipboardCheck,
      title: `Hiring Requests To Check (${c.toReview})`,
      desc: 'Send them to a director, or turn them down',
      tone: 'issue',
    },
    a.approve && {
      to: '/recruitment/requests?status=PENDING_APPROVAL',
      icon: ClipboardCheck,
      title: `Hiring Requests To Approve (${c.toApprove})`,
      desc: 'Approve or reject new positions',
      tone: 'issue',
    },
    c.feedbackDue > 0 && {
      to: '/recruitment/interviews',
      icon: CalendarClock,
      title: `Interview Feedback Due (${c.feedbackDue})`,
      desc: 'Give your rating and recommendation',
      tone: 'request',
    },
    a.raise && {
      to: '/recruitment/requests/new',
      icon: FilePlus2,
      title: 'Request A Hire',
      desc: 'Ask for a new or replacement position',
      tone: 'receive',
    },
    (a.view || c.myVacancies > 0) && {
      to: '/recruitment/vacancies',
      icon: UserSearch,
      title: 'Vacancies',
      desc: a.view ? 'Candidates, interviews and offers' : 'The vacancies you are hiring for',
      tone: 'stock',
    },
    {
      to: '/recruitment/jobs',
      icon: Briefcase,
      title: 'Open Positions',
      desc: 'Positions you can apply for',
      tone: 'reports',
    },
    {
      to: '/recruitment/applications',
      icon: FileText,
      title: 'My Applications',
      desc: 'Where your applications stand',
      tone: 'reports',
    },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader title="Dashboard" actions={<TodayDate />} />
      <div className="stack">
        {s && (a.view || c.myVacancies > 0) && (
          <Stats>
            <Stat label="Open Vacancies" value={s.openVacancies} to="/recruitment/vacancies?status=OPEN" />
            <Stat label="Candidates In Progress" value={s.activeCandidates} to="/recruitment/vacancies" />
            <Stat label="Interviews In The Next 7 Days" value={s.interviewsThisWeek} />
            <Stat label="Hired This Year" value={s.hiredThisYear} />
          </Stats>
        )}
        <ActionTiles>
          {tiles.map((t) => (
            <ActionTile key={t.to} to={t.to} icon={t.icon} title={t.title} desc={t.desc} tone={t.tone} />
          ))}
        </ActionTiles>
        {s && (a.view || c.myVacancies > 0) && (
          <Section
            title="Candidates By Stage"
            description={s.seesAll ? 'Open vacancies across the group' : 'The vacancies you are hiring for'}
          >
            <BarList
              items={s.pipeline.map((p) => ({ key: p.stage, label: p.label, value: p.count }))}
              format={(n) => String(n)}
              empty="No candidates yet."
            />
          </Section>
        )}
      </div>
    </div>
  );
}
