import { Link } from 'react-router';
import { Briefcase, CalendarCheck, ChevronRight, UserRound, Wallet } from 'lucide-react';
import logo from '../assets/brand/altus-logo.png';
import { useMe, hasRole, seesWholeGroup } from '../lib/auth.jsx';
import { fullName } from '../lib/format.js';

/*
 * The first page after sign-in: the Altus Group applications. Leave management is phase 1;
 * Payroll and Recruitment are shown as coming soon to HR, System Administrators and directors.
 * Everyone else sees only the applications they use: Leave and My profile.
 */

const APPS = [
  {
    id: 'leave',
    name: 'Leave',
    description: 'Apply for leave, see your balances and, for approvers, decide on requests.',
    icon: CalendarCheck,
    to: '/home',
    everyone: true,
  },
  {
    id: 'payroll',
    name: 'Payroll',
    description: 'Payslips, pay runs and deductions.',
    icon: Wallet,
    comingSoon: true,
  },
  {
    id: 'recruitment',
    name: 'Recruitment',
    description: 'Vacancies, applicants and interviews.',
    icon: Briefcase,
    comingSoon: true,
  },
  {
    id: 'profile',
    name: 'My profile',
    description: 'Your employee details, manager and Microsoft account.',
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
    <div className="min-h-screen bg-canvas">
      <header className="border-t-[3px] border-b border-t-brand border-b-rule bg-white">
        <div className="mx-auto flex h-[60px] max-w-5xl items-center gap-3 px-4 sm:px-6">
          <img src={logo} alt="Altus Group" className="h-8 w-auto sm:h-10" />
          <Link
            to="/profile"
            className="-mr-1 ml-auto rounded-md px-2 py-1 text-right text-sm font-medium leading-tight hover:bg-canvas"
          >
            {fullName(me)}
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-semibold">
          {greeting()}, {me.firstName}
        </h1>

        <ul
          className={`mt-8 grid gap-4 sm:grid-cols-2 ${apps.length > 2 ? 'lg:grid-cols-4' : 'lg:max-w-2xl'}`}
        >
          {apps.map((app) => {
            const Icon = app.icon;
            const body = (
              <>
                <span
                  className={`flex size-11 items-center justify-center rounded-md ${
                    app.comingSoon ? 'bg-neutral-bg text-muted' : 'bg-brand text-white'
                  }`}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="mt-4 flex items-center gap-2">
                  <span className={`text-base font-semibold ${app.comingSoon ? 'text-muted' : ''}`}>
                    {app.name}
                  </span>
                  {app.comingSoon ? (
                    <span className="rounded-sm bg-neutral-bg px-1.5 py-0.5 text-xs font-medium text-muted">
                      Coming soon
                    </span>
                  ) : (
                    <ChevronRight
                      className="size-4 text-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  )}
                </span>
                <span className="mt-1 block text-sm text-muted">{app.description}</span>
              </>
            );
            return (
              <li key={app.id}>
                {app.comingSoon ? (
                  <div
                    aria-disabled="true"
                    className="flex h-full flex-col rounded-lg border border-dashed border-rule bg-white/60 p-5"
                  >
                    {body}
                  </div>
                ) : (
                  <Link
                    to={app.to}
                    className="group flex h-full flex-col rounded-lg border border-rule bg-white p-5 hover:border-brand focus-visible:border-brand"
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
