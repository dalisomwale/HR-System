import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

/* Shared by the Recruitment management pages (D114). */

export const useRc = () =>
  useQuery({ queryKey: ['rc-me'], queryFn: () => api.get('/api/recruitment/me'), staleTime: 30_000 });
export const useRcOptions = () =>
  useQuery({
    queryKey: ['rc-options'],
    queryFn: () => api.get('/api/recruitment/options'),
    staleTime: 60_000,
  });

export const REQUEST_STATUS = {
  PENDING_REVIEW: ['With HR', 'pending'],
  PENDING_APPROVAL: ['With a director', 'pending'],
  APPROVED: ['Approved', 'ok'],
  REJECTED: ['Not approved', 'danger'],
  CANCELLED: ['Cancelled', 'neutral'],
};
export const VACANCY_STATUS = {
  OPEN: ['Open', 'ok'],
  ON_HOLD: ['On hold', 'pending'],
  CLOSED: ['Closed', 'neutral'],
  FILLED: ['Filled', 'brand'],
};
export const STAGES = [
  ['APPLIED', 'Applied'],
  ['SCREENING', 'Screening'],
  ['SHORTLISTED', 'Shortlisted'],
  ['INTERVIEW', 'Interview'],
  ['OFFER', 'Offer'],
  ['HIRED', 'Hired'],
  ['REJECTED', 'Not successful'],
  ['WITHDRAWN', 'Withdrawn'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);
export const STAGE_TONE = {
  APPLIED: 'neutral',
  SCREENING: 'neutral',
  SHORTLISTED: 'brand',
  INTERVIEW: 'brand',
  OFFER: 'pending',
  HIRED: 'ok',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};
export const ACTIVE_STAGES = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'OFFER'];
export const EMPLOYMENT_TYPES = [
  ['PERMANENT', 'Permanent'],
  ['FIXED_TERM', 'Fixed term'],
  ['TEMPORARY', 'Temporary'],
];
export const EMPLOYMENT_LABEL = Object.fromEntries(EMPLOYMENT_TYPES);
export const SOURCES = [
  ['EMAIL', 'Email'],
  ['AGENCY', 'Agency'],
  ['WALK_IN', 'Walk-in'],
  ['REFERRAL', 'Referral'],
  ['OTHER', 'Other'],
];
export const SOURCE_LABEL = { ...Object.fromEntries(SOURCES), INTERNAL: 'Internal applicant' };
export const RECOMMENDATION = {
  HIRE: ['Hire', 'ok'],
  MAYBE: ['Maybe', 'pending'],
  NO_HIRE: ['Do not hire', 'danger'],
};

/** 'YYYY-MM-DDTHH:mm' as "1 Dec 2026, 10:00". */
export function whenText(s) {
  if (!s) return '';
  const [d, t] = s.split('T');
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T12:00:00Z`));
  return t ? `${day}, ${t}` : day;
}

/** A date a number of months after an ISO date (for a default probation end). */
export function addMonths(iso, n) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export const UPLOAD_OK = /\.(pdf|docx|jpe?g|png)$/i;
export const UPLOAD_WRONG = 'Only PDF, Word (.docx), JPEG and PNG files can be uploaded.';
