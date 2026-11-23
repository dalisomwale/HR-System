/*
 * Leave without pay is no longer offered (D136). It is switched off, not deleted: past and
 * pending requests and the leave history keep pointing at it, but it no longer appears on
 * balances or in the leave form. HR can see it, as inactive, on Leave Types.
 */
export async function up(knex) {
  await knex('leave_types').where({ code: 'UNPAID' }).update({ is_active: false });
}

export async function down(knex) {
  await knex('leave_types').where({ code: 'UNPAID' }).update({ is_active: true });
}
