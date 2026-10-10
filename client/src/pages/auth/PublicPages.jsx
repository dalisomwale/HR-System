import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import { Notice, Loading } from '../../components/ui.jsx';
import logo from '../../assets/brand/altus-logo.png';

/*
 * Pages seen before sign-in. Left: the task (sign in, or what happened). Right, on wide screens:
 * this month's calendar in Lusaka time with today marked, and the route a request takes.
 * Nothing on these pages is decorative data: the calendar is the real current month.
 */

function lusakaToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lusaka',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, Number(p.value)]),
  );
  return { y: parts.year, m: parts.month, d: parts.day };
}

function MonthCalendar() {
  const { y, m, d } = lusakaToday();
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(first);
  const weekday = (day) => (lead + day - 1) % 7; // 0 = Monday

  return (
    <figure aria-label={`${monthName} ${y}. Today is ${d} ${monthName}.`} className="w-full max-w-[30rem]">
      <figcaption className="flex items-baseline gap-4">
        <span className="text-[clamp(3rem,5.5vw,4.75rem)] leading-none font-semibold tracking-[-0.03em] text-white">
          {monthName}
        </span>
        <span className="text-2xl font-normal text-white/50 tabular-nums">{y}</span>
      </figcaption>
      <div className="mt-8 grid grid-cols-7 gap-y-1 text-center" aria-hidden>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
          <span key={i} className={`pb-2 text-xs font-medium ${i > 4 ? 'text-white/35' : 'text-white/60'}`}>
            {w}
          </span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`x${i}`} />
          ) : (
            <span key={day} className="flex justify-center">
              <span
                className={`flex size-10 items-center justify-center rounded-full text-lg tabular-nums ${
                  day === d
                    ? 'bg-accent-orange font-semibold text-brand'
                    : weekday(day) > 4
                      ? 'text-white/35'
                      : 'text-white/85'
                }`}
              >
                {day}
              </span>
            </span>
          ),
        )}
      </div>
    </figure>
  );
}

const ROUTE = [
  [
    'You apply',
    'Pick the leave type and dates. Working days are counted for you, with weekends and public holidays left out.',
  ],
  ['Your manager decides', 'Your manager approves or declines, or someone covering for them.'],
  ['HR confirms', 'HR gives final approval and the days come off your balance.'],
];

function AuthLayout({ children }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex flex-col border-t-[3px] border-t-brand px-6 py-8 sm:px-12 lg:border-t-0 lg:px-16 lg:py-12">
        <img src={logo} alt="Altus Financial Services Limited" className="h-11 w-auto self-start" />
        <main className="flex flex-1 items-center py-12">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        <p className="text-xs text-muted">Altus Financial Services Limited. For staff use only.</p>
      </div>

      <aside className="hidden flex-col bg-brand px-16 py-12 lg:flex">
        <div className="flex flex-1 items-center">
          <MonthCalendar />
        </div>
        <ol className="grid max-w-[44rem] gap-6 border-t border-white/15 pt-8 xl:grid-cols-3">
          {ROUTE.map(([title, text], i) => (
            <li key={title} className="flex gap-3 xl:block">
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/40 text-xs font-medium text-white xl:mb-3"
              >
                {i + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">{title}</span>
                <span className="mt-1 block text-[13px] leading-relaxed text-white/65">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

const SIGN_IN_ERRORS = {
  not_configured: 'Microsoft sign-in has not been set up on this server yet. Contact IT.',
  unavailable: 'Microsoft sign-in could not be reached. Try again in a few minutes.',
  expired: 'The sign-in took too long or was started in another window. Start again.',
  cancelled: 'Sign-in was cancelled or refused by Microsoft. If this keeps happening, contact IT.',
  failed: 'Microsoft could not confirm your sign-in. Start again.',
  rate_limited: 'Too many sign-in attempts from this network. Wait 15 minutes and try again.',
  session_ended: 'Your session ended. Sign in again to continue.',
};

export function SignInPage() {
  const [params] = useSearchParams();
  const me = useMe();
  const status = useQuery({ queryKey: ['auth-status'], queryFn: () => api.get('/api/auth/status') });
  if (me.data) return <Navigate to="/" replace />;
  const code = params.get('error');
  const error = SIGN_IN_ERRORS[code];

  return (
    <AuthLayout>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.01em]">
        Sign in to Leave Management
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Use your Altus Microsoft 365 account, the same one you use for Outlook and Teams.
      </p>
      {error && (
        <div className="mt-6">
          <Notice tone={code === 'session_ended' ? 'neutral' : 'danger'}>{error}</Notice>
        </div>
      )}
      <div className="mt-8">
        {status.isPending ? (
          <Loading label="Checking sign-in" />
        ) : status.data?.signInAvailable ? (
          // Full-page navigation: the server redirects to Microsoft.
          <a
            href="/api/auth/login"
            className="flex h-12 w-full items-center justify-center rounded-md bg-brand text-[15px] font-medium text-white hover:bg-brand-strong"
          >
            Sign in with Microsoft
          </a>
        ) : (
          <Notice tone="pending" title="Sign-in is not available">
            Microsoft sign-in has not been set up on this server yet. Contact IT.
          </Notice>
        )}
      </div>
      <p className="mt-6 text-sm text-muted">
        First time here? Sign in anyway. If your account is not set up yet, HR is told and can link it for
        you.
      </p>
    </AuthLayout>
  );
}

export function AccessNotConfiguredPage() {
  const [params] = useSearchParams();
  const inactive = params.get('reason') === 'inactive';
  return (
    <AuthLayout>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.01em]">
        {inactive ? 'Your access has ended' : 'Your account is not set up yet'}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        {inactive
          ? 'Your employee record is inactive, so you cannot sign in. If this is wrong, contact HR.'
          : 'You signed in with Microsoft, but your account is not linked to an employee record yet. HR has been told and can link it. Once they have, sign in again.'}
      </p>
      <a
        href="/sign-in"
        className="mt-8 inline-flex h-11 items-center rounded-md border border-rule px-4 text-sm font-medium text-ink hover:border-muted"
      >
        Back to sign-in
      </a>
    </AuthLayout>
  );
}

export function SignedOutPage() {
  return (
    <AuthLayout>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.01em]">You have signed out</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Close this window if you are on a shared computer.
      </p>
      <a
        href="/sign-in"
        className="mt-8 inline-flex h-11 items-center rounded-md bg-brand px-5 text-sm font-medium text-white hover:bg-brand-strong"
      >
        Sign in again
      </a>
    </AuthLayout>
  );
}
