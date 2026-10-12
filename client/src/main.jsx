import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, Link } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { RequireAuth, RequireRole } from './lib/auth.jsx';
import AppShell from './layouts/AppShell.jsx';
import { SignInPage, AccessNotConfiguredPage, SignedOutPage } from './pages/auth/PublicPages.jsx';
import ProfilePage from './pages/employee/ProfilePage.jsx';
import EmployeesPage from './pages/admin/EmployeesPage.jsx';
import EmployeePage from './pages/admin/EmployeePage.jsx';
import SignInRequestsPage from './pages/admin/SignInRequestsPage.jsx';
import ImportPage from './pages/admin/ImportPage.jsx';
import RolesPage from './pages/admin/RolesPage.jsx';
import CompaniesPage from './pages/admin/CompaniesPage.jsx';
import DepartmentsPage from './pages/admin/DepartmentsPage.jsx';
import HolidaysPage from './pages/admin/HolidaysPage.jsx';
import SchedulesPage from './pages/admin/SchedulesPage.jsx';
import SettingsPage from './pages/admin/SettingsPage.jsx';
import AuditPage from './pages/admin/AuditPage.jsx';
import LeaveTypesPage from './pages/admin/LeaveTypesPage.jsx';
import MyLeavePage from './pages/leave/MyLeavePage.jsx';
import ApplyPage from './pages/leave/ApplyPage.jsx';
import RequestPage from './pages/leave/RequestPage.jsx';
import { ManagerApprovalsPage, HrApprovalsPage } from './pages/approvals/ApprovalsPages.jsx';
import HomePage from './pages/home/HomePage.jsx';
import TeamPage from './pages/home/TeamPage.jsx';
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
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="home" element={<HomePage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="hr" element={hr(<HrOverviewPage />)} />
            <Route path="delegation" element={<DelegationsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="leave" element={<MyLeavePage />} />
            <Route path="leave/apply" element={<ApplyPage />} />
            <Route path="leave/requests/:id" element={<RequestPage />} />
            <Route path="approvals" element={<ManagerApprovalsPage />} />
            <Route path="hr/approvals" element={hr(<HrApprovalsPage />)} />
            <Route path="admin">
              <Route index element={<Navigate to="/admin/employees" replace />} />
              <Route path="employees" element={admin(<EmployeesPage />)} />
              <Route path="employees/:id" element={admin(<EmployeePage />)} />
              <Route path="sign-in-requests" element={admin(<SignInRequestsPage />)} />
              <Route path="import" element={admin(<ImportPage />)} />
              <Route path="roles" element={admin(<RolesPage />)} />
              <Route path="companies" element={admin(<CompaniesPage />)} />
              <Route path="departments" element={admin(<DepartmentsPage />)} />
              <Route path="holidays" element={admin(<HolidaysPage />)} />
              <Route path="schedules" element={admin(<SchedulesPage />)} />
              <Route path="settings" element={admin(<SettingsPage />)} />
              <Route path="leave-types" element={admin(<LeaveTypesPage />)} />
              <Route path="delegations" element={admin(<AdminDelegationsPage />)} />
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
