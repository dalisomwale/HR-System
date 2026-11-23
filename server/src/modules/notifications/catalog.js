/*
 * Every leave notification (D113), as listed on Leave Management › Admin › Notifications. For
 * each one the System Admin chooses whether it is sent (in the system) and whether it is also
 * emailed. An email always comes with the notification in the system, never on its own.
 *
 *   events    the event types it covers (what notify() is called with)
 *   email     whether it is emailed by default
 *   required  asks someone to act, so it is always sent in the system (only the email can be
 *             switched off): an approver's queue item, or an employee asked to answer
 *
 * Notifications not listed here (the inventory system's, the test email) are always sent.
 */

export const LEAVE_NOTIFICATION_GROUPS = [
  {
    title: 'Their own leave',
    hint: 'Sent to the employee at every stage of their leave.',
    items: [
      {
        key: 'leave_submitted',
        label: 'Request Received',
        description: 'Confirms a leave request was submitted or resubmitted, and who it went to.',
        events: ['LEAVE_SUBMITTED', 'LEAVE_RESUBMITTED'],
        email: true,
      },
      {
        key: 'leave_manager_decision',
        label: 'Manager’s Decision',
        description: 'Their manager approved the request (it goes on to HR) or rejected it.',
        events: ['LEAVE_MANAGER_APPROVED', 'LEAVE_MANAGER_REJECTED'],
        email: true,
      },
      {
        key: 'leave_transferred',
        label: 'Different Dates Offered',
        description: 'Their manager offered other dates; they accept them or withdraw the request.',
        events: ['LEAVE_TRANSFERRED'],
        email: true,
        required: true,
      },
      {
        key: 'leave_returned',
        label: 'Returned For Correction',
        description: 'HR sent the request back to be corrected and resubmitted.',
        events: ['LEAVE_HR_RETURNED'],
        email: true,
        required: true,
      },
      {
        key: 'leave_final',
        label: 'Final Decision',
        description: 'HR approved the leave, or did not approve it.',
        events: ['LEAVE_HR_APPROVED', 'LEAVE_HR_REJECTED'],
        email: true,
      },
      {
        key: 'leave_withdrawn_self',
        label: 'Withdrawal Confirmed',
        description: 'Confirms they withdrew a request.',
        events: ['LEAVE_WITHDRAWN_CONFIRMED'],
        email: true,
      },
      {
        key: 'change_submitted',
        label: 'Cancellation Received',
        description: 'Confirms a request to cancel approved leave (or return early) was received.',
        events: ['CHANGE_SUBMITTED'],
        email: true,
      },
      {
        key: 'change_manager_decision',
        label: 'Manager’s Decision On A Cancellation',
        description: 'Their manager approved the cancellation (it goes on to HR) or rejected it.',
        events: ['CHANGE_MANAGER_APPROVED', 'CHANGE_MANAGER_REJECTED'],
        email: true,
      },
      {
        key: 'change_final',
        label: 'Final Decision On A Cancellation',
        description: 'HR approved the cancellation (and any days returned to the balance), or did not.',
        events: ['CHANGE_HR_APPROVED', 'CHANGE_HR_REJECTED'],
        email: true,
      },
      {
        key: 'leave_starts',
        label: 'Leave Starts Reminder',
        description: 'The working day before approved leave starts: the dates and when they are due back.',
        events: ['LEAVE_STARTS_SOON'],
        email: true,
      },
      {
        key: 'leave_ends',
        label: 'Back-to-work Reminder',
        description: 'On the last working day before they are due back: the day they return.',
        events: ['LEAVE_BACK_TO_WORK'],
        email: true,
      },
      {
        key: 'document_due',
        label: 'Supporting Document Needed',
        description: 'Leave that needs a document (such as a sick note) has started and none is uploaded.',
        events: ['DOCUMENT_DUE'],
        email: true,
      },
      {
        key: 'balance_adjusted',
        label: 'Balance Adjusted',
        description: 'HR recorded an opening balance or an adjustment, with the reason.',
        events: ['BALANCE_ADJUSTED'],
        email: true,
      },
      {
        key: 'carry_forward',
        label: 'Carried-forward Days About To Lapse',
        description: '30 and 7 days before unused carried-forward annual leave is lost.',
        events: ['CARRY_FORWARD_EXPIRING_30', 'CARRY_FORWARD_EXPIRING_7'],
        email: true,
      },
    ],
  },
  {
    title: 'Managers and delegates',
    hint: 'Sent to the person who approves at the manager stage, and to anyone covering for them.',
    items: [
      {
        key: 'awaiting_manager',
        label: 'Request To Review',
        description: 'A leave or cancellation request is waiting for their decision.',
        events: ['LEAVE_AWAITING_MANAGER', 'CHANGE_AWAITING_MANAGER'],
        email: true,
        required: true,
      },
      {
        key: 'undecided_soon',
        label: 'Undecided Leave About To Start',
        description:
          'Leave starts the next working day and is still waiting for a decision (sent to HR when it is at the HR stage).',
        events: ['LEAVE_UNDECIDED_SOON'],
        email: true,
      },
      {
        key: 'approver_withdrawn',
        label: 'Request Withdrawn',
        description: 'A request waiting for them was withdrawn and no longer needs a decision.',
        events: ['LEAVE_WITHDRAWN'],
        email: true,
      },
      {
        key: 'team_final',
        label: 'Team Member’s Final Decision',
        description: 'HR made the final decision on leave or a cancellation they dealt with.',
        events: [
          'LEAVE_HR_APPROVED_FYI',
          'LEAVE_HR_REJECTED_FYI',
          'LEAVE_HR_RETURNED_FYI',
          'CHANGE_HR_APPROVED_FYI',
        ],
        email: false,
      },
      {
        key: 'team_starts',
        label: 'Team Member Going On Leave',
        description: 'The working day before someone who reports to them starts approved leave.',
        events: ['TEAM_LEAVE_STARTS'],
        email: false,
      },
      {
        key: 'delegation',
        label: 'Covering Approvals',
        description: 'They were asked to cover a manager’s leave approvals, or that cover was revoked.',
        events: ['DELEGATION_ASSIGNED', 'DELEGATION_REVOKED'],
        email: true,
      },
    ],
  },
  {
    title: 'HR',
    hint: 'Sent to everyone whose Leave management role gives the final approval.',
    items: [
      {
        key: 'awaiting_hr',
        label: 'Final Approval Needed',
        description: 'A leave or cancellation request is waiting for HR’s final decision.',
        events: ['LEAVE_AWAITING_HR', 'CHANGE_AWAITING_HR'],
        email: true,
        required: true,
      },
      {
        key: 'overdue',
        label: 'Overdue Request',
        description:
          'A request was not decided within the working days set in Workflow Settings (also sent to the manager and their manager).',
        events: ['LEAVE_OVERDUE'],
        email: true,
      },
    ],
  },
];

