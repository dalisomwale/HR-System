import { todayInLusaka } from '../../utils/dates.js';
import { notify, hrOfficers } from './notify.service.js';

/*
 * Who hears about each step of a leave request, and what they are told. Called inside the
 * same transaction as the step itself. The person who acted is never notified of their own action.
 */

const fmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const day = (iso) => fmt.format(new Date(`${iso}T12:00:00Z`));
const dates = (r) =>
  r.start_date === r.end_date ? day(r.start_date) : `${day(r.start_date)} to ${day(r.end_date)}`;
const daysText = (n) => `${Number(n)} ${Number(n) === 1 ? 'day' : 'days'}`;

async function loadRequest(trx, id) {
  return trx('leave_requests as r')
    .join('employees as e', 'e.id', 'r.employee_id')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .where('r.id', id)
    .first('r.*', 'e.first_name', 'e.last_name', 't.name as type_name', 't.is_confidential');
}

/** Emails leave the system, so a confidential leave type is never named in one. */
const emailType = (r) =>
  r.is_confidential || r.is_sensitive ? 'Leave (details in the system)' : r.type_name;
const rows = (r, status) => [
  ['Reference', r.reference],
  ['Employee', `${r.first_name} ${r.last_name}`],
  ['Leave type', emailType(r)],
  ['Dates', dates(r)],
  ['Days', daysText(r.chargeable_days)],
  ...(status ? [['Status', status]] : []),
];

/** The manager and anyone covering their approvals today. */
async function approversFor(trx, managerId) {
  if (!managerId) return [];
  const today = todayInLusaka();
  const delegates = await trx('delegations')
    .where({ delegator_id: managerId })
    .whereNull('revoked_at')
    .andWhere('start_date', '<=', today)
    .andWhere('end_date', '>=', today)
    .pluck('delegate_id');
  return [managerId, ...delegates];
}

const without = (ids, ...out) => ids.filter((id) => !out.includes(id));

async function toStage(trx, r, actorId) {
  const link = `/leave/requests/${r.id}`;
  const who = `${r.first_name} ${r.last_name}`;
  if (r.status === 'PENDING_MANAGER_APPROVAL') {
    await notify(trx, {
      recipients: without(await approversFor(trx, r.assigned_manager_id), actorId, r.employee_id),
      event: 'LEAVE_AWAITING_MANAGER',
      title: `Leave request to review: ${who}`,
      body: `${who} has requested ${r.type_name.toLowerCase()} for ${dates(r)} (${daysText(r.chargeable_days)}).`,
      link,
      entityType: 'leave_request',
      entityId: r.id,
      email: {
        subject: `Leave request to review: ${r.reference}`,
        heading: 'Leave request to review',
        intro: `${who} has sent a leave request for your review.`,
        rows: rows(r, 'Waiting for your decision'),
        action: 'Please approve or reject it in the leave system.',
      },
    });
  } else if (r.status === 'PENDING_HR_APPROVAL') {
    await notify(trx, {
      recipients: await hrOfficers(trx, [actorId, r.employee_id]),
      event: 'LEAVE_AWAITING_HR',
      title: `Leave awaiting final approval: ${who}`,
      body: `${r.reference}: ${r.type_name} for ${dates(r)} (${daysText(r.chargeable_days)}).${r.routed_without_manager ? ' No manager is recorded, so it came straight to HR.' : ''}`,
      link,
      entityType: 'leave_request',
      entityId: r.id,
      email: {
        subject: `Leave awaiting final approval: ${r.reference}`,
        heading: 'Leave awaiting final approval',
        intro: r.routed_without_manager
          ? `${who} has no manager recorded, so this request has come straight to HR.`
          : `${who}'s manager has approved this request.`,
        rows: rows(r, 'Waiting for HR'),
        action: 'Please give the final decision in the leave system.',
      },
    });
  }
}

const OUTCOME = {
  MANAGER_APPROVED: ['approved by your manager', 'It is now with HR for final approval.', 'With HR'],
  MANAGER_REJECTED: [
    'not approved by your manager',
    'See the reason in the leave system.',
    'Rejected by manager',
  ],
  HR_APPROVED: ['approved', 'Your leave is confirmed.', 'Approved'],
  HR_REJECTED: ['not approved by HR', 'See the reason in the leave system.', 'Rejected by HR'],
  HR_RETURNED: [
    'returned for correction',
    'HR has asked you to correct it. See their comment, then correct and resubmit it in the leave system.',
    'Returned to you',
  ],
};

/**
 * @param {'SUBMITTED'|'RESUBMITTED'|'MANAGER_APPROVED'|'MANAGER_REJECTED'|'HR_APPROVED'|'HR_REJECTED'|'HR_RETURNED'|'WITHDRAWN'} kind
 */
