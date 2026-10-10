/**
 * Leave-day calculation. Pure functions: everything they need (schedule, holidays) is passed in,
 * so the same inputs always give the same answer and the result can be stored per day.
 *
 * Dates are 'YYYY-MM-DD' strings throughout and handled as UTC calendar dates, so no timezone
 * can move a day.
 */

const DAY_MS = 86400000;
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
export const toIso = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * DAY_MS));
export const daysBetween = (fromIso, toIsoDate) => Math.round((toDate(toIsoDate) - toDate(fromIso)) / DAY_MS);
export const weekdayKey = (iso) => WEEKDAY_KEYS[toDate(iso).getUTCDay()];

export function* eachDate(startIso, endIso) {
  for (let d = startIso; d <= endIso; d = addDays(d, 1)) yield d;
}

/**
 * Work out what a request charges, day by day.
 *
 * @param {object} p
 * @param {string} p.startDate, p.endDate  inclusive
 * @param {'FULL'|'PM_ONLY'} p.startPortion  first day starts at midday
 * @param {'FULL'|'AM_ONLY'} p.endPortion    last day ends at midday
 * @param {'WORKING_DAYS'|'CALENDAR_DAYS'} p.dayBasis
 * @param {object} p.schedule  { mon: 1, tue: 1, ..., sat: 0, sun: 0 } working fraction per weekday
 * @param {Map<string, {id, name}>} p.holidays  public holidays by date
 */
export function calculateLeaveDays({
  startDate,
  endDate,
  startPortion = 'FULL',
  endPortion = 'FULL',
  dayBasis,
  schedule,
  holidays,
}) {
  if (endDate < startDate) throw new RangeError('End date is before start date');
  const days = [];
  let chargeable = 0;
  let nonWorking = 0;
  const holidaysExcluded = [];

  for (const date of eachDate(startDate, endDate)) {
    let fraction;
    let exclusion = null;
    let holiday = null;

    if (dayBasis === 'CALENDAR_DAYS') {
      fraction = 1;
    } else {
      fraction = Number(schedule[weekdayKey(date)] ?? 0);
      holiday = holidays.get(date) ?? null;
      if (fraction === 0) {
        exclusion = 'NON_WORKING_DAY';
        nonWorking += 1;
      } else if (holiday) {
        // Policy 10.3 / Act s36(2): public holidays during leave are not charged.
        exclusion = 'PUBLIC_HOLIDAY';
        holidaysExcluded.push({ date, name: holiday.name });
        fraction = 0;
      }
    }

    if (fraction > 0) {
      const isFirst = date === startDate;
      const isLast = date === endDate;
      if ((isFirst && startPortion === 'PM_ONLY') || (isLast && endPortion === 'AM_ONLY')) {
        fraction = Math.min(fraction, 0.5);
      }
    }

    chargeable += fraction;
    days.push({
      date,
      charged: fraction,
      exclusion,
      holidayId: exclusion === 'PUBLIC_HOLIDAY' ? holiday.id : null,
    });
  }

  return {
    days,
    calendarDays: days.length,
    chargeableDays: Math.round(chargeable * 100) / 100,
    nonWorkingDaysExcluded: nonWorking,
    holidaysExcluded,
  };
}

/** Group a day breakdown by leave year (calendar year), e.g. a request spanning New Year. */
export function chargeByYear(days) {
  const byYear = new Map();
  for (const d of days) {
    if (d.charged > 0) {
      const y = Number(d.date.slice(0, 4));
      byYear.set(y, Math.round(((byYear.get(y) ?? 0) + d.charged) * 100) / 100);
    }
  }
  return byYear;
}

/** Whole months of service completed on a date (start 2025-01-15 → 2025-07-15 = 6). */
export function completedMonths(employmentStartIso, onIso) {
  const s = toDate(employmentStartIso);
  const d = toDate(onIso);
  let months = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + (d.getUTCMonth() - s.getUTCMonth());
  if (d.getUTCDate() < s.getUTCDate()) months -= 1;
  return Math.max(0, months);
}
