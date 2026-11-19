/**
 * Project owner, 20 Nov 2026 (D126): the AMS cash and float work becomes its own module, the
 * Float system, separate from the Inventory system, with its own Users, Roles and Audit trail
 * (D108). The AMS roles move from the Inventory system with the people who hold them, renamed
 * for the new module; a System Admin role is added; the Inventory system's directors who had
 * the AMS director view get the Float system's Director role. The Inventory system keeps no
 * float rights.
 */
const RENAME = [
  ['AMS Branch Staff', 'Branch Staff'],
  ['AMS Operations Officer', 'Operations Officer'],
  ['AMS Manager', 'Manager'],
  ['AMS HR', 'HR'],
];

export async function up(knex) {
  for (const [from, to] of RENAME) {
    const role = await knex('access_roles').where({ module: 'inventory', name: from }).first('id');
    if (!role) continue;
    await knex('access_roles').where({ id: role.id }).update({ module: 'float', name: to });
    await knex('access_users').where({ module: 'inventory', role_id: role.id }).update({ module: 'float' });
  }
  await knex('access_roles').insert({
    module: 'float',
    name: 'System Admin',
    description: 'Every right in the Float system',
    is_system: true,
  });
  const [director] = await knex('access_roles').insert({
    module: 'float',
    name: 'Director',
    description: 'Sees every AMS branch and the daily reports, approves large write-offs and requisitions',
    is_system: false,
  });
  await knex('access_role_permissions').insert(
    ['float.view_all', 'float.director'].map((permission) => ({ role_id: director, permission })),
  );
  // Inventory directors who had the AMS director view keep it, in the Float system.
  const invDirector = await knex('access_roles').where({ module: 'inventory', name: 'Director' }).first('id');
  if (invDirector) {
    const holders = await knex('access_users')
      .where({ module: 'inventory', role_id: invDirector.id, is_active: true })
      .pluck('employee_id');
    const already = new Set(await knex('access_users').where({ module: 'float' }).pluck('employee_id'));
    const add = holders.filter((id) => !already.has(id));
    if (add.length) {
      await knex('access_users').insert(add.map((employee_id) => ({ module: 'float', employee_id, role_id: director })));
    }
  }
  // The Inventory system keeps no float rights.
  const invRoles = await knex('access_roles').where({ module: 'inventory' }).pluck('id');
  if (invRoles.length) {
    await knex('access_role_permissions').whereIn('role_id', invRoles).where('permission', 'like', 'float.%').del();
  }
}

export async function down(knex) {
  const floatRoles = await knex('access_roles').where({ module: 'float' }).select('id', 'name');
  for (const [from, to] of RENAME) {
    const role = floatRoles.find((r) => r.name === to);
    if (!role) continue;
    await knex('access_roles').where({ id: role.id }).update({ module: 'inventory', name: from });
    await knex('access_users').where({ module: 'float', role_id: role.id }).update({ module: 'inventory' });
  }
  const rest = floatRoles.filter((r) => ['System Admin', 'Director'].includes(r.name)).map((r) => r.id);
  if (rest.length) {
    await knex('access_users').whereIn('role_id', rest).del();
    await knex('access_roles').whereIn('id', rest).del();
  }
  const invDirector = await knex('access_roles').where({ module: 'inventory', name: 'Director' }).first('id');
  if (invDirector) {
    await knex('access_role_permissions').insert(
      ['float.view_all', 'float.director'].map((permission) => ({ role_id: invDirector.id, permission })),
    );
  }
}
