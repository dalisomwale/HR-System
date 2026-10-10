import knex from 'knex';
import { getConfig } from '../../src/config/env.js';
import { knexConfigFrom } from '../../src/db/knex-config.js';

// Tables holding required configuration created by migrations; never cleared between tests.
const CONFIG_TABLES = new Set([
  'knex_migrations',
  'knex_migrations_lock',
  'roles',
  'system_settings',
  'work_schedules',
]);

export function createTestDb() {
  const config = getConfig();
  if (!config.isTest || !config.db.database.endsWith('_test')) {
    throw new Error('Refusing to use a non-test database in tests');
  }
  return knex(knexConfigFrom(config));
}

/** Remove all test fixtures. TRUNCATE bypasses the append-only triggers, which is intended here only. */
export async function resetData(db) {
  const config = getConfig();
  if (!config.db.database.endsWith('_test')) throw new Error('Refusing to reset a non-test database');
  const [rows] = await db.raw(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = ?',
    [config.db.database, 'BASE TABLE'],
  );
  await db.transaction(async (trx) => {
    await trx.raw('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of rows) {
      if (!CONFIG_TABLES.has(name)) await trx.raw('TRUNCATE TABLE ??', [name]);
    }
    await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
  });
}
