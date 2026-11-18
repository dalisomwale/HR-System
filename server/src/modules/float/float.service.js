import { todayInLusaka } from '../../utils/dates.js';
import { addDays, weekdayKey } from '../leave/calendar.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { notify } from '../notifications/notify.service.js';
import { moduleHolders } from '../access/modules.js';

/*
 * AMS cash and float (D117). Every change to a balance is a row in float_entries, written in the
 * same transaction as the account's balance, so the balance always equals the sum of its entries.
 *
 *   Deposit     the customer hands over cash for their wallet: Cash +, network float −
 *   Withdrawal  the customer takes cash from their wallet:     Cash −, network float +
 */

export const KINDS = ['CASH', 'AIRTEL', 'MTN'];
export const KIND_LABEL = { CASH: 'Cash', AIRTEL: 'Airtel Money', MTN: 'MTN MoMo' };
export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const round2 = (n) => Math.round(Number(n) * 100) / 100;
export const kwacha = (n) =>
  `K${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const EMAIL = { app: 'inventory' };

export async function getSettings(db) {
  const s = await db('float_settings').where({ id: 1 }).first();
  return {
    companyId: s?.company_id ?? null,
    workingDays: String(s?.working_days ?? '')
      .split(',')
      .filter(Boolean),
    weekEndDay: s?.week_end_day ?? 'FRI',
    reportTime: s?.report_time ?? '17:30',
    closeReminderTime: s?.close_reminder_time ?? '18:00',
    cashTolerance: Number(s?.cash_tolerance ?? 5),
    largeAmount: Number(s?.large_amount ?? 10000),
    directorLimit: Number(s?.director_limit ?? 5000),
    duplicateMinutes: Number(s?.duplicate_minutes ?? 2),
  };
}

/** Lusaka time now as 'HH:MM'. */
export function lusakaTime(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Africa/Lusaka',
  }).format(now);
}

/** The week that ends on or before `day`: { start, end }. */
export function weekEnding(settings, day) {
  let end = day;
  for (let i = 0; i < 7 && weekdayKey(end).slice(0, 3).toUpperCase() !== settings.weekEndDay; i += 1) {
    end = addDays(end, -1);
  }
  return { start: addDays(end, -6), end };
}

/** The date postings count for: today, or tomorrow once today's weekly report has been made. */
export async function businessDate(db, today = todayInLusaka()) {
  const made = await db('float_weeks').where({ period_end: today }).first('id');
  return made ? addDays(today, 1) : today;
}

/** The last date of a signed-off week: nothing on or before it can change. */
export async function lockedUntil(db) {
  const r = await db('float_weeks').where({ status: 'SIGNED_OFF' }).max({ d: 'period_end' }).first();
  return r?.d ?? null;
}

export async function amsBranches(db, settings, { activeOnly = false } = {}) {
  if (!settings.companyId) return [];
  return db('stock_branches')
    .where({ company_id: settings.companyId })
    .modify((q) => activeOnly && q.where('is_active', true))
    .orderBy('name')
    .select('id', 'name', 'location', 'is_active');
}

/** The branch on the person's employee record, if it is an active AMS branch. */
export async function staffBranch(db, settings, employeeId) {
  if (!settings.companyId) return null;
  return db('employees as e')
    .join('stock_branches as b', 'b.id', 'e.branch_id')
    .where({ 'e.id': employeeId, 'b.company_id': settings.companyId, 'b.is_active': true })
    .first('b.id', 'b.name');
}

export async function accountsOf(db, branchId) {
  return db('float_accounts')
    .where({ branch_id: branchId })
    .orderByRaw("FIELD(kind, 'CASH', 'AIRTEL', 'MTN')");
}

/** Change one account's balance and write the ledger row. Returns the balance after. */
export async function post(
  trx,
  { branchId, kind, amount, type, date, by, transactionId, movementId, varianceId, allowNegative = false },
) {
  const acc = await trx('float_accounts').where({ branch_id: branchId, kind }).forUpdate().first();
  if (!acc) throw badRequest(`This branch has no ${KIND_LABEL[kind]} account.`);
  const before = Number(acc.balance);
  const after = round2(before + Number(amount));
  if (after < 0 && !allowNegative) {
    throw conflict(
      `Not enough ${KIND_LABEL[kind]} recorded at this branch (${kwacha(before)}). Ask for a top-up, or count to correct the balance.`,
    );
  }
  await trx('float_accounts').where({ id: acc.id }).update({ balance: after });
  await trx('float_entries').insert({
    account_id: acc.id,
    branch_id: branchId,
    entry_type: type,
    amount: round2(amount),
    balance_after: after,
    transaction_id: transactionId ?? null,
    movement_id: movementId ?? null,
    variance_id: varianceId ?? null,
    business_date: date,
    created_by: by ?? null,
  });
  return { account: acc, before, after };
}

/** Expected commission for a transaction, from the admin's tables (the first band that fits). */
export async function commissionFor(db, network, kind, amount) {
  const rules = await db('float_commission_rules')
    .where({ network, kind })
    .where('min_amount', '<=', amount)
    .where((w) => w.whereNull('max_amount').orWhere('max_amount', '>=', amount))
    .orderBy('min_amount', 'desc');
  const r = rules[0];
  if (!r) return 0;
  return round2(r.fee_type === 'FLAT' ? Number(r.value) : (Number(amount) * Number(r.value)) / 100);
}

/** Inventory users who can record at a branch (their employee record's branch). */
export async function branchStaff(db, branchId) {
  const ids = await moduleHolders(db, 'inventory', ['float.record']);
  if (!ids.length) return [];
  return db('employees').whereIn('id', ids).where({ branch_id: branchId, status: 'ACTIVE' }).pluck('id');
}
export const managers = (db, exclude = []) => moduleHolders(db, 'inventory', ['float.approve'], exclude);
export const directors = (db, exclude = []) => moduleHolders(db, 'inventory', ['float.director'], exclude);

/** Tell the branch and the managers when an account has just gone below its minimum. */
export async function lowFloatCheck(trx, { branchId, kind, before, after, account }) {
  const min = Number(account.min_balance);
  if (!(min > 0 && after < min && before >= min)) return;
  const branch = await trx('stock_branches').where({ id: branchId }).first('name');
  const title = `${KIND_LABEL[kind]} low at ${branch.name}`;
  await notify(trx, {
    recipients: [...(await branchStaff(trx, branchId)), ...(await managers(trx))],
    event: 'FLOAT_LOW',
    title,
    body: `${kwacha(after)} left; the minimum is ${kwacha(min)}. Ask for a top-up.`,
    link: `/requisitions/float/branch?branch=${branchId}`,
    entityType: 'float_account',
    entityId: account.id,
    email: {
      ...EMAIL,
      subject: title,
      heading: title,
      intro: `${branch.name}'s ${KIND_LABEL[kind]} balance has fallen below its minimum.`,
      rows: [
        ['Balance', kwacha(after)],
        ['Minimum', kwacha(min)],
      ],
      action: 'Request or approve a top-up in the inventory system.',
    },
  });
}

