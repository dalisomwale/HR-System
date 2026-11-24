import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, Link, useParams, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { RequireAuth, RequirePerm, can, useMe } from './lib/auth.jsx';
import AppShell from './layouts/AppShell.jsx';
import LauncherPage from './pages/LauncherPage.jsx';
import { SignInPage, AccessNotConfiguredPage, SignedOutPage } from './pages/auth/PublicPages.jsx';
import ProfilePage from './pages/employee/ProfilePage.jsx';
import DirectoryPage from './pages/people/DirectoryPage.jsx';
import EmployeeRecordPage from './pages/people/EmployeeRecordPage.jsx';
import PeopleDashboardPage from './pages/people/PeopleDashboardPage.jsx';
import CompanyOverviewPage from './pages/people/CompanyOverviewPage.jsx';
import CompanyPage from './pages/people/CompanyPage.jsx';
import DepartmentPage from './pages/people/DepartmentPage.jsx';
import DepartmentOverviewPage from './pages/people/DepartmentOverviewPage.jsx';
import LeaveTypePage from './pages/admin/LeaveTypePage.jsx';
import RolesPage from './pages/admin/RolesPage.jsx';
import CompaniesPage from './pages/admin/CompaniesPage.jsx';
import DepartmentsPage from './pages/admin/DepartmentsPage.jsx';
import HolidaysPage from './pages/admin/HolidaysPage.jsx';
import SchedulesPage from './pages/admin/SchedulesPage.jsx';
import SettingsPage from './pages/admin/SettingsPage.jsx';
import LeaveTypesPage from './pages/admin/LeaveTypesPage.jsx';
import { MyBalancesPage } from './pages/leave/MyLeavePage.jsx';
import ApplyPage from './pages/leave/ApplyPage.jsx';
import RequestPage from './pages/leave/RequestPage.jsx';
import { ManagerApprovalsPage, HrApprovalsPage } from './pages/approvals/ApprovalsPages.jsx';
import HomePage from './pages/home/HomePage.jsx';
import TeamPage from './pages/home/TeamPage.jsx';
import MembersPage from './pages/home/MembersPage.jsx';
import HrOverviewPage from './pages/home/HrOverviewPage.jsx';
import { DelegationsPage, AdminDelegationsPage } from './pages/delegations/DelegationsPage.jsx';
import NotificationsPage from './pages/notifications/NotificationsPage.jsx';
import EmailsPage from './pages/admin/EmailsPage.jsx';
import NotificationSettingsPage from './pages/admin/NotificationSettingsPage.jsx';
import ReportsPage from './pages/reports/ReportsPage.jsx';
import RequisitionsHomePage from './pages/requisitions/RequisitionsHomePage.jsx';
import RaiseAndListPage from './pages/requisitions/RaiseAndListPage.jsx';
import RequisitionPage from './pages/requisitions/RequisitionPage.jsx';
import StockPage from './pages/requisitions/StockPage.jsx';
import ItemPage from './pages/requisitions/ItemPage.jsx';
import ItemFormPage from './pages/requisitions/ItemFormPage.jsx';
import LeavePolicyPage from './pages/leave/LeavePolicyPage.jsx';
import ReceivePage from './pages/requisitions/ReceivePage.jsx';
import IssuePage from './pages/requisitions/IssuePage.jsx';
import TransactionsPage from './pages/requisitions/TransactionsPage.jsx';
import StockReportsPage from './pages/requisitions/StockReportsPage.jsx';
import CategoriesPage from './pages/requisitions/CategoriesPage.jsx';
import BranchesPage from './pages/people/BranchesPage.jsx';
import RequisitionSettingsPage from './pages/requisitions/RequisitionSettingsPage.jsx';
import StockAlertsPage from './pages/requisitions/StockAlertsPage.jsx';
import { FloatBranchPage, FloatRecordPage } from './pages/float/FloatEntryPages.jsx';
import FloatRequisitionsPage from './pages/float/FloatRequisitionsPage.jsx';
import {
  FloatApprovalsPage,
  FloatDashboardPage,
  FloatTransactionsPage,
  FloatVariancesPage,
} from './pages/float/FloatManagePages.jsx';
import {
  FloatBranchAdminPage,
  FloatBranchesPage,
  FloatDailyPage,
  FloatPhoneAccessPage,
  FloatSettingsPage,
} from './pages/float/FloatAdminPages.jsx';
import RecruitmentHomePage from './pages/recruitment/RecruitmentHomePage.jsx';
import {
  HiringRequestFormPage,
  HiringRequestPage,
  HiringRequestsPage,
} from './pages/recruitment/RequestsPages.jsx';
import { VacanciesPage, VacancyFormPage, VacancyPage } from './pages/recruitment/VacancyPages.jsx';
import CandidatePage from './pages/recruitment/CandidatePage.jsx';
import { ApplicationsPage, InterviewsPage, JobsPage } from './pages/recruitment/StaffPages.jsx';
import PerformanceHomePage from './pages/performance/PerformanceHomePage.jsx';
import { AppraisalPage, MyAppraisalsPage, TeamAppraisalsPage } from './pages/performance/AppraisalPages.jsx';
import { ProbationListPage, ProbationReviewPage } from './pages/performance/ProbationPages.jsx';
import { CycleFormPage, CyclePage, CyclesPage } from './pages/performance/CyclesPages.jsx';
import SuppliersPage from './pages/requisitions/SuppliersPage.jsx';
import AccessUsersPage from './pages/access/AccessUsersPage.jsx';
import AccessRolesPage from './pages/access/AccessRolesPage.jsx';
import AuditTrailPage from './pages/access/AuditTrailPage.jsx';
import { useRq } from './pages/requisitions/rq.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => err?.status >= 500 && count < 2, refetchOnWindowFocus: false },
  },
});

