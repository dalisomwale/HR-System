/**
 * Platform tables: notifications, email outbox, audit log, sessions, idempotency keys,
 * system settings.
 */

export async function up(knex) {
  await knex.schema.createTable('notifications', (t) => {
    t.bigIncrements('id').primary();
    t.integer('recipient_id').unsigned().notNullable().references('id').inTable('employees');
    t.string('event_type', 60).notNullable();
    t.string('title', 200).notNullable();
    t.string('body', 1000).nullable();
    // In-app path only (e.g. /requests/42). Never an external URL.
    t.string('link_path', 255).nullable();
    t.string('entity_type', 40).nullable();
    t.bigInteger('entity_id').unsigned().nullable();
    t.timestamp('read_at').nullable();
    t.timestamp('created_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.index(['recipient_id', 'read_at', 'created_at']);
  });

  await knex.schema.createTable('email_outbox', (t) => {
    t.bigIncrements('id').primary();
    t.integer('recipient_id').unsigned().nullable().references('id').inTable('employees');
    t.string('to_address', 254).notNullable();
    t.string('subject', 255).notNullable();
    t.text('body_html').notNullable();
    t.text('body_text').notNullable();
    t.string('event_type', 60).notNullable();
    t.string('entity_type', 40).nullable();
    t.bigInteger('entity_id').unsigned().nullable();
    // ACCEPTED means the mail service accepted the message. Inbox delivery cannot be confirmed.
    t.enu('status', ['QUEUED', 'SENDING', 'ACCEPTED', 'FAILED', 'DEAD']).notNullable().defaultTo('QUEUED');
    t.tinyint('attempts').unsigned().notNullable().defaultTo(0);
    t.timestamp('next_attempt_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('locked_until').nullable();
    t.text('last_error').nullable();
    t.string('provider_message_id', 255).nullable();
    t.timestamp('accepted_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.index(['status', 'next_attempt_at']);
    t.index(['entity_type', 'entity_id']);
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.bigIncrements('id').primary();
    t.enu('actor_type', ['USER', 'SYSTEM', 'CLI']).notNullable();
    t.integer('actor_employee_id').unsigned().nullable().references('id').inTable('employees');
    t.string('action', 80).notNullable();
    t.string('entity_type', 40).notNullable();
    t.string('entity_id', 64).nullable();
    t.json('before_data').nullable();
    t.json('after_data').nullable();
    t.string('ip_address', 45).nullable();
    t.string('user_agent', 255).nullable();
    t.string('request_id', 64).nullable();
    t.timestamp('created_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.index(['entity_type', 'entity_id', 'created_at']);
    t.index(['actor_employee_id', 'created_at']);
    t.index(['action', 'created_at']);
    t.index(['created_at']);
  });

  // Column layout matches express-mysql-session, used in Phase 2.
  await knex.schema.createTable('sessions', (t) => {
    t.string('session_id', 128).primary();
    t.integer('expires').unsigned().notNullable();
    t.specificType('data', 'MEDIUMTEXT').nullable();
    t.index(['expires']);
  });

  await knex.schema.createTable('idempotency_keys', (t) => {
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    t.string('idempotency_key', 100).notNullable();
    t.string('method', 10).notNullable();
    t.string('path', 255).notNullable();
    t.specificType('request_hash', 'CHAR(64)').notNullable();
    t.smallint('response_status').unsigned().nullable();
    t.json('response_body').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable();
    t.primary(['employee_id', 'idempotency_key']);
    t.index(['expires_at']);
  });

  await knex.schema.createTable('system_settings', (t) => {
    t.string('setting_key', 80).primary();
    t.json('value').notNullable();
    t.string('description', 500).nullable();
    t.boolean('requires_hr_confirmation').notNullable().defaultTo(false);
    t.integer('updated_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });
}

export async function down(knex) {
  for (const table of [
    'system_settings',
    'idempotency_keys',
    'sessions',
    'audit_log',
    'email_outbox',
    'notifications',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