/**
 * When an account will run out at today's pace: from the money that has gone out of it today,
 * per hour since the day's first transaction. Null when it is not going down.
 */
export function runOutTime(balance, outToday, firstAt, now = new Date()) {
  if (!(outToday > 0) || !firstAt || !(balance > 0)) return null;
  const hours = Math.max(0.5, (now - new Date(firstAt)) / 3600000);
  const perHour = outToday / hours;
  const left = balance / perHour;
  if (left > 12) return null;
  return lusakaTime(new Date(now.getTime() + left * 3600000));
}

/** The weekly report's figures, per branch and account, with the week before for comparison. */
export async function buildWeek(db, settings, start, end) {
  const branches = await amsBranches(db, settings);
  const ids = branches.map((b) => b.id);
  if (!ids.length)
    return { period: { start, end }, branches: [], totals: emptyTotals(), previous: emptyTotals() };
  const accounts = await db('float_accounts').whereIn('branch_id', ids);
  const opening = await db('float_entries')
    .whereIn('branch_id', ids)
    .where('business_date', '<', start)
    .groupBy('account_id')
    .select('account_id')
    .sum({ s: 'amount' });
  const moves = await db('float_entries')
    .whereIn('branch_id', ids)
    .whereBetween('business_date', [start, end])
    .groupBy('account_id', 'entry_type')
    .select('account_id', 'entry_type')
    .sum({ s: 'amount' });
  const txns = await txnTotals(db, ids, start, end);
  const varRows = await db('float_variances')
    .whereIn('branch_id', ids)
    .whereBetween('business_date', [start, end])
    .select('branch_id', 'amount');
  const O = new Map(opening.map((o) => [o.account_id, Number(o.s)]));
  const branchesOut = branches.map((b) => {
    const accs = accounts
      .filter((a) => a.branch_id === b.id)
      .sort((x, y) => KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind))
      .map((a) => {
        const sum = (t) =>
          round2(
            moves
              .filter((m) => m.account_id === a.id && m.entry_type === t)
              .reduce((s, m) => s + Number(m.s), 0),
          );
        const open = round2(O.get(a.id) ?? 0);
        const movement = round2(
          moves.filter((m) => m.account_id === a.id).reduce((s, m) => s + Number(m.s), 0),
        );
        return {
          kind: a.kind,
          opening: round2(open + sum('OPENING')),
          deposits: sum('DEPOSIT'),
          withdrawals: sum('WITHDRAWAL'),
          topups: sum('TOPUP'),
          transfersIn: sum('TRANSFER_IN'),
          transfersOut: sum('TRANSFER_OUT'),
          reversals: sum('REVERSAL'),
          countDifferences: round2(sum('VARIANCE') + sum('RECOVERY')),
          closing: round2(open + movement),
        };
      });
    const t = txns.get(b.id) ?? emptyTxn();
    const v = varRows.filter((r) => r.branch_id === b.id);
    return {
      id: b.id,
      name: b.name,
      accounts: accs,
      ...t,
      surplus: round2(v.filter((r) => Number(r.amount) > 0).reduce((s, r) => s + Number(r.amount), 0)),
      deficit: round2(v.filter((r) => Number(r.amount) < 0).reduce((s, r) => s - Number(r.amount), 0)),
    };
  });
  const totals = sumTotals(branchesOut);
  const prevTxns = await txnTotals(db, ids, addDays(start, -7), addDays(start, -1));
  const previous = sumTotals([...prevTxns.values()].map((t) => ({ ...t, surplus: 0, deficit: 0 })));
  return { period: { start, end }, branches: branchesOut, totals, previous };
}

