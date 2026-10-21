import { Router } from 'express';
import { GROUP_VIEW_ROLES, requireRole } from '../../middleware/auth.js';
import { asyncHandler, idParam, pagination } from '../../utils/validation.js';
import {
  employeeHistory,
  employeeRecord,
  listEmployees,
  peopleDashboard,
  quickFilterCounts,
} from './people.service.js';

/**
 * Employee management API (D52). HR Officers, System Administrators and directors read the
 * central employee record here; changes go through /api/admin/employees, which HR Officers use.
 */
export function peopleRoutes({ db }) {
  const router = Router();
  router.use(requireRole(...GROUP_VIEW_ROLES));
  const companyOf = (req) => Number(req.query.companyId) || null;

  router.get(
    '/dashboard',
    asyncHandler(async (req, res) => {
      res.json(await peopleDashboard(db, companyOf(req)));
    }),
  );
  // Companies and departments for the directory filters (directors cannot use /api/admin).
  router.get(
    '/organisation',
    asyncHandler(async (req, res) => {
      const companies = await db('companies').orderBy('name').select('id', 'name', 'is_active');
      const departments = await db('departments')
        .orderBy('name')
        .select('id', 'name', 'company_id', 'is_active');
      const none = await db('employees').whereNull('company_id').first('id');
      res.json({
        companies: companies.map((c) => ({ id: c.id, name: c.name, isActive: Boolean(c.is_active) })),
        departments: departments.map((d) => ({
          id: d.id,
          name: d.name,
          companyId: d.company_id,
          isActive: Boolean(d.is_active),
        })),
        employeesWithoutCompany: Boolean(none),
      });
    }),
  );
  router.get(
    '/employees',
    asyncHandler(async (req, res) => {
      res.json(await listEmployees(db, req.query, pagination(req.query, { maxSize: 500 })));
    }),
  );
  router.get(
    '/quick-filters',
    asyncHandler(async (req, res) => {
      res.json(await quickFilterCounts(db, companyOf(req)));
    }),
  );
  router.get(
    '/employees/:id',
    asyncHandler(async (req, res) => {
      res.json(await employeeRecord(db, idParam(req)));
    }),
  );
  router.get(
    '/employees/:id/history',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await employeeRecord(db, id);
      res.json({ items: await employeeHistory(db, id) });
    }),
  );
  return router;
}
