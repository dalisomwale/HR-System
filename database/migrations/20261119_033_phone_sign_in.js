/**
 * Project owner, 19 Nov 2026 (D119): a phone number on every employee record, kept by HR, and
 * phone sign-in for AMS branch staff.
 *
 *   employees.phone_e164   the mobile number in one standard form (+260…), unique, so a number
 *                          belongs to one employee; filled from the numbers already recorded
 *   phone_logins           AMS branch staff who sign in with their phone number and a 6-digit
 *                          PIN: a one-time code from the System Admin first, then their own PIN;
 *                          locked after 5 wrong tries until an admin gives a new code
 */
function normalisePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || !/^\+?[0-9 ()-]+$/.test(s)) return null;
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 9 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.length === 10 && digits.startsWith('0')) digits = `260${digits.slice(1)}`;
  else if (digits.length === 9) digits = `260${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
}

export async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.string('phone_e164', 16).nullable().unique().after('mobile_phone');
  });
  const seen = new Set();
  for (const e of await knex('employees')
    .whereNotNull('mobile_phone')
    .orderBy('id')
    .select('id', 'mobile_phone')) {
    const p = normalisePhone(e.mobile_phone);
    if (p && !seen.has(p)) {
      seen.add(p);
      await knex('employees').where({ id: e.id }).update({ phone_e164: p });
    }
  }
  await knex.schema.createTable('phone_logins', (t) => {
    t.integer('employee_id').unsigned().primary().references('id').inTable('employees');
    t.string('pin_hash', 200).nullable();
    t.string('code_hash', 200).nullable();
    t.datetime('code_expires_at').nullable();
    t.integer('failed_attempts').unsigned().notNullable().defaultTo(0);
    t.datetime('locked_at').nullable();
    t.datetime('last_sign_in_at').nullable();
    t.integer('updated_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamps(true, true);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('phone_logins');
  await knex.schema.alterTable('employees', (t) => {
    t.dropUnique(['phone_e164']);
    t.dropColumn('phone_e164');
  });
}
