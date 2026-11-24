import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { Briefcase, CalendarCheck, Eye, EyeOff, ShoppingCart, TrendingUp, Users, Wallet } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import { Notice, Loading } from '../../components/ui.jsx';
import logo from '../../assets/brand/altus-logo.png';

/*
 * Pages seen before sign-in (D143, D144), after the owner's chosen design: a pale grey page
 * with one white card. On the left, a blue panel of soft waves with the Altus logo, "Welcome to
 * the HR Desktop" and the applications it comprises. On the right, "Get Started Now": AMS
 * branch staff's phone number and PIN with an indigo Log In button, then "Or" and Login with
 * Microsoft for everyone with an Altus Microsoft 365 account.
 */

// The applications in the HR Desktop so far (those on the Applications page that are built).
const APPS = [
  { name: 'Leave Management', icon: CalendarCheck },
  { name: 'Employee Management', icon: Users },
  { name: 'Inventory System', icon: ShoppingCart },
  { name: 'Float System', icon: Wallet },
  { name: 'Recruitment Management', icon: Briefcase },
  { name: 'Performance Management', icon: TrendingUp },
];

// The blue panel's soft waves: blurred blue, violet and cyan shapes over deep blue.
const WAVES = [
  { className: 'left-[-30%] top-[-10%] h-[70%] w-[90%] rotate-[-18deg]', color: '#5b5bf0' },
  { className: 'right-[-35%] top-[18%] h-[55%] w-[85%] rotate-[22deg]', color: '#1f8fff' },
  { className: 'left-[-25%] bottom-[-18%] h-[60%] w-[80%] rotate-[14deg]', color: '#22b8f0' },
  { className: 'right-[-20%] bottom-[8%] h-[45%] w-[70%] rotate-[-25deg]', color: '#6d5ff5' },
  { className: 'left-[15%] top-[35%] h-[35%] w-[60%] rotate-[8deg]', color: '#2338e0' },
];

