import { notFound } from '../../utils/errors.js';
import { seesWholeGroup } from '../../middleware/auth.js';
import { todayInLusaka } from '../../utils/dates.js';
import { managerAuthority } from './requests.service.js';
import { PENDING_STATES } from './balance.service.js';
import { getSetting } from './policy.service.js';
import { listDocuments } from '../documents/documents.routes.js';

const name = (f, l) => (f ? `${f} ${l}` : null);

function requestSummary(r) {
  return {
    id: r.id,
    reference: r.reference,
    employee: {
      id: r.employee_id,
      name: name(r.emp_first, r.emp_last),
      employeeNumber: r.emp_number,
      department: r.dept_name ?? null,
    },
    leaveType: { id: r.leave_type_id, code: r.type_code, name: r.type_name },
    startDate: r.start_date,
    endDate: r.end_date,
    startPortion: r.start_portion,
    endPortion: r.end_portion,
    chargeableDays: Number(r.chargeable_days),
    status: r.status,
    submittedAt: r.submitted_at,
    isOverdue: Boolean(r.is_overdue),
    sensitive: Boolean(r.is_sensitive),
    routedWithoutManager: Boolean(r.routed_without_manager),
    version: r.version,
  };
}

function baseRequestQuery(db) {
  return db('leave_requests as r')
    .join('employees as e', 'e.id', 'r.employee_id')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select(
      'r.*',
      'e.first_name as emp_first',
      'e.last_name as emp_last',
      'e.employee_number as emp_number',
      'e.line_manager_id as emp_manager_id',
      'd.name as dept_name',
      't.code as type_code',
      't.name as type_name',
      't.is_confidential as type_confidential',
    );
}

export async function myRequests(db, employeeId, { year } = {}) {
  const q = baseRequestQuery(db).where('r.employee_id', employeeId).orderBy('r.start_date', 'desc');
  if (year) q.andWhereRaw('YEAR(r.start_date) = ?', [Number(year)]);
  return (await q).map(requestSummary);
}

