import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { KeyRound, Lock, Phone } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.jsx';
import { Notice, Loading } from '../../components/ui.jsx';
import logo from '../../assets/brand/altus-logo.png';

/*
 * Pages seen before sign-in (D143), after the owner's chosen design: a blue gradient page with
 * one card split in two. On the left, a deep blue panel with light streaks, the logo in white
 * and "Hello, welcome!". On the right, a light panel with the sign-in: AMS branch staff's phone
 * number and PIN in raised field cards with a white Login button, and below it the gradient
 * button for everyone with an Altus Microsoft 365 account.
 */

const PAGE_BG = {
  background:
    'radial-gradient(1200px 700px at 100% 0%, #071a8f 0%, rgba(7,26,143,0) 60%), linear-gradient(160deg, #0a2fd0 0%, #0b5be3 45%, #0c96f1 100%)',
};
const PANEL_BG = { background: 'linear-gradient(140deg, #0a1f9c 0%, #0b2fc4 55%, #0a3fd8 100%)' };

// Light streaks across the left panel, as in the design: thin diagonal lines that fade at
// both ends. Fixed positions, so the panel looks the same every time.
const STREAKS = [
  [4, 80, 0.5, 1],
  [10, 96, 0.75, 1.4],
  [16, 70, 0.4, 0.8],
  [22, 104, 0.95, 2],
  [28, 64, 0.35, 0.8],
  [34, 92, 0.7, 1.3],
  [40, 78, 0.5, 1],
  [46, 110, 1, 2.4],
  [52, 68, 0.45, 0.9],
  [58, 98, 0.85, 1.6],
  [64, 84, 0.55, 1.1],
  [70, 114, 1, 2.6],
  [76, 74, 0.45, 0.9],
  [82, 102, 0.85, 1.7],
  [88, 90, 0.6, 1.2],
  [94, 118, 0.95, 2.2],
  [100, 86, 0.5, 1],
  [106, 112, 0.8, 1.6],
  [112, 96, 0.55, 1.1],
  [118, 120, 0.9, 2],
  [124, 100, 0.5, 1],
  [130, 116, 0.75, 1.5],
  [136, 108, 0.45, 0.9],
  [142, 122, 0.7, 1.4],
];
const STARS = [
  [12, 22],
  [26, 64],
  [40, 14],
  [56, 48],
  [72, 30],
  [84, 70],
  [18, 84],
  [64, 88],
  [90, 16],
  [48, 76],
];

function Streaks() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="streak" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4fd2ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#4fd2ff" stopOpacity="1" />
          <stop offset="1" stopColor="#4fd2ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {STREAKS.map(([x, len, op, w], i) => (
        <line
          key={i}
          x1={x - 40}
          y1={100 - (i % 5) * 4}
          x2={x - 40 + len * 0.62}
          y2={100 - (i % 5) * 4 - len * 0.78}
          stroke="url(#streak)"
          strokeOpacity={Math.min(1, op * 1.15)}
          strokeWidth={w * 0.22}
          strokeLinecap="round"
        />
      ))}
      {STARS.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.35" fill="#bfeaff" fillOpacity="0.8" />
      ))}
    </svg>
  );
}

