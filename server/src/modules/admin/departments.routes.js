import { Router } from 'express';
import { z } from 'zod';
import { writeAudit } from '../audit/audit.service.js';
import { auditContext } from '../../middleware/auth.js';
import { asyncHandler, idParam, optionalId, requiredText } from '../../utils/validation.js';
import { conflict, notFound } from '../../utils/errors.js';

const createSchema = z.object({
  code: requiredText(20).transform((s) => s.toUpperCase()),
  name: requiredText(120),
  parentId: optionalId,
});
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

function toDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parentId: row.parent_id,
    parentName: row.parent_name ?? null,
    isActive: Boolean(row.is_active),
    activeEmployees: Number(row.active_employees ?? 0),
  };
}

async function assertNoParentLoop(trx, id, parentId) {
  let current = parentId;
  const seen = new Set();
  while (current) {
    if (current === id) throw conflict('A department cannot sit under itself.');
    if (seen.has(current)) break;
    seen.add(current);
    const row = await trx('departments').where({ id: current }).first('parent_id');
    if (!row) throw notFound('Parent department not found.');
    current = row.parent_id;
  }
}

function mapUnique(err) {
  if (err?.code === 'ER_DUP_ENTRY') return conflict('A department with this code or name already exists.');
  return err;
}

export function departmentRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = await db('departments as d')
        .leftJoin('departments as p', 'p.id', 'd.parent_id')
        .select(
          'd.*',
          'p.name as parent_name',
          db('employees')
            .count('*')
            .whereRaw('employees.department_id = d.id')
            .andWhere('employees.status', 'ACTIVE')
            .as('active_employees'),
        )
        .orderBy('d.name');
      res.json({ items: rows.map(toDto) });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = createSchema.parse(req.body);
      const id = await db
        .transaction(async (trx) => {
          if (input.parentId) await assertNoParentLoop(trx, -1, input.parentId);
          const [newId] = await trx('departments').insert({
            code: input.code,
            name: input.name,
            parent_id: input.parentId,
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
          if (input.parentId !== undefined && input.parentId !== null) {
            await assertNoParentLoop(trx, id, input.parentId);
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
          if (input.code !== undefined) patch.code = input.code;
          if (input.name !== undefined) patch.name = input.name;
          if (input.parentId !== undefined) patch.parent_id = input.parentId;
          if (input.isActive !== undefined) patch.is_active = input.isActive;
          if (Object.keys(patch).length) await trx('departments').where({ id }).update(patch);
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'DEPARTMENT_UPDATED',
            entityType: 'department',
            entityId: id,
            before: {
              code: before.code,
              name: before.name,
              parentId: before.parent_id,
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
