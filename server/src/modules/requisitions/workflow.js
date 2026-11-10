import { conflict } from '../../utils/errors.js';
import { notify } from '../notifications/notify.service.js';

/*
 * The requisition workflow, as in the inventory system (D105):
 *
 *   Department raises it
 *     -> IT-related: IT attaches quotations          (QUOTES_IT)
 *        otherwise:  the department attaches them    (QUOTES_DEPT)
 *   -> Director approves (picks a quotation) or rejects back to the department (DIRECTOR / RETURNED)
 *   -> Accounts -> Accounts Manager -> CFO              (a rejection goes back one step)
 *   -> Accounts attaches the proof of payment          (PAY -> PAID)
 *   -> Stores receive it into stock                    (RECEIVED)
 */

export const STAGES = {
  QUOTES_IT: { label: 'Waiting for IT quotations', who: 'IT' },
  QUOTES_DEPT: { label: 'Waiting for quotations', who: 'Department' },
  RETURNED: { label: 'Returned to department', who: 'Department' },
  DIRECTOR: { label: 'Waiting for Director approval', who: 'Director' },
  ACCOUNTS: { label: 'With Accounts', who: 'Accounts' },
  ACCOUNTS_MANAGER: { label: 'With Accounts Manager', who: 'Accounts Manager' },
  CFO: { label: 'With CFO for final approval', who: 'CFO' },
  PAY: { label: 'Approved, waiting for payment', who: 'Accounts' },
  PAID: { label: 'Paid, waiting for delivery', who: 'Stores' },
  RECEIVED: { label: 'Received', who: '' },
  CANCELLED: { label: 'Cancelled', who: '' },
};
export const OPEN = [
  'QUOTES_IT',
  'QUOTES_DEPT',
  'RETURNED',
  'DIRECTOR',
  'ACCOUNTS',
  'ACCOUNTS_MANAGER',
  'CFO',
  'PAY',
  'PAID',
];
export const ORDER = [...OPEN, 'RECEIVED', 'CANCELLED'];

export const ACTIONS = {
  RAISED: 'Raised the requisition',
  DOCS_ADDED: 'Attached supporting documents',
  QUOTE_ADDED: 'Attached a quotation',
  QUOTE_REMOVED: 'Removed a quotation',
  TO_DIRECTOR: 'Sent to the Director',
  RESUBMITTED: 'Resubmitted to the Director',
  BACK_TO_IT: 'Asked IT for new quotations',
  APPROVED: 'Approved',
  REJECTED: 'Rejected and returned to the department',
  TO_AM: 'Sent to the Accounts Manager',
  AM_APPROVED: 'Approved and sent to the CFO',
  AM_REJECTED: 'Sent back to Accounts',
  CFO_APPROVED: 'Gave final approval',
  CFO_REJECTED: 'Sent back to the Accounts Manager',
  POP_SENT: 'Attached the proof of payment',
  RECEIVED: 'Received into stock',
  CANCELLED: 'Cancelled',
};

export const ref = (id) => `REQ-${String(id).padStart(4, '0')}`;

export async function logEvent(trx, { requisitionId, actorId, action, from = null, to = null, note = null }) {
  await trx('requisition_events').insert({
    requisition_id: requisitionId,
    actor_id: actorId,
    action,
    from_status: from,
    to_status: to,
    note: note || null,
  });
}

/**
 * Move a requisition on, only if it is still where the caller saw it, and record who did it.
 * Throws a conflict when someone else has already moved it.
 */
export async function move(trx, r, { to, action, actorId, note = null, set = {} }) {
  const n = await trx('requisitions')
    .where({ id: r.id, status: r.status })
    .update({ status: to, stage_at: trx.fn.now(), last_note: note || null, ...set });
  if (n !== 1) throw conflict(`Someone else has just moved ${ref(r.id)} on. Refresh to see where it is now.`);
  await logEvent(trx, { requisitionId: r.id, actorId, action, from: r.status, to, note });
}

/** Employees in the departments with function `code` that serve company `companyId`. */
async function functionStaff(trx, code, companyId, { managersOnly = false } = {}) {
  const depts = await trx('requisition_departments as rd')
    .join('departments as d', 'd.id', 'rd.department_id')
    .where({ 'rd.function_code': code, 'd.is_active': true })
    .select('d.id', 'd.company_id');
  const own = depts.filter((d) => d.company_id === companyId);
  const serving = (own.length ? own : depts).map((d) => d.id);
  if (!serving.length) return [];
  const q = trx('employees as e').where('e.status', 'ACTIVE').whereIn('e.department_id', serving);
  if (managersOnly) {
    q.where((w) =>
      w
        .whereExists(
          trx('employee_roles as er')
            .join('roles as ro', 'ro.id', 'er.role_id')
            .whereRaw('er.employee_id = e.id')
            .where('ro.code', 'DEPARTMENT_MANAGER'),
        )
        .orWhereExists(
          trx('employees as x').whereRaw('x.line_manager_id = e.id').where('x.status', 'ACTIVE'),
        ),
    );
  }
  return q.pluck('e.id');
}

