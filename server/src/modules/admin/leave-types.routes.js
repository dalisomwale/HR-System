import { Router } from 'express';
import { z } from 'zod';
import { writeAudit } from '../audit/audit.service.js';
import { auditContext } from '../../middleware/auth.js';
import { asyncHandler, idParam, isoDate, optionalText } from '../../utils/validation.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { addDays } from '../leave/calendar.js';
import { todayInLusaka } from '../../utils/dates.js';
import { toPolicy } from '../leave/policy.service.js';
import { runMonthlyAccrual, runCarryForward, runCarryForwardExpiry } from '../leave/jobs.service.js';

const nonNeg = (max) => z.coerce.number().min(0).max(max);
const nullableNum = (max) => z.union([nonNeg(max), z.null()]);

/** Policy fields HR may change. A change creates a new version; past versions are never edited. */
const policyChangeSchema = z
  .object({
    effectiveFrom: isoDate,
    isPaid: z.boolean(),
    dayBasis: z.enum(['WORKING_DAYS', 'CALENDAR_DAYS']),
    entitlementDays: nullableNum(400),
    accrualMethod: z.enum(['NONE', 'ANNUAL_GRANT', 'FIXED_MONTHLY', 'ENTITLEMENT_DIV_12']),
    accrualMonthlyAmount: nullableNum(31),
    accrualRounding: z.enum(['NONE', 'NEAREST_HALF', 'NEAREST_TENTH', 'DOWN_HALF']),
    accrualConfirmed: z.boolean(),
    carryForwardMaxDays: nullableNum(365),
    allowHalfDay: z.boolean(),
    allowBackdate: z.boolean(),
    backdateMaxDays: z.union([z.coerce.number().int().min(0).max(365), z.null()]),
    minNoticeDays: z.union([z.coerce.number().int().min(0).max(365), z.null()]),
    noticeEnforcement: z.enum(['NONE', 'WARN_WITH_REASON', 'BLOCK']),
    maxSingleDurationDays: nullableNum(400),
    minServiceMonths: z.union([z.coerce.number().int().min(0).max(600), z.null()]),
    handoverRequired: z.boolean(),
    documentRequired: z.boolean(),
    documentDescription: optionalText(255),
    note: z.string().trim().min(3, 'is required').max(500),
  })
  .partial()
  .required({ effectiveFrom: true, note: true });

const COLUMNS = {
  isPaid: 'is_paid',
  dayBasis: 'day_basis',
  entitlementDays: 'entitlement_days',
  accrualMethod: 'accrual_method',
  accrualMonthlyAmount: 'accrual_monthly_amount',
  accrualRounding: 'accrual_rounding',
  accrualConfirmed: 'accrual_confirmed',
  carryForwardMaxDays: 'carry_forward_max_days',
  allowHalfDay: 'allow_half_day',
  allowBackdate: 'allow_backdate',
  backdateMaxDays: 'backdate_max_days',
  minNoticeDays: 'min_notice_days',
  noticeEnforcement: 'notice_enforcement',
  maxSingleDurationDays: 'max_single_duration_days',
  minServiceMonths: 'min_service_months',
  handoverRequired: 'handover_required',
  documentRequired: 'document_required',
  documentDescription: 'document_description',
};

async function typeWithPolicy(db, t) {
  const versions = await db('leave_policy_versions')
    .where({ leave_type_id: t.id })
    .orderBy('version_no', 'desc');
  const inUse = await db('leave_requests').where({ leave_type_id: t.id }).count({ n: '*' }).first();
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isActive: Boolean(t.is_active),
    isConfidential: Boolean(t.is_confidential),
    requests: Number(inUse.n),
    current: versions[0] ? toPolicy(versions[0]) : null,
    versions: versions.map((v) => ({
      versionNo: v.version_no,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to,
      confirmedAt: v.confirmed_at,
    })),
  };
}

