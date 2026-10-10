import pino from 'pino';
import { getConfig, ConfigError } from './config/env.js';
import { getDb, closeDb } from './db/index.js';
import { createApp } from './app.js';
import { createEntraClient } from './modules/auth/entra.client.js';

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

const entra = config.entra.configured ? createEntraClient(config.entra) : null;
if (!entra) {
  logger.warn(
    'Microsoft sign-in is not configured (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI). Nobody can sign in until it is.',
  );
}

const app = createApp({ config, db, logger, entra });
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
