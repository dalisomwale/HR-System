import { Router } from 'express';
import { z } from 'zod';
import { auditContext, can } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, idParam, pagination } from '../../utils/validation.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { MODULES, allPermissions, levelsFromPerms, levelsSummary, permsForLevels } from './modules.js';

/*
 * Users, Roles and the Audit trail of every module (D108), in the inventory system's format:
 *   /api/access/:module/roles      roles with an access level per area
 *   /api/access/:module/users      employees given a role in the module
 *   /api/access/:module/audit      every change made in the module
 * A module's own Users, Roles and Audit trail rights open them (the inventory's are admin.*).
 * Rights are read on every request, so a change applies on the person's next click.
 */

const PREFIX = { leave: 'leave.', people: 'people.', inventory: 'admin.' };

// Which audit entries belong to which module.
function moduleAudit(module) {
  return function where() {
    if (module === 'leave') {
      this.whereIn('a.entity_type', [
        'leave_request',
        'change_request',
        'document',
        'leave_type',
        'public_holiday',
        'work_schedule',
        'delegation',
        'leave_year',
        'job',
        'email',
        'leave_role',
        'leave_user',
      ])
        .orWhere((q) =>
          q.where('a.entity_type', 'system_setting').whereNot('a.action', 'like', 'REQUISITION_%'),
        )
        .orWhere((q) => q.where('a.entity_type', 'report').whereNot('a.entity_id', 'like', 'people-%'));
    } else if (module === 'people') {
      this.where((q) =>
        q
          .whereIn('a.entity_type', [
            'employee',
            'company',
            'department',
            'branch',
            'identity',
            'people_role',
            'people_user',
          ])
          .whereNot('a.action', 'like', 'INVENTORY_%'),
      ).orWhere((q) => q.where('a.entity_type', 'report').where('a.entity_id', 'like', 'people-%'));
    } else {
      this.whereIn('a.entity_type', [
        'requisition',
        'stock_item',
        'stock_category',
        'stock_branch',
        'inventory_role',
        'inventory_user',
      ])
        .orWhere('a.action', 'like', 'INVENTORY_%')
        .orWhere('a.action', 'like', 'STOCK_%')
        .orWhere('a.action', 'like', 'REQUISITION_%');
    }
  };
}

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

const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

