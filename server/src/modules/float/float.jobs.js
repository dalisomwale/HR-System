import { todayInLusaka } from '../../utils/dates.js';
import { runOnce } from '../leave/jobs.service.js';
import { notify } from '../notifications/notify.service.js';
import {
  DAYS,
  amsBranches,
  branchStaff,
  buildWeek,
  getSettings,
  kwacha,
  lusakaTime,
  managers,
  weekEnding,
} from './float.service.js';

/*
 * AMS cash and float, scheduled work (D117), run by the background scheduler every 15 minutes;
 * each part runs at most once per Lusaka day, guarded in the database.
 *
 *   Weekly report   on the day the week ends, from the report time: made for the 7 days ending
 *                   that day, and the managers are asked to sign it off.
 *   Sign-off chase  every day at the report time while a report is still not signed off.
 *   Close reminder  on trading days, from the close reminder time: branches that have not closed
 *                   the day are reminded, and the managers get the list.
 */
const SYSTEM = { actorType: 'SYSTEM' };
const EMAIL = { app: 'inventory' };
const dayCode = (iso) => DAYS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7];

/** Make the weekly report for the week ending `end`. Returns its id. */
export async function generateWeek(db, settings, end) {
  const existing = await db('float_weeks').where({ period_end: end }).first('id');
  if (existing) return existing.id;
  const { start } = weekEnding(settings, end);
  const data = await buildWeek(db, settings, start, end);
  const [id] = await db('float_weeks').insert({
    period_start: start,
    period_end: end,
    data: JSON.stringify(data),
  });
  const t = data.totals;
  await db.transaction(async (trx) =>
    notify(trx, {
      recipients: await managers(trx),
      event: 'FLOAT_WEEK_READY',
      title: `AMS weekly report to sign off: ${start} to ${end}`,
      body: `Deposits ${kwacha(t.depositAmount)}, withdrawals ${kwacha(t.withdrawalAmount)}, deficits ${kwacha(t.deficit)}.`,
      link: `/requisitions/float/reports/${id}`,
      entityType: 'float_week',
      entityId: id,
      email: {
        ...EMAIL,
        subject: `AMS weekly report to sign off: ${start} to ${end}`,
        heading: 'Weekly report ready',
        intro: `The AMS weekly report for ${start} to ${end} is ready for your sign-off.`,
        rows: [
          ['Deposits', `${kwacha(t.depositAmount)} (${t.depositCount})`],
          ['Withdrawals', `${kwacha(t.withdrawalAmount)} (${t.withdrawalCount})`],
          ['Commission earned', kwacha(t.commission)],
          ['Surpluses', kwacha(t.surplus)],
          ['Deficits', kwacha(t.deficit)],
        ],
        action:
          'Check it and sign it off in the inventory system. Once signed off it goes to the director and the week is locked.',
      },
    }),
  );
  return id;
}

export async function runFloatJobs(db, now = new Date()) {
  const settings = await getSettings(db);
  if (!settings.companyId) return { skipped: true };
  const today = todayInLusaka(now);
  const time = lusakaTime(now);
  const out = {};

  if (dayCode(today) === settings.weekEndDay && time >= settings.reportTime) {
    out.week = await runOnce(
      db,
      'FLOAT_WEEK',
      today,
      async () => ({ id: await generateWeek(db, settings, today) }),
      SYSTEM,
    );
  }

  if (time >= settings.reportTime) {
    out.chase = await runOnce(
      db,
      'FLOAT_SIGNOFF_REMINDER',
      today,
      async () => {
        const late = await db('float_weeks')
          .where({ status: 'GENERATED' })
          .where('period_end', '<', today)
          .orderBy('period_end');
        if (!late.length) return { reminded: 0 };
        await db.transaction(async (trx) =>
          notify(trx, {
            recipients: await managers(trx),
            event: 'FLOAT_WEEK_REMINDER',
            title: `${late.length === 1 ? 'An AMS weekly report is' : `${late.length} AMS weekly reports are`} still waiting for sign-off`,
            body: late.map((w) => `${w.period_start} to ${w.period_end}`).join('; '),
            link: '/requisitions/float/reports',
          }),
        );
        return { reminded: late.length };
      },
      SYSTEM,
    );
  }

  if (settings.workingDays.includes(dayCode(today)) && time >= settings.closeReminderTime) {
    out.close = await runOnce(
      db,
      'FLOAT_CLOSE_REMINDER',
      today,
      async () => {
        const branches = await amsBranches(db, settings, { activeOnly: true });
        const closed = new Set(
          await db('float_counts').where({ kind: 'CLOSE', business_date: today }).pluck('branch_id'),
        );
        const open = branches.filter((b) => !closed.has(b.id));
        for (const b of open) {
          await db.transaction(async (trx) =>
            notify(trx, {
              recipients: await branchStaff(trx, b.id),
              event: 'FLOAT_CLOSE_REMINDER',
              title: `Close the day at ${b.name}`,
              body: 'Count the cash and the Airtel and MTN balances, and record them.',
              link: '/requisitions/float/branch',
            }),
          );
        }
        if (open.length) {
          await db.transaction(async (trx) =>
            notify(trx, {
              recipients: await managers(trx),
              event: 'FLOAT_NOT_CLOSED',
              title: `${open.length} AMS ${open.length === 1 ? 'branch has' : 'branches have'} not closed the day`,
              body: open.map((b) => b.name).join(', '),
              link: '/requisitions/float',
            }),
          );
        }
        return { notClosed: open.length };
      },
      SYSTEM,
    );
  }
  return out;
}
