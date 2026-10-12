import { renderEmail } from './mail-template.js';

/*
 * In-system notifications and queued emails, always written in the caller's transaction:
 * if the workflow change rolls back, so do its notifications and emails.
 */

let settings = { emailEnabled: false, appUrl: '' };

/** Called once at start-up with the mail transport state and the address people open. */
export function configureNotifications({ emailEnabled, appUrl }) {
  settings = { emailEnabled: Boolean(emailEnabled), appUrl: String(appUrl ?? '').replace(/\/$/, '') };
}
export const notificationSettings = () => ({ ...settings });

/**
 * @param trx  knex transaction
 * @param {object} n
 * @param {number[]} n.recipients  employee IDs; inactive people and duplicates are skipped
 * @param {string} n.event   e.g. LEAVE_SUBMITTED
 * @param {string} n.title   in-app title
 * @param {string} [n.body]  in-app text
 * @param {string} [n.link]  in-app path, e.g. /leave/requests/42
 * @param {string} [n.entityType] @param {number} [n.entityId]
 * @param {object} [n.email] { subject, heading, intro, rows, action } — omitted for in-app only
 */
export async function notify(trx, { recipients, event, title, body, link, entityType, entityId, email }) {
  const ids = [...new Set(recipients.filter((x) => Number.isInteger(x)))];
  if (!ids.length) return { notified: 0, emailed: 0 };
  const people = await trx('employees')
    .whereIn('id', ids)
    .where({ status: 'ACTIVE' })
    .select('id', 'first_name', 'email');
  if (!people.length) return { notified: 0, emailed: 0 };

  await trx('notifications').insert(
    people.map((p) => ({
      recipient_id: p.id,
      event_type: event,
      title: title.slice(0, 200),
      body: body ? body.slice(0, 1000) : null,
      link_path: link ?? null,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
    })),
  );

  let emailed = 0;
  if (email && settings.emailEnabled) {
    const url = link && settings.appUrl ? `${settings.appUrl}${link}` : undefined;
    const rows = people
      .filter((p) => p.email)
      .map((p) => {
        const { html, text } = renderEmail({
          greetingName: p.first_name,
          heading: email.heading ?? title,
          intro: email.intro,
          rows: email.rows,
          action: email.action,
          url,
        });
        return {
          recipient_id: p.id,
          to_address: p.email,
          subject: `${email.subject ?? title} - Altus Group Leave`.slice(0, 255),
          body_html: html,
          body_text: text,
          event_type: event,
          entity_type: entityType ?? null,
          entity_id: entityId ?? null,
        };
      });
    if (rows.length) await trx('email_outbox').insert(rows);
    emailed = rows.length;
  }
  return { notified: people.length, emailed };
}

/** Active HR Officers, optionally leaving some people out (the actor, the employee). */
export async function hrOfficers(trx, exclude = []) {
  return trx('employee_roles as er')
    .join('roles as r', 'r.id', 'er.role_id')
    .join('employees as e', 'e.id', 'er.employee_id')
    .where({ 'r.code': 'HR_OFFICER', 'e.status': 'ACTIVE' })
    .whereNotIn('e.id', exclude.filter(Boolean))
    .pluck('e.id');
}

export async function hrAdministrators(trx) {
  return trx('employee_roles as er')
    .join('roles as r', 'r.id', 'er.role_id')
    .join('employees as e', 'e.id', 'er.employee_id')
    .where({ 'r.code': 'HR_ADMIN', 'e.status': 'ACTIVE' })
    .pluck('e.id');
}
