/*
 * Department Managers (D88). Someone with the DEPARTMENT_MANAGER role manages everyone active in
 * their own department, as if they all reported to them: they approve those people's leave at
 * the manager stage and see them on the team pages and in reports. Who reports to whom still
 * applies as well; a request goes to the line manager when there is one, and to the
 * Department Manager when there is not.
 */

const ROLE = 'DEPARTMENT_MANAGER';

/** Active people in the departments this person manages (never themselves). */
export async function managedMembers(db, managerId) {
  const me = await db('employees as e')
    .join('employee_roles as er', 'er.employee_id', 'e.id')
    .join('roles as r', 'r.id', 'er.role_id')
    .where({ 'e.id': managerId, 'e.status': 'ACTIVE', 'r.code': ROLE })
    .first('e.department_id');
  if (!me?.department_id) return [];
  return db('employees')
    .where({ department_id: me.department_id, status: 'ACTIVE' })
    .whereNot({ id: managerId })
    .pluck('id');
}

/** Active Department Managers of an employee's department, other than the employee. */
export async function departmentManagersOf(db, employee) {
  if (!employee?.department_id) return [];
  return db('employees as e')
    .join('employee_roles as er', 'er.employee_id', 'e.id')
    .join('roles as r', 'r.id', 'er.role_id')
    .where({ 'e.department_id': employee.department_id, 'e.status': 'ACTIVE', 'r.code': ROLE })
    .whereNot('e.id', employee.id)
    .orderBy('e.id')
    .pluck('e.id');
}

/** True when the person manages the department of this employee. */
export async function managesEmployee(db, managerId, employeeId) {
  const employee = await db('employees').where({ id: employeeId }).first('id', 'department_id');
  return (await departmentManagersOf(db, employee)).includes(managerId);
}
