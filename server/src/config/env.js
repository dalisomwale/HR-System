import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

/**
 * Load environment variables from a file. Real environment variables always win.
 * Tests load `.env.test`; everything else loads `.env` unless ALTUS_ENV_FILE is set.
 */
export function loadEnvFile() {
  const fileName = process.env.ALTUS_ENV_FILE || (process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
  dotenv.config({ path: path.resolve(REPO_ROOT, fileName), quiet: true });
}

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const intWithDefault = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().nonnegative());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: intWithDefault(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: intWithDefault(0),

  DB_HOST: z.string().min(1),
  DB_PORT: intWithDefault(3306),
  DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/, 'DB_NAME may contain letters, digits and underscores only'),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_POOL_MAX: intWithDefault(10),
  // Optional separate account for schema changes, so the app account needs no DDL rights.
  MIGRATION_DB_USER: optionalString,
  MIGRATION_DB_PASSWORD: optionalString,
  DB_SSL: bool,

  APP_BASE_URL: z.string().url(),
  CLIENT_ORIGIN: z.string().url(),

  SESSION_SECRET: optionalString,
  SESSION_IDLE_MINUTES: intWithDefault(30),
  SESSION_ABSOLUTE_HOURS: intWithDefault(10),
  COOKIE_SECURE: bool,

  ENTRA_TENANT_ID: optionalString,
  ENTRA_CLIENT_ID: optionalString,
  ENTRA_CLIENT_SECRET: optionalString,
  ENTRA_REDIRECT_URI: optionalString,

  DEV_AUTH_ENABLED: bool,

  MAIL_TRANSPORT: z.enum(['graph', 'smtp', 'disabled']).default('disabled'),
  MAIL_SENDER_ADDRESS: optionalString,
  GRAPH_MAIL_CLIENT_ID: optionalString,
  GRAPH_MAIL_CLIENT_SECRET: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: intWithDefault(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,

  DOCUMENT_STORAGE_DIR: optionalString,
  DOCUMENT_MAX_BYTES: intWithDefault(5 * 1024 * 1024),
});

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Validate an environment object and return a frozen config.
 * Pure function: it never reads process.env itself, so it can be tested directly.
 */
export function buildConfig(env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  const problems = [];
  const isProd = e.NODE_ENV === 'production';

  // Environment isolation: each environment must point at its own database.
  if (e.NODE_ENV === 'test' && !e.DB_NAME.endsWith('_test')) {
    problems.push(
      'DB_NAME must end with "_test" when NODE_ENV=test, so tests can never touch a real database',
    );
  }
  if (e.NODE_ENV !== 'test' && e.DB_NAME.endsWith('_test')) {
    problems.push('DB_NAME ending in "_test" is reserved for NODE_ENV=test');
  }

  if (isProd) {
    // Development-only features must be impossible to enable in production.
    if (e.DEV_AUTH_ENABLED) {
      problems.push('DEV_AUTH_ENABLED must not be set in production');
    }
    if (!e.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true in production');
    if (!e.SESSION_SECRET || e.SESSION_SECRET.length < 32) {
      problems.push('SESSION_SECRET must be at least 32 characters in production');
    }
    for (const key of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_REDIRECT_URI']) {
      if (!e[key]) problems.push(`${key} is required in production`);
    }
    if (!e.APP_BASE_URL.startsWith('https://')) problems.push('APP_BASE_URL must use https in production');
    if (!e.DOCUMENT_STORAGE_DIR) problems.push('DOCUMENT_STORAGE_DIR is required in production');
    if (e.MAIL_TRANSPORT === 'disabled') problems.push('MAIL_TRANSPORT must be configured in production');
  }

  if (e.ENTRA_TENANT_ID && !guid.test(e.ENTRA_TENANT_ID)) {
    problems.push('ENTRA_TENANT_ID must be a GUID');
  }
  if (e.MAIL_TRANSPORT === 'graph') {
    for (const key of ['MAIL_SENDER_ADDRESS', 'GRAPH_MAIL_CLIENT_ID', 'GRAPH_MAIL_CLIENT_SECRET']) {
      if (!e[key]) problems.push(`${key} is required when MAIL_TRANSPORT=graph`);
    }
  }
  if (e.MAIL_TRANSPORT === 'smtp') {
    for (const key of ['MAIL_SENDER_ADDRESS', 'SMTP_HOST']) {
      if (!e[key]) problems.push(`${key} is required when MAIL_TRANSPORT=smtp`);
    }
  }

  if (problems.length) throw new ConfigError(problems);

  return Object.freeze({
    env: e.NODE_ENV,
    isProduction: isProd,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    businessTimezone: 'Africa/Lusaka',
    db: Object.freeze({
      host: e.DB_HOST,
      port: e.DB_PORT,
      database: e.DB_NAME,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      poolMax: e.DB_POOL_MAX,
      ssl: e.DB_SSL,
      migrationUser: e.MIGRATION_DB_USER,
      migrationPassword: e.MIGRATION_DB_PASSWORD,
    }),
    appBaseUrl: e.APP_BASE_URL,
    clientOrigin: e.CLIENT_ORIGIN,
    session: Object.freeze({
      secret: e.SESSION_SECRET,
      idleMinutes: e.SESSION_IDLE_MINUTES,
      absoluteHours: e.SESSION_ABSOLUTE_HOURS,
      cookieSecure: e.COOKIE_SECURE,
    }),
    entra: Object.freeze({
      tenantId: e.ENTRA_TENANT_ID,
      clientId: e.ENTRA_CLIENT_ID,
      clientSecret: e.ENTRA_CLIENT_SECRET,
      redirectUri: e.ENTRA_REDIRECT_URI,
    }),
    devAuthEnabled: !isProd && e.DEV_AUTH_ENABLED,
    mail: Object.freeze({
      transport: e.MAIL_TRANSPORT,
      sender: e.MAIL_SENDER_ADDRESS,
    }),
    documents: Object.freeze({
      storageDir: e.DOCUMENT_STORAGE_DIR,
      maxBytes: e.DOCUMENT_MAX_BYTES,
    }),
  });
}

let cached;
export function getConfig() {
  if (!cached) {
    loadEnvFile();
    cached = buildConfig(process.env);
  }
  return cached;
}
