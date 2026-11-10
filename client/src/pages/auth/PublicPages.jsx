import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import { Notice, Loading } from '../../components/ui.jsx';
import logo from '../../assets/brand/altus-logo.png';

/*
 * Pages seen before sign-in, laid out like the Altus Inventory System's sign-in: a navy rule
 * across the top, one white card in the middle with the logo and the system's name, and a
 * help line beneath it.
 */

function AuthLayout({ title, sub, children }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center border-t-4 border-brand bg-canvas px-5 py-8">
      <main className="w-full max-w-[380px] rounded-md border border-rule bg-white px-8 pt-8 pb-[26px] shadow-card">
        <div className="mb-[26px]">
          <img src={logo} alt="Altus Group" className="mb-[22px] block h-auto w-[220px] max-w-full" />
          <h1 className="text-[1.05rem] leading-snug">{title}</h1>
          {sub && <p className="mt-0.5 text-[0.9rem] text-muted">{sub}</p>}
        </div>
        {children}
      </main>
      <p className="mt-5 text-center text-[0.8rem] leading-[1.7] text-muted">
        &copy; {new Date().getFullYear()} Altus Group
        <br />
        Trouble signing in? Contact the IT department.
      </p>
    </div>
  );
}

// Full-width button at the foot of the sign-in card.
const SUBMIT =
  'flex w-full items-center justify-center rounded-sm border border-brand bg-brand p-2.5 text-[0.92rem] font-medium text-white transition-colors hover:border-brand-strong hover:bg-brand-strong';

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
    <AuthLayout title="Altus Group HR System" sub="Sign in with your Microsoft 365 account">
      {error && (
        <div className="mb-4">
          <Notice tone={code === 'session_ended' ? 'neutral' : 'danger'}>{error}</Notice>
        </div>
      )}
      <div>
        {status.isPending ? (
          <Loading label="Checking sign-in" />
        ) : status.data?.signInAvailable ? (
          // Full-page navigation: the server redirects to Microsoft.
          <a href="/api/auth/login" className={SUBMIT}>
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
    <AuthLayout title={inactive ? 'Your access has ended' : 'No employee record found'}>
      <Notice tone={inactive ? 'danger' : 'pending'}>
        {inactive
          ? 'Your employee record is inactive, so you cannot sign in. If this is wrong, contact HR.'
          : 'Your Microsoft account does not match an employee record. Ask HR to check the work email on your record.'}
      </Notice>
      <a
        href="/sign-in"
        className="mt-4 flex w-full items-center justify-center rounded-sm border border-rule bg-white p-2.5 text-[0.92rem] font-medium text-ink-2 transition-colors hover:border-rule-strong hover:bg-[#fafafa]"
      >
        Back to sign-in
      </a>
    </AuthLayout>
  );
}

export function SignedOutPage() {
  return (
    <AuthLayout title="You have signed out" sub="Close this window if you are on a shared computer.">
      <a href="/sign-in" className={SUBMIT}>
        Sign in again
      </a>
    </AuthLayout>
  );
}
