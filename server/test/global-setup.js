import knex from 'knex';
import { getConfig } from '../src/config/env.js';
import { knexConfigFrom } from '../src/db/knex-config.js';

/**
 * Rebuild the isolated test database from migrations before the suite runs.
 * getConfig() refuses any DB_NAME that does not end in "_test" when NODE_ENV=test, so this
 * can never run against a development or production database.
 */
export async function setup() {
  process.env.NODE_ENV = 'test';
  const config = getConfig();
  const db = knex(knexConfigFrom(config, { forMigrations: true }));
  try {
    await db.migrate.rollback(undefined, true);
    await db.migrate.latest();
  } finally {
    await db.destroy();
  }
}
