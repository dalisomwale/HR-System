import dns from 'node:dns';
import net from 'node:net';
import pino from 'pino';
import { getConfig, ConfigError } from './config/env.js';
import { getDb, closeDb } from './db/index.js';
import { createApp } from './app.js';
import { createEntraClient } from './modules/auth/entra.client.js';
import { createGraphTransport } from './modules/notifications/graph-mail.js';
import { startBackgroundJobs } from './modules/notifications/scheduler.js';

// Outbound connections (Microsoft sign-in, email) on slow or IPv4-only networks:
// try IPv4 addresses first and give each connection attempt time to complete.
// Node's default of 250 ms per address times out on high-latency links.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

let config;
try {
  config = getConfig();
} catch (err) {
  // Refuse to start on invalid configuration.
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}

const logger = pino({ level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] });
const db = getDb();

try {
  const [, pending] = await db.migrate.list();
  if (pending.length) {
    logger.fatal(
      { pending: pending.map((m) => m.file ?? m.name) },
      'Database has pending migrations. Run npm run migrate.',
    );
    await closeDb();
    process.exit(1);
  }
} catch (err) {
  logger.fatal({ err }, 'Cannot reach the database');
  await closeDb();
  process.exit(1);
}

const entra = config.entra.configured ? createEntraClient(config.entra, { logger }) : null;
if (!entra) {
  logger.warn(
    'Microsoft sign-in is not configured (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI). Nobody can sign in until it is.',
  );
}

const app = createApp({ config, db, logger, entra });
const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, env: config.env }, 'Altus Leave API listening');
});

const transport =
  config.mail.transport === 'graph'
    ? createGraphTransport(
        {
          tenantId: config.mail.tenantId,
          clientId: config.mail.graphClientId,
          clientSecret: config.mail.graphClientSecret,
          sender: config.mail.sender,
        },
        { logger },
      )
    : null;
if (!transport)
  logger.warn('Email is switched off (MAIL_TRANSPORT=disabled). In-system notifications still work.');
const stopJobs = config.backgroundJobs ? startBackgroundJobs({ db, transport, logger }) : () => {};
if (!config.backgroundJobs)
  logger.warn('Background jobs are off (BACKGROUND_JOBS=off): no email sending or reminders.');

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  stopJobs();
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
