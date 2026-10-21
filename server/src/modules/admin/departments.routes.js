import { Router } from 'express';
import { z } from 'zod';
import { writeAudit } from '../audit/audit.service.js';
import { auditContext } from '../../middleware/auth.js';
import { asyncHandler, idParam, requiredText } from '../../utils/validation.js';
import { conflict, notFound } from '../../utils/errors.js';

const createSchema = z.object({
  companyId: z.coerce.number().int().positive({ message: 'is required' }),
  code: requiredText(20).transform((s) => s.toUpperCase()),
  name: requiredText(120),
});
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

function toDto(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    company: row.company_name ?? null,
    code: row.code,
    name: row.name,
    isActive: Boolean(row.is_active),
    activeEmployees: Number(row.active_employees ?? 0),
  };
}

function mapUnique(err) {
  if (err?.code === 'ER_DUP_ENTRY') {
    return conflict('This company already has a department with this code or name.');
  }
  return err;
}

async function assertCompany(trx, companyId) {
  const c = await trx('companies').where({ id: companyId }).first('is_active');
  if (!c) throw notFound('Company not found.');
  if (!c.is_active) throw conflict('That company is inactive.');
}

export function departmentRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = await db('departments as d')
        .leftJoin('companies as c', 'c.id', 'd.company_id')
        .modify((q) => req.query.companyId && q.where('d.company_id', Number(req.query.companyId) || 0))
        .select(
          'd.*',
          'c.name as company_name',
          db('employees')
            .count('*')
            .whereRaw('employees.department_id = d.id')
            .andWhere('employees.status', 'ACTIVE')
            .as('active_employees'),
        )
        .orderBy([{ column: 'c.name' }, { column: 'd.name' }]);
      res.json({ items: rows.map(toDto) });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = createSchema.parse(req.body);
      const id = await db
        .transaction(async (trx) => {
          await assertCompany(trx, input.companyId);
          const [newId] = await trx('departments').insert({
            company_id: input.companyId,
            code: input.code,
            name: input.name,
          });
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'DEPARTMENT_CREATED',
            entityType: 'department',
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
          const before = await trx('departments').where({ id }).forUpdate().first();
          if (!before) throw notFound('Department not found.');
          if (input.companyId !== undefined && input.companyId !== before.company_id) {
            // Its people move with it (below).
            await assertCompany(trx, input.companyId);
          }
          if (input.isActive === false && before.is_active) {
            const active = await trx('employees')
              .where({ department_id: id, status: 'ACTIVE' })
              .count({ n: '*' })
              .first();
            if (Number(active.n) > 0) {
              throw conflict(`Move the ${active.n} active employee(s) out of this department first.`);
            }
          }
          const patch = {};
          if (input.companyId !== undefined) patch.company_id = input.companyId;
          if (input.code !== undefined) patch.code = input.code;
          if (input.name !== undefined) patch.name = input.name;
          if (input.isActive !== undefined) patch.is_active = input.isActive;
          if (Object.keys(patch).length) await trx('departments').where({ id }).update(patch);
          if (patch.company_id !== undefined) {
            await trx('employees').where({ department_id: id }).update({ company_id: patch.company_id });
          }
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'DEPARTMENT_UPDATED',
            entityType: 'department',
            entityId: id,
            before: {
              companyId: before.company_id,
              code: before.code,
              name: before.name,
              isActive: !!before.is_active,
            },
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
