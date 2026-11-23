/*
 * "Leave after miscarriage or stillbirth" is renamed Maternal Recovery Leave (D134): a gentler
 * name, with the details kept in its description. Only changed while it still has the original
 * name, so a name HR has chosen on Leave Types is left alone.
 */
const OLD = 'Leave after miscarriage or stillbirth';
const NEW = 'Maternal Recovery Leave';

export async function up(knex) {
  await knex('leave_types')
    .where({ code: 'PREGNANCY_LOSS' })
    .whereRaw('BINARY name = ?', [OLD])
    .update({ name: NEW });
}

export async function down(knex) {
  await knex('leave_types')
    .where({ code: 'PREGNANCY_LOSS' })
    .whereRaw('BINARY name = ?', [NEW])
    .update({ name: OLD });
}
