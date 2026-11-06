/**
 * Project owner, 6 Nov 2026 (D100): a request can be marked sensitive only on leave types whose
 * rules allow it. A policy rule, so HR can change it from a date like any other. It starts on for
 * the confidential leave types (sick, family responsibility, maternity, pregnancy loss) and off
 * for the rest.
 */
export async function up(knex) {
  await knex.schema.alterTable('leave_policy_versions', (t) => {
    t.boolean('sensitive_allowed').notNullable().defaultTo(false);
  });
  const confidential = await knex('leave_types').where({ is_confidential: true }).pluck('id');
  if (confidential.length) {
    await knex('leave_policy_versions')
      .whereIn('leave_type_id', confidential)
      .update({ sensitive_allowed: true });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('leave_policy_versions', (t) => {
    t.dropColumn('sensitive_allowed');
  });
}
