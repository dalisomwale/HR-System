import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import logo from '../assets/brand/altus-logo.png';
import {
  ArrowLeft,
  Bell,
  BellRing,
  Briefcase,
  Banknote,
  Calculator,
  Coins,
  FileSpreadsheet,
  Scale as ScaleIcon,
  Store,
  Smartphone,
  ListOrdered,
  SlidersHorizontal,
  CalendarRange,
  Target,
  CalendarClock,
  ClipboardList,
  FileText,
  UserSearch,
  FileBarChart,
  Mail,
  House,
  LayoutGrid,
  UserCheck,
  UsersRound,
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
  MapPin,
  Truck,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import LeaveTrail from './LeaveTrail.jsx';
import { LogOutButton, PageFooter, UserAvatar } from './AppFrame.jsx';
import RequisitionsTrail from './RequisitionsTrail.jsx';
import ModuleTrail from './ModuleTrail.jsx';
import { useRc } from '../pages/recruitment/rc.js';
import { usePf } from '../pages/performance/pf.js';
import { useFloat } from '../pages/float/fl.js';
import { useRq } from '../pages/requisitions/rq.js';
import { can, useMe, hasRole, seesWholeGroup } from '../lib/auth.jsx';
import { ROLE_LABELS, fullName } from '../lib/format.js';

const MY_WORK = [
  { to: '/home', label: 'Home', icon: House },
  { to: '/leave/apply', label: 'Apply For Leave', icon: CalendarPlus },
  { to: '/leave/balances', label: 'My Leave Balances', icon: Scale },
  { to: '/notifications', label: 'Notifications', icon: Bell, count: 'unread' },
];
const MANAGER = [
  { to: '/team', label: 'Departmental Overview', icon: UsersRound, end: true },
  { to: '/team/members', label: 'Members', icon: Users, managersOnly: true },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck },
  { to: '/delegation', label: 'Delegation', icon: UserCheck },
];
// HR: each item shows when the person's Leave management role includes it (D108).
const HR = [
  { to: '/hr', label: 'HR Overview', icon: LayoutGrid, end: true, perm: 'leave.overview' },
  { to: '/hr/approvals', label: 'HR Approvals', icon: ShieldCheck, perm: 'leave.approve_final' },
];
// Leave settings (D136): kept apart from the HR work queues.
const LEAVE_SETTINGS = [
  { to: '/admin/leave-types', label: 'Leave Types', icon: ListChecks, perm: 'leave.types' },
  { to: '/admin/delegations', label: 'Delegations', icon: UserCheck, perm: 'leave.delegations' },
  { to: '/admin/holidays', label: 'Public Holidays', icon: CalendarDays, perm: 'leave.calendar' },
  { to: '/admin/schedules', label: 'Working Schedules', icon: Clock, perm: 'leave.calendar' },
];
// Employee management (D52): the central employee record, its own menu.
// Employee management (D52, D55): its own menu, in segments.
const PEOPLE = [
  { to: '/people', label: 'Home', icon: House, end: true },
  // Not lit up on the add form, which has its own item.
  { to: '/people/employees', label: 'Employees', icon: Users, except: '/people/employees/new' },
  { to: '/people/employees/new', label: 'Add Employee', icon: UserPlus, perm: 'people.edit' },
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
  extra = [],
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
        {/* Further pages of the section, after its overview (e.g. Branches under Company, D109). */}
        {extra.map(({ to, label, icon: ExtraIcon }) => (
          <li key={to}>
            <NavLink to={to} onClick={onNavigate} className={navLinkClass}>
              <ExtraIcon aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reports segment: opens to list each report; the chosen one is lit up (D64). */
function ReportsNav({
  onNavigate,
  to = '/people/reports',
  source = '/api/people/reports',
  label = 'Reports',
}) {
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
            {label}
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
  const canAdd = can(user, 'people.org');
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
        extra={[{ to: '/people/branches', label: 'Branches', icon: MapPin }]}
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

// Admin in every module (D108), as in the inventory system: Users, Roles, Audit trail, then the
// module's own settings. Each shows when the person's role in the module includes it.
const LEAVE_ADMIN = [
  { to: '/admin/users', label: 'Users', icon: Users, perm: 'leave.users' },
  { to: '/admin/roles', label: 'Roles', icon: KeyRound, perm: 'leave.roles' },
  { to: '/admin/audit', label: 'Audit Trail', icon: History, perm: 'leave.audit' },
  { to: '/admin/settings', label: 'Workflow Settings', icon: Settings2, perm: 'leave.settings' },
  { to: '/admin/emails', label: 'Emails', icon: Mail, perm: 'leave.emails' },
  { to: '/admin/notifications', label: 'Notifications', icon: BellRing, perm: 'leave.notifications' },
];
const PEOPLE_ADMIN = [
  { to: '/people/users', label: 'Users', icon: Users, perm: 'people.users' },
  { to: '/people/roles', label: 'Roles', icon: KeyRound, perm: 'people.roles' },
  { to: '/people/positions', label: 'Positions', icon: UserCog, perm: 'people.positions' },
  { to: '/people/audit', label: 'Audit Trail', icon: History, perm: 'people.audit' },
];

/** The items a person's role includes (items without `perm` are for everyone). */
const allowed = (user, items) => items.filter((i) => !i.perm || can(user, i.perm));

function NavGroup({ title, items, onNavigate, counts = {} }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={SECTION_LABEL}>{title}</p>
      <NavItems items={items} onNavigate={onNavigate} counts={counts} />
    </div>
  );
}

function NavItems({ items, onNavigate, counts = {} }) {
  const { pathname } = useLocation();
  return (
    <>
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
    </>
  );
}

/** Monthly Reports opens to its four views, as on the inventory system's side menu. */
function StockReportsNav({ limited, onNavigate }) {
  const { pathname, search } = useLocation();
  const inside = pathname === '/requisitions/reports';
  const by = new URLSearchParams(search).get('by') ?? 'category';
  const [open, setOpen] = useState(inside);
  useEffect(() => {
    if (inside) setOpen(true);
  }, [inside]);
  const views = limited
    ? [
        ['department', 'Issued To My Department'],
        ['dept-category', 'By Category'],
        ['dept-items', 'Most Used Items'],
        ['dept-spend', 'Spend By Month'],
      ]
    : [
        ['category', 'Category'],
        ['company', 'Company'],
        ['branch', 'Branch'],
        ['department', 'Department'],
      ];
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="stock-reports-menu"
        onClick={() => setOpen((o) => !o)}
        className={`${navLinkClass({ isActive: inside && !open })} w-full text-left`}
      >
        <FileBarChart aria-hidden />
        <span className="flex-1">Monthly Reports</span>
        <ChevronDown
          className={`size-3.5! text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <ul id="stock-reports-menu" className={SUB_LIST}>
          {views.map(([key, label]) => (
            <li key={key}>
              <Link
                to={`/requisitions/reports?by=${key}`}
                onClick={onNavigate}
                aria-current={inside && by === key ? 'page' : undefined}
                className={subLinkClass(inside && by === key)}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Inventory System menu (D105, D107), laid out as the inventory system's own. */
function RequisitionsNav({ onNavigate }) {
  const rq = useRq();
  const a = rq.data;
  if (!a) return rq.isPending ? <p className="px-2.5 pt-3.5 text-xs text-muted">Loading</p> : null;
  const stock = [
    ...(a.stock
      ? [
          {
            to: '/requisitions/stock',
            label: a.stockDepartment ? 'Department Stock' : 'Manage Stock',
            icon: Boxes,
          },
        ]
      : []),
    ...(a.receive ? [{ to: '/requisitions/receive', label: 'Receive Stock', icon: PackagePlus }] : []),
    ...(a.issue ? [{ to: '/requisitions/issue', label: 'Issue Stock', icon: PackageMinus }] : []),
    // One item for requisitions (D139): raising and the list share a page.
    {
      to: '/requisitions/requests',
      label: a.canRaise ? 'Raise A Requisition' : 'Requisitions',
      icon: a.canRaise ? FilePlus2 : ShoppingCart,
      count: 'waiting',
    },
    ...(a.stock || a.categoriesManage
      ? [{ to: '/requisitions/categories', label: 'Stock Categories', icon: Tags }]
      : []),
    ...(a.stock ? [{ to: '/requisitions/suppliers', label: 'Suppliers', icon: Truck }] : []),
  ];
  const records = [
    ...(a.transactions
      ? [{ to: '/requisitions/transactions', label: 'Transactions', icon: ArrowLeftRight }]
      : []),
  ];
  // Users, Roles and Audit trail first, as in every module (D108), then the inventory's own.
  const admin = [
    ...(a.usersAdmin ? [{ to: '/requisitions/users', label: 'Users', icon: Users }] : []),
    ...(a.rolesAdmin ? [{ to: '/requisitions/roles', label: 'Roles', icon: KeyRound }] : []),
    ...(a.auditAdmin ? [{ to: '/requisitions/audit', label: 'Audit Trail', icon: History }] : []),
    ...(a.orgAdmin
      ? [{ to: '/requisitions/settings', label: 'Requisition Departments', icon: Building2 }]
      : []),
    ...(a.alertsAdmin ? [{ to: '/requisitions/alerts', label: 'Stock Alerts', icon: BellRing }] : []),
  ];
  return (
    <>
      <NavGroup
        title="Overview"
        items={[{ to: '/requisitions', label: 'Dashboard', icon: LayoutGrid, end: true }]}
        onNavigate={onNavigate}
      />
      <NavGroup title="Stock" items={stock} counts={{ waiting: a.waiting }} onNavigate={onNavigate} />
      {(records.length > 0 || a.reports) && (
        <div>
          <p className={SECTION_LABEL}>Records</p>
          <NavItems items={records} onNavigate={onNavigate} />
          {a.reports && <StockReportsNav limited={Boolean(a.stockDepartment)} onNavigate={onNavigate} />}
        </div>
      )}
      {admin.length > 0 && <NavGroup title="Admin" items={admin} onNavigate={onNavigate} />}
    </>
  );
}

/** The Float system's menu (D126): AMS cash and float, by what each person does in it. */
function FloatNav({ user, onNavigate }) {
  const me = useFloat();
  const fl = me.data?.rights ?? {};
  const c = me.data?.counts ?? {};
  const branch = [
    ...(fl.viewAll || fl.supervise || fl.admin
      ? [{ to: '/float', label: 'Dashboard', icon: LayoutGrid, end: true }]
      : []),
    ...(fl.record || fl.supervise || fl.admin
      ? [
          { to: '/float/branch', label: 'Branch: Open And Close', icon: Banknote, end: true },
          { to: '/float/record', label: 'Record A Transaction', icon: Smartphone },
        ]
      : []),
    ...(fl.supervise || fl.director
      ? [{ to: '/float/approvals', label: 'Approvals', icon: ScaleIcon, count: 'approvals' }]
      : []),
    { to: '/float/requisitions', label: 'Requisitions', icon: ClipboardList, count: 'requisitions' },
  ];
  const records = [
    ...(fl.viewAll || fl.record || fl.supervise
      ? [{ to: '/float/daily', label: 'Daily Reports', icon: FileSpreadsheet, count: 'days' }]
      : []),
    ...(fl.viewAll || fl.record
      ? [{ to: '/float/transactions', label: 'Transactions', icon: ListOrdered }]
      : []),
    ...(fl.viewAll || fl.supervise || fl.shortages
      ? [{ to: '/float/variances', label: 'Surplus And Deficit', icon: Calculator }]
      : []),
  ];
  const admin = [
    { to: '/float/users', label: 'Users', icon: Users, perm: 'float.users' },
    { to: '/float/roles', label: 'Roles', icon: KeyRound, perm: 'float.roles' },
    { to: '/float/audit', label: 'Audit Trail', icon: History, perm: 'float.audit' },
    {
      to: '/float/branches',
      label: 'Branches',
      icon: Store,
      perm: 'float.admin',
      except: '/float/branches/',
    },
    { to: '/float/phone-access', label: 'Phone Sign-in', icon: Smartphone, perm: 'float.admin' },
    { to: '/float/settings', label: 'Settings', icon: SlidersHorizontal, perm: 'float.admin' },
  ];
  const counts = { approvals: c.approvals ?? 0, requisitions: c.requisitions ?? 0, days: c.daysToSign ?? 0 };
  return (
    <>
      <NavGroup title="Branches" items={branch} counts={counts} onNavigate={onNavigate} />
      <NavGroup title="Records" items={records} counts={counts} onNavigate={onNavigate} />
      <NavGroup title="Admin" items={allowed(user, admin)} onNavigate={onNavigate} />
    </>
  );
}

/** Recruitment management's menu (D114): what each person does, from their role in it. */
function RecruitmentNav({ user, onNavigate }) {
  const rc = useRc();
  const a = rc.data ?? {};
  const c = a.counts ?? {};
  const hiring = [
    { to: '/recruitment', label: 'Dashboard', icon: LayoutGrid, end: true },
    ...(a.raise || a.review || a.approve || a.requestsAll
      ? [
          {
            to: '/recruitment/requests',
            label: 'Hiring Requests',
            icon: ClipboardList,
            count: 'requests',
            except: '/recruitment/requests/new',
          },
        ]
      : []),
    ...(a.raise ? [{ to: '/recruitment/requests/new', label: 'Request A Hire', icon: FilePlus2 }] : []),
    ...(a.view || c.myVacancies > 0
      ? [
          {
            to: '/recruitment/vacancies',
            label: 'Vacancies',
            icon: UserSearch,
            except: '/recruitment/vacancies/new',
          },
        ]
      : []),
  ];
  const mine = [
    { to: '/recruitment/jobs', label: 'Open Positions', icon: Briefcase },
    { to: '/recruitment/applications', label: 'My Applications', icon: FileText },
    { to: '/recruitment/interviews', label: 'My Interviews', icon: CalendarClock, count: 'feedback' },
  ];
  const admin = [
    { to: '/recruitment/users', label: 'Users', icon: Users, perm: 'recruitment.users' },
    { to: '/recruitment/roles', label: 'Roles', icon: KeyRound, perm: 'recruitment.roles' },
    { to: '/recruitment/audit', label: 'Audit Trail', icon: History, perm: 'recruitment.audit' },
  ];
  const counts = { requests: (c.toReview ?? 0) + (c.toApprove ?? 0), feedback: c.feedbackDue ?? 0 };
  return (
    <>
      <NavGroup title="Hiring" items={hiring} counts={counts} onNavigate={onNavigate} />
      <NavGroup title="My Recruitment" items={mine} counts={counts} onNavigate={onNavigate} />
      <NavGroup title="Admin" items={allowed(user, admin)} onNavigate={onNavigate} />
    </>
  );
}

/** Performance management's menu (D115). */
function PerformanceNav({ user, onNavigate }) {
  const pf = usePf();
  const a = pf.data ?? {};
  const c = a.counts ?? {};
  const work = [
    { to: '/performance', label: 'Dashboard', icon: LayoutGrid, end: true },
    { to: '/performance/mine', label: 'My Appraisals', icon: Target, count: 'mine' },
    ...(a.isManager || a.viewAll
      ? [
          {
            to: '/performance/team',
            label: a.isManager ? 'My Team' : 'Appraisals',
            icon: UsersRound,
            count: 'team',
          },
        ]
      : []),
    ...(a.isManager || a.probation || c.probation > 0
      ? [{ to: '/performance/probation', label: 'Probation Reviews', icon: UserCheck, count: 'probation' }]
      : []),
  ];
  const hr =
    a.cycles || a.viewAll
      ? [
          {
            to: '/performance/cycles',
            label: 'Review Cycles',
            icon: CalendarRange,
            except: '/performance/cycles/new',
          },
        ]
      : [];
  const admin = [
    { to: '/performance/users', label: 'Users', icon: Users, perm: 'performance.users' },
    { to: '/performance/roles', label: 'Roles', icon: KeyRound, perm: 'performance.roles' },
    { to: '/performance/audit', label: 'Audit Trail', icon: History, perm: 'performance.audit' },
  ];
  const counts = { mine: c.mine ?? 0, team: (c.team ?? 0) + (c.signoff ?? 0), probation: c.probation ?? 0 };
  return (
    <>
      <NavGroup title="Appraisals" items={work} counts={counts} onNavigate={onNavigate} />
      <NavGroup title="HR" items={hr} onNavigate={onNavigate} />
      <NavGroup title="Admin" items={allowed(user, admin)} onNavigate={onNavigate} />
    </>
  );
}

/** The leave system's menu: what each person does, from their role in it (D108). */
function LeaveNav({ user, counts, onNavigate }) {
  const hr = allowed(user, HR).map((i) =>
    i.to === '/hr' && !can(user, 'leave.approve_final') ? { ...i, label: 'Group Overview' } : i,
  );
  return (
    <>
      <NavGroup title="My Leaves" items={MY_WORK} counts={counts} onNavigate={onNavigate} />
      {(user.isManager || user.isDelegate || hasRole(user, 'HR_ADMIN')) && (
        <NavGroup
          title="Department Manager"
          items={MANAGER.filter((i) => !i.managersOnly || user.isManager)}
          onNavigate={onNavigate}
        />
      )}
      <NavGroup
        title={can(user, 'leave.approve_final') ? 'Human Resource Dept' : 'Group'}
        items={hr}
        onNavigate={onNavigate}
      />
      <NavGroup title="Settings" items={allowed(user, LEAVE_SETTINGS)} onNavigate={onNavigate} />
      {/* Leave reports, for managers, delegates and whoever sees the whole group (D68). */}
      {(user.isManager || user.isDelegate || seesWholeGroup(user)) && (
        <div className="[&>div]:mt-0">
          <p className={SECTION_LABEL}>Reports</p>
          <ReportsNav onNavigate={onNavigate} to="/reports" source="/api/reports" label="Leave Reports" />
        </div>
      )}
      <NavGroup title="Admin" items={allowed(user, LEAVE_ADMIN)} onNavigate={onNavigate} />
    </>
  );
}

export default function AppShell() {
  const { data: user } = useMe();
  const { pathname } = useLocation();
  const inPeople = pathname === '/people' || pathname.startsWith('/people/');
  const inRequisitions = pathname === '/requisitions' || pathname.startsWith('/requisitions/');
  const inRecruitment = pathname === '/recruitment' || pathname.startsWith('/recruitment/');
  const inPerformance = pathname === '/performance' || pathname.startsWith('/performance/');
  const inFloat = pathname === '/float' || pathname.startsWith('/float/');
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

  // Their role in this module, then their positions. A System Administrator holds every right,
  // so that title alone is shown.
  const moduleKey = inRequisitions
    ? 'inventory'
    : inFloat
      ? 'float'
      : inRecruitment
        ? 'recruitment'
        : inPerformance
          ? 'performance'
          : inPeople
            ? 'people'
            : 'leave';
  const roleText = hasRole(user, 'HR_ADMIN')
    ? [
        ...user.roles.filter((r) => r.endsWith('_DIRECTOR')).map((r) => ROLE_LABELS[r]),
        ROLE_LABELS.HR_ADMIN,
      ].join(', ')
    : [
        user.accessRoles?.[moduleKey],
        ...user.roles.map((r) => ROLE_LABELS[r]),
        ...(user.isManager ? ['Manager'] : []),
      ]
        .filter(Boolean)
        .join(', ') || 'Employee';
  const close = () => setMenuOpen(false);
  const appName = inRequisitions
    ? 'Inventory System'
    : inFloat
      ? 'Float System'
      : inRecruitment
        ? 'Recruitment Management'
        : inPerformance
          ? 'Performance Management'
          : inPeople
            ? 'Employee Management'
            : 'Leave Management';
  const nav = (
    <>
      {/* The plain way back to the Altus Group applications page, at the top of the menu. */}
      <Link to="/" onClick={close} className={`${navLinkClass({ isActive: false })} mt-1`}>
        <ArrowLeft aria-hidden />
        All applications
      </Link>
      {inRequisitions ? (
        <RequisitionsNav onNavigate={close} />
      ) : inFloat ? (
        <FloatNav user={user} onNavigate={close} />
      ) : inRecruitment ? (
        <RecruitmentNav user={user} onNavigate={close} />
      ) : inPerformance ? (
        <PerformanceNav user={user} onNavigate={close} />
      ) : inPeople ? (
        <>
          <NavGroup
            title="People"
            items={allowed(user, PEOPLE).map((i) =>
              // Inside a company or department, Add employee adds to it and keeps the path (D62).
              i.to === '/people/employees/new' && placeBase ? { ...i, to: `${placeBase}/employees/new` } : i,
            )}
            onNavigate={close}
          />
          <OrganisationNav user={user} onNavigate={close} />
          <ReportsNav onNavigate={close} />
          <NavGroup title="Admin" items={allowed(user, PEOPLE_ADMIN)} onNavigate={close} />
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
            title="My Profile"
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
          {inRequisitions ? (
            <RequisitionsTrail />
          ) : inFloat ? (
            <ModuleTrail module="float" />
          ) : inRecruitment ? (
            <ModuleTrail module="recruitment" />
          ) : inPerformance ? (
            <ModuleTrail module="performance" />
          ) : (
            !inPeople && <LeaveTrail />
          )}
          <Outlet />
        </div>
        <PageFooter />
      </main>
    </div>
  );
}
