import { getSetting } from '../leave/policy.service.js';

/** Minutes to wait before attempt n+1 after n failed attempts. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240, 720];
export const backoffMinutes = (attempts) => BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1];

/**
 * Send what is due from the email outbox. Safe to run from several processes at once: each
 * message is claimed under a row lock (SKIP LOCKED) and a lease, so it is sent by one only.
 * A lease that expires (the process died mid-send) makes the message due again.
 */
export async function processOutbox(db, transport, { batchSize = 20, logger } = {}) {
  const maxAttempts = Number(await getSetting(db, 'email_max_attempts', 5)) || 5;
  const claimed = await db.transaction(async (trx) => {
    const rows = await trx('email_outbox')
      .where((w) =>
        w
          .where((q) =>
            q.whereIn('status', ['QUEUED', 'FAILED']).andWhere('next_attempt_at', '<=', trx.raw('NOW()')),
          )
          .orWhere((q) => q.where('status', 'SENDING').andWhere('locked_until', '<', trx.raw('NOW()'))),
      )
      .orderBy('id')
      .limit(batchSize)
      .forUpdate()
      .skipLocked()
      .select('id', 'to_address', 'subject', 'body_html', 'body_text', 'attempts');
    if (rows.length) {
      await trx('email_outbox')
        .whereIn(
          'id',
          rows.map((r) => r.id),
        )
        .update({
          status: 'SENDING',
          attempts: trx.raw('attempts + 1'),
          locked_until: trx.raw('NOW() + INTERVAL 5 MINUTE'),
        });
    }
    return rows;
  });

  const result = { accepted: 0, failed: 0, dead: 0 };
  for (const m of claimed) {
    const attempts = m.attempts + 1;
    try {
      const { messageId } = await transport.send({
        to: m.to_address,
        subject: m.subject,
        html: m.body_html,
        text: m.body_text,
      });
      await db('email_outbox')
        .where({ id: m.id })
        .update({
          status: 'ACCEPTED',
          accepted_at: db.fn.now(),
          provider_message_id: messageId ? String(messageId).slice(0, 255) : null,
          locked_until: null,
          last_error: null,
        });
      result.accepted += 1;
    } catch (err) {
      const dead = attempts >= maxAttempts;
      await db('email_outbox')
        .where({ id: m.id })
        .update({
          status: dead ? 'DEAD' : 'FAILED',
          last_error: String(err?.message ?? err).slice(0, 2000),
          locked_until: null,
          next_attempt_at: dead
            ? db.fn.now()
            : db.raw('NOW() + INTERVAL ? MINUTE', [backoffMinutes(attempts)]),
        });
      result[dead ? 'dead' : 'failed'] += 1;
      logger?.warn({ emailId: m.id, attempts, dead, err: err?.message }, 'Email not sent');
    }
  }
  return result;
}
