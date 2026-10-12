import { todayInLusaka } from '../../utils/dates.js';
import { addDays, daysBetween } from '../leave/calendar.js';
import { getSetting } from '../leave/policy.service.js';
import { runOnce } from '../leave/jobs.service.js';
import { workingCalendar, stageSince } from '../leave/working-days.js';
import { notify, hrOfficers } from './notify.service.js';

const SYSTEM = { actorType: 'SYSTEM' };
const fmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const day = (iso) => fmt.format(new Date(`${iso}T12:00:00Z`));

function requestRows(db) {
  return db('leave_requests as r')
    .join('employees as e', 'e.id', 'r.employee_id')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .select(
      'r.*',
      'e.first_name',
      'e.last_name',
      'e.line_manager_id as emp_manager_id',
      't.name as type_name',
      't.is_confidential',
    );
}

/**
 * Requests not decided within the configured working days are marked overdue and escalated:
 * at the manager stage to the manager (and delegates), the manager's own manager and HR; at
 * the HR stage to HR. Never approved automatically (decision D9). Each stage escalates once.
 */
export async function escalateOverdue(db, today = todayInLusaka()) {
  const pending = await requestRows(db)
    .whereIn('r.status', ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL'])
    .where('r.is_overdue', false);
  if (!pending.length) return 0;
  const earliest = pending.map(stageSince).filter(Boolean).sort()[0];
  const age = await workingCalendar(db, earliest, today);
  const limits = {
    PENDING_MANAGER_APPROVAL: Number(await getSetting(db, 'overdue_manager_working_days', 3)),
    PENDING_HR_APPROVAL: Number(await getSetting(db, 'overdue_hr_working_days', 3)),
  };
  let escalated = 0;
  for (const r of pending) {
    const since = stageSince(r);
    const waited = since ? age(since) : 0;
    if (waited <= limits[r.status]) continue;
    await db.transaction(async (trx) => {
      const locked = await trx('leave_requests')
        .where({ id: r.id })
        .forUpdate()
        .first('status', 'is_overdue');
      if (locked.status !== r.status || locked.is_overdue) return;
      await trx('leave_requests').where({ id: r.id }).update({ is_overdue: true });
      const atManager = r.status === 'PENDING_MANAGER_APPROVAL';
      await trx('approval_actions').insert({
        leave_request_id: r.id,
        stage: 'SYSTEM',
        action: 'ESCALATE',
        acting_as: 'SYSTEM',
        from_status: r.status,
        to_status: r.status,
        comment: `Not decided within ${limits[r.status]} working days; ${atManager ? 'the manager, their manager and HR were' : 'HR was'} notified. The request is not approved automatically.`,
      });
      let recipients = await hrOfficers(trx, [r.employee_id]);
      if (atManager && r.assigned_manager_id) {
        const delegates = await trx('delegations')
          .where({ delegator_id: r.assigned_manager_id })
          .whereNull('revoked_at')
          .andWhere('start_date', '<=', today)
          .andWhere('end_date', '>=', today)
          .pluck('delegate_id');
        const above = await trx('employees').where({ id: r.assigned_manager_id }).first('line_manager_id');
        recipients = [r.assigned_manager_id, ...delegates, above?.line_manager_id, ...recipients];
      }
      const who = `${r.first_name} ${r.last_name}`;
      await notify(trx, {
        recipients: recipients.filter((id) => id && id !== r.employee_id),
        event: 'LEAVE_OVERDUE',
        title: `Overdue: ${who}'s leave request ${r.reference}`,
        body: `Waiting ${waited} working days for ${atManager ? 'the manager' : 'HR'}.`,
        link: `/leave/requests/${r.id}`,
        entityType: 'leave_request',
        entityId: r.id,
        email: {
          subject: `Overdue leave request: ${r.reference}`,
          heading: 'Leave request overdue',
          intro: `This request has waited ${waited} working days for ${atManager ? 'a manager decision' : 'HR'}.`,
          rows: [
            ['Reference', r.reference],
            ['Employee', who],
            [
              'Leave type',
              r.is_confidential || r.is_sensitive ? 'Leave (details in the system)' : r.type_name,
            ],
            [
              'Dates',
              r.start_date === r.end_date ? day(r.start_date) : `${day(r.start_date)} to ${day(r.end_date)}`,
            ],
            ['Status', atManager ? 'Waiting for the manager' : 'Waiting for HR'],
          ],
          action: 'Please make sure it is decided. It will not be approved automatically.',
        },
      });
      escalated += 1;
    });
  }
  return escalated;
}

/** Leave that has started without a required document: remind the employee once. */
export async function remindDocumentsDue(db, today = todayInLusaka()) {
  const rows = await requestRows(db)
    .join('leave_policy_versions as p', 'p.id', 'r.policy_version_id')
    .where('p.document_required', true)
    .whereIn('r.status', ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL', 'APPROVED'])
    .andWhere('r.start_date', '<=', today)
    .andWhere('r.end_date', '>=', addDays(today, -60))
    .whereNotExists((q) =>
      q
        .select(db.raw(1))
        .from('documents as d')
        .whereRaw('d.leave_request_id = r.id')
        .whereNull('d.deleted_at'),
    )
    .whereNotExists((q) =>
      q
        .select(db.raw(1))
        .from('notifications as n')
        .where('n.event_type', 'DOCUMENT_DUE')
        .andWhere('n.entity_type', 'leave_request')
        .whereRaw('n.entity_id = r.id'),
    )
    .select('p.document_description');
  for (const r of rows) {
    await db.transaction((trx) =>
      notify(trx, {
        recipients: [r.employee_id],
        event: 'DOCUMENT_DUE',
        title: `Document needed for ${r.reference}`,
        body: `Upload ${r.document_description ?? 'the supporting document'} for your ${r.type_name.toLowerCase()}.`,
        link: `/leave/requests/${r.id}`,
        entityType: 'leave_request',
        entityId: r.id,
        email: {
          subject: `Document needed for ${r.reference}`,
          heading: 'Supporting document needed',
          intro: 'Your leave needs a supporting document, and none has been uploaded yet.',
          rows: [
            ['Reference', r.reference],
            [
              'Leave type',
              r.is_confidential || r.is_sensitive ? 'Leave (details in the system)' : r.type_name,
            ],
            [
              'Dates',
              r.start_date === r.end_date ? day(r.start_date) : `${day(r.start_date)} to ${day(r.end_date)}`,
            ],
          ],
          action: 'Please upload it on the request page in the leave system.',
        },
      }),
    );
  }
  return rows.length;
}

/** Remind people with unused carried-forward days 30 and 7 days before they lapse. */
export async function remindCarryForwardExpiry(db, today = todayInLusaka()) {
  const year = Number(today.slice(0, 4));
  const annual = await db('leave_types').where({ code: 'ANNUAL' }).first('id', 'name');
  if (!annual) return 0;
  const p = await db('leave_policy_versions')
    .where({ leave_type_id: annual.id })
    .andWhere('effective_from', '<=', today)
    .andWhere((w) => w.whereNull('effective_to').orWhere('effective_to', '>=', today))
    .first('carry_forward_expiry_month', 'carry_forward_expiry_day');
  if (!p?.carry_forward_expiry_month) return 0;
  const expiry = `${year}-${String(p.carry_forward_expiry_month).padStart(2, '0')}-${String(p.carry_forward_expiry_day).padStart(2, '0')}`;
  const left = daysBetween(today, expiry);
  if (left < 0 || left > 30) return 0;
  const milestone = left <= 7 ? 7 : 30;
  const event = `CARRY_FORWARD_EXPIRING_${milestone}`;

  const carried = await db('balance_ledger')
    .where({ leave_type_id: annual.id, leave_year: year, entry_type: 'CARRY_FORWARD_IN' })
    .groupBy('employee_id')
    .select('employee_id')
    .sum({ carried: 'amount' });
  let sent = 0;
  for (const c of carried) {
    const already = await db('notifications')
      .where({ recipient_id: c.employee_id, event_type: event, entity_type: 'leave_year', entity_id: year })
      .first('id');
    if (already) continue;
    const used = await db('leave_request_days as x')
      .join('leave_requests as q', 'q.id', 'x.leave_request_id')
      .where({ 'q.employee_id': c.employee_id, 'q.leave_type_id': annual.id, 'q.status': 'APPROVED' })
      .whereBetween('x.leave_date', [`${year}-01-01`, expiry])
      .sum({ d: 'x.charged' })
      .first();
    const unused = Math.round(Math.max(0, Number(c.carried) - Number(used.d ?? 0)) * 100) / 100;
    if (unused <= 0) continue;
    await db.transaction((trx) =>
      notify(trx, {
        recipients: [c.employee_id],
        event,
        title: `${unused} carried-forward days lapse after ${day(expiry)}`,
        body: 'Days carried over from last year that are not taken by then are lost.',
        link: '/leave',
        entityType: 'leave_year',
        entityId: year,
        email: {
          subject: `Carried-forward leave lapses after ${day(expiry)}`,
          heading: 'Carried-forward leave about to lapse',
          intro: `You have ${unused} days of annual leave carried over from ${year - 1} that have not been taken.`,
          rows: [
            ['Unused carried-forward days', String(unused)],
            ['Must be taken by', day(expiry)],
          ],
          action:
            'Days not taken by then are lost. Apply for leave in the leave system if you want to use them.',
        },
      }),
    );
    sent += 1;
  }
  return sent;
}

/** Once a day: escalations and reminders. */
export async function runDailyReminders(db, today = todayInLusaka()) {
  return runOnce(
    db,
    'DAILY_REMINDERS',
    today,
    async () => ({
      overdueEscalated: await escalateOverdue(db, today),
      documentReminders: await remindDocumentsDue(db, today),
      carryForwardReminders: await remindCarryForwardExpiry(db, today),
    }),
    SYSTEM,
  );
}
