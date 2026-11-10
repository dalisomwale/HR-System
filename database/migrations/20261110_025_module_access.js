/**
 * Project owner, 10 Nov 2026 (D108): every module has its own Users, Roles with access levels and
 * Audit trail, in the inventory system's format. One set of tables serves all modules; the
 * inventory's roles and users from migration 024 move into it.
 *
 * Nobody's access changes: today's HR Officers get the "HR Officer" role in Leave management and
 * Employee management, and the directors (Executive, Managing, Accounts) get the "Director" role,
 * with exactly the rights they had. HR Officer stops being a position on the employee record.
 * The System Administrator position keeps every right in every module.
 */
const LEAVE_HR = [
  'leave.approve_final',
  'leave.view_all',
  'leave.confidential',
  'leave.overview',
  'leave.balances',
  'leave.types',
  'leave.calendar',
  'leave.delegations',
];
const ROLES = {
  leave: [
    ['System Admin', 'Every right in Leave management', true, []],
    ['HR Officer', 'Final approval, all requests, balances and leave setup', false, LEAVE_HR],
    [
      'Director',
      'Sees every request (not confidential) and the group overview',
      false,
      ['leave.view_all', 'leave.overview'],
    ],
  ],
  people: [
    ['System Admin', 'Every right in Employee management', true, []],
    [
      'HR Officer',
      'Adds and edits employees, companies and departments',
      false,
      ['people.view', 'people.edit', 'people.org'],
    ],
    ['Director', 'Sees every employee record and the reports', false, ['people.view']],
  ],
};
const DIRECTORS = ['EXECUTIVE_DIRECTOR', 'MANAGING_DIRECTOR', 'ACCOUNTS_DIRECTOR'];

export async function up(knex) {
  await knex.schema.createTable('access_roles', (t) => {
    t.increments('id').unsigned().primary();
    t.string('module', 20).notNullable();
    t.string('name', 100).notNullable();
    t.string('description', 255).nullable();
    t.boolean('is_system').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.unique(['module', 'name']);
  });
  await knex.schema.createTable('access_role_permissions', (t) => {
    t.integer('role_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('access_roles')
      .onDelete('CASCADE');
    t.string('permission', 60).notNullable();
    t.primary(['role_id', 'permission']);
  });
  await knex.schema.createTable('access_users', (t) => {
    t.string('module', 20).notNullable();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    t.integer('role_id').unsigned().notNullable().references('id').inTable('access_roles');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('added_by').unsigned().nullable().references('id').inTable('employees');
    t.timestamps(true, true);
    t.primary(['module', 'employee_id']);
  });

  // The inventory's roles and users (migration 024) move across unchanged.
  const invRoles = await knex('inventory_roles').select();
  const invMap = new Map();
  for (const r of invRoles) {
    const [id] = await knex('access_roles').insert({
      module: 'inventory',
      name: r.name,
      description: r.description,
      is_system: r.is_system,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
    invMap.set(r.id, id);
    const perms = await knex('inventory_role_permissions').where({ role_id: r.id }).pluck('permission');
    if (perms.length) {
      await knex('access_role_permissions').insert(perms.map((permission) => ({ role_id: id, permission })));
    }
  }
  const invUsers = await knex('inventory_users').select();
  if (invUsers.length) {
    await knex('access_users').insert(
      invUsers.map((u) => ({
        module: 'inventory',
        employee_id: u.employee_id,
        role_id: invMap.get(u.role_id),
        is_active: u.is_active,
        added_by: u.added_by,
        created_at: u.created_at,
        updated_at: u.updated_at,
      })),
    );
  }
  await knex.schema.dropTable('inventory_users');
  await knex.schema.dropTable('inventory_role_permissions');
  await knex.schema.dropTable('inventory_roles');

  // Leave management and Employee management roles.
  const roleId = {};
  for (const [module, roles] of Object.entries(ROLES)) {
    for (const [name, description, isSystem, perms] of roles) {
      const [id] = await knex('access_roles').insert({ module, name, description, is_system: isSystem });
      roleId[`${module}:${name}`] = id;
      if (perms.length) {
        await knex('access_role_permissions').insert(
          perms.map((permission) => ({ role_id: id, permission })),
        );
      }
    }
  }

  // Today's HR Officers and directors keep exactly their access.
  const holders = async (codes) =>
    knex('employee_roles as er')
      .join('roles as r', 'r.id', 'er.role_id')
      .whereIn('r.code', codes)
      .distinct()
      .pluck('er.employee_id');
  const officers = await holders(['HR_OFFICER']);
  const directors = (await holders(DIRECTORS)).filter((id) => !officers.includes(id));
  const grant = async (ids, role) => {
    for (const module of ['leave', 'people']) {
      if (ids.length) {
        await knex('access_users').insert(
          ids.map((employee_id) => ({ module, employee_id, role_id: roleId[`${module}:${role}`] })),
        );
      }
    }
  };
  await grant(officers, 'HR Officer');
  await grant(directors, 'Director');
  const officerRole = await knex('roles').where({ code: 'HR_OFFICER' }).first('id');
  if (officerRole) await knex('employee_roles').where({ role_id: officerRole.id }).del();
}

export async function down(knex) {
  // HR Officers become a position again; the inventory's tables come back with their rows.
  const officerRole = await knex('roles').where({ code: 'HR_OFFICER' }).first('id');
  if (officerRole) {
    const ids = await knex('access_users as u')
      .join('access_roles as r', 'r.id', 'u.role_id')
      .where({ 'u.module': 'leave', 'r.name': 'HR Officer' })
      .pluck('u.employee_id');
    if (ids.length) {
      await knex('employee_roles').insert(
        ids.map((employee_id) => ({ employee_id, role_id: officerRole.id })),
      );
    }
  }
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
  const map = new Map();
  for (const r of await knex('access_roles').where({ module: 'inventory' })) {
    const [id] = await knex('inventory_roles').insert({
      name: r.name,
      description: r.description,
      is_system: r.is_system,
    });
    map.set(r.id, id);
    const perms = await knex('access_role_permissions').where({ role_id: r.id }).pluck('permission');
    if (perms.length) {
      await knex('inventory_role_permissions').insert(
        perms.map((permission) => ({ role_id: id, permission })),
      );
    }
  }
  for (const u of await knex('access_users').where({ module: 'inventory' })) {
    await knex('inventory_users').insert({
      employee_id: u.employee_id,
      role_id: map.get(u.role_id),
      is_active: u.is_active,
      added_by: u.added_by,
    });
  }
  await knex.schema.dropTable('access_users');
  await knex.schema.dropTable('access_role_permissions');
  await knex.schema.dropTable('access_roles');
}
