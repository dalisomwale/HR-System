import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { normalisePhone } from '../src/utils/phone.js';

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
  patch: (p, body) =>
    s.agent
      .patch(p)
      .set('X-CSRF-Token', s.csrf)
      .send(body ?? {}),
});

let ams;
let other;
let branch;
let admin;
let teller;
let office;
beforeEach(async () => {
  await resetData(db);
  [ams] = await db('companies').insert({ code: 'AMS', name: 'Altus Money Solutions' });
  [other] = await db('companies').insert({ code: 'AFS', name: 'Altus Financial Services' });
  await db('float_settings').insert({ id: 1, company_id: ams });
  [branch] = await db('stock_branches').insert({ company_id: ams, name: 'Kabulonga' });
  const a = await fixtureEmployee(db, { company_id: other, roles: ['HR_ADMIN'] });
  admin = { ...(await signIn(app, entra, { oid: a.oid })), id: a.id };
  teller = await fixtureEmployee(db, { company_id: ams, branch_id: branch, first_name: 'Peter' });
  office = await fixtureEmployee(db, { company_id: other, first_name: 'Olive' });
});

describe('phone numbers on the employee record (D119)', () => {
  it('normalises Zambian numbers so the same number always matches', () => {
    for (const v of ['0971234567', '971234567', '260971234567', '+260 97 123 4567', '(097) 123-4567']) {
      expect(normalisePhone(v)).toBe('+260971234567');
    }
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('call me')).toBeNull();
  });

  it('lets HR keep it, and refuses one already used by someone else', async () => {
    expect(
      (await as(admin).patch(`/api/admin/employees/${teller.id}`, { mobilePhone: '0971234567' })).status,
    ).toBe(200);
    expect((await db('employees').where({ id: teller.id }).first()).phone_e164).toBe('+260971234567');
    const dup = await as(admin).patch(`/api/admin/employees/${office.id}`, {
      mobilePhone: '+260 97 123 4567',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already has this phone number/);
    expect(
      (await as(admin).patch(`/api/admin/employees/${office.id}`, { mobilePhone: 'not a number' })).status,
    ).toBe(400);
    const rec = await as(admin).get(`/api/people/employees/${teller.id}`);
    expect(rec.body.mobilePhone ?? rec.body.employee?.mobilePhone).toBe('0971234567');
  });
});

describe('AMS branch staff sign in with their phone number (D119)', () => {
  const login = (agent, phone, pin) =>
    agent.post('/api/auth/phone/login').set('Content-Type', 'application/json').send({ phone, pin });

  it('uses a one-time code first, then their own PIN; locks after 5 wrong tries', async () => {
    await as(admin).patch(`/api/admin/employees/${teller.id}`, { mobilePhone: '0971234567' });
    // Only AMS branch staff can be set up.
    await as(admin).patch(`/api/admin/employees/${office.id}`, { mobilePhone: '0961111111' });
    expect((await as(admin).post(`/api/float/phone-access/${office.id}/code`)).status).toBe(400);
    const given = await as(admin).post(`/api/float/phone-access/${teller.id}/code`);
    expect(given.status, JSON.stringify(given.body)).toBe(201);
    expect(given.body.code).toMatch(/^\d{8}$/);
    // Text messages are not set up in this app: the code is only on the admin's screen.
    expect(given.body.sms).toEqual({ enabled: false, sent: false, error: 'text messages are not set up' });

    // The code works once, then they choose a PIN; a weak PIN is refused.
    const agent = request.agent(app);
    expect((await login(agent, '+260 97 123 4567', given.body.code)).body).toEqual({ status: 'SET_PIN' });
    const weak = await agent.post('/api/auth/phone/set-pin').send({ pin: '123456', pinConfirm: '123456' });
    expect(weak.status).toBe(400);
    expect(
      (await agent.post('/api/auth/phone/set-pin').send({ pin: '482916', pinConfirm: '482916' })).body,
    ).toEqual({ status: 'OK' });
    const me = await agent.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ id: teller.id, signedInWith: 'PHONE', phoneSignIn: true });

    // Next time: phone and PIN, typed the local way.
    const again = request.agent(app);
    expect((await login(again, '0971234567', given.body.code)).status).toBe(401); // the code is used up
    expect((await login(again, '0971234567', '482916')).body).toEqual({ status: 'OK' });

    // Someone who is not AMS branch staff cannot, even with the right details.
    await db('employees').where({ id: teller.id }).update({ branch_id: null });
    expect((await login(request.agent(app), '0971234567', '482916')).status).toBe(401);
    await db('employees').where({ id: teller.id }).update({ branch_id: branch });

    // Five wrong PINs lock it; a new code from the admin unlocks it.
    const bad = request.agent(app);
    for (let i = 0; i < 5; i += 1) expect((await login(bad, '0971234567', '000111')).status).toBe(401);
    expect((await login(bad, '0971234567', '482916')).status).toBe(423);
    const list = (await as(admin).get('/api/float/phone-access')).body.items;
    expect(list).toEqual([expect.objectContaining({ id: teller.id, status: 'LOCKED' })]);
    const fresh = await as(admin).post(`/api/float/phone-access/${teller.id}/code`);
    expect((await login(request.agent(app), '0971234567', fresh.body.code)).body).toEqual({
      status: 'SET_PIN',
    });
  });

  it('refuses a request that is not JSON, and says nothing about which part was wrong', async () => {
    const agent = request.agent(app);
    expect(
      (await agent.post('/api/auth/phone/login').type('form').send('phone=0971234567&pin=123456')).status,
    ).toBe(400);
    const r = await login(agent, '0979999999', '123456');
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('The phone number or PIN is not right.');
  });
});

