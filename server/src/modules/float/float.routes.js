import { Router } from 'express';
import { z } from 'zod';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notify.service.js';
import { asyncHandler, idParam, isoDate, optionalText, requiredText } from '../../utils/validation.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { addDays } from '../leave/calendar.js';
import { toXlsx } from '../reports/export-files.js';
import { generateWeek } from './float.jobs.js';
import {
  DAYS,
  KINDS,
  KIND_LABEL,
  accountsOf,
  amsBranches,
  businessDate,
  commissionFor,
  directors,
  getSettings,
  kwacha,
  lockedUntil,
  lowFloatCheck,
  managers,
  post,
  round2,
  runOutTime,
  staffBranch,
  weekEnding,
} from './float.service.js';

/*
 * AMS cash and float (D117), in the Inventory system, for Altus Money Solutions only.
 * Rights come from the inventory roles: float.record (branch staff, their own branch),
 * float.view_all, float.approve (manager), float.director, float.shortages (HR), float.admin.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EMAIL = { app: 'inventory' };
const name = (f, l) => [f, l].filter(Boolean).join(' ') || null;
const amount = z.coerce.number().positive('must be more than zero').max(100000000).transform(round2);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 17:30');

export function floatRoutes({ db }) {
  const router = Router();
  const f = (req) => req.rq;
  const must = (ok, msg) => {
    if (!ok) throw forbidden(msg);
  };

  /** The branch the request is about: staff are held to their own; others may choose. */
  async function branchFor(req, settings, wanted) {
    const mine = await staffBranch(db, settings, req.user.id);
    if (wanted && (f(req).floatViewAll || f(req).floatAdmin)) {
      const b = await db('stock_branches')
        .where({ id: wanted, company_id: settings.companyId })
        .first('id', 'name');
      if (!b) throw notFound('Branch not found.');
      return b;
    }
    if (!mine) throw badRequest('Your employee record has no AMS branch. Ask HR to post you to your branch.');
    return mine;
  }

  // ── Who the signed-in person is here ─────────────────────────────────────────────────────────
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const s = await getSettings(db);
      const company = s.companyId ? await db('companies').where({ id: s.companyId }).first('name') : null;
      const branch = await staffBranch(db, s, req.user.id);
      const c = f(req);
      const n = async (q) => Number((await q.count({ n: '*' }).first()).n);
      const approvals = c.floatApprove
        ? (await n(
            db('float_movements').where({ status: 'PENDING' }).whereNot('requested_by', req.user.id),
          )) +
          (await n(db('float_transactions').where({ status: 'REVERSAL_PENDING' }))) +
          (await n(db('float_variances').where({ status: 'OPEN' })))
        : 0;
      const director = c.floatDirector
        ? await n(db('float_variances').where({ status: 'PENDING_DIRECTOR' }))
        : 0;
      res.json({
        configured: Boolean(s.companyId),
        company: company?.name ?? null,
        branch,
        settings: { weekEndDay: s.weekEndDay, reportTime: s.reportTime, workingDays: s.workingDays },
        rights: {
          record: c.floatRecord,
          viewAll: c.floatViewAll,
          approve: c.floatApprove,
          director: c.floatDirector,
          shortages: c.floatShortages,
          admin: c.floatAdmin,
        },
        counts: {
          approvals: approvals + director,
          weeksToSign: c.floatApprove ? await n(db('float_weeks').where({ status: 'GENERATED' })) : 0,
        },
      });
    }),
  );

  // ── A branch today: balances, today's transactions and counts, open requests ─────────────────
  async function branchToday(branch, settings) {
    const today = await businessDate(db);
    const accounts = await accountsOf(db, branch.id);
    const out = await db('float_entries')
      .where({ branch_id: branch.id, business_date: today })
      .whereIn('entry_type', ['DEPOSIT', 'WITHDRAWAL'])
      .where('amount', '<', 0)
      .groupBy('account_id')
      .select('account_id')
      .sum({ s: 'amount' })
      .min({ first: 'created_at' });
    const O = new Map(out.map((o) => [o.account_id, o]));
    const txns = await db('float_transactions as t')
      .join('employees as e', 'e.id', 't.recorded_by')
      .where({ 't.branch_id': branch.id, 't.business_date': today })
      .orderBy('t.id', 'desc')
      .select('t.*', 'e.first_name', 'e.last_name');
    const counts = await db('float_counts as c')
      .join('employees as e', 'e.id', 'c.counted_by')
      .leftJoin('employees as h', 'h.id', 'c.handed_to')
      .where({ 'c.branch_id': branch.id, 'c.business_date': today })
      .orderBy('c.id')
      .select('c.*', 'e.first_name', 'e.last_name', 'h.first_name as h_first', 'h.last_name as h_last');
    const movements = await db('float_movements')
      .where((w) => w.where('to_branch_id', branch.id).orWhere('from_branch_id', branch.id))
      .where((w) => w.where('status', 'PENDING').orWhere('business_date', today))
      .orderBy('id', 'desc');
    return {
      branch,
      date: today,
      accounts: accounts.map((a) => ({
        id: a.id,
        kind: a.kind,
        label: KIND_LABEL[a.kind],
        balance: Number(a.balance),
        minBalance: Number(a.min_balance),
        low: Number(a.min_balance) > 0 && Number(a.balance) < Number(a.min_balance),
        runsOutAt: runOutTime(Number(a.balance), -Number(O.get(a.id)?.s ?? 0), O.get(a.id)?.first),
      })),
      transactions: txns.map((t) => ({
        id: t.id,
        network: t.network,
        kind: t.kind,
        amount: Number(t.amount),
        reference: t.reference,
        commission: Number(t.commission),
        status: t.status,
        isLarge: Boolean(t.is_large),
        by: name(t.first_name, t.last_name),
        at: t.recorded_at,
      })),
      totals: ['AIRTEL', 'MTN'].map((n) => ({
        network: n,
        deposits: round2(
          txns
            .filter((t) => t.network === n && t.kind === 'DEPOSIT' && t.status !== 'REVERSED')
            .reduce((s, t) => s + Number(t.amount), 0),
        ),
        withdrawals: round2(
          txns
            .filter((t) => t.network === n && t.kind === 'WITHDRAWAL' && t.status !== 'REVERSED')
            .reduce((s, t) => s + Number(t.amount), 0),
        ),
        count: txns.filter((t) => t.network === n && t.status !== 'REVERSED').length,
      })),
      counts: counts.map((c) => ({
        id: c.id,
        kind: c.kind,
        by: name(c.first_name, c.last_name),
        handedTo: name(c.h_first, c.h_last),
        at: c.created_at,
      })),
      closed: counts.some((c) => c.kind === 'CLOSE'),
      movements: movements.map(movementView),
      tolerance: settings.cashTolerance,
    };
  }
  const movementView = (m) => ({
    id: m.id,
    kind: m.kind,
    fromBranchId: m.from_branch_id,
    fromAccount: m.from_account,
    toBranchId: m.to_branch_id,
    toAccount: m.to_account,
    amount: Number(m.amount),
    reason: m.reason,
    status: m.status,
    requestedBy: m.requested_by,
    requestedAt: m.requested_at,
    decisionComment: m.decision_comment,
  });

  router.get(
    '/branch',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(c.floatRecord || c.floatViewAll || c.floatAdmin, 'You do not have access to AMS cash and float.');
      const s = await getSettings(db);
      const branch = await branchFor(req, s, req.query.branch ? Number(req.query.branch) : null);
      const staff = await db('employees')
        .where({ branch_id: branch.id, status: 'ACTIVE' })
        .orderBy('first_name')
        .select('id', 'first_name', 'last_name');
      res.json({
        ...(await branchToday(branch, s)),
        staff: staff.map((e) => ({ id: e.id, name: name(e.first_name, e.last_name) })),
        canRecord: c.floatRecord && (await staffBranch(db, s, req.user.id))?.id === branch.id,
      });
    }),
  );

  // ── Record a deposit or withdrawal: one tap moves both sides ─────────────────────────────────
  const txnSchema = z.object({
    network: z.enum(['AIRTEL', 'MTN']),
    kind: z.enum(['DEPOSIT', 'WITHDRAWAL']),
    amount,
    reference: optionalText(60),
    confirm: z.boolean().default(false),
  });
  router.post(
    '/transactions',
    asyncHandler(async (req, res) => {
      must(f(req).floatRecord, 'You cannot record AMS transactions.');
      const input = txnSchema.parse(req.body);
      const s = await getSettings(db);
      const branch = await staffBranch(db, s, req.user.id);
      if (!branch)
        throw badRequest('Your employee record has no AMS branch. Ask HR to post you to your branch.');
      const out = await db.transaction(async (trx) => {
        const date = await businessDate(trx);
        if (!input.confirm) {
          const since = new Date(Date.now() - s.duplicateMinutes * 60000);
          const dup = await trx('float_transactions')
            .where({
              branch_id: branch.id,
              network: input.network,
              kind: input.kind,
              amount: input.amount,
              recorded_by: req.user.id,
              status: 'POSTED',
            })
            .where('recorded_at', '>=', since)
            .first('id');
          if (dup) {
            throw new AppError(
              409,
              'POSSIBLE_DUPLICATE',
              'This looks like the same transaction again. Record it anyway?',
            );
          }
        }
        const commission = await commissionFor(trx, input.network, input.kind, input.amount);
        const [id] = await trx('float_transactions').insert({
          branch_id: branch.id,
          network: input.network,
          kind: input.kind,
          amount: input.amount,
          reference: input.reference,
          commission,
          business_date: date,
          recorded_by: req.user.id,
          is_large: input.amount >= s.largeAmount,
        });
        const sign = input.kind === 'DEPOSIT' ? 1 : -1;
        const base = { branchId: branch.id, date, by: req.user.id, transactionId: id, type: input.kind };
        // Take from the side that pays out first, so a shortfall stops the whole transaction.
        const legs =
          input.kind === 'DEPOSIT'
            ? [
                [input.network, -input.amount],
                ['CASH', input.amount],
              ]
            : [
                ['CASH', -input.amount],
                [input.network, input.amount],
              ];
        const results = [];
        for (const [kind, amt] of legs) {
          const r = await post(trx, { ...base, kind, amount: amt });
          results.push({ kind, ...r });
          if (amt < 0)
            await lowFloatCheck(trx, {
              branchId: branch.id,
              kind,
              before: r.before,
              after: r.after,
              account: r.account,
            });
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: `FLOAT_${input.kind}`,
          entityType: 'float_transaction',
          entityId: id,
          after: {
            branch: branch.name,
            network: input.network,
            amount: input.amount * sign,
            reference: input.reference,
          },
        });
        return { id, commission, balances: Object.fromEntries(results.map((r) => [r.kind, r.after])) };
      });
      res.status(201).json(out);
    }),
  );

  // Reversal: asked for by branch staff (with a reason), decided by a manager.
  router.post(
    '/transactions/:id/reverse',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const { reason } = z.object({ reason: requiredText(500) }).parse(req.body);
      const s = await getSettings(db);
      await db.transaction(async (trx) => {
        const t = await trx('float_transactions').where({ id }).forUpdate().first();
        if (!t) throw notFound('Transaction not found.');
        const mine = await staffBranch(trx, s, req.user.id);
        must(
          f(req).floatApprove || (f(req).floatRecord && mine?.id === t.branch_id),
          'You cannot reverse this transaction.',
        );
        if (t.status !== 'POSTED')
          throw conflict('This transaction is already reversed or waiting for a decision.');
        const locked = await lockedUntil(trx);
        if (locked && t.business_date <= locked)
          throw conflict('That week has been signed off and is locked.');
        await trx('float_transactions').where({ id }).update({
          status: 'REVERSAL_PENDING',
          reversal_reason: reason,
          reversal_requested_by: req.user.id,
          reversal_requested_at: trx.fn.now(),
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_REVERSAL_REQUESTED',
          entityType: 'float_transaction',
          entityId: id,
          after: { reason },
        });
        await notify(trx, {
          recipients: await managers(trx, [req.user.id]),
          event: 'FLOAT_REVERSAL_TO_APPROVE',
          title: `Reversal to approve: ${KIND_LABEL[t.network]} ${t.kind.toLowerCase()} ${kwacha(t.amount)}`,
          body: reason,
          link: '/requisitions/float/approvals',
          entityType: 'float_transaction',
          entityId: id,
        });
      });
      res.json({ id });
    }),
  );
  const decideSchema = z.object({ approve: z.boolean(), comment: optionalText(500) });
  router.post(
    '/transactions/:id/reversal',
    asyncHandler(async (req, res) => {
      must(f(req).floatApprove, 'Only a manager can decide reversals.');
      const id = idParam(req);
      const { approve, comment } = decideSchema.parse(req.body);
      await db.transaction(async (trx) => {
        const t = await trx('float_transactions').where({ id }).forUpdate().first();
        if (!t || t.status !== 'REVERSAL_PENDING')
          throw conflict('This reversal is not waiting for a decision.');
        if (t.reversal_requested_by === req.user.id)
          throw forbidden('Someone else must approve your own reversal request.');
        if (approve) {
          const date = await businessDate(trx);
          const legs = await trx('float_entries as e')
            .join('float_accounts as a', 'a.id', 'e.account_id')
            .where('e.transaction_id', id)
            .whereNot('e.entry_type', 'REVERSAL')
            .select('a.kind', 'e.amount');
          for (const l of [...legs].sort((x, y) => Number(y.amount) - Number(x.amount))) {
            await post(trx, {
              branchId: t.branch_id,
              kind: l.kind,
              amount: -Number(l.amount),
              type: 'REVERSAL',
              date,
              by: req.user.id,
              transactionId: id,
            });
          }
        }
        await trx('float_transactions')
          .where({ id })
          .update({
            status: approve ? 'REVERSED' : 'POSTED',
            reversal_decided_by: req.user.id,
            reversal_decided_at: trx.fn.now(),
          });
        await writeAudit(trx, {
          ...auditContext(req),
          action: approve ? 'FLOAT_REVERSED' : 'FLOAT_REVERSAL_REFUSED',
          entityType: 'float_transaction',
          entityId: id,
          after: { comment },
        });
        await notify(trx, {
          recipients: [t.reversal_requested_by],
          event: approve ? 'FLOAT_REVERSED' : 'FLOAT_REVERSAL_REFUSED',
          title: `Reversal ${approve ? 'approved' : 'not approved'}: ${kwacha(t.amount)}`,
          body: comment ?? (approve ? 'The balances have been put back.' : 'The transaction stands.'),
          link: '/requisitions/float/branch',
          entityType: 'float_transaction',
          entityId: id,
        });
      });
      res.json({ id });
    }),
  );
  router.post(
    '/transactions/:id/reviewed',
    asyncHandler(async (req, res) => {
      must(f(req).floatApprove, 'Only a manager reviews large transactions.');
      const id = idParam(req);
      const n = await db('float_transactions')
        .where({ id, is_large: true })
        .whereNull('large_reviewed_at')
        .update({ large_reviewed_by: req.user.id, large_reviewed_at: db.fn.now() });
      if (!n) throw conflict('Already reviewed.');
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_LARGE_REVIEWED',
        entityType: 'float_transaction',
        entityId: id,
      });
      res.json({ id });
    }),
  );

  // ── Day close and shift handover ─────────────────────────────────────────────────────────────
  const countSchema = z.object({
    kind: z.enum(['CLOSE', 'HANDOVER']),
    handedTo: z.coerce.number().int().positive().nullish(),
    lines: z
      .array(z.object({ kind: z.enum(KINDS), counted: z.coerce.number().min(0).max(100000000) }))
      .min(1),
    denominations: z.record(z.string(), z.coerce.number().int().min(0).max(100000)).nullish(),
    notes: optionalText(500),
  });
  router.post(
    '/counts',
    asyncHandler(async (req, res) => {
      must(f(req).floatRecord, 'You cannot count at an AMS branch.');
      const input = countSchema.parse(req.body);
      const s = await getSettings(db);
      const branch = await staffBranch(db, s, req.user.id);
      if (!branch) throw badRequest('Your employee record has no AMS branch.');
      if (input.kind === 'HANDOVER' && !input.handedTo)
        throw badRequest('Choose who you are handing over to.');
      const out = await db.transaction(async (trx) => {
        const date = await businessDate(trx);
        const [countId] = await trx('float_counts').insert({
          branch_id: branch.id,
          kind: input.kind,
          business_date: date,
          counted_by: req.user.id,
          handed_to: input.handedTo ?? null,
          denominations: input.denominations ? JSON.stringify(input.denominations) : null,
          notes: input.notes,
        });
        const results = [];
        for (const line of input.lines) {
          const acc = await trx('float_accounts')
            .where({ branch_id: branch.id, kind: line.kind })
            .forUpdate()
            .first();
          if (!acc) continue;
          const expected = Number(acc.balance);
          const counted = round2(line.counted);
          const difference = round2(counted - expected);
          await trx('float_count_lines').insert({
            count_id: countId,
            account_id: acc.id,
            expected,
            counted,
            difference,
          });
          let varianceId = null;
          if (Math.abs(difference) > s.cashTolerance) {
            [varianceId] = await trx('float_variances').insert({
              count_id: countId,
              branch_id: branch.id,
              account_id: acc.id,
              employee_id: req.user.id,
              business_date: date,
              amount: difference,
            });
          }
          // The books now match what was counted.
          if (difference !== 0) {
            await post(trx, {
              branchId: branch.id,
              kind: line.kind,
              amount: difference,
              type: 'VARIANCE',
              date,
              by: req.user.id,
              varianceId,
              allowNegative: true,
            });
          }
          results.push({ kind: line.kind, expected, counted, difference, recorded: Boolean(varianceId) });
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: input.kind === 'CLOSE' ? 'FLOAT_DAY_CLOSED' : 'FLOAT_HANDOVER',
          entityType: 'float_count',
          entityId: countId,
          after: { branch: branch.name, results },
        });
        const off = results.filter((r) => r.recorded);
        if (off.length) {
          const text = off
            .map(
              (r) =>
                `${KIND_LABEL[r.kind]} ${r.difference > 0 ? 'surplus' : 'deficit'} ${kwacha(Math.abs(r.difference))}`,
            )
            .join(', ');
          await notify(trx, {
            recipients: await managers(trx, [req.user.id]),
            event: 'FLOAT_VARIANCE',
            title: `${input.kind === 'CLOSE' ? 'Day close' : 'Handover'} at ${branch.name}: ${text}`,
            body: 'Resolve it on Surplus and deficit.',
            link: '/requisitions/float/variances',
            entityType: 'float_count',
            entityId: countId,
            email: {
              ...EMAIL,
              subject: `Count difference at ${branch.name}`,
              heading: 'Count difference',
              intro: `The ${input.kind === 'CLOSE' ? 'day close' : 'shift handover'} at ${branch.name} did not match the books.`,
              rows: off.map((r) => [
                KIND_LABEL[r.kind],
                `${r.difference > 0 ? 'Surplus' : 'Deficit'} ${kwacha(Math.abs(r.difference))}`,
              ]),
              action: 'Please resolve it in the inventory system.',
            },
          });
        }
        return { id: countId, results };
      });
      res.status(201).json(out);
    }),
  );

  // ── Top-ups and transfers ────────────────────────────────────────────────────────────────────
  const moveSchema = z.object({
    kind: z.enum(['TOPUP', 'TRANSFER']),
    toBranchId: z.coerce.number().int().positive().nullish(),
    toAccount: z.enum(KINDS),
    fromBranchId: z.coerce.number().int().positive().nullish(),
    fromAccount: z.enum(KINDS).nullish(),
    amount,
    reason: optionalText(500),
  });
  router.post(
    '/movements',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(c.floatRecord || c.floatApprove, 'You cannot ask for top-ups or transfers.');
      const input = moveSchema.parse(req.body);
      const s = await getSettings(db);
      const ams = new Set((await amsBranches(db, s, { activeOnly: true })).map((b) => b.id));
      const mine = await staffBranch(db, s, req.user.id);
      const to = input.toBranchId ?? mine?.id;
      if (!to || !ams.has(to)) throw badRequest('Choose the AMS branch it goes to.');
      if (!c.floatApprove && to !== mine?.id)
        throw forbidden('You can ask for top-ups for your own branch only.');
      if (input.kind === 'TRANSFER') {
        if (!input.fromBranchId || !ams.has(input.fromBranchId) || !input.fromAccount)
          throw badRequest('Choose where the money comes from.');
        if (input.fromBranchId === to && input.fromAccount === input.toAccount)
          throw badRequest('Choose a different account to move it to.');
      }
      const id = await db.transaction(async (trx) => {
        const [newId] = await trx('float_movements').insert({
          kind: input.kind,
          from_branch_id: input.kind === 'TRANSFER' ? input.fromBranchId : null,
          from_account: input.kind === 'TRANSFER' ? input.fromAccount : null,
          to_branch_id: to,
          to_account: input.toAccount,
          amount: input.amount,
          reason: input.reason,
          requested_by: req.user.id,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: `FLOAT_${input.kind}_REQUESTED`,
          entityType: 'float_movement',
          entityId: newId,
          after: input,
        });
        const b = await trx('stock_branches').where({ id: to }).first('name');
        await notify(trx, {
          recipients: await managers(trx, [req.user.id]),
          event: 'FLOAT_MOVEMENT_TO_APPROVE',
          title: `${input.kind === 'TOPUP' ? 'Top-up' : 'Transfer'} to approve: ${KIND_LABEL[input.toAccount]} ${kwacha(input.amount)} for ${b.name}`,
          body: input.reason ?? '',
          link: '/requisitions/float/approvals',
          entityType: 'float_movement',
          entityId: newId,
          email: {
            ...EMAIL,
            subject: `${input.kind === 'TOPUP' ? 'Top-up' : 'Transfer'} to approve for ${b.name}`,
            heading: `${input.kind === 'TOPUP' ? 'Top-up' : 'Transfer'} to approve`,
            intro: `${b.name} needs ${KIND_LABEL[input.toAccount]}.`,
            rows: [['Amount', kwacha(input.amount)], ...(input.reason ? [['Reason', input.reason]] : [])],
            action: 'Approve or refuse it in the inventory system.',
          },
        });
        return newId;
      });
      res.status(201).json({ id });
    }),
  );
  router.post(
    '/movements/:id/decide',
    asyncHandler(async (req, res) => {
      must(f(req).floatApprove, 'Only a manager approves top-ups and transfers.');
      const id = idParam(req);
      const { approve, comment } = decideSchema.parse(req.body);
      await db.transaction(async (trx) => {
        const m = await trx('float_movements').where({ id }).forUpdate().first();
        if (!m || m.status !== 'PENDING') throw conflict('This is not waiting for a decision.');
        if (m.requested_by === req.user.id) throw forbidden('Someone else must approve your own request.');
        const date = await businessDate(trx);
        if (approve) {
          const amt = Number(m.amount);
          if (m.kind === 'TRANSFER') {
            await post(trx, {
              branchId: m.from_branch_id,
              kind: m.from_account,
              amount: -amt,
              type: 'TRANSFER_OUT',
              date,
              by: req.user.id,
              movementId: id,
            });
            await post(trx, {
              branchId: m.to_branch_id,
              kind: m.to_account,
              amount: amt,
              type: 'TRANSFER_IN',
              date,
              by: req.user.id,
              movementId: id,
            });
          } else {
            await post(trx, {
              branchId: m.to_branch_id,
              kind: m.to_account,
              amount: amt,
              type: 'TOPUP',
              date,
              by: req.user.id,
              movementId: id,
            });
          }
        }
        await trx('float_movements')
          .where({ id })
          .update({
            status: approve ? 'APPROVED' : 'REJECTED',
            decided_by: req.user.id,
            decided_at: trx.fn.now(),
            decision_comment: comment,
            business_date: approve ? date : null,
          });
        await writeAudit(trx, {
          ...auditContext(req),
          action: `FLOAT_${m.kind}_${approve ? 'APPROVED' : 'REFUSED'}`,
          entityType: 'float_movement',
          entityId: id,
          after: { comment },
        });
        await notify(trx, {
          recipients: [m.requested_by],
          event: approve ? 'FLOAT_MOVEMENT_APPROVED' : 'FLOAT_MOVEMENT_REFUSED',
          title: `${m.kind === 'TOPUP' ? 'Top-up' : 'Transfer'} ${approve ? 'approved' : 'not approved'}: ${KIND_LABEL[m.to_account]} ${kwacha(m.amount)}`,
          body: comment ?? (approve ? 'The balance has been updated.' : ''),
          link: '/requisitions/float/branch',
          entityType: 'float_movement',
          entityId: id,
        });
      });
      res.json({ id });
    }),
  );
  router.post(
    '/movements/:id/cancel',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const n = await db('float_movements')
        .where({ id, status: 'PENDING', requested_by: req.user.id })
        .update({ status: 'CANCELLED' });
      if (!n) throw conflict('Only your own pending request can be cancelled.');
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_MOVEMENT_CANCELLED',
        entityType: 'float_movement',
        entityId: id,
      });
      res.json({ id });
    }),
  );

  // ── Approvals: everything waiting for a manager or a director ────────────────────────────────
  const branchNames = async () =>
    new Map((await db('stock_branches').select('id', 'name')).map((b) => [b.id, b.name]));
  router.get(
    '/approvals',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(c.floatApprove || c.floatDirector, 'You do not approve anything in AMS cash and float.');
      const B = await branchNames();
      const who = async (ids) =>
        new Map(
          (
            await db('employees')
              .whereIn('id', [...new Set(ids.filter(Boolean))])
              .select('id', 'first_name', 'last_name')
          ).map((e) => [e.id, name(e.first_name, e.last_name)]),
        );
      const movements = c.floatApprove
        ? await db('float_movements').where({ status: 'PENDING' }).orderBy('id')
        : [];
      const reversals = c.floatApprove
        ? await db('float_transactions').where({ status: 'REVERSAL_PENDING' }).orderBy('id')
        : [];
      const large = c.floatApprove
        ? await db('float_transactions')
            .where({ is_large: true })
            .whereNull('large_reviewed_at')
            .whereNot('status', 'REVERSED')
            .orderBy('id')
        : [];
      const variances = await varianceRows()
        .whereIn('v.status', [
          ...(c.floatApprove ? ['OPEN'] : []),
          ...(c.floatDirector ? ['PENDING_DIRECTOR'] : []),
        ])
        .orderBy('v.id');
      const P = await who([
        ...movements.map((m) => m.requested_by),
        ...reversals.map((t) => t.reversal_requested_by),
        ...large.map((t) => t.recorded_by),
      ]);
      res.json({
        me: req.user.id,
        movements: movements.map((m) => ({
          ...movementView(m),
          toBranch: B.get(m.to_branch_id),
          fromBranch: m.from_branch_id ? B.get(m.from_branch_id) : null,
          requestedByName: P.get(m.requested_by),
        })),
        reversals: reversals.map((t) => ({
          id: t.id,
          branch: B.get(t.branch_id),
          network: t.network,
          kind: t.kind,
          amount: Number(t.amount),
          reason: t.reversal_reason,
          requestedBy: t.reversal_requested_by,
          requestedByName: P.get(t.reversal_requested_by),
          at: t.recorded_at,
        })),
        large: large.map((t) => ({
          id: t.id,
          branch: B.get(t.branch_id),
          network: t.network,
          kind: t.kind,
          amount: Number(t.amount),
          reference: t.reference,
          by: P.get(t.recorded_by),
          at: t.recorded_at,
        })),
        variances: variances.map(varianceView),
      });
    }),
  );

  // ── Surplus and deficit ──────────────────────────────────────────────────────────────────────
  const varianceRows = () =>
    db('float_variances as v')
      .join('stock_branches as b', 'b.id', 'v.branch_id')
      .join('float_accounts as a', 'a.id', 'v.account_id')
      .join('float_counts as c', 'c.id', 'v.count_id')
      .leftJoin('employees as e', 'e.id', 'v.employee_id')
      .leftJoin('employees as r', 'r.id', 'v.resolved_by')
      .select(
        'v.*',
        'b.name as branch',
        'a.kind',
        'c.kind as count_kind',
        'e.first_name',
        'e.last_name',
        'r.first_name as r_first',
        'r.last_name as r_last',
      );
  const varianceView = (v) => ({
    id: v.id,
    branch: v.branch,
    branchId: v.branch_id,
    account: v.kind,
    countKind: v.count_kind,
    date: v.business_date,
    amount: Number(v.amount),
    type: Number(v.amount) > 0 ? 'SURPLUS' : 'DEFICIT',
    employee: v.employee_id ? { id: v.employee_id, firstName: v.first_name, lastName: v.last_name } : null,
    status: v.status,
    resolution: v.resolution,
    comment: v.comment,
    resolvedBy: name(v.r_first, v.r_last),
    resolvedAt: v.resolved_at,
  });
  router.get(
    '/variances',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(
        c.floatViewAll || c.floatApprove || c.floatShortages,
        'You do not have access to surpluses and deficits.',
      );
      const hrOnly = c.floatShortages && !c.floatViewAll && !c.floatApprove;
      const rows = await varianceRows()
        .modify((q) => hrOnly && q.where('v.amount', '<', 0).whereNotNull('v.employee_id'))
        .modify((q) => req.query.status && q.where('v.status', String(req.query.status)))
        .modify((q) => req.query.from && q.where('v.business_date', '>=', String(req.query.from)))
        .modify((q) => req.query.to && q.where('v.business_date', '<=', String(req.query.to)))
        .orderBy('v.id', 'desc')
        .limit(2000);
      // Per member of staff: how many deficits and how much.
      const byStaff = new Map();
      for (const v of rows.filter((r) => Number(r.amount) < 0 && r.employee_id)) {
        const s = byStaff.get(v.employee_id) ?? {
          id: v.employee_id,
          firstName: v.first_name,
          lastName: v.last_name,
          count: 0,
          total: 0,
        };
        s.count += 1;
        s.total = round2(s.total + Math.abs(Number(v.amount)));
        byStaff.set(v.employee_id, s);
      }
      res.json({
        items: rows.map(varianceView),
        byStaff: [...byStaff.values()].sort((a, b) => b.total - a.total),
        canResolve: c.floatApprove,
        canDirector: c.floatDirector,
        hrOnly,
      });
    }),
  );
  const resolveSchema = z.object({
    resolution: z.enum(['EXPLAINED', 'RECOVERED', 'WRITTEN_OFF']),
    comment: requiredText(1000),
  });
  router.post(
    '/variances/:id/resolve',
    asyncHandler(async (req, res) => {
      must(f(req).floatApprove, 'Only a manager resolves surpluses and deficits.');
      const id = idParam(req);
      const input = resolveSchema.parse(req.body);
      const s = await getSettings(db);
      await db.transaction(async (trx) => {
        const v = await trx('float_variances as v')
          .join('float_accounts as a', 'a.id', 'v.account_id')
          .where('v.id', id)
          .forUpdate()
          .first('v.*', 'a.kind');
        if (!v || v.status !== 'OPEN') throw conflict('This is not waiting to be resolved.');
        const amt = Number(v.amount);
        if (input.resolution === 'RECOVERED' && amt >= 0)
          throw badRequest('Only a deficit can be recovered.');
        const toDirector = input.resolution === 'WRITTEN_OFF' && Math.abs(amt) > s.directorLimit;
        if (input.resolution === 'RECOVERED') {
          // The money paid back goes back into the account.
          await post(trx, {
            branchId: v.branch_id,
            kind: v.kind,
            amount: Math.abs(amt),
            type: 'RECOVERY',
            date: await businessDate(trx),
            by: req.user.id,
            varianceId: id,
          });
        }
        await trx('float_variances')
          .where({ id })
          .update({
            status: toDirector ? 'PENDING_DIRECTOR' : input.resolution,
            resolution: input.resolution,
            comment: input.comment,
            resolved_by: req.user.id,
            resolved_at: trx.fn.now(),
          });
        await writeAudit(trx, {
          ...auditContext(req),
          action: `FLOAT_VARIANCE_${input.resolution}`,
          entityType: 'float_variance',
          entityId: id,
          after: input,
        });
        if (toDirector) {
          await notify(trx, {
            recipients: await directors(trx, [req.user.id]),
            event: 'FLOAT_WRITE_OFF_TO_APPROVE',
            title: `Write-off to approve: ${kwacha(Math.abs(amt))} ${KIND_LABEL[v.kind]}`,
            body: input.comment,
            link: '/requisitions/float/approvals',
            entityType: 'float_variance',
            entityId: id,
            email: {
              ...EMAIL,
              subject: `Write-off to approve: ${kwacha(Math.abs(amt))}`,
              heading: 'Write-off to approve',
              intro: `A manager wants to write off a ${amt < 0 ? 'deficit' : 'surplus'} above the ${kwacha(s.directorLimit)} limit.`,
              rows: [
                ['Amount', kwacha(Math.abs(amt))],
                ['Reason', input.comment],
              ],
              action: 'Approve or refuse it in the inventory system.',
            },
          });
        }
      });
      res.json({ id });
    }),
  );
  router.post(
    '/variances/:id/director',
    asyncHandler(async (req, res) => {
      must(f(req).floatDirector, 'Only a director approves these write-offs.');
      const id = idParam(req);
      const { approve, comment } = decideSchema.parse(req.body);
      await db.transaction(async (trx) => {
        const v = await trx('float_variances').where({ id }).forUpdate().first();
        if (!v || v.status !== 'PENDING_DIRECTOR') throw conflict('This is not waiting for a director.');
        await trx('float_variances')
          .where({ id })
          .update(
            approve
              ? { status: 'WRITTEN_OFF', director_by: req.user.id, director_at: trx.fn.now() }
              : { status: 'OPEN', resolution: null, comment: comment ? `Director: ${comment}` : v.comment },
          );
        await writeAudit(trx, {
          ...auditContext(req),
          action: approve ? 'FLOAT_WRITE_OFF_APPROVED' : 'FLOAT_WRITE_OFF_REFUSED',
          entityType: 'float_variance',
          entityId: id,
          after: { comment },
        });
        if (v.resolved_by) {
          await notify(trx, {
            recipients: [v.resolved_by],
            event: approve ? 'FLOAT_WRITE_OFF_APPROVED' : 'FLOAT_WRITE_OFF_REFUSED',
            title: `Write-off ${approve ? 'approved' : 'not approved'}: ${kwacha(Math.abs(v.amount))}`,
            body: comment ?? '',
            link: '/requisitions/float/variances',
            entityType: 'float_variance',
            entityId: id,
          });
        }
      });
      res.json({ id });
    }),
  );

  // ── Dashboard: every AMS branch live ─────────────────────────────────────────────────────────
  router.get(
    '/dashboard',
    asyncHandler(async (req, res) => {
      must(f(req).floatViewAll || f(req).floatAdmin, 'You do not have access to the AMS dashboard.');
      const s = await getSettings(db);
      const branches = await amsBranches(db, s, { activeOnly: true });
      const today = await businessDate(db);
      const list = [];
      for (const b of branches) list.push(await branchToday(b, s));
      const openVariances = await db('float_variances')
        .whereIn('status', ['OPEN', 'PENDING_DIRECTOR'])
        .groupBy('branch_id')
        .select('branch_id')
        .count({ n: '*' });
      const OV = new Map(openVariances.map((r) => [r.branch_id, Number(r.n)]));
      // Rebalancing: an account below its minimum, and branches with plenty of the same.
      const suggestions = [];
      for (const b of list) {
        for (const a of b.accounts.filter((x) => x.low || x.runsOutAt)) {
          const need = round2(Math.max(a.minBalance * 2 - a.balance, a.minBalance - a.balance, 0));
          if (!need) continue;
          const from = list
            .filter((o) => o.branch.id !== b.branch.id)
            .map((o) => ({ branch: o.branch, acc: o.accounts.find((x) => x.kind === a.kind) }))
            .filter((o) => o.acc && o.acc.balance - o.acc.minBalance * 1.5 >= need)
            .sort((x, y) => y.acc.balance - y.acc.minBalance - (x.acc.balance - x.acc.minBalance))[0];
          suggestions.push({
            toBranch: b.branch,
            account: a.kind,
            need,
            runsOutAt: a.runsOutAt,
            from: from
              ? {
                  id: from.branch.id,
                  name: from.branch.name,
                  spare: round2(from.acc.balance - from.acc.minBalance),
                }
              : null,
          });
        }
      }
      const total = (k) =>
        round2(list.reduce((sum, b) => sum + (b.accounts.find((a) => a.kind === k)?.balance ?? 0), 0));
      const week = await db('float_weeks')
        .orderBy('period_end', 'desc')
        .first('id', 'period_start', 'period_end', 'status');
      res.json({
        date: today,
        totals: {
          CASH: total('CASH'),
          AIRTEL: total('AIRTEL'),
          MTN: total('MTN'),
          deposits: round2(list.reduce((sum, b) => sum + b.totals.reduce((x, t) => x + t.deposits, 0), 0)),
          withdrawals: round2(
            list.reduce((sum, b) => sum + b.totals.reduce((x, t) => x + t.withdrawals, 0), 0),
          ),
          transactions: list.reduce((sum, b) => sum + b.totals.reduce((x, t) => x + t.count, 0), 0),
        },
        branches: list.map((b) => ({
          id: b.branch.id,
          name: b.branch.name,
          accounts: b.accounts,
          totals: b.totals,
          closed: b.closed,
          openVariances: OV.get(b.branch.id) ?? 0,
          pending: b.movements.filter((m) => m.status === 'PENDING').length,
        })),
        suggestions,
        lastWeek: week
          ? { id: week.id, start: week.period_start, end: week.period_end, status: week.status }
          : null,
        isWorkingDay: s.workingDays.includes(DAYS[(new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7]),
      });
    }),
  );

  // Transactions over a period, for the dashboard list and Excel.
  router.get(
    '/transactions',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(c.floatViewAll || c.floatRecord, 'You do not have access to AMS transactions.');
      const s = await getSettings(db);
      const mine = await staffBranch(db, s, req.user.id);
      const branchId = c.floatViewAll ? (req.query.branch ? Number(req.query.branch) : null) : mine?.id;
      if (!c.floatViewAll && !branchId) throw badRequest('Your employee record has no AMS branch.');
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? ''))
        ? String(req.query.from)
        : addDays(todayInLusaka(), -6);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to ?? ''))
        ? String(req.query.to)
        : addDays(todayInLusaka(), 1);
      const ams = (await amsBranches(db, s)).map((b) => b.id);
      const rows = await db('float_transactions as t')
        .join('stock_branches as b', 'b.id', 't.branch_id')
        .join('employees as e', 'e.id', 't.recorded_by')
        .whereIn('t.branch_id', branchId ? [branchId] : ams.length ? ams : [0])
        .whereBetween('t.business_date', [from, to])
        .orderBy('t.id', 'desc')
        .limit(20000)
        .select('t.*', 'b.name as branch', 'e.first_name', 'e.last_name');
      const items = rows.map((t) => ({
        id: t.id,
        date: t.business_date,
        at: t.recorded_at,
        branch: t.branch,
        network: t.network,
        kind: t.kind,
        amount: Number(t.amount),
        commission: Number(t.commission),
        reference: t.reference,
        status: t.status,
        firstName: t.first_name,
        lastName: t.last_name,
      }));
      if (req.query.format === 'xlsx') {
        const STATUS = { POSTED: 'Recorded', REVERSAL_PENDING: 'Reversal requested', REVERSED: 'Reversed' };
        return res
          .set('Content-Type', XLSX)
          .set('Content-Disposition', `attachment; filename="AMS transactions ${from} to ${to}.xlsx"`)
          .set('Cache-Control', 'private, no-store')
          .send(
            toXlsx(
              [
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'branch', label: 'Branch' },
                { key: 'network', label: 'Network' },
                { key: 'kind', label: 'Type' },
                { key: 'amount', label: 'Amount (K)', type: 'number' },
                { key: 'commission', label: 'Commission (K)', type: 'number' },
                { key: 'reference', label: 'Reference' },
                { key: 'firstName', label: 'First name' },
                { key: 'lastName', label: 'Last name' },
                { key: 'status', label: 'Status' },
              ],
              items.map((i) => ({
                ...i,
                network: i.network === 'AIRTEL' ? 'Airtel Money' : 'MTN MoMo',
                kind: i.kind === 'DEPOSIT' ? 'Deposit' : 'Withdrawal',
                status: STATUS[i.status],
              })),
              { sheetName: 'AMS transactions', title: `AMS transactions ${from} to ${to}` },
            ),
          );
      }
      res.json({ from, to, items });
    }),
  );

  // ── Weekly reports ───────────────────────────────────────────────────────────────────────────
  const weekView = (w) => ({
    id: w.id,
    start: w.period_start,
    end: w.period_end,
    status: w.status,
    generatedAt: w.generated_at,
    signedAt: w.signed_at,
    signComment: w.sign_comment,
  });
  router.get(
    '/weeks',
    asyncHandler(async (req, res) => {
      must(f(req).floatViewAll, 'You do not have access to AMS weekly reports.');
      const rows = await db('float_weeks as w')
        .leftJoin('employees as e', 'e.id', 'w.signed_by')
        .orderBy('w.period_end', 'desc')
        .select('w.*', 'e.first_name', 'e.last_name');
      res.json({
        items: rows.map((w) => ({
          ...weekView(w),
          signedBy: name(w.first_name, w.last_name),
          totals: (typeof w.data === 'string' ? JSON.parse(w.data) : w.data).totals,
        })),
        canSignOff: f(req).floatApprove,
      });
    }),
  );
  router.get(
    '/weeks/:id',
    asyncHandler(async (req, res) => {
      must(f(req).floatViewAll, 'You do not have access to AMS weekly reports.');
      const w = await db('float_weeks as w')
        .leftJoin('employees as e', 'e.id', 'w.signed_by')
        .where('w.id', idParam(req))
        .first('w.*', 'e.first_name', 'e.last_name');
      if (!w) throw notFound('Weekly report not found.');
      const data = typeof w.data === 'string' ? JSON.parse(w.data) : w.data;
      if (req.query.format === 'xlsx') {
        const rows = data.branches.flatMap((b) =>
          b.accounts.map((a) => ({
            branch: b.name,
            account: KIND_LABEL[a.kind],
            opening: a.opening,
            deposits: a.deposits,
            withdrawals: a.withdrawals,
            topups: a.topups,
            transfersIn: a.transfersIn,
            transfersOut: a.transfersOut,
            reversals: a.reversals,
            differences: a.countDifferences,
            closing: a.closing,
          })),
        );
        return res
          .set('Content-Type', XLSX)
          .set(
            'Content-Disposition',
            `attachment; filename="AMS weekly report ${w.period_start} to ${w.period_end}.xlsx"`,
          )
          .set('Cache-Control', 'private, no-store')
          .send(
            toXlsx(
              [
                { key: 'branch', label: 'Branch' },
                { key: 'account', label: 'Account' },
                { key: 'opening', label: 'Opening (K)', type: 'number' },
                { key: 'deposits', label: 'Deposits (K)', type: 'number' },
                { key: 'withdrawals', label: 'Withdrawals (K)', type: 'number' },
                { key: 'topups', label: 'Top-ups (K)', type: 'number' },
                { key: 'transfersIn', label: 'Transfers in (K)', type: 'number' },
                { key: 'transfersOut', label: 'Transfers out (K)', type: 'number' },
                { key: 'reversals', label: 'Reversals (K)', type: 'number' },
                { key: 'differences', label: 'Count differences (K)', type: 'number' },
                { key: 'closing', label: 'Closing (K)', type: 'number' },
              ],
              rows,
              { sheetName: 'Weekly report', title: `AMS weekly report ${w.period_start} to ${w.period_end}` },
            ),
          );
      }
      res.json({
        ...weekView(w),
        signedBy: name(w.first_name, w.last_name),
        data,
        canSignOff: f(req).floatApprove && w.status === 'GENERATED',
      });
    }),
  );
  // Make the report for the latest finished week now (if the scheduled run was missed).
  router.post(
    '/weeks/generate',
    asyncHandler(async (req, res) => {
      must(f(req).floatApprove || f(req).floatAdmin, 'You cannot make the weekly report.');
      const s = await getSettings(db);
      if (!s.companyId) throw badRequest('Choose the AMS company in AMS settings first.');
      const { end } = weekEnding(s, todayInLusaka());
      const id = await generateWeek(db, s, end);
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_WEEK_GENERATED',
        entityType: 'float_week',
        entityId: id,
      });
      res.status(201).json({ id });
    }),
  );
  router.post(
    '/weeks/:id/sign-off',
    asyncHandler(async (req, res) => {
      must(f(req).floatApprove, 'Only a manager signs off the weekly report.');
      const id = idParam(req);
      const { comment } = z.object({ comment: optionalText(1000) }).parse(req.body ?? {});
      await db.transaction(async (trx) => {
        const w = await trx('float_weeks').where({ id }).forUpdate().first();
        if (!w || w.status !== 'GENERATED') throw conflict('This report is already signed off.');
        await trx('float_weeks').where({ id }).update({
          status: 'SIGNED_OFF',
          signed_by: req.user.id,
          signed_at: trx.fn.now(),
          sign_comment: comment,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_WEEK_SIGNED_OFF',
          entityType: 'float_week',
          entityId: id,
          after: { comment },
        });
        const data = typeof w.data === 'string' ? JSON.parse(w.data) : w.data;
        const t = data.totals;
        await notify(trx, {
          recipients: await directors(trx, [req.user.id]),
          event: 'FLOAT_WEEK_SIGNED_OFF',
          title: `AMS weekly report signed off: ${w.period_start} to ${w.period_end}`,
          body: `Deposits ${kwacha(t.depositAmount)}, withdrawals ${kwacha(t.withdrawalAmount)}.`,
          link: `/requisitions/float/reports/${id}`,
          entityType: 'float_week',
          entityId: id,
          email: {
            ...EMAIL,
            subject: `AMS weekly report: ${w.period_start} to ${w.period_end}`,
            heading: 'AMS weekly report',
            intro: `The weekly report for ${w.period_start} to ${w.period_end} has been signed off.${comment ? ` Manager’s note: ${comment}` : ''}`,
            rows: [
              ['Deposits', `${kwacha(t.depositAmount)} (${t.depositCount})`],
              ['Withdrawals', `${kwacha(t.withdrawalAmount)} (${t.withdrawalCount})`],
              ['Airtel Money', `${kwacha(t.byNetwork.AIRTEL.amount)} (${t.byNetwork.AIRTEL.count})`],
              ['MTN MoMo', `${kwacha(t.byNetwork.MTN.amount)} (${t.byNetwork.MTN.count})`],
              ['Commission earned', kwacha(t.commission)],
              ['Surpluses', kwacha(t.surplus)],
              ['Deficits', kwacha(t.deficit)],
            ],
            action: 'Open the report in the inventory system to see each branch and download it in Excel.',
          },
        });
      });
      res.json({ id });
    }),
  );

  // ── Commission ───────────────────────────────────────────────────────────────────────────────
  router.get(
    '/commission',
    asyncHandler(async (req, res) => {
      must(f(req).floatViewAll || f(req).floatAdmin, 'You do not have access to AMS commission.');
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? ''))
        ? String(req.query.month)
        : todayInLusaka().slice(0, 7);
      const s = await getSettings(db);
      const branches = await amsBranches(db, s);
      const earned = await db('float_transactions')
        .whereIn('branch_id', branches.map((b) => b.id).concat(0))
        .whereNot('status', 'REVERSED')
        .whereBetween('business_date', [`${month}-01`, `${month}-31`])
        .groupBy('branch_id', 'network')
        .select('branch_id', 'network')
        .count({ n: '*' })
        .sum({ c: 'commission', a: 'amount' });
      const receipts = await db('float_commission_receipts as r')
        .leftJoin('stock_branches as b', 'b.id', 'r.branch_id')
        .where('r.month', month)
        .orderBy('r.id')
        .select('r.*', 'b.name as branch');
      const byNetwork = ['AIRTEL', 'MTN'].map((n) => {
        const exp = round2(earned.filter((e) => e.network === n).reduce((sum, e) => sum + Number(e.c), 0));
        const got = round2(
          receipts.filter((r) => r.network === n).reduce((sum, r) => sum + Number(r.amount), 0),
        );
        return { network: n, expected: exp, received: got, difference: round2(got - exp) };
      });
      res.json({
        month,
        byNetwork,
        branches: branches.map((b) => ({
          id: b.id,
          name: b.name,
          networks: ['AIRTEL', 'MTN'].map((n) => {
            const e = earned.find((x) => x.branch_id === b.id && x.network === n);
            return {
              network: n,
              transactions: Number(e?.n ?? 0),
              amount: round2(e?.a ?? 0),
              commission: round2(e?.c ?? 0),
            };
          }),
        })),
        receipts: receipts.map((r) => ({
          id: r.id,
          network: r.network,
          branch: r.branch,
          amount: Number(r.amount),
          receivedOn: r.received_on,
          notes: r.notes,
        })),
        canRecord: f(req).floatAdmin,
      });
    }),
  );
  router.post(
    '/commission/receipts',
    asyncHandler(async (req, res) => {
      must(f(req).floatAdmin, 'Only the AMS set-up right can record commission received.');
      const input = z
        .object({
          network: z.enum(['AIRTEL', 'MTN']),
          month: z.string().regex(/^\d{4}-\d{2}$/, 'must be a month'),
          branchId: z.coerce.number().int().positive().nullish(),
          amount,
          receivedOn: isoDate,
          notes: optionalText(500),
        })
        .parse(req.body);
      const [id] = await db('float_commission_receipts').insert({
        network: input.network,
        month: input.month,
        branch_id: input.branchId ?? null,
        amount: input.amount,
        received_on: input.receivedOn,
        notes: input.notes,
        recorded_by: req.user.id,
      });
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_COMMISSION_RECEIVED',
        entityType: 'float_commission',
        entityId: id,
        after: input,
      });
      res.status(201).json({ id });
    }),
  );

  // ── AMS set-up: branches and their accounts ──────────────────────────────────────────────────
  const mustAdmin = (req) => must(f(req).floatAdmin, 'You cannot change the AMS set-up.');
  router.get(
    '/branches',
    asyncHandler(async (req, res) => {
      must(f(req).floatAdmin || f(req).floatViewAll, 'You do not have access to the AMS branches.');
      const s = await getSettings(db);
      const branches = await amsBranches(db, s);
      const accounts = branches.length
        ? await db('float_accounts').whereIn(
            'branch_id',
            branches.map((b) => b.id),
          )
        : [];
      const staff = branches.length
        ? await db('employees')
            .whereIn(
              'branch_id',
              branches.map((b) => b.id),
            )
            .where({ status: 'ACTIVE' })
            .orderBy('first_name')
            .select('id', 'first_name', 'last_name', 'branch_id')
        : [];
      const used = new Set(
        branches.length
          ? await db('float_entries')
              .whereIn(
                'branch_id',
                branches.map((b) => b.id),
              )
              .whereNot('entry_type', 'OPENING')
              .distinct()
              .pluck('account_id')
          : [],
      );
      res.json({
        configured: Boolean(s.companyId),
        canEdit: f(req).floatAdmin,
        items: branches.map((b) => ({
          id: b.id,
          name: b.name,
          location: b.location,
          isActive: Boolean(b.is_active),
          accounts: KINDS.map((k) => {
            const a = accounts.find((x) => x.branch_id === b.id && x.kind === k);
            return {
              kind: k,
              balance: Number(a?.balance ?? 0),
              minBalance: Number(a?.min_balance ?? 0),
              canSetOpening: a ? !used.has(a.id) : true,
            };
          }),
          staff: staff
            .filter((e) => e.branch_id === b.id)
            .map((e) => ({ id: e.id, firstName: e.first_name, lastName: e.last_name })),
        })),
      });
    }),
  );
  const kindMoney = z.object({
    CASH: z.coerce.number().min(0).default(0),
    AIRTEL: z.coerce.number().min(0).default(0),
    MTN: z.coerce.number().min(0).default(0),
  });
  const branchSchema = z.object({
    name: requiredText(150),
    location: optionalText(200),
    isActive: z.boolean().default(true),
    minimums: kindMoney.default({}),
    openings: kindMoney.default({}),
  });
  router.post(
    '/branches',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const input = branchSchema.parse(req.body);
      const s = await getSettings(db);
      if (!s.companyId) throw badRequest('Choose the AMS company in AMS settings first.');
      const id = await db.transaction(async (trx) => {
        const dup = await trx('stock_branches')
          .where({ company_id: s.companyId })
          .whereRaw('LOWER(name) = LOWER(?)', [input.name])
          .first('id');
        if (dup) throw conflict(`There is already an AMS branch called "${input.name}".`);
        const [bid] = await trx('stock_branches').insert({
          company_id: s.companyId,
          name: input.name,
          location: input.location,
          is_active: input.isActive,
        });
        const date = await businessDate(trx);
        for (const k of KINDS) {
          await trx('float_accounts').insert({
            branch_id: bid,
            kind: k,
            min_balance: round2(input.minimums[k]),
          });
          if (input.openings[k] > 0)
            await post(trx, {
              branchId: bid,
              kind: k,
              amount: round2(input.openings[k]),
              type: 'OPENING',
              date,
              by: req.user.id,
            });
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_BRANCH_ADDED',
          entityType: 'branch',
          entityId: bid,
          after: { ...input, company: 'AMS' },
        });
        return bid;
      });
      res.status(201).json({ id });
    }),
  );
  router.put(
    '/branches/:id',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const id = idParam(req);
      const input = branchSchema.parse(req.body);
      const s = await getSettings(db);
      await db.transaction(async (trx) => {
        const b = await trx('stock_branches').where({ id, company_id: s.companyId }).forUpdate().first();
        if (!b) throw notFound('AMS branch not found.');
        const dup = await trx('stock_branches')
          .where({ company_id: s.companyId })
          .whereRaw('LOWER(name) = LOWER(?)', [input.name])
          .whereNot('id', id)
          .first('id');
        if (dup) throw conflict(`There is already an AMS branch called "${input.name}".`);
        await trx('stock_branches')
          .where({ id })
          .update({ name: input.name, location: input.location, is_active: input.isActive });
        const date = await businessDate(trx);
        for (const k of KINDS) {
          let acc = await trx('float_accounts').where({ branch_id: id, kind: k }).forUpdate().first();
          if (!acc) {
            await trx('float_accounts').insert({ branch_id: id, kind: k, min_balance: 0 });
            acc = await trx('float_accounts').where({ branch_id: id, kind: k }).first();
          }
          await trx('float_accounts')
            .where({ id: acc.id })
            .update({ min_balance: round2(input.minimums[k]) });
          // An opening balance can be set or corrected until the account is first used.
          const used = await trx('float_entries')
            .where({ account_id: acc.id })
            .whereNot('entry_type', 'OPENING')
            .first('id');
          const diff = round2(input.openings[k] - Number(acc.balance));
          if (!used && diff !== 0)
            await post(trx, { branchId: id, kind: k, amount: diff, type: 'OPENING', date, by: req.user.id });
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_BRANCH_UPDATED',
          entityType: 'branch',
          entityId: id,
          before: { name: b.name, location: b.location, isActive: Boolean(b.is_active) },
          after: input,
        });
      });
      res.json({ id });
    }),
  );

  // ── AMS settings and commission tables ───────────────────────────────────────────────────────
  router.get(
    '/settings',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const s = await getSettings(db);
      const rules = await db('float_commission_rules').orderBy(['network', 'kind', 'min_amount']);
      const companies = await db('companies').where({ is_active: true }).orderBy('name').select('id', 'name');
      res.json({
        ...s,
        companies,
        rules: rules.map((r) => ({
          network: r.network,
          kind: r.kind,
          minAmount: Number(r.min_amount),
          maxAmount: r.max_amount == null ? null : Number(r.max_amount),
          feeType: r.fee_type,
          value: Number(r.value),
        })),
      });
    }),
  );
  const settingsSchema = z.object({
    companyId: z.coerce.number().int().positive().nullish(),
    workingDays: z.array(z.enum(DAYS)).min(1, 'choose at least one trading day'),
    weekEndDay: z.enum(DAYS),
    reportTime: hhmm,
    closeReminderTime: hhmm,
    cashTolerance: z.coerce.number().min(0).max(10000),
    largeAmount: z.coerce.number().positive().max(100000000),
    directorLimit: z.coerce.number().min(0).max(100000000),
    duplicateMinutes: z.coerce.number().int().min(0).max(60),
    rules: z
      .array(
        z.object({
          network: z.enum(['AIRTEL', 'MTN']),
          kind: z.enum(['DEPOSIT', 'WITHDRAWAL']),
          minAmount: z.coerce.number().min(0),
          maxAmount: z.coerce.number().positive().nullish(),
          feeType: z.enum(['FLAT', 'PERCENT']),
          value: z.coerce.number().min(0).max(100000),
        }),
      )
      .max(200),
  });
  router.put(
    '/settings',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const input = settingsSchema.parse(req.body);
      for (const r of input.rules) {
        if (r.maxAmount != null && r.maxAmount < r.minAmount)
          throw badRequest('A commission band ends before it starts.');
        if (r.feeType === 'PERCENT' && r.value > 100)
          throw badRequest('A percentage cannot be more than 100.');
      }
      await db.transaction(async (trx) => {
        const before = await getSettings(trx);
        await trx('float_settings')
          .where({ id: 1 })
          .update({
            company_id: input.companyId ?? null,
            working_days: DAYS.filter((d) => input.workingDays.includes(d)).join(','),
            week_end_day: input.weekEndDay,
            report_time: input.reportTime,
            close_reminder_time: input.closeReminderTime,
            cash_tolerance: input.cashTolerance,
            large_amount: input.largeAmount,
            director_limit: input.directorLimit,
            duplicate_minutes: input.duplicateMinutes,
            updated_by: req.user.id,
            updated_at: trx.fn.now(),
          });
        await trx('float_commission_rules').del();
        if (input.rules.length) {
          await trx('float_commission_rules').insert(
            input.rules.map((r) => ({
              network: r.network,
              kind: r.kind,
              min_amount: r.minAmount,
              max_amount: r.maxAmount ?? null,
              fee_type: r.feeType,
              value: r.value,
            })),
          );
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_SETTINGS_UPDATED',
          entityType: 'system_setting',
          entityId: 'ams_float',
          before,
          after: input,
        });
      });
      res.json({ ok: true });
    }),
  );

  return router;
}

export { KIND_LABEL };
