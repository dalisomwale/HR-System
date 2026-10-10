import { Router } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { departmentRoutes } from './departments.routes.js';
import { employeeRoutes } from './employees.routes.js';
import { holidayRoutes, scheduleRoutes } from './calendar.routes.js';
import { settingsRoutes, auditRoutes } from './settings.routes.js';
import { leaveTypeRoutes, jobRoutes } from './leave-types.routes.js';
import { adminDelegationRoutes } from '../delegations/delegations.routes.js';

/** HR Administration API. Every route requires the HR_ADMIN role. */
export function adminRoutes(deps) {
  const router = Router();
  router.use(requireRole('HR_ADMIN'));
  router.use('/departments', departmentRoutes(deps));
  router.use('/employees', employeeRoutes(deps));
  router.use('/holidays', holidayRoutes(deps));
  router.use('/work-schedules', scheduleRoutes(deps));
  router.use('/settings', settingsRoutes(deps));
  router.use('/audit', auditRoutes(deps));
  router.use('/leave-types', leaveTypeRoutes(deps));
  router.use('/jobs', jobRoutes(deps));
  router.use('/delegations', adminDelegationRoutes(deps));
  return router;
}