const emptyTxn = () => ({
  depositCount: 0,
  depositAmount: 0,
  withdrawalCount: 0,
  withdrawalAmount: 0,
  byNetwork: { AIRTEL: { count: 0, amount: 0 }, MTN: { count: 0, amount: 0 } },
  commission: 0,
});
const emptyTotals = () => ({ ...emptyTxn(), surplus: 0, deficit: 0 });

async function txnTotals(db, branchIds, start, end) {
  const rows = await db('float_transactions')
    .whereIn('branch_id', branchIds)
    .whereBetween('business_date', [start, end])
    .whereNot('status', 'REVERSED')
    .groupBy('branch_id', 'network', 'kind')
    .select('branch_id', 'network', 'kind')
    .count({ n: '*' })
    .sum({ a: 'amount', c: 'commission' });
  const out = new Map();
  for (const r of rows) {
    const t = out.get(r.branch_id) ?? emptyTxn();
    const n = Number(r.n);
    const a = round2(r.a);
    if (r.kind === 'DEPOSIT') {
      t.depositCount += n;
      t.depositAmount = round2(t.depositAmount + a);
    } else {
      t.withdrawalCount += n;
      t.withdrawalAmount = round2(t.withdrawalAmount + a);
    }
    t.byNetwork[r.network].count += n;
    t.byNetwork[r.network].amount = round2(t.byNetwork[r.network].amount + a);
    t.commission = round2(t.commission + Number(r.c));
    out.set(r.branch_id, t);
  }
  return out;
}

function sumTotals(list) {
  const t = emptyTotals();
  for (const b of list) {
    t.depositCount += b.depositCount;
    t.depositAmount = round2(t.depositAmount + b.depositAmount);
    t.withdrawalCount += b.withdrawalCount;
    t.withdrawalAmount = round2(t.withdrawalAmount + b.withdrawalAmount);
    t.commission = round2(t.commission + b.commission);
    t.surplus = round2(t.surplus + (b.surplus ?? 0));
    t.deficit = round2(t.deficit + (b.deficit ?? 0));
    for (const n of ['AIRTEL', 'MTN']) {
      t.byNetwork[n].count += b.byNetwork[n].count;
      t.byNetwork[n].amount = round2(t.byNetwork[n].amount + b.byNetwork[n].amount);
    }
  }
  return t;
}

export { DAYS as WEEK_DAYS };
