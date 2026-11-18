import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { startDueProbationReviews } from '../src/modules/performance/probation.js';

let db;
let app;
let entra;

beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());

const as = (s) => ({
  get: (p) => s.agent.get(p),
  post: (p, body) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .send(body ?? {}),
  put: (p, body) =>
    s.agent
      .put(p)
      .set('X-CSRF-Token', s.csrf)
      .send(body ?? {}),
});

let co;
let people;
let ids;
async function person(key, over = {}) {
  const e = await fixtureEmployee(db, { company_id: co, first_name: key, ...over });
  ids[key] = e.id;
  people[key] = { ...(await signIn(app, entra, { oid: e.oid })), id: e.id };
}
async function giveRole(key, roleName) {
  const role = await db('access_roles').where({ module: 'performance', name: roleName }).first('id');
  await db('access_users').insert({ module: 'performance', employee_id: ids[key], role_id: role.id });
}
const notes = (id, event) => db('notifications').where({ recipient_id: id, event_type: event });

beforeEach(async () => {
  await resetData(db);
  [co] = await db('companies').insert({ code: 'AFS', name: 'Altus Financial Services Limited' });
  people = {};
  ids = {};
  await person('hr');
  await person('manager');
  await person('staff', { managerId: ids.manager });
  await giveRole('hr', 'HR Officer');
});

const phase = (id, to) => as(people.hr).post(`/api/performance/cycles/${id}/phase`, { to });