function AuthLayout({ title, sub, children }) {
  return (
    <div
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-4 py-8"
      style={PAGE_BG}
    >
      <div
        className="pointer-events-none absolute right-0 bottom-0 h-[55%] w-[45%]"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1.4px)',
          backgroundSize: '14px 14px',
          maskImage: 'radial-gradient(ellipse at 100% 100%, #000 0%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 100% 100%, #000 0%, transparent 70%)',
        }}
        aria-hidden
      />
      <main className="relative grid w-full max-w-[920px] overflow-hidden rounded-xl bg-[#eef1f9] shadow-[0_30px_60px_-20px_rgba(4,16,90,0.55)] md:grid-cols-[48%_52%]">
        {/* Left: welcome. */}
        <section
          className="relative z-10 flex min-h-[230px] flex-col overflow-hidden rounded-xl p-8 text-white shadow-[10px_0_26px_-6px_rgba(4,16,90,0.45)] md:min-h-[480px] md:p-11"
          style={PANEL_BG}
        >
          <Streaks />
          <img
            src={logo}
            alt="Altus Group"
            className="relative block h-auto w-[150px] brightness-0 invert md:w-[170px]"
          />
          <div className="relative mt-8 md:my-auto md:pb-10">
            <h1 className="font-head leading-[1.05] text-white">
              <span className="block text-[2.4rem] font-normal md:text-[3.1rem]">Hello,</span>
              <span className="block text-[2.6rem] font-extrabold md:text-[3.4rem]">welcome!</span>
            </h1>
            <p className="mt-4 max-w-[300px] text-[0.92rem] leading-relaxed text-white/85">
              The Altus Group HR System: leave, staff records, inventory and more, in one place.
            </p>
          </div>
        </section>

        {/* Right: sign-in. */}
        <section className="flex flex-col justify-center px-7 py-9 md:px-12 md:py-12">
          {title && (
            <div className="mb-6">
              <h2 className="font-head text-[1.15rem] font-bold text-[#0b2fb8]">{title}</h2>
              {sub && <p className="mt-1 text-[0.9rem] text-muted">{sub}</p>}
            </div>
          )}
          {children}
        </section>
      </main>
      <p className="relative mt-6 text-center text-[0.8rem] leading-[1.7] text-white/80">
        &copy; {new Date().getFullYear()} Altus Group · Trouble signing in? Contact the IT department.
      </p>
    </div>
  );
}

// The raised white button (Login) and the gradient one (Microsoft), as in the design.
const WHITE_BUTTON =
  'flex h-14 w-full items-center justify-center rounded-lg bg-white font-head text-[0.95rem] font-bold text-[#0b2fb8] shadow-[0_6px_16px_-4px_rgba(11,47,184,0.25)] transition hover:shadow-[0_10px_22px_-6px_rgba(11,47,184,0.35)] disabled:opacity-60';
const GRADIENT_BUTTON =
  'flex h-14 w-full items-center justify-center rounded-lg font-head text-[0.95rem] font-bold text-white shadow-[0_8px_18px_-6px_rgba(7,26,143,0.55)] transition hover:brightness-110';
const GRADIENT = { background: 'linear-gradient(90deg, #06157a 0%, #0b3fd0 50%, #0aa3f7 100%)' };

