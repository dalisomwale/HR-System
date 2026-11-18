/**
 * Project owner, 20 Nov 2026 (D121): AMS store opening and closing, the Operations Officer
 * (supervisor), and AMS requisitions.
 *
 *   - Opening the store is recorded like a count (kind OPEN): when, who, and the balances it
 *     opened with. Nothing is recorded before the store opens or after it closes.
 *   - The Operations Officer oversees every branch: branch staff report to them; they approve
 *     float movements, reversals and cash to finance, handle shortages, reconcile and sign off
 *     the daily report, and pass requisitions up to the manager. Right: float.supervise.
 *   - AMS requisitions: a dead or faulty device, or cash or float run out. Raised by branch
 *     staff with the reason; approved by the supervisor, then the manager, then a director.
 *     Approved cash or float is added when the branch confirms it has arrived.
 */
export async function up(knex) {
  await knex.raw("ALTER TABLE float_counts MODIFY kind ENUM('OPEN','CLOSE','HANDOVER') NOT NULL");

  await knex.schema.createTable('float_requisitions', (t) => {
    t.increments('id').unsigned().primary();
    t.string('reference', 20).nullable().unique();
    t.integer('branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.enu('kind', ['DEVICE', 'CASH', 'FLOAT']).notNullable();
    t.enu('account', ['CASH', 'AIRTEL', 'MTN']).nullable();
    t.decimal('amount', 14, 2).nullable();
    t.string('device', 200).nullable();
    t.text('reason').notNullable();
    t.enu('status', [
      'PENDING_SUPERVISOR',
      'PENDING_MANAGER',
      'PENDING_DIRECTOR',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
      'RECEIVED',
      'DONE',
    ])
      .notNullable()
      .defaultTo('PENDING_SUPERVISOR');
    const emp = (name) => t.integer(name).unsigned().nullable().references('id').inTable('employees');
    t.integer('raised_by').unsigned().notNullable().references('id').inTable('employees');
    t.timestamp('raised_at').notNullable().defaultTo(knex.fn.now());
    emp('supervisor_by');
    t.datetime('supervisor_at').nullable();
    t.string('supervisor_comment', 1000).nullable();
    emp('manager_by');
    t.datetime('manager_at').nullable();
    t.string('manager_comment', 1000).nullable();
    emp('director_by');
    t.datetime('director_at').nullable();
    t.string('director_comment', 1000).nullable();
    emp('closed_by');
    t.datetime('closed_at').nullable();
    t.decimal('received_amount', 14, 2).nullable();
    t.integer('movement_id').unsigned().nullable().references('id').inTable('float_movements');
    t.index(['status']);
  });

  // The Operations Officer role; the AMS Manager can also act as supervisor.
  const [id] = await knex('access_roles').insert({
    module: 'inventory',
    name: 'AMS Operations Officer',
    description:
      'Supervises every AMS branch: float, staff, cash reconciliation, shortages and the daily report; passes requisitions to the manager',
    is_system: false,
  });
  await knex('access_role_permissions').insert(
    ['float.view_all', 'float.supervise'].map((permission) => ({ role_id: id, permission })),
  );
  const manager = await knex('access_roles').where({ module: 'inventory', name: 'AMS Manager' }).first('id');
  if (manager) await knex('access_role_permissions').insert({ role_id: manager.id, permission: 'float.supervise' });
}

export async function down(knex) {
  const role = await knex('access_roles').where({ module: 'inventory', name: 'AMS Operations Officer' }).first('id');
  if (role) {
    await knex('access_users').where({ role_id: role.id }).del();
    await knex('access_roles').where({ id: role.id }).del();
  }
  await knex('access_role_permissions').where({ permission: 'float.supervise' }).del();
  await knex.schema.dropTableIfExists('float_requisitions');
  await knex('float_counts').where({ kind: 'OPEN' }).del();
  await knex.raw("ALTER TABLE float_counts MODIFY kind ENUM('CLOSE','HANDOVER') NOT NULL");
}
