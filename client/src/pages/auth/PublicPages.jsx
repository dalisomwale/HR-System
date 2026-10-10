import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import { Notice, Loading } from '../../components/ui.jsx';

function PublicFrame({ children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-brand px-6 py-4 text-white">
        <span className="text-[17px] font-semibold tracking-[0.01em]">Altus Financial Services</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-16 pb-10">
        <div className="w-full max-w-md rounded-md border border-rule bg-white p-8">{children}</div>
      </main>
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
  const error = SIGN_IN_ERRORS[params.get('error')];

  return (
    <PublicFrame>
      <h1 className="text-xl font-semibold">Leave Management</h1>
      <p className="mt-2 text-sm text-muted">Sign in with your Altus Microsoft 365 work account.</p>
      {error && (
        <div className="mt-5">
          <Notice tone={params.get('error') === 'session_ended' ? 'neutral' : 'danger'}>{error}</Notice>
        </div>
      )}
      <div className="mt-6">
        {status.isPending ? (
          <Loading label="Checking sign-in" />
        ) : status.data?.signInAvailable ? (
          // Full-page navigation: the server redirects to Microsoft.
          <a
            href="/api/auth/login"
            className="flex h-10 w-full items-center justify-center rounded-md bg-brand text-sm font-medium text-white hover:bg-brand-strong"
          >
            Sign in with Microsoft
          </a>
        ) : (
          <Notice tone="pending" title="Sign-in is not available">
            Microsoft sign-in has not been set up on this server yet. Contact IT.
          </Notice>
        )}
      </div>
    </PublicFrame>
  );
}

export function AccessNotConfiguredPage() {
  const [params] = useSearchParams();
  const inactive = params.get('reason') === 'inactive';
  return (
    <PublicFrame>
      <h1 className="text-xl font-semibold">
        {inactive ? 'Your access has ended' : 'Your account is not set up yet'}
      </h1>
      <p className="mt-3 text-sm text-muted">
        {inactive
          ? 'Your employee record is inactive, so you cannot sign in. If this is wrong, contact HR.'
          : 'You signed in with Microsoft, but your account is not linked to an employee record yet. Your sign-in has been listed for HR, who can link it. Ask HR to do this, then sign in again.'}
      </p>
      <a href="/sign-in" className="mt-6 inline-block text-sm font-medium text-brand underline">
        Back to sign-in
      </a>
    </PublicFrame>
  );
}

export function SignedOutPage() {
  return (
    <PublicFrame>
      <h1 className="text-xl font-semibold">You have signed out</h1>
      <p className="mt-3 text-sm text-muted">Close this window if you are on a shared computer.</p>
      <a href="/sign-in" className="mt-6 inline-block text-sm font-medium text-brand underline">
        Sign in again
      </a>
    </PublicFrame>
  );
}
