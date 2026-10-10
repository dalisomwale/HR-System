import pino from 'pino';
import request from 'supertest';
import { buildConfig } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';
import { KnexSessionStore } from '../../src/modules/auth/session-store.js';

export const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * Stand-in for Microsoft's servers. Real token validation is done by openid-client in
 * production; here the test supplies the claims a validated ID token would contain.
 */
export function fakeEntra() {
  return {
    nextClaims: null,
    async beginSignIn() {
      return {
        url: 'https://login.microsoftonline.com/fake/authorize',
        checks: { state: 's', nonce: 'n', codeVerifier: 'v' },
      };
    },
    async completeSignIn() {
      if (!this.nextClaims) throw new Error('validation failed');
      return this.nextClaims;
    },
    async signOutUrl(redirect) {
      return `https://login.microsoftonline.com/fake/logout?post_logout_redirect_uri=${encodeURIComponent(redirect)}`;
    },
  };
}

export function testApp(db, env = {}) {
  const config = buildConfig({
    ...process.env,
    SIGN_IN_RATE_LIMIT: '100000', // tests sign in hundreds of times from one address
    ENTRA_TENANT_ID: TENANT,
    ENTRA_CLIENT_ID: 'test-client',
    ENTRA_CLIENT_SECRET: 'test-secret',
    ENTRA_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
    ...env,
  });
  const entra = fakeEntra();
  const sessionStore = new KnexSessionStore(db, { pruneIntervalMs: 0 });
  const app = createApp({
    config,
    db,
    logger: pino({ level: process.env.TEST_LOG ?? 'silent' }),
    entra,
    sessionStore,
  });
  return { app, entra, config };
}

let seq = 0;
/** Test fixture employee, optionally linked to a Microsoft identity and given roles. */
export async function fixtureEmployee(
  db,
  { roles = [], linked = true, status = 'ACTIVE', managerId = null, ...over } = {},
) {
  seq += 1;
  const [id] = await db('employees').insert({
    employee_number: `FX${Date.now() % 100000}${seq}`,
    first_name: 'Fixture',
    last_name: `Person${seq}`,
    email: `fixture${seq}.${Date.now()}@example.test`,
    employment_start_date: '2024-01-01',
    status,
    line_manager_id: managerId,
    ...over,
  });
  const oid = `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`;
  if (linked) {
    await db('identity_links').insert({
      employee_id: id,
      tenant_id: TENANT,
      object_id: oid,
      linked_via: 'ADMIN',
    });
  }
  for (const code of roles) {
    const role = await db('roles').where({ code }).first();
    await db('employee_roles').insert({ employee_id: id, role_id: role.id });
  }
  return { id, oid };
}

/** Sign in through the real routes with the given claims. Returns an agent and its CSRF token. */
export async function signIn(app, entra, claims) {
  const agent = request.agent(app);
  await agent.get('/api/auth/login').expect(302);
  entra.nextClaims = { tid: TENANT, ...claims };
  const cb = await agent.get('/api/auth/callback?code=abc&state=s');
  entra.nextClaims = null;
  const me = await agent.get('/api/auth/me');
  return {
    agent,
    redirect: cb.headers.location,
    csrf: me.body.csrfToken,
    me: me.body.user,
    status: me.status,
  };
}
