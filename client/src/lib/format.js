const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Lusaka',
});

/** 'YYYY-MM-DD' → '3 Feb 2025'. Parsed as a calendar date so no timezone can shift it. */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return dateFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Event timestamps are stored in UTC and shown in Lusaka time. */
export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(
    typeof value === 'string' && !value.endsWith('Z') ? `${value.replace(' ', 'T')}Z` : value,
  );
  return Number.isNaN(d.getTime()) ? String(value) : dateTimeFmt.format(d);
}

export const ROLE_LABELS = { HR_OFFICER: 'HR Officer', HR_ADMIN: 'HR Administrator' };

export const fullName = (p) => [p?.firstName, p?.lastName].filter(Boolean).join(' ');
