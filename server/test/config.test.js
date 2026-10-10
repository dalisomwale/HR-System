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
    expect(config.devAuthEnabled).toBe(false);
  });

  it('refuses to start in production with the development sign-in adapter enabled', () => {
    const problems = problemsFor({ ...productionEnv, DEV_AUTH_ENABLED: 'true' });
    expect(problems).toContain('DEV_AUTH_ENABLED must not be set in production');
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
        'SESSION_SECRET must be at least 32 characters in production',
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

  it('only enables the development sign-in adapter outside production', () => {
    const dev = buildConfig({
      ...productionEnv,
      NODE_ENV: 'development',
      DB_NAME: 'altus_leave_dev',
      DEV_AUTH_ENABLED: 'true',
    });
    expect(dev.devAuthEnabled).toBe(true);
  });

  it('rejects a malformed tenant ID', () => {
    expect(problemsFor({ ...productionEnv, ENTRA_TENANT_ID: 'altus' })).toContain(
      'ENTRA_TENANT_ID must be a GUID',
    );
  });
});
