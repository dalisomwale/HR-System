import { processOutbox } from './email-worker.js';
import { runDailyReminders } from './reminders.js';

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
    } finally {
      reminding = false;
    }
  };
  timers.push(setInterval(remind, remindersEveryMs));
  setTimeout(remind, 10_000).unref();

  timers.forEach((t) => t.unref());
  return () => timers.forEach(clearInterval);
}