/** A field in a raised white card: an icon tile on the left, a small blue label over the value. */
function FieldCard({ id, label, icon: Icon, children }) {
  return (
    <label
      htmlFor={id}
      className="flex items-center gap-4 rounded-lg bg-white py-2.5 pr-4 pl-2.5 shadow-[0_6px_16px_-6px_rgba(11,47,184,0.22)] focus-within:ring-2 focus-within:ring-[#5b8cff]"
    >
      <span className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md bg-[#c3d1f7] text-[#0b2fb8]">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.74rem] font-semibold text-[#0b2fb8]">{label}</span>
        {children}
      </span>
    </label>
  );
}
const FIELD_INPUT =
  'block w-full border-0 bg-transparent p-0 text-[1rem] text-[#0b2fb8] placeholder:text-[#9db0e6] focus:outline-none';

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

  return (
    <AuthLayout>
      {error && (
        <div className="mb-5">
          <Notice tone={code === 'session_ended' ? 'neutral' : 'danger'}>{error}</Notice>
        </div>
      )}
      {status.isPending ? (
        <Loading label="Checking Sign-in" />
      ) : (
        <>
          {phone && <PhoneSignIn />}
          <div className={phone ? 'mt-10' : ''}>
            <p className="mb-3 text-center font-head text-[0.92rem] font-bold text-[#0b2fb8]">
              Have an Altus Microsoft 365 account?
            </p>
            {status.data?.signInAvailable ? (
              // Full-page navigation: the server redirects to Microsoft.
              <a href="/api/auth/login" className={GRADIENT_BUTTON} style={GRADIENT}>
                Sign In With Microsoft 365
              </a>
            ) : (
              <Notice tone="pending" title="Sign-in Is Not Available">
                Microsoft sign-in has not been set up on this server yet. Contact IT.
              </Notice>
            )}
          </div>
        </>
      )}
    </AuthLayout>
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
      <p className="mb-3 text-[0.8rem] font-medium text-muted">
        {step === 'LOGIN'
          ? 'AMS branch staff: sign in with your phone number and PIN.'
          : 'Choose 6 digits you will remember. Not 123456 or the same digit six times. Keep it to yourself.'}
      </p>
      {error && (
        <div className="mb-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <div className="space-y-3">
        {step === 'LOGIN' ? (
          <>
            <FieldCard id="ph-number" label="Phone Number" icon={Phone}>
              <input
                id="ph-number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="097 123 4567"
                className={FIELD_INPUT}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </FieldCard>
            <FieldCard id="ph-pin" label="PIN" icon={Lock}>
              <input
                id="ph-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={8}
                placeholder="••••••"
                className={`${FIELD_INPUT} tracking-[0.3em]`}
                value={pin}
                onChange={digits(setPin)}
                required
              />
            </FieldCard>
          </>
        ) : (
          <>
            <FieldCard id="ph-new" label="New PIN" icon={KeyRound}>
              <input
                id="ph-new"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                className={`${FIELD_INPUT} tracking-[0.3em]`}
                value={pin}
                onChange={digits(setPin)}
                required
              />
            </FieldCard>
            <FieldCard id="ph-new2" label="Type It Again" icon={Lock}>
              <input
                id="ph-new2"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                className={`${FIELD_INPUT} tracking-[0.3em]`}
                value={pin2}
                onChange={digits(setPin2)}
                required
              />
            </FieldCard>
          </>
        )}
      </div>
      {step === 'LOGIN' && (
        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            onClick={() => setForgot((f) => !f)}
            aria-expanded={forgot}
            className="text-[0.78rem] font-bold text-[#0b2fb8] hover:underline"
          >
            Forgot your PIN?
          </button>
        </div>
      )}
      {forgot && step === 'LOGIN' && (
        <p className="mt-1.5 text-right text-[0.78rem] text-muted">
          Ask your System Administrator for a new code. The first time, use the code they gave you as your
          PIN.
        </p>
      )}
      <button type="submit" className={`${WHITE_BUTTON} mt-5`} disabled={busy}>
        {busy ? 'Please Wait…' : step === 'LOGIN' ? 'Login' : 'Save PIN And Sign In'}
      </button>
    </form>
  );
}

export function AccessNotConfiguredPage() {
  const [params] = useSearchParams();
  const inactive = params.get('reason') === 'inactive';
  return (
    <AuthLayout title={inactive ? 'Your Access Has Ended' : 'No Employee Record Found'}>
      <Notice tone={inactive ? 'danger' : 'pending'}>
        {inactive
          ? 'Your employee record is inactive, so you cannot sign in. If this is wrong, contact HR.'
          : 'Your Microsoft account does not match an employee record. Ask HR to check the work email on your record.'}
      </Notice>
      <a href="/sign-in" className={`${WHITE_BUTTON} mt-6`}>
        Back To Sign-in
      </a>
    </AuthLayout>
  );
}

export function SignedOutPage() {
  return (
    <AuthLayout title="You Have Signed Out" sub="Close this window if you are on a shared computer.">
      <a href="/sign-in" className={GRADIENT_BUTTON} style={GRADIENT}>
        Sign In Again
      </a>
    </AuthLayout>
  );
}
