import express, { Router } from 'express';
import { z } from 'zod';
import { auditContext, requireRole } from '../../middleware/auth.js';
import { asyncHandler, idParam, isoDate, optionalText, pagination } from '../../utils/validation.js';
import { notFound } from '../../utils/errors.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  reactivateEmployee,
  linkIdentitySchema,
  linkIdentity,
  unlinkIdentity,
  setRolesSchema,
  setRoles,
  mapEmployeeUniqueError,
  pendingSignIns,
} from './employees.service.js';
import { validateImport, commitImport, IMPORT_COLUMNS } from './employees.import.js';

const deactivateSchema = z.object({
  reason: optionalText(500),
  endDate: isoDate.nullish(),
});
const importSchema = z.object({ csv: z.string().min(1, 'is required').max(2_000_000) });

export function employeeRoutes({ db, config }) {
  const router = Router();
  // Microsoft account links and roles are for System Administrators only (D46).
  const adminOnly = requireRole('HR_ADMIN');
  const tenantId = config.entra.tenantId;
  const tx = (fn) =>
    db.transaction(fn).catch((err) => {
      throw mapEmployeeUniqueError(err);
    });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { page, pageSize, offset } = pagination(req.query, { maxSize: 500 });
      const q = db('employees as e')
        .leftJoin('companies as c', 'c.id', 'e.company_id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .leftJoin('employees as m', 'm.id', 'e.line_manager_id')
        .leftJoin('identity_links as l', 'l.employee_id', 'e.id');
      const search = String(req.query.search ?? '').trim();
      if (search) {
        const like = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
        q.where((w) =>
          w
            .where('e.first_name', 'like', like)
            .orWhere('e.last_name', 'like', like)
            .orWhere('e.employee_number', 'like', like)
            .orWhere('e.email', 'like', like)
            .orWhereRaw("CONCAT(e.first_name, ' ', e.last_name) LIKE ?", [like]),
        );
      }
      if (['ACTIVE', 'INACTIVE'].includes(req.query.status)) q.where('e.status', req.query.status);
      if (req.query.companyId === 'none') q.whereNull('e.company_id');
      else if (req.query.companyId) q.where('e.company_id', Number(req.query.companyId) || 0);
      if (req.query.departmentId) q.where('e.department_id', Number(req.query.departmentId) || 0);
      if (req.query.linked === 'false') q.whereNull('l.id');
      if (req.query.linked === 'true') q.whereNotNull('l.id');

      const { total } = await q.clone().count({ total: '*' }).first();
      const rows = await q
        .select(
          'e.id',
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'e.email',
          'e.job_title',
          'e.status',
          'c.name as company_name',
          'd.name as department_name',
          'm.first_name as manager_first',
          'm.last_name as manager_last',
          db.raw('l.id IS NOT NULL as linked'),
        )
        .orderBy([{ column: 'e.last_name' }, { column: 'e.first_name' }])
        .limit(pageSize)
        .offset(offset);
      const ids = rows.map((r) => r.id);
      const roleRows = ids.length
        ? await db('employee_roles as er')
            .join('roles as r', 'r.id', 'er.role_id')
            .whereIn('er.employee_id', ids)
            .select('er.employee_id', 'r.code')
        : [];
      res.json({
        total: Number(total),
        page,
        pageSize,
        items: rows.map((r) => ({
          id: r.id,
          employeeNumber: r.employee_number,
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          jobTitle: r.job_title,
          status: r.status,
          company: r.company_name,
          department: r.department_name,
          lineManager: r.manager_first ? `${r.manager_first} ${r.manager_last}` : null,
          linked: Boolean(r.linked),
          roles: roleRows.filter((x) => x.employee_id === r.id).map((x) => x.code),
        })),
      });
    }),
  );

  // Lightweight list for pickers (manager, etc.).
  router.get(
    '/options',
    asyncHandler(async (req, res) => {
      const rows = await db('employees')
        .where({ status: 'ACTIVE' })
        .orderBy(['last_name', 'first_name'])
        .select('id', 'employee_number', 'first_name', 'last_name');
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          label: `${r.first_name} ${r.last_name} (${r.employee_number})`,
        })),
      });
    }),
  );

  router.get(
    '/pending-sign-ins',
    adminOnly,
    asyncHandler(async (req, res) => {
      res.json({ items: await pendingSignIns(db, tenantId), signInConfigured: Boolean(tenantId) });
    }),
  );

  router.get('/import/template', (req, res) => {
    res
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="employee-import-template.csv"')
      .send(`${IMPORT_COLUMNS.join(',')}\r\n`);
  });

  router.post(
    '/import/preview',
    express.json({ limit: '2mb' }),
    asyncHandler(async (req, res) => {
      const { csv } = importSchema.parse(req.body);
      // eslint-disable-next-line no-unused-vars
      const { _rows, _newDepartments, _adoptions, ...result } = await validateImport(db, csv);
      res.json(result);
    }),
  );

  router.post(
    '/import/commit',
    express.json({ limit: '2mb' }),
    asyncHandler(async (req, res) => {
      const { csv } = importSchema.parse(req.body);
      res.status(201).json(await commitImport(db, csv, auditContext(req)));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const e = await db('employees as e')
        .leftJoin('companies as c', 'c.id', 'e.company_id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .leftJoin('employees as m', 'm.id', 'e.line_manager_id')
        .leftJoin('work_schedules as w', 'w.id', 'e.work_schedule_id')
        .where('e.id', id)
        .first(
          'e.*',
          'c.name as company_name',
          'd.name as department_name',
          'm.first_name as manager_first',
          'm.last_name as manager_last',
          'm.employee_number as manager_number',
          'w.name as schedule_name',
        );
      if (!e) throw notFound('Employee not found.');
      const link = await db('identity_links').where({ employee_id: id }).first();
      const roles = await db('employee_roles as er')
        .join('roles as r', 'r.id', 'er.role_id')
        .where('er.employee_id', id)
        .pluck('r.code');
      const reports = await db('employees')
        .where({ line_manager_id: id, status: 'ACTIVE' })
        .orderBy(['last_name', 'first_name'])
        .select('id', 'first_name', 'last_name', 'employee_number');
      res.json({
        id: e.id,
        employeeNumber: e.employee_number,
        firstName: e.first_name,
        lastName: e.last_name,
        email: e.email,
        jobTitle: e.job_title,
        sex: e.sex,
        companyId: e.company_id,
        company: e.company_name,
        departmentId: e.department_id,
        department: e.department_name,
        lineManagerId: e.line_manager_id,
        lineManager: e.manager_first ? `${e.manager_first} ${e.manager_last} (${e.manager_number})` : null,
        workScheduleId: e.work_schedule_id,
        workSchedule: e.schedule_name,
        employmentStartDate: e.employment_start_date,
        employmentEndDate: e.employment_end_date,
        status: e.status,
        deactivatedAt: e.deactivated_at,
        roles,
        identity: link
          ? {
              objectId: link.object_id,
              email: link.email_at_link,
              linkedVia: link.linked_via,
              linkedAt: link.linked_at,
              lastSignInAt: link.last_sign_in_at,
            }
          : null,
        directReports: reports.map((r) => ({
          id: r.id,
          name: `${r.first_name} ${r.last_name}`,
          employeeNumber: r.employee_number,
        })),
      });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = createEmployeeSchema.parse(req.body);
      const id = await tx((trx) => createEmployee(trx, input, auditContext(req)));
      res.status(201).json({ id });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = updateEmployeeSchema.parse(req.body);
      await tx((trx) => updateEmployee(trx, id, input, auditContext(req)));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/:id/deactivate',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = deactivateSchema.parse(req.body ?? {});
      await tx((trx) => deactivateEmployee(trx, id, input, auditContext(req)));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/:id/reactivate',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await tx((trx) => reactivateEmployee(trx, id, auditContext(req)));
      res.json({ ok: true });
    }),
  );

  router.put(
    '/:id/identity',
    adminOnly,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = linkIdentitySchema.parse(req.body);
      await tx((trx) => linkIdentity(trx, id, input, tenantId, auditContext(req)));
      res.json({ ok: true });
    }),
  );

  router.delete(
    '/:id/identity',
    adminOnly,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await tx((trx) => unlinkIdentity(trx, id, auditContext(req)));
      res.json({ ok: true });
    }),
  );

  router.put(
    '/:id/roles',
    adminOnly,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const { roles } = setRolesSchema.parse(req.body);
      await tx((trx) => setRoles(trx, id, roles, auditContext(req)));
      res.json({ ok: true });
    }),
  );

  return router;
}