describe('the one-time code is texted to the staff member (D127)', () => {
  it('sends it to the phone they sign in with, and says when the text fails', async () => {
    const texts = [];
    let fail = null;
    const sms = {
      enabled: true,
      async send(m) {
        texts.push(m);
        return fail ? { sent: false, error: fail } : { sent: true, messageId: 'ATX1' };
      },
    };
    const texting = testApp(db, {}, { sms });
    const oid = `00000000-0000-0000-0000-${String(admin.id).padStart(12, '0')}`;
    const boss = await signIn(texting.app, texting.entra, { oid });
    const as2 = (p) => boss.agent.post(p).set('X-CSRF-Token', boss.csrf).send({});
    await as(admin).patch(`/api/admin/employees/${teller.id}`, { mobilePhone: '0971234567' });

    expect((await boss.agent.get('/api/float/phone-access')).body.smsEnabled).toBe(true);
    const given = await as2(`/api/float/phone-access/${teller.id}/code`);
    expect(given.status, JSON.stringify(given.body)).toBe(201);
    expect(given.body.sms).toEqual({ enabled: true, sent: true, error: null });
    expect(texts).toHaveLength(1);
    expect(texts[0].to).toBe('+260971234567');
    expect(texts[0].message).toContain(given.body.code);
    expect(texts[0].message.length).toBeLessThanOrEqual(160);
    // The code in the text works.
    const agent = request.agent(texting.app);
    expect(
      (await agent.post('/api/auth/phone/login').set('Content-Type', 'application/json').send({ phone: '0971234567', pin: given.body.code })).body,
    ).toEqual({ status: 'SET_PIN' });

    // A failed text still gives the admin the code, with the reason; the audit says so too.
    fail = 'the Africa\u2019s Talking account has no credit left';
    const again = await as2(`/api/float/phone-access/${teller.id}/code`);
    expect(again.status).toBe(201);
    expect(again.body.code).toMatch(/^\d{8}$/);
    expect(again.body.sms).toMatchObject({ sent: false, error: fail });
    const audit = await db('audit_log')
      .where({ action: 'FLOAT_PHONE_CODE_GIVEN', entity_id: String(teller.id) })
      .orderBy('id');
    const after = (r) => (typeof r.after_data === 'string' ? JSON.parse(r.after_data) : r.after_data);
    expect(audit.map((r) => after(r).sms)).toEqual(['SENT', 'NOT_SENT']);
    // The code itself is never written to the audit trail.
    expect(JSON.stringify(audit)).not.toContain(again.body.code);
  });
});
