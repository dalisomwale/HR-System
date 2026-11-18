import { Router } from 'express';
import { z } from 'zod';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notify.service.js';
import { asyncHandler, idParam, optionalText, requiredText } from '../../utils/validation.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { addDays } from '../leave/calendar.js';
import { toXlsx } from '../reports/export-files.js';
import { CODE_HOURS, hashSecret, isAmsBranchStaff, newCode } from '../auth/phone-login.js';
import { formatPhone } from '../../utils/phone.js';
import {
  DAYS,
  KINDS,
  KIND_LABEL,
  accountsOf,
  amsBranches,
  businessDate,
  buildDay,
  dayCode,
  dayText,
  directors,
  getSettings,
  kwacha,
  isLocked,
  lowFloatCheck,
  managers,
  post,
  round2,
  runOutTime,
  staffBranch,
} from './float.service.js';

/*
 * AMS cash and float (D117), in the Inventory system, for Altus Money Solutions only.
 * Rights come from the inventory roles: float.record (branch staff, their own branch),
 * float.view_all, float.approve (manager), float.director, float.shortages (HR), float.admin.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MOVE_LABEL = { TOPUP: 'Top-up', TRANSFER: 'Transfer', COLLECTION: 'Cash collection' };
const EMAIL = { app: 'inventory' };
const name = (f, l) => [f, l].filter(Boolean).join(' ') || null;
const amount = z.coerce.number().positive('must be more than zero').max(100000000).transform(round2);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 17:30');

/** Email rows for a day's totals. */
export const dayRows = (t) => [
  ['Branches signed out', `${t.signedOut} of ${t.branches}`],
  ['Deposits', `${t.deposits.count} (${kwacha(t.deposits.amount)})`],
  ['Withdrawals', `${t.withdrawals.count} (${kwacha(t.withdrawals.amount)})`],
  ['Float transfers', `${t.floatTransfers.count} (${kwacha(t.floatTransfers.amount)})`],
  ['Cash retired to finance', `${t.cashCollections.count} (${kwacha(t.cashCollections.amount)})`],
  ['Total transactions', String(t.transactions.total)],
  ['Customers turned down', String(t.turnedDown)],
  ['Float + cash', kwacha(t.total)],
  ['Daily commission', kwacha(t.commission)],
  ['Deficits', kwacha(t.deficit)],
];

