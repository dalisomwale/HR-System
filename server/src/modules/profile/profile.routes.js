import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/validation.js';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';

/*
 * The signed-in employee's own record. Never takes an employee ID from the client.
 * Employees may change only their personal details (D48); job, company, department, manager
 * and dates are kept by HR because they decide approvals and entitlement.
 */

const text = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const phone = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null)
  .refine(
    (v) => v === null || /^\+?[0-9][0-9 ()-]{5,24}$/.test(v),
    'must be a phone number, e.g. +260 97 1234567',
  );

export const personalSchema = z
  .object({
    mobilePhone: phone,
    personalEmail: z
      .string()
      .trim()
      .toLowerCase()
      .nullish()
      .transform((v) => v || null)
      .refine(
        (v) => v === null || z.string().email().max(254).safeParse(v).success,
        'must be a valid email address',
      ),
    homeAddress: text(500),
    emergencyContactName: text(160),
    emergencyContactRelationship: text(60),
    emergencyContactPhone: phone,
  })
  .strict();

export const PERSONAL_COLUMNS = {
  mobilePhone: 'mobile_phone',
  personalEmail: 'personal_email',
  homeAddress: 'home_address',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactRelationship: 'emergency_contact_relationship',
  emergencyContactPhone: 'emergency_contact_phone',
};

export const personalOf = (row) =>
  Object.fromEntries(Object.entries(PERSONAL_COLUMNS).map(([k, col]) => [k, row[col] ?? null]));

export function profileRoutes({ db }) {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const e = await db('employees as e')
        .leftJoin('companies as c', 'c.id', 'e.company_id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .leftJoin('employees as m', 'm.id', 'e.line_manager_id')
        .leftJoin('work_schedules as w', 'w.id', 'e.work_schedule_id')
        .where('e.id', req.user.id)
        .first(
          'e.*',
          'c.name as company',
          'd.name as department',
          'm.first_name as manager_first',
          'm.last_name as manager_last',
          'w.name as schedule',
        );
      res.json({
        employeeNumber: e.employee_number,
        firstName: e.first_name,
        lastName: e.last_name,
        email: e.email,
        jobTitle: e.job_title,
        company: e.company,
        department: e.department,
        lineManager: e.manager_first ? `${e.manager_first} ${e.manager_last}` : null,
        workSchedule: e.schedule,
        employmentStartDate: e.employment_start_date,
        roles: req.user.roles,
        personal: personalOf(e),
      });
    }),
  );

  router.patch(
    '/personal',
    asyncHandler(async (req, res) => {
      const input = personalSchema.parse(req.body ?? {});
      await db.transaction(async (trx) => {
        const before = await trx('employees').where({ id: req.user.id }).forUpdate().first();
        const row = Object.fromEntries(Object.entries(input).map(([k, v]) => [PERSONAL_COLUMNS[k], v]));
        if (Object.keys(row).length) await trx('employees').where({ id: req.user.id }).update(row);
        const changed = Object.keys(input).filter((k) => (before[PERSONAL_COLUMNS[k]] ?? null) !== input[k]);
        if (changed.length) {
          // Field names only: personal details themselves are not copied into the audit log.
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'PERSONAL_DETAILS_UPDATED',
            entityType: 'employee',
            entityId: req.user.id,
            after: { fields: changed },
          });
        }
      });
      res.json({ ok: true });
    }),
  );
  return router;
}
