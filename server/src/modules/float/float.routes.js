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
import { updateEmployee, updateEmployeeSchema } from '../admin/employees.service.js';
import {
  DAYS,
  KINDS,
  KIND_LABEL,
  accountsOf,
  amsBranches,
  branchHours,
  businessDate,
  defaultHours,
  buildDay,
  dayCode,
  directors,
  getSettings,
  lusakaTime,
  reportRecipients,
  kwacha,
  isLocked,
  lowFloatCheck,
  managers,
  supervisors,
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
  /** The store's state today: opened (and when), and whether it has been closed (D121). */
  async function storeState(k, branchId, date) {
    const counts = await k('float_counts')
      .where({ branch_id: branchId, business_date: date })
      .whereIn('kind', ['OPEN', 'CLOSE'])
      .orderBy('id')
      .select('kind', 'created_at');
    const open = counts.find((c) => c.kind === 'OPEN');
    return { openedAt: open?.created_at ?? null, closed: counts.some((c) => c.kind === 'CLOSE') };
  }
  async function mustBeOpen(k, branchId, date) {
    const st = await storeState(k, branchId, date);
    if (!st.openedAt) {
      throw new AppError(409, 'STORE_NOT_OPEN', 'Open the store first: tap Open store to start the day.');
    }
    if (st.closed)
      throw new AppError(
        409,
        'STORE_CLOSED',
        'The store has been closed for today. Nothing more can be recorded until it opens again.',
      );
  }
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
  /**
   * The Operations Officer, managers and the System Admin act at any AMS branch: they choose it
   * (D122). Branch staff always act at the branch on their employee record.
   */
  const actsAnywhere = (req) => Boolean(f(req).floatSupervise || f(req).floatAdmin);
  async function anyBranch(settings, id) {
    const b = await db('stock_branches').where({ id, company_id: settings.companyId, is_active: true }).first('id', 'name');
    if (!b) throw notFound('AMS branch not found.');
    return b;
  }
  /** For viewing: a chosen branch, their own, or (for those who see every branch) the first. */
  async function branchFor(req, settings, wanted) {
    const mine = await staffBranch(db, settings, req.user.id);
    const seesAll = f(req).floatViewAll || f(req).floatAdmin || actsAnywhere(req);
    if (wanted && seesAll) return anyBranch(settings, wanted);
    if (mine) return mine;
    if (seesAll) {
      const first = (await amsBranches(db, settings, { activeOnly: true }))[0];
      if (first) return { id: first.id, name: first.name };
      throw badRequest('There are no AMS branches yet. Add them under AMS branches.');
    }
    throw badRequest('Your employee record has no AMS branch. Ask HR to post you to your branch.');
  }
  /** For doing: the branch chosen (branchId in the body) by those who act anywhere, else their own. */
  async function actingBranch(req, settings) {
    const wanted = Number(req.body?.branchId) || null;
    const mine = await staffBranch(db, settings, req.user.id);
    if (actsAnywhere(req)) {
      if (wanted) return anyBranch(settings, wanted);
      if (mine) return mine;
      throw new AppError(400, 'CHOOSE_BRANCH', 'Choose the branch you are working on.');
    }
    if (!mine) throw badRequest('Your employee record has no AMS branch. Ask HR to post you to your branch.');
    return mine;
  }
  const mustRecord = (req, msg) => must(f(req).floatRecord || actsAnywhere(req), msg);

  // ── Who the signed-in person is here ─────────────────────────────────────────────────────────
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const s = await getSettings(db);
      const company = s.companyId ? await db('companies').where({ id: s.companyId }).first('name') : null;
      const branch = await staffBranch(db, s, req.user.id);
      const c = f(req);
      const n = async (q) => Number((await q.count({ n: '*' }).first()).n);
      const approvals = c.floatSupervise
        ? (await n(
            db('float_movements').where({ status: 'PENDING' }).whereNot('requested_by', req.user.id),
          )) +
          (await n(db('float_transactions').where({ status: 'REVERSAL_PENDING' }))) +
          (await n(db('float_variances').where({ status: 'OPEN' })))
        : 0;
      const reqWaiting =
        (c.floatSupervise
          ? await n(
              db('float_requisitions')
                .where({ status: 'PENDING_SUPERVISOR' })
                .whereNot('raised_by', req.user.id),
            )
          : 0) +
        (c.floatApprove ? await n(db('float_requisitions').where({ status: 'PENDING_MANAGER' })) : 0) +
        (c.floatDirector ? await n(db('float_requisitions').where({ status: 'PENDING_DIRECTOR' })) : 0);
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
          supervise: c.floatSupervise,
          director: c.floatDirector,
          shortages: c.floatShortages,
          admin: c.floatAdmin,
        },
        counts: {
          approvals: approvals + director,
          requisitions: reqWaiting,
          daysToSign: c.floatSupervise ? (await unsignedDays()).length : 0,
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
    const h = (await branchHours(db, settings, [branch.id])).get(branch.id);
    return {
      branch,
      date: today,
      hours: h,
      tradingToday: h.workingDays.includes(dayCode(today)),
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
      opened: (() => {
        const o = counts.find((c) => c.kind === 'OPEN');
        return o ? { at: o.created_at, by: name(o.first_name, o.last_name) } : null;
      })(),
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
      must(c.floatRecord || c.floatViewAll || c.floatAdmin || c.floatSupervise, 'You do not have access to AMS cash and float.');
      const s = await getSettings(db);
      const branch = await branchFor(req, s, req.query.branch ? Number(req.query.branch) : null);
      const staff = await db('employees')
        .where({ branch_id: branch.id, status: 'ACTIVE' })
        .orderBy('first_name')
        .select('id', 'first_name', 'last_name');
      res.json({
        ...(await branchToday(branch, s)),
        staff: staff.map((e) => ({ id: e.id, name: name(e.first_name, e.last_name) })),
        canRecord: actsAnywhere(req) || (c.floatRecord && (await staffBranch(db, s, req.user.id))?.id === branch.id),
        // Those who act anywhere choose the branch they are working on.
        branches: actsAnywhere(req) || c.floatViewAll || c.floatAdmin ? (await amsBranches(db, s, { activeOnly: true })).map((b) => ({ id: b.id, name: b.name })) : null,
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
      mustRecord(req, 'You cannot record AMS transactions.');
      const input = txnSchema.parse(req.body);
      const s = await getSettings(db);
      const branch = await actingBranch(req, s);
      const out = await db.transaction(async (trx) => {
        const date = await businessDate(trx);
        await mustBeOpen(trx, branch.id, date);
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
          f(req).floatSupervise || (f(req).floatRecord && mine?.id === t.branch_id),
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
          recipients: await supervisors(trx, [req.user.id]),
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
      must(f(req).floatSupervise, 'Only the Operations Officer can decide reversals.');
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
      must(f(req).floatSupervise, 'Only the Operations Officer reviews large transactions.');
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
      mustRecord(req, 'You cannot count at an AMS branch.');
      const input = countSchema.parse(req.body);
      const s = await getSettings(db);
      const branch = await actingBranch(req, s);
      if (input.kind === 'HANDOVER' && !input.handedTo)
        throw badRequest('Choose who you are handing over to.');
      const out = await db.transaction(async (trx) => {
        const date = await businessDate(trx);
        await mustBeOpen(trx, branch.id, date);
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
            recipients: await supervisors(trx, [req.user.id]),
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
        // Closing the store closes the day's transactions; the branch's daily report is made and
        // submitted to the supervisor, the managers, the directors and the System Admin (D121).
        const day = await buildDay(db, s, out.date, [branch.id]);
        const b = day.branches[0];
        report = b;
        const at = (v) => (v ? lusakaTime(v) : '—');
        await db.transaction(async (trx) =>
          notify(trx, {
            recipients: await reportRecipients(trx, [req.user.id]),
            event: 'FLOAT_SIGNED_OUT',
            title: `Daily report: ${branch.name} closed at ${at(b.signedOutAt)}, ${b.transactions.total} transactions`,
            body: `Opened ${at(b.openedAt)}. Deposits ${b.deposits.count}, withdrawals ${b.withdrawals.count}. Closing cash ${kwacha(b.cash)}, float ${kwacha(b.float)}.`,
            link: `/requisitions/float/daily?from=${out.date}&to=${out.date}&branch=${branch.id}`,
            entityType: 'float_count',
            entityId: out.id,
            email: {
              ...EMAIL,
              subject: `AMS daily report: ${branch.name}, ${out.date}`,
              heading: `${branch.name} daily report`,
              intro: `${branch.name} has closed for ${out.date}. The day's transactions are closed.`,
              rows: [
                [
                  'Opened',
                  `${at(b.openedAt)}${b.openedBy ? ` by ${b.openedBy.firstName} ${b.openedBy.lastName}` : ''}`,
                ],
                [
                  'Closed',
                  `${at(b.signedOutAt)}${b.signedOutBy ? ` by ${b.signedOutBy.firstName} ${b.signedOutBy.lastName}` : ''}`,
                ],
                ['Number of deposits', String(b.deposits.count)],
                ['Deposits', kwacha(b.deposits.amount)],
                ['Number of withdrawals', String(b.withdrawals.count)],
                ['Withdrawals', kwacha(b.withdrawals.amount)],
                ['Opening cash', kwacha(b.openingCash)],
                ['Opening float', kwacha(b.openingFloat)],
                ['Closing cash', kwacha(b.cash)],
                ['Closing float', kwacha(b.float)],
                ['Float transfers', `${b.floatTransfers.count} (${kwacha(b.floatTransfers.amount)})`],
                ['Cash to finance', `${b.cashCollections.count} (${kwacha(b.cashCollections.amount)})`],
                ['Customers turned down', String(b.turnedDown)],
                ...(b.commission != null ? [['Daily commission', kwacha(b.commission)]] : []),
                ...(b.deficit ? [['Deficit', kwacha(b.deficit)]] : []),
                ...(b.surplus ? [['Surplus', kwacha(b.surplus)]] : []),
              ],
              action: 'The Operations Officer reconciles and signs off the day in the inventory system.',
            },
          }),
        );
      }
      res.status(201).json({ ...out, report });
    }),
  );

  // ── Opening the store (D121): clocks the opening time and the balances it opened with ─────────
  router.post(
    '/open',
    asyncHandler(async (req, res) => {
      mustRecord(req, 'You cannot open an AMS branch.');
      const s = await getSettings(db);
      const branch = await actingBranch(req, s);
      const out = await db.transaction(async (trx) => {
        const date = await businessDate(trx);
        const st = await storeState(trx, branch.id, date);
        if (st.closed) throw conflict('The store has already been closed for today.');
        if (st.openedAt) throw conflict('The store is already open.');
        const [countId] = await trx('float_counts').insert({
          branch_id: branch.id,
          kind: 'OPEN',
          business_date: date,
          counted_by: req.user.id,
        });
        const accounts = await accountsOf(trx, branch.id);
        for (const a of accounts) {
          await trx('float_count_lines').insert({
            count_id: countId,
            account_id: a.id,
            expected: a.balance,
            counted: a.balance,
            difference: 0,
          });
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_STORE_OPENED',
          entityType: 'float_count',
          entityId: countId,
          after: { branch: branch.name },
        });
        return {
          id: countId,
          date,
          balances: Object.fromEntries(accounts.map((a) => [a.kind, Number(a.balance)])),
        };
      });
      res.status(201).json(out);
    }),
  );

  // ── Cash retired to finance, and customers turned down ───────────────────────────────────────
  router.post(
    '/collections',
    asyncHandler(async (req, res) => {
      mustRecord(req, 'You cannot record at an AMS branch.');
      const input = z.object({ amount, collectedBy: optionalText(150) }).parse(req.body);
      const s = await getSettings(db);
      const branch = await actingBranch(req, s);
      const id = await db.transaction(async (trx) => {
        const date = await businessDate(trx);
        await mustBeOpen(trx, branch.id, date);
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
          recipients: await supervisors(trx, [req.user.id]),
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
      mustRecord(req, 'You cannot record at an AMS branch.');
      const input = z
        .object({
          reason: z.enum(['NO_FLOAT', 'NO_CASH', 'NETWORK_DOWN', 'OTHER']),
          network: z.enum(['AIRTEL', 'MTN']).nullish(),
        })
        .parse(req.body);
      const s = await getSettings(db);
      const branch = await actingBranch(req, s);
      await mustBeOpen(db, branch.id, await businessDate(db));
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
      // Branch staff raise a requisition instead (D121).
      must(
        c.floatSupervise,
        'Only the Operations Officer moves float between branches. Raise a requisition instead.',
      );
      const input = moveSchema.parse(req.body);
      const s = await getSettings(db);
      const ams = new Set((await amsBranches(db, s, { activeOnly: true })).map((b) => b.id));
      const mine = await staffBranch(db, s, req.user.id);
      const to = input.toBranchId ?? mine?.id;
      if (!to || !ams.has(to)) throw badRequest('Choose the AMS branch it goes to.');
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
          recipients: await supervisors(trx, [req.user.id]),
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
      must(f(req).floatSupervise, 'Only the Operations Officer approves float movements.');
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
      must(c.floatSupervise || c.floatDirector, 'You do not approve anything in AMS cash and float.');
      const B = await branchNames();
      const who = async (ids) =>
        new Map(
          (
            await db('employees')
              .whereIn('id', [...new Set(ids.filter(Boolean))])
              .select('id', 'first_name', 'last_name')
          ).map((e) => [e.id, name(e.first_name, e.last_name)]),
        );
      const movements = c.floatSupervise
        ? await db('float_movements').where({ status: 'PENDING' }).orderBy('id')
        : [];
      const reversals = c.floatSupervise
        ? await db('float_transactions').where({ status: 'REVERSAL_PENDING' }).orderBy('id')
        : [];
      const large = c.floatSupervise
        ? await db('float_transactions')
            .where({ is_large: true })
            .whereNull('large_reviewed_at')
            .whereNot('status', 'REVERSED')
            .orderBy('id')
        : [];
      const variances = await varianceRows()
        .whereIn('v.status', [
          ...(c.floatSupervise ? ['OPEN'] : []),
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
        c.floatViewAll || c.floatSupervise || c.floatShortages,
        'You do not have access to surpluses and deficits.',
      );
      const hrOnly = c.floatShortages && !c.floatViewAll && !c.floatSupervise;
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
        canResolve: c.floatSupervise,
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
      must(f(req).floatSupervise, 'Only the Operations Officer resolves surpluses and deficits.');
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
          hours: b.hours,
          tradingToday: b.tradingToday,
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

  // ── Daily reports (D118, D121) ───────────────────────────────────────────────────────────────
  // One row per branch per day with something in it, over a day, a week of a month or a month,
  // for one branch or all, with a search on branch or staff name.
  const DAILY_COLUMNS = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'branch', label: 'Branch' },
    { key: 'opened', label: 'Opened' },
    { key: 'closed', label: 'Closed' },
    { key: 'depCount', label: 'Number of deposits', type: 'number' },
    { key: 'depAmount', label: 'Deposits (K)', type: 'number' },
    { key: 'wdCount', label: 'Number of withdrawals', type: 'number' },
    { key: 'wdAmount', label: 'Withdrawals (K)', type: 'number' },
    { key: 'openingCash', label: 'Opening cash (K)', type: 'number' },
    { key: 'openingFloat', label: 'Opening float (K)', type: 'number' },
    { key: 'closingCash', label: 'Closing cash (K)', type: 'number' },
    { key: 'closingFloat', label: 'Closing float (K)', type: 'number' },
    { key: 'ftCount', label: 'Number of float transfers', type: 'number' },
    { key: 'ftAmount', label: 'Float transfers (K)', type: 'number' },
    { key: 'ccCount', label: 'Number of cash to finance', type: 'number' },
    { key: 'ccAmount', label: 'Cash to finance (K)', type: 'number' },
    { key: 'daytime', label: 'Daytime transactions', type: 'number' },
    { key: 'evening', label: 'Evening transactions', type: 'number' },
    { key: 'total', label: 'Total transactions', type: 'number' },
    { key: 'turnedDown', label: 'Customers turned down', type: 'number' },
    { key: 'commission', label: 'Daily commission (K)', type: 'number' },
    { key: 'deficit', label: 'Deficit (K)', type: 'number' },
    { key: 'surplus', label: 'Surplus (K)', type: 'number' },
  ];
  router.get(
    '/daily',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(c.floatViewAll || c.floatRecord, 'You do not have access to AMS daily reports.');
      const s = await getSettings(db);
      const iso = (v, d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : d);
      const today = await businessDate(db);
      const to = iso(req.query.to, today);
      const from = iso(req.query.from, to);
      if (from > to || addDays(from, 92) < to) throw badRequest('Choose a period of up to three months.');
      const mine = c.floatViewAll ? null : await staffBranch(db, s, req.user.id);
      if (!c.floatViewAll && !mine) throw badRequest('Your employee record has no AMS branch.');
      const branchIds = mine ? [mine.id] : req.query.branch ? [Number(req.query.branch)] : null;
      const term = String(req.query.q ?? '')
        .trim()
        .toLowerCase();
      const rows = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const day = await buildDay(db, s, d, branchIds);
        for (const b of day.branches) {
          if (!b.hasData) continue;
          const who = [b.openedBy, b.signedOutBy].filter(Boolean).map((p) => `${p.firstName} ${p.lastName}`);
          if (term && ![b.name, ...who].some((x) => x.toLowerCase().includes(term))) continue;
          rows.push({ date: d, ...b });
        }
      }
      const add = (fn) => round2(rows.reduce((sum, r) => sum + fn(r), 0));
      const lastPerBranch = new Map();
      for (const r of rows) lastPerBranch.set(r.id, r);
      const latest = [...lastPerBranch.values()];
      const totals = {
        deposits: { count: add((r) => r.deposits.count), amount: add((r) => r.deposits.amount) },
        withdrawals: { count: add((r) => r.withdrawals.count), amount: add((r) => r.withdrawals.amount) },
        transactions: add((r) => r.transactions.total),
        turnedDown: add((r) => r.turnedDown),
        commission: add((r) => r.commission ?? 0),
        deficit: add((r) => r.deficit),
        surplus: add((r) => r.surplus),
        // Balances at the end of the period: each branch's last day in it.
        cash: round2(latest.reduce((sum, r) => sum + r.cash, 0)),
        airtel: round2(latest.reduce((sum, r) => sum + r.airtel, 0)),
        mtn: round2(latest.reduce((sum, r) => sum + r.mtn, 0)),
      };
      const signedRows = await db('float_days as d')
        .join('employees as e', 'e.id', 'd.signed_by')
        .whereBetween('d.business_date', [from, to])
        .select('d.business_date', 'd.signed_at', 'd.comment', 'e.first_name', 'e.last_name');
      const signed = Object.fromEntries(
        signedRows.map((r) => [
          r.business_date,
          { by: name(r.first_name, r.last_name), at: r.signed_at, comment: r.comment },
        ]),
      );
      if (req.query.format === 'xlsx') {
        const t = (v) => (v ? lusakaTime(v) : '');
        return res
          .set('Content-Type', XLSX)
          .set('Content-Disposition', `attachment; filename="AMS daily ${from} to ${to}.xlsx"`)
          .set('Cache-Control', 'private, no-store')
          .send(
            toXlsx(
              DAILY_COLUMNS,
              rows.map((r) => ({
                date: r.date,
                branch: r.name,
                opened: t(r.openedAt),
                closed: t(r.signedOutAt),
                depCount: r.deposits.count,
                depAmount: r.deposits.amount,
                wdCount: r.withdrawals.count,
                wdAmount: r.withdrawals.amount,
                openingCash: r.openingCash,
                openingFloat: r.openingFloat,
                closingCash: r.cash,
                closingFloat: r.float,
                ftCount: r.floatTransfers.count,
                ftAmount: r.floatTransfers.amount,
                ccCount: r.cashCollections.count,
                ccAmount: r.cashCollections.amount,
                daytime: r.transactions.daytime,
                evening: r.transactions.evening,
                total: r.transactions.total,
                turnedDown: r.turnedDown,
                commission: r.commission ?? null,
                deficit: r.deficit || null,
                surplus: r.surplus || null,
              })),
              { sheetName: 'AMS daily', title: `AMS daily ${from} to ${to}` },
            ),
          );
      }
      res.json({
        from,
        to,
        rows,
        totals,
        signed,
        canSignOff: c.floatSupervise,
        unsigned: c.floatSupervise ? await unsignedDays() : [],
      });
    }),
  );
  router.post(
    '/daily/:date/sign-off',
    asyncHandler(async (req, res) => {
      must(f(req).floatSupervise, 'Only the Operations Officer signs off the daily report.');
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
          recipients: [...(await managers(trx, [req.user.id])), ...(await directors(trx, [req.user.id]))],
          event: 'FLOAT_DAY_SIGNED_OFF',
          title: `AMS daily report reconciled and signed off: ${date}`,
          body: `${t.transactions.total} transactions at ${t.signedOut} branches; closing cash ${kwacha(t.cash)}, float ${kwacha(t.float)}.`,
          link: `/requisitions/float/daily?from=${date}&to=${date}`,
          email: {
            ...EMAIL,
            subject: `AMS daily report signed off: ${date}`,
            heading: 'AMS daily report signed off',
            intro: `The Operations Officer has reconciled and signed off ${date}.${comment ? ` Note: ${comment}` : ''}`,
            rows: dayRows(t),
            action: 'Open it in the inventory system to see each branch.',
          },
        }),
      );
      res.json({ date });
    }),
  );

  // ── AMS requisitions (D121): a dead or faulty device, or cash or float run out ──────────────
  //   Raised by branch staff with the reason → Operations Officer → manager → director.
  //   Approved cash or float is added to the branch when it confirms it has arrived.
  const REQ_STEP = {
    PENDING_SUPERVISOR: ['floatSupervise', 'supervisor', 'PENDING_MANAGER'],
    PENDING_MANAGER: ['floatApprove', 'manager', 'PENDING_DIRECTOR'],
    PENDING_DIRECTOR: ['floatDirector', 'director', 'APPROVED'],
  };
  const REQ_KIND = { DEVICE: 'Device dead or faulty', CASH: 'Cash run out', FLOAT: 'Float run out' };
  const reqRows = () =>
    db('float_requisitions as q')
      .join('stock_branches as b', 'b.id', 'q.branch_id')
      .join('employees as e', 'e.id', 'q.raised_by')
      .leftJoin('employees as sv', 'sv.id', 'q.supervisor_by')
      .leftJoin('employees as mg', 'mg.id', 'q.manager_by')
      .leftJoin('employees as dr', 'dr.id', 'q.director_by')
      .select(
        'q.*',
        'b.name as branch',
        'e.first_name',
        'e.last_name',
        'sv.first_name as sv_first',
        'sv.last_name as sv_last',
        'mg.first_name as mg_first',
        'mg.last_name as mg_last',
        'dr.first_name as dr_first',
        'dr.last_name as dr_last',
      );
  const reqView = (q, u, mine) => {
    const step = REQ_STEP[q.status];
    const c = f({ rq: u.rq });
    return {
      id: q.id,
      reference: q.reference,
      branch: q.branch,
      branchId: q.branch_id,
      kind: q.kind,
      kindLabel: REQ_KIND[q.kind],
      account: q.account,
      amount: q.amount == null ? null : Number(q.amount),
      device: q.device,
      reason: q.reason,
      status: q.status,
      raisedBy: { id: q.raised_by, firstName: q.first_name, lastName: q.last_name },
      raisedAt: q.raised_at,
      steps: [
        [
          'Operations Officer',
          q.supervisor_by && {
            by: name(q.sv_first, q.sv_last),
            at: q.supervisor_at,
            comment: q.supervisor_comment,
          },
        ],
        [
          'Manager',
          q.manager_by && { by: name(q.mg_first, q.mg_last), at: q.manager_at, comment: q.manager_comment },
        ],
        [
          'Director',
          q.director_by && {
            by: name(q.dr_first, q.dr_last),
            at: q.director_at,
            comment: q.director_comment,
          },
        ],
      ].map(([label, done]) => ({ label, done: done || null })),
      receivedAmount: q.received_amount == null ? null : Number(q.received_amount),
      can: {
        decide: Boolean(
          step && c[step[0]] && q.raised_by !== u.id && q.supervisor_by !== u.id && q.manager_by !== u.id,
        ),
        cancel: q.status === 'PENDING_SUPERVISOR' && q.raised_by === u.id,
        receive: q.status === 'APPROVED' && q.kind !== 'DEVICE' && (mine === q.branch_id || c.floatSupervise),
        done: q.status === 'APPROVED' && q.kind === 'DEVICE' && c.floatSupervise,
      },
    };
  };
  router.get(
    '/requisitions',
    asyncHandler(async (req, res) => {
      const c = f(req);
      must(
        c.floatRecord || c.floatSupervise || c.floatApprove || c.floatDirector || c.floatViewAll,
        'You do not have access to AMS requisitions.',
      );
      const s = await getSettings(db);
      const mine = await staffBranch(db, s, req.user.id);
      const all = c.floatSupervise || c.floatApprove || c.floatDirector || c.floatViewAll;
      const rows = await reqRows()
        .modify((q) => !all && q.where('q.branch_id', mine?.id ?? 0))
        .modify((q) => req.query.status && q.where('q.status', String(req.query.status)))
        .orderBy('q.id', 'desc')
        .limit(1000);
      const u = { id: req.user.id, rq: req.rq };
      res.json({
        items: rows.map((q) => reqView(q, u, mine?.id)),
        canRaise: actsAnywhere(req) || (c.floatRecord && Boolean(mine)),
        branch: mine,
        branches: actsAnywhere(req) ? (await amsBranches(db, s, { activeOnly: true })).map((b) => ({ id: b.id, name: b.name })) : null,
      });
    }),
  );
  const reqSchema = z
    .object({
      kind: z.enum(['DEVICE', 'CASH', 'FLOAT']),
      account: z.enum(['AIRTEL', 'MTN']).nullish(),
      amount: z.coerce.number().positive().max(100000000).nullish(),
      device: optionalText(200),
      reason: requiredText(2000),
    })
    .refine((v) => v.kind !== 'FLOAT' || v.account, { message: 'choose Airtel or MTN', path: ['account'] })
    .refine((v) => v.kind === 'DEVICE' || v.amount, { message: 'give the amount needed', path: ['amount'] })
    .refine((v) => v.kind !== 'DEVICE' || v.device, { message: 'say which device', path: ['device'] });
  router.post(
    '/requisitions',
    asyncHandler(async (req, res) => {
      mustRecord(req, 'Only branch staff raise AMS requisitions.');
      const input = reqSchema.parse(req.body);
      const s = await getSettings(db);
      const branch = await actingBranch(req, s);
      const id = await db.transaction(async (trx) => {
        const [qid] = await trx('float_requisitions').insert({
          branch_id: branch.id,
          kind: input.kind,
          account: input.kind === 'CASH' ? 'CASH' : input.kind === 'FLOAT' ? input.account : null,
          amount: input.kind === 'DEVICE' ? null : round2(input.amount),
          device: input.kind === 'DEVICE' ? input.device : null,
          reason: input.reason,
          raised_by: req.user.id,
        });
        const reference = `AR-${todayInLusaka().slice(0, 4)}-${String(qid).padStart(6, '0')}`;
        await trx('float_requisitions').where({ id: qid }).update({ reference });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_REQUISITION_RAISED',
          entityType: 'float_requisition',
          entityId: qid,
          after: { reference, ...input },
        });
        const what =
          input.kind === 'DEVICE'
            ? `${REQ_KIND.DEVICE}: ${input.device}`
            : `${REQ_KIND[input.kind]}: ${kwacha(input.amount)}${input.account ? ` ${KIND_LABEL[input.account]}` : ''}`;
        await notify(trx, {
          recipients: await supervisors(trx, [req.user.id]),
          event: 'FLOAT_REQUISITION_TO_APPROVE',
          title: `Requisition from ${branch.name}: ${what}`,
          body: input.reason,
          link: '/requisitions/float/requisitions',
          entityType: 'float_requisition',
          entityId: qid,
          email: {
            ...EMAIL,
            subject: `AMS requisition ${reference} from ${branch.name}`,
            heading: 'AMS requisition to approve',
            intro: `${branch.name} has raised a requisition.`,
            rows: [
              ['Reference', reference],
              ['What', what],
              ['Reason', input.reason],
            ],
            action: 'Please approve it on to the manager, or turn it down, in the inventory system.',
          },
        });
        return qid;
      });
      res.status(201).json({ id });
    }),
  );
  router.post(
    '/requisitions/:id/decide',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const { approve, comment } = decideSchema.parse(req.body);
      if (!approve && !comment) throw badRequest('Give a reason for turning it down.');
      await db.transaction(async (trx) => {
        const q = await trx('float_requisitions').where({ id }).forUpdate().first();
        if (!q) throw notFound('Requisition not found.');
        const step = REQ_STEP[q.status];
        if (!step) throw conflict('This requisition is not waiting for a decision.');
        must(f(req)[step[0]], 'This requisition is waiting for someone else.');
        if ([q.raised_by, q.supervisor_by, q.manager_by].includes(req.user.id)) {
          throw forbidden('Someone else must take this step.');
        }
        const who = step[1];
        const to = approve ? step[2] : 'REJECTED';
        await trx('float_requisitions')
          .where({ id })
          .update({
            status: to,
            [`${who}_by`]: req.user.id,
            [`${who}_at`]: trx.fn.now(),
            [`${who}_comment`]: comment,
          });
        await writeAudit(trx, {
          ...auditContext(req),
          action: `FLOAT_REQUISITION_${approve ? 'APPROVED' : 'REJECTED'}`,
          entityType: 'float_requisition',
          entityId: id,
          before: { status: q.status },
          after: { status: to, comment },
        });
        const branch = await trx('stock_branches').where({ id: q.branch_id }).first('name');
        const next =
          to === 'PENDING_MANAGER'
            ? await managers(trx, [req.user.id])
            : to === 'PENDING_DIRECTOR'
              ? await directors(trx, [req.user.id])
              : [];
        if (next.length) {
          await notify(trx, {
            recipients: next,
            event: 'FLOAT_REQUISITION_TO_APPROVE',
            title: `AMS requisition to approve: ${q.reference} (${branch.name})`,
            body: `${REQ_KIND[q.kind]}. ${q.reason}`,
            link: '/requisitions/float/requisitions',
            entityType: 'float_requisition',
            entityId: id,
            email: {
              ...EMAIL,
              subject: `AMS requisition to approve: ${q.reference}`,
              heading: 'AMS requisition to approve',
              intro: `${branch.name}'s requisition has been approved by the ${who === 'supervisor' ? 'Operations Officer' : 'manager'} and needs your decision.`,
              rows: [
                [
                  'What',
                  REQ_KIND[q.kind] + (q.amount ? `: ${kwacha(q.amount)}` : q.device ? `: ${q.device}` : ''),
                ],
                ['Reason', q.reason],
              ],
            },
          });
        }
        if (to === 'APPROVED' || to === 'REJECTED') {
          await notify(trx, {
            recipients: [q.raised_by, ...(await supervisors(trx, [req.user.id]))],
            event: `FLOAT_REQUISITION_${to}`,
            title: `AMS requisition ${to === 'APPROVED' ? 'approved' : 'turned down'}: ${q.reference}`,
            body:
              to === 'APPROVED'
                ? q.kind === 'DEVICE'
                  ? 'The Operations Officer will arrange it.'
                  : 'Confirm it on Requisitions when the money arrives at the branch.'
                : comment,
            link: '/requisitions/float/requisitions',
            entityType: 'float_requisition',
            entityId: id,
          });
        }
      });
      res.json({ id });
    }),
  );
  router.post(
    '/requisitions/:id/received',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const { amount: got } = z.object({ amount }).parse(req.body);
      const s = await getSettings(db);
      const mine = await staffBranch(db, s, req.user.id);
      await db.transaction(async (trx) => {
        const q = await trx('float_requisitions').where({ id }).forUpdate().first();
        if (!q || q.status !== 'APPROVED' || q.kind === 'DEVICE')
          throw conflict('This requisition is not waiting to be received.');
        must(
          f(req).floatSupervise || (f(req).floatRecord && mine?.id === q.branch_id),
          'Only the branch or the Operations Officer confirms it arrived.',
        );
        const date = await businessDate(trx);
        const [mid] = await trx('float_movements').insert({
          kind: 'TOPUP',
          to_branch_id: q.branch_id,
          to_account: q.account,
          amount: got,
          reason: `Requisition ${q.reference}`,
          status: 'APPROVED',
          requested_by: q.raised_by,
          decided_by: req.user.id,
          decided_at: trx.fn.now(),
          business_date: date,
        });
        await post(trx, {
          branchId: q.branch_id,
          kind: q.account,
          amount: got,
          type: 'TOPUP',
          date,
          by: req.user.id,
          movementId: mid,
        });
        await trx('float_requisitions').where({ id }).update({
          status: 'RECEIVED',
          received_amount: got,
          movement_id: mid,
          closed_by: req.user.id,
          closed_at: trx.fn.now(),
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_REQUISITION_RECEIVED',
          entityType: 'float_requisition',
          entityId: id,
          after: { amount: got },
        });
      });
      res.json({ id });
    }),
  );
  router.post(
    '/requisitions/:id/done',
    asyncHandler(async (req, res) => {
      must(f(req).floatSupervise, 'Only the Operations Officer marks a device requisition done.');
      const id = idParam(req);
      const n = await db('float_requisitions')
        .where({ id, status: 'APPROVED', kind: 'DEVICE' })
        .update({ status: 'DONE', closed_by: req.user.id, closed_at: db.fn.now() });
      if (!n) throw conflict('This requisition is not waiting to be done.');
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_REQUISITION_DONE',
        entityType: 'float_requisition',
        entityId: id,
      });
      res.json({ id });
    }),
  );
  router.post(
    '/requisitions/:id/cancel',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const n = await db('float_requisitions')
        .where({ id, status: 'PENDING_SUPERVISOR', raised_by: req.user.id })
        .update({ status: 'CANCELLED', closed_by: req.user.id, closed_at: db.fn.now() });
      if (!n)
        throw conflict('Only your own requisition, before the Operations Officer decides, can be cancelled.');
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_REQUISITION_CANCELLED',
        entityType: 'float_requisition',
        entityId: id,
      });
      res.json({ id });
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
      const H = await branchHours(
        db,
        s,
        branches.map((b) => b.id),
      );
      res.json({
        configured: Boolean(s.companyId),
        canEdit: f(req).floatAdmin,
        items: branches.map((b) => ({
          id: b.id,
          name: b.name,
          location: b.location,
          isActive: Boolean(b.is_active),
          hours: H.get(b.id),
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
  // A branch's own trading days and hours (D120).
  const hoursSchema = z
    .object({
      workingDays: z.array(z.enum(DAYS)).min(1, 'choose at least one trading day'),
      opensAt: hhmm,
      closesAt: hhmm,
      eveningFrom: hhmm,
    })
    .refine((h) => h.closesAt > h.opensAt, { message: 'must be after the opening time', path: ['closesAt'] })
    .refine((h) => h.eveningFrom > h.opensAt, {
      message: 'must be after the opening time',
      path: ['eveningFrom'],
    });
  const branchSchema = z.object({
    name: requiredText(150),
    location: optionalText(200),
    isActive: z.boolean().default(true),
    minimums: kindMoney.default({}),
    openings: kindMoney.default({}),
    hours: hoursSchema.nullish(),
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
        const h = input.hours ?? defaultHours(s);
        await trx('float_branch_hours').insert({
          branch_id: bid,
          working_days: DAYS.filter((d) => h.workingDays.includes(d)).join(','),
          opens_at: h.opensAt,
          closes_at: h.closesAt,
          evening_from: h.eveningFrom,
          updated_by: req.user.id,
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

  // ── One branch: its hours and its staff (D120) ──────────────────────────────────────────────
  async function amsBranch(id) {
    const s = await getSettings(db);
    const b = s.companyId ? await db('stock_branches').where({ id, company_id: s.companyId }).first() : null;
    if (!b) throw notFound('AMS branch not found.');
    return { s, b };
  }
  router.get(
    '/branches/:id',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const { s, b } = await amsBranch(idParam(req));
      const hours = (await branchHours(db, s, [b.id])).get(b.id);
      const staff = await db('employees as e')
        .leftJoin('access_users as u', (j) =>
          j.on('u.employee_id', 'e.id').andOnVal('u.module', '=', 'inventory'),
        )
        .leftJoin('access_roles as r', 'r.id', 'u.role_id')
        .leftJoin('phone_logins as p', 'p.employee_id', 'e.id')
        .where({ 'e.branch_id': b.id, 'e.status': 'ACTIVE' })
        .orderBy(['e.first_name', 'e.last_name'])
        .select(
          'e.id',
          'e.first_name',
          'e.last_name',
          'e.job_title',
          'e.mobile_phone',
          'e.phone_e164',
          'r.name as role',
          'u.is_active as role_active',
          'p.employee_id as has_login',
          'p.pin_hash',
          'p.locked_at',
          'p.code_expires_at',
        );
      const candidates = await db('employees')
        .where({ company_id: s.companyId, status: 'ACTIVE' })
        .where((w) => w.whereNull('branch_id').orWhereNot('branch_id', b.id))
        .orderBy(['first_name', 'last_name'])
        .select('id', 'first_name', 'last_name', 'job_title');
      res.json({
        id: b.id,
        name: b.name,
        location: b.location,
        isActive: Boolean(b.is_active),
        hours,
        staff: staff.map((e) => ({
          id: e.id,
          firstName: e.first_name,
          lastName: e.last_name,
          jobTitle: e.job_title,
          phone: e.phone_e164 ? formatPhone(e.phone_e164) : e.mobile_phone,
          hasPhone: Boolean(e.phone_e164),
          role: e.role ? `${e.role}${e.role_active ? '' : ' (disabled)'}` : null,
          phoneSignIn: !e.has_login
            ? 'NOT_SET_UP'
            : e.locked_at
              ? 'LOCKED'
              : e.pin_hash
                ? 'ACTIVE'
                : new Date(e.code_expires_at) > new Date()
                  ? 'CODE_GIVEN'
                  : 'CODE_EXPIRED',
        })),
        candidates: candidates.map((e) => ({
          id: e.id,
          firstName: e.first_name,
          lastName: e.last_name,
          jobTitle: e.job_title,
        })),
      });
    }),
  );
  router.put(
    '/branches/:id/hours',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const { b } = await amsBranch(idParam(req));
      const h = hoursSchema.parse(req.body);
      const row = {
        working_days: DAYS.filter((d) => h.workingDays.includes(d)).join(','),
        opens_at: h.opensAt,
        closes_at: h.closesAt,
        evening_from: h.eveningFrom,
        updated_by: req.user.id,
        updated_at: db.fn.now(),
      };
      const before = await db('float_branch_hours').where({ branch_id: b.id }).first();
      await db('float_branch_hours')
        .insert({ branch_id: b.id, ...row })
        .onConflict('branch_id')
        .merge();
      await writeAudit(db, {
        ...auditContext(req),
        action: 'FLOAT_BRANCH_HOURS_UPDATED',
        entityType: 'branch',
        entityId: b.id,
        before: before ?? undefined,
        after: h,
      });
      res.json({ id: b.id });
    }),
  );
  // Post someone to the branch (on their employee record) and give them the AMS Branch Staff
  // role if they have no inventory role yet.
  router.post(
    '/branches/:id/staff',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const { s, b } = await amsBranch(idParam(req));
      const { employeeId, giveRole } = z
        .object({ employeeId: z.coerce.number().int().positive(), giveRole: z.boolean().default(true) })
        .parse(req.body);
      await db.transaction(async (trx) => {
        const e = await trx('employees')
          .where({ id: employeeId, status: 'ACTIVE' })
          .first('id', 'company_id');
        if (!e || e.company_id !== s.companyId)
          throw badRequest('Choose an active Altus Money Solutions employee.');
        await updateEmployee(trx, employeeId, updateEmployeeSchema.parse({ branchId: b.id }), {
          ...auditContext(req),
          historyReason: `Posted to ${b.name}`,
        });
        let roleGiven = false;
        if (
          giveRole &&
          !(await trx('access_users')
            .where({ module: 'inventory', employee_id: employeeId })
            .first('employee_id'))
        ) {
          const role = await trx('access_roles')
            .where({ module: 'inventory', name: 'AMS Branch Staff' })
            .first('id');
          if (role) {
            await trx('access_users').insert({
              module: 'inventory',
              employee_id: employeeId,
              role_id: role.id,
              added_by: req.user.id,
            });
            roleGiven = true;
          }
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_STAFF_POSTED',
          entityType: 'branch',
          entityId: b.id,
          after: { employeeId, roleGiven },
        });
      });
      res.status(201).json({ id: employeeId });
    }),
  );
  // Take someone off the branch: their branch is cleared, their phone sign-in ends, and the AMS
  // Branch Staff role is removed (other inventory roles are left alone).
  router.delete(
    '/branches/:id/staff/:employeeId',
    asyncHandler(async (req, res) => {
      mustAdmin(req);
      const { b } = await amsBranch(idParam(req));
      const employeeId = idParam(req, 'employeeId');
      await db.transaction(async (trx) => {
        const e = await trx('employees').where({ id: employeeId, branch_id: b.id }).first('id');
        if (!e) throw notFound('This person is not at this branch.');
        await updateEmployee(trx, employeeId, updateEmployeeSchema.parse({ branchId: null }), {
          ...auditContext(req),
          historyReason: `Taken off ${b.name}`,
        });
        await trx('phone_logins').where({ employee_id: employeeId }).del();
        const staffRole = await trx('access_roles')
          .where({ module: 'inventory', name: 'AMS Branch Staff' })
          .first('id');
        if (staffRole) {
          await trx('access_users')
            .where({ module: 'inventory', employee_id: employeeId, role_id: staffRole.id })
            .del();
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'FLOAT_STAFF_REMOVED',
          entityType: 'branch',
          entityId: b.id,
          after: { employeeId },
        });
      });
      res.json({ ok: true });
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
      res.status(201).json({
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
