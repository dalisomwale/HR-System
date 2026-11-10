import { Router } from 'express';
import { z } from 'zod';
import { auditContext, requirePerm } from '../../middleware/auth.js';
import { asyncHandler, idParam, optionalText } from '../../utils/validation.js';
import { todayInLusaka } from '../../utils/dates.js';
import {
  requestInputSchema,
  evaluateRequest,
  evaluationView,
  submitRequest,
  withdrawRequest,
  transferRequest,
  transferSchema,
  acceptTransfer,
  resubmitRequest,
  requestCancellation,
  cancelSchema,
  managerDecision,
  hrDecision,
  decisionSchema,
  changeManagerDecision,
  changeHrDecision,
} from './requests.service.js';
import { myRequests, requestDetail, managerQueue, hrQueue } from './queries.service.js';
import { appliesTo, employeeBalances, eligibilityProblem, recordAdjustment } from './balance.service.js';
import { policyOn } from './policy.service.js';
import { toXlsx } from '../reports/export-files.js';
import { storeHandoverSheet } from '../documents/handover-file.js';
import { storageDir } from '../documents/documents.routes.js';

/** Columns of the Excel handover template (D98). */
export const HANDOVER_COLUMNS = [
  'Task or responsibility',
  'Current status',
  'What needs doing while I am away',
  'Deadline',
  'Key contacts',
  'Files or where to find them',
  'Covered by',
];

const yearParam = (q) => {
  const y = Number(q.year);
  return Number.isInteger(y) && y > 2000 && y < 2100 ? y : Number(todayInLusaka().slice(0, 4));
};

/** Leave for the signed-in employee. Employee IDs never come from the client. */
export function leaveRoutes({ db, config }) {
  const router = Router();
  // Store the handover sheet first; remove it again if the request is not saved.
  const withSheet = async (sheet, save) => {
    const file = config
      ? await storeHandoverSheet(storageDir(config), config.documents.maxBytes, sheet)
      : null;
    try {
      return await save(file);
    } catch (e) {
      await file?.discard();
      throw e;
    }
  };

  // The blank handover template; the employee fills it in and attaches it to the request.
  router.get('/handover-template', (req, res) => {
    const file = toXlsx(
      HANDOVER_COLUMNS.map((label, i) => ({ key: `c${i}`, label, width: i === 3 ? 14 : 32 })),
      [],
      { sheetName: 'Handover', title: 'Leave handover' },
    );
    res
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition', 'attachment; filename="leave-handover-template.xlsx"')
      .set('Cache-Control', 'private, no-store')
      .send(file);
  });

  router.get(
    '/types',
    asyncHandler(async (req, res) => {
      const me = await db('employees').where({ id: req.user.id }).first();
      const today = todayInLusaka();
      const types = await db('leave_types').where({ is_active: true }).orderBy('display_order');
      const items = [];
      let sexMissing = false;
      for (const t of types) {
        const p = await policyOn(db, t.id, today);
        if (p?.extraRules?.eligibleSex && !me.sex) sexMissing = true;
        if (!p || !appliesTo(me, p)) continue;
        items.push({
          id: t.id,
          code: t.code,
          name: t.name,
          description: t.description,
          dayBasis: p.dayBasis,
          allowHalfDay: p.allowHalfDay,
          handoverRequired: p.handoverRequired,
          reasonRequired: Boolean(p.extraRules.reasonRequired),
          eventRequired: p.extraRules.eventRequired ?? null,
          multipleBirthAllowed: Boolean(p.extraRules.multipleBirthMaxDays),
          documentRequired: p.documentRequired,
          sensitiveAllowed: p.sensitiveAllowed,
          documentDescription: p.documentDescription,
          minNoticeDays: p.minNoticeDays,
          notAvailableReason: eligibilityProblem(me, p, today),
        });
      }
      // Leave types for one gender are hidden until HR records the employee's gender.
      res.json({ items, sexMissing });
    }),
  );

  router.get(
    '/balances',
    asyncHandler(async (req, res) => {
      const year = yearParam(req.query);
      res.json({ year, items: await employeeBalances(db, req.user.id, year) });
    }),
  );

  router.get(
    '/colleagues',
    asyncHandler(async (req, res) => {
      // Only people in the employee's own department can cover (D103).
      const me = await db('employees').where({ id: req.user.id }).first('department_id');
      if (!me?.department_id) return res.json({ items: [] });
      const rows = await db('employees')
        .where({ status: 'ACTIVE', department_id: me.department_id })
        .whereNot('id', req.user.id)
        .orderBy(['last_name', 'first_name'])
        .select('id', 'first_name', 'last_name', 'job_title');
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          label: `${r.first_name} ${r.last_name}${r.job_title ? `, ${r.job_title}` : ''}`,
        })),
      });
    }),
  );

  router.post(
    '/requests/preview',
    asyncHandler(async (req, res) => {
      const input = requestInputSchema.parse(req.body);
      const me = await db('employees').where({ id: req.user.id }).first();
      res.json(evaluationView(await evaluateRequest(db, me, input)));
    }),
  );

  router.post(
    '/requests',
    asyncHandler(async (req, res) => {
      const input = requestInputSchema.parse(req.body);
      const out = await withSheet(input.handoverSheet, (handoverFile) =>
        submitRequest(db, req.user, input, auditContext(req), { handoverFile }),
      );
      res.status(201).json(out);
    }),
  );

  router.get(
    '/requests',
    asyncHandler(async (req, res) => {
      res.json({ items: await myRequests(db, req.user.id, { year: req.query.year }) });
    }),
  );

  router.get(
    '/requests/:id',
    asyncHandler(async (req, res) => {
      res.json(await requestDetail(db, req.user, idParam(req)));
    }),
  );

  const versionSchema = z.object({
    version: z.coerce.number().int().positive().optional(),
    comment: optionalText(2000),
  });

  router.post(
    '/requests/:id/withdraw',
    asyncHandler(async (req, res) => {
      res.json(
        await withdrawRequest(
          db,
          req.user,
          idParam(req),
          versionSchema.parse(req.body ?? {}),
          auditContext(req),
        ),
      );
    }),
  );

  router.post(
    '/requests/:id/accept',
    asyncHandler(async (req, res) => {
      res.json(
        await acceptTransfer(
          db,
          req.user,
          idParam(req),
          versionSchema.parse(req.body ?? {}),
          auditContext(req),
        ),
      );
    }),
  );

  router.post(
    '/requests/:id/resubmit',
    asyncHandler(async (req, res) => {
      const input = requestInputSchema.omit({ leaveTypeId: true }).merge(versionSchema).parse(req.body);
      const out = await withSheet(input.handoverSheet, (handoverFile) =>
        resubmitRequest(db, req.user, idParam(req), input, auditContext(req), { handoverFile }),
      );
      res.json(out);
    }),
  );

  router.post(
    '/requests/:id/cancel',
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await requestCancellation(
            db,
            req.user,
            idParam(req),
            cancelSchema.parse(req.body),
            auditContext(req),
          ),
        );
    }),
  );

  return router;
}

