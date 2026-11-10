import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, LogOut } from 'lucide-react';
import logo from '../assets/brand/altus-logo.png';
import { api } from '../lib/api.js';
import { useMe } from '../lib/auth.jsx';
import { fullName } from '../lib/format.js';
import { ConfirmDialog } from '../components/ui.jsx';

/**
 * Log out with a confirmation. `icon` gives the small square button used at the foot of the
 * side menu, as in the Altus Inventory System; otherwise a labelled outline button.
 */
export function LogOutButton({ icon = false }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const logOut = async () => {
    setBusy(true);
    try {
      const { logoutUrl } = await api.post('/api/auth/logout');
      window.location.assign(logoutUrl);
    } catch {
      window.location.assign('/signed-out');
    }
  };
  return (
    <>
      {icon ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          title="Log out"
          aria-label="Log out"
          className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-[#fdecec] hover:text-danger"
        >
          <LogOut className="size-3.5" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-[#efc4c4] bg-white px-4 text-[0.875rem] font-medium text-danger transition-colors hover:border-danger hover:bg-[#fdecec]"
        >
          <LogOut className="size-3.5" aria-hidden /> Log out
        </button>
      )}
      <ConfirmDialog
        open={asking}
        title="Log out"
        confirmLabel="Log out"
        tone="danger"
        busy={busy}
        onConfirm={logOut}
        onCancel={() => setAsking(false)}
      >
        Log out of the HR system? You will need to sign in with Microsoft again to come back.
      </ConfirmDialog>
    </>
  );
}

/** The round navy initial used for the signed-in person. */
export function UserAvatar({ person }) {
  return (
    <span
      aria-hidden
      className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-[0.8rem] font-semibold text-white"
    >
      {(person?.firstName?.[0] ?? fullName(person)?.[0] ?? 'U').toUpperCase()}
    </span>
  );
}

/** The copyright line at the foot of every signed-in page. */
export function PageFooter() {
  return (
    <footer className="mt-auto pt-7 text-[0.8rem] text-muted">
      &copy; {new Date().getFullYear()} Altus Group
    </footer>
  );
}

/**
 * Frame for the Altus Group applications page and the applications that are not part of the
 * leave system (My profile): the logo, the person, and a way out.
 */
export default function AppFrame({ back = false, children }) {
  const { data: me } = useMe();
  return (
    <div className="flex min-h-screen flex-col border-t-4 border-brand bg-canvas">
      <header className="border-b border-rule bg-white">
        <div className="mx-auto flex h-[64px] max-w-5xl items-center gap-3 px-4 sm:px-8">
          <Link to="/" className="flex items-center">
            <img src={logo} alt="Altus Group" className="h-8 w-auto sm:h-9" />
          </Link>
          <span className="ml-auto flex min-w-0 items-center gap-[9px]">
            <UserAvatar person={me} />
            <span className="truncate text-[0.88rem] font-semibold">{fullName(me)}</span>
            <LogOutButton icon />
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-7 sm:px-8">
        {back && (
          <Link to="/" className="back-link w-max">
            <ArrowLeft className="size-3.5" aria-hidden /> Back to applications
          </Link>
        )}
        {children}
        <PageFooter />
      </main>
    </div>
  );
}
