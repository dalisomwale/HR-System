/**
 * Project owner, 20 Nov 2026 (D124): branch staff open and close the store and enter the cash and
 * float; the Operations Officer confirms (or corrects) the figures. The branch trades once its
 * opening is confirmed; at closing, recording stops at once, and the differences and the daily
 * report follow the Operations Officer's confirmation. Counts made by someone who can confirm
 * (Operations Officer, manager, System Admin) are confirmed at once. Handovers are not confirmed.
 */
export async function up(knex) {
  await knex.schema.alterTable('float_counts', (t) => {
    t.enu('status', ['PENDING', 'CONFIRMED']).notNullable().defaultTo('CONFIRMED');
    t.json('submitted').nullable(); // the figures entered: [{ kind, counted }]
    t.integer('confirmed_by').unsigned().nullable().references('id').inTable('employees');
    t.datetime('confirmed_at').nullable();
    t.string('confirm_comment', 1000).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('float_counts', (t) => {
    t.dropForeign(['confirmed_by']);
    t.dropColumn('confirm_comment');
    t.dropColumn('confirmed_at');
    t.dropColumn('confirmed_by');
    t.dropColumn('submitted');
    t.dropColumn('status');
  });
}
