import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import logo from '../assets/brand/altus-logo.png';
import {
  Bell,
  FileBarChart,
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
  Landmark,
  KeyRound,
  Clock,
  FileUp,
  History,
  Menu,
  Settings2,
  UserRound,
  Users,
  UserPlus,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useMe, hasRole, seesWholeGroup } from '../lib/auth.jsx';
import { ROLE_LABELS, fullName } from '../lib/format.js';

const MY_WORK = [
  { to: '/home', label: 'Home', icon: House },
  { to: '/leave', label: 'My leave', icon: CalendarCheck, end: true },
  { to: '/leave/apply', label: 'Apply for leave', icon: CalendarPlus },
  { to: '/notifications', label: 'Notifications', icon: Bell, count: 'unread' },
  { to: '/profile', label: 'My profile', icon: UserRound },
];
const MANAGER = [
  { to: '/team', label: 'Team overview', icon: UsersRound },
  { to: '/approvals', label: 'Team approvals', icon: ClipboardCheck },
  { to: '/delegation', label: 'Delegation', icon: UserCheck },
];
// HR Officers look after people and leave setup as well as approvals (D46).
const HR = [
  { to: '/hr', label: 'HR overview', icon: LayoutGrid, end: true },
  { to: '/hr/approvals', label: 'HR approvals', icon: ShieldCheck },
  { to: '/admin/employees', label: 'Employees', icon: Users },
  { to: '/admin/import', label: 'Import employees', icon: FileUp },
  { to: '/admin/companies', label: 'Companies', icon: Landmark },
  { to: '/admin/departments', label: 'Departments', icon: Building2 },
  { to: '/admin/leave-types', label: 'Leave types', icon: ListChecks },
  { to: '/admin/delegations', label: 'Delegations', icon: UserCheck },
  { to: '/admin/holidays', label: 'Public holidays', icon: CalendarDays },
  { to: '/admin/schedules', label: 'Working schedules', icon: Clock },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
];
const REPORTS = { to: '/reports', label: 'Reports', icon: FileBarChart };
const DIRECTORS = [{ to: '/hr', label: 'Group overview', icon: LayoutGrid, end: true }, REPORTS];
// System Administrators only. They also see everything in the HR menu.
const ADMIN = [
  { to: '/admin/roles', label: 'Roles', icon: KeyRound },
  { to: '/admin/sign-in-requests', label: 'Sign-in requests', icon: UserPlus },
  { to: '/admin/settings', label: 'Workflow settings', icon: Settings2 },
  { to: '/admin/emails', label: 'Emails', icon: Mail },
  { to: '/admin/audit', label: 'Audit log', icon: History },
];

function NavGroup({ title, items, onNavigate, counts = {} }) {
  return (
    <div className="mb-6">
      <p className="mb-1.5 px-3 text-xs font-medium text-muted">{title}</p>
      <ul>
        {items.map(({ to, label, icon: Icon, end, count }) => (
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
              {count && counts[count] > 0 && (
                <span className="ml-auto min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] leading-5 font-semibold text-white">
                  {counts[count] > 99 ? '99+' : counts[count]}
                  <span className="sr-only"> unread</span>
                </span>
              )}
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
  // Unread notifications, refreshed every minute and when the window regains focus.
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/api/notifications/unread-count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const counts = { unread: unread.data?.unread ?? 0 };

  // A System Administrator holds every right, so that title alone is shown.
  const roleText = hasRole(user, 'HR_ADMIN')
    ? [
        ...user.roles.filter((r) => r.endsWith('_DIRECTOR')).map((r) => ROLE_LABELS[r]),
        ROLE_LABELS.HR_ADMIN,
      ].join(', ')
    : [...user.roles.map((r) => ROLE_LABELS[r]), ...(user.isManager ? ['Manager'] : [])].join(', ') ||
      'Employee';
  const nav = (
    <>
      <NavGroup title="My work" items={MY_WORK} counts={counts} onNavigate={() => setMenuOpen(false)} />
      {(user.isManager || user.isDelegate || hasRole(user, 'HR_ADMIN')) && (
        <NavGroup
          title="Manager"
          items={seesWholeGroup(user) ? MANAGER : [...MANAGER, REPORTS]}
          onNavigate={() => setMenuOpen(false)}
        />
      )}
      {hasRole(user, 'HR_OFFICER') && (
        <NavGroup title="HR" items={HR} onNavigate={() => setMenuOpen(false)} />
      )}
      {!hasRole(user, 'HR_OFFICER') && seesWholeGroup(user) && (
        <NavGroup title="Directors" items={DIRECTORS} onNavigate={() => setMenuOpen(false)} />
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
            className="relative -ml-1 rounded-sm p-1 text-ink md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            {!menuOpen && counts.unread > 0 && (
              <span aria-hidden className="absolute top-0.5 right-0.5 size-2 rounded-full bg-danger" />
            )}
          </button>
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="Altus Group" className="h-8 w-auto sm:h-10" />
            <span className="hidden border-l border-rule pl-3 text-sm font-medium text-brand sm:inline">
              Leave Management
            </span>
          </Link>
          <Link
            to="/profile"
            className="-mr-1 ml-auto rounded-md px-2 py-1 text-right leading-tight hover:bg-canvas"
            aria-label={`${fullName(user)}, ${roleText}. My profile`}
          >
            <p className="text-sm font-medium">{fullName(user)}</p>
            <p className="hidden text-xs text-muted sm:block">{roleText}</p>
          </Link>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-60px)]">
        {/* The white column runs the full page height; the menu inside stays in view while scrolling. */}
        <div className="hidden w-60 shrink-0 border-r border-rule bg-white md:block">
          <nav
            aria-label="Main"
            className="sticky top-[60px] max-h-[calc(100vh-60px)] overflow-y-auto pt-5 pb-5"
          >
            {nav}
          </nav>
        </div>
        {menuOpen && (
          <nav
            aria-label="Main"
            className="fixed inset-x-0 top-[60px] z-20 border-b border-rule bg-white pt-4 shadow-sm md:hidden"
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