export function floatRoutes({ db }) {
  const router = Router();
  /** Past days with activity that no manager has signed off yet (the last 31 days). */
  async function unsignedDays() {
    const today = todayInLusaka();
    const from = addDays(today, -31);
    const active = await db('float_counts')
      .whereBetween('business_date', [from, addDays(today, -1)])
      .distinct()
      .pluck('business_date');
    const signed = new Set(
      await db('float_days').whereBetween('business_date', [from, today]).pluck('business_date'),
    );
    return active.filter((d) => !signed.has(d)).sort();
  }
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
        settings: {
          reportTime: s.reportTime,
          workingDays: s.workingDays,
          dayStart: s.dayStart,
          eveningFrom: s.eveningFrom,
        },
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
          daysToSign: c.floatApprove ? (await unsignedDays()).length : 0,
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
        // Staff are paid through payroll; the networks' commission is typed at sign-out (D118).
        const commission = 0;
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
        if (await isLocked(trx, t.business_date))
          throw conflict('That day has been signed off and is locked.');
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
    // The commission the networks credited today, as shown on the phones (D118).
    commission: z.coerce.number().min(0).max(10000000).nullish(),
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
          commission: input.kind === 'CLOSE' && input.commission != null ? round2(input.commission) : null,
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
        return { id: countId, results, date };
      });
      let report = null;
      if (input.kind === 'CLOSE') {
        const day = await buildDay(db, s, out.date, [branch.id]);
        const b = day.branches[0];
        report = { ...b, text: dayText(b, out.date, s) };
        await db.transaction(async (trx) =>
          notify(trx, {
            recipients: await managers(trx, [req.user.id]),
            event: 'FLOAT_SIGNED_OUT',
            title: `${branch.name} signed out: ${b.transactions.total} transactions, float + cash ${kwacha(b.total)}`,
            body: `Deposits ${b.deposits.count}, withdrawals ${b.withdrawals.count}, turned down ${b.turnedDown}. Cash ${kwacha(b.cash)}, float ${kwacha(b.float)}.`,
            link: `/requisitions/float/daily?date=${out.date}`,
            entityType: 'float_count',
            entityId: out.id,
          }),
        );
      }
      res.status(201).json({ ...out, report });
    }),
  );

  // ── Cash retired to finance, and customers turned down ───────────────────────────────────────
  router.post(
    '/collections',
    asyncHandler(async (req, res) => {
      must(f(req).floatRecord, 'You cannot record at an AMS branch.');
      const input = z.object({ amount, collectedBy: optionalText(150) }).parse(req.body);
      const s = await getSettings(db);
      const branch = await staffBranch(db, s, req.user.id);
      if (!branch) throw badRequest('Your employee record has no AMS branch.');
      const id = await db.transaction(async (trx) => {
        const date = await businessDate(trx);
        const [mid] = await trx('float_movements').insert({
          kind: 'COLLECTION',
          from_branch_id: branch.id,
          from_account: 'CASH',
          to_branch_id: branch.id,
          to_account: 'CASH',
          amount: input.amount,
          reason: 'Cash retired to finance',
          collected_by: input.collectedBy,
          requested_by: req.user.id,
          business_date: date,
        });
        // The cash leaves the drawer now; a manager confirms finance received it.
        await post(trx, {
          branchId: branch.id,
          kind: 'CASH',
          amount: -input.amount,
          type: 'COLLECTION',
          date,
          by: req.user.id,
          movementId: mid,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_CASH_COLLECTED',
          entityType: 'float_movement',
          entityId: mid,
          after: input,
        });
        await notify(trx, {
          recipients: await managers(trx, [req.user.id]),
          event: 'FLOAT_COLLECTION_TO_CONFIRM',
          title: `Cash retired to finance: ${kwacha(input.amount)} from ${branch.name}`,
          body: input.collectedBy
            ? `Collected by ${input.collectedBy}. Confirm finance received it.`
            : 'Confirm finance received it.',
          link: '/requisitions/float/approvals',
          entityType: 'float_movement',
          entityId: mid,
        });
        return mid;
      });
      res.status(201).json({ id });
    }),
  );
  router.post(
    '/turned-down',
    asyncHandler(async (req, res) => {
      must(f(req).floatRecord, 'You cannot record at an AMS branch.');
      const input = z
        .object({
          reason: z.enum(['NO_FLOAT', 'NO_CASH', 'NETWORK_DOWN', 'OTHER']),
          network: z.enum(['AIRTEL', 'MTN']).nullish(),
        })
        .parse(req.body);
      const s = await getSettings(db);
      const branch = await staffBranch(db, s, req.user.id);
      if (!branch) throw badRequest('Your employee record has no AMS branch.');
      const [id] = await db('float_turned_down').insert({
        branch_id: branch.id,
        reason: input.reason,
        network: input.network ?? null,
        business_date: await businessDate(db),
        recorded_by: req.user.id,
      });
      const today = await db('float_turned_down')
        .where({ branch_id: branch.id, business_date: await businessDate(db) })
        .count({ n: '*' })
        .first();
      res.status(201).json({ id, today: Number(today.n) });
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
        if (m.kind === 'COLLECTION' && !approve) {
          await post(trx, {
            branchId: m.from_branch_id,
            kind: 'CASH',
            amount: Number(m.amount),
            type: 'COLLECTION',
            date,
            by: req.user.id,
            movementId: id,
          });
        }
        if (approve && m.kind !== 'COLLECTION') {
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
            business_date: m.kind === 'COLLECTION' ? m.business_date : approve ? date : null,
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
          title: `${MOVE_LABEL[m.kind]} ${approve ? (m.kind === 'COLLECTION' ? 'confirmed' : 'approved') : 'not approved'}: ${KIND_LABEL[m.to_account]} ${kwacha(m.amount)}`,
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
      const signedToday = await isLocked(db, today);
      const unsigned = (await unsignedDays()).length;
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
        signedToday,
        unsignedDays: unsigned,
        isWorkingDay: s.workingDays.includes(dayCode(today)),
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

  // ── Daily reports (D118) ─────────────────────────────────────────────────────────────────────
  router.get(
    '/daily',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(c.floatViewAll || c.floatRecord, 'You do not have access to AMS daily reports.');
      const s = await getSettings(db);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? ''))
        ? String(req.query.date)
        : await businessDate(db);
      const mine = c.floatViewAll ? null : await staffBranch(db, s, req.user.id);
      if (!c.floatViewAll && !mine) throw badRequest('Your employee record has no AMS branch.');
      const day = await buildDay(db, s, date, mine ? [mine.id] : null);
      const signed = await db('float_days as d')
        .join('employees as e', 'e.id', 'd.signed_by')
        .where('d.business_date', date)
        .first('d.*', 'e.first_name', 'e.last_name');
      res.json({
        ...day,
        branches: day.branches.map((b) => ({ ...b, text: dayText(b, date, s) })),
        settings: { dayStart: s.dayStart, eveningFrom: s.eveningFrom },
        signedOff: signed
          ? { by: name(signed.first_name, signed.last_name), at: signed.signed_at, comment: signed.comment }
          : null,
        canSignOff: c.floatApprove && !signed && date <= todayInLusaka(),
        unsigned: c.floatApprove ? await unsignedDays() : [],
      });
    }),
  );
  router.post(
    '/daily/:date/sign-off',
    asyncHandler(async (req, res) => {
      must(f(req).floatApprove, 'Only a manager signs off the daily report.');
      const date = String(req.params.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayInLusaka())
        throw badRequest('Choose a day up to today.');
      const { comment } = z.object({ comment: optionalText(1000) }).parse(req.body ?? {});
      const s = await getSettings(db);
      await db.transaction(async (trx) => {
        if (await isLocked(trx, date)) throw conflict('This day is already signed off.');
        await trx('float_days').insert({
          business_date: date,
          signed_by: req.user.id,
          signed_at: trx.fn.now(),
          comment,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_DAY_SIGNED_OFF',
          entityType: 'float_day',
          entityId: date,
          after: { comment },
        });
      });
      const day = await buildDay(db, s, date);
      const t = day.totals;
      await db.transaction(async (trx) =>
        notify(trx, {
          recipients: await directors(trx, [req.user.id]),
          event: 'FLOAT_DAY_SIGNED_OFF',
          title: `AMS daily report signed off: ${date}`,
          body: `${t.transactions.total} transactions at ${t.signedOut} of ${t.branches} branches; float + cash ${kwacha(t.total)}.`,
          link: `/requisitions/float/daily?date=${date}`,
          entityType: 'float_day',
          entityId: null,
          email: {
            ...EMAIL,
            subject: `AMS daily report: ${date}`,
            heading: 'AMS daily report',
            intro: `The daily report for ${date} has been signed off.${comment ? ` Manager’s note: ${comment}` : ''}`,
            rows: dayRows(t),
            action: 'Open it in the inventory system to see each branch and download it in Excel.',
          },
        }),
      );
      res.json({ date });
    }),
  );

  // Day by day for a period, one row per branch and day, as AMS keeps it in Excel.
  router.get(
    '/history',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(c.floatViewAll, 'You do not have access to AMS reports.');
      const s = await getSettings(db);
      const iso = (v, d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : d);
      const to = iso(req.query.to, todayInLusaka());
      const from = iso(req.query.from, addDays(to, -30));
      if (from > to || addDays(from, 366) < to) throw badRequest('Choose a period of up to a year.');
      const branchIds = req.query.branch ? [Number(req.query.branch)] : null;
      const rows = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const day = await buildDay(db, s, d, branchIds);
        for (const b of day.branches) {
          if (!b.transactions.total && !b.signedOut && !b.floatTransfers.count && !b.cashCollections.count)
            continue;
          rows.push({ date: d, ...b });
        }
      }
      if (req.query.format === 'xlsx') {
        return res
          .set('Content-Type', XLSX)
          .set('Content-Disposition', `attachment; filename="AMS daily ${from} to ${to}.xlsx"`)
          .set('Cache-Control', 'private, no-store')
          .send(
            toXlsx(
              [
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'branch', label: 'Branch' },
                { key: 'depCount', label: 'Deposits count', type: 'number' },
                { key: 'depAmount', label: 'Deposits amount (K)', type: 'number' },
                { key: 'wdCount', label: 'Withdrawals count', type: 'number' },
                { key: 'wdAmount', label: 'Withdrawals amount (K)', type: 'number' },
                { key: 'commission', label: 'Daily commission (K)', type: 'number' },
                { key: 'ftCount', label: 'Float transfers count', type: 'number' },
                { key: 'ftAmount', label: 'Float transfers amount (K)', type: 'number' },
                { key: 'ccCount', label: 'Cash collections count', type: 'number' },
                { key: 'ccAmount', label: 'Cash collections amount (K)', type: 'number' },
                { key: 'daytime', label: `Transactions ${s.dayStart}–${s.eveningFrom}`, type: 'number' },
                { key: 'evening', label: `Transactions after ${s.eveningFrom}`, type: 'number' },
                { key: 'total', label: 'Total transactions', type: 'number' },
                { key: 'turnedDown', label: 'Customers turned down', type: 'number' },
                { key: 'cash', label: 'Cash (K)', type: 'number' },
                { key: 'float', label: 'Float (K)', type: 'number' },
                { key: 'floatCash', label: 'Float + cash (K)', type: 'number' },
                { key: 'commissionMonth', label: 'Commission this month (K)', type: 'number' },
                { key: 'deficit', label: 'Deficit (K)', type: 'number' },
                { key: 'surplus', label: 'Surplus (K)', type: 'number' },
              ],
              rows.map((r) => ({
                date: r.date,
                branch: r.name,
                depCount: r.deposits.count,
                depAmount: r.deposits.amount,
                wdCount: r.withdrawals.count,
                wdAmount: r.withdrawals.amount,
                commission: r.commission ?? 0,
                ftCount: r.floatTransfers.count,
                ftAmount: r.floatTransfers.amount,
                ccCount: r.cashCollections.count,
                ccAmount: r.cashCollections.amount,
                daytime: r.transactions.daytime,
                evening: r.transactions.evening,
                total: r.transactions.total,
                turnedDown: r.turnedDown,
                cash: r.cash,
                float: r.float,
                floatCash: r.total,
                commissionMonth: r.commissionMonth,
                deficit: r.deficit,
                surplus: r.surplus,
              })),
              { sheetName: 'AMS daily', title: `AMS daily ${from} to ${to}` },
            ),
          );
      }
      res.json({ from, to, rows });
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

  // ── Phone sign-in for AMS branch staff (D119) ───────────────────────────────────────────────
  router.get(
    '/phone-access',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const s = await getSettings(db);
      if (!s.companyId) return res.json({ items: [] });
      const rows = await db('employees as e')
        .join('stock_branches as b', 'b.id', 'e.branch_id')
        .leftJoin('phone_logins as p', 'p.employee_id', 'e.id')
        .where({ 'e.status': 'ACTIVE', 'e.company_id': s.companyId, 'b.company_id': s.companyId })
        .orderBy(['b.name', 'e.first_name', 'e.last_name'])
        .select(
          'e.id',
          'e.first_name',
          'e.last_name',
          'e.mobile_phone',
          'e.phone_e164',
          'b.name as branch',
          'p.employee_id as has_login',
          'p.pin_hash',
          'p.code_expires_at',
          'p.locked_at',
          'p.last_sign_in_at',
        );
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          branch: r.branch,
          phone: r.phone_e164 ? formatPhone(r.phone_e164) : r.mobile_phone,
          hasPhone: Boolean(r.phone_e164),
          status: !r.has_login
            ? 'NOT_SET_UP'
            : r.locked_at
              ? 'LOCKED'
              : r.pin_hash
                ? 'ACTIVE'
                : new Date(r.code_expires_at) > new Date()
                  ? 'CODE_GIVEN'
                  : 'CODE_EXPIRED',
          codeExpiresAt: r.pin_hash ? null : r.code_expires_at,
          lastSignInAt: r.last_sign_in_at,
        })),
      });
    }),
  );
  router.post(
    '/phone-access/:id/code',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const id = idParam(req);
      const e = await db('employees').where({ id }).first('id', 'first_name', 'last_name', 'phone_e164');
      if (!e || !(await isAmsBranchStaff(db, id)))
        throw badRequest('Only active AMS branch staff can sign in with a phone number.');
      if (!e.phone_e164) throw badRequest('Add their phone number on their employee record first.');
      const code = newCode();
      const expires = new Date(Date.now() + CODE_HOURS * 3600000);
      const row = {
        code_hash: await hashSecret(code),
        code_expires_at: expires,
        pin_hash: null,
        failed_attempts: 0,
        locked_at: null,
        updated_by: req.user.id,
        updated_at: db.fn.now(),
      };
      await db('phone_logins')
        .insert({ employee_id: id, ...row })
        .onConflict('employee_id')
        .merge();
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_PHONE_CODE_GIVEN',
        entityType: 'employee',
        entityId: id,
      });
      res
        .status(201)
        .json({
          code,
          expiresAt: expires,
          name: name(e.first_name, e.last_name),
          phone: formatPhone(e.phone_e164),
        });
    }),
  );
  router.post(
    '/phone-access/:id/off',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const id = idParam(req);
      const n = await db('phone_logins').where({ employee_id: id }).del();
      if (!n) throw notFound('Phone sign-in is not set up for this person.');
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_PHONE_SIGN_IN_OFF',
        entityType: 'employee',
        entityId: id,
      });
      res.json({ ok: true });
    }),
  );

  // ── AMS settings ─────────────────────────────────────────────────────────────────────────────
  router.get(
    '/settings',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const s = await getSettings(db);
      const companies = await db('companies').where({ is_active: true }).orderBy('name').select('id', 'name');
      res.json({ ...s, companies });
    }),
  );
  const settingsSchema = z.object({
    companyId: z.coerce.number().int().positive().nullish(),
    workingDays: z.array(z.enum(DAYS)).min(1, 'choose at least one trading day'),
    dayStart: hhmm,
    eveningFrom: hhmm,
    reportTime: hhmm,
    closeReminderTime: hhmm,
    cashTolerance: z.coerce.number().min(0).max(10000),
    largeAmount: z.coerce.number().positive().max(100000000),
    directorLimit: z.coerce.number().min(0).max(100000000),
    duplicateMinutes: z.coerce.number().int().min(0).max(60),
  });
  router.put(
    '/settings',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const input = settingsSchema.parse(req.body);
      if (input.eveningFrom <= input.dayStart)
        throw badRequest('The evening must start after the day starts.');
      await db.transaction(async (trx) => {
        const before = await getSettings(trx);
        await trx('float_settings')
          .where({ id: 1 })
          .update({
            company_id: input.companyId ?? null,
            working_days: DAYS.filter((d) => input.workingDays.includes(d)).join(','),
            day_start: input.dayStart,
            evening_from: input.eveningFrom,
            report_time: input.reportTime,
            close_reminder_time: input.closeReminderTime,
            cash_tolerance: input.cashTolerance,
            large_amount: input.largeAmount,
            director_limit: input.directorLimit,
            duplicate_minutes: input.duplicateMinutes,
            updated_by: req.user.id,
            updated_at: trx.fn.now(),
          });
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
