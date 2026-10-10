import { Router } from 'express';
import { z } from 'zod';
import { auditContext, requireRole } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, idParam, isoDate, optionalText } from '../../utils/validation.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { daysBetween } from '../leave/calendar.js';

const createSchema = z.object({
  delegateId: z.coerce.number().int().positive(),
  startDate: isoDate,
  endDate: isoDate,
  reason: optionalText(255),
});
const adminCreateSchema = createSchema.extend({ delegatorId: z.coerce.number().int().positive() });

const name = (f, l) => (f ? `${f} ${l}` : null);

function view(d, today) {
  const status = d.revoked_at
    ? 'REVOKED'
    : d.end_date < today
      ? 'ENDED'
      : d.start_date > today
        ? 'UPCOMING'
        : 'ACTIVE';
  return {
    id: d.id,
    delegator: { id: d.delegator_id, name: name(d.dr_first, d.dr_last) },
    delegate: { id: d.delegate_id, name: name(d.de_first, d.de_last) },
    startDate: d.start_date,
    endDate: d.end_date,
    reason: d.reason,
    status,
    createdBy: name(d.cb_first, d.cb_last),
    createdAt: d.created_at,
    revokedAt: d.revoked_at,
  };
}

function baseQuery(db) {
  return db('delegations as d')
    .join('employees as dr', 'dr.id', 'd.delegator_id')
    .join('employees as de', 'de.id', 'd.delegate_id')
    .leftJoin('employees as cb', 'cb.id', 'd.created_by')
    .select(
      'd.*',
      'dr.first_name as dr_first',
      'dr.last_name as dr_last',
      'de.first_name as de_first',
      'de.last_name as de_last',
      'cb.first_name as cb_first',
      'cb.last_name as cb_last',
    )
    .orderBy([
      { column: 'd.start_date', order: 'desc' },
      { column: 'd.id', order: 'desc' },
    ]);
}

/**
 * Create a delegation: the delegate may act at the manager stage for the delegator's team
 * between the dates. Checked here: real active people, sensible dates, no overlapping
 * delegation from the same manager (so it is always clear who is covering).
 */
async function createDelegation(db, { delegatorId, delegateId, startDate, endDate, reason }, actor, audit) {
  const today = todayInLusaka();
  if (delegatorId === delegateId) throw badRequest('Choose someone other than the manager.');
  if (endDate < startDate) throw badRequest('The end date must be on or after the start date.');
  if (endDate < today) throw badRequest('The delegation would already have ended.');
  if (daysBetween(startDate, endDate) > 366) throw badRequest('A delegation can last at most a year.');

  return db.transaction(async (trx) => {
    const delegator = await trx('employees').where({ id: delegatorId }).forUpdate().first();
    if (!delegator || delegator.status !== 'ACTIVE') throw notFound('Manager not found.');
    const reports = await trx('employees')
      .where({ line_manager_id: delegatorId, status: 'ACTIVE' })
      .count({ n: '*' })
      .first();
    if (Number(reports.n) === 0) {
      throw badRequest(`${delegator.first_name} ${delegator.last_name} has no direct reports to delegate.`);
    }
    const delegate = await trx('employees').where({ id: delegateId }).first();
    if (!delegate || delegate.status !== 'ACTIVE') throw badRequest('Choose an active employee to cover.');
    // A delegate who reports to the manager would approve colleagues' leave; allowed, but never their own
    // (the approval rules already refuse anyone acting on their own request).
    const overlap = await trx('delegations')
      .where({ delegator_id: delegatorId })
      .whereNull('revoked_at')
      .andWhere('start_date', '<=', endDate)
      .andWhere('end_date', '>=', startDate)
      .first('id', 'start_date', 'end_date');
    if (overlap) {
      throw conflict(
        `There is already a delegation for these dates (${overlap.start_date} to ${overlap.end_date}). Revoke it first.`,
      );
    }
    const [id] = await trx('delegations').insert({
      delegator_id: delegatorId,
      delegate_id: delegateId,
      start_date: startDate,
      end_date: endDate,
      reason: reason ?? null,
      created_by: actor.id,
    });
    await writeAudit(trx, {
      ...audit,
      action: 'DELEGATION_CREATED',
      entityType: 'delegation',
      entityId: id,
      after: { delegatorId, delegateId, startDate, endDate, reason: reason ?? null },
    });
    return id;
  });
}

async function revokeDelegation(db, id, actor, audit) {
  return db.transaction(async (trx) => {
    const d = await trx('delegations').where({ id }).forUpdate().first();
    if (!d) throw notFound('Delegation not found.');
    const isAdmin = actor.roles.includes('HR_ADMIN');
    if (d.delegator_id !== actor.id && !isAdmin) throw notFound('Delegation not found.');
    if (d.revoked_at) throw conflict('This delegation has already been revoked.');
    if (d.end_date < todayInLusaka()) throw conflict('This delegation has already ended.');
    await trx('delegations').where({ id }).update({ revoked_at: trx.fn.now(), revoked_by: actor.id });
    await writeAudit(trx, {
      ...audit,
      action: 'DELEGATION_REVOKED',
      entityType: 'delegation',
      entityId: id,
      before: {
        delegatorId: d.delegator_id,
        delegateId: d.delegate_id,
        startDate: d.start_date,
        endDate: d.end_date,
      },
    });
  });
}

/** A manager's own delegations, and cover they have been given. */
export function delegationRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const today = todayInLusaka();
      const given = await baseQuery(db).where('d.delegator_id', req.user.id).limit(50);
      const received = await baseQuery(db)
        .where('d.delegate_id', req.user.id)
        .whereNull('d.revoked_at')
        .andWhere('d.end_date', '>=', today);
      res.json({
        canDelegate: req.user.isManager,
        given: given.map((d) => view(d, today)),
        received: received.map((d) => view(d, today)),
      });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      if (!req.user.isManager) throw forbidden('Only managers with direct reports can delegate approvals.');
      const input = createSchema.parse(req.body);
      const id = await createDelegation(
        db,
        { ...input, delegatorId: req.user.id },
        req.user,
        auditContext(req),
      );
      res.status(201).json({ id });
    }),
  );

  router.post(
    '/:id/revoke',
    asyncHandler(async (req, res) => {
      await revokeDelegation(db, idParam(req), req.user, auditContext(req));
      res.json({ ok: true });
    }),
  );

  return router;
}

/** HR Administrators: every delegation, and set one up for a manager who is away unexpectedly. */
export function adminDelegationRoutes({ db }) {
  const router = Router();
  router.use(requireRole('HR_ADMIN'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const today = todayInLusaka();
      const current = req.query.scope !== 'all';
      const rows = await baseQuery(db)
        .modify((q) => current && q.whereNull('d.revoked_at').andWhere('d.end_date', '>=', today))
        .limit(200);
      res.json({ items: rows.map((d) => view(d, today)) });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = adminCreateSchema.parse(req.body);
      const id = await createDelegation(db, input, req.user, auditContext(req));
      res.status(201).json({ id });
    }),
  );

  return router;
}