/** Full request detail, if the viewer is allowed to see it. Confidential details are limited to the employee and HR. */
export async function requestDetail(db, viewer, id) {
  const r = await baseRequestQuery(db).where('r.id', id).first();
  if (!r) throw notFound('Leave request not found.');
  const isOwner = r.employee_id === viewer.id;
  const isHr = viewer.roles.includes('HR_OFFICER');
  const authority = await managerAuthority(db, viewer, r);
  const wasManager = r.assigned_manager_id === viewer.id;
  // Directors see every request but, like managers, not confidential details.
  const isDirector = seesWholeGroup(viewer);
  // A sensitive request skips the manager, but the employee's manager can still see that it
  // exists (dates and type, for planning cover), never its reason or documents.
  const isTeamManager = r.is_sensitive && r.emp_manager_id === viewer.id;
  if (!isOwner && !isHr && !isDirector && !authority && !wasManager && !isTeamManager) {
    throw notFound('Leave request not found.');
  }
  const seesConfidential = isOwner || isHr || (!r.type_confidential && !r.is_sensitive);

  const days = await db('leave_request_days as d')
    .leftJoin('public_holidays as h', 'h.id', 'd.public_holiday_id')
    .where('d.leave_request_id', id)
    .orderBy('d.leave_date')
    .select('d.leave_date as date', 'd.charged', 'd.exclusion_reason as exclusion', 'h.name as holiday');
  const actions = await db('approval_actions as a')
    .leftJoin('employees as e', 'e.id', 'a.actor_id')
    .leftJoin('employees as o', 'o.id', 'a.on_behalf_of_id')
    .where('a.leave_request_id', id)
    .orderBy('a.id')
    .select('a.*', 'e.first_name', 'e.last_name', 'o.first_name as obo_first', 'o.last_name as obo_last');
  const changes = await db('change_requests').where({ leave_request_id: id }).orderBy('id');
  const changeActions = changes.length
    ? await db('approval_actions as a')
        .leftJoin('employees as e', 'e.id', 'a.actor_id')
        .whereIn(
          'a.change_request_id',
          changes.map((c) => c.id),
        )
        .orderBy('a.id')
        .select('a.*', 'e.first_name', 'e.last_name')
    : [];
  const manager = r.assigned_manager_id
    ? await db('employees').where({ id: r.assigned_manager_id }).first('first_name', 'last_name')
    : null;
  const contact = r.handover_contact_id
    ? await db('employees').where({ id: r.handover_contact_id }).first('first_name', 'last_name')
    : null;

  const policy = await db('leave_policy_versions')
    .where({ id: r.policy_version_id })
    .first('document_required', 'document_description');
  const documents = await listDocuments(db, id, seesConfidential);

  const approvedAsManager = actions.some(
    (a) => a.stage === 'MANAGER' && a.action === 'APPROVE' && a.actor_id === viewer.id,
  );
  const today = todayInLusaka();
  const openChange = changes.find((c) =>
    ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL'].includes(c.status),
  );

  return {
    ...requestSummary(r),
    eventDate: r.event_date,
    multipleBirth: Boolean(r.multiple_birth),
    reason: seesConfidential ? r.reason : null,
    reasonHidden: !seesConfidential && Boolean(r.reason),
    handoverNotes: r.handover_notes,
    handoverContact: contact ? name(contact.first_name, contact.last_name) : null,
    handoverContactId: r.handover_contact_id,
    noticeShortfallReason: r.notice_shortfall_reason,
    calendarDays: r.calendar_days,
    assignedManager: manager ? name(manager.first_name, manager.last_name) : null,
    days: days.map((d) => ({ ...d, charged: Number(d.charged) })),
    documents,
    documentRequirement: policy?.document_required
      ? { description: policy.document_description, provided: documents.length > 0 }
      : null,
    history: actions.map((a) => ({
      at: a.created_at,
      stage: a.stage,
      action: a.action,
      actor: a.actor_id ? name(a.first_name, a.last_name) : 'System',
      onBehalfOf: a.on_behalf_of_id ? name(a.obo_first, a.obo_last) : null,
      from: a.from_status,
      to: a.to_status,
      comment: seesConfidential || a.stage !== 'EMPLOYEE' ? a.comment : null,
    })),
    changes: changes.map((c) => ({
      id: c.id,
      reference: c.reference,
      type: c.change_type,
      reasonType: c.cancel_reason_type,
      reason: seesConfidential ? c.reason : null,
      daysToReverse: c.days_to_reverse == null ? null : Number(c.days_to_reverse),
      status: c.status,
      version: c.version,
      history: changeActions
        .filter((a) => a.change_request_id === c.id)
        .map((a) => ({
          at: a.created_at,
          stage: a.stage,
          action: a.action,
          actor: name(a.first_name, a.last_name) ?? 'System',
          to: a.to_status,
          comment: a.comment,
        })),
    })),
    can: {
      withdraw: isOwner && PENDING_STATES.includes(r.status),
      resubmit: isOwner && r.status === 'RETURNED_FOR_CORRECTION',
      cancel: isOwner && r.status === 'APPROVED' && today <= r.end_date && !openChange,
      managerDecide: Boolean(authority) && r.status === 'PENDING_MANAGER_APPROVAL',
      hrDecide: isHr && !isOwner && !approvedAsManager && r.status === 'PENDING_HR_APPROVAL',
      changeManagerDecide: Boolean(authority) && openChange?.status === 'PENDING_MANAGER_APPROVAL',
      changeHrDecide: isHr && !isOwner && openChange?.status === 'PENDING_HR_APPROVAL',
      uploadDocument:
        (isOwner || isHr) &&
        !['WITHDRAWN', 'REJECTED_BY_MANAGER', 'REJECTED_BY_HR', 'CANCELLED'].includes(r.status),
    },
    started: today >= r.start_date,
  };
}

