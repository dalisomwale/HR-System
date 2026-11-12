import { Router } from 'express';
import { z } from 'zod';
import { auditContext, can } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, idParam } from '../../utils/validation.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';

/*
 * Branches (D109): the places each company works from, where stock is held. Part of Employee
 * management with companies and departments, so it is the one place the organisation is kept;
 * the Inventory System reads them for receiving, issuing and its reports. Seeing them needs
 * Employees: View; adding and changing them needs Organisation: Manage.
 */

const branchSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2, 'needs at least 2 characters').max(150),
  location: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  isActive: z.boolean().default(true),
});

export function branchRoutes({ db }) {
  const router = Router();
  const manage = (req, res, next) => (can(req.user, 'people.org') ? next() : next(forbidden()));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = await db('stock_branches as b')
        .join('companies as co', 'co.id', 'b.company_id')
        .orderBy(['co.name', 'b.name'])
        .select('b.id', 'b.name', 'b.location', 'b.is_active', 'b.company_id', 'co.name as company');
      const held = await db('branch_stock as bs')
        .join('stock_items as i', 'i.id', 'bs.item_id')
        .groupBy('bs.branch_id')
        .select('bs.branch_id')
        .sum({ units: 'bs.quantity' })
        .sum({ value: db.raw('GREATEST(bs.quantity, 0) * i.unit_price') });
      const H = new Map(held.map((h) => [h.branch_id, h]));
      const companies = await db('companies').where({ is_active: true }).orderBy('name').select('id', 'name');
      res.json({
        canEdit: can(req.user, 'people.org'),
        companies,
        items: rows.map((b) => ({
          id: b.id,
          name: b.name,
          location: b.location,
          isActive: Boolean(b.is_active),
          companyId: b.company_id,
          company: b.company,
          units: Number(H.get(b.id)?.units ?? 0),
          value: Number(H.get(b.id)?.value ?? 0),
        })),
      });
    }),
  );

  async function saveBranch(req, id = null) {
    const input = branchSchema.parse(req.body);
    const co = await db('companies').where({ id: input.companyId }).first('id');
    if (!co) throw badRequest('Choose the company.');
    const dup = await db('stock_branches')
      .where({ company_id: input.companyId })
      .whereRaw('LOWER(name) = LOWER(?)', [input.name])
      .whereNot('id', id ?? 0)
      .first('id');
    if (dup) throw conflict(`This company already has a branch called "${input.name}".`);
    const row = {
      company_id: input.companyId,
      name: input.name,
      location: input.location,
      is_active: input.isActive,
    };
    return db.transaction(async (trx) => {
      let branchId = id;
      let before = null;
      if (id) {
        before = await trx('stock_branches').where({ id }).first();
        if (!before) throw notFound('That branch no longer exists.');
        if (before.company_id !== input.companyId) {
          const holds = await trx('branch_stock')
            .where({ branch_id: id })
            .where('quantity', '<>', 0)
            .first('item_id');
          if (holds) throw conflict('This branch holds stock, so it cannot move to another company.');
        }
        await trx('stock_branches').where({ id }).update(row);
      } else {
        [branchId] = await trx('stock_branches').insert(row);
      }
      await writeAudit(trx, {
        ...auditContext(req),
        action: id ? 'BRANCH_UPDATED' : 'BRANCH_ADDED',
        entityType: 'branch',
        entityId: branchId,
        before: before
          ? {
              companyId: before.company_id,
              name: before.name,
              location: before.location,
              isActive: Boolean(before.is_active),
            }
          : undefined,
        after: input,
      });
      return branchId;
    });
  }
  router.post(
    '/',
    manage,
    asyncHandler(async (req, res) => res.status(201).json({ id: await saveBranch(req) })),
  );
  router.put(
    '/:id',
    manage,
    asyncHandler(async (req, res) => res.json({ id: await saveBranch(req, idParam(req)) })),
  );
  return router;
}
