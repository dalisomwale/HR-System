/**
 * Project owner, 10 Nov 2026 (D107): the Requisitions module becomes the whole inventory system,
 * with the inventory's own Users and Roles. A role is a set of access rights (see
 * server/src/modules/requisitions/permissions.js); an inventory user is an employee given one
 * role. Employees without an inventory user row keep the access D105 gives them from their HR
 * roles and departments, so nothing changes for anyone until a role is assigned.
 *
 * The roles are the inventory system's defaults (sql/migrate_schema.sql there).
 */
const ALL = [
  'stock.view',
  'stock.receive',
  'stock.issue',
  'items.manage',
  'requisitions.raise',
  'requisitions.raise_any',
  'requisitions.it_quotes',
  'requisitions.approve',
  'requisitions.accounts',
  'requisitions.accounts_review',
  'requisitions.cfo',
  'requisitions.view_all',
  'categories.manage',
  'transactions.view',
  'reports.view',
  'admin.org',
  'admin.users',
  'admin.roles',
];

const ROLES = [
  ['System Admin', 'Full access, including users, roles and the organisation', true, ALL],
  [
    'Staff',
    'All stock work: receive, issue, requisitions, items and reports',
    false,
    [
      'stock.view',
      'stock.receive',
      'stock.issue',
      'items.manage',
      'categories.manage',
      'requisitions.raise',
      'transactions.view',
      'reports.view',
    ],
  ],
  [
    'Department Manager',
    'Raises requisitions for their department and attaches quotations',
    false,
    ['requisitions.raise', 'stock.view'],
  ],
  [
    'IT Officer',
    'Gets quotations for IT-related requisitions',
    false,
    ['requisitions.it_quotes', 'stock.view'],
  ],
  [
    'Director',
    'Approves or rejects requisitions',
    false,
    ['requisitions.approve', 'requisitions.view_all', 'stock.view', 'reports.view'],
  ],
  ['Accountant', 'Prepares payments and sends the proof of payment', false, ['requisitions.accounts']],
  ['Accounts Manager', 'Checks payments before the CFO', false, ['requisitions.accounts_review']],
  ['Chief Finance Officer', 'Gives final approval for payments', false, ['requisitions.cfo', 'reports.view']],
];

export async function up(knex) {
  await knex.schema.createTable('inventory_roles', (t) => {
    t.increments('id').unsigned().primary();
    t.string('name', 100).notNullable().unique();
    t.string('description', 255).nullable();
    t.boolean('is_system').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('inventory_role_permissions', (t) => {
    t.integer('role_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('inventory_roles')
      .onDelete('CASCADE');
    t.string('permission', 60).notNullable();
    t.primary(['role_id', 'permission']);
  });

  await knex.schema.createTable('inventory_users', (t) => {
    t.integer('employee_id').unsigned().primary().references('id').inTable('employees');
    t.integer('role_id').unsigned().notNullable().references('id').inTable('inventory_roles');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('added_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamps(true, true);
  });

  for (const [name, description, isSystem, perms] of ROLES) {
    const [id] = await knex('inventory_roles').insert({ name, description, is_system: isSystem });
    await knex('inventory_role_permissions').insert(perms.map((permission) => ({ role_id: id, permission })));
  }
}

export async function down(knex) {
  for (const t of ['inventory_users', 'inventory_role_permissions', 'inventory_roles']) {
    await knex.schema.dropTableIfExists(t);
  }
}