export function leaveTypeRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const types = await db('leave_types').orderBy('display_order');
      res.json({ items: await Promise.all(types.map((t) => typeWithPolicy(db, t))) });
    }),
  );

  // One leave type in full: rules, every version with who confirmed it and why it changed,
  // how it is being used this year, and its change history.
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const t = await db('leave_types').where({ id }).first();
      if (!t) throw notFound('Leave type not found.');
      const base = await typeWithPolicy(db, t);
      const name = (f, l) => (f ? `${f} ${l}` : null);
      const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

      const versions = await db('leave_policy_versions as v')
        .leftJoin('employees as c', 'c.id', 'v.confirmed_by')
        .where('v.leave_type_id', id)
        .orderBy('v.version_no', 'desc')
        .select(
          'v.version_no',
          'v.effective_from',
          'v.effective_to',
          'v.confirmed_at',
          'v.requires_hr_confirmation',
          'v.source_reference',
          'c.first_name',
          'c.last_name',
        );
      const history = await db('audit_log as a')
        .leftJoin('employees as e', 'e.id', 'a.actor_employee_id')
        .where({ 'a.entity_type': 'leave_type', 'a.entity_id': String(id) })
        .orderBy('a.id', 'desc')
        .limit(50)
        .select('a.action', 'a.after_data', 'a.created_at', 'e.first_name', 'e.last_name');
      const notes = new Map(
        history
          .filter((h) => h.action === 'LEAVE_POLICY_CHANGED')
          .map((h) => json(h.after_data))
          .filter((a) => a?.versionNo)
          .map((a) => [a.versionNo, a.note ?? null]),
      );

      const today = todayInLusaka();
      const year = Number(today.slice(0, 4));
      const inYear = (q) =>
        q
          .where('r.leave_type_id', id)
          .andWhere('r.start_date', '<=', `${year}-12-31`)
          .andWhere('r.end_date', '>=', `${year}-01-01`);
      const pending = await inYear(db('leave_requests as r'))
        .whereIn('r.status', ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL'])
        .count({ n: '*' })
        .first();
      const approved = await inYear(db('leave_requests as r'))
        .where('r.status', 'APPROVED')
        .count({ n: '*' })
        .first();
      const days = await db('leave_request_days as x')
        .join('leave_requests as r', 'r.id', 'x.leave_request_id')
        .where({ 'r.leave_type_id': id, 'r.status': 'APPROVED' })
        .whereBetween('x.leave_date', [`${year}-01-01`, `${year}-12-31`])
        .sum({ d: 'x.charged' })
        .first();
      const onLeave = await db('leave_requests')
        .where({ leave_type_id: id, status: 'APPROVED' })
        .andWhere('start_date', '<=', today)
        .andWhere('end_date', '>=', today)
        .countDistinct({ n: 'employee_id' })
        .first();

      const LABEL = {
        LEAVE_TYPE_ACTIVATED: 'Activated',
        LEAVE_TYPE_DEACTIVATED: 'Deactivated',
        LEAVE_POLICY_CHANGED: 'Rules changed',
      };
      res.json({
        ...base,
        versions: versions.map((v) => ({
          versionNo: v.version_no,
          effectiveFrom: v.effective_from,
          effectiveTo: v.effective_to,
          sourceReference: v.source_reference,
          awaitingReview: Boolean(v.requires_hr_confirmation),
          confirmedAt: v.confirmed_at,
          confirmedBy: name(v.first_name, v.last_name),
          note: notes.get(v.version_no) ?? null,
        })),
        usage: {
          year,
          pending: Number(pending.n),
          approved: Number(approved.n),
          approvedDays: Math.round(Number(days.d ?? 0) * 100) / 100,
          onLeaveToday: Number(onLeave.n),
        },
        history: history.map((h) => {
          const after = json(h.after_data) ?? {};
          return {
            action: LABEL[h.action] ?? h.action,
            at: h.created_at,
            by: name(h.first_name, h.last_name) ?? 'System',
            detail:
              h.action === 'LEAVE_POLICY_CHANGED'
                ? `Version ${after.versionNo} from ${after.effectiveFrom}`
                : null,
            note: after.note ?? null,
          };
        }),
      });
    }),
  );

  // Activating a type records HR's confirmation of its current policy.
  router.post(
    '/:id/activate',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const t = await trx('leave_types').where({ id }).forUpdate().first();
        if (!t) throw notFound('Leave type not found.');
        if (t.is_active) throw conflict(`${t.name} is already active.`);
        const v = await trx('leave_policy_versions')
          .where({ leave_type_id: id })
          .orderBy('version_no', 'desc')
          .first();
        if (!v) throw conflict('This leave type has no policy.');
        await trx('leave_types').where({ id }).update({ is_active: true });
        await trx('leave_policy_versions')
          .where({ id: v.id })
          .update({ requires_hr_confirmation: false, confirmed_by: req.user.id, confirmed_at: trx.fn.now() });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'LEAVE_TYPE_ACTIVATED',
          entityType: 'leave_type',
          entityId: id,
          after: { code: t.code, policyVersion: v.version_no },
        });
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/:id/deactivate',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const t = await trx('leave_types').where({ id }).forUpdate().first();
        if (!t) throw notFound('Leave type not found.');
        if (!t.is_active) throw conflict(`${t.name} is already inactive.`);
        await trx('leave_types').where({ id }).update({ is_active: false });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'LEAVE_TYPE_DEACTIVATED',
          entityType: 'leave_type',
          entityId: id,
          after: { code: t.code },
        });
      });
      res.json({ ok: true });
    }),
  );

  // Change policy values from a date. The current version is closed the day before.
  router.post(
    '/:id/policy',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = policyChangeSchema.parse(req.body);
      const result = await db.transaction(async (trx) => {
        const t = await trx('leave_types').where({ id }).forUpdate().first();
        if (!t) throw notFound('Leave type not found.');
        const cur = await trx('leave_policy_versions')
          .where({ leave_type_id: id })
          .orderBy('version_no', 'desc')
          .first();
        if (input.effectiveFrom <= cur.effective_from) {
          throw badRequest(
            `The new rules must start after ${cur.effective_from}, when the current rules started.`,
          );
        }
        const next = { ...cur };
        delete next.id;
        delete next.created_at;
        for (const [k, col] of Object.entries(COLUMNS)) if (input[k] !== undefined) next[col] = input[k];
        if (next.accrual_method === 'FIXED_MONTHLY' && next.accrual_monthly_amount == null) {
          throw badRequest('Enter the monthly accrual amount.');
        }
        if (!next.allow_backdate) next.backdate_max_days = null;
        Object.assign(next, {
          version_no: cur.version_no + 1,
          effective_from: input.effectiveFrom,
          effective_to: null,
          requires_hr_confirmation: false,
          confirmed_by: req.user.id,
          confirmed_at: trx.fn.now(),
          created_by: req.user.id,
          source_reference: cur.source_reference,
        });
        await trx('leave_policy_versions')
          .where({ id: cur.id })
          .update({ effective_to: addDays(input.effectiveFrom, -1) });
        const [newId] = await trx('leave_policy_versions').insert(next);
        const changed = Object.fromEntries(
          Object.keys(COLUMNS)
            .filter((k) => input[k] !== undefined)
            .map((k) => [k, input[k]]),
        );
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'LEAVE_POLICY_CHANGED',
          entityType: 'leave_type',
          entityId: id,
          before: Object.fromEntries(Object.keys(changed).map((k) => [k, toPolicy(cur)[k]])),
          after: {
            ...changed,
            versionNo: next.version_no,
            effectiveFrom: input.effectiveFrom,
            note: input.note,
          },
        });
        return { versionId: newId, versionNo: next.version_no };
      });
      res.status(201).json(result);
    }),
  );

  return router;
}

export function jobRoutes({ db }) {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = await db('scheduled_job_runs').orderBy('id', 'desc').limit(50);
      res.json({
        items: rows.map((r) => ({
          job: r.job_name,
          period: r.period_key,
          status: r.status,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          summary: typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary,
          error: r.error,
        })),
      });
    }),
  );
  router.post(
    '/monthly-accrual',
    asyncHandler(async (req, res) => {
      const { period } = z
        .object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM') })
        .parse(req.body);
      res.json(await runMonthlyAccrual(db, period, auditContext(req)));
    }),
  );
  router.post(
    '/carry-forward',
    asyncHandler(async (req, res) => {
      const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.body);
      res.json(await runCarryForward(db, year, auditContext(req)));
    }),
  );
  router.post(
    '/carry-forward-expiry',
    asyncHandler(async (req, res) => {
      const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.body);
      res.json(await runCarryForwardExpiry(db, year, auditContext(req)));
    }),
  );
  return router;
}