// Each page opens to the access right that covers it (D108); the server checks the same.
const need = (perm, el) => <RequirePerm perm={perm}>{el}</RequirePerm>;
const group = (el) => need('people.view', el);

/** Old addresses from before Employee management (D52) keep working. */
function ToPeople({ base }) {
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={`${base}${id ? `/${id}` : ''}${search}`} replace />;
}

/** Requisitions pages open only for people with a part in it (D105); `need` narrows further. */
function RqGate({ need, children }) {
  const rq = useRq();
  if (rq.isPending) return null;
  if (!rq.data || (need && !need(rq.data))) {
    return (
      <div className="max-w-xl">
        <h1 className="text-[1.3rem] leading-snug">You Don't Have Access To This Page</h1>
        <p className="mt-2 text-sm text-muted">
          The inventory system is open to the people who take part in it.{' '}
          <Link to="/" className="text-brand underline">
            Back to applications
          </Link>
        </p>
      </div>
    );
  }
  return children;
}
const rqPage = (el, need) => <RqGate need={need}>{el}</RqGate>;

/** The Float system's pages (D126): open to those whose role in it gives the right. */
function FloatGate({ check, children }) {
  const { data: me } = useMe();
  if (!me) return null;
  const r = {
    record: can(me, 'float.record'),
    viewAll: can(me, 'float.view_all'),
    supervise: can(me, 'float.supervise'),
    approve: can(me, 'float.approve'),
    director: can(me, 'float.director'),
    shortages: can(me, 'float.shortages'),
    admin: can(me, 'float.admin'),
  };
  if (!Object.values(r).some(Boolean) || (check && !check(r))) {
    return (
      <div className="max-w-xl">
        <h1 className="text-[1.3rem] leading-snug">You Don't Have Access To This Page</h1>
        <p className="mt-2 text-sm text-muted">
          The Float system is open to the people who take part in it.{' '}
          <Link to="/" className="text-brand underline">
            Back to applications
          </Link>
        </p>
      </div>
    );
  }
  return children;
}
const floatPage = (el, check) => <FloatGate check={check}>{el}</FloatGate>;

