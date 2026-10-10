import pino from 'pino';
import { getConfig, ConfigError } from './config/env.js';
import { getDb, closeDb } from './db/index.js';
import { createApp } from './app.js';

let config;
try {
  config = getConfig();
} catch (err) {
  // Refuse to start on invalid configuration (including dev-only settings in production).
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

if (config.devAuthEnabled) {
  logger.warn('Development sign-in adapter is enabled. This is refused in production.');
}

const app = createApp({ config, db, logger });
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'Altus Leave API listening');
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
