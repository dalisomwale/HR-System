import { todayInLusaka } from '../../utils/dates.js';
import { addDays, eachDate, weekdayKey } from './calendar.js';

/** Working days elapsed after `fromIso` up to and including `toIso` (company schedule, holidays excluded). */
export async function workingCalendar(db, fromIso, toIso) {
  const schedule = await db('work_schedules').where({ is_company_default: true }).first();
  const holidays = new Set(
    await db('public_holidays').whereBetween('holiday_date', [fromIso, toIso]).pluck('holiday_date'),
  );
  return (since) => {
    let n = 0;
    for (const d of eachDate(addDays(since, 1), toIso)) {
      if (Number(schedule?.[`${weekdayKey(d)}_fraction`] ?? 0) > 0 && !holidays.has(d)) n += 1;
    }
    return n;
  };
}

/** The Lusaka date a request entered its current approval stage. */
export const stageSince = (r) => {
  const t =
    r.status === 'PENDING_HR_APPROVAL' && r.manager_decided_at && r.manager_decided_at > r.submitted_at
      ? r.manager_decided_at
      : r.submitted_at;
  return t ? todayInLusaka(new Date(t)) : null;
};
