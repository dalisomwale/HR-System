import { MODULE_KEYS, allPermissions } from '../access/modules.js';
import { todayInLusaka } from '../../utils/dates.js';
import { writeAudit } from '../audit/audit.service.js';
import { managedMembers } from '../org/department-manager.js';

/**
 * Decide whether validated Entra claims may sign in, and record the outcome.
 * Identity is matched on tenant ID + object ID. On the first sign-in from the Altus tenant, an
 * account with no link is linked to the one employee whose work email matches its email (D73).
 */
export async function resolveSignIn(db, claims, { tenantId }, requestMeta) {
  const tid = String(claims.tid ?? '').toLowerCase();
  const oid = String(claims.oid ?? '').toLowerCase();
  const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase() || null;
  // Both addresses Entra gives for this account; either may match the work email on the record.
  const addresses = [
    ...new Set(
      [claims.email, claims.preferred_username].filter(Boolean).map((a) => String(a).trim().toLowerCase()),
    ),
  ].filter((a) => a.includes('@'));
  const name = claims.name ? String(claims.name).slice(0, 160) : null;

  const base = { actorType: 'SYSTEM', entityType: 'identity', entityId: oid || null, ...requestMeta };

  if (!tid || !oid || tid !== String(tenantId).toLowerCase()) {
    await writeAudit(db, { ...base, action: 'SIGN_IN_REJECTED_TENANT', after: { tid, oid, email } });
    return { status: 'WRONG_TENANT' };
  }

  return db.transaction(async (trx) => {
    let link = await trx('identity_links').where({ tenant_id: tid, object_id: oid }).first();
    if (!link && addresses.length) {
      // Exactly one employee with that work email, and not already linked to another account.
      const matches = await trx('employees as e')
        .leftJoin('identity_links as l', 'l.employee_id', 'e.id')
        .whereIn(trx.raw('LOWER(e.email)'), addresses)
        .whereNull('l.id')
        .forUpdate()
        .select('e.id', 'e.email');
      if (matches.length === 1) {
        await trx('identity_links').insert({
          employee_id: matches[0].id,
          tenant_id: tid,
          object_id: oid,
          email_at_link: matches[0].email,
          linked_via: 'EMAIL',
        });
        await writeAudit(trx, {
          ...base,
          action: 'IDENTITY_LINKED',
          entityType: 'employee',
          entityId: matches[0].id,
          after: { objectId: oid, email: matches[0].email, via: 'work email matched at sign-in' },
        });
        link = await trx('identity_links').where({ tenant_id: tid, object_id: oid }).first();
      }
    }
    if (!link) {
      // Kept in the audit log only: there is no request to approve (D75).
      await writeAudit(trx, {
        ...base,
        action: 'SIGN_IN_NOT_CONFIGURED',
        after: { tid, oid, email, name },
      });
      return { status: 'NOT_CONFIGURED' };
    }

    const employee = await trx('employees').where({ id: link.employee_id }).first();
    if (!employee || employee.status !== 'ACTIVE') {
      await writeAudit(trx, {
        ...base,
        actorEmployeeId: link.employee_id,
        action: 'SIGN_IN_REJECTED_INACTIVE',
        entityType: 'employee',
        entityId: link.employee_id,
      });
      return { status: 'INACTIVE' };
    }

    await trx('identity_links').where({ id: link.id }).update({ last_sign_in_at: trx.fn.now() });
    await writeAudit(trx, {
      ...base,
      actorType: 'USER',
      actorEmployeeId: employee.id,
      action: 'SIGN_IN',
      entityType: 'employee',
      entityId: employee.id,
    });
    return { status: 'OK', employeeId: employee.id };
  });
}

/**
 * The person's rights in every module (D108): from their role in each module, or every right when
 * they hold the System Administrator position. `accessRoles` names their role per module.
 */
export async function loadAccess(db, employeeId, isAdmin) {
  const rows = await db('access_users as u')
    .join('access_roles as r', 'r.id', 'u.role_id')
    .where({ 'u.employee_id': employeeId, 'u.is_active': true })
    .select('u.module', 'r.id', 'r.name', 'r.is_system');
  const accessRoles = Object.fromEntries(rows.map((r) => [r.module, r.name]));
  const perms = new Set();
  const granted = rows.length
    ? await db('access_role_permissions')
        .whereIn(
          'role_id',
          rows.map((r) => r.id),
        )
        .select('role_id', 'permission')
    : [];
  for (const r of rows) {
    if (r.is_system) allPermissions(r.module).forEach((p) => perms.add(p));
  }
  for (const g of granted) perms.add(g.permission);
  if (isAdmin) {
    for (const m of MODULE_KEYS) allPermissions(m).forEach((p) => perms.add(p));
  }
  return { perms: [...perms], accessRoles };
}

/** Current user: employee summary, roles and whether they manage anyone. Null if not active. */
export async function loadUser(db, employeeId) {
  const employee = await db('employees as e')
    .leftJoin('companies as c', 'c.id', 'e.company_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .where('e.id', employeeId)
    .first(
      'e.id',
      'e.employee_number',
      'e.first_name',
      'e.last_name',
      'e.email',
      'e.job_title',
      'e.status',
      'd.name as department_name',
      'c.name as company_name',
    );
  if (!employee || employee.status !== 'ACTIVE') return null;

  const assigned = await db('employee_roles as er')
    .join('roles as r', 'r.id', 'er.role_id')
    .where('er.employee_id', employeeId)
    .pluck('r.code');
  const roles = assigned;
  const { perms, accessRoles } = await loadAccess(db, employeeId, roles.includes('HR_ADMIN'));
  const reports = await db('employees')
    .where({ line_manager_id: employeeId, status: 'ACTIVE' })
    .count({ n: '*' })
    .first();
  const today = todayInLusaka();
  const covering = await db('delegations')
    .where({ delegate_id: employeeId })
    .whereNull('revoked_at')
    .andWhere('start_date', '<=', today)
    .andWhere('end_date', '>=', today)
    .count({ n: '*' })
    .first();

  return {
    id: employee.id,
    employeeNumber: employee.employee_number,
    firstName: employee.first_name,
    lastName: employee.last_name,
    email: employee.email,
    jobTitle: employee.job_title,
    company: employee.company_name,
    department: employee.department_name,
    roles,
    perms,
    accessRoles,
    isManager: Number(reports.n) > 0 || (await managedMembers(db, employee.id)).length > 0,
    isDelegate: Number(covering.n) > 0,
  };
}
