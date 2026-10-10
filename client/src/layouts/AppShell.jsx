import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import {
  CalendarDays,
  Building2,
  Clock,
  FileUp,
  History,
  LogOut,
  Menu,
  Settings2,
  UserRound,
  Users,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useMe, hasRole } from '../lib/auth.jsx';
import { ROLE_LABELS, fullName } from '../lib/format.js';

const MY_WORK = [{ to: '/profile', label: 'My profile', icon: UserRound }];
const ADMIN = [
  { to: '/admin/employees', label: 'Employees', icon: Users },
  { to: '/admin/sign-in-requests', label: 'Sign-in requests', icon: UserPlus },
  { to: '/admin/import', label: 'Import employees', icon: FileUp },
  { to: '/admin/departments', label: 'Departments', icon: Building2 },
  { to: '/admin/holidays', label: 'Public holidays', icon: CalendarDays },
  { to: '/admin/schedules', label: 'Working schedules', icon: Clock },
  { to: '/admin/settings', label: 'Workflow settings', icon: Settings2 },
  { to: '/admin/audit', label: 'Audit log', icon: History },
];

function NavGroup({ title, items, onNavigate }) {
  return (
    <div className="mb-6">
      <p className="mb-1.5 px-3 text-xs font-medium text-muted">{title}</p>
      <ul>
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              onClick={onNavigate}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2.5 border-l-[3px] px-3 py-1.5 text-sm',
                  isActive
                    ? 'border-brand bg-brand-soft font-medium text-brand'
                    : 'border-transparent text-ink hover:bg-canvas',
                ].join(' ')
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AppShell() {
  const { data: user } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      const { logoutUrl } = await api.post('/api/auth/logout');
      window.location.assign(logoutUrl);
    } catch {
      window.location.assign('/signed-out');
    }
  }

  const roleText = user.roles.length ? user.roles.map((r) => ROLE_LABELS[r]).join(', ') : 'Employee';
  const nav = (
    <>
      <NavGroup title="My work" items={MY_WORK} onNavigate={() => setMenuOpen(false)} />
      {hasRole(user, 'HR_ADMIN') && (
        <NavGroup title="Administration" items={ADMIN} onNavigate={() => setMenuOpen(false)} />
      )}
    </>
  );

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 bg-brand text-white">
        <div className="flex h-14 items-center gap-4 px-4">
          <button
            type="button"
            className="-ml-1 rounded-sm p-1 md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="flex items-baseline gap-3">
            <span className="text-[17px] font-semibold tracking-[0.01em]">Altus Financial Services</span>
            <span className="hidden border-l border-white/30 pl-3 text-sm text-white/80 sm:inline">
              Leave Management
            </span>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{fullName(user)}</p>
              <p className="text-xs text-white/70">{roleText}</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-white/90 hover:bg-white/10"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <nav
          aria-label="Main"
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-rule bg-white pt-5 md:block"
        >
          {nav}
        </nav>
        {menuOpen && (
          <nav
            aria-label="Main"
            className="fixed inset-x-0 top-14 z-20 border-b border-rule bg-white pt-4 shadow-sm md:hidden"
          >
            {nav}
          </nav>
        )}
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
