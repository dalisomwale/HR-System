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
  UserCog,
  CalendarDays,
  Building2,
  Landmark,
  KeyRound,
  Clock,
  History,
  Menu,
  Scale,
  Settings2,
  Users,
  UserPlus,
  X,
  ChevronDown,
  Plus,
  ShoppingCart,
  FilePlus2,
  Boxes,
  PackagePlus,
  PackageMinus,
  ArrowLeftRight,
  Tags,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import LeaveTrail from './LeaveTrail.jsx';
import { LogOutButton, PageFooter, UserAvatar } from './AppFrame.jsx';
import RequisitionsTrail from './RequisitionsTrail.jsx';
import { useRq } from '../pages/requisitions/rq.js';
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
];
// Employee management (D52): the central employee record, its own menu.
// Employee management (D52, D55): its own menu, in segments.
const PEOPLE = [
  { to: '/people', label: 'Home', icon: House, end: true },
  // Not lit up on the add form, which has its own item.
  { to: '/people/employees', label: 'Employees', icon: Users, except: '/people/employees/new' },
  { to: '/people/employees/new', label: 'Add employee', icon: UserPlus, hrOnly: true },
];

// Side menu, as in the Altus Inventory System: an orange bar marks the page you are on.
const NAV_LINK =
  'relative mb-px flex items-center gap-[9px] rounded-sm py-2 pr-2.5 pl-3 text-[0.94rem] font-medium transition-colors [&>svg]:size-4 [&>svg]:shrink-0';
const NAV_ON =
  'bg-brand-soft font-semibold text-brand before:absolute before:top-[7px] before:bottom-[7px] before:left-0 before:w-[3px] before:rounded-r-sm before:bg-accent-orange [&>svg]:opacity-100';
const NAV_OFF = 'text-ink-2 hover:bg-hover hover:text-brand [&>svg]:opacity-70';
const navLinkClass = ({ isActive }) => `${NAV_LINK} ${isActive ? NAV_ON : NAV_OFF}`;
const subLinkClass = (on) =>
  `block truncate rounded-sm px-2.5 py-1.5 text-[0.88rem] transition-colors ${
    on ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-2 hover:bg-hover hover:text-brand'
  }`;
