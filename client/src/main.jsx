import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, Link, useParams, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { GROUP_VIEW_ROLES, RequireAuth, RequireRole } from './lib/auth.jsx';
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
import SignInRequestsPage from './pages/admin/SignInRequestsPage.jsx';
import ImportPage from './pages/admin/ImportPage.jsx';
import LeaveTypePage from './pages/admin/LeaveTypePage.jsx';
import RolesPage from './pages/admin/RolesPage.jsx';
import CompaniesPage from './pages/admin/CompaniesPage.jsx';
import DepartmentsPage from './pages/admin/DepartmentsPage.jsx';
import HolidaysPage from './pages/admin/HolidaysPage.jsx';
import SchedulesPage from './pages/admin/SchedulesPage.jsx';
import SettingsPage from './pages/admin/SettingsPage.jsx';
import AuditPage from './pages/admin/AuditPage.jsx';
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
import ReportsPage from './pages/reports/ReportsPage.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => err?.status >= 500 && count < 2, refetchOnWindowFocus: false },
  },
});

const admin = (el) => <RequireRole role="HR_ADMIN">{el}</RequireRole>;
const hr = (el) => <RequireRole role="HR_OFFICER">{el}</RequireRole>;
const group = (el) => <RequireRole role={GROUP_VIEW_ROLES}>{el}</RequireRole>;

/** Old addresses from before Employee management (D52) keep working. */
function ToPeople({ base }) {
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={`${base}${id ? `/${id}` : ''}${search}`} replace />;
}

function NotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold">Page not found</h1>
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
            <Route path="hr" element={group(<HrOverviewPage />)} />
            <Route path="delegation" element={<DelegationsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="leave" element={<MyLeavePage />} />
            <Route path="leave/apply" element={<ApplyPage />} />
            <Route path="leave/balances" element={<MyBalancesPage />} />
            <Route path="leave/requests/:id" element={<RequestPage />} />
            <Route path="approvals" element={<ManagerApprovalsPage />} />
            <Route path="hr/approvals" element={hr(<HrApprovalsPage />)} />
            <Route path="people">
              <Route index element={group(<PeopleDashboardPage />)} />
              <Route path="employees" element={group(<DirectoryPage />)} />
              <Route path="employees/:id" element={group(<EmployeeRecordPage />)} />
              <Route path="companies" element={group(<CompanyOverviewPage />)} />
              <Route path="companies/manage" element={hr(<CompaniesPage />)} />
              <Route path="companies/:id" element={group(<CompanyPage />)} />
              <Route path="companies/:companyId/employees" element={group(<DirectoryPage />)} />
              <Route path="companies/:companyId/employees/:id" element={group(<EmployeeRecordPage />)} />
              <Route path="departments" element={group(<DepartmentOverviewPage />)} />
              <Route path="departments/manage" element={hr(<DepartmentsPage />)} />
              <Route path="departments/:id" element={group(<DepartmentPage />)} />
              <Route path="departments/:departmentId/employees" element={group(<DirectoryPage />)} />
              <Route path="departments/:departmentId/employees/:id" element={group(<EmployeeRecordPage />)} />
              <Route path="reports" element={group(<ReportsPage base="/api/people/reports" listInMenu />)} />
              <Route path="import" element={hr(<ImportPage />)} />
            </Route>
            <Route path="admin">
              <Route index element={<Navigate to="/people/employees" replace />} />
              <Route path="employees" element={<ToPeople base="/people/employees" />} />
              <Route path="employees/:id" element={<ToPeople base="/people/employees" />} />
              <Route path="sign-in-requests" element={admin(<SignInRequestsPage />)} />
              <Route path="import" element={<ToPeople base="/people/import" />} />
              <Route path="roles" element={admin(<RolesPage />)} />
              <Route path="companies" element={<ToPeople base="/people/companies/manage" />} />
              <Route path="departments" element={<ToPeople base="/people/departments/manage" />} />
              <Route path="holidays" element={hr(<HolidaysPage />)} />
              <Route path="schedules" element={hr(<SchedulesPage />)} />
              <Route path="settings" element={admin(<SettingsPage />)} />
              <Route path="leave-types" element={hr(<LeaveTypesPage />)} />
              <Route path="leave-types/:id" element={hr(<LeaveTypePage />)} />
              <Route path="delegations" element={hr(<AdminDelegationsPage />)} />
              <Route path="emails" element={admin(<EmailsPage />)} />
              <Route path="audit" element={admin(<AuditPage />)} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
