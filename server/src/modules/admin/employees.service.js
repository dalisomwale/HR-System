import { z } from 'zod';
import { writeAudit } from '../audit/audit.service.js';
import { revokeEmployeeSessions } from '../auth/session-store.js';
import { conflict, notFound, badRequest } from '../../utils/errors.js';
import { GUID_RE, isoDate, optionalId, optionalText, requiredText } from '../../utils/validation.js';

export const ASSIGNABLE_ROLES = ['HR_OFFICER', 'HR_ADMIN', 'EXECUTIVE_DIRECTOR', 'MANAGING_DIRECTOR'];

const baseFields = {
  employeeNumber: requiredText(30),
  firstName: requiredText(80),
  lastName: requiredText(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('must be a valid email address')
    .max(254)
    .nullish()
    .or(z.literal('').transform(() => null))
    .transform((v) => v || null),
  jobTitle: optionalText(120),
  // Used only for maternity, paternity and Mother's Day eligibility (decision D20).
  sex: z
    .enum(['FEMALE', 'MALE'])
    .nullish()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  companyId: optionalId,
  departmentId: optionalId,
  lineManagerId: optionalId,
  workScheduleId: optionalId,
  employmentStartDate: isoDate,
  employmentEndDate: isoDate.nullish().or(z.literal('').transform(() => null)),
};

export const createEmployeeSchema = z
  .object(baseFields)
  .refine((v) => !v.employmentEndDate || v.employmentEndDate >= v.employmentStartDate, {
    message: 'must be on or after the start date',
    path: ['employmentEndDate'],
  });
export const updateEmployeeSchema = z.object(baseFields).partial();

const COLUMN = {
  employeeNumber: 'employee_number',
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  jobTitle: 'job_title',
  sex: 'sex',
  companyId: 'company_id',
  departmentId: 'department_id',
  lineManagerId: 'line_manager_id',
  workScheduleId: 'work_schedule_id',
  employmentStartDate: 'employment_start_date',
  employmentEndDate: 'employment_end_date',
};

function toRow(input) {
  const row = {};
  for (const [k, col] of Object.entries(COLUMN)) if (input[k] !== undefined) row[col] = input[k];
  return row;
}

export function mapEmployeeUniqueError(err) {
  if (err?.code !== 'ER_DUP_ENTRY') return err;
  if (/email/.test(err.sqlMessage)) return conflict('Another employee already uses this email address.');
  if (/employee_number/.test(err.sqlMessage)) return conflict('This employee number is already in use.');
  return conflict('This record conflicts with an existing one.');
}

/**
 * The employee's company. A department belongs to one company, so choosing a department sets the
 * company; choosing a company that the current department is not in is refused.
 */
async function resolveCompany(trx, input, before = null) {
  const departmentId =
    input.departmentId !== undefined ? input.departmentId : (before?.department_id ?? null);
  const dept = departmentId
    ? await trx('departments as d')
        .leftJoin('companies as c', 'c.id', 'd.company_id')
        .where('d.id', departmentId)
        .first('d.company_id', 'c.name as company_name')
    : null;
  if (input.companyId !== undefined && input.companyId !== null) {
    const c = await trx('companies').where({ id: input.companyId }).first('is_active', 'name');
    if (!c) throw badRequest('Company not found.');
    if (!c.is_active && input.companyId !== before?.company_id) throw badRequest('That company is inactive.');
    if (dept?.company_id && dept.company_id !== input.companyId) {
      throw badRequest(`That department belongs to ${dept.company_name}, not ${c.name}.`);
    }
    return input.companyId;
  }
  if (input.departmentId !== undefined && dept?.company_id) return dept.company_id;
  return input.companyId === null ? null : undefined;
}

/** Check department, schedule and manager, including reporting loops. */
export async function validateRelations(trx, { departmentId, lineManagerId, workScheduleId }, selfId = null) {
  if (departmentId) {
    const d = await trx('departments').where({ id: departmentId }).first('is_active');
    if (!d) throw badRequest('Department not found.');
    if (!d.is_active) throw badRequest('That department is inactive.');
  }
  if (workScheduleId) {
    const s = await trx('work_schedules').where({ id: workScheduleId }).first('is_active');
    if (!s || !s.is_active) throw badRequest('Working schedule not found or inactive.');
  }
  if (lineManagerId) {
    if (selfId && lineManagerId === selfId) throw badRequest('An employee cannot be their own manager.');
    const m = await trx('employees').where({ id: lineManagerId }).first('status');
    if (!m) throw badRequest('Manager not found.');
    if (m.status !== 'ACTIVE') throw badRequest('The manager must be an active employee.');
    if (selfId) {
      // Walk up from the proposed manager; reaching this employee means a loop.
      let current = lineManagerId;
      const seen = new Set();
      while (current && !seen.has(current)) {
        if (current === selfId) {
          throw badRequest(
            'That would create a reporting loop (this employee manages the proposed manager).',
          );
        }
        seen.add(current);
        const row = await trx('employees').where({ id: current }).first('line_manager_id');
        current = row?.line_manager_id ?? null;
      }
    }
  }
}

async function activeAdminCount(trx, excludingEmployeeId = null) {
  const q = trx('employee_roles as er')
    .join('roles as r', 'r.id', 'er.role_id')
    .join('employees as e', 'e.id', 'er.employee_id')
    .where({ 'r.code': 'HR_ADMIN', 'e.status': 'ACTIVE' });
  if (excludingEmployeeId) q.whereNot('e.id', excludingEmployeeId);
  const { n } = await q.count({ n: '*' }).first();
  return Number(n);
}

async function defaultScheduleId(trx) {
  const s = await trx('work_schedules').where({ is_company_default: true, is_active: true }).first('id');
  return s?.id ?? null;
}

export async function createEmployee(trx, input, audit) {
  await validateRelations(trx, input);
  const row = toRow(input);
  const companyId = await resolveCompany(trx, input);
  if (companyId !== undefined) row.company_id = companyId;
  if (!row.work_schedule_id) row.work_schedule_id = await defaultScheduleId(trx);
  const [id] = await trx('employees').insert({ ...row, status: 'ACTIVE' });
  await writeAudit(trx, {
    ...audit,
    action: 'EMPLOYEE_CREATED',
    entityType: 'employee',
    entityId: id,
    after: input,
  });
  return id;
}

export async function updateEmployee(trx, id, input, audit) {
  const before = await trx('employees').where({ id }).forUpdate().first();
  if (!before) throw notFound('Employee not found.');
  await validateRelations(trx, input, id);
  const start = input.employmentStartDate ?? before.employment_start_date;
  const end = input.employmentEndDate !== undefined ? input.employmentEndDate : before.employment_end_date;
  if (end && end < start) throw badRequest('The end date must be on or after the start date.');
  const row = toRow(input);
  const companyId = await resolveCompany(trx, input, before);
  if (companyId !== undefined) row.company_id = companyId;
  if (Object.keys(row).length === 0) return;
  await trx('employees').where({ id }).update(row);
  const beforeView = {};
  for (const [k, col] of Object.entries(COLUMN)) if (input[k] !== undefined) beforeView[k] = before[col];
  if (row.company_id !== undefined && row.company_id !== before.company_id) {
    beforeView.companyId = before.company_id;
    input = { ...input, companyId: row.company_id };
  }
  await writeAudit(trx, {
    ...audit,
    action: 'EMPLOYEE_UPDATED',
    entityType: 'employee',
    entityId: id,
    before: beforeView,
    after: input,
  });
}

export async function deactivateEmployee(trx, id, { reason, endDate }, audit) {
  const emp = await trx('employees').where({ id }).forUpdate().first();
  if (!emp) throw notFound('Employee not found.');
  if (emp.status === 'INACTIVE') throw conflict('This employee is already inactive.');
  if (audit.actorEmployeeId === id) throw conflict('You cannot deactivate your own record.');
  const reports = await trx('employees')
    .where({ line_manager_id: id, status: 'ACTIVE' })
    .count({ n: '*' })
    .first();
  if (Number(reports.n) > 0) {
    throw conflict(`Assign a new manager to this employee's ${reports.n} direct report(s) first.`);
  }
  const roles = await trx('employee_roles as er')
    .join('roles as r', 'r.id', 'er.role_id')
    .where('er.employee_id', id)
    .pluck('r.code');
  if (roles.includes('HR_ADMIN') && (await activeAdminCount(trx, id)) === 0) {
    throw conflict('This is the only active System Administrator. Grant the role to someone else first.');
  }
  await trx('employees')
    .where({ id })
    .update({
      status: 'INACTIVE',
      deactivated_at: trx.fn.now(),
      employment_end_date: endDate ?? emp.employment_end_date,
    });
  const revoked = await revokeEmployeeSessions(trx, id);
  await writeAudit(trx, {
    ...audit,
    action: 'EMPLOYEE_DEACTIVATED',
    entityType: 'employee',
    entityId: id,
    after: { reason: reason ?? null, endDate: endDate ?? null, sessionsRevoked: revoked },
  });
}

export async function reactivateEmployee(trx, id, audit) {
  const emp = await trx('employees').where({ id }).forUpdate().first();
  if (!emp) throw notFound('Employee not found.');
  if (emp.status === 'ACTIVE') throw conflict('This employee is already active.');
  await trx('employees').where({ id }).update({ status: 'ACTIVE', deactivated_at: null });
  await writeAudit(trx, { ...audit, action: 'EMPLOYEE_REACTIVATED', entityType: 'employee', entityId: id });
}

export const linkIdentitySchema = z.object({
  objectId: z.string().trim().regex(GUID_RE, 'must be the Microsoft Entra object ID (a GUID)').toLowerCase(),
  email: z.string().trim().toLowerCase().email().max(254).nullish(),
});

export async function linkIdentity(trx, id, input, tenantId, audit) {
  if (!tenantId) throw conflict('Microsoft sign-in is not configured on this server (ENTRA_TENANT_ID).');
  const emp = await trx('employees').where({ id }).forUpdate().first();
  if (!emp) throw notFound('Employee not found.');
  const existing = await trx('identity_links').where({ employee_id: id }).first();
  if (existing) throw conflict('This employee is already linked to a Microsoft account. Unlink it first.');
  const taken = await trx('identity_links as l')
    .join('employees as e', 'e.id', 'l.employee_id')
    .where({ 'l.tenant_id': tenantId.toLowerCase(), 'l.object_id': input.objectId })
    .first('e.first_name', 'e.last_name', 'e.employee_number');
  if (taken) {
    throw conflict(
      `That Microsoft account is already linked to ${taken.first_name} ${taken.last_name} (${taken.employee_number}).`,
    );
  }
  await trx('identity_links').insert({
    employee_id: id,
    tenant_id: tenantId.toLowerCase(),
    object_id: input.objectId,
    email_at_link: input.email ?? emp.email,
    linked_by: audit.actorEmployeeId,
    linked_via: 'ADMIN',
  });
  await writeAudit(trx, {
    ...audit,
    action: 'IDENTITY_LINKED',
    entityType: 'employee',
    entityId: id,
    after: { objectId: input.objectId, email: input.email ?? null },
  });
}

export async function unlinkIdentity(trx, id, audit) {
  if (audit.actorEmployeeId === id) throw conflict('You cannot unlink your own Microsoft account.');
  const link = await trx('identity_links').where({ employee_id: id }).first();
  if (!link) throw notFound('This employee has no linked Microsoft account.');
  await trx('identity_links').where({ id: link.id }).del();
  const revoked = await revokeEmployeeSessions(trx, id);
  await writeAudit(trx, {
    ...audit,
    action: 'IDENTITY_UNLINKED',
    entityType: 'employee',
    entityId: id,
    before: { objectId: link.object_id, email: link.email_at_link },
    after: { sessionsRevoked: revoked },
  });
}

export const setRolesSchema = z.object({
  roles: z
    .array(z.enum(ASSIGNABLE_ROLES))
    .max(ASSIGNABLE_ROLES.length)
    .transform((r) => [...new Set(r)]),
});

export async function setRoles(trx, id, roles, audit) {
  const emp = await trx('employees').where({ id }).forUpdate().first();
  if (!emp) throw notFound('Employee not found.');
  if (emp.status !== 'ACTIVE' && roles.length) throw conflict('Roles can only be given to active employees.');
  const current = await trx('employee_roles as er')
    .join('roles as r', 'r.id', 'er.role_id')
    .where('er.employee_id', id)
    .pluck('r.code');
  if (
    current.includes('HR_ADMIN') &&
    !roles.includes('HR_ADMIN') &&
    (await activeAdminCount(trx, id)) === 0
  ) {
    throw conflict('This is the only active System Administrator. Grant the role to someone else first.');
  }
  const roleRows = await trx('roles').whereIn('code', ASSIGNABLE_ROLES).select('id', 'code');
  const idOf = Object.fromEntries(roleRows.map((r) => [r.code, r.id]));
  const toAdd = roles.filter((r) => !current.includes(r));
  const toRemove = current.filter((r) => !roles.includes(r));
  if (toRemove.length) {
    await trx('employee_roles')
      .where({ employee_id: id })
      .whereIn(
        'role_id',
        toRemove.map((c) => idOf[c]),
      )
      .del();
  }
  for (const code of toAdd) {
    await trx('employee_roles').insert({
      employee_id: id,
      role_id: idOf[code],
      granted_by: audit.actorEmployeeId,
    });
  }
  if (toAdd.length || toRemove.length) {
    await writeAudit(trx, {
      ...audit,
      action: 'ROLES_CHANGED',
      entityType: 'employee',
      entityId: id,
      before: { roles: current },
      after: { roles, added: toAdd, removed: toRemove },
    });
  }
}

/** Microsoft accounts that tried to sign in but are not linked to any employee (last 30 days). */
export async function pendingSignIns(db, tenantId) {
  if (!tenantId) return [];
  const rows = await db('audit_log')
    .where({ action: 'SIGN_IN_NOT_CONFIGURED' })
    .andWhere('created_at', '>=', db.raw('UTC_TIMESTAMP() - INTERVAL 30 DAY'))
    .orderBy('created_at', 'desc')
    .limit(500)
    .select('after_data', 'created_at');
  const linked = new Set(
    await db('identity_links').where({ tenant_id: tenantId.toLowerCase() }).pluck('object_id'),
  );
  const byOid = new Map();
  for (const r of rows) {
    const d = typeof r.after_data === 'string' ? JSON.parse(r.after_data) : r.after_data;
    if (!d?.oid || linked.has(d.oid)) continue;
    const entry = byOid.get(d.oid);
    if (entry) entry.attempts += 1;
    else
      byOid.set(d.oid, {
        objectId: d.oid,
        email: d.email,
        name: d.name,
        lastAttemptAt: r.created_at,
        attempts: 1,
      });
  }
  return [...byOid.values()];
}
