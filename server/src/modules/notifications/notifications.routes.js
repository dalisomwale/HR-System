import { Router } from 'express';
import { z } from 'zod';
import { auditContext, requirePerm } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, idParam, pagination } from '../../utils/validation.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { notify, notificationSettings } from './notify.service.js';
import { leaveNotificationSettings, notificationByKey } from './catalog.js';

const view = (n) => ({
  id: n.id,
  event: n.event_type,
  title: n.title,
  body: n.body,
  link: n.link_path,
  read: Boolean(n.read_at),
  createdAt: n.created_at,
});

/** The signed-in person's own notifications. */
export function notificationRoutes({ db }) {
  const router = Router();
  const mine = (req) => db('notifications').where({ recipient_id: req.user.id });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { page, pageSize, offset } = pagination(req.query, { defaultSize: 20, maxSize: 50 });
      const unreadOnly = req.query.unread === '1';
      const q = mine(req).modify((x) => unreadOnly && x.whereNull('read_at'));
      const total = await q.clone().count({ n: '*' }).first();
      const unread = await mine(req).whereNull('read_at').count({ n: '*' }).first();
      const rows = await q.orderBy('id', 'desc').limit(pageSize).offset(offset);
      res.json({ items: rows.map(view), page, pageSize, total: Number(total.n), unread: Number(unread.n) });
    }),
  );

  router.get(
    '/unread-count',
    asyncHandler(async (req, res) => {
      const unread = await mine(req).whereNull('read_at').count({ n: '*' }).first();
      res.set('Cache-Control', 'no-store').json({ unread: Number(unread.n) });
    }),
  );

  router.post(
    '/:id/read',
    asyncHandler(async (req, res) => {
      const n = await mine(req)
        .where({ id: idParam(req) })
        .first('id', 'read_at');
      if (!n) throw notFound('Notification not found.');
      if (!n.read_at) await db('notifications').where({ id: n.id }).update({ read_at: db.fn.now() });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/read-all',
    asyncHandler(async (req, res) => {
      const changed = await mine(req).whereNull('read_at').update({ read_at: db.fn.now() });
      res.json({ marked: changed });
    }),
  );

  return router;
}

/** System Administrators: the email outbox, honest statuses, resend and a test message. */
export function adminEmailRoutes({ db, config }) {
  const router = Router();
  router.use(requirePerm('leave.emails'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { page, pageSize, offset } = pagination(req.query, { defaultSize: 25, maxSize: 100 });
      const status = z
        .enum(['QUEUED', 'SENDING', 'ACCEPTED', 'FAILED', 'DEAD', 'PROBLEMS', ''])
        .catch('')
        .parse(req.query.status ?? '');
      const q = db('email_outbox').modify((x) => {
        if (status === 'PROBLEMS') x.whereIn('status', ['FAILED', 'DEAD']);
        else if (status) x.where({ status });
      });
      const total = await q.clone().count({ n: '*' }).first();
      const counts = await db('email_outbox').select('status').count({ n: '*' }).groupBy('status');
      const rows = await q
        .orderBy('id', 'desc')
        .limit(pageSize)
        .offset(offset)
        .select(
          'id',
          'to_address',
          'subject',
          'event_type',
          'status',
          'attempts',
          'next_attempt_at',
          'last_error',
          'accepted_at',
          'created_at',
        );
      res.json({
        transport: config.mail.transport,
        sender: config.mail.sender ?? null,
        counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
        items: rows.map((r) => ({
          id: r.id,
          to: r.to_address,
          subject: r.subject,
          event: r.event_type,
          status: r.status,
          attempts: r.attempts,
          nextAttemptAt: r.next_attempt_at,
          lastError: r.last_error,
          acceptedAt: r.accepted_at,
          createdAt: r.created_at,
        })),
        page,
        pageSize,
        total: Number(total.n),
      });
    }),
  );

  router.post(
    '/:id/resend',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const m = await trx('email_outbox').where({ id }).forUpdate().first('id', 'status', 'to_address');
        if (!m) throw notFound('Email not found.');
        if (!['FAILED', 'DEAD'].includes(m.status)) throw conflict('Only failed emails can be resent.');
        await trx('email_outbox')
          .where({ id })
          .update({ status: 'QUEUED', attempts: 0, next_attempt_at: trx.fn.now(), last_error: null });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'EMAIL_RESEND',
          entityType: 'email',
          entityId: id,
          before: { status: m.status },
        });
      });
      res.json({ ok: true });
    }),
  );

  // Queue a test message to the administrator's own address, to check the mail setup.
  router.post(
    '/test',
    asyncHandler(async (req, res) => {
      if (!notificationSettings().emailEnabled) {
        throw badRequest('Email is switched off on this server (MAIL_TRANSPORT=disabled).');
      }
      const me = await db('employees').where({ id: req.user.id }).first('email');
      if (!me?.email) throw badRequest('Your employee record has no work email address.');
      await db.transaction(async (trx) => {
        await notify(trx, {
          recipients: [req.user.id],
          event: 'EMAIL_TEST',
          title: 'Test email queued',
          body: `A test message was queued to ${me.email}.`,
          link: '/admin/emails',
          email: {
            subject: 'Test message',
            heading: 'Email is working',
            intro: 'This test message confirms the leave system can send email through Microsoft 365.',
          },
        });
        await writeAudit(trx, { ...auditContext(req), action: 'EMAIL_TEST_QUEUED', entityType: 'email' });
      });
      res.status(201).json({ to: me.email });
    }),
  );

  return router;
}

