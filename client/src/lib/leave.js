import { formatDate } from './format.js';

export const STATUS_LABELS = {
  DRAFT: 'Draft',
  PENDING_MANAGER_APPROVAL: 'With Manager',
  PENDING_EMPLOYEE_ACCEPTANCE: 'With Employee',
  PENDING_HR_APPROVAL: 'With HR',
  RETURNED_FOR_CORRECTION: 'Returned To You',
  APPROVED: 'Approved',
  REJECTED_BY_MANAGER: 'Rejected By Manager',
  REJECTED_BY_HR: 'Rejected By HR',
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
  AMEND: 'Change Of Dates',
  PLANS_CHANGED: 'Plans Changed',
  RECALLED_BY_MANAGEMENT: 'Recalled By Management',
  EARLY_RETURN_BY_CHOICE: 'Returning Early By Choice',
};

export const ACTION_LABELS = {
  SUBMIT: 'Submitted',
  RESUBMIT: 'Resubmitted',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  RETURN: 'Returned For Correction',
  WITHDRAW: 'Withdrawn',
  TRANSFER: 'Transferred With Different Dates',
  ACCEPT: 'Offered Dates Accepted',
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

/*
 * A colour for each leave type (D131), so a type looks the same on balances, lists and history.
 * Types added later get one from FALLBACK, chosen by their id.
 */
const LEAVE_COLORS = {
  ANNUAL: '#2563eb',
  SICK: '#dc2626',
  MOTHERS_DAY: '#db2777',
  COMPASSIONATE: '#7c3aed',
  FAMILY_RESPONSIBILITY: '#0d9488',
  STUDY: '#d97706',
  MATERNITY: '#c026d3',
  PREGNANCY_LOSS: '#9333ea',
  PATERNITY: '#0284c7',
  UNPAID: '#64748b',
};
const FALLBACK = ['#16a34a', '#ea580c', '#4f46e5', '#0891b2', '#be123c', '#65a30d'];
export function leaveColor(type) {
  if (!type) return FALLBACK[0];
  return LEAVE_COLORS[type.code] ?? FALLBACK[Number(type.id || 0) % FALLBACK.length];
}
