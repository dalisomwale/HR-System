import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import { Notice, Loading } from '../../components/ui.jsx';
import logo from '../../assets/brand/altus-logo.png';

/*
 * Pages seen before sign-in. On wide screens a navy field, cut at the angle of the "A" in the
 * Altus logo, carries the system's name and its applications; the white panel holds the task.
 */

// The applications the system holds today, listed under the name.
const APPS = ['Leave management', 'Employee management', 'My profile'];

function AuthLayout({ children }) {
  return (
    <div className="relative min-h-screen overflow-hidden border-t-4 border-brand bg-canvas lg:border-t-0">
      <div
        aria-hidden
        className="absolute inset-0 hidden bg-brand lg:block"
        style={{ clipPath: 'polygon(0 0, 58% 0, 38% 100%, 0 100%)' }}
      />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-2 lg:px-12">
        <div className="hidden text-white lg:block">
          <p className="text-[clamp(2.5rem,4.5vw,3.75rem)] leading-[1.02] font-semibold tracking-[-0.03em]">
            Altus Group
            <br />
            HR System
          </p>
          <ol className="mt-10 max-w-[18rem] space-y-4">
            {APPS.map((title, i) => (
              <li key={title} className="flex items-center gap-3">
                <span aria-hidden className="text-sm font-semibold text-accent-orange tabular-nums">
                  0{i + 1}
                </span>
                <span className="text-[15px]">{title}</span>
              </li>
            ))}
          </ol>
        </div>
        <main className="w-full max-w-md justify-self-center rounded-lg border border-rule bg-white px-8 py-10 sm:px-10 lg:justify-self-end">
          <img src={logo} alt="Altus Group" className="mb-10 h-12 w-auto" />
          {children}
        </main>
      </div>
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
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.01em]">Sign in</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">Use your Microsoft 365 account.</p>
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
          : 'You signed in with Microsoft. Contact the IT Administrator to accept your request.'}
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
