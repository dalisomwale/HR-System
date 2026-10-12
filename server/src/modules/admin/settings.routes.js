import { Router } from 'express';
import { z } from 'zod';
import { writeAudit } from '../audit/audit.service.js';
import { auditContext } from '../../middleware/auth.js';
import { asyncHandler, pagination } from '../../utils/validation.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';

const int = (min, max) => z.number().int().min(min).max(max);

/** Settings System Administrators may change, with the values each accepts. Others are read-only. */
export const EDITABLE_SETTINGS = {
  manager_scope: {
    schema: z.enum(['DIRECT_REPORTS', 'REPORTING_LINE']),
    options: [
      { value: 'DIRECT_REPORTS', label: 'Direct reports only' },
      { value: 'REPORTING_LINE', label: 'Whole reporting line' },
    ],
  },
  no_manager_routing: {
    schema: z.enum(['HR_STAGE']),
    options: [{ value: 'HR_STAGE', label: 'Go straight to HR final approval (recorded)' }],
  },
  resubmission_routing: {
    schema: z.enum(['MANAGER_STAGE', 'HR_STAGE']),
    options: [
      { value: 'MANAGER_STAGE', label: 'Back to the manager' },
      { value: 'HR_STAGE', label: 'Straight back to HR' },
    ],
  },
  handover_signoff_by: {
    schema: z.enum(['LINE_MANAGER']),
    options: [{ value: 'LINE_MANAGER', label: 'Manager, at the manager approval stage' }],
  },
  weekend_holiday_substitution: {
    schema: z.enum(['UNCONFIRMED', 'MANUAL_ENTRY']),
    options: [
      { value: 'UNCONFIRMED', label: 'Not yet confirmed' },
      { value: 'MANUAL_ENTRY', label: 'HR enters substitute days as public holidays' },
    ],
  },
  overdue_manager_working_days: { schema: int(1, 30), unit: 'working days' },
  overdue_hr_working_days: { schema: int(1, 30), unit: 'working days' },
  uncommunicated_decision_escalation_days: { schema: int(1, 60), unit: 'days' },
  leave_reservations_enabled: { schema: z.boolean() },
  email_max_attempts: { schema: int(1, 20), unit: 'attempts' },
  idempotency_ttl_hours: { schema: int(1, 168), unit: 'hours' },
};

// mysql2 already decodes JSON columns; a JSON string value arrives as a plain JS string.
const parseJson = (v) => v;

export function settingsRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = await db('system_settings as s')
        .leftJoin('employees as e', 'e.id', 's.updated_by')
        .select('s.*', 'e.first_name', 'e.last_name')
        .orderBy('s.setting_key');
      res.json({
        items: rows.map((r) => {
          const meta = EDITABLE_SETTINGS[r.setting_key];
          return {
            key: r.setting_key,
            value: parseJson(r.value),
            description: r.description,
            requiresConfirmation: Boolean(r.requires_hr_confirmation),
            editable: Boolean(meta),
            options: meta?.options ?? null,
            unit: meta?.unit ?? null,
            type: meta?.options
              ? 'choice'
              : meta?.schema?._def?.typeName === 'ZodBoolean'
                ? 'boolean'
                : meta
                  ? 'number'
                  : 'fixed',
            updatedBy: r.first_name ? `${r.first_name} ${r.last_name}` : null,
            updatedAt: r.updated_at,
          };
        }),
      });
    }),
  );

  // Save a value. Saving also records HR's confirmation of a default.
  router.put(
    '/:key',
    asyncHandler(async (req, res) => {
      const key = req.params.key;
      const meta = EDITABLE_SETTINGS[key];
      if (!meta) throw conflict('This setting cannot be changed here.');
      const parsed = meta.schema.safeParse(req.body?.value);
      if (!parsed.success) throw badRequest(`Invalid value: ${parsed.error.issues[0].message}`);
      await db.transaction(async (trx) => {
        const before = await trx('system_settings').where({ setting_key: key }).forUpdate().first();
        if (!before) throw notFound('Setting not found.');
        await trx('system_settings')
          .where({ setting_key: key })
          .update({
            value: JSON.stringify(parsed.data),
            requires_hr_confirmation: false,
            updated_by: req.user.id,
          });
        await writeAudit(trx, {
          ...auditContext(req),
          action: before.requires_hr_confirmation ? 'SETTING_CONFIRMED' : 'SETTING_CHANGED',
          entityType: 'system_setting',
          entityId: key,
          before: { value: parseJson(before.value) },
          after: { value: parsed.data },
        });
      });
      res.json({ ok: true });
    }),
  );

  return router;
}

export function auditRoutes({ db }) {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { page, pageSize, offset } = pagination(req.query, { defaultSize: 50, maxSize: 200 });
      const q = db('audit_log as a').leftJoin('employees as e', 'e.id', 'a.actor_employee_id');
      if (req.query.action) q.where('a.action', String(req.query.action));
      if (req.query.entityType) q.where('a.entity_type', String(req.query.entityType));
      if (req.query.entityId) q.where('a.entity_id', String(req.query.entityId));
      if (req.query.actorId) q.where('a.actor_employee_id', Number(req.query.actorId) || 0);
      if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from ?? ''))
        q.where('a.created_at', '>=', `${req.query.from} 00:00:00`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to ?? ''))
        q.where('a.created_at', '<=', `${req.query.to} 23:59:59.999`);
      const { total } = await q.clone().count({ total: '*' }).first();
      const rows = await q
        .select('a.*', 'e.first_name', 'e.last_name')
        .orderBy('a.id', 'desc')
        .limit(pageSize)
        .offset(offset);
      const actions = await db('audit_log').distinct('action').orderBy('action').pluck('action');
      res.json({
        total: Number(total),
        page,
        pageSize,
        actions,
        items: rows.map((r) => ({
          id: r.id,
          at: r.created_at,
          actorType: r.actor_type,
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