export const LEAVE_NOTIFICATIONS = LEAVE_NOTIFICATION_GROUPS.flatMap((g) => g.items);
const BY_KEY = new Map(LEAVE_NOTIFICATIONS.map((n) => [n.key, n]));
const BY_EVENT = new Map(LEAVE_NOTIFICATIONS.flatMap((n) => n.events.map((e) => [e, n])));
export const notificationByKey = (key) => BY_KEY.get(key);

/** Whether an event is sent in the system and by email, from the System Admin's choices. */
export async function ruleFor(db, event) {
  const n = BY_EVENT.get(event);
  if (!n) return { inApp: true, email: true };
  const row = await db('notification_settings').where({ notification_key: n.key }).first();
  const inApp = n.required || (row ? Boolean(row.in_app) : true);
  return { inApp, email: inApp && (row ? Boolean(row.email) : n.email) };
}

/** Every leave notification with its current choice, grouped as on the page. */
export async function leaveNotificationSettings(db) {
  const rows = await db('notification_settings').select();
  const saved = new Map(rows.map((r) => [r.notification_key, r]));
  return LEAVE_NOTIFICATION_GROUPS.map((g) => ({
    title: g.title,
    hint: g.hint,
    items: g.items.map((n) => {
      const row = saved.get(n.key);
      const inApp = Boolean(n.required) || (row ? Boolean(row.in_app) : true);
      return {
        key: n.key,
        label: n.label,
        description: n.description,
        required: Boolean(n.required),
        inApp,
        email: inApp && (row ? Boolean(row.email) : n.email),
        emailByDefault: n.email,
      };
    }),
  }));
}
