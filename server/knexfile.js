// Used by the knex CLI (npm run migrate). Reads the same validated config as the app,
// but connects with the migration account when one is configured.
import { getConfig } from './src/config/env.js';
import { knexConfigFrom } from './src/db/knex-config.js';

export default knexConfigFrom(getConfig(), { forMigrations: true });