describe('Performance: the annual appraisal (D115)', () => {
  it('runs from goals to HR sign-off, with a weighted overall score', async () => {
    expect(
      (await as(people.staff).post('/api/performance/cycles', { name: 'Year 2027', year: 2027 })).status,
    ).toBe(403);
    const c = await as(people.hr).post('/api/performance/cycles', {
      name: 'Year 2027',
      year: 2027,
      goalsDue: '2027-02-28',
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await phase(c.body.id, 'MID_YEAR')).status).toBe(409); // one step at a time
    const started = await phase(c.body.id, 'GOAL_SETTING');
    expect(started.body.appraisals).toBe(3);
    expect(await notes(ids.staff, 'CYCLE_GOAL_SETTING')).toHaveLength(1);

    const [mine] = (await as(people.staff).get('/api/performance/appraisals?scope=mine')).body.items;
    expect(mine).toMatchObject({
      status: 'GOALS_DRAFT',
      next: { who: 'EMPLOYEE' },
      manager: { id: ids.manager },
    });
    const id = mine.id;
    const goals = [
      { title: 'Grow the loan book', measure: 'K5m disbursed', weight: 60 },
      { title: 'Cut arrears', measure: 'PAR30 under 5%', weight: 30 },
    ];
    expect((await as(people.staff).put(`/api/performance/appraisals/${id}/goals`, { goals })).status).toBe(
      200,
    );
    // Weights must add up to 100 before sending.
    expect(
      (await as(people.staff).post(`/api/performance/appraisals/${id}/action`, { action: 'SUBMIT_GOALS' }))
        .status,
    ).toBe(400);
    goals.push({ title: 'Train two officers', weight: 10 });
    await as(people.staff).put(`/api/performance/appraisals/${id}/goals`, { goals });
    expect(
      (await as(people.staff).post(`/api/performance/appraisals/${id}/action`, { action: 'SUBMIT_GOALS' }))
        .status,
    ).toBe(200);
    expect(await notes(ids.manager, 'APPRAISAL_GOALS_TO_AGREE')).toHaveLength(1);
    // Someone else cannot see it.
    expect((await as(people.hr).get(`/api/performance/appraisals/${id}`)).status).toBe(200); // HR views all
    const outsider = await fixtureEmployee(db, { company_id: co });
    const o = { ...(await signIn(app, entra, { oid: outsider.oid })) };
    expect((await as(o).get(`/api/performance/appraisals/${id}`)).status).toBe(404);

    expect(
      (await as(people.manager).post(`/api/performance/appraisals/${id}/action`, { action: 'AGREE_GOALS' }))
        .status,
    ).toBe(200);
    const g = (await as(people.staff).get(`/api/performance/appraisals/${id}`)).body.goals;

    // Mid-year.
    await phase(c.body.id, 'MID_YEAR');
    expect(
      (
        await as(people.staff).post(`/api/performance/appraisals/${id}/action`, {
          action: 'MID_SELF',
          comment: 'On track',
          goals: g.map((x) => ({ id: x.id, midProgress: 'Half way' })),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await as(people.manager).post(`/api/performance/appraisals/${id}/action`, {
          action: 'MID_MANAGER',
          comment: 'Good start',
        })
      ).status,
    ).toBe(200);

    // Year end: self ratings, then the manager's ratings give the score.
    await phase(c.body.id, 'YEAR_END');
    const rate = (who, action, ratings, comment) =>
      as(people[who]).post(`/api/performance/appraisals/${id}/action`, {
        action,
        comment,
        goals: g.map((x, i) => ({ id: x.id, rating: ratings[i] })),
      });
    expect((await rate('staff', 'FINAL_SELF', [5, 4, 4], 'A good year')).status).toBe(200);
    // The manager does not see the employee's ratings before... they are sent, but sees them now.
    const forManager = (await as(people.manager).get(`/api/performance/appraisals/${id}`)).body;
    expect(forManager.goals.map((x) => x.selfRating)).toEqual([5, 4, 4]);
    expect((await rate('manager', 'FINAL_MANAGER', [4, 3, 5])).status).toBe(400); // needs a comment
    expect((await rate('manager', 'FINAL_MANAGER', [4, 3, 5], 'Solid')).status).toBe(200);
    expect(await notes(ids.hr, 'APPRAISAL_TO_SIGN_OFF')).toHaveLength(1);
    const done = (await as(people.staff).get(`/api/performance/appraisals/${id}`)).body;
    // (4×60 + 3×30 + 5×10) / 100 = 3.8
    expect(done).toMatchObject({
      overallScore: 3.8,
      overallRating: 'Exceeds expectations',
      status: 'FINAL_MANAGER_DONE',
    });

    expect(
      (await as(people.hr).post(`/api/performance/appraisals/${id}/action`, { action: 'SIGN_OFF' })).status,
    ).toBe(200);
    expect(await notes(ids.staff, 'APPRAISAL_SIGNED_OFF')).toHaveLength(1);
    expect(
      (await as(people.staff).get(`/api/performance/appraisals/${id}`)).body.history.map((h) => h.action),
    ).toEqual([
      'SUBMIT_GOALS',
      'AGREE_GOALS',
      'MID_SELF',
      'MID_MANAGER',
      'FINAL_SELF',
      'FINAL_MANAGER',
      'SIGN_OFF',
    ]);
  });
});

describe('Performance: probation reviews (D115)', () => {
  it('starts before probation ends, and HR’s decision updates the employee record', async () => {
    await db('employees')
      .where({ id: ids.staff })
      .update({ probation_status: 'ON_PROBATION', probation_end_date: '2027-03-31' });
    expect(await startDueProbationReviews(db, '2027-02-01')).toBe(0); // more than 30 days away
    expect(await startDueProbationReviews(db, '2027-03-05')).toBe(1);
    expect(await startDueProbationReviews(db, '2027-03-06')).toBe(0); // once
    expect(await notes(ids.manager, 'PROBATION_REVIEW_DUE')).toHaveLength(1);
    const [p] = (await as(people.manager).get('/api/performance/probation')).body.items;
    expect((await as(people.staff).get(`/api/performance/probation/${p.id}`)).status).toBe(404);

    const review = {
      ratings: { work: 4, conduct: 5, attendance: 4, learning: 3 },
      comment: 'Settling in well; needs more time on credit analysis.',
      recommendation: 'EXTEND',
      extendTo: '2027-01-01',
    };
    expect((await as(people.manager).post(`/api/performance/probation/${p.id}/manager`, review)).status).toBe(
      400,
    );
    review.extendTo = '2027-06-30';
    expect((await as(people.manager).post(`/api/performance/probation/${p.id}/manager`, review)).status).toBe(
      200,
    );
    expect(await notes(ids.hr, 'PROBATION_TO_DECIDE')).toHaveLength(1);

    // Deciding differently from the manager needs a reason.
    expect(
      (await as(people.hr).post(`/api/performance/probation/${p.id}/decide`, { decision: 'CONFIRM' })).status,
    ).toBe(400);
    expect(
      (
        await as(people.hr).post(`/api/performance/probation/${p.id}/decide`, {
          decision: 'EXTEND',
          extendTo: '2027-06-30',
        })
      ).status,
    ).toBe(200);
    const e = await db('employees').where({ id: ids.staff }).first();
    expect(e).toMatchObject({ probation_status: 'EXTENDED', probation_end_date: '2027-06-30' });
    expect(await notes(ids.staff, 'PROBATION_OUTCOME')).toHaveLength(1);
    // The employee record's history shows the change.
    expect(
      await db('employee_history').where({ employee_id: ids.staff }).whereNot('event', 'CREATED').first(),
    ).toBeTruthy();
  });
});
