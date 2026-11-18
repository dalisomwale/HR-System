/**
 * Project owner, 19 Nov 2026 (D120): AMS branches work different days and hours, so each has its
 * own trading days, opening and closing times and evening start. The sign-out reminder goes at
 * the branch's closing time on its trading days; the daily report counts evening transactions
 * from the branch's own evening start. AMS settings keep the defaults for new branches.
 * Existing AMS branches start with the AMS settings as they are now.
 */
export async function up(knex) {
  await knex.schema.createTable('float_branch_hours', (t) => {
    t.integer('branch_id').unsigned().primary().references('id').inTable('stock_branches');
    t.string('working_days', 40).notNullable();
    t.string('opens_at', 5).notNullable();
    t.string('closes_at', 5).notNullable();
    t.string('evening_from', 5).notNullable();
    t.integer('updated_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  const s = await knex('float_settings').where({ id: 1 }).first();
  if (s?.company_id) {
    const branches = await knex('stock_branches').where({ company_id: s.company_id }).pluck('id');
    if (branches.length) {
      await knex('float_branch_hours').insert(
        branches.map((branch_id) => ({
          branch_id,
          working_days: s.working_days,
          opens_at: s.day_start,
          closes_at: s.close_reminder_time,
          evening_from: s.evening_from,
        })),
      );
    }
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('float_branch_hours');
}
