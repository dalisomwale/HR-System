import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import logo from '../assets/brand/altus-logo.png';
import {
  ArrowLeft,
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
  Scale,
  Settings2,
  UserRound,
  Users,
  UserPlus,
  X,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useMe, hasRole, seesWholeGroup } from '../lib/auth.jsx';
import { ROLE_LABELS, fullName } from '../lib/format.js';

const MY_WORK = [
  { to: '/home', label: 'Home', icon: House },
  { to: '/leave', label: 'My leave', icon: CalendarCheck, end: true },
  { to: '/leave/balances', label: 'My balances', icon: Scale },
  { to: '/leave/apply', label: 'Apply for leave', icon: CalendarPlus },
  { to: '/notifications', label: 'Notifications', icon: Bell, count: 'unread' },
];
const MANAGER = [
  { to: '/team', label: 'Departmental overview', icon: UsersRound, end: true },
  { to: '/team/members', label: 'Members', icon: Users, managersOnly: true },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck },
  { to: '/delegation', label: 'Delegation', icon: UserCheck },
];
// HR Officers look after people and leave setup as well as approvals (D46).
const HR = [
  { to: '/hr', label: 'HR overview', icon: LayoutGrid, end: true },
  { to: '/hr/approvals', label: 'HR approvals', icon: ShieldCheck },
  { to: '/admin/leave-types', label: 'Leave types', icon: ListChecks },
  { to: '/admin/delegations', label: 'Delegations', icon: UserCheck },
  { to: '/admin/holidays', label: 'Public holidays', icon: CalendarDays },
  { to: '/admin/schedules', label: 'Working schedules', icon: Clock },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
];
// Employee management (D52): the central employee record, its own menu.
// Employee management (D52, D55): its own menu, in segments.
const PEOPLE = [
  { to: '/people', label: 'Home', icon: House, end: true },
  // Not lit up on the add form, which has its own item.
  { to: '/people/employees', label: 'Employees', icon: Users, except: '/people/employees/new' },
  { to: '/people/employees/new', label: 'Add employee', icon: UserPlus, hrOnly: true },
];
const PEOPLE_REPORTS = [{ to: '/people/reports', label: 'Reports', icon: FileBarChart }];

const navLinkClass = ({ isActive }) =>
  [
    'flex items-center gap-2.5 border-l-[3px] px-3 py-1.5 text-sm',
    isActive
      ? 'border-brand bg-brand-soft font-medium text-brand'
      : 'border-transparent text-ink hover:bg-canvas',
  ].join(' ');

/**
 * A menu segment whose overview opens to list its items (companies or departments), with an
 * Add link for HR Officers (D55, D56). `groups`: [{ heading, items: [{ to, label }] }].
 */
