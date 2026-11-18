import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

/* Shared by the Performance management pages (D115). */

export const usePf = () =>
  useQuery({ queryKey: ['pf-me'], queryFn: () => api.get('/api/performance/me'), staleTime: 30_000 });

export const RATINGS = [
  [5, 'Outstanding'],
  [4, 'Exceeds expectations'],
  [3, 'Meets expectations'],
  [2, 'Needs improvement'],
  [1, 'Unsatisfactory'],
];
export const RATING_LABEL = Object.fromEntries(RATINGS);

export const PHASE = {
  DRAFT: ['Not started', 'neutral'],
  GOAL_SETTING: ['Goal setting', 'brand'],
  MID_YEAR: ['Mid-year', 'brand'],
  YEAR_END: ['Year end', 'pending'],
  CLOSED: ['Closed', 'neutral'],
};
export const NEXT_PHASE = {
  DRAFT: 'GOAL_SETTING',
  GOAL_SETTING: 'MID_YEAR',
  MID_YEAR: 'YEAR_END',
  YEAR_END: 'CLOSED',
};

export const STATUS = {
  GOALS_DRAFT: ['Setting goals', 'neutral'],
  GOALS_SUBMITTED: ['Goals with the manager', 'pending'],
  GOALS_AGREED: ['Goals agreed', 'brand'],
  MID_SELF_DONE: ['Mid-year: with the manager', 'pending'],
  MID_DONE: ['Mid-year done', 'brand'],
  FINAL_SELF_DONE: ['Year end: with the manager', 'pending'],
  FINAL_MANAGER_DONE: ['Waiting for HR sign-off', 'pending'],
  SIGNED_OFF: ['Signed off', 'ok'],
};

export const OUTCOME = {
  CONFIRM: ['Confirm', 'ok'],
  EXTEND: ['Extend probation', 'pending'],
  NOT_CONFIRM: ['Do not confirm', 'danger'],
};
export const PROBATION_STATUS = {
  PENDING_MANAGER: ['With the manager', 'pending'],
  PENDING_HR: ['With HR', 'pending'],
  COMPLETED: ['Decided', 'ok'],
};
export const PROBATION_CRITERIA = [
  ['work', 'Quality of work'],
  ['conduct', 'Conduct and attitude'],
  ['attendance', 'Attendance and punctuality'],
  ['learning', 'Learning the role'],
];

/** "Your turn", "Waiting for X" and the like, for a list row. */
export function nextText(a, me) {
  if (!a.next) return null;
  const mine =
    (a.next.who === 'EMPLOYEE' && a.employee.id === me) || (a.next.who === 'MANAGER' && a.manager?.id === me);
  const who = { EMPLOYEE: a.employee.name, MANAGER: a.manager?.name ?? 'HR', HR: 'HR' }[a.next.who];
  return { mine, text: mine ? a.next.label : `${a.next.label}: ${who}` };
}
