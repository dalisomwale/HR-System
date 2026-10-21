import express, { Router } from 'express';
import { z } from 'zod';
import { auditContext, requireRole } from '../../middleware/auth.js';
import { asyncHandler, idParam, isoDate, optionalText, pagination } from '../../utils/validation.js';
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
import { employeeRecord, listEmployees } from '../people/people.service.js';

const deactivateSchema = z.object({
  reason: optionalText(500),
  endDate: isoDate.nullish(),
});
const importSchema = z.object({ csv: z.string().min(1, 'is required').max(2_000_000) });

export function employeeRoutes({ db, config }) {
  const router = Router();
  // Microsoft account links, roles and deactivation are for System Administrators only (D46).
  const adminOnly = requireRole('HR_ADMIN');
  const tenantId = config.entra.tenantId;
  const tx = (fn) =>
    db.transaction(fn).catch((err) => {
      throw mapEmployeeUniqueError(err);
    });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await listEmployees(db, req.query, pagination(req.query, { maxSize: 500 })));
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
      res.json(await employeeRecord(db, idParam(req)));
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
    adminOnly,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = deactivateSchema.parse(req.body ?? {});
      await tx((trx) => deactivateEmployee(trx, id, input, auditContext(req)));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/:id/reactivate',
    adminOnly,
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
