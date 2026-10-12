/**
 * Altus is a group of companies (project owner, 12 Oct 2026). Each employee works for one company
 * in the group, and each department belongs to one company. Department codes and names are unique
 * within a company rather than across the group, so two companies can each have a "Finance".
 *
 * Existing employees and departments are left without a company; HR assigns them. No company
 * names are invented here.
 */
export async function up(knex) {
  await knex.schema.createTable('companies', (t) => {
    t.increments('id').primary();
    t.string('code', 20).notNullable().unique();
    t.string('name', 160).notNullable().unique();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });

  await knex.schema.alterTable('departments', (t) => {
    t.integer('company_id').unsigned().nullable().references('id').inTable('companies').after('id');
  });
  await knex.schema.alterTable('departments', (t) => {
    t.dropUnique(['code']);
    t.dropUnique(['name']);
    t.unique(['company_id', 'code'], { indexName: 'departments_company_code_unique' });
    t.unique(['company_id', 'name'], { indexName: 'departments_company_name_unique' });
  });

  await knex.schema.alterTable('employees', (t) => {
    t.integer('company_id').unsigned().nullable().references('id').inTable('companies').after('job_title');
    t.index(['company_id', 'status']);
  });

  await knex('roles').where({ code: 'HR_OFFICER' }).update({
    description:
      'Final approval of leave requests, group-wide leave records, reports and balance adjustments.',
  });
}

export async function down(knex) {
  await knex('roles').where({ code: 'HR_OFFICER' }).update({
    description:
      'Final approval of leave requests, company-wide leave records, reports and balance adjustments.',
  });
  await knex.schema.alterTable('employees', (t) => {
    t.dropForeign(['company_id']);
    t.dropIndex(['company_id', 'status']);
    t.dropColumn('company_id');
  });
  // The foreign key goes first: MySQL will not drop an index a foreign key still relies on.
  await knex.schema.alterTable('departments', (t) => {
    t.dropForeign(['company_id']);
  });
  await knex.schema.alterTable('departments', (t) => {
    t.dropUnique([], 'departments_company_code_unique');
    t.dropUnique([], 'departments_company_name_unique');
    t.dropColumn('company_id');
  });
  await knex.schema.alterTable('departments', (t) => {
    t.unique(['code']);
    t.unique(['name']);
  });
  await knex.schema.dropTableIfExists('companies');
}
