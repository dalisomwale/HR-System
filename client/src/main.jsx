import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, Link, useParams, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { RequireAuth, RequirePerm } from './lib/auth.jsx';
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
import MyLeavePage, { MyBalancesPage } from './pages/leave/MyLeavePage.jsx';
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
import RequisitionsListPage from './pages/requisitions/RequisitionsListPage.jsx';
import RaisePage from './pages/requisitions/RaisePage.jsx';
import RequisitionPage from './pages/requisitions/RequisitionPage.jsx';
import StockPage from './pages/requisitions/StockPage.jsx';
import ItemPage from './pages/requisitions/ItemPage.jsx';
import ItemFormPage from './pages/requisitions/ItemFormPage.jsx';
import ReceivePage from './pages/requisitions/ReceivePage.jsx';
import IssuePage from './pages/requisitions/IssuePage.jsx';
import TransactionsPage from './pages/requisitions/TransactionsPage.jsx';
import StockReportsPage from './pages/requisitions/StockReportsPage.jsx';
import CategoriesPage from './pages/requisitions/CategoriesPage.jsx';
import BranchesPage from './pages/people/BranchesPage.jsx';
import RequisitionSettingsPage from './pages/requisitions/RequisitionSettingsPage.jsx';
import StockAlertsPage from './pages/requisitions/StockAlertsPage.jsx';
import { FloatBranchPage, FloatRecordPage } from './pages/requisitions/float/FloatEntryPages.jsx';
import FloatRequisitionsPage from './pages/requisitions/float/FloatRequisitionsPage.jsx';
import {
  FloatApprovalsPage,
  FloatDashboardPage,
  FloatTransactionsPage,
  FloatVariancesPage,
} from './pages/requisitions/float/FloatManagePages.jsx';
import {
  FloatBranchAdminPage,
  FloatBranchesPage,
  FloatDailyPage,
  FloatSettingsPage,
} from './pages/requisitions/float/FloatAdminPages.jsx';
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
        <h1 className="text-[1.3rem] leading-snug">You don't have access to this page</h1>
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

function NotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="text-[1.3rem] leading-snug">Page not found</h1>
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
            <Route path="leave" element={<MyLeavePage />} />
            <Route path="leave/apply" element={<ApplyPage />} />
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
            <Route path="requisitions">
              <Route index element={rqPage(<RequisitionsHomePage />)} />
              <Route path="requests" element={rqPage(<RequisitionsListPage />)} />
              <Route path="requests/new" element={rqPage(<RaisePage />, (a) => a.canRaise)} />
              <Route path="requests/:id" element={rqPage(<RequisitionPage />)} />
              {/* Links in notifications sent before 17 Nov 2026 went to /requisitions/42. */}
              <Route path=":id" element={<ToPeople base="/requisitions/requests" />} />
              <Route path="stock" element={rqPage(<StockPage />, (a) => a.stock)} />
              <Route path="stock/new" element={rqPage(<ItemFormPage />, (a) => a.itemsManage)} />
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
              {/* AMS cash and float (D117). */}
              <Route
                path="float"
                element={rqPage(<FloatDashboardPage />, (a) => a.float?.viewAll || a.float?.admin)}
              />
              <Route path="float/record" element={rqPage(<FloatRecordPage />, (a) => a.float?.record)} />
              <Route
                path="float/branch"
                element={rqPage(<FloatBranchPage />, (a) => a.float?.record || a.float?.viewAll)}
              />
              <Route
                path="float/approvals"
                element={rqPage(<FloatApprovalsPage />, (a) => a.float?.supervise || a.float?.director)}
              />
              <Route
                path="float/variances"
                element={rqPage(
                  <FloatVariancesPage />,
                  (a) => a.float?.viewAll || a.float?.approve || a.float?.shortages,
                )}
              />
              <Route
                path="float/transactions"
                element={rqPage(<FloatTransactionsPage />, (a) => a.float?.viewAll || a.float?.record)}
              />
              <Route
                path="float/requisitions"
                element={rqPage(
                  <FloatRequisitionsPage />,
                  (a) =>
                    a.float?.record ||
                    a.float?.supervise ||
                    a.float?.approve ||
                    a.float?.director ||
                    a.float?.viewAll,
                )}
              />
              <Route
                path="float/daily"
                element={rqPage(<FloatDailyPage />, (a) => a.float?.viewAll || a.float?.record)}
              />
              <Route path="float/branches" element={rqPage(<FloatBranchesPage />, (a) => a.float?.admin)} />
              <Route
                path="float/branches/:id"
                element={rqPage(<FloatBranchAdminPage />, (a) => a.float?.admin)}
              />
              <Route path="float/settings" element={rqPage(<FloatSettingsPage />, (a) => a.float?.admin)} />
              <Route
                path="float/phone-access"
                element={rqPage(<FloatPhoneAccessPage />, (a) => a.float?.admin)}
              />
              <Route path="suppliers" element={rqPage(<SuppliersPage />, (a) => a.stock)} />
              <Route
                path="users"
                element={rqPage(
                  <AccessUsersPage module="inventory" base="/requisitions" />,
                  (a) => a.usersAdmin,
                )}
              />
              <Route
                path="roles"
                element={rqPage(
                  <AccessRolesPage module="inventory" base="/requisitions" />,
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