/** Requests and cancellations waiting for this person as manager or delegate. */
export async function managerQueue(db, viewer) {
  const today = todayInLusaka();
  const delegators = await db('delegations')
    .where({ delegate_id: viewer.id })
    .whereNull('revoked_at')
    .andWhere('start_date', '<=', today)
    .andWhere('end_date', '>=', today)
    .pluck('delegator_id');
  let managers = [viewer.id, ...delegators];
  if ((await getSetting(db, 'manager_scope', 'DIRECT_REPORTS')) === 'REPORTING_LINE') {
    // Everyone below the viewer in the reporting line.
    const below = [];
    let frontier = [viewer.id];
    const seen = new Set(frontier);
    while (frontier.length) {
      const next = await db('employees').whereIn('line_manager_id', frontier).pluck('id');
      frontier = next.filter((id) => !seen.has(id));
      frontier.forEach((id) => seen.add(id));
      below.push(...frontier);
    }
    managers = [...new Set([...managers, ...below])];
  }
  const requests = await baseRequestQuery(db)
    .where('r.status', 'PENDING_MANAGER_APPROVAL')
    .whereIn('r.assigned_manager_id', managers)
    .whereNot('r.employee_id', viewer.id)
    .orderBy('r.submitted_at');
  const changes = await changeQueue(db, 'PENDING_MANAGER_APPROVAL', (q) =>
    q.whereIn('c.assigned_manager_id', managers).whereNot('r.employee_id', viewer.id),
  );
  return { requests: requests.map(requestSummary), changes };
}

/** Requests and cancellations waiting for HR's final decision. */
export async function hrQueue(db, viewer) {
  const requests = await baseRequestQuery(db)
    .where('r.status', 'PENDING_HR_APPROVAL')
    .orderBy('r.submitted_at');
  const changes = await changeQueue(db, 'PENDING_HR_APPROVAL');
  const managerStage = await baseRequestQuery(db)
    .where('r.status', 'PENDING_MANAGER_APPROVAL')
    .orderBy('r.submitted_at');
  // HR decisions on leave requests in the last 90 days, newest first.
  const decided = await baseRequestQuery(db)
    .join('approval_actions as a', 'a.leave_request_id', 'r.id')
    .leftJoin('employees as x', 'x.id', 'a.actor_id')
    .where('a.stage', 'HR')
    .whereIn('a.action', ['APPROVE', 'REJECT', 'RETURN'])
    .andWhere('a.created_at', '>=', db.raw('UTC_TIMESTAMP() - INTERVAL 90 DAY'))
    .orderBy('a.id', 'desc')
    .limit(100)
    .select(
      'a.id as action_id',
      'a.action as decision',
      'a.created_at as decided_at',
      'a.comment as decision_comment',
      'x.first_name as by_first',
      'x.last_name as by_last',
    );
  return {
    requests: requests.map((r) => ({ ...requestSummary(r), isOwn: r.employee_id === viewer.id })),
    changes,
    withManagers: managerStage.map(requestSummary),
    decided: decided.map((r) => ({
      ...requestSummary(r),
      decision: {
        id: r.action_id,
        action: r.decision,
        at: r.decided_at,
        by: name(r.by_first, r.by_last),
        comment: r.decision_comment,
      },
    })),
  };
}

async function changeQueue(db, status, scope) {
  const q = db('change_requests as c')
    .join('leave_requests as r', 'r.id', 'c.leave_request_id')
    .join('employees as e', 'e.id', 'r.employee_id')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .where('c.status', status)
    .select(
      'c.*',
      'r.reference as leave_reference',
      'r.start_date',
      'r.end_date',
      'r.employee_id',
      'e.first_name',
      'e.last_name',
      't.name as type_name',
    )
    .orderBy('c.created_at');
  if (scope) scope(q);
  return (await q).map((c) => ({
    id: c.id,
    reference: c.reference,
    leaveRequestId: c.leave_request_id,
    leaveReference: c.leave_reference,
    employee: { id: c.employee_id, name: name(c.first_name, c.last_name) },
    leaveType: c.type_name,
    startDate: c.start_date,
    endDate: c.end_date,
    reasonType: c.cancel_reason_type,
    daysToReverse: c.days_to_reverse == null ? null : Number(c.days_to_reverse),
    status: c.status,
    version: c.version,
    createdAt: c.created_at,
  }));
}
