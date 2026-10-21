import { Link } from 'react-router';
import {
  Briefcase,
  CalendarCheck,
  ChevronRight,
  Clock,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import AppFrame, { LogOutButton } from '../layouts/AppFrame.jsx';
import { useMe, hasRole, seesWholeGroup } from '../lib/auth.jsx';

/*
 * The first page after sign-in: the Altus Group HR applications. Leave management is live
 * (phase 1); the others are shown as coming soon to HR, System Administrators and directors.
 * Everyone else sees only the applications they use: Leave management and My profile.
 */

const APPS = [
  {
    id: 'leave',
    name: 'Leave management',
    description: 'Apply for leave, see your balances and, for approvers, decide on requests.',
    icon: CalendarCheck,
    to: '/home',
    everyone: true,
  },
  {
    id: 'employees',
    name: 'Employee management',
    description: 'The central record for every member of staff, from onboarding to offboarding.',
    icon: Users,
    to: '/people',
  },
  {
    id: 'recruitment',
    name: 'Recruitment management',
    description: 'Vacancies, applicants, interviews and offers.',
    icon: Briefcase,
    comingSoon: true,
  },
  {
    id: 'performance',
    name: 'Performance management',
    description: 'Goals, check-ins and appraisals.',
    icon: TrendingUp,
    comingSoon: true,
  },
  {
    id: 'shifts',
    name: 'Shift management',
    description: 'Shift rosters, swaps and attendance.',
    icon: Clock,
    comingSoon: true,
  },
  {
    id: 'payroll',
    name: 'Payroll management',
    description: 'Pay runs, payslips and statutory deductions.',
    icon: Wallet,
    comingSoon: true,
  },
  {
    id: 'profile',
    name: 'My profile',
    description: 'Your personal and employment details.',
    icon: UserRound,
    to: '/profile',
    everyone: true,
  },
];

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lusaka' }).format(
      new Date(),
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export default function LauncherPage() {
  const { data: me } = useMe();
  const seesAll = seesWholeGroup(me) || hasRole(me, 'HR_ADMIN');
  const apps = APPS.filter((a) => a.everyone || seesAll);

  return (
    <AppFrame>
      <h1 className="text-2xl font-semibold">
        {greeting()}, {me.firstName}
      </h1>

      <ul
        className={`mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-4 ${apps.length > 2 ? 'lg:grid-cols-4' : 'sm:max-w-2xl'}`}
      >
        {apps.map((app) => {
          const Icon = app.icon;
          const body = (
            <>
              <span
                className={`flex size-9 items-center justify-center rounded-md sm:size-11 ${
                  app.comingSoon ? 'bg-neutral-bg text-muted' : 'bg-brand text-white'
                }`}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-4">
                <span className={`text-base font-semibold ${app.comingSoon ? 'text-muted' : ''}`}>
                  {app.name}
                </span>
                {app.comingSoon ? (
                  <span className="rounded-sm bg-neutral-bg px-1.5 py-0.5 text-xs font-medium text-muted">
                    Coming soon
                  </span>
                ) : (
                  <ChevronRight
                    className="hidden size-4 text-muted transition-transform group-hover:translate-x-0.5 sm:block"
                    aria-hidden
                  />
                )}
              </span>
              <span className="mt-1 block text-xs text-muted sm:text-sm">{app.description}</span>
            </>
          );
          return (
            <li key={app.id}>
              {app.comingSoon ? (
                <div
                  aria-disabled="true"
                  className="flex h-full flex-col rounded-lg border border-dashed border-rule bg-white/60 p-4 sm:p-5"
                >
                  {body}
                </div>
              ) : (
                <Link
                  to={app.to}
                  className="group flex h-full flex-col rounded-lg border border-rule bg-white p-4 hover:border-brand focus-visible:border-brand sm:p-5"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <div className={`mt-8 flex justify-center ${apps.length > 2 ? '' : 'sm:max-w-2xl'}`}>
        <LogOutButton />
      </div>
    </AppFrame>
  );
}
