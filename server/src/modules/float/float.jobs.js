import { todayInLusaka } from '../../utils/dates.js';
import { runOnce } from '../leave/jobs.service.js';
import { notify } from '../notifications/notify.service.js';
import {
  amsBranches,
  branchHours,
  branchStaff,
  buildDay,
  dayCode,
  getSettings,
  kwacha,
  lusakaTime,
  reportRecipients,
  supervisors,
} from './float.service.js';
import { addDays } from '../leave/calendar.js';

/*
 * AMS cash and float, scheduled work (D117, D118), run by the background scheduler every 15
 * minutes; each part runs at most once per Lusaka day, guarded in the database.
 *
 *   Daily report    on days any branch trades, from the report time: every branch's figures go
 *                   to the managers (to sign off) and the directors, in the system and by email.
 *   Close reminder  at each branch's own closing time on its trading days (D120): branches not signed
 *                   out are reminded, and the managers get the list.
 *   Sign-off chase  each morning, when a past day is still not signed off.
 */
const SYSTEM = { actorType: 'SYSTEM' };
const EMAIL = { app: 'float' };

export async function sendDailyReport(db, settings, date) {
  const day = await buildDay(db, settings, date);
  const t = day.totals;
  const open = day.branches.filter((b) => b.tradingDay && !b.signedOut).map((b) => b.name);
  await db.transaction(async (trx) =>
    notify(trx, {
      recipients: await reportRecipients(trx),
      event: 'FLOAT_DAILY_REPORT',
      title: `AMS daily report ${date}: ${t.transactions.total} transactions, float + cash ${kwacha(t.total)}`,
      body: open.length ? `Not signed out yet: ${open.join(', ')}.` : 'Every branch has signed out.',
      link: `/float/daily?date=${date}`,
      email: {
        ...EMAIL,
        subject: `AMS daily report: ${date}`,
        heading: 'AMS daily report',
        intro: `The day's figures for every AMS branch.${open.length ? ` Not signed out yet: ${open.join(', ')}.` : ''}`,
        rows: [
          ...day.branches.map((b) => [
            b.name,
            `${b.transactions.total} transactions · float + cash ${kwacha(b.total)}${b.signedOut ? '' : ' (open)'}`,
          ]),
          ['All branches', `${t.transactions.total} transactions · float + cash ${kwacha(t.total)}`],
          ['Customers turned down', String(t.turnedDown)],
          ['Daily commission', kwacha(t.commission)],
          ['Deficits', kwacha(t.deficit)],
        ],
        action: 'Open the daily report in the inventory system. A manager signs it off, which locks the day.',
      },
    }),
  );
  return { branches: day.branches.length, notSignedOut: open.length };
}

export async function runFloatJobs(db, now = new Date()) {
  const settings = await getSettings(db);
  if (!settings.companyId) return { skipped: true };
  const today = todayInLusaka(now);
  const time = lusakaTime(now);
  const out = {};

  // Each branch is reminded at its own closing time, on its own trading days (D120).
  const branches = await amsBranches(db, settings, { activeOnly: true });
  const hours = await branchHours(
    db,
    settings,
    branches.map((b) => b.id),
  );
  const reminded = [];
  for (const b of branches) {
    const h = hours.get(b.id);
    if (!h.workingDays.includes(dayCode(today)) || time < h.closesAt) continue;
    const r = await runOnce(
      db,
      `FLOAT_CLOSE_REMINDER_${b.id}`,
      today,
      async () => {
        const closed = await db('float_counts')
          .where({ kind: 'CLOSE', business_date: today, branch_id: b.id })
          .first('id');
        if (closed) return { reminded: false };
        await db.transaction(async (trx) =>
          notify(trx, {
            recipients: [...(await branchStaff(trx, b.id)), ...(await supervisors(trx))],
            event: 'FLOAT_CLOSE_REMINDER',
            title: `Sign out at ${b.name}`,
            body: `${b.name} closes at ${h.closesAt}. Count the cash and the Airtel and MTN balances, and close the day.`,
            link: '/float/branch',
          }),
        );
        return { reminded: true };
      },
      SYSTEM,
    );
    if (r?.reminded) reminded.push(b.name);
  }
  if (reminded.length) out.close = reminded;

  // The daily report goes on any day at least one branch trades.
  const trading = [...hours.values()].some((h) => h.workingDays.includes(dayCode(today)));

  if (trading && time >= settings.reportTime) {
    out.daily = await runOnce(
      db,
      'FLOAT_DAILY_REPORT',
      today,
      () => sendDailyReport(db, settings, today),
      SYSTEM,
    );
  }

  // Each morning: days in the last month that no manager has signed off.
  out.chase = await runOnce(
    db,
    'FLOAT_SIGNOFF_REMINDER',
    today,
    async () => {
      const from = addDays(today, -31);
      const active = await db('float_counts')
        .whereBetween('business_date', [from, addDays(today, -1)])
        .distinct()
        .pluck('business_date');
      const signed = new Set(
        await db('float_days').where('business_date', '>=', from).pluck('business_date'),
      );
      const late = active.filter((d) => !signed.has(d)).sort();
      if (!late.length) return { reminded: 0 };
      await db.transaction(async (trx) =>
        notify(trx, {
          recipients: await supervisors(trx),
          event: 'FLOAT_DAY_REMINDER',
          title: `${late.length === 1 ? 'An AMS daily report is' : `${late.length} AMS daily reports are`} not signed off`,
          body: late.join(', '),
          link: `/float/daily?date=${late[0]}`,
        }),
      );
      return { reminded: late.length };
    },
    SYSTEM,
  );
  return out;
}