const SECTION_LABEL = 'px-2.5 pt-3.5 pb-1.5 text-[0.7rem] font-medium tracking-[0.1em] text-faint uppercase';
const SUB_LIST = 'mt-0.5 mb-1.5 ml-[21px] flex flex-col gap-px border-l border-rule pl-2.5';
const TOGGLE =
  'mb-px flex w-8 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-brand';

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
    <div>
      <p className={SECTION_LABEL}>{title}</p>
      <ul>
        {canAdd && (
          <li>
            <NavLink to={`${base}/manage`} onClick={onNavigate} className={navLinkClass}>
              <Plus aria-hidden />
              {addLabel}
            </NavLink>
          </li>
        )}
        <li className="flex items-stretch">
          <NavLink to={base} end onClick={onNavigate} className={(a) => `${navLinkClass(a)} flex-1`}>
            <Icon aria-hidden />
            {overviewLabel}
          </NavLink>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? `Hide ${title.toLowerCase()} list` : `Show ${title.toLowerCase()} list`}
            onClick={() => setOpen((o) => !o)}
            className={TOGGLE}
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
        </li>
        {open && (
          <li id={listId}>
            {loading && <p className={`${SUB_LIST} py-1.5 text-xs text-muted`}>Loading</p>}
            {groups.map((g) => (
              <div key={g.heading ?? 'all'}>
                {g.heading && (
                  <p className="mt-1.5 mb-0.5 ml-[31px] truncate text-[0.7rem] font-bold tracking-[0.06em] text-muted uppercase">
                    {g.heading}
                  </p>
                )}
                <ul className={SUB_LIST}>
                  {g.items.map((it) => (
                    <li key={it.to}>
                      <NavLink
                        to={it.to}
                        onClick={onNavigate}
                        className={({ isActive }) => subLinkClass(isActive)}
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
      </ul>
    </div>
  );
}

/** Reports segment: opens to list each report; the chosen one is lit up (D64). */
function ReportsNav({ onNavigate, to = '/people/reports', source = '/api/people/reports' }) {
  const { pathname, search } = useLocation();
  const inside = pathname === to;
  const current = new URLSearchParams(search).get('report');
  const [open, setOpen] = useState(inside);
  useEffect(() => {
    if (inside) setOpen(true);
  }, [inside]);
  const list = useQuery({
    queryKey: ['reports', source],
    queryFn: () => api.get(source),
  });
  const items = list.data?.items ?? [];
  const listId = `${to.replace(/\W/g, '-')}-list`;
  const chosen = inside ? (current ?? items[0]?.id) : null;
  return (
    <div className="mt-2.5">
      <ul>
        <li className="flex items-stretch">
          {/* The chosen report below is the one lit up, so this stays plain. */}
          <NavLink to={to} end onClick={onNavigate} className={`${navLinkClass({ isActive: false })} flex-1`}>
            <FileBarChart aria-hidden />
            Reports
          </NavLink>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? 'Hide reports list' : 'Show reports list'}
            onClick={() => setOpen((o) => !o)}
            className={TOGGLE}
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
        </li>
        {open && (
          <li id={listId}>
            {list.isPending && <p className={`${SUB_LIST} py-1.5 text-xs text-muted`}>Loading</p>}
            <ul className={SUB_LIST}>
              {items.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`${to}?report=${r.id}`}
                    onClick={onNavigate}
                    aria-current={chosen === r.id ? 'page' : undefined}
                    className={subLinkClass(chosen === r.id)}
                  >
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
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
  // One plain list of department names, A to Z (project owner, 21 Oct 2026).
  const deptGroups = [{ heading: null, items: departments }];
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

const DIRECTORS = [{ to: '/hr', label: 'Group overview', icon: LayoutGrid, end: true }];
// System Administrators only. They also see everything in the HR menu.
const ADMIN = [
  { to: '/admin/roles', label: 'Roles', icon: KeyRound },
  { to: '/admin/settings', label: 'Workflow settings', icon: Settings2 },
  { to: '/admin/emails', label: 'Emails', icon: Mail },
  { to: '/admin/audit', label: 'Audit log', icon: History },
];

/** Administration as one menu item that opens to list its pages (D89). */
function AdminNav({ items, onNavigate }) {
  const { pathname } = useLocation();
  const inside = items.some((i) => pathname.startsWith(i.to));
  const [open, setOpen] = useState(inside);
  useEffect(() => {
    if (inside) setOpen(true);
  }, [inside]);
  return (
    <div className="mt-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="admin-menu"
        onClick={() => setOpen((o) => !o)}
        className={`${navLinkClass({ isActive: inside && !open })} w-full text-left`}
      >
        <UserCog aria-hidden />
        <span className="flex-1">Administration</span>
        <ChevronDown
          className={`size-3.5! text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <ul id="admin-menu" className={SUB_LIST}>
          {items.map(({ to, label }) => (
            <li key={to}>
              <NavLink to={to} onClick={onNavigate} className={({ isActive }) => subLinkClass(isActive)}>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NavGroup({ title, items, onNavigate, counts = {} }) {
  const { pathname } = useLocation();
  return (
    <div>
      <p className={SECTION_LABEL}>{title}</p>
      <ul>
        {items.map(({ to, label, icon: Icon, end, count, except }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) => navLinkClass({ isActive: isActive && pathname !== except })}
            >
              <Icon aria-hidden />
              {label}
              {count && counts[count] > 0 && (
                <span className="ml-auto min-w-5 rounded-full bg-danger px-1.5 text-center text-[0.7rem] leading-5 font-semibold text-white">
                  {counts[count] > 99 ? '99+' : counts[count]}
                  <span className="sr-only">{count === 'unread' ? ' unread' : ' waiting'}</span>
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Requisitions menu (D105), from what the person can do there. */
function RequisitionsNav({ onNavigate }) {
  const rq = useRq();
  const a = rq.data;
  if (!a) return rq.isPending ? <p className="px-2.5 pt-3.5 text-xs text-muted">Loading</p> : null;
  const work = [
    { to: '/requisitions', label: 'Home', icon: House, end: true },
    {
      to: '/requisitions/requests',
      label: 'Requisitions',
      icon: ShoppingCart,
      count: 'waiting',
      except: '/requisitions/requests/new',
    },
    ...(a.canRaise
      ? [{ to: '/requisitions/requests/new', label: 'Raise a requisition', icon: FilePlus2 }]
      : []),
  ];
  const stock = a.stock
    ? [
        {
          to: '/requisitions/stock',
          label: a.stockDepartment ? 'Department stock' : 'Stock',
          icon: Boxes,
          except: '/requisitions/stock/new',
        },
        ...(a.stores
          ? [
              { to: '/requisitions/receive', label: 'Receive stock', icon: PackagePlus },
              { to: '/requisitions/issue', label: 'Issue stock', icon: PackageMinus },
            ]
          : []),
        { to: '/requisitions/transactions', label: 'Transactions', icon: ArrowLeftRight },
        { to: '/requisitions/reports', label: 'Monthly reports', icon: FileBarChart },
        ...(a.stockDepartment ? [] : [{ to: '/requisitions/categories', label: 'Categories', icon: Tags }]),
      ]
    : [];
  return (
    <>
      <NavGroup title="My work" items={work} counts={{ waiting: a.waiting }} onNavigate={onNavigate} />
      {stock.length > 0 && <NavGroup title="Stock" items={stock} onNavigate={onNavigate} />}
      {a.admin && (
        <AdminNav
          items={[
            { to: '/requisitions/branches', label: 'Branches' },
            { to: '/requisitions/settings', label: 'Requisition departments' },
          ]}
          onNavigate={onNavigate}
        />
      )}
    </>
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
          items={MANAGER.filter((i) => !i.managersOnly || user.isManager)}
          onNavigate={onNavigate}
        />
      )}
      {hasRole(user, 'HR_OFFICER') && <NavGroup title="HR" items={HR} onNavigate={onNavigate} />}
      {!hasRole(user, 'HR_OFFICER') && seesWholeGroup(user) && (
        <NavGroup title="Directors" items={DIRECTORS} onNavigate={onNavigate} />
      )}
      {/* Leave reports, for managers, delegates, HR and directors: the same dropdown as in
          Employee management (D68). */}
      {(user.isManager || user.isDelegate || seesWholeGroup(user)) && (
        <ReportsNav onNavigate={onNavigate} to="/reports" source="/api/reports" />
      )}
      {hasRole(user, 'HR_ADMIN') && <AdminNav items={ADMIN} onNavigate={onNavigate} />}
    </>
  );
}

export default function AppShell() {
  const { data: user } = useMe();
  const { pathname } = useLocation();
  const inPeople = pathname === '/people' || pathname.startsWith('/people/');
  const inRequisitions = pathname === '/requisitions' || pathname.startsWith('/requisitions/');
  const placeBase = pathname.match(/^\/people\/(companies|departments)\/\d+/)?.[0] ?? null;
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
  const close = () => setMenuOpen(false);
  const appName = inRequisitions ? 'Requisitions' : inPeople ? 'Employee Management' : 'Leave Management';
  const nav = (
    <>
      {/* The plain way back to the Altus Group applications page, at the top of the menu. */}
      <Link to="/" onClick={close} className={`${navLinkClass({ isActive: false })} mt-1`}>
        <ArrowLeft aria-hidden />
        All applications
      </Link>
      {inRequisitions ? (
        <RequisitionsNav onNavigate={close} />
      ) : inPeople ? (
        <>
          <NavGroup
            title="People"
            items={PEOPLE.filter((i) => !i.hrOnly || hasRole(user, 'HR_OFFICER')).map((i) =>
              // Inside a company or department, Add employee adds to it and keeps the path (D62).
              i.to === '/people/employees/new' && placeBase ? { ...i, to: `${placeBase}/employees/new` } : i,
            )}
            onNavigate={close}
          />
          <OrganisationNav user={user} onNavigate={close} />
          <ReportsNav onNavigate={close} />
          {hasRole(user, 'HR_ADMIN') && (
            <AdminNav items={ADMIN.filter((i) => ['/admin/roles'].includes(i.to))} onNavigate={close} />
          )}
        </>
      ) : (
        <LeaveNav user={user} counts={counts} onNavigate={close} />
      )}
    </>
  );
  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2"
      >
        Skip to content
      </a>

      {/* Phones and tablets: a slim bar with the logo and the menu button. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-rule bg-white px-4 lg:hidden">
        <Link to="/" className="flex items-center">
          <img src={logo} alt="Altus Group" className="h-7 w-auto" />
        </Link>
        <span className="truncate text-[0.72rem] font-semibold tracking-[0.04em] text-muted uppercase">
          {appName}
        </span>
        <button
          type="button"
          className="relative ml-auto rounded-sm p-1 text-ink-2 hover:bg-hover"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          {!menuOpen && counts.unread > 0 && (
            <span aria-hidden className="absolute top-0.5 right-0.5 size-2 rounded-full bg-danger" />
          )}
        </button>
      </header>

      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/35 lg:hidden"
          onClick={close}
        />
      )}

      {/* The side menu: fixed on wide screens, sliding in from the left on smaller ones. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 max-w-[85vw] flex-col border-r border-rule bg-white transition-transform duration-200 lg:translate-x-0 ${
          menuOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-rule px-5 pt-[22px] pb-[18px]">
          <Link to="/" onClick={close} className="block">
            <img src={logo} alt="Altus Group" className="block h-auto w-full max-w-[180px]" />
          </Link>
          <p className="mt-2.5 text-[0.72rem] font-semibold tracking-[0.04em] text-muted uppercase">
            {appName}
          </p>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pt-1.5 pb-2.5">
          {nav}
        </nav>
        <div className="flex items-center gap-[9px] border-t border-rule p-3">
          <Link
            to="/profile"
            onClick={close}
            className="flex min-w-0 flex-1 items-center gap-[9px] rounded-sm"
            aria-label={`${fullName(user)}, ${roleText}. My profile`}
            title="My profile"
          >
            <UserAvatar person={user} />
            <span className="min-w-0 flex-1 leading-snug">
              <span className="block truncate text-[0.88rem] font-semibold text-ink">{fullName(user)}</span>
              <span className="block truncate text-[0.78rem] text-muted">{roleText}</span>
            </span>
          </Link>
          <LogOutButton icon />
        </div>
      </aside>

      <main
        id="main"
        className="flex min-h-screen min-w-0 flex-col px-3.5 py-[18px] sm:px-6 lg:ml-60 lg:px-8 lg:py-7"
      >
        {/*
          Every page starts the same distance from the menu and uses the same width, up to 1,400px;
          extra room on very wide screens stays on the right (D65). Pages' own width classes
          are overridden here so the gap never changes from page to page.
        */}
        <div className="w-full max-w-[1400px] [&>*]:mx-0! [&>*]:max-w-none!">
          {/* Employee management pages show their own path; every other page gets this one. */}
          {inRequisitions ? <RequisitionsTrail /> : !inPeople && <LeaveTrail />}
          <Outlet />
        </div>
        <PageFooter />
      </main>
    </div>
  );
}
