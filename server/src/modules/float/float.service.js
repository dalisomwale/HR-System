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
const EMAIL = { app: 'float' };

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

/** A branch's accounts in use: Cash, and the networks the System Admin set it to use (D125). */
export async function accountsOf(db, branchId) {
  return db('float_accounts')
    .where({ branch_id: branchId, is_active: true })
    .orderByRaw("FIELD(kind, 'CASH', 'AIRTEL', 'MTN')");
}

/** Refuse a network the branch does not use. */
export async function mustUse(db, branchId, kind) {
  if (kind === 'CASH') return;
  const acc = await db('float_accounts').where({ branch_id: branchId, kind }).first('is_active');
  if (!acc?.is_active) throw badRequest(`This branch does not use ${KIND_LABEL[kind]}.`);
}

/** The networks each branch uses, by branch id. */
export async function branchNetworks(db, ids) {
  const rows = ids.length
    ? await db('float_accounts')
        .whereIn('branch_id', ids)
        .whereIn('kind', ['AIRTEL', 'MTN'])
        .where('is_active', true)
        .select('branch_id', 'kind')
    : [];
  return new Map(
    ids.map((id) => [
      id,
      ['AIRTEL', 'MTN'].filter((k) => rows.some((r) => r.branch_id === id && r.kind === k)),
    ]),
  );
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

/** Float system users who can record at a branch (their employee record's branch). */
export async function branchStaff(db, branchId) {
  const ids = await moduleHolders(db, 'float', ['float.record']);
  if (!ids.length) return [];
  return db('employees').whereIn('id', ids).where({ branch_id: branchId, status: 'ACTIVE' }).pluck('id');
}
export const managers = (db, exclude = []) => moduleHolders(db, 'float', ['float.approve'], exclude);
export const directors = (db, exclude = []) => moduleHolders(db, 'float', ['float.director'], exclude);
/** The Operations Officers (supervisors): branch staff report to them (D121). */
export async function supervisors(db, exclude = []) {
  // The Operations Officers; managers (who can also supervise) only when there is no officer.
  const all = await moduleHolders(db, 'float', ['float.supervise'], exclude);
  const managerIds = new Set(await moduleHolders(db, 'float', ['float.approve'], exclude));
  const officers = all.filter((id) => !managerIds.has(id));
  return officers.length ? officers : all;
}
/** Who receives a branch's daily report when it closes: supervisors, managers, directors and the System Admin. */
export async function reportRecipients(db, exclude = []) {
  const admins = await db('employee_roles as er')
    .join('roles as r', 'r.id', 'er.role_id')
    .join('employees as e', 'e.id', 'er.employee_id')
    .where({ 'r.code': 'HR_ADMIN', 'e.status': 'ACTIVE' })
    .pluck('e.id');
  const ids = [
    ...(await moduleHolders(
      db,
      'float',
      ['float.supervise', 'float.approve', 'float.director', 'float.admin'],
      exclude,
    )),
    ...admins,
  ];
  return [...new Set(ids)].filter((id) => !exclude.includes(id));
}

/** Tell the branch and the managers when an account has just gone below its minimum. */
export async function lowFloatCheck(trx, { branchId, kind, before, after, account }) {
  const min = Number(account.min_balance);
  if (!(min > 0 && after < min && before >= min)) return;
  const branch = await trx('stock_branches').where({ id: branchId }).first('name');
  const title = `${KIND_LABEL[kind]} low at ${branch.name}`;
  await notify(trx, {
    recipients: [...(await branchStaff(trx, branchId)), ...(await supervisors(trx))],
    event: 'FLOAT_LOW',
    title,
    body: `${kwacha(after)} left; the minimum is ${kwacha(min)}. Ask for a top-up.`,
    link: `/float/branch?branch=${branchId}`,
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
      .where({ kind: 'CLOSE', status: 'CONFIRMED' })
      .whereBetween('business_date', [`${month}-01`, date])
      .orderBy('id')
      .select('id', 'branch_id', 'business_date', 'commission'),
    db('float_variances')
      .whereIn('branch_id', none)
      .where({ business_date: date })
      .select('branch_id', 'amount'),
    db('float_accounts').whereIn('branch_id', none),
  ]);
  // The store's opening (D121): when, who, and the balances it opened with (the books before the day).
  const opens = await db('float_counts as c')
    .join('employees as e', 'e.id', 'c.counted_by')
    .whereIn('c.branch_id', none)
    .where({ 'c.business_date': date, 'c.kind': 'OPEN' })
    .orderBy('c.id')
    .select('c.id', 'c.branch_id', 'c.created_at', 'c.status', 'e.first_name', 'e.last_name');
  const firstOpen = new Map();
  for (const o of opens) if (!firstOpen.has(o.branch_id)) firstOpen.set(o.branch_id, o);
  // Opening balances: what the store opened with; without an opening, the books before the day
  // (with any opening balances set up that day).
  const openLines = firstOpen.size
    ? await db('float_count_lines as l')
        .join('float_accounts as a', 'a.id', 'l.account_id')
        .whereIn(
          'l.count_id',
          [...firstOpen.values()].map((o) => o.id),
        )
        .select('l.count_id', 'a.branch_id', 'a.kind', 'l.counted')
    : [];
  const before = await db('float_entries as f')
    .join('float_accounts as a', 'a.id', 'f.account_id')
    .whereIn('f.branch_id', none)
    .where((w) =>
      w
        .where('f.business_date', '<', date)
        .orWhere((x) => x.where('f.business_date', date).where('f.entry_type', 'OPENING')),
    )
    .groupBy('f.branch_id', 'a.kind')
    .select('f.branch_id', 'a.kind')
    .sum({ s: 'f.amount' });
  const opening = (id, kind) => {
    const line = openLines.find(
      (l) => l.branch_id === id && l.kind === kind && l.count_id === firstOpen.get(id)?.id,
    );
    return round2(line ? line.counted : (before.find((x) => x.branch_id === id && x.kind === kind)?.s ?? 0));
  };
  const lastClose = new Map();
  const closePending = new Set();
  for (const c of closes) {
    if (c.status === 'PENDING') closePending.add(c.branch_id);
    else lastClose.set(c.branch_id, c);
  }
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
      openedAt: firstOpen.get(b.id)?.created_at ?? null,
      openPending: firstOpen.get(b.id)?.status === 'PENDING',
      closePending: closePending.has(b.id),
      openedBy: firstOpen.get(b.id)
        ? { firstName: firstOpen.get(b.id).first_name, lastName: firstOpen.get(b.id).last_name }
        : null,
      openingCash: opening(b.id, 'CASH'),
      openingAirtel: opening(b.id, 'AIRTEL'),
      openingMtn: opening(b.id, 'MTN'),
      openingFloat: round2(opening(b.id, 'AIRTEL') + opening(b.id, 'MTN')),
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
      hasData: Boolean(
        firstOpen.get(b.id) || close || t.length || floatIn.length || collections.length || turnedDown,
      ),
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
    airtel: add((b) => b.airtel),
    mtn: add((b) => b.mtn),
    float: add((b) => b.float),
    openingCash: add((b) => b.openingCash),
    openingFloat: add((b) => b.openingFloat),
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
