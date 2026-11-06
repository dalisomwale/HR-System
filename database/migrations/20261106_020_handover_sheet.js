/**
 * Project owner, 6 Nov 2026 (D98): a request can carry a handover sheet, the Excel handover
 * template filled in by the employee. It is stored as a document of kind HANDOVER, apart from
 * supporting documents.
 */
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function up(knex) {
  await knex.schema.alterTable('documents', (t) => {
    t.string('kind', 16).notNullable().defaultTo('SUPPORTING');
  });
  await knex.raw(
    `ALTER TABLE documents MODIFY mime_type ENUM('application/pdf','image/jpeg','image/png','${XLSX}') NOT NULL`,
  );
}

export async function down(knex) {
  await knex('documents').where({ mime_type: XLSX }).del();
  await knex.raw(
    "ALTER TABLE documents MODIFY mime_type ENUM('application/pdf','image/jpeg','image/png') NOT NULL",
  );
  await knex.schema.alterTable('documents', (t) => {
    t.dropColumn('kind');
  });
}