/** Approval queues and decisions. Authority is checked per request in the service. */
export function approvalRoutes({ db }) {
  const router = Router();

  router.get(
    '/manager',
    asyncHandler(async (req, res) => {
      res.json(await managerQueue(db, req.user));
    }),
  );

  router.post(
    '/requests/:id/transfer',
    asyncHandler(async (req, res) => {
      res.json(
        await transferRequest(db, req.user, idParam(req), transferSchema.parse(req.body), auditContext(req)),
      );
    }),
  );

  router.post(
    '/requests/:id/manager',
    asyncHandler(async (req, res) => {
      res.json(
        await managerDecision(db, req.user, idParam(req), decisionSchema.parse(req.body), auditContext(req)),
      );
    }),
  );

  router.post(
    '/changes/:id/manager',
    asyncHandler(async (req, res) => {
      res.json(
        await changeManagerDecision(
          db,
          req.user,
          idParam(req),
          decisionSchema.parse(req.body),
          auditContext(req),
        ),
      );
    }),
  );

  router.get(
    '/hr',
    requirePerm('leave.approve_final'),
    asyncHandler(async (req, res) => {
      res.json(await hrQueue(db, req.user));
    }),
  );

  router.post(
    '/requests/:id/hr',
    requirePerm('leave.approve_final'),
    asyncHandler(async (req, res) => {
      res.json(
        await hrDecision(db, req.user, idParam(req), decisionSchema.parse(req.body), auditContext(req)),
      );
    }),
  );

  router.post(
    '/changes/:id/hr',
    requirePerm('leave.approve_final'),
    asyncHandler(async (req, res) => {
      res.json(
        await changeHrDecision(db, req.user, idParam(req), decisionSchema.parse(req.body), auditContext(req)),
      );
    }),
  );

  return router;
}

const adjustmentSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  leaveTypeId: z.coerce.number().int().positive(),
  year: z.coerce.number().int().min(2000).max(2100),
  amount: z.coerce
    .number()
    .refine((n) => n !== 0, 'cannot be zero')
    .refine((n) => Math.abs(n) <= 365, 'is too large')
    .refine((n) => Math.round(n * 100) === n * 100, 'can have at most 2 decimal places'),
  reason: z.string().trim().min(3, 'is required').max(500),
  kind: z.enum(['OPENING', 'ADJUSTMENT']),
});

/** HR Officer tools: balances and adjustments. */
export function hrRoutes({ db }) {
  const router = Router();
  router.use(requirePerm('leave.balances'));

  router.get(
    '/employees/:id/balances',
    asyncHandler(async (req, res) => {
      const employeeId = idParam(req);
      const year = yearParam(req.query);
      const items = await employeeBalances(db, employeeId, year, { activeOnly: false });
      const ledger = await db('balance_ledger as l')
        .join('leave_types as t', 't.id', 'l.leave_type_id')
        .leftJoin('employees as c', 'c.id', 'l.created_by')
        .where({ 'l.employee_id': employeeId, 'l.leave_year': year })
        .orderBy('l.id')
        .select('l.*', 't.name as type_name', 'c.first_name', 'c.last_name');
      res.json({
        year,
        items,
        ledger: ledger.map((l) => ({
          id: l.id,
          at: l.created_at,
          leaveType: l.type_name,
          entryType: l.entry_type,
          amount: Number(l.amount),
          reason: l.reason,
          by: l.first_name ? `${l.first_name} ${l.last_name}` : 'System',
        })),
      });
    }),
  );

  router.post(
    '/balances',
    asyncHandler(async (req, res) => {
      const input = adjustmentSchema.parse(req.body);
      const id = await recordAdjustment(db, input, auditContext(req));
      res.status(201).json({ ledgerEntryId: id });
    }),
  );

  return router;
}
