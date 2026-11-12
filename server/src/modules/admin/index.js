import { Router } from 'express';
import { requirePerm, requireRole } from '../../middleware/auth.js';
import { companyRoutes } from './companies.routes.js';
import { roleRoutes } from './roles.routes.js';
import { departmentRoutes } from './departments.routes.js';
import { branchRoutes } from '../org/branches.routes.js';
import { employeeRoutes } from './employees.routes.js';
import { holidayRoutes, scheduleRoutes } from './calendar.routes.js';
import { settingsRoutes, auditRoutes } from './settings.routes.js';
import { leaveTypeRoutes, jobRoutes } from './leave-types.routes.js';
import { adminDelegationRoutes } from '../delegations/delegations.routes.js';
import { adminEmailRoutes } from '../notifications/notifications.routes.js';

/**
 * Administration API (decision D46).
 * HR Officers (and System Administrators, who hold every HR Officer right) look after the
 * organisation and leave setup: employees and imports, companies, departments, leave types and
 * balance jobs, delegations, public holidays and working schedules.
 * Only System Administrators manage roles, Microsoft account links, workflow settings, the
 * email outbox and the audit log. Employee routes check the admin-only actions themselves.
 */
export function adminRoutes(deps) {
  const router = Router();
  // Each part opens to the access right that covers it (D108).
  const admin = requireRole('HR_ADMIN');
  router.use('/companies', requirePerm('people.org'), companyRoutes(deps));
  router.use('/departments', requirePerm('people.org'), departmentRoutes(deps));
  // Branches (D109): seen with Employees: View, changed with Organisation: Manage.
  router.use('/branches', requirePerm('people.view', 'people.org'), branchRoutes(deps));
  router.use('/employees', requirePerm('people.edit', 'people.positions'), employeeRoutes(deps));
  router.use('/holidays', requirePerm('leave.calendar'), holidayRoutes(deps));
  router.use('/work-schedules', requirePerm('leave.calendar'), scheduleRoutes(deps));
  router.use('/leave-types', requirePerm('leave.types'), leaveTypeRoutes(deps));
  router.use('/jobs', requirePerm('leave.types'), jobRoutes(deps));
  router.use('/delegations', requirePerm('leave.delegations'), adminDelegationRoutes(deps));
  router.use('/roles', requirePerm('people.positions'), roleRoutes(deps));
  router.use('/settings', requirePerm('leave.settings'), settingsRoutes(deps));
  router.use('/audit', requirePerm('leave.audit', 'people.audit', 'admin.audit'), auditRoutes(deps));
  router.use('/emails', requirePerm('leave.emails'), adminEmailRoutes(deps));
  // Anything else under /api/admin is for System Administrators.
  router.use(admin);
  return router;
}
