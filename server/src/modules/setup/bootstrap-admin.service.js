import { z } from 'zod';
import { writeAudit } from '../audit/audit.service.js';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    {
      message: 'must be a real calendar date',
    },
  );

export const bootstrapInputSchema = z.object({
  oid: z.string().regex(GUID, 'must be the Entra object ID (a GUID)'),
  email: z.string().email().max(254),
  employeeNumber: z.string().trim().min(1).max(30),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  jobTitle: z.string().trim().max(120).optional(),
  startDate: isoDate,
});

export class BootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootstrapError';
  }
}

/**
 * Create the first HR Administrator: their employee record, Entra identity link and role.
 * Refuses to run once any HR Administrator exists, so it cannot be used to add or take over
 * administrator access later. Everything happens in one transaction with audit entries.
 */
export async function bootstrapAdmin(db, rawInput, { tenantId }) {
  if (!tenantId || !GUID.test(tenantId)) {
    throw new BootstrapError(
      'ENTRA_TENANT_ID must be configured (a GUID) before bootstrapping an administrator',
    );
  }
  const parsed = bootstrapInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new BootstrapError(
      parsed.error.issues.map((i) => `--${toFlag(i.path[0])} ${i.message}`).join('; '),
    );
  }
  const input = parsed.data;
  const oid = input.oid.toLowerCase();
  const tid = tenantId.toLowerCase();

  return db.transaction(async (trx) => {
    // Lock the HR_ADMIN role row so two concurrent bootstrap runs cannot both succeed.
    const role = await trx('roles').where({ code: 'HR_ADMIN' }).forUpdate().first();
    if (!role) throw new BootstrapError('Role HR_ADMIN is missing. Run the database migrations first.');

    const existingAdmins = await trx('employee_roles').where({ role_id: role.id }).count({ n: '*' }).first();
    if (Number(existingAdmins.n) > 0) {
      throw new BootstrapError(
        'An HR Administrator already exists. Further administrators must be granted from within the application.',
      );
    }

    const identityTaken = await trx('identity_links').where({ tenant_id: tid, object_id: oid }).first();
    if (identityTaken)
      throw new BootstrapError('This Entra identity is already linked to an employee record.');

    const numberTaken = await trx('employees').where({ employee_number: input.employeeNumber }).first();
    if (numberTaken) throw new BootstrapError(`Employee number ${input.employeeNumber} already exists.`);

    const emailTaken = await trx('employees').where({ email: input.email.toLowerCase() }).first();
    if (emailTaken) throw new BootstrapError(`An employee with email ${input.email} already exists.`);

    const schedule = await trx('work_schedules').where({ is_company_default: true, is_active: true }).first();

    const [employeeId] = await trx('employees').insert({
      employee_number: input.employeeNumber,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email.toLowerCase(),
      job_title: input.jobTitle ?? null,
      employment_start_date: input.startDate,
      work_schedule_id: schedule ? schedule.id : null,
      status: 'ACTIVE',
    });

    await trx('identity_links').insert({
      employee_id: employeeId,
      tenant_id: tid,
      object_id: oid,
      email_at_link: input.email.toLowerCase(),
      linked_via: 'BOOTSTRAP',
    });

    await trx('employee_roles').insert({ employee_id: employeeId, role_id: role.id });

    await writeAudit(trx, {
      actorType: 'CLI',
      action: 'BOOTSTRAP_ADMIN_CREATED',
      entityType: 'employee',
      entityId: employeeId,
      after: {
        employeeNumber: input.employeeNumber,
        email: input.email.toLowerCase(),
        tenantId: tid,
        objectId: oid,
        roles: ['HR_ADMIN'],
      },
    });

    return { employeeId };
  });
}

function toFlag(key) {
  return String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