function ExpandNav({
  title,
  icon: Icon,
  base,
  overviewLabel,
  groups,
  loading,
  addLabel,
  canAdd,
  onNavigate,
}) {
  const { pathname } = useLocation();
  const inside = pathname.startsWith(base);
  const [open, setOpen] = useState(inside);
  useEffect(() => {
    if (inside) setOpen(true);
  }, [inside]);
  const listId = `${base.replace(/\W/g, '-')}-list`;
  return (
    <div className="mb-6">
      <p className="mb-1.5 px-3 text-xs font-medium text-muted">{title}</p>
      <ul>
        <li className="flex items-stretch">
          <NavLink to={base} end onClick={onNavigate} className={(a) => `${navLinkClass(a)} flex-1`}>
            <Icon className="size-4 shrink-0" aria-hidden />
            {overviewLabel}
          </NavLink>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? `Hide ${title.toLowerCase()} list` : `Show ${title.toLowerCase()} list`}
            onClick={() => setOpen((o) => !o)}
            className="px-3 text-muted hover:bg-canvas hover:text-ink"
          >
            <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </li>
        {open && (
          <li id={listId}>
            {loading && <p className="py-1.5 pl-10 text-xs text-muted">Loading</p>}
            {groups.map((g) => (
              <div key={g.heading ?? 'all'} className="mb-1">
                {g.heading && (
                  <p className="truncate pt-1.5 pr-3 pb-0.5 pl-10 text-[11px] font-medium text-muted uppercase">
                    {g.heading}
                  </p>
                )}
                <ul>
                  {g.items.map((it) => (
                    <li key={it.to}>
                      <NavLink
                        to={it.to}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          [
                            'block border-l-[3px] py-1.5 pr-3 pl-10 text-sm',
                            isActive
                              ? 'border-brand bg-brand-soft font-medium text-brand'
                              : 'border-transparent text-ink hover:bg-canvas',
                          ].join(' ')
                        }
                      >
                        {it.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        )}
        {canAdd && (
          <li>
            <NavLink to={`${base}/manage`} onClick={onNavigate} className={navLinkClass}>
              <Plus className="size-4 shrink-0" aria-hidden />
              {addLabel}
            </NavLink>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Company and Departments segments, each listing what is in the organisation. */
function OrganisationNav({ user, onNavigate }) {
  const org = useQuery({
    queryKey: ['people-organisation'],
    queryFn: () => api.get('/api/people/organisation'),
  });
  const companies = (org.data?.companies ?? []).filter((c) => c.isActive);
  const departments = (org.data?.departments ?? []).filter((d) => d.isActive);
  const canAdd = hasRole(user, 'HR_OFFICER');
  // Departments are listed under their company when the group has more than one.
  const deptGroups =
    companies.length > 1
      ? [
          ...companies.map((c) => ({
            heading: c.name,
            items: departments.filter((d) => d.companyId === c.id),
          })),
          {
            heading: 'No company',
            items: departments.filter((d) => !companies.some((c) => c.id === d.companyId)),
          },
        ].filter((g) => g.items.length)
      : [{ heading: null, items: departments }];
  return (
    <>
      <ExpandNav
        title="Company"
        icon={Landmark}
        base="/people/companies"
        overviewLabel="Company overview"
        loading={org.isPending}
        groups={[
          {
            heading: null,
            items: companies.map((c) => ({ to: `/people/companies/${c.id}`, label: c.name })),
          },
        ]}
        addLabel="Add company"
        canAdd={canAdd}
        onNavigate={onNavigate}
      />
      <ExpandNav
        title="Departments"
        icon={Building2}
        base="/people/departments"
        overviewLabel="Department overview"
        loading={org.isPending}
        groups={deptGroups.map((g) => ({
          heading: g.heading,
          items: [...g.items]
            .sort((x, y) => x.name.localeCompare(y.name))
            .map((d) => ({ to: `/people/departments/${d.id}`, label: d.name })),
        }))}
        addLabel="Add department"
        canAdd={canAdd}
        onNavigate={onNavigate}
      />
    </>
  );
}

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
  const { pathname } = useLocation();
  return (
    <div className="mb-6">
      <p className="mb-1.5 px-3 text-xs font-medium text-muted">{title}</p>
      <ul>
        {items.map(({ to, label, icon: Icon, end, count, except }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2.5 border-l-[3px] px-3 py-1.5 text-sm',
                  isActive && pathname !== except
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

/** The leave system's menu: what each person does, by role. */
function LeaveNav({ user, counts, onNavigate }) {
  return (
    <>
      <NavGroup title="My work" items={MY_WORK} counts={counts} onNavigate={onNavigate} />
      {(user.isManager || user.isDelegate || hasRole(user, 'HR_ADMIN')) && (
        <NavGroup
          title="Department Manager"
          items={(seesWholeGroup(user) ? MANAGER : [...MANAGER, REPORTS]).filter(
            (i) => !i.managersOnly || user.isManager,
          )}
          onNavigate={onNavigate}
        />
      )}
      {hasRole(user, 'HR_OFFICER') && <NavGroup title="HR" items={HR} onNavigate={onNavigate} />}
      {!hasRole(user, 'HR_OFFICER') && seesWholeGroup(user) && (
        <NavGroup title="Directors" items={DIRECTORS} onNavigate={onNavigate} />
      )}
      {hasRole(user, 'HR_ADMIN') && <NavGroup title="Administration" items={ADMIN} onNavigate={onNavigate} />}
    </>
  );
}

export default function AppShell() {
  const { data: user } = useMe();
  const { pathname } = useLocation();
  const inPeople = pathname === '/people' || pathname.startsWith('/people/');
  const [menuOpen, setMenuOpen] = useState(false);
  // Unread notifications, refreshed every minute and when the window regains focus.
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/api/notifications/unread-count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const counts = { unread: unread.data?.unread ?? 0 };

  // While the menu is open on a phone or tablet the page behind it stays still; Escape closes it.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', close);
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

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
      {/* The plain way back to the Altus Group applications page, at the top of the menu. */}
      <div className="mb-4 px-3">
        <Link
          to="/"
          onClick={() => setMenuOpen(false)}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-soft"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Back to applications
        </Link>
      </div>
      {inPeople ? (
        <>
          <NavGroup
            title="People"
            items={PEOPLE.filter((i) => !i.hrOnly || hasRole(user, 'HR_OFFICER'))}
            onNavigate={() => setMenuOpen(false)}
          />
          <OrganisationNav user={user} onNavigate={() => setMenuOpen(false)} />
          <NavGroup title="Reports" items={PEOPLE_REPORTS} onNavigate={() => setMenuOpen(false)} />
          {hasRole(user, 'HR_ADMIN') && (
            <NavGroup
              title="Administration"
              items={ADMIN.filter((i) => ['/admin/roles', '/admin/sign-in-requests'].includes(i.to))}
              onNavigate={() => setMenuOpen(false)}
            />
          )}
        </>
      ) : (
        <LeaveNav user={user} counts={counts} onNavigate={() => setMenuOpen(false)} />
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
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="Altus Group" className="h-8 w-auto sm:h-10" />
            <span className="hidden border-l border-rule pl-3 text-sm font-medium text-brand sm:inline">
              {inPeople ? 'Employee Management' : 'Leave Management'}
            </span>
          </Link>
          <Link
            to="/profile"
            className="ml-auto rounded-md px-2 py-1 text-right leading-tight hover:bg-canvas lg:-mr-1"
            aria-label={`${fullName(user)}, ${roleText}. My profile`}
          >
            <p className="text-sm font-medium">{fullName(user)}</p>
            <p className="hidden text-xs text-muted sm:block">{roleText}</p>
          </Link>
          <button
            type="button"
            className="relative -mr-1 rounded-sm p-1 text-ink lg:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            {!menuOpen && counts.unread > 0 && (
              <span aria-hidden className="absolute top-0.5 right-0.5 size-2 rounded-full bg-danger" />
            )}
          </button>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-60px)]">
        {/* The white column runs the full page height; the menu inside stays in view while scrolling. */}
        <div className="hidden w-60 shrink-0 border-r border-rule bg-white lg:block">
          <nav
            aria-label="Main"
            className="sticky top-[60px] max-h-[calc(100vh-60px)] overflow-y-auto pt-5 pb-5"
          >
            {nav}
          </nav>
        </div>
        {menuOpen && (
          <>
            {/* Phones and tablets: the menu slides over the page and scrolls on its own. */}
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 top-[60px] z-20 bg-ink/30 lg:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <nav
              aria-label="Main"
              className="fixed top-[60px] right-0 bottom-0 z-30 w-72 max-w-[85vw] overflow-y-auto border-l border-rule bg-white pt-4 pb-6 shadow-lg lg:hidden"
            >
              {nav}
            </nav>
          </>
        )}
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
          {/* Pages set their own width; on wide screens they sit in the middle of the space. */}
          <div className="mx-auto w-full max-w-7xl [&>*]:mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
