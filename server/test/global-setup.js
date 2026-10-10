import knex from 'knex';
import { getConfig } from '../src/config/env.js';
import { knexConfigFrom } from '../src/db/knex-config.js';

/**
 * Rebuild the isolated test database from migrations before the suite runs: clear fixtures
 * left by the previous run, roll every migration back (which exercises the down migrations),
 * then apply them all again.
 * getConfig() refuses any DB_NAME that does not end in "_test" when NODE_ENV=test, so this
 * can never run against a development or production database.
 */
export async function setup() {
  process.env.NODE_ENV = 'test';
  // Tests never use real sessions; a fixed secret means .env.test does not need one.
  process.env.SESSION_SECRET ??= 'test-only-session-secret-0123456789';
  const config = getConfig();
  if (!config.db.database.endsWith('_test')) throw new Error('Refusing to rebuild a non-test database');
  const db = knex(knexConfigFrom(config, { forMigrations: true }));
  try {
    const [tables] = await db.raw(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
      [config.db.database],
    );
    const keep = new Set([
      'knex_migrations',
      'knex_migrations_lock',
      'roles',
      'system_settings',
      'work_schedules',
    ]);
    await db.transaction(async (trx) => {
      await trx.raw('SET FOREIGN_KEY_CHECKS = 0');
      for (const { name } of tables) if (!keep.has(name)) await trx.raw('TRUNCATE TABLE ??', [name]);
      await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
    });
    await db.migrate.rollback(undefined, true);
    await db.migrate.latest();
  } finally {
    await db.destroy();
  }
}
