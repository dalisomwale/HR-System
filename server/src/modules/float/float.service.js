import { todayInLusaka } from '../../utils/dates.js';
import { addDays } from '../leave/calendar.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { notify } from '../notifications/notify.service.js';
import { moduleHolders } from '../access/modules.js';

/*
 * AMS cash and float (D117, D118). Every change to a balance is a row in float_entries, written
 * in the same transaction as the account's balance, so the balance always equals its entries.
 *
 *   Deposit           the customer hands over cash for their wallet: Cash +, network float −
 *   Withdrawal        the customer takes cash from their wallet:     Cash −, network float +
 *   Float transfer    float received by the branch (a top-up or a transfer), approved by a manager
 *   Cash collection   cash retired to finance: out of the branch at once, confirmed by a manager
 */

export const KINDS = ['CASH', 'AIRTEL', 'MTN'];
export const KIND_LABEL = { CASH: 'Cash', AIRTEL: 'Airtel Money', MTN: 'MTN MoMo' };
export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const round2 = (n) => Math.round(Number(n) * 100) / 100;
export const kwacha = (n) =>
  `K${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dayCode = (iso) => DAYS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7];
const EMAIL = { app: 'inventory' };

export async function getSettings(db) {
  const s = await db('float_settings').where({ id: 1 }).first();
  return {
    companyId: s?.company_id ?? null,
    workingDays: String(s?.working_days ?? 'MON,TUE,WED,THU,FRI,SAT')
      .split(',')
      .filter(Boolean),
    dayStart: s?.day_start ?? '07:30',
    eveningFrom: s?.evening_from ?? '17:00',
    reportTime: s?.report_time ?? '17:30',
    closeReminderTime: s?.close_reminder_time ?? '18:00',
    cashTolerance: Number(s?.cash_tolerance ?? 5),
    largeAmount: Number(s?.large_amount ?? 10000),
    directorLimit: Number(s?.director_limit ?? 5000),
    duplicateMinutes: Number(s?.duplicate_minutes ?? 2),
  };
}

/** The AMS settings' hours, used for branches that have none of their own yet. */
export const defaultHours = (settings) => ({
  workingDays: settings.workingDays,
  opensAt: settings.dayStart,
  closesAt: settings.closeReminderTime,
  eveningFrom: settings.eveningFrom,
});

/** Each branch's own trading days and hours (D120), by branch id. */
export async function branchHours(db, settings, ids) {
  const rows = ids.length ? await db('float_branch_hours').whereIn('branch_id', ids) : [];
  const R = new Map(rows.map((r) => [r.branch_id, r]));
  return new Map(
    ids.map((id) => {
      const r = R.get(id);
      return [
        id,
        r
          ? {
              workingDays: String(r.working_days).split(',').filter(Boolean),
              opensAt: r.opens_at,
              closesAt: r.closes_at,
              eveningFrom: r.evening_from,
            }
          : defaultHours(settings),
      ];
    }),
  );
}

/** Lusaka time as 'HH:MM'. */
export function lusakaTime(at = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Africa/Lusaka',
  }).format(new Date(at));
}

/** A signed-off day can no longer change. */
export async function isLocked(db, date) {
  return Boolean(await db('float_days').where({ business_date: date }).first('business_date'));
}

/** The date postings count for: today, or tomorrow once today has been signed off. */
export async function businessDate(db, today = todayInLusaka()) {
  return (await isLocked(db, today)) ? addDays(today, 1) : today;
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

/** Change one account's balance and write the ledger row. */
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

/** When an account runs out at today's pace (from what has gone out per hour), or null. */
export function runOutTime(balance, outToday, firstAt, now = new Date()) {
  if (!(outToday > 0) || !firstAt || !(balance > 0)) return null;
  const hours = Math.max(0.5, (now - new Date(firstAt)) / 3600000);
  const left = balance / (outToday / hours);
  if (left > 12) return null;
  return lusakaTime(new Date(now.getTime() + left * 3600000));
}

/**
 * The daily report (D118), per branch, for one business date: the figures AMS reports every
 * evening. A branch that has signed out (closed the day) shows what was counted; one still open
 * shows the books.
 */
export async function buildDay(db, settings, date, branchIds = null) {
  const branches = (await amsBranches(db, settings)).filter((b) => !branchIds || branchIds.includes(b.id));
  const ids = branches.map((b) => b.id);
  const none = ids.length ? ids : [0];
  const month = date.slice(0, 7);
  const [txns, downs, moves, closes, monthCloses, variances, accounts] = await Promise.all([
    db('float_transactions')
      .whereIn('branch_id', none)
      .where({ business_date: date })
      .whereNot('status', 'REVERSED')
      .select('branch_id', 'network', 'kind', 'amount', 'recorded_at'),
    db('float_turned_down')
      .whereIn('branch_id', none)
      .where({ business_date: date })
      .select('branch_id', 'reason'),
    db('float_movements')
      .where({ business_date: date })
      .whereIn('status', ['APPROVED', 'PENDING'])
      .where((w) => w.whereIn('to_branch_id', none).orWhereIn('from_branch_id', none))
      .select('*'),
    db('float_counts as c')
      .join('employees as e', 'e.id', 'c.counted_by')
      .whereIn('c.branch_id', none)
      .where({ 'c.business_date': date, 'c.kind': 'CLOSE' })
      .orderBy('c.id')
      .select('c.*', 'e.first_name', 'e.last_name'),
    db('float_counts')
      .whereIn('branch_id', none)
      .where({ kind: 'CLOSE' })
      .whereBetween('business_date', [`${month}-01`, date])
      .orderBy('id')
      .select('id', 'branch_id', 'business_date', 'commission'),
    db('float_variances')
      .whereIn('branch_id', none)
      .where({ business_date: date })
      .select('branch_id', 'amount'),
    db('float_accounts').whereIn('branch_id', none),
  ]);
  const lastClose = new Map();
  for (const c of closes) lastClose.set(c.branch_id, c);
  const lines = lastClose.size
    ? await db('float_count_lines as l')
        .join('float_accounts as a', 'a.id', 'l.account_id')
        .whereIn(
          'l.count_id',
          [...lastClose.values()].map((c) => c.id),
        )
        .select('l.count_id', 'a.kind', 'l.counted')
    : [];
  // Month to date: the commission of each day's last close.
  const perDay = new Map();
  for (const c of monthCloses) perDay.set(`${c.branch_id}:${c.business_date}`, c);
  const mtd = new Map();
  for (const c of perDay.values())
    mtd.set(c.branch_id, round2((mtd.get(c.branch_id) ?? 0) + Number(c.commission ?? 0)));

  const sum = (rows) => round2(rows.reduce((s, r) => s + Number(r.amount), 0));
  const hours = await branchHours(db, settings, ids);
  const out = branches.map((b) => {
    const h = hours.get(b.id);
    const t = txns.filter((x) => x.branch_id === b.id);
    const dep = t.filter((x) => x.kind === 'DEPOSIT');
    const wd = t.filter((x) => x.kind === 'WITHDRAWAL');
    const evening = t.filter((x) => lusakaTime(x.recorded_at) >= h.eveningFrom).length;
    const floatIn = moves.filter(
      (m) =>
        m.to_branch_id === b.id &&
        m.status === 'APPROVED' &&
        m.kind !== 'COLLECTION' &&
        m.to_account !== 'CASH',
    );
    const collections = moves.filter((m) => m.kind === 'COLLECTION' && m.from_branch_id === b.id);
    const close = lastClose.get(b.id);
    const counted = close
      ? Object.fromEntries(
          lines.filter((l) => l.count_id === close.id).map((l) => [l.kind, Number(l.counted)]),
        )
      : null;
    const books = Object.fromEntries(
      accounts.filter((a) => a.branch_id === b.id).map((a) => [a.kind, Number(a.balance)]),
    );
    const bal = (k) => round2(counted?.[k] ?? books[k] ?? 0);
    const cash = bal('CASH');
    const float = round2(bal('AIRTEL') + bal('MTN'));
    const turnedDown = downs.filter((d) => d.branch_id === b.id).length;
    const v = variances.filter((x) => x.branch_id === b.id);
    return {
      id: b.id,
      name: b.name,
      hours: h,
      tradingDay: h.workingDays.includes(dayCode(date)),
      signedOut: Boolean(close),
      signedOutAt: close?.created_at ?? null,
      signedOutBy: close ? { firstName: close.first_name, lastName: close.last_name } : null,
      deposits: { count: dep.length, amount: sum(dep) },
      withdrawals: { count: wd.length, amount: sum(wd) },
      byNetwork: Object.fromEntries(
        ['AIRTEL', 'MTN'].map((n) => [
          n,
          { count: t.filter((x) => x.network === n).length, amount: sum(t.filter((x) => x.network === n)) },
        ]),
      ),
      floatTransfers: { count: floatIn.length, amount: sum(floatIn) },
      cashCollections: { count: collections.length, amount: sum(collections) },
      transactions: { total: t.length, daytime: t.length - evening, evening },
      turnedDown,
      walkIns: t.length + turnedDown,
      cash,
      airtel: bal('AIRTEL'),
      mtn: bal('MTN'),
      float,
      total: round2(cash + float),
      commission: close?.commission == null ? null : round2(close.commission),
      commissionMonth: mtd.get(b.id) ?? 0,
      surplus: round2(v.filter((x) => Number(x.amount) > 0).reduce((s, x) => s + Number(x.amount), 0)),
      deficit: round2(v.filter((x) => Number(x.amount) < 0).reduce((s, x) => s - Number(x.amount), 0)),
    };
  });
  const add = (f) => round2(out.reduce((s, b) => s + f(b), 0));
  const totals = {
    deposits: { count: add((b) => b.deposits.count), amount: add((b) => b.deposits.amount) },
    withdrawals: { count: add((b) => b.withdrawals.count), amount: add((b) => b.withdrawals.amount) },
    floatTransfers: {
      count: add((b) => b.floatTransfers.count),
      amount: add((b) => b.floatTransfers.amount),
    },
    cashCollections: {
      count: add((b) => b.cashCollections.count),
      amount: add((b) => b.cashCollections.amount),
    },
    transactions: {
      total: add((b) => b.transactions.total),
      daytime: add((b) => b.transactions.daytime),
      evening: add((b) => b.transactions.evening),
    },
    turnedDown: add((b) => b.turnedDown),
    walkIns: add((b) => b.walkIns),
    cash: add((b) => b.cash),
    float: add((b) => b.float),
    total: add((b) => b.total),
    commission: add((b) => b.commission ?? 0),
    commissionMonth: add((b) => b.commissionMonth),
    surplus: add((b) => b.surplus),
    deficit: add((b) => b.deficit),
    signedOut: out.filter((b) => b.signedOut).length,
    branches: out.length,
    trading: out.filter((b) => b.tradingDay).length,
  };
  return { date, branches: out, totals };
}

/** The day's report for one branch as the text AMS shares with the team. */
export function dayText(b, date) {
  const k = (n) => `K${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  const who = b.signedOutBy ? `${b.signedOutBy.firstName} ${b.signedOutBy.lastName}` : '';
  return [
    `*${b.name}*`,
    date.split('-').reverse().join('/'),
    `Status: ${b.signedOut ? `Signed out at ${lusakaTime(b.signedOutAt)}` : b.tradingDay ? 'Open' : 'Closed today'}`,
    '',
    `Deposits: ${b.deposits.count} (${k(b.deposits.amount)})`,
    `Withdrawals: ${b.withdrawals.count} (${k(b.withdrawals.amount)})`,
    `Float transfers: ${b.floatTransfers.count} (${k(b.floatTransfers.amount)})`,
    `Cash retired to finance: ${b.cashCollections.count} (${k(b.cashCollections.amount)})`,
    '',
    `Transactions ${b.hours.opensAt}–${b.hours.eveningFrom}: ${b.transactions.daytime}`,
    `Transactions after ${b.hours.eveningFrom}: ${b.transactions.evening}`,
    `Total transactions: ${b.transactions.total}`,
    `Customers turned down: ${b.turnedDown}`,
    `Walk-in customers: ${b.walkIns}`,
    '',
    `Cash: ${k(b.cash)}`,
    `Float as per phone statements: ${k(b.float)} (Airtel ${k(b.airtel)}, MTN ${k(b.mtn)})`,
    `Total float + cash: ${k(b.total)}`,
    ...(b.commission != null ? [`Daily commission: ${k(b.commission)}`] : []),
    `Commission this month: ${k(b.commissionMonth)}`,
    ...(b.deficit ? [`Deficit: ${k(b.deficit)}`] : []),
    ...(b.surplus ? [`Surplus: ${k(b.surplus)}`] : []),
    '',
    who,
  ]
    .join('\n')
    .trim();
}
