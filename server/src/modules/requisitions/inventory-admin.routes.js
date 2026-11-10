import { Router } from 'express';
import { z } from 'zod';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, idParam } from '../../utils/validation.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { need } from './access.js';
import {
  ACCESS_AREAS,
  ALL_PERMISSIONS,
  levelsFromPerms,
  levelsSummary,
  permsForLevels,
} from './permissions.js';

/*
 * The inventory system's Admin › Users, Admin › Roles and Suppliers pages (D107). Users are
 * employees given an inventory role; they sign in with Microsoft like everyone else, so there are
 * no passwords here. Roles hold the access rights in permissions.js.
 */

const roleSchema = z.object({
  name: z.string().trim().min(2, 'needs at least 2 characters').max(100),
  description: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => v || null),
  levels: z.record(z.string(), z.union([z.number().int(), z.array(z.number().int())])),
});
const userSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  roleId: z.coerce.number().int().positive(),
});
const userUpdateSchema = z.object({
  roleId: z.coerce.number().int().positive(),
  isActive: z.boolean(),
});

export function inventoryAdminRoutes({ db }) {
  const router = Router();
  const rolesAdmin = need((c) => c.rolesAdmin, 'You cannot manage inventory roles.');
  const usersAdmin = need((c) => c.usersAdmin, 'You cannot manage inventory users.');
  const seeStock = need((c) => c.canSeeStock, 'You do not have access to stock.');

  async function rolePerms(ids) {
    const rows = ids.length ? await db('inventory_role_permissions').whereIn('role_id', ids) : [];
    const by = new Map(ids.map((id) => [id, []]));
    for (const r of rows) by.get(r.role_id)?.push(r.permission);
    return by;
  }

  // ── Roles ────────────────────────────────────────────────────────────────────────────────────
  router.get(
    '/roles',
    need((c) => c.rolesAdmin || c.usersAdmin, 'You cannot see inventory roles.'),
    asyncHandler(async (req, res) => {
      const roles = await db('inventory_roles as r')
        .leftJoin('inventory_users as u', 'u.role_id', 'r.id')
        .groupBy('r.id', 'r.name', 'r.description', 'r.is_system')
        .orderBy([{ column: 'r.is_system', order: 'desc' }, 'r.name'])
        .select('r.id', 'r.name', 'r.description', 'r.is_system')
        .count({ users: 'u.employee_id' });
      const perms = await rolePerms(roles.map((r) => r.id));
      res.json({
        areas: ACCESS_AREAS,
        items: roles.map((r) => {
          const p = r.is_system ? ALL_PERMISSIONS : perms.get(r.id);
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            isSystem: Boolean(r.is_system),
            users: Number(r.users),
            levels: levelsFromPerms(p),
            summary: levelsSummary(p),
          };
        }),
      });
    }),
  );

  async function saveRole(req, id = null) {
    const input = roleSchema.parse(req.body);
    if (id) {
      const role = await db('inventory_roles').where({ id }).first();
      if (!role) throw notFound('That role no longer exists.');
      if (role.is_system)
        throw badRequest("The System Admin role always has full access and can't be changed.");
    }
    const dup = await db('inventory_roles')
      .whereRaw('LOWER(name) = LOWER(?)', [input.name])
      .whereNot('id', id ?? 0)
      .first('id');
    if (dup) throw conflict(`A role called "${input.name}" already exists.`);
    const perms = permsForLevels(input.levels);
    return db.transaction(async (trx) => {
      let roleId = id;
      const before = id
        ? await trx('inventory_role_permissions').where({ role_id: id }).pluck('permission')
        : null;
      if (id)
        await trx('inventory_roles')
          .where({ id })
          .update({ name: input.name, description: input.description });
      else
        [roleId] = await trx('inventory_roles').insert({ name: input.name, description: input.description });
      await trx('inventory_role_permissions').where({ role_id: roleId }).del();
      if (perms.length) {
        await trx('inventory_role_permissions').insert(
          perms.map((permission) => ({ role_id: roleId, permission })),
        );
      }
      await writeAudit(trx, {
        ...auditContext(req),
        action: id ? 'INVENTORY_ROLE_UPDATED' : 'INVENTORY_ROLE_ADDED',
        entityType: 'inventory_role',
        entityId: roleId,
        before: before ? { permissions: before } : undefined,
        after: { name: input.name, permissions: perms },
      });
      return roleId;
    });
  }
  router.post(
    '/roles',
    rolesAdmin,
    asyncHandler(async (req, res) => res.status(201).json({ id: await saveRole(req) })),
  );
  router.put(
    '/roles/:id',
    rolesAdmin,
    asyncHandler(async (req, res) => res.json({ id: await saveRole(req, idParam(req)) })),
  );
  router.delete(
    '/roles/:id',
    rolesAdmin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const role = await db('inventory_roles').where({ id }).first();
      if (!role) throw notFound('That role no longer exists.');
      if (role.is_system) throw badRequest("The System Admin role can't be deleted.");
      const used = await db('inventory_users').where({ role_id: id }).first('employee_id');
      if (used) throw conflict('People still have this role. Give them another role first.');
      await db.transaction(async (trx) => {
        await trx('inventory_roles').where({ id }).del();
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'INVENTORY_ROLE_DELETED',
          entityType: 'inventory_role',
          entityId: id,
          before: { name: role.name },
        });
      });
      res.status(204).end();
    }),
  );

  // ── Users ────────────────────────────────────────────────────────────────────────────────────
  router.get(
    '/users',
    usersAdmin,
    asyncHandler(async (req, res) => {
      const rows = await db('inventory_users as u')
        .join('employees as e', 'e.id', 'u.employee_id')
        .join('inventory_roles as r', 'r.id', 'u.role_id')
        .leftJoin('companies as c', 'c.id', 'e.company_id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .orderBy(['e.first_name', 'e.last_name'])
        .select(
          'u.employee_id',
          'u.is_active',
          'u.created_at',
          'e.first_name',
          'e.last_name',
          'e.email',
          'e.job_title',
          'e.status',
          'c.name as company',
          'd.name as department',
          'r.id as role_id',
          'r.name as role',
          'r.is_system',
        );
      res.json({
        items: rows.map((r) => ({
          employeeId: r.employee_id,
          name: `${r.first_name} ${r.last_name}`,
          email: r.email,
          jobTitle: r.job_title,
          company: r.company,
          department: r.department,
          roleId: r.role_id,
          role: r.role,
          isSystemRole: Boolean(r.is_system),
          isActive: Boolean(r.is_active),
          employeeLeft: r.status !== 'ACTIVE',
          addedAt: r.created_at,
        })),
      });
    }),
  );
  // Employees who can be given access: active and not yet an inventory user.
  router.get(
    '/users/candidates',
    usersAdmin,
    asyncHandler(async (req, res) => {
      const rows = await db('employees as e')
        .leftJoin('inventory_users as u', 'u.employee_id', 'e.id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .whereNull('u.employee_id')
        .where('e.status', 'ACTIVE')
        .orderBy(['e.first_name', 'e.last_name'])
        .select('e.id', 'e.first_name', 'e.last_name', 'e.email', 'd.name as department');
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          name: `${r.first_name} ${r.last_name}`,
          email: r.email,
          department: r.department,
        })),
      });
    }),
  );
  router.post(
    '/users',
    usersAdmin,
    asyncHandler(async (req, res) => {
      const input = userSchema.parse(req.body);
      const emp = await db('employees').where({ id: input.employeeId, status: 'ACTIVE' }).first('id');
      if (!emp) throw badRequest('Choose an active employee.');
      if (!(await db('inventory_roles').where({ id: input.roleId }).first('id')))
        throw badRequest('Choose a role.');
      if (await db('inventory_users').where({ employee_id: input.employeeId }).first('employee_id')) {
        throw conflict('That employee already has access. Change their role instead.');
      }
      await db.transaction(async (trx) => {
        await trx('inventory_users').insert({
          employee_id: input.employeeId,
          role_id: input.roleId,
          added_by: req.user.id,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'INVENTORY_USER_ADDED',
          entityType: 'employee',
          entityId: input.employeeId,
          after: { roleId: input.roleId },
        });
      });
      res.status(201).json({ employeeId: input.employeeId });
    }),
  );
  router.put(
    '/users/:id',
    usersAdmin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = userUpdateSchema.parse(req.body);
      const row = await db('inventory_users').where({ employee_id: id }).first();
      if (!row) throw notFound('That person no longer has inventory access.');
      if (id === req.user.id && (!input.isActive || input.roleId !== row.role_id)) {
        throw badRequest("You can't change or disable your own access.");
      }
      if (!(await db('inventory_roles').where({ id: input.roleId }).first('id')))
        throw badRequest('Choose a role.');
      await db.transaction(async (trx) => {
        await trx('inventory_users')
          .where({ employee_id: id })
          .update({ role_id: input.roleId, is_active: input.isActive, updated_at: trx.fn.now() });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'INVENTORY_USER_UPDATED',
          entityType: 'employee',
          entityId: id,
          before: { roleId: row.role_id, isActive: Boolean(row.is_active) },
          after: input,
        });
      });
      res.json({ employeeId: id });
    }),
  );
  router.delete(
    '/users/:id',
    usersAdmin,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      if (id === req.user.id) throw badRequest("You can't remove your own access.");
      const row = await db('inventory_users').where({ employee_id: id }).first();
      if (!row) throw notFound('That person no longer has inventory access.');
      await db.transaction(async (trx) => {
        await trx('inventory_users').where({ employee_id: id }).del();
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'INVENTORY_USER_REMOVED',
          entityType: 'employee',
          entityId: id,
          before: { roleId: row.role_id },
        });
      });
      res.status(204).end();
    }),
  );

  // ── Suppliers ────────────────────────────────────────────────────────────────────────────────
  // As on the inventory system: every supplier named on a delivery, with how often and how much.
  router.get(
    '/suppliers',
    seeStock,
    asyncHandler(async (req, res) => {
      const rows = await db('stock_receipts as s')
        .whereNotNull('s.supplier')
        .whereNot('s.supplier', '')
        .groupBy('s.supplier')
        .orderBy('s.supplier')
        .select('s.supplier')
        .count({ deliveries: '*' })
        .sum({ units: 's.quantity' })
        .sum({ value: db.raw('s.quantity * s.unit_price') })
        .max({ last: 's.date_received' });
      res.json({
        items: rows.map((r) => ({
          name: r.supplier,
          deliveries: Number(r.deliveries),
          units: Number(r.units ?? 0),
          value: Number(r.value ?? 0),
          lastDelivery: r.last,
        })),
      });
    }),
  );

  return router;
}
