import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { configureNotifications } from '../src/modules/notifications/notify.service.js';

let db;
let app;
let entra;

beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());

const PDF = Buffer.from('%PDF-1.4\n% test CV\n');
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
  upload: (p, buf, name) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(name))
      .send(buf),
});

let co;
let credit;
let itDept;
let people;
let ids;

async function person(key, over = {}) {
  const e = await fixtureEmployee(db, { company_id: co, first_name: key, ...over });
  ids[key] = e.id;
  people[key] = { ...(await signIn(app, entra, { oid: e.oid })), id: e.id };
}
async function giveRole(key, roleName) {
  const role = await db('access_roles').where({ module: 'recruitment', name: roleName }).first('id');
  await db('access_users').insert({ module: 'recruitment', employee_id: ids[key], role_id: role.id });
}

beforeEach(async () => {
  await resetData(db);
  [co] = await db('companies').insert({ code: 'AFS', name: 'Altus Financial Services Limited' });
  [credit] = await db('departments').insert({ company_id: co, code: 'CRD', name: 'Credit' });
  [itDept] = await db('departments').insert({ company_id: co, code: 'ITD', name: 'Information Technology' });
  people = {};
  ids = {};
  await person('manager', { department_id: credit, roles: ['DEPARTMENT_MANAGER'] });
  await person('staff', { department_id: credit });
  await person('hr', { department_id: itDept });
  await person('director', { department_id: itDept });
  await person('panel', { department_id: credit });
  await giveRole('hr', 'HR Officer');
  await giveRole('director', 'Director');
});

const notes = (id, event) => db('notifications').where({ recipient_id: id, event_type: event });

