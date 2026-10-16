import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, LogOut } from 'lucide-react';
import logo from '../assets/brand/altus-logo.png';
import { api } from '../lib/api.js';
import { useMe } from '../lib/auth.jsx';
import { fullName } from '../lib/format.js';
import { ConfirmDialog } from '../components/ui.jsx';

/**
 * Frame for the Altus Group applications page and the applications that are not part of the
 * leave system (My profile). The header carries the logo, the person's name and Log out.
 */
export default function AppFrame({ back = false, children }) {
  const { data: me } = useMe();
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
    <div className="min-h-screen bg-canvas">
      <header className="border-t-[3px] border-b border-t-brand border-b-rule bg-white">
        <div className="mx-auto flex h-[60px] max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link to="/">
            <img src={logo} alt="Altus Group" className="h-8 w-auto sm:h-10" />
          </Link>
          <span className="ml-auto hidden text-sm font-medium sm:inline">{fullName(me)}</span>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-rule bg-white px-3 text-sm font-medium hover:border-muted sm:ml-2"
          >
            <LogOut className="size-4" aria-hidden /> Log out
          </button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        {back && (
          <Link
            to="/"
            className="mb-5 inline-flex items-center gap-1.5 rounded-md border border-brand/40 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-soft"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Back to applications
          </Link>
        )}
        {children}
      </main>
      <ConfirmDialog
        open={asking}
        title="Log out?"
        confirmLabel="Log out"
        busy={busy}
        onConfirm={logOut}
        onCancel={() => setAsking(false)}
      >
        You will need to sign in with Microsoft again to come back.
      </ConfirmDialog>
    </div>
  );
}