export async function leaveRequestEvent(trx, kind, requestId, { actorId, previousManagerId } = {}) {
  const r = await loadRequest(trx, requestId);
  const link = `/leave/requests/${r.id}`;
  const who = `${r.first_name} ${r.last_name}`;

  if (kind === 'SUBMITTED' || kind === 'RESUBMITTED') {
    await notify(trx, {
      recipients: [r.employee_id],
      event: `LEAVE_${kind}`,
      title: `${kind === 'SUBMITTED' ? 'Request submitted' : 'Request resubmitted'}: ${r.reference}`,
      body:
        r.status === 'PENDING_HR_APPROVAL'
          ? 'It has gone to HR for final approval.'
          : 'Your manager has been asked to review it.',
      link,
      entityType: 'leave_request',
      entityId: r.id,
    });
    await toStage(trx, r, actorId);
    return;
  }

  if (kind === 'WITHDRAWN') {
    const recipients = previousManagerId
      ? await approversFor(trx, previousManagerId)
      : await hrOfficers(trx, [r.employee_id]);
    await notify(trx, {
      recipients: without(recipients, actorId),
      event: 'LEAVE_WITHDRAWN',
      title: `Request withdrawn: ${who}`,
      body: `${r.reference} (${dates(r)}) was withdrawn and no longer needs a decision.`,
      link,
      entityType: 'leave_request',
      entityId: r.id,
    });
    return;
  }

  const [what, next, status] = OUTCOME[kind];
  await notify(trx, {
    recipients: without([r.employee_id], actorId),
    event: `LEAVE_${kind}`,
    title: `Your leave request was ${what}`,
    body: `${r.reference}: ${r.type_name} for ${dates(r)}. ${next}`,
    link,
    entityType: 'leave_request',
    entityId: r.id,
    email: {
      subject: `Your leave request was ${what}: ${r.reference}`,
      heading: `Leave request ${what}`,
      intro: `Your leave request ${r.reference} was ${what}.`,
      rows: rows(r, status),
      action: next,
    },
  });

  // The manager hears the final outcome in the system.
  if (kind.startsWith('HR_') && r.assigned_manager_id) {
    await notify(trx, {
      recipients: without([r.assigned_manager_id], actorId, r.employee_id),
      event: `LEAVE_${kind}_FYI`,
      title: `${who}'s leave was ${OUTCOME[kind][2].toLowerCase()}`,
      body: `${r.reference}: ${dates(r)}.`,
      link,
      entityType: 'leave_request',
      entityId: r.id,
    });
  }
  if (kind === 'MANAGER_APPROVED') await toStage(trx, r, actorId);
}

const CHANGE_LABEL = {
  PLANS_CHANGED: 'cancellation',
  RECALLED_BY_MANAGEMENT: 'recall',
  EARLY_RETURN_BY_CHOICE: 'early return',
};

/** @param {'SUBMITTED'|'MANAGER_APPROVED'|'MANAGER_REJECTED'|'HR_APPROVED'|'HR_REJECTED'} kind */
export async function changeRequestEvent(trx, kind, changeId, { actorId } = {}) {
  const c = await trx('change_requests').where({ id: changeId }).first();
  const r = await loadRequest(trx, c.leave_request_id);
  const link = `/leave/requests/${r.id}`;
  const who = `${r.first_name} ${r.last_name}`;
  const label = CHANGE_LABEL[c.cancel_reason_type] ?? 'cancellation';
  const changeRows = [...rows(r), ['Change', `${c.reference} (${label})`]];

  if (kind === 'SUBMITTED' || kind === 'MANAGER_APPROVED') {
    const atHr = c.status === 'PENDING_HR_APPROVAL';
    const recipients = atHr
      ? await hrOfficers(trx, [actorId, r.employee_id])
      : without(await approversFor(trx, c.assigned_manager_id), actorId, r.employee_id);
    await notify(trx, {
      recipients,
      event: atHr ? 'CHANGE_AWAITING_HR' : 'CHANGE_AWAITING_MANAGER',
      title: `${label[0].toUpperCase()}${label.slice(1)} to review: ${who}`,
      body: `${who} has asked for a ${label} of ${r.reference} (${dates(r)}).`,
      link,
      entityType: 'change_request',
      entityId: c.id,
      email: {
        subject: `Leave ${label} to review: ${c.reference}`,
        heading: `Leave ${label} to review`,
        intro: `${who} has asked for a ${label} of approved leave.`,
        rows: changeRows,
        action: atHr
          ? 'Please give the final decision in the leave system.'
          : 'Please approve or reject it in the leave system.',
      },
    });
    if (kind === 'MANAGER_APPROVED') {
      await notify(trx, {
        recipients: without([r.employee_id], actorId),
        event: 'CHANGE_MANAGER_APPROVED',
        title: `Your ${label} request was approved by your manager`,
        body: `${c.reference}: it is now with HR.`,
        link,
        entityType: 'change_request',
        entityId: c.id,
      });
    }
    return;
  }

  const approved = kind === 'HR_APPROVED';
  const by = kind.startsWith('MANAGER') ? 'your manager' : 'HR';
  const what = approved ? 'approved' : `not approved by ${by}`;
  await notify(trx, {
    recipients: without([r.employee_id], actorId),
    event: `CHANGE_${kind}`,
    title: `Your ${label} request was ${what}`,
    body: approved
      ? `${c.reference}: ${Number(c.days_to_reverse) > 0 ? `${daysText(c.days_to_reverse)} returned to your balance.` : 'No days were returned.'}`
      : `${c.reference}: see the reason in the leave system. Your leave stays as approved.`,
    link,
    entityType: 'change_request',
    entityId: c.id,
    email: {
      subject: `Your leave ${label} was ${what}: ${c.reference}`,
      heading: `Leave ${label} ${what}`,
      intro: approved
        ? `Your request for a ${label} of ${r.reference} was approved.`
        : `Your request for a ${label} of ${r.reference} was ${what}. Your leave stays as approved.`,
      rows: changeRows,
      action: approved ? undefined : 'See the reason in the leave system.',
    },
  });
  if (approved && c.assigned_manager_id) {
    await notify(trx, {
      recipients: without([c.assigned_manager_id], actorId, r.employee_id),
      event: 'CHANGE_HR_APPROVED_FYI',
      title: `${who}'s leave ${label} was approved`,
      body: `${r.reference}: ${dates(r)}.`,
      link,
      entityType: 'change_request',
      entityId: c.id,
    });
  }
}
