import { todayInLusaka } from '../../utils/dates.js';
import { addDays } from '../leave/calendar.js';
import { runOnce } from '../leave/jobs.service.js';
import { notify } from '../notifications/notify.service.js';
import { moduleHolders } from '../access/modules.js';

/*
 * Probation reviews start by themselves (D115): once a day, every active employee whose probation
 * (or extended probation) ends within the next 30 days and who has no review for that end date
 * gets one, and their line manager is asked to complete it. Someone with no line manager goes to
 * HR (Probation reviews: Decide).
 */
export const PROBATION_NOTICE_DAYS = 30;

export async function startDueProbationReviews(db, today = todayInLusaka()) {
  const due = await db('employees as e')
    .where('e.status', 'ACTIVE')
    .whereIn('e.probation_status', ['ON_PROBATION', 'EXTENDED'])
    .whereNotNull('e.probation_end_date')
    .where('e.probation_end_date', '<=', addDays(today, PROBATION_NOTICE_DAYS))
    .whereNotExists(
      db('probation_reviews as p')
        .whereRaw('p.employee_id = e.id')
        .whereRaw('p.probation_end_date = e.probation_end_date'),
    )
    .select('e.id', 'e.first_name', 'e.last_name', 'e.line_manager_id', 'e.probation_end_date');
  for (const e of due) {
    await db.transaction(async (trx) => {
      const [id] = await trx('probation_reviews').insert({
        employee_id: e.id,
        manager_id: e.line_manager_id,
        probation_end_date: e.probation_end_date,
      });
      const who = `${e.first_name} ${e.last_name}`;
      const recipients = e.line_manager_id
        ? [e.line_manager_id]
        : await moduleHolders(trx, 'performance', ['performance.probation'], [e.id]);
      await notify(trx, {
        recipients,
        event: 'PROBATION_REVIEW_DUE',
        title: `Probation review: ${who}`,
        body: `Probation ends ${e.probation_end_date}. Complete the review and recommend an outcome.`,
        link: `/performance/probation/${id}`,
        entityType: 'probation_review',
        entityId: id,
        email: {
          app: 'performance',
          subject: `Probation review: ${who}`,
          heading: 'Probation review due',
          intro: `${who}’s probation ends on ${e.probation_end_date}.`,
          action: 'Please complete the review in the performance system: confirm, extend or do not confirm.',
        },
      });
    });
  }
  return due.length;
}

/** Once per Lusaka day, from the scheduler. */
export const runProbationJob = (db, today = todayInLusaka()) =>
  runOnce(
    db,
    'PROBATION_REVIEWS',
    today,
    async () => ({ started: await startDueProbationReviews(db, today) }),
    {
      actorType: 'SYSTEM',
    },
  );
