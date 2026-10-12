import { todayInLusaka } from '../../utils/dates.js';
import { writeAudit } from '../audit/audit.service.js';
import { notify, hrAdministrators } from '../notifications/notify.service.js';

/**
 * Decide whether validated Entra claims may sign in, and record the outcome.
 * Identity is matched only on tenant ID + object ID; email is never used to grant access.
 */
export async function resolveSignIn(db, claims, { tenantId }, requestMeta) {
  const tid = String(claims.tid ?? '').toLowerCase();
  const oid = String(claims.oid ?? '').toLowerCase();
  const email = String(claims.email ?? claims.preferred_username ?? '').toLowerCase() || null;
  const name = claims.name ? String(claims.name).slice(0, 160) : null;

  const base = { actorType: 'SYSTEM', entityType: 'identity', entityId: oid || null, ...requestMeta };

  if (!tid || !oid || tid !== String(tenantId).toLowerCase()) {
    await writeAudit(db, { ...base, action: 'SIGN_IN_REJECTED_TENANT', after: { tid, oid, email } });
    return { status: 'WRONG_TENANT' };
  }

  return db.transaction(async (trx) => {
    const link = await trx('identity_links').where({ tenant_id: tid, object_id: oid }).first();
    if (!link) {
      // HR Administrators hear about a new person once a day at most, however often they retry.
      const recent = await trx('audit_log')
        .where({ action: 'SIGN_IN_NOT_CONFIGURED', entity_type: 'identity', entity_id: oid })
        .andWhere('created_at', '>', trx.raw('NOW() - INTERVAL 1 DAY'))
        .first('id');
      if (!recent) {
        await notify(trx, {
          recipients: await hrAdministrators(trx),
          event: 'ACCESS_NOT_CONFIGURED',
          title: `Sign-in waiting to be linked: ${name ?? email ?? 'unknown person'}`,
          body: 'Someone signed in with Microsoft but is not linked to an employee record yet.',
          link: '/admin/sign-in-requests',
          entityType: 'identity',
          email: {
            subject: 'Sign-in waiting to be linked',
            heading: 'Sign-in waiting to be linked',
            intro:
              'Someone signed in to the leave system with their Microsoft account, but it is not linked to an employee record yet.',
            rows: [
              ['Name', name ?? 'Not given'],
              ['Email', email ?? 'Not given'],
            ],
            action:
              'Link the account to their employee record under Sign-in requests, or ignore it if it is not expected.',
          },
        });
      }
      // Recorded so HR Administrators can link this person from the pending sign-ins list.
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
  // An HR Administrator has every right in the system, including the HR Officer's.
  const roles = assigned.includes('HR_ADMIN') ? [...new Set([...assigned, 'HR_OFFICER'])] : assigned;
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
    isManager: Number(reports.n) > 0,
    isDelegate: Number(covering.n) > 0,
  };
}
