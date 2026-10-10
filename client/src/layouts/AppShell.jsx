import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import logo from '../assets/brand/altus-logo.png';
import {
  Bell,
  Mail,
  House,
  LayoutGrid,
  UserCheck,
  UsersRound,
  CalendarCheck,
  CalendarPlus,
  ClipboardCheck,
  ListChecks,
  ShieldCheck,
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
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Notice } from '../components/ui.jsx';
import { useMe, hasRole } from '../lib/auth.jsx';
import { ROLE_LABELS, fullName } from '../lib/format.js';

const MY_WORK = [
  { to: '/home', label: 'Home', icon: House },
  { to: '/leave', label: 'My leave', icon: CalendarCheck, end: true },
  { to: '/leave/apply', label: 'Apply for leave', icon: CalendarPlus },
  { to: '/profile', label: 'My profile', icon: UserRound },
];
const MANAGER = [
  { to: '/team', label: 'Team overview', icon: UsersRound },
  { to: '/approvals', label: 'Team approvals', icon: ClipboardCheck },
  { to: '/delegation', label: 'Delegation', icon: UserCheck },
];
const HR = [
  { to: '/hr', label: 'HR overview', icon: LayoutGrid, end: true },
  { to: '/hr/approvals', label: 'HR approvals', icon: ShieldCheck },
];
const ADMIN = [
  { to: '/admin/employees', label: 'Employees', icon: Users },
  { to: '/admin/sign-in-requests', label: 'Sign-in requests', icon: UserPlus },
  { to: '/admin/import', label: 'Import employees', icon: FileUp },
  { to: '/admin/departments', label: 'Departments', icon: Building2 },
  { to: '/admin/leave-types', label: 'Leave types', icon: ListChecks },
  { to: '/admin/delegations', label: 'Delegations', icon: UserCheck },
  { to: '/admin/holidays', label: 'Public holidays', icon: CalendarDays },
  { to: '/admin/schedules', label: 'Working schedules', icon: Clock },
  { to: '/admin/settings', label: 'Workflow settings', icon: Settings2 },
  { to: '/admin/emails', label: 'Emails', icon: Mail },
  { to: '/admin/audit', label: 'Audit log', icon: History },
];

function NavGroup({ title, items, onNavigate }) {
  return (
    <div className="mb-6">
      <p className="mb-1.5 px-3 text-xs font-medium text-muted">{title}</p>
      <ul>
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
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

  const roleText =
    [...user.roles.map((r) => ROLE_LABELS[r]), ...(user.isManager ? ['Manager'] : [])].join(', ') ||
    'Employee';
  const nav = (
    <>
      <NavGroup title="My work" items={MY_WORK} onNavigate={() => setMenuOpen(false)} />
      {user.isManager && <NavGroup title="Manager" items={MANAGER} onNavigate={() => setMenuOpen(false)} />}
      {hasRole(user, 'HR_OFFICER') && (
        <NavGroup title="HR" items={HR} onNavigate={() => setMenuOpen(false)} />
      )}
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
      <header className="sticky top-0 z-30 border-t-[3px] border-b border-t-brand border-b-rule bg-white">
        <div className="flex h-14 items-center gap-4 px-4">
          <button
            type="button"
            className="-ml-1 rounded-sm p-1 text-ink md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="Altus Financial Services Limited" className="h-8 w-auto sm:h-10" />
            <span className="hidden border-l border-rule pl-3 text-sm font-medium text-brand sm:inline">
              Leave Management
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <NotificationBell />
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{fullName(user)}</p>
              <p className="text-xs text-muted">{roleText}</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-ink hover:bg-canvas"
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
          className="sticky top-[60px] hidden h-[calc(100vh-60px)] w-60 shrink-0 overflow-y-auto border-r border-rule bg-white pt-5 md:block"
        >
          {nav}
        </nav>
        {menuOpen && (
          <nav
            aria-label="Main"
            className="fixed inset-x-0 top-[60px] z-20 border-b border-rule bg-white pt-4 shadow-sm md:hidden"
          >
            {nav}
          </nav>
        )}
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8">
          {hasRole(user, 'HR_ADMIN') && <AccrualNotice />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Persistent notice for HR Administrators while an accrual rule is unconfirmed (brief s.9). */
function AccrualNotice() {
  const q = useQuery({
    queryKey: ['admin-leave-types'],
    queryFn: () => api.get('/api/admin/leave-types'),
    staleTime: 60_000,
  });
  const names =
    q.data?.items
      .filter(
        (t) =>
          t.current?.consumesBalance && t.current.accrualMethod !== 'NONE' && !t.current.accrualConfirmed,
      )
      .map((t) => t.name) ?? [];
  if (!names.length) return null;
  return (
    <div className="mb-6 max-w-6xl">
      <Notice
        tone="pending"
        title={`Accrual is off: the ${names.join(', ').toLowerCase()} rule is not confirmed.`}
      >
        The policy states both 25 days a year and 2.3 days a month. Confirm the rule under{' '}
        <Link to="/admin/leave-types" className="underline">
          Leave types
        </Link>{' '}
        before running monthly accrual.
      </Notice>
    </div>
  );
}

/** Unread count, refreshed every minute and when the window regains focus. */
function NotificationBell() {
  const q = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/api/notifications/unread-count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const n = q.data?.unread ?? 0;
  return (
    <Link
      to="/notifications"
      className="relative rounded-sm p-1.5 text-ink hover:bg-canvas"
      aria-label={n ? `Notifications, ${n} unread` : 'Notifications'}
    >
      <Bell className="size-5" aria-hidden />
      {n > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
