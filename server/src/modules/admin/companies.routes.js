import { Router } from 'express';
import { z } from 'zod';
import { writeAudit } from '../audit/audit.service.js';
import { auditContext } from '../../middleware/auth.js';
import { asyncHandler, idParam, requiredText } from '../../utils/validation.js';
import { conflict, notFound } from '../../utils/errors.js';

/** Companies in the Altus Group. Every employee and department belongs to one. */

const createSchema = z.object({
  code: requiredText(20).transform((s) => s.toUpperCase()),
  name: requiredText(160),
});
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

function toDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: Boolean(row.is_active),
    activeEmployees: Number(row.active_employees ?? 0),
    departments: Number(row.department_count ?? 0),
  };
}

function mapUnique(err) {
  if (err?.code === 'ER_DUP_ENTRY') return conflict('A company with this code or name already exists.');
  return err;
}

export function companyRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = await db('companies as c')
        .select(
          'c.*',
          db('employees')
            .count('*')
            .whereRaw('employees.company_id = c.id')
            .andWhere('employees.status', 'ACTIVE')
            .as('active_employees'),
          db('departments').count('*').whereRaw('departments.company_id = c.id').as('department_count'),
        )
        .orderBy('c.name');
      const unassigned = await db('employees')
        .whereNull('company_id')
        .andWhere('status', 'ACTIVE')
        .count({ n: '*' })
        .first();
      const anyUnassigned = await db('employees').whereNull('company_id').first('id');
      res.json({
        items: rows.map(toDto),
        activeWithoutCompany: Number(unassigned.n),
        // Any status: the Employees filter "No company set" is offered only when this is true.
        employeesWithoutCompany: Boolean(anyUnassigned),
      });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = createSchema.parse(req.body);
      const id = await db
        .transaction(async (trx) => {
          const [newId] = await trx('companies').insert({ code: input.code, name: input.name });
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'COMPANY_CREATED',
            entityType: 'company',
            entityId: newId,
            after: input,
          });
          return newId;
        })
        .catch((err) => {
          throw mapUnique(err);
        });
      res.status(201).json({ id });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = updateSchema.parse(req.body);
      await db
        .transaction(async (trx) => {
          const before = await trx('companies').where({ id }).forUpdate().first();
          if (!before) throw notFound('Company not found.');
          if (input.isActive === false && before.is_active) {
            const active = await trx('employees')
              .where({ company_id: id, status: 'ACTIVE' })
              .count({ n: '*' })
              .first();
            if (Number(active.n) > 0) {
              throw conflict(`Move the ${active.n} active employee(s) to another company first.`);
            }
          }
          const patch = {};
          if (input.code !== undefined) patch.code = input.code;
          if (input.name !== undefined) patch.name = input.name;
          if (input.isActive !== undefined) patch.is_active = input.isActive;
          if (Object.keys(patch).length) await trx('companies').where({ id }).update(patch);
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'COMPANY_UPDATED',
            entityType: 'company',
            entityId: id,
            before: { code: before.code, name: before.name, isActive: !!before.is_active },
            after: input,
          });
        })
        .catch((err) => {
          throw mapUnique(err);
        });
      res.json({ ok: true });
    }),
  );

  return router;
}