export function accessRoutes({ db }) {
  const router = Router({ mergeParams: true });

  // The module, and a check for one of its admin rights.
  function mod(req) {
    const m = String(req.params.module);
    if (!MODULES[m]) throw notFound('No such module.');
    return m;
  }
  const allow = (...what) =>
    function check(req, res, next) {
      try {
        const m = mod(req);
        if (!what.some((w) => can(req.user, `${PREFIX[m]}${w}`))) return next(forbidden());
        req.module = m;
        next();
      } catch (err) {
        next(err);
      }
    };

  // ── Roles ────────────────────────────────────────────────────────────────────────────────────
  router.get(
    '/:module/roles',
    allow('roles', 'users'),
    asyncHandler(async (req, res) => {
      const m = req.module;
      const roles = await db('access_roles as r')
        .leftJoin('access_users as u', (j) => j.on('u.role_id', 'r.id').andOn('u.module', 'r.module'))
        .where('r.module', m)
        .groupBy('r.id', 'r.name', 'r.description', 'r.is_system')
        .orderBy([{ column: 'r.is_system', order: 'desc' }, 'r.name'])
        .select('r.id', 'r.name', 'r.description', 'r.is_system')
        .count({ users: 'u.employee_id' });
      const rows = roles.length
        ? await db('access_role_permissions').whereIn(
            'role_id',
            roles.map((r) => r.id),
          )
        : [];
      res.json({
        module: { key: m, label: MODULES[m].label },
        areas: MODULES[m].areas,
        items: roles.map((r) => {
          const p = r.is_system
            ? allPermissions(m)
            : rows.filter((x) => x.role_id === r.id).map((x) => x.permission);
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            isSystem: Boolean(r.is_system),
            users: Number(r.users),
            levels: levelsFromPerms(m, p),
            summary: levelsSummary(m, p),
          };
        }),
      });
    }),
  );

  async function saveRole(req, id = null) {
    const m = req.module;
    const input = roleSchema.parse(req.body);
    if (id) {
      const role = await db('access_roles').where({ id, module: m }).first();
      if (!role) throw notFound('That role no longer exists.');
      if (role.is_system)
        throw badRequest("The System Admin role always has full access and can't be changed.");
    }
    const dup = await db('access_roles')
      .where({ module: m })
      .whereRaw('LOWER(name) = LOWER(?)', [input.name])
      .whereNot('id', id ?? 0)
      .first('id');
    if (dup) throw conflict(`A role called "${input.name}" already exists.`);
    const perms = permsForLevels(m, input.levels);
    return db.transaction(async (trx) => {
      let roleId = id;
      const before = id
        ? await trx('access_role_permissions').where({ role_id: id }).pluck('permission')
        : null;
      if (id)
        await trx('access_roles').where({ id }).update({ name: input.name, description: input.description });
      else
        [roleId] = await trx('access_roles').insert({
          module: m,
          name: input.name,
          description: input.description,
        });
      await trx('access_role_permissions').where({ role_id: roleId }).del();
      if (perms.length) {
        await trx('access_role_permissions').insert(
          perms.map((permission) => ({ role_id: roleId, permission })),
        );
      }
      await writeAudit(trx, {
        ...auditContext(req),
        action: id ? 'ROLE_UPDATED' : 'ROLE_ADDED',
        entityType: `${m}_role`,
        entityId: roleId,
        before: before ? { permissions: before } : undefined,
        after: { name: input.name, permissions: perms },
      });
      return roleId;
    });
  }
  router.post(
    '/:module/roles',
    allow('roles'),
    asyncHandler(async (req, res) => res.status(201).json({ id: await saveRole(req) })),
  );
  router.put(
    '/:module/roles/:id',
    allow('roles'),
    asyncHandler(async (req, res) => res.json({ id: await saveRole(req, idParam(req)) })),
  );
  router.delete(
    '/:module/roles/:id',
    allow('roles'),
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const role = await db('access_roles').where({ id, module: req.module }).first();
      if (!role) throw notFound('That role no longer exists.');
      if (role.is_system) throw badRequest("The System Admin role can't be deleted.");
      if (await db('access_users').where({ role_id: id }).first('employee_id')) {
        throw conflict('People still have this role. Give them another role first.');
      }
      await db.transaction(async (trx) => {
        await trx('access_roles').where({ id }).del();
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'ROLE_DELETED',
          entityType: `${req.module}_role`,
          entityId: id,
          before: { name: role.name },
        });
      });
      res.status(204).end();
    }),
  );

  // ── Users ────────────────────────────────────────────────────────────────────────────────────
  router.get(
    '/:module/users',
    allow('users'),
    asyncHandler(async (req, res) => {
      const rows = await db('access_users as u')
        .join('employees as e', 'e.id', 'u.employee_id')
        .join('access_roles as r', 'r.id', 'u.role_id')
        .leftJoin('companies as c', 'c.id', 'e.company_id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .where('u.module', req.module)
        .orderBy(['e.first_name', 'e.last_name'])
        .select(
          'u.employee_id',
          'u.is_active',
          'u.created_at',
          'e.first_name',
          'e.last_name',
          'e.email',
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
  // Employees who can be given a role here: active and without one in this module yet.
  router.get(
    '/:module/users/candidates',
    allow('users'),
    asyncHandler(async (req, res) => {
      const rows = await db('employees as e')
        .leftJoin('access_users as u', (j) =>
          j.on('u.employee_id', 'e.id').andOn('u.module', db.raw('?', [req.module])),
        )
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
  const roleOf = (m, roleId) => db('access_roles').where({ id: roleId, module: m }).first('id');
  router.post(
    '/:module/users',
    allow('users'),
    asyncHandler(async (req, res) => {
      const m = req.module;
      const input = userSchema.parse(req.body);
      if (!(await db('employees').where({ id: input.employeeId, status: 'ACTIVE' }).first('id'))) {
        throw badRequest('Choose an active employee.');
      }
      if (!(await roleOf(m, input.roleId))) throw badRequest('Choose a role.');
      if (await db('access_users').where({ module: m, employee_id: input.employeeId }).first('employee_id')) {
        throw conflict('That employee already has a role here. Change it instead.');
      }
      await db.transaction(async (trx) => {
        await trx('access_users').insert({
          module: m,
          employee_id: input.employeeId,
          role_id: input.roleId,
          added_by: req.user.id,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'USER_ADDED',
          entityType: `${m}_user`,
          entityId: input.employeeId,
          after: { roleId: input.roleId },
        });
      });
      res.status(201).json({ employeeId: input.employeeId });
    }),
  );
  router.put(
    '/:module/users/:id',
    allow('users'),
    asyncHandler(async (req, res) => {
      const m = req.module;
      const id = idParam(req);
      const input = userUpdateSchema.parse(req.body);
      const row = await db('access_users').where({ module: m, employee_id: id }).first();
      if (!row) throw notFound('That person no longer has a role here.');
      if (id === req.user.id && (!input.isActive || input.roleId !== row.role_id)) {
        throw badRequest("You can't change or disable your own access.");
      }
      if (!(await roleOf(m, input.roleId))) throw badRequest('Choose a role.');
      await db.transaction(async (trx) => {
        await trx('access_users')
          .where({ module: m, employee_id: id })
          .update({ role_id: input.roleId, is_active: input.isActive, updated_at: trx.fn.now() });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'USER_UPDATED',
          entityType: `${m}_user`,
          entityId: id,
          before: { roleId: row.role_id, isActive: Boolean(row.is_active) },
          after: input,
        });
      });
      res.json({ employeeId: id });
    }),
  );
  router.delete(
    '/:module/users/:id',
    allow('users'),
    asyncHandler(async (req, res) => {
      const m = req.module;
      const id = idParam(req);
      if (id === req.user.id) throw badRequest("You can't remove your own access.");
      const row = await db('access_users').where({ module: m, employee_id: id }).first();
      if (!row) throw notFound('That person no longer has a role here.');
      await db.transaction(async (trx) => {
        await trx('access_users').where({ module: m, employee_id: id }).del();
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'USER_REMOVED',
          entityType: `${m}_user`,
          entityId: id,
          before: { roleId: row.role_id },
        });
      });
      res.status(204).end();
    }),
  );

  // ── Audit trail ──────────────────────────────────────────────────────────────────────────────
  router.get(
    '/:module/audit',
    allow('audit'),
    asyncHandler(async (req, res) => {
      const { page, pageSize, offset } = pagination(req.query, { defaultSize: 50, maxSize: 500 });
      const q = db('audit_log as a')
        .leftJoin('employees as e', 'e.id', 'a.actor_employee_id')
        .where(moduleAudit(req.module));
      if (req.query.action) q.where('a.action', String(req.query.action));
      if (req.query.q) {
        const like = `%${String(req.query.q).slice(0, 80)}%`;
        q.where((w) =>
          w
            .where('a.entity_id', 'like', like)
            .orWhereRaw("CONCAT(e.first_name, ' ', e.last_name) LIKE ?", [like]),
        );
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from ?? ''))
        q.where('a.created_at', '>=', `${req.query.from} 00:00:00`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to ?? ''))
        q.where('a.created_at', '<=', `${req.query.to} 23:59:59.999`);
      const { total } = await q.clone().count({ total: '*' }).first();
      const rows = await q
        .clone()
        .select('a.*', 'e.first_name', 'e.last_name')
        .orderBy('a.id', 'desc')
        .limit(pageSize)
        .offset(offset);
      const actions = await db('audit_log as a')
        .where(moduleAudit(req.module))
        .distinct('a.action')
        .orderBy('a.action')
        .pluck('a.action');
      res.json({
        total: Number(total),
        page,
        pageSize,
        actions,
        items: rows.map((r) => ({
          id: r.id,
          at: r.created_at,
          actor: r.first_name
            ? `${r.first_name} ${r.last_name}`
            : r.actor_type === 'CLI'
              ? 'Command line'
              : 'System',
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          before: parseJson(r.before_data),
          after: parseJson(r.after_data),
          ipAddress: r.ip_address,
        })),
      });
    }),
  );

  return router;
}
