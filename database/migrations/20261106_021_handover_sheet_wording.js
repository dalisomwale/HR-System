/**
 * Project owner, 6 Nov 2026 (D99): the handover is only the Excel handover sheet, so the annual
 * leave description no longer mentions handover notes. Only the original wording is changed;
 * a description HR has since edited is left alone.
 */
const OLD = '25 working days per leave year. Handover notes required. Apply at least two weeks ahead.';
const NEW = '25 working days per leave year. Handover sheet required. Apply at least two weeks ahead.';

export async function up(knex) {
  await knex('leave_types').where({ description: OLD }).update({ description: NEW });
}

export async function down(knex) {
  await knex('leave_types').where({ description: NEW }).update({ description: OLD });
}
