import { Router } from 'express';
import { z } from 'zod';
import { auditContext } from '../../middleware/auth.js';
import { asyncHandler, idParam } from '../../utils/validation.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { ASSIGNABLE_ROLES, mapEmployeeUniqueError, setRoles, updateEmployee } from './employees.service.js';

/*
 * Roles in one place. HR Officer and HR Administrator are granted roles; "Manager" is not a
 * stored role: anyone with direct reports is a manager, so making someone a manager means giving
 * them direct reports.
 */

const holderSchema = z.object({ employeeId: z.coerce.number().int().positive() });
const reportsSchema = z.object({
  managerId: z.coerce.number().int().positive(),
  employeeIds: z.array(z.coerce.number().int().positive()).min(1, 'choose at least one person').max(500),
});

function person(r) {
  return {
    id: r.id,
    name: `${r.first_name} ${r.last_name}`,
    employeeNumber: r.employee_number,
    jobTitle: r.job_title,
    company: r.company_name ?? null,
  };
}

function roleCode(req) {
  const code = String(req.params.code ?? '').toUpperCase();
  if (!ASSIGNABLE_ROLES.includes(code)) throw notFound('Role not found.');
  return code;
}

export function roleRoutes({ db }) {
  const router = Router();
  const tx = (fn) =>
    db.transaction(fn).catch((err) => {
      throw mapEmployeeUniqueError(err);
    });
  const people = () =>
    db('employees as e')
      .leftJoin('companies as c', 'c.id', 'e.company_id')
      .where('e.status', 'ACTIVE')
      .orderBy(['e.last_name', 'e.first_name']);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const roles = await db('roles').whereIn('code', ASSIGNABLE_ROLES).select('code', 'name', 'description');
      const holders = await people()
        .join('employee_roles as er', 'er.employee_id', 'e.id')
        .join('roles as r', 'r.id', 'er.role_id')
        .select('e.*', 'c.name as company_name', 'r.code as role_code');
      const managers = await people()
        .whereExists((q) =>
          q
            .select(db.raw(1))
            .from('employees as x')
            .whereRaw('x.line_manager_id = e.id')
            .andWhere('x.status', 'ACTIVE'),
        )
        .select('e.*', 'c.name as company_name');
      const reports = managers.length
        ? await db('employees')
            .whereIn(
              'line_manager_id',
              managers.map((m) => m.id),
            )
            .andWhere('status', 'ACTIVE')
            .orderBy(['last_name', 'first_name'])
            .select('id', 'first_name', 'last_name', 'employee_number', 'line_manager_id')
        : [];
      res.json({
        roles: ASSIGNABLE_ROLES.map((code) => {
          const r = roles.find((x) => x.code === code);
          return {
            code,
            name: r?.name ?? code,
            description: r?.description ?? '',
            holders: holders.filter((h) => h.role_code === code).map(person),
          };
        }),
        managers: managers.map((m) => ({
          ...person(m),
          reports: reports
            .filter((r) => r.line_manager_id === m.id)
            .map((r) => ({
              id: r.id,
              name: `${r.first_name} ${r.last_name}`,
              employeeNumber: r.employee_number,
            })),
        })),
      });
    }),
  );

  const currentRoles = (trx, employeeId) =>
    trx('employee_roles as er')
      .join('roles as r', 'r.id', 'er.role_id')
      .where('er.employee_id', employeeId)
      .pluck('r.code');

  router.post(
    '/:code/holders',
    asyncHandler(async (req, res) => {
      const code = roleCode(req);
      const { employeeId } = holderSchema.parse(req.body);
      await tx(async (trx) => {
        const current = await currentRoles(trx, employeeId);
        if (!current.includes(code)) await setRoles(trx, employeeId, [...current, code], auditContext(req));
      });
      res.status(201).json({ ok: true });
    }),
  );

  router.delete(
    '/:code/holders/:id',
    asyncHandler(async (req, res) => {
      const code = roleCode(req);
      const employeeId = idParam(req);
      await tx(async (trx) => {
        const current = await currentRoles(trx, employeeId);
        if (current.includes(code)) {
          await setRoles(
            trx,
            employeeId,
            current.filter((r) => r !== code),
            auditContext(req),
          );
        }
      });
      res.json({ ok: true });
    }),
  );

  // Make someone a manager by giving them direct reports (each change is checked and audited).
  router.post(
    '/manager/reports',
    asyncHandler(async (req, res) => {
      const { managerId, employeeIds } = reportsSchema.parse(req.body);
      if (employeeIds.includes(managerId)) throw badRequest('A manager cannot report to themselves.');
      await tx(async (trx) => {
        for (const id of [...new Set(employeeIds)]) {
          await updateEmployee(trx, id, { lineManagerId: managerId }, auditContext(req));
        }
      });
      res.status(201).json({ ok: true });
    }),
  );

  // Remove one direct report from their manager (they are left with no manager).
  router.delete(
    '/manager/reports/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await tx((trx) => updateEmployee(trx, id, { lineManagerId: null }, auditContext(req)));
      res.json({ ok: true });
    }),
  );

  return router;
}
