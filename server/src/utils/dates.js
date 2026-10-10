/** Today's date in the business timezone (Africa/Lusaka) as 'YYYY-MM-DD'. */
export function todayInLusaka(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lusaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
