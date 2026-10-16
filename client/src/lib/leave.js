import { formatDate } from './format.js';

export const STATUS_LABELS = {
  DRAFT: 'Draft',
  PENDING_MANAGER_APPROVAL: 'With manager',
  PENDING_EMPLOYEE_ACCEPTANCE: 'With employee',
  PENDING_HR_APPROVAL: 'With HR',
  RETURNED_FOR_CORRECTION: 'Returned to you',
  APPROVED: 'Approved',
  REJECTED_BY_MANAGER: 'Rejected by manager',
  REJECTED_BY_HR: 'Rejected by HR',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
};

/**
 * Status as the viewer should read it. "With HR" and "With manager" describe where a request is
 * from the employee's side; for the person who has to decide it reads "Awaiting your approval".
 * `yourTurn` is the status the viewer acts on (PENDING_HR_APPROVAL for HR, PENDING_MANAGER_APPROVAL
 * for a manager); a request of their own never counts.
 */
export function statusLabel(r, yourTurn, viewerId) {
  const own = r.isOwn || (viewerId != null && r.employee?.id === viewerId);
  if (yourTurn && r.status === yourTurn && !own) return 'Awaiting your approval';
  if (r.status === 'PENDING_EMPLOYEE_ACCEPTANCE' && (own || viewerId == null)) {
    return 'Awaiting your acceptance';
  }
  return STATUS_LABELS[r.status] ?? r.status;
}

export const STATUS_TONES = {
  PENDING_MANAGER_APPROVAL: 'pending',
  PENDING_EMPLOYEE_ACCEPTANCE: 'pending',
  PENDING_HR_APPROVAL: 'pending',
  RETURNED_FOR_CORRECTION: 'pending',
  APPROVED: 'ok',
  REJECTED_BY_MANAGER: 'danger',
  REJECTED_BY_HR: 'danger',
};

export const CHANGE_LABELS = {
  CANCEL: 'Cancellation',
  AMEND: 'Change of dates',
  PLANS_CHANGED: 'Plans changed',
  RECALLED_BY_MANAGEMENT: 'Recalled by management',
  EARLY_RETURN_BY_CHOICE: 'Returning early by choice',
};

export const ACTION_LABELS = {
  SUBMIT: 'Submitted',
  RESUBMIT: 'Resubmitted',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  RETURN: 'Returned for correction',
  WITHDRAW: 'Withdrawn',
  TRANSFER: 'Transferred with different dates',
  ACCEPT: 'Offered dates accepted',
  ROUTE: 'Routed',
  ESCALATE: 'Escalated',
};

export const STAGE_LABELS = { EMPLOYEE: 'Employee', MANAGER: 'Manager', HR: 'HR', SYSTEM: 'System' };

export const days = (n) => `${Number(n)} ${Number(n) === 1 ? 'day' : 'days'}`;

/** '3 Feb 2025 (afternoon) – 5 Feb 2025 (morning)' */
export function dateRange(r) {
  const start = `${formatDate(r.startDate)}${r.startPortion === 'PM_ONLY' ? ' (afternoon)' : ''}`;
  if (r.startDate === r.endDate) {
    return r.endPortion === 'AM_ONLY' ? `${formatDate(r.startDate)} (morning)` : start;
  }
  return `${start} – ${formatDate(r.endDate)}${r.endPortion === 'AM_ONLY' ? ' (morning)' : ''}`;
}

export const PERIOD_LABELS = {
  LEAVE_YEAR: 'per leave year',
  ROLLING_12_MONTHS: 'in any 12 months',
  CALENDAR_MONTH: 'per month',
};
