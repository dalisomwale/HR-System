import path from 'node:path';
import { REPO_ROOT } from '../config/env.js';

export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');

/** Build a Knex configuration object from validated app config. */
export function knexConfigFrom(config, { forMigrations = false } = {}) {
  const useMigrationAccount = forMigrations && config.db.migrationUser;
  return {
    client: 'mysql2',
    connection: {
      host: config.db.host,
      port: config.db.port,
      user: useMigrationAccount ? config.db.migrationUser : config.db.user,
      password: useMigrationAccount ? (config.db.migrationPassword ?? '') : config.db.password,
      database: config.db.database,
      charset: 'utf8mb4',
      // All event timestamps are stored and read as UTC.
      timezone: 'Z',
      // Leave dates are DATE columns; keep them as 'YYYY-MM-DD' strings so no
      // timezone conversion can shift a day.
      dateStrings: ['DATE'],
      decimalNumbers: false,
      ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined,
    },
    pool: {
      min: 0,
      max: config.db.poolMax,
      afterCreate(conn, done) {
        conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
      },
    },
    migrations: {
      directory: MIGRATIONS_DIR,
      tableName: 'knex_migrations',
      loadExtensions: ['.js'],
    },
  };
}
