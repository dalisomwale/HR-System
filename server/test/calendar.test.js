import { describe, it, expect } from 'vitest';
import { calculateLeaveDays, chargeByYear, completedMonths } from '../src/modules/leave/calendar.js';

const monFri = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 0, sun: 0 };
const holidays = (entries) => new Map(entries.map(([date, name], i) => [date, { id: i + 1, name }]));
const none = new Map();

describe('working-day calculation', () => {
  it('counts Monday to Friday and skips the weekend', () => {
    // Mon 5 Oct 2026 – Sun 11 Oct 2026
    const r = calculateLeaveDays({
      startDate: '2026-10-05',
      endDate: '2026-10-11',
      dayBasis: 'WORKING_DAYS',
      schedule: monFri,
      holidays: none,
    });
    expect(r.chargeableDays).toBe(5);
    expect(r.calendarDays).toBe(7);
    expect(r.nonWorkingDaysExcluded).toBe(2);
  });

  it('does not charge public holidays on working days (policy 10.3)', () => {
    // Independence Day, Sat 24 Oct 2026 falls on a weekend; National Day of Prayer Sun 18 Oct.
    // Use a weekday holiday: Fri 23 Oct (illustrative entry).
    const r = calculateLeaveDays({
      startDate: '2026-10-19',
      endDate: '2026-10-23',
      dayBasis: 'WORKING_DAYS',
      schedule: monFri,
      holidays: holidays([['2026-10-23', 'Holiday']]),
    });
    expect(r.chargeableDays).toBe(4);
    expect(r.holidaysExcluded).toEqual([{ date: '2026-10-23', name: 'Holiday' }]);
    expect(r.days.find((d) => d.date === '2026-10-23')).toMatchObject({
      charged: 0,
      exclusion: 'PUBLIC_HOLIDAY',
    });
  });

  it('a holiday on a weekend is just a non-working day', () => {
    const r = calculateLeaveDays({
      startDate: '2026-10-24',
      endDate: '2026-10-24',
      dayBasis: 'WORKING_DAYS',
      schedule: monFri,
      holidays: holidays([['2026-10-24', 'Independence Day']]),
    });
    expect(r.chargeableDays).toBe(0);
    expect(r.days[0].exclusion).toBe('NON_WORKING_DAY');
  });

  it('charges half days at the start and end', () => {
    const r = calculateLeaveDays({
      startDate: '2026-10-05',
      endDate: '2026-10-07',
      startPortion: 'PM_ONLY',
      endPortion: 'AM_ONLY',
      dayBasis: 'WORKING_DAYS',
      schedule: monFri,
      holidays: none,
    });
    expect(r.chargeableDays).toBe(2);
  });

  it('a single half day is 0.5', () => {
    const r = calculateLeaveDays({
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      endPortion: 'AM_ONLY',
      dayBasis: 'WORKING_DAYS',
      schedule: monFri,
      holidays: none,
    });
    expect(r.chargeableDays).toBe(0.5);
  });

  it('follows an employee-specific schedule including Saturday half days', () => {
    const sixDay = { ...monFri, sat: 0.5 };
    const r = calculateLeaveDays({
      startDate: '2026-10-05',
      endDate: '2026-10-11',
      dayBasis: 'WORKING_DAYS',
      schedule: sixDay,
      holidays: none,
    });
    expect(r.chargeableDays).toBe(5.5);
  });

  it('calendar-day leave counts every day, holidays and weekends included', () => {
    const r = calculateLeaveDays({
      startDate: '2026-10-19',
      endDate: '2026-10-25',
      dayBasis: 'CALENDAR_DAYS',
      schedule: monFri,
      holidays: holidays([['2026-10-24', 'Independence Day']]),
    });
    expect(r.chargeableDays).toBe(7);
  });

  it('14 weeks of maternity leave is 98 calendar days', () => {
    const r = calculateLeaveDays({
      startDate: '2026-11-02',
      endDate: '2027-02-07',
      dayBasis: 'CALENDAR_DAYS',
      schedule: monFri,
      holidays: none,
    });
    expect(r.chargeableDays).toBe(98);
  });

  it('handles leap years and month ends', () => {
    const r = calculateLeaveDays({
      startDate: '2028-02-28',
      endDate: '2028-03-01',
      dayBasis: 'CALENDAR_DAYS',
      schedule: monFri,
      holidays: none,
    });
    expect(r.calendarDays).toBe(3);
  });

  it('splits a request across leave years', () => {
    const r = calculateLeaveDays({
      startDate: '2026-12-28',
      endDate: '2027-01-08',
      dayBasis: 'WORKING_DAYS',
      schedule: monFri,
      holidays: holidays([['2027-01-01', "New Year's Day"]]),
    });
    expect(Object.fromEntries(chargeByYear(r.days))).toEqual({ 2026: 4, 2027: 5 });
  });

  it('refuses an end date before the start date', () => {
    expect(() =>
      calculateLeaveDays({
        startDate: '2026-10-05',
        endDate: '2026-10-04',
        dayBasis: 'WORKING_DAYS',
        schedule: monFri,
        holidays: none,
      }),
    ).toThrow(RangeError);
  });
});

describe('length of service', () => {
  it('counts completed months', () => {
    expect(completedMonths('2025-01-15', '2025-07-14')).toBe(5);
    expect(completedMonths('2025-01-15', '2025-07-15')).toBe(6);
    expect(completedMonths('2026-04-08', '2026-10-10')).toBe(6);
    expect(completedMonths('2026-10-10', '2026-01-01')).toBe(0);
  });
});