function AuthLayout({ title, sub, children }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-[#eaebee] px-4 py-8">
      <main className="grid w-full max-w-[1000px] gap-2 rounded-[22px] bg-[#fbfbfc] p-2 shadow-[0_20px_50px_-24px_rgba(20,20,60,0.25)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: welcome and the applications. */}
        <section className="relative flex min-h-[300px] flex-col overflow-hidden rounded-[18px] bg-[#2a2fd8] p-7 text-white md:min-h-[560px] md:p-10">
          {WAVES.map((w, i) => (
            <span
              key={i}
              className={`pointer-events-none absolute rounded-full opacity-80 blur-[60px] ${w.className}`}
              style={{ background: w.color }}
              aria-hidden
            />
          ))}
          <img
            src={logo}
            alt="Altus Group"
            className="relative block h-auto w-[150px] brightness-0 invert md:w-[165px]"
          />
          <div className="relative mt-10">
            <h1 className="max-w-[360px] font-head text-[1.9rem] leading-[1.12] font-medium tracking-tight text-white md:text-[2.3rem]">
              Welcome to the
              <br />
              <span
                className="bg-clip-text font-semibold text-transparent"
                style={{ backgroundImage: 'linear-gradient(90deg, #ffffff 0%, #9cecff 45%, #ffc47a 100%)' }}
              >
                HR Desktop
              </span>
            </h1>
          </div>
          <div className="relative mt-auto pt-8">
            <p className="mb-3 text-center text-[0.82rem] text-white/80">
              It <span className="text-[#9fb4ff]">comprises of</span>
            </p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:gap-x-4">
              {APPS.map(({ name, icon: Icon }) => (
                <li
                  key={name}
                  className="flex items-center gap-2 text-[0.78rem] font-semibold text-white sm:text-[0.88rem]"
                >
                  <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Right: sign-in. */}
        <section className="flex flex-col justify-center px-6 py-10 md:px-16">
          <div className="mx-auto w-full max-w-[380px]">
            <h2 className="font-head text-[1.9rem] leading-tight font-medium tracking-tight text-[#111322]">
              {title ?? 'Get Started Now'}
            </h2>
            <p className="mt-1.5 mb-7 text-[0.9rem] text-[#8a8d99]">
              {sub ?? 'Please log in to your account to continue.'}
            </p>
            {children}
          </div>
        </section>
      </main>
      <p className="mt-5 text-center text-[0.78rem] text-[#8a8d99]">
        &copy; {new Date().getFullYear()} Altus Group · Trouble signing in? Contact the IT department.
      </p>
    </div>
  );
}

const PRIMARY =
  'flex h-11 w-full items-center justify-center rounded-lg bg-[#3a2fe0] text-[0.92rem] font-semibold text-white transition hover:bg-[#2f25c4] disabled:opacity-60';
const OUTLINE =
  'flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-[#dcdde3] bg-white text-[0.92rem] text-[#111322] transition hover:border-[#bfc1cc] hover:bg-[#f6f6f8]';
const INPUT =
  'h-11 w-full rounded-lg border border-[#dcdde3] bg-white px-3.5 text-[0.92rem] text-[#111322] placeholder:text-[#a3a6b1] focus:border-[#3a2fe0] focus:ring-2 focus:ring-[#3a2fe0]/15 focus:outline-none';
const LABEL = 'mb-1.5 block text-[0.85rem] font-semibold text-[#111322]';

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-[18px]" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
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
  const phone = status.data?.phoneSignIn;

  const microsoft = status.data?.signInAvailable ? (
    // Full-page navigation: the server redirects to Microsoft.
    <a href="/api/auth/login" className={OUTLINE}>
      <MicrosoftLogo />
      <span>
        Login with <strong className="font-semibold">Microsoft</strong>
      </span>
    </a>
  ) : (
    <Notice tone="pending" title="Sign-in Is Not Available">
      Microsoft sign-in has not been set up on this server yet. Contact IT.
    </Notice>
  );

  return (
    <AuthLayout
      sub={
        phone
          ? 'AMS branch staff log in with their phone number and PIN; everyone else with Microsoft 365.'
          : 'Log in with your Altus Microsoft 365 account to continue.'
      }
    >
      {error && (
        <div className="mb-5">
          <Notice tone={code === 'session_ended' ? 'neutral' : 'danger'}>{error}</Notice>
        </div>
      )}
      {status.isPending ? (
        <Loading label="Checking Sign-in" />
      ) : phone ? (
        <>
          <PhoneSignIn />
          <div className="my-6 flex items-center gap-3 text-[0.8rem] text-[#a3a6b1]">
            <span className="h-px flex-1 bg-[#e3e4e9]" />
            Or
            <span className="h-px flex-1 bg-[#e3e4e9]" />
          </div>
          {microsoft}
        </>
      ) : (
        microsoft
      )}
    </AuthLayout>
  );
}

/** A PIN box with the eye to show or hide it, as in the design. */
function PinInput({ id, value, onChange, autoComplete, maxLength, placeholder }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        inputMode="numeric"
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
        className={`${INPUT} pr-11 tracking-[0.25em]`}
        value={value}
        onChange={onChange}
        required
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide PIN' : 'Show PIN'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#8a8d99] hover:text-[#111322]"
      >
        {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

/** AMS branch staff: phone number and PIN, or the one-time code the first time (D119). */
function PhoneSignIn() {
  // The link the System Admin shares with a new code fills in the phone number (?phone=).
  const [params] = useSearchParams();
  const [step, setStep] = useState('LOGIN'); // LOGIN | SET_PIN
  const [phone, setPhone] = useState(() => (params.get('phone') ?? '').replace(/[^\d+ ]/g, '').slice(0, 20));
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [forgot, setForgot] = useState(false);
  const fail = (err) => setError(err.fields?.[0] ? `PIN ${err.fields[0].message}.` : err.message);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'LOGIN') {
        const r = await api.post('/api/auth/phone/login', { phone, pin });
        if (r.status === 'SET_PIN') {
          setStep('SET_PIN');
          setPin('');
          return;
        }
      } else {
        await api.post('/api/auth/phone/set-pin', { pin, pinConfirm: pin2 });
      }
      window.location.assign('/');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const digits = (set) => (e) => set(e.target.value.replace(/\D/g, ''));
  return (
    <form onSubmit={submit} noValidate>
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {step === 'LOGIN' ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="ph-number" className={LABEL}>
              Phone Number
            </label>
            <input
              id="ph-number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="Enter your phone number…"
              className={INPUT}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="ph-pin" className="text-[0.85rem] font-semibold text-[#111322]">
                PIN
              </label>
              <button
                type="button"
                onClick={() => setForgot((f) => !f)}
                aria-expanded={forgot}
                className="text-[0.8rem] font-semibold text-[#3a2fe0] hover:underline"
              >
                Forgot PIN?
              </button>
            </div>
            <PinInput
              id="ph-pin"
              value={pin}
              onChange={digits(setPin)}
              autoComplete="current-password"
              maxLength={8}
              placeholder="••••••"
            />
            {forgot && (
              <p className="mt-1.5 text-[0.8rem] text-[#8a8d99]">
                Ask your System Administrator for a new code. The first time, use the code they gave you as
                your PIN.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[0.85rem] text-[#8a8d99]">
            Choose 6 digits you will remember. Not 123456 or the same digit six times. Keep it to yourself.
          </p>
          <div>
            <label htmlFor="ph-new" className={LABEL}>
              New PIN
            </label>
            <PinInput
              id="ph-new"
              value={pin}
              onChange={digits(setPin)}
              autoComplete="new-password"
              maxLength={6}
            />
          </div>
          <div>
            <label htmlFor="ph-new2" className={LABEL}>
              Type It Again
            </label>
            <PinInput
              id="ph-new2"
              value={pin2}
              onChange={digits(setPin2)}
              autoComplete="new-password"
              maxLength={6}
            />
          </div>
        </div>
      )}
      <button type="submit" className={`${PRIMARY} mt-6`} disabled={busy}>
        {busy ? 'Please Wait…' : step === 'LOGIN' ? 'Log In' : 'Save PIN And Log In'}
      </button>
    </form>
  );
}

export function AccessNotConfiguredPage() {
  const [params] = useSearchParams();
  const inactive = params.get('reason') === 'inactive';
  return (
    <AuthLayout title={inactive ? 'Your Access Has Ended' : 'No Employee Record Found'} sub="">
      <Notice tone={inactive ? 'danger' : 'pending'}>
        {inactive
          ? 'Your employee record is inactive, so you cannot sign in. If this is wrong, contact HR.'
          : 'Your Microsoft account does not match an employee record. Ask HR to check the work email on your record.'}
      </Notice>
      <a href="/sign-in" className={`${OUTLINE} mt-6`}>
        Back To Sign-in
      </a>
    </AuthLayout>
  );
}

export function SignedOutPage() {
  return (
    <AuthLayout title="You Have Signed Out" sub="Close this window if you are on a shared computer.">
      <a href="/sign-in" className={PRIMARY}>
        Sign In Again
      </a>
    </AuthLayout>
  );
}
