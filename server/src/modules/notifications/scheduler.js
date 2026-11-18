import { processOutbox } from './email-worker.js';
import { runDailyReminders } from './reminders.js';
import { sendStockDigest } from '../requisitions/stock-alerts.js';
import { runProbationJob } from '../performance/probation.js';

/**
 * Background work inside the API process: send queued email every 30 seconds and run the daily
 * reminders (once per Lusaka day, guarded in the database, so several processes are safe).
 */
export function startBackgroundJobs({
  db,
  transport,
  logger,
  emailEveryMs = 30_000,
  remindersEveryMs = 15 * 60_000,
}) {
  let sending = false;
  let reminding = false;
  const timers = [];

  if (transport) {
    timers.push(
      setInterval(async () => {
        if (sending) return;
        sending = true;
        try {
          const r = await processOutbox(db, transport, { logger });
          if (r.accepted || r.failed || r.dead) logger.info(r, 'Email outbox processed');
        } catch (err) {
          logger.error({ err }, 'Email outbox run failed');
        } finally {
          sending = false;
        }
      }, emailEveryMs),
    );
  }

  const remind = async () => {
    if (reminding) return;
    reminding = true;
    try {
      const r = await runDailyReminders(db);
      if (!r?.skipped) logger.info(r, 'Daily reminders run');
    } catch (err) {
      logger.error({ err }, 'Daily reminders failed');
    }
    // The daily summary of stock that needs reordering (D111): once per Lusaka day, from 07:00.
    try {
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          hour: 'numeric',
          hour12: false,
          timeZone: 'Africa/Lusaka',
        }).format(new Date()),
      );
      const s = hour >= 7 ? await sendStockDigest(db) : { skipped: true };
      if (!s?.skipped) logger.info(s, 'Stock reorder summary run');
      // Probation reviews due in the next 30 days (D115), also from 07:00.
      const p = hour >= 7 ? await runProbationJob(db) : { skipped: true };
      if (!p?.skipped) logger.info(p, 'Probation reviews started');
    } catch (err) {
      logger.error({ err }, 'Stock reorder summary failed');
    } finally {
      reminding = false;
    }
  };
  timers.push(setInterval(remind, remindersEveryMs));
  setTimeout(remind, 10_000).unref();

  timers.forEach((t) => t.unref());
  return () => timers.forEach(clearInterval);
}