/** Links to the Float System from when it was part of the Inventory System. */
function ToFloat() {
  const { pathname, search } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/requisitions\/float/, '/float')}${search}`} replace />;
}

/** The Inventory System was at /requisitions; old links and bookmarks open the same page (D142). */
function ToInventory() {
  const { pathname, search } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/requisitions/, '/inventory')}${search}`} replace />;
}

function NotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="text-[1.3rem] leading-snug">Page Not Found</h1>
      <p className="mt-2 text-sm text-muted">
        The address may be mistyped, or the page has moved.{' '}
        <Link to="/home" className="text-brand underline">
          Go to the home page
        </Link>
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/access-not-configured" element={<AccessNotConfiguredPage />} />
          <Route path="/signed-out" element={<SignedOutPage />} />
          <Route
            index
            element={
              <RequireAuth>
                <LauncherPage />
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="home" element={<HomePage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="team/members" element={<MembersPage />} />
            <Route path="hr" element={need('leave.overview', <HrOverviewPage />)} />
            <Route path="delegation" element={<DelegationsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="reports" element={<ReportsPage listInMenu />} />
            {/* My Leave is now part of My Leave Balances (D135); old links still work. */}
            <Route path="leave" element={<Navigate to="/leave/balances" replace />} />
            <Route path="leave/apply" element={<ApplyPage />} />
            <Route path="leave/policy" element={<LeavePolicyPage />} />
            <Route path="leave/balances" element={<MyBalancesPage />} />
            <Route path="leave/requests/:id" element={<RequestPage />} />
            <Route path="approvals" element={<ManagerApprovalsPage />} />
            <Route path="hr/approvals" element={need('leave.approve_final', <HrApprovalsPage />)} />
            <Route path="people">
              <Route index element={group(<PeopleDashboardPage />)} />
              <Route path="employees" element={group(<DirectoryPage />)} />
              <Route path="employees/:id" element={group(<EmployeeRecordPage />)} />
              <Route path="companies" element={group(<CompanyOverviewPage />)} />
              <Route path="companies/manage" element={need('people.org', <CompaniesPage />)} />
              <Route path="companies/:id" element={group(<CompanyPage />)} />
              <Route path="companies/:companyId/employees" element={group(<DirectoryPage />)} />
              <Route path="companies/:companyId/employees/:id" element={group(<EmployeeRecordPage />)} />
              <Route path="departments" element={group(<DepartmentOverviewPage />)} />
              <Route path="departments/manage" element={need('people.org', <DepartmentsPage />)} />
              <Route path="departments/:id" element={group(<DepartmentPage />)} />
              <Route path="departments/:departmentId/employees" element={group(<DirectoryPage />)} />
              <Route path="departments/:departmentId/employees/:id" element={group(<EmployeeRecordPage />)} />
              <Route path="reports" element={group(<ReportsPage base="/api/people/reports" listInMenu />)} />
              <Route path="import" element={<Navigate to="/people/employees/new?mode=import" replace />} />
              <Route path="branches" element={group(<BranchesPage />)} />
              <Route path="positions" element={need('people.positions', <RolesPage />)} />
              <Route
                path="users"
                element={need('people.users', <AccessUsersPage module="people" base="/people" />)}
              />
              <Route
                path="roles"
                element={need('people.roles', <AccessRolesPage module="people" base="/people" />)}
              />
              <Route path="audit" element={need('people.audit', <AuditTrailPage module="people" />)} />
            </Route>
            <Route path="inventory">
              <Route index element={rqPage(<RequisitionsHomePage />)} />
              <Route path="requests" element={rqPage(<RaiseAndListPage />)} />
              {/* Raising is on the requisitions page now (D139); the old address still works. */}
              <Route path="requests/new" element={<ToPeople base="/inventory/requests" />} />
              <Route path="requests/:id" element={rqPage(<RequisitionPage />)} />
              {/* Links in notifications sent before 17 Nov 2026 went to /requisitions/42 (now /inventory/42). */}
              <Route path=":id" element={<ToPeople base="/inventory/requests" />} />
              <Route path="stock" element={rqPage(<StockPage />, (a) => a.stock)} />
              <Route path="stock/:id" element={rqPage(<ItemPage />, (a) => a.stock)} />
              <Route path="stock/:id/edit" element={rqPage(<ItemFormPage />, (a) => a.itemsManage)} />
              <Route path="receive" element={rqPage(<ReceivePage />, (a) => a.receive)} />
              <Route path="issue" element={rqPage(<IssuePage />, (a) => a.issue)} />
              <Route path="transactions" element={rqPage(<TransactionsPage />, (a) => a.transactions)} />
              <Route path="reports" element={rqPage(<StockReportsPage />, (a) => a.reports)} />
              <Route
                path="categories"
                element={rqPage(<CategoriesPage />, (a) => a.stock || a.categoriesManage)}
              />
              <Route path="branches" element={<Navigate to="/people/branches" replace />} />
              <Route path="settings" element={rqPage(<RequisitionSettingsPage />, (a) => a.orgAdmin)} />
              <Route path="alerts" element={rqPage(<StockAlertsPage />, (a) => a.alertsAdmin)} />
              <Route path="suppliers" element={rqPage(<SuppliersPage />, (a) => a.stock)} />
              <Route
                path="users"
                element={rqPage(
                  <AccessUsersPage module="inventory" base="/inventory" />,
                  (a) => a.usersAdmin,
                )}
              />
              <Route
                path="roles"
                element={rqPage(
                  <AccessRolesPage module="inventory" base="/inventory" />,
                  (a) => a.rolesAdmin,
                )}
              />
              <Route
                path="audit"
                element={rqPage(<AuditTrailPage module="inventory" />, (a) => a.auditAdmin)}
              />
            </Route>
            {/* Recruitment management (D114): open to everyone for Open positions. */}
            <Route path="recruitment">
              <Route index element={<RecruitmentHomePage />} />
              <Route path="requests" element={<HiringRequestsPage />} />
              <Route path="requests/new" element={<HiringRequestFormPage />} />
              <Route path="requests/:id" element={<HiringRequestPage />} />
              <Route path="vacancies" element={<VacanciesPage />} />
              <Route path="vacancies/new" element={need('recruitment.manage', <VacancyFormPage />)} />
              <Route path="vacancies/:id" element={<VacancyPage />} />
              <Route path="vacancies/:id/edit" element={need('recruitment.manage', <VacancyFormPage />)} />
              <Route path="candidates/:id" element={<CandidatePage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="applications" element={<ApplicationsPage />} />
              <Route path="interviews" element={<InterviewsPage />} />
              <Route
                path="users"
                element={need(
                  'recruitment.users',
                  <AccessUsersPage module="recruitment" base="/recruitment" />,
                )}
              />
              <Route
                path="roles"
                element={need(
                  'recruitment.roles',
                  <AccessRolesPage module="recruitment" base="/recruitment" />,
                )}
              />
              <Route
                path="audit"
                element={need('recruitment.audit', <AuditTrailPage module="recruitment" />)}
              />
            </Route>
            {/* Performance management (D115): everyone has their own appraisal. */}
            <Route path="performance">
              <Route index element={<PerformanceHomePage />} />
              <Route path="mine" element={<MyAppraisalsPage />} />
              <Route path="team" element={<TeamAppraisalsPage />} />
              <Route path="appraisals/:id" element={<AppraisalPage />} />
              <Route path="probation" element={<ProbationListPage />} />
              <Route path="probation/:id" element={<ProbationReviewPage />} />
              <Route path="cycles" element={<CyclesPage />} />
              <Route path="cycles/new" element={need('performance.cycles', <CycleFormPage />)} />
              <Route path="cycles/:id" element={<CyclePage />} />
              <Route
                path="users"
                element={need(
                  'performance.users',
                  <AccessUsersPage module="performance" base="/performance" />,
                )}
              />
              <Route
                path="roles"
                element={need(
                  'performance.roles',
                  <AccessRolesPage module="performance" base="/performance" />,
                )}
              />
              <Route
                path="audit"
                element={need('performance.audit', <AuditTrailPage module="performance" />)}
              />
            </Route>
            {/* The Float system (D117, D126): AMS cash and float, its own module. */}
            <Route path="float">
              <Route
                index
                element={floatPage(<FloatDashboardPage />, (r) => r.viewAll || r.admin || r.supervise)}
              />
              <Route
                path="record"
                element={floatPage(<FloatRecordPage />, (r) => r.record || r.supervise || r.admin)}
              />
              <Route path="branch" element={floatPage(<FloatBranchPage />)} />
              <Route
                path="approvals"
                element={floatPage(<FloatApprovalsPage />, (r) => r.supervise || r.director)}
              />
              <Route
                path="variances"
                element={floatPage(<FloatVariancesPage />, (r) => r.viewAll || r.supervise || r.shortages)}
              />
              <Route
                path="transactions"
                element={floatPage(<FloatTransactionsPage />, (r) => r.viewAll || r.record)}
              />
              <Route path="requisitions" element={floatPage(<FloatRequisitionsPage />)} />
              <Route
                path="daily"
                element={floatPage(<FloatDailyPage />, (r) => r.viewAll || r.record || r.supervise)}
              />
              <Route path="branches" element={floatPage(<FloatBranchesPage />, (r) => r.admin)} />
              <Route path="branches/:id" element={floatPage(<FloatBranchAdminPage />, (r) => r.admin)} />
              <Route path="settings" element={floatPage(<FloatSettingsPage />, (r) => r.admin)} />
              <Route path="phone-access" element={floatPage(<FloatPhoneAccessPage />, (r) => r.admin)} />
              <Route
                path="users"
                element={need('float.users', <AccessUsersPage module="float" base="/float" />)}
              />
              <Route
                path="roles"
                element={need('float.roles', <AccessRolesPage module="float" base="/float" />)}
              />
              <Route path="audit" element={need('float.audit', <AuditTrailPage module="float" />)} />
            </Route>
            <Route path="requisitions/float/*" element={<ToFloat />} />
            <Route path="requisitions/*" element={<ToInventory />} />
            <Route path="admin">
              <Route index element={<Navigate to="/people/employees" replace />} />
              <Route path="employees" element={<ToPeople base="/people/employees" />} />
              <Route path="employees/:id" element={<ToPeople base="/people/employees" />} />
              <Route path="sign-in-requests" element={<Navigate to="/people/employees" replace />} />
              <Route path="import" element={<ToPeople base="/people/import" />} />
              <Route
                path="users"
                element={need('leave.users', <AccessUsersPage module="leave" base="/admin" />)}
              />
              <Route
                path="roles"
                element={need('leave.roles', <AccessRolesPage module="leave" base="/admin" />)}
              />
              <Route path="companies" element={<ToPeople base="/people/companies/manage" />} />
              <Route path="departments" element={<ToPeople base="/people/departments/manage" />} />
              <Route path="holidays" element={need('leave.calendar', <HolidaysPage />)} />
              <Route path="schedules" element={need('leave.calendar', <SchedulesPage />)} />
              <Route path="settings" element={need('leave.settings', <SettingsPage />)} />
              <Route path="leave-types" element={need('leave.types', <LeaveTypesPage />)} />
              <Route path="leave-types/:id" element={need('leave.types', <LeaveTypePage />)} />
              <Route path="delegations" element={need('leave.delegations', <AdminDelegationsPage />)} />
              <Route path="emails" element={need('leave.emails', <EmailsPage />)} />
              <Route
                path="notifications"
                element={need('leave.notifications', <NotificationSettingsPage />)}
              />
              <Route path="audit" element={need('leave.audit', <AuditTrailPage module="leave" />)} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