async function roleHolders(trx, codes) {
  return trx('employee_roles as er')
    .join('roles as ro', 'ro.id', 'er.role_id')
    .join('employees as e', 'e.id', 'er.employee_id')
    .whereIn('ro.code', codes)
    .where('e.status', 'ACTIVE')
    .distinct()
    .pluck('e.id');
}

// Who acts at each stage with an inventory role (D107): the right needed, and whether it is for
// the role-holder's own company only (as access.js's roleContext).
const STAGE_RIGHTS = {
  QUOTES_IT: ['requisitions.it_quotes', true],
  DIRECTOR: ['requisitions.approve', false],
  ACCOUNTS: ['requisitions.accounts', true],
  PAY: ['requisitions.accounts', true],
  ACCOUNTS_MANAGER: ['requisitions.accounts_review', true],
  CFO: ['requisitions.cfo', false],
  PAID: ['stock.receive', true],
};

/**
 * The people whose turn it is at `status`, all active employees in Employee management. Someone
 * with an inventory role acts by that role alone; everyone else by their HR roles and
 * departments (D105), as in access.js.
 */
export async function actorsFor(trx, status, r) {
  const byHr = await actorsByHrRole(trx, status, r);
  const rights = STAGE_RIGHTS[status];
  if (!rights) return byHr;
  const [right, ownCompany] = rights;
  const roleUsers = await trx('inventory_users as u')
    .join('employees as e', 'e.id', 'u.employee_id')
    .where({ 'u.is_active': true, 'e.status': 'ACTIVE' })
    .select('e.id', 'e.company_id', 'u.role_id');
  const withRole = new Set(roleUsers.map((x) => x.id));
  const sys = await trx('inventory_roles').where({ is_system: true }).pluck('id');
  const granted = new Set(
    await trx('inventory_role_permissions').where({ permission: right }).pluck('role_id'),
  );
  const byRole = roleUsers
    .filter((x) => granted.has(x.role_id) || sys.includes(x.role_id))
    .filter((x) => !ownCompany || !x.company_id || !r.company_id || x.company_id === r.company_id)
    .map((x) => x.id);
  return [...new Set([...byHr.filter((id) => !withRole.has(id)), ...byRole])];
}

async function actorsByHrRole(trx, status, r) {
  switch (status) {
    case 'QUOTES_IT':
      return functionStaff(trx, 'IT', r.company_id);
    case 'QUOTES_DEPT':
    case 'RETURNED':
      return r.requested_by ? [r.requested_by] : [];
    case 'DIRECTOR':
      return roleHolders(trx, ['EXECUTIVE_DIRECTOR', 'MANAGING_DIRECTOR']);
    case 'ACCOUNTS':
    case 'PAY':
      return functionStaff(trx, 'ACCOUNTS', r.company_id);
    case 'ACCOUNTS_MANAGER':
      return functionStaff(trx, 'ACCOUNTS', r.company_id, { managersOnly: true });
    case 'CFO':
      return roleHolders(trx, ['ACCOUNTS_DIRECTOR']);
    case 'PAID':
      return functionStaff(trx, 'STORES', r.company_id);
    default:
      return [];
  }
}

const NEXT_TITLES = {
  QUOTES_IT: 'needs IT quotations',
  QUOTES_DEPT: 'needs quotations',
  RETURNED: 'was returned to your department',
  DIRECTOR: 'is waiting for your approval',
  ACCOUNTS: 'is with Accounts',
  ACCOUNTS_MANAGER: 'is waiting for the Accounts Manager',
  CFO: 'is waiting for final approval',
  PAY: 'is approved for payment',
  PAID: 'is paid and waiting to be received into stock',
};

/** Tell the people whose turn it now is, and the raiser when it is paid, received or returned. */
export async function notifyStage(trx, r, status, actorId) {
  const link = `/requisitions/${r.id}`;
  const label = `${ref(r.id)} · ${r.item_name}`;
  const next = (await actorsFor(trx, status, r)).filter((id) => id !== actorId);
  if (NEXT_TITLES[status] && next.length) {
    await notify(trx, {
      recipients: next,
      event: `REQUISITION_${status}`,
      title: `${label} ${NEXT_TITLES[status]}`,
      body: STAGES[status].label,
      link,
      entityType: 'requisition',
      entityId: r.id,
      email: {
        subject: `${ref(r.id)} ${NEXT_TITLES[status]}`,
        heading: `${ref(r.id)} ${NEXT_TITLES[status]}`,
        intro: `${r.quantity} × ${r.item_name}`,
        rows: [['Stage', STAGES[status].label]],
        action: 'Open the requisition',
      },
    });
  }
  // The raiser hears about payment, delivery and rejection even when it is not their turn.
  if (['PAID', 'RECEIVED', 'CANCELLED'].includes(status) && r.requested_by && r.requested_by !== actorId) {
    await notify(trx, {
      recipients: [r.requested_by],
      event: `REQUISITION_${status}`,
      title: `${label}: ${STAGES[status].label.toLowerCase()}`,
      link,
      entityType: 'requisition',
      entityId: r.id,
    });
  }
}
