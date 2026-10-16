import { Router } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { companyRoutes } from './companies.routes.js';
import { roleRoutes } from './roles.routes.js';
import { departmentRoutes } from './departments.routes.js';
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
  const hr = requireRole('HR_OFFICER');
  const admin = requireRole('HR_ADMIN');
  router.use('/companies', hr, companyRoutes(deps));
  router.use('/departments', hr, departmentRoutes(deps));
  router.use('/employees', hr, employeeRoutes(deps));
  router.use('/holidays', hr, holidayRoutes(deps));
  router.use('/work-schedules', hr, scheduleRoutes(deps));
  router.use('/leave-types', hr, leaveTypeRoutes(deps));
  router.use('/jobs', hr, jobRoutes(deps));
  router.use('/delegations', hr, adminDelegationRoutes(deps));
  router.use('/roles', admin, roleRoutes(deps));
  router.use('/settings', admin, settingsRoutes(deps));
  router.use('/audit', admin, auditRoutes(deps));
  router.use('/emails', admin, adminEmailRoutes(deps));
  // Anything else under /api/admin is for System Administrators.
  router.use(admin);
  return router;
}
