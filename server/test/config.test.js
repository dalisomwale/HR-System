import { describe, it, expect } from 'vitest';
import { buildConfig, ConfigError } from '../src/config/env.js';

const TENANT = '11111111-2222-3333-4444-555555555555';

const productionEnv = {
  NODE_ENV: 'production',
  DB_HOST: 'db.internal',
  DB_NAME: 'altus_leave',
  DB_USER: 'altus_app',
  DB_PASSWORD: 'x',
  APP_BASE_URL: 'https://leave.example.internal',
  CLIENT_ORIGIN: 'https://leave.example.internal',
  SESSION_SECRET: 'a'.repeat(48),
  COOKIE_SECURE: 'true',
  ENTRA_TENANT_ID: TENANT,
  ENTRA_CLIENT_ID: 'client',
  ENTRA_CLIENT_SECRET: 'secret',
  ENTRA_REDIRECT_URI: 'https://leave.example.internal/api/auth/callback',
  DOCUMENT_STORAGE_DIR: '/var/lib/altus-leave/documents',
  MAIL_TRANSPORT: 'graph',
  MAIL_SENDER_ADDRESS: 'leave@example.internal',
  GRAPH_MAIL_CLIENT_ID: 'mail-client',
  GRAPH_MAIL_CLIENT_SECRET: 'mail-secret',
};

function problemsFor(env) {
  try {
    buildConfig(env);
    return [];
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err.problems;
  }
}

describe('configuration guards', () => {
  it('accepts a complete production configuration', () => {
    const config = buildConfig(productionEnv);
    expect(config.isProduction).toBe(true);
    expect(config.entra.configured).toBe(true);
    expect(config.session.cookieName).toBe('__Host-altus.sid');
  });

  it('requires secure cookies, a strong session secret and Entra settings in production', () => {
    const problems = problemsFor({
      ...productionEnv,
      COOKIE_SECURE: 'false',
      SESSION_SECRET: 'short',
      ENTRA_CLIENT_SECRET: '',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'COOKIE_SECURE must be true in production',
        expect.stringMatching(/^SESSION_SECRET must be at least 32 characters in production/),
        'ENTRA_CLIENT_SECRET is required in production',
      ]),
    );
  });

  it('refuses disabled email and plain http in production', () => {
    const problems = problemsFor({
      ...productionEnv,
      MAIL_TRANSPORT: 'disabled',
      APP_BASE_URL: 'http://leave.local',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'MAIL_TRANSPORT must be configured in production',
        'APP_BASE_URL must use https in production',
      ]),
    );
  });

  it('keeps test and non-test databases apart', () => {
    expect(problemsFor({ ...productionEnv, NODE_ENV: 'test', DB_NAME: 'altus_leave' })[0]).toMatch(
      /must end with "_test"/,
    );
    expect(problemsFor({ ...productionEnv, DB_NAME: 'altus_leave_test' })).toContain(
      'DB_NAME ending in "_test" is reserved for NODE_ENV=test',
    );
  });

  it('needs all four Microsoft settings together, outside production too', () => {
    const problems = problemsFor({
      ...productionEnv,
      NODE_ENV: 'development',
      DB_NAME: 'altus_leave_dev',
      ENTRA_CLIENT_SECRET: '',
    });
    expect(problems).toContain(
      'ENTRA_CLIENT_SECRET is missing (Microsoft sign-in needs all four ENTRA_ settings)',
    );
  });

  it('requires a session secret in every environment', () => {
    const problems = problemsFor({
      ...productionEnv,
      NODE_ENV: 'development',
      DB_NAME: 'x',
      SESSION_SECRET: '',
    });
    expect(problems[0]).toMatch(/SESSION_SECRET must be at least 16 characters/);
  });

  it('lets command-line tools run without a session secret', () => {
    const env = { ...productionEnv, NODE_ENV: 'development', DB_NAME: 'x', SESSION_SECRET: '' };
    expect(() => buildConfig(env, { forTool: true })).not.toThrow();
  });

  it('lets migrations run on a new production server before sign-in and email are set up', () => {
    const env = {
      ...productionEnv,
      ENTRA_TENANT_ID: '',
      ENTRA_CLIENT_ID: '',
      ENTRA_CLIENT_SECRET: '',
      MAIL_TRANSPORT: 'graph',
      MAIL_SENDER_ADDRESS: '',
      GRAPH_MAIL_CLIENT_ID: '',
      GRAPH_MAIL_CLIENT_SECRET: '',
    };
    expect(() => buildConfig(env, { forTool: true })).not.toThrow();
    // The running system still refuses the same settings.
    expect(() => buildConfig(env)).toThrow(/ENTRA_TENANT_ID is required in production/);
  });

  it('rejects a malformed tenant ID', () => {
    expect(problemsFor({ ...productionEnv, ENTRA_TENANT_ID: 'altus' })).toContain(
      'ENTRA_TENANT_ID must be a GUID',
    );
  });
});
