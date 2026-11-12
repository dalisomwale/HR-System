import { Router } from 'express';
import { requirePerm } from '../../middleware/auth.js';
import { asyncHandler, idParam, pagination } from '../../utils/validation.js';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { AppError } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { toCsv, toXlsx } from '../reports/export-files.js';
import { PEOPLE_REPORTS, findPeopleReport, peopleFilterSchema } from './people-reports.js';
import {
  companiesOverview,
  departmentsOverview,
  employeeHistory,
  employeeOverview,
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
  router.use(requirePerm('people.view'));
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
  // The directory as Excel: every employee matching the same filters as the list, not one page.
  router.get(
    '/employees/export',
    asyncHandler(async (req, res) => {
      const { items } = await listEmployees(db, req.query, { page: 1, pageSize: 100000, offset: 0 });
      const TYPES = { PERMANENT: 'Permanent', FIXED_TERM: 'Fixed-term contract', TEMPORARY: 'Temporary' };
      const columns = [
        { key: 'employeeNumber', label: 'Employee number' },
        { key: 'name', label: 'Employee' },
        { key: 'company', label: 'Company' },
        { key: 'jobTitle', label: 'Job title' },
        { key: 'department', label: 'Department' },
        { key: 'lineManager', label: 'Line manager' },
        { key: 'type', label: 'Employment type' },
        { key: 'email', label: 'Work email' },
        { key: 'started', label: 'Started', type: 'date' },
        { key: 'status', label: 'Status' },
      ];
      const rows = items.map((e) => ({
        employeeNumber: e.employeeNumber,
        name: `${e.firstName} ${e.lastName}`,
        company: e.company,
        jobTitle: e.jobTitle,
        department: e.department,
        lineManager: e.lineManager,
        type: TYPES[e.employmentType] ?? '',
        started: e.employmentStartDate ? String(e.employmentStartDate).slice(0, 10) : null,
        status: e.status === 'ACTIVE' ? 'Active' : 'Left',
        email: e.email,
      }));
      await writeAudit(db, {
        ...auditContext(req),
        action: 'REPORT_EXPORTED',
        entityType: 'report',
        entityId: 'people-employees',
        after: { format: 'xlsx', rows: rows.length, filters: req.query },
      });
      const file = toXlsx(columns, rows, { sheetName: 'Employees', title: 'Employees' });
      res
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .attachment(`Employees ${todayInLusaka()}.xlsx`)
        .send(file);
    }),
  );
  router.get(
    '/quick-filters',
    asyncHandler(async (req, res) => {
      res.json(await quickFilterCounts(db, companyOf(req), Number(req.query.departmentId) || null));
    }),
  );
  router.get(
    '/employees/:id',
    asyncHandler(async (req, res) => {
      res.json(await employeeRecord(db, idParam(req)));
    }),
  );
  router.get(
    '/employees/:id/overview',
    asyncHandler(async (req, res) => {
      res.json(await employeeOverview(db, idParam(req)));
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
  router.get(
    '/companies-overview',
    asyncHandler(async (req, res) => {
      res.json(await companiesOverview(db));
    }),
  );
  router.get(
    '/departments-overview',
    asyncHandler(async (req, res) => {
      res.json(await departmentsOverview(db, companyOf(req)));
    }),
  );

  // Reports (D53): same shape as the leave reports, so the same screen runs and exports them.
  router.get(
    '/reports',
    asyncHandler(async (req, res) => {
      const companies = await db('companies').orderBy('name').select('id', 'name');
      const departments = await db('departments as d')
        .leftJoin('companies as c', 'c.id', 'd.company_id')
        .orderBy([{ column: 'c.name' }, { column: 'd.name' }])
        .select('d.id', 'd.name', 'd.company_id as companyId', 'c.name as company');
      res.json({
        scope: 'HR',
        items: PEOPLE_REPORTS.map(({ id, title, description, filters }) => ({
          id,
          title,
          description,
          filters,
        })),
        options: { companies, departments, employees: [], leaveTypes: [], statuses: [], entryTypes: [] },
      });
    }),
  );
  router.get(
    '/reports/:id',
    asyncHandler(async (req, res) => {
      const report = findPeopleReport(req.params.id);
      const rows = await report.run(db, peopleFilterSchema.parse(req.query));
      res.json({
        id: report.id,
        title: report.title,
        columns: report.columns,
        rows: rows.slice(0, 500),
        total: rows.length,
      });
    }),
  );
  const exportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `people-export-${req.user.id}`,
    handler: (req, res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many exports. Wait a few minutes and try again.')),
  });
  router.get(
    '/reports/:id/export',
    exportLimiter,
    asyncHandler(async (req, res) => {
      const report = findPeopleReport(req.params.id);
      const format = z.enum(['csv', 'xlsx']).catch('csv').parse(req.query.format);
      const filters = peopleFilterSchema.parse(req.query);
      const rows = await report.run(db, filters);
      const file =
        format === 'xlsx'
          ? toXlsx(report.columns, rows, { sheetName: report.title, title: report.title })
          : toCsv(report.columns, rows);
      await writeAudit(db, {
        ...auditContext(req),
        action: 'REPORT_EXPORTED',
        entityType: 'report',
        entityId: `people-${report.id}`,
        after: {
          format,
          rows: rows.length,
          filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
        },
      });
      res
        .set({
          'Content-Type':
            format === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="altus-${report.id}-${todayInLusaka()}.${format}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(file);
    }),
  );

  return router;
}