async function approvedRequest() {
  const r = await as(people.manager).post('/api/recruitment/requests', {
    companyId: co,
    departmentId: credit,
    jobTitle: 'Credit Analyst',
    positions: 1,
    employmentType: 'PERMANENT',
    reason: 'NEW_POSITION',
    justification: 'Loan book has doubled this year.',
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(
    (await as(people.hr).post(`/api/recruitment/requests/${r.body.id}/review`, { action: 'FORWARD' })).status,
  ).toBe(200);
  expect(
    (await as(people.director).post(`/api/recruitment/requests/${r.body.id}/decide`, { action: 'APPROVE' }))
      .status,
  ).toBe(200);
  return r.body.id;
}

async function openVacancy(requestId) {
  const v = await as(people.hr).post('/api/recruitment/vacancies', {
    hiringRequestId: requestId,
    jobTitle: 'Credit Analyst',
    companyId: co,
    departmentId: credit,
    employmentType: 'PERMANENT',
    positions: 1,
    isInternal: true,
  });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  return v.body.id;
}

describe('Recruitment: hiring requests (D114)', () => {
  it('goes from the manager to HR to a director, with each told in turn', async () => {
    configureNotifications({ emailEnabled: true, appUrl: 'https://hr.example.test' });
    try {
      // Staff who manage nobody cannot ask; a manager asks for their own department only.
      const body = {
        companyId: co,
        departmentId: credit,
        jobTitle: 'Credit Analyst',
        employmentType: 'PERMANENT',
        reason: 'NEW_POSITION',
        justification: 'Growth',
      };
      expect((await as(people.staff).post('/api/recruitment/requests', body)).status).toBe(403);
      expect(
        (await as(people.manager).post('/api/recruitment/requests', { ...body, departmentId: itDept }))
          .status,
      ).toBe(403);
      const r = await as(people.manager).post('/api/recruitment/requests', body);
      expect(r.status).toBe(201);
      const id = r.body.id;
      expect(await notes(ids.hr, 'HIRING_REQUEST_TO_REVIEW')).toHaveLength(1);
      const mail = await db('email_outbox').where({ recipient_id: ids.hr }).first();
      expect(mail.subject).toMatch(/^Hiring request to check: HQ-\d{4}-000001 - Altus Group Recruitment$/);

      // The director cannot skip HR; HR forwards it.
      expect(
        (await as(people.director).post(`/api/recruitment/requests/${id}/decide`, { action: 'APPROVE' }))
          .status,
      ).toBe(409);
      expect(
        (await as(people.hr).post(`/api/recruitment/requests/${id}/review`, { action: 'FORWARD' })).status,
      ).toBe(200);
      expect(await notes(ids.director, 'HIRING_REQUEST_TO_APPROVE')).toHaveLength(1);

      // Turning down needs a reason.
      expect(
        (await as(people.director).post(`/api/recruitment/requests/${id}/decide`, { action: 'REJECT' }))
          .status,
      ).toBe(400);
      expect(
        (await as(people.director).post(`/api/recruitment/requests/${id}/decide`, { action: 'APPROVE' }))
          .status,
      ).toBe(200);
      expect(await notes(ids.manager, 'HIRING_REQUEST_APPROVED')).toHaveLength(1);

      const got = (await as(people.manager).get(`/api/recruitment/requests/${id}`)).body;
      expect(got).toMatchObject({
        status: 'APPROVED',
        review: { by: expect.any(String) },
        decision: { by: expect.any(String) },
      });
      // Someone else's request is not visible to staff.
      expect((await as(people.staff).get(`/api/recruitment/requests/${id}`)).status).toBe(404);
    } finally {
      configureNotifications({ emailEnabled: false, appUrl: '' });
    }
  });
});

describe('Recruitment: vacancies, candidates and hiring (D114)', () => {
  it('runs a candidate from application to hire, creating the employee on probation', async () => {
    const vacancyId = await openVacancy(await approvedRequest());
    // The requesting manager is the hiring manager and is told.
    expect(await notes(ids.manager, 'VACANCY_OPENED')).toHaveLength(1);
    expect((await as(people.manager).get(`/api/recruitment/vacancies/${vacancyId}`)).status).toBe(200);
    expect((await as(people.staff).get(`/api/recruitment/vacancies/${vacancyId}`)).status).toBe(404);

    const c = await as(people.hr).post(`/api/recruitment/vacancies/${vacancyId}/candidates`, {
      firstName: 'Chanda',
      lastName: 'Mumba',
      email: 'chanda@example.com',
      source: 'EMAIL',
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const cid = c.body.id;
    expect(
      (await as(people.hr).upload(`/api/recruitment/candidates/${cid}/files`, PDF, 'Chanda CV.pdf')).status,
    ).toBe(201);
    expect(
      (
        await as(people.hr).upload(
          `/api/recruitment/candidates/${cid}/files`,
          Buffer.from('MZ not a cv'),
          'cv.exe',
        )
      ).status,
    ).toBe(400);

    // An interview with a panel: the panel is told, sees the candidate and gives feedback.
    const iv = await as(people.hr).post(`/api/recruitment/candidates/${cid}/interviews`, {
      scheduledAt: '2026-12-01T10:00',
      location: 'Board room',
      panel: [ids.panel, ids.manager],
    });
    expect(iv.status, JSON.stringify(iv.body)).toBe(201);
    expect(await notes(ids.panel, 'INTERVIEW_SCHEDULED')).toHaveLength(1);
    const seen = (await as(people.panel).get(`/api/recruitment/candidates/${cid}`)).body;
    expect(seen.stage).toBe('INTERVIEW');
    expect(seen.files).toHaveLength(1);
    expect(
      (
        await as(people.staff).post(`/api/recruitment/interviews/${iv.body.id}/feedback`, {
          rating: 5,
          recommendation: 'HIRE',
        })
      ).status,
    ).toBe(403);
    for (const k of ['panel', 'manager']) {
      expect(
        (
          await as(people[k]).post(`/api/recruitment/interviews/${iv.body.id}/feedback`, {
            rating: 4,
            recommendation: 'HIRE',
          })
        ).status,
      ).toBe(200);
    }
    expect((await db('interviews').where({ id: iv.body.id }).first()).status).toBe('DONE');

    // Hiring needs an accepted offer.
    const hire = {
      employeeNumber: 'AFS-900',
      jobTitle: 'Credit Analyst',
      companyId: co,
      departmentId: credit,
      lineManagerId: ids.manager,
      employmentStartDate: '2027-01-04',
      employmentType: 'PERMANENT',
      probationEndDate: '2027-04-04',
    };
    expect((await as(people.hr).post(`/api/recruitment/candidates/${cid}/hire`, hire)).status).toBe(409);
    expect(
      (
        await as(people.hr).post(`/api/recruitment/candidates/${cid}/offer`, {
          startDate: '2027-01-04',
          status: 'ACCEPTED',
        })
      ).status,
    ).toBe(200);
    expect((await as(people.director).post(`/api/recruitment/candidates/${cid}/hire`, hire)).status).toBe(
      403,
    );
    const hired = await as(people.hr).post(`/api/recruitment/candidates/${cid}/hire`, hire);
    expect(hired.status, JSON.stringify(hired.body)).toBe(201);
    const e = await db('employees').where({ id: hired.body.employeeId }).first();
    expect(e).toMatchObject({
      first_name: 'Chanda',
      email: 'chanda@example.com',
      department_id: credit,
      line_manager_id: ids.manager,
      probation_status: 'ON_PROBATION',
      probation_end_date: '2027-04-04',
    });
    expect((await db('vacancies').where({ id: vacancyId }).first()).status).toBe('FILLED');
    const history = (await as(people.hr).get(`/api/recruitment/candidates/${cid}`)).body.history.map(
      (h) => h.to,
    );
    expect(history).toEqual(['APPLIED', 'INTERVIEW', 'OFFER', 'OFFER', 'HIRED']);
    // The audit trail of the module shows the work.
    expect((await as(people.hr).get('/api/access/recruitment/audit')).status).toBe(403);
    await person('admin', { roles: ['HR_ADMIN'] });
    const audit = await as(people.admin).get('/api/access/recruitment/audit');
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body)).toContain('CANDIDATE_HIRED');
  });

  it('lets staff see open positions, apply, add a CV and withdraw, without seeing HR notes', async () => {
    const vacancyId = await openVacancy(await approvedRequest());
    const jobs = (await as(people.staff).get('/api/recruitment/jobs')).body.items;
    expect(jobs.map((j) => j.id)).toEqual([vacancyId]);
    const a = await as(people.staff).post(`/api/recruitment/jobs/${vacancyId}/apply`, {
      note: 'I know the loan book well.',
    });
    expect(a.status).toBe(201);
    expect((await as(people.staff).post(`/api/recruitment/jobs/${vacancyId}/apply`, {})).status).toBe(409);
    expect(await notes(ids.hr, 'APPLICATION_RECEIVED')).toHaveLength(1);
    expect(
      (await as(people.staff).upload(`/api/recruitment/candidates/${a.body.id}/files`, PDF, 'my cv.pdf'))
        .status,
    ).toBe(201);
    // They cannot open the candidate record itself.
    expect((await as(people.staff).get(`/api/recruitment/candidates/${a.body.id}`)).status).toBe(404);
    const mine = (await as(people.staff).get('/api/recruitment/applications')).body.items;
    expect(mine).toEqual([
      expect.objectContaining({
        status: 'Received',
        active: true,
        files: [expect.objectContaining({ name: 'my cv.pdf' })],
      }),
    ]);
    // HR turns it down: the applicant is told without the reason.
    await as(people.hr).post(`/api/recruitment/candidates/${a.body.id}/stage`, {
      stage: 'REJECTED',
      comment: 'Needs more experience',
    });
    const told = await notes(ids.staff, 'APPLICATION_UNSUCCESSFUL');
    expect(told).toHaveLength(1);
    expect(told[0].body).not.toMatch(/experience/);
    expect((await as(people.staff).post(`/api/recruitment/applications/${a.body.id}/withdraw`)).status).toBe(
      409,
    );
  });
});