/**
 * Leave management › Admin › Notifications (D113): which leave notifications are sent, and which
 * are also emailed. Mounted behind the Notifications right (leave.notifications).
 */
export function notificationSettingsRoutes({ db }) {
  const router = Router();
  // ── Which leave notifications are sent and emailed (D113) ─────────────────────────────────
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json({
        emailEnabled: notificationSettings().emailEnabled,
        groups: await leaveNotificationSettings(db),
      });
    }),
  );
  const settingsSchema = z.object({
    items: z.array(z.object({ key: z.string().max(60), inApp: z.boolean(), email: z.boolean() })).max(100),
  });
  router.put(
    '/',
    asyncHandler(async (req, res) => {
      const { items } = settingsSchema.parse(req.body);
      for (const i of items) {
        if (!notificationByKey(i.key)) throw badRequest('One of the notifications no longer exists.');
      }
      await db.transaction(async (trx) => {
        const before = await leaveNotificationSettings(trx);
        const was = new Map(before.flatMap((g) => g.items).map((i) => [i.key, i]));
        const changed = [];
        for (const i of items) {
          const n = notificationByKey(i.key);
          const inApp = Boolean(n.required) || i.inApp;
          const email = inApp && i.email;
          const old = was.get(i.key);
          if (old.inApp === inApp && old.email === email) continue;
          changed.push({
            notification: n.label,
            before: { sent: old.inApp, emailed: old.email },
            after: { sent: inApp, emailed: email },
          });
          await trx('notification_settings')
            .insert({
              notification_key: i.key,
              in_app: inApp,
              email,
              updated_by: req.user.id,
              updated_at: trx.fn.now(),
            })
            .onConflict('notification_key')
            .merge();
        }
        if (changed.length) {
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'NOTIFICATION_SETTINGS_UPDATED',
            entityType: 'system_setting',
            entityId: 'leave_notifications',
            before: Object.fromEntries(changed.map((c) => [c.notification, c.before])),
            after: Object.fromEntries(changed.map((c) => [c.notification, c.after])),
          });
        }
      });
      res.json({
        emailEnabled: notificationSettings().emailEnabled,
        groups: await leaveNotificationSettings(db),
      });
    }),
  );

  return router;
}
