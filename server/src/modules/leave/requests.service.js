import { z } from 'zod';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { isoDate, optionalId, optionalText } from '../../utils/validation.js';
import { todayInLusaka } from '../../utils/dates.js';
import { writeAudit } from '../audit/audit.service.js';
import { addDays, calculateLeaveDays, chargeByYear, daysBetween } from './calendar.js';
import {
  annualPosition,
  daysTaken,
  eligibilityProblem,
  entitlementWindow,
  postLedger,
  PENDING_STATES,
} from './balance.service.js';
import { getSetting, loadCalendarInputs, policyOn } from './policy.service.js';

const round2 = (n) => Math.round(n * 100) / 100;
const OPEN_STATES = [...PENDING_STATES, 'APPROVED'];

export const requestInputSchema = z.object({
  leaveTypeId: z.coerce.number().int().positive(),
  startDate: isoDate,
  endDate: isoDate,
  startPortion: z.enum(['FULL', 'PM_ONLY']).default('FULL'),
  endPortion: z.enum(['FULL', 'AM_ONLY']).default('FULL'),
  reason: optionalText(2000),
  handoverNotes: optionalText(4000),
  handoverContactId: optionalId,
  noticeShortfallReason: optionalText(1000),
  eventDate: isoDate.nullish().or(z.literal('').transform(() => null)),
  multipleBirth: z.boolean().default(false),
});

const err = (field, message) => ({ field, message });

/**
 * Check a request against the employee's record and the policy in force, without saving.
 * Returns the day calculation, blocking errors (with the field to fix) and warnings.
 * phase 'FINAL' is used at HR approval: the request's own days are excluded and only the
 * ledger balance counts (other pending requests are checked when they are approved).
 */
export async function evaluateRequest(
  db,
  employee,
  input,
  { excludeRequestId = null, phase = 'SUBMIT', today = todayInLusaka() } = {},
) {
  const errors = [];
  const warnings = [];
  const type = await db('leave_types').where({ id: input.leaveTypeId }).first();
  if (!type) return { errors: [err('leaveTypeId', 'Choose a leave type.')], warnings };
  if (!type.is_active && phase === 'SUBMIT')
    errors.push(err('leaveTypeId', `${type.name} is not available yet.`));

  if (input.endDate < input.startDate) {
    return {
      type,
      errors: [...errors, err('endDate', 'The end date must be on or after the start date.')],
      warnings,
    };
  }
  if (daysBetween(input.startDate, input.endDate) > 365) {
    return {
      type,
      errors: [...errors, err('endDate', 'A single request cannot be longer than a year.')],
      warnings,
    };
  }

  const policy = await policyOn(db, type.id, input.startDate);
  if (!policy)
    return {
      type,
      errors: [...errors, err('startDate', `No ${type.name} policy applies on that date.`)],
      warnings,
    };

  // Half days
  const half = input.startPortion !== 'FULL' || input.endPortion !== 'FULL';
  if (half && !policy.allowHalfDay)
    errors.push(err('startPortion', `${type.name} cannot be taken in half days.`));
  if (
    input.startDate === input.endDate &&
    input.startPortion === 'PM_ONLY' &&
    input.endPortion === 'AM_ONLY'
  ) {
    errors.push(err('endPortion', 'A single day cannot be both an afternoon and a morning.'));
  }

  const cal = await loadCalendarInputs(db, employee.id, input.startDate, input.endDate);
  const calc = calculateLeaveDays({
    ...input,
    dayBasis: policy.dayBasis,
    schedule: cal.schedule,
    holidays: cal.holidays,
  });
  if (calc.chargeableDays <= 0) {
    errors.push(err('startDate', 'These dates include no working days, so there is nothing to request.'));
  }

  // Eligibility and employment dates
  const notEligible = eligibilityProblem(employee, policy, input.startDate);
  if (notEligible) errors.push(err('leaveTypeId', notEligible));
  if (input.startDate < employee.employment_start_date) {
    errors.push(err('startDate', 'Leave cannot start before your employment start date.'));
  }
  if (employee.employment_end_date && input.endDate > employee.employment_end_date) {
    errors.push(err('endDate', 'Leave cannot run past your employment end date.'));
  }

  if (phase === 'SUBMIT') {
    // Back-dating and notice
    if (input.startDate < today) {
      const back = daysBetween(input.startDate, today);
      if (!policy.allowBackdate) errors.push(err('startDate', `${type.name} cannot start in the past.`));
      else if (policy.backdateMaxDays != null && back > policy.backdateMaxDays) {
        errors.push(
          err(
            'startDate',
            `${type.name} can be recorded up to ${policy.backdateMaxDays} days after it started.`,
          ),
        );
      }
    } else if (policy.minNoticeDays && daysBetween(today, input.startDate) < policy.minNoticeDays) {
      const msg = `The policy asks for at least ${policy.minNoticeDays} days' notice for ${type.name.toLowerCase()}.`;
      if (policy.noticeEnforcement === 'BLOCK') errors.push(err('startDate', msg));
      else if (policy.noticeEnforcement === 'WARN_WITH_REASON') {
        warnings.push(msg);
        if (!input.noticeShortfallReason)
          errors.push(err('noticeShortfallReason', 'Explain why this request is at short notice.'));
      }
    }

    if (policy.extraRules.reasonRequired && !input.reason)
      errors.push(err('reason', 'Give a reason for this request.'));
    if (policy.handoverRequired && !input.handoverNotes) {
      errors.push(err('handoverNotes', 'Add handover notes: what needs covering and who will cover it.'));
    }
    if (input.handoverContactId && input.handoverContactId === employee.id) {
      errors.push(err('handoverContactId', 'Choose someone other than yourself to cover.'));
    }

    // Leave tied to an event (paternity: the birth)
    if (policy.extraRules.eventRequired) {
      if (!input.eventDate) errors.push(err('eventDate', 'Enter the date of birth.'));
      else {
        if (input.startDate < input.eventDate)
          errors.push(err('startDate', 'This leave starts on or after the birth.'));
        const within = policy.extraRules.startWithinDays;
        if (within && input.startDate > addDays(input.eventDate, within)) {
          errors.push(
            err(
              'startDate',
              `This leave must start within ${within} days of the birth; after that it is forfeited.`,
            ),
          );
        }
        const reasonAfter = policy.extraRules.reasonAfterDays;
        if (reasonAfter && input.startDate > addDays(input.eventDate, reasonAfter) && !input.reason) {
          errors.push(
            err('reason', `Starting more than ${reasonAfter} days after the birth needs an agreed reason.`),
          );
        }
      }
    }
  }

  // Overlap with the employee's own leave
  const overlap = await db('leave_requests as r')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .where('r.employee_id', employee.id)
    .whereIn('r.status', OPEN_STATES)
    .andWhere('r.start_date', '<=', input.endDate)
    .andWhere('r.end_date', '>=', input.startDate)
    .modify((q) => excludeRequestId && q.whereNot('r.id', excludeRequestId))
    .first('r.reference', 'r.start_date', 'r.end_date', 't.name');
  if (overlap) {
    errors.push(
      err(
        'startDate',
        `These dates overlap your ${overlap.name.toLowerCase()} ${overlap.reference} (${overlap.start_date} to ${overlap.end_date}).`,
      ),
    );
  }

  // Duration and entitlement
  const maxDays =
    input.multipleBirth && policy.extraRules.multipleBirthMaxDays
      ? policy.extraRules.multipleBirthMaxDays
      : policy.maxSingleDurationDays;
  if (maxDays != null && calc.chargeableDays > maxDays) {
    errors.push(
      err('endDate', `${type.name} is at most ${maxDays} days per request; this is ${calc.chargeableDays}.`),
    );
  }

  const balances = [];
  if (policy.consumesBalance) {
    for (const [year, days] of chargeByYear(calc.days)) {
      const pos = await annualPosition(db, employee.id, type.id, year, { excludeRequestId });
      const available = phase === 'FINAL' ? pos.balance : pos.available;
      balances.push({ year, available, requested: days, remainingAfter: round2(available - days) });
      if (!policy.allowNegativeBalance && days > available) {
        errors.push(
          err(
            'endDate',
            `You have ${available} days of ${type.name.toLowerCase()} available for ${year}; this request needs ${days}.`,
          ),
        );
      }
    }
  } else if (policy.entitlementDays != null) {
    const w = entitlementWindow(policy.entitlementPeriod, input.startDate, input.endDate);
    if (w) {
      const used = await daysTaken(db, {
        employeeId: employee.id,
        leaveTypeId: type.id,
        from: w.from,
        to: w.to,
        excludeRequestId,
      });
      const left = round2(Math.max(0, policy.entitlementDays - used));
      balances.push({
        window: w,
        entitlement: policy.entitlementDays,
        used,
        available: left,
        requested: calc.chargeableDays,
      });
      if (calc.chargeableDays > left) {
        const overflow = policy.extraRules.overflowTo ? ' Request the extra days as annual leave.' : '';
        errors.push(
          err(
            'endDate',
            `${type.name} is limited to ${policy.entitlementDays} days ${w.label}; ${left} left.${overflow}`,
          ),
        );
      }
    }
  }

  // Leave without pay only when other leave is used up (policy 9.2)
  for (const code of policy.extraRules.requiresExhausted ?? []) {
    const other = await db('leave_types').where({ code, is_active: true }).first();
    if (!other) continue;
    const pos = await annualPosition(db, employee.id, other.id, Number(input.startDate.slice(0, 4)));
    if (pos.available > 0) {
      errors.push(
        err(
          'leaveTypeId',
          `Leave without pay is only possible once your ${other.name.toLowerCase()} is used up; you have ${pos.available} days available.`,
        ),
      );
    }
  }

  if (policy.documentRequired) {
    warnings.push(`HR will need: ${policy.documentDescription ?? 'a supporting document'}.`);
  }

  return { type, policy, calc, scheduleName: cal.scheduleName, balances, errors, warnings };
}

/** Public shape of an evaluation (no internal objects). */
export function evaluationView(ev) {
  return {
    leaveType: ev.type ? { id: ev.type.id, code: ev.type.code, name: ev.type.name } : null,
    dayBasis: ev.policy?.dayBasis ?? null,
    chargeableDays: ev.calc?.chargeableDays ?? null,
    calendarDays: ev.calc?.calendarDays ?? null,
    nonWorkingDaysExcluded: ev.calc?.nonWorkingDaysExcluded ?? 0,
    holidaysExcluded: ev.calc?.holidaysExcluded ?? [],
    schedule: ev.scheduleName ?? null,
    balances: ev.balances ?? [],
    errors: ev.errors,
    warnings: ev.warnings,
    ok: ev.errors.length === 0,
  };
}

// Field-level errors for the client.
export class RequestInvalid extends AppError {
  constructor(ev) {
    super(400, 'VALIDATION_FAILED', 'Some fields need attention.');
    this.fields = ev.errors.map((e) => ({ path: e.field, message: e.message }));
    this.details = { evaluation: evaluationView(ev) };
  }
}

async function lockEmployee(trx, id) {
  const e = await trx('employees').where({ id }).forUpdate().first();
  if (!e) throw notFound('Employee not found.');
  return e;
}

async function resolveManager(trx, employee) {
  if (!employee.line_manager_id) return null;
  const m = await trx('employees').where({ id: employee.line_manager_id }).first('id', 'status');
  return m && m.status === 'ACTIVE' ? m.id : null;
}

async function insertDays(trx, requestId, calc) {
  const rows = calc.days.map((d) => ({
    leave_request_id: requestId,
    leave_date: d.date,
    charged: d.charged,
    exclusion_reason: d.exclusion,
    public_holiday_id: d.holidayId,
  }));
  for (let i = 0; i < rows.length; i += 200) await trx('leave_request_days').insert(rows.slice(i, i + 200));
}

async function recordAction(trx, a) {
  await trx('approval_actions').insert({
    leave_request_id: a.requestId ?? null,
    change_request_id: a.changeRequestId ?? null,
    stage: a.stage,
    action: a.action,
    actor_id: a.actorId ?? null,
    acting_as: a.actingAs,
    on_behalf_of_id: a.onBehalfOfId ?? null,
    from_status: a.from ?? null,
    to_status: a.to,
    comment: a.comment ?? null,
  });
}

/** Submit a new leave request for the signed-in employee. */
export async function submitRequest(db, actor, input, audit) {
  return db.transaction(async (trx) => {
    // Serialise this employee's submissions so two at once cannot over-commit the balance.
    const employee = await lockEmployee(trx, actor.id);
    const ev = await evaluateRequest(trx, employee, input);
    if (ev.errors.length) throw new RequestInvalid(ev);

    const managerId = await resolveManager(trx, employee);
    const status = managerId ? 'PENDING_MANAGER_APPROVAL' : 'PENDING_HR_APPROVAL';
    const [id] = await trx('leave_requests').insert({
      employee_id: employee.id,
      leave_type_id: ev.type.id,
      policy_version_id: ev.policy.id,
      start_date: input.startDate,
      end_date: input.endDate,
      start_portion: input.startPortion,
      end_portion: input.endPortion,
      event_date: input.eventDate ?? null,
      multiple_birth: input.multipleBirth,
      chargeable_days: ev.calc.chargeableDays,
      calendar_days: ev.calc.calendarDays,
      reason: input.reason,
      handover_notes: input.handoverNotes,
      handover_contact_id: input.handoverContactId,
      notice_shortfall_reason: input.noticeShortfallReason,
      status,
      assigned_manager_id: managerId,
      routed_without_manager: !managerId,
      submitted_at: trx.fn.now(),
    });
    const reference = `LR-${input.startDate.slice(0, 4)}-${String(id).padStart(6, '0')}`;
    await trx('leave_requests').where({ id }).update({ reference });
    await insertDays(trx, id, ev.calc);
    await recordAction(trx, {
      requestId: id,
      stage: 'EMPLOYEE',
      action: 'SUBMIT',
      actorId: actor.id,
      actingAs: 'EMPLOYEE',
      to: status,
    });
    if (!managerId) {
      await recordAction(trx, {
        requestId: id,
        stage: 'SYSTEM',
        action: 'ROUTE',
        actingAs: 'SYSTEM',
        from: 'PENDING_MANAGER_APPROVAL',
        to: status,
        comment: 'No active manager recorded; sent straight to HR (decision D3).',
      });
    }
    await writeAudit(trx, {
      ...audit,
      action: 'LEAVE_REQUEST_SUBMITTED',
      entityType: 'leave_request',
      entityId: id,
      after: {
        reference,
        leaveType: ev.type.code,
        startDate: input.startDate,
        endDate: input.endDate,
        days: ev.calc.chargeableDays,
        status,
      },
    });
    return { id, reference, status, chargeableDays: ev.calc.chargeableDays };
  });
}

// ---------------------------------------------------------------------------------------------
// Who may act

/** Is the actor allowed to act at the manager stage for this employee's request? */
export async function managerAuthority(db, actor, req) {
  if (actor.id === req.employee_id) return null;
  if (req.assigned_manager_id === actor.id) return { actingAs: 'MANAGER', onBehalfOfId: null };
  const today = todayInLusaka();
  if (req.assigned_manager_id) {
    const delegation = await db('delegations')
      .where({ delegator_id: req.assigned_manager_id, delegate_id: actor.id })
      .whereNull('revoked_at')
      .andWhere('start_date', '<=', today)
      .andWhere('end_date', '>=', today)
      .first('id');
    if (delegation) return { actingAs: 'DELEGATE', onBehalfOfId: req.assigned_manager_id };
  }
  if ((await getSetting(db, 'manager_scope', 'DIRECT_REPORTS')) === 'REPORTING_LINE') {
    let current = req.assigned_manager_id;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const row = await db('employees').where({ id: current }).first('line_manager_id');
      current = row?.line_manager_id ?? null;
      if (current === actor.id) return { actingAs: 'MANAGER', onBehalfOfId: null };
    }
  }
  return null;
}

async function lockRequest(trx, id, expectedVersion) {
  const r = await trx('leave_requests').where({ id }).forUpdate().first();
  if (!r) throw notFound('Leave request not found.');
  if (expectedVersion != null && Number(expectedVersion) !== r.version) {
    throw conflict('This request has changed since you opened it. Refresh to see the latest.', {
      status: r.status,
    });
  }
  return r;
}

function requireState(r, ...states) {
  if (!states.includes(r.status)) {
    throw conflict(
      `This request is ${r.status.toLowerCase().replaceAll('_', ' ')}, so that action is not available.`,
      { status: r.status },
    );
  }
}

const decisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'RETURN']),
  comment: optionalText(2000),
  version: z.coerce.number().int().positive().optional(),
});
export { decisionSchema };

/** Manager (or delegate) approves or rejects. Approval sends the request to HR. */
export async function managerDecision(db, actor, requestId, input, audit) {
  return db.transaction(async (trx) => {
    const r = await lockRequest(trx, requestId, input.version);
    requireState(r, 'PENDING_MANAGER_APPROVAL');
    const authority = await managerAuthority(trx, actor, r);
    if (!authority)
      throw forbidden('Only the employee’s manager (or their delegate) can act on this request.');
    if (input.action === 'RETURN')
      throw badRequest('Managers approve or reject; HR can return a request for correction.');
    if (input.action === 'REJECT' && !input.comment)
      throw badRequest('Give a reason for rejecting (policy 1.3.2(c)).');
    const to = input.action === 'APPROVE' ? 'PENDING_HR_APPROVAL' : 'REJECTED_BY_MANAGER';
    await trx('leave_requests')
      .where({ id: r.id })
      .update({ status: to, manager_decided_at: trx.fn.now(), version: r.version + 1 });
    await recordAction(trx, {
      requestId: r.id,
      stage: 'MANAGER',
      action: input.action,
      actorId: actor.id,
      ...authority,
      from: r.status,
      to,
      comment: input.comment,
    });
    await writeAudit(trx, {
      ...audit,
      action: input.action === 'APPROVE' ? 'LEAVE_MANAGER_APPROVED' : 'LEAVE_MANAGER_REJECTED',
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: r.status },
      after: { status: to, comment: input.comment ?? null },
    });
    return { id: r.id, status: to };
  });
}

/** HR final decision. Only approval confirms the leave and deducts the balance — exactly once. */
export async function hrDecision(db, actor, requestId, input, audit) {
  return db.transaction(async (trx) => {
    const r = await lockRequest(trx, requestId, input.version);
    requireState(r, 'PENDING_HR_APPROVAL');
    if (!actor.roles.includes('HR_OFFICER')) throw forbidden('Only HR Officers give final approval.');
    if (actor.id === r.employee_id) throw forbidden('You cannot give final approval to your own leave.');
    const approvedAsManager = await trx('approval_actions')
      .where({ leave_request_id: r.id, stage: 'MANAGER', action: 'APPROVE', actor_id: actor.id })
      .first('id');
    if (approvedAsManager)
      throw forbidden(
        'You approved this request as manager; a different HR Officer must give final approval.',
      );
    if (input.action !== 'APPROVE' && !input.comment) {
      throw badRequest(
        input.action === 'REJECT' ? 'Give a reason for rejecting.' : 'Say what needs correcting.',
      );
    }

    let to;
    if (input.action === 'APPROVE') {
      const employee = await lockEmployee(trx, r.employee_id);
      const ev = await evaluateRequest(
        trx,
        employee,
        {
          leaveTypeId: r.leave_type_id,
          startDate: r.start_date,
          endDate: r.end_date,
          startPortion: r.start_portion,
          endPortion: r.end_portion,
          multipleBirth: Boolean(r.multiple_birth),
          eventDate: r.event_date,
        },
        { excludeRequestId: r.id, phase: 'FINAL' },
      );
      if (ev.errors.length) {
        throw conflict(
          `This request can no longer be approved: ${ev.errors.map((e) => e.message).join(' ')}`,
        );
      }
      if (ev.policy.consumesBalance) {
        // Deduct per leave year from the stored day breakdown. The ledger's unique key
        // (source, entry type, leave type, year) makes a second deduction impossible.
        const days = await trx('leave_request_days')
          .where({ leave_request_id: r.id })
          .select('leave_date as date', 'charged');
        for (const [year, amount] of chargeByYear(
          days.map((d) => ({ date: d.date, charged: Number(d.charged) })),
        )) {
          await postLedger(trx, {
            employeeId: r.employee_id,
            leaveTypeId: r.leave_type_id,
            leaveYear: year,
            amount: -amount,
            entryType: 'DEDUCTION',
            sourceType: 'LEAVE_REQUEST',
            sourceId: r.id,
            reason: `${r.reference} approved`,
            createdBy: actor.id,
          });
        }
      }
      to = 'APPROVED';
    } else {
      to = input.action === 'REJECT' ? 'REJECTED_BY_HR' : 'RETURNED_FOR_CORRECTION';
    }

    await trx('leave_requests')
      .where({ id: r.id })
      .update({ status: to, hr_decided_at: trx.fn.now(), version: r.version + 1 });
    await recordAction(trx, {
      requestId: r.id,
      stage: 'HR',
      action: input.action,
      actorId: actor.id,
      actingAs: 'HR_OFFICER',
      from: r.status,
      to,
      comment: input.comment,
    });
    await writeAudit(trx, {
      ...audit,
      action: { APPROVE: 'LEAVE_HR_APPROVED', REJECT: 'LEAVE_HR_REJECTED', RETURN: 'LEAVE_HR_RETURNED' }[
        input.action
      ],
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: r.status },
      after: { status: to, comment: input.comment ?? null },
    });
    return { id: r.id, status: to };
  });
}

/** Employee withdraws a request that is not yet decided. */
export async function withdrawRequest(db, actor, requestId, { comment, version } = {}, audit) {
  return db.transaction(async (trx) => {
    const r = await lockRequest(trx, requestId, version);
    if (r.employee_id !== actor.id) throw forbidden('You can only withdraw your own requests.');
    requireState(r, ...PENDING_STATES);
    await trx('leave_requests')
      .where({ id: r.id })
      .update({ status: 'WITHDRAWN', version: r.version + 1 });
    await recordAction(trx, {
      requestId: r.id,
      stage: 'EMPLOYEE',
      action: 'WITHDRAW',
      actorId: actor.id,
      actingAs: 'EMPLOYEE',
      from: r.status,
      to: 'WITHDRAWN',
      comment,
    });
    await writeAudit(trx, {
      ...audit,
      action: 'LEAVE_REQUEST_WITHDRAWN',
      entityType: 'leave_request',
      entityId: r.id,
      before: { status: r.status },
    });
    return { id: r.id, status: 'WITHDRAWN' };
  });
}

/** Employee corrects a request HR returned, and resubmits it. */
export async function resubmitRequest(db, actor, requestId, input, audit) {
  return db.transaction(async (trx) => {
    const r = await lockRequest(trx, requestId, input.version);
    if (r.employee_id !== actor.id) throw forbidden('You can only resubmit your own requests.');
    requireState(r, 'RETURNED_FOR_CORRECTION');
    const employee = await lockEmployee(trx, actor.id);
    const values = { ...input, leaveTypeId: r.leave_type_id };
    const ev = await evaluateRequest(trx, employee, values, { excludeRequestId: r.id });
    if (ev.errors.length) throw new RequestInvalid(ev);

    const routing = await getSetting(trx, 'resubmission_routing', 'MANAGER_STAGE');
    const managerId = await resolveManager(trx, employee);
    const to = routing === 'HR_STAGE' || !managerId ? 'PENDING_HR_APPROVAL' : 'PENDING_MANAGER_APPROVAL';
    await trx('leave_requests')
      .where({ id: r.id })
      .update({
        policy_version_id: ev.policy.id,
        start_date: values.startDate,
        end_date: values.endDate,
        start_portion: values.startPortion,
        end_portion: values.endPortion,
        event_date: values.eventDate ?? null,
        multiple_birth: values.multipleBirth,
        chargeable_days: ev.calc.chargeableDays,
        calendar_days: ev.calc.calendarDays,
        reason: values.reason,
        handover_notes: values.handoverNotes,
        handover_contact_id: values.handoverContactId,
        notice_shortfall_reason: values.noticeShortfallReason,
        status: to,
        assigned_manager_id: managerId,
        routed_without_manager: !managerId,
        manager_decided_at: null,
        hr_decided_at: null,
        version: r.version + 1,
      });
    await trx('leave_request_days').where({ leave_request_id: r.id }).del();
    await insertDays(trx, r.id, ev.calc);
    await recordAction(trx, {
      requestId: r.id,
      stage: 'EMPLOYEE',
      action: 'RESUBMIT',
      actorId: actor.id,
      actingAs: 'EMPLOYEE',
      from: r.status,
      to,
      comment: input.comment,
    });
    await writeAudit(trx, {
      ...audit,
      action: 'LEAVE_REQUEST_RESUBMITTED',
      entityType: 'leave_request',
      entityId: r.id,
      before: { startDate: r.start_date, endDate: r.end_date, days: Number(r.chargeable_days) },
      after: {
        startDate: values.startDate,
        endDate: values.endDate,
        days: ev.calc.chargeableDays,
        status: to,
      },
    });
    return { id: r.id, status: to };
  });
}

// ---------------------------------------------------------------------------------------------
// Cancelling or cutting short approved leave (separate, two-stage, audited workflow)

export const cancelSchema = z.object({
  reasonType: z.enum(['PLANS_CHANGED', 'RECALLED_BY_MANAGEMENT', 'EARLY_RETURN_BY_CHOICE']),
  reason: z.string().trim().min(1, 'is required').max(2000),
});

/** What cancelling would change, as of a date. Untaken days are those after `today`. */
async function cancellationEffect(db, r, reasonType, today) {
  const started = today >= r.start_date;
  if (today > r.end_date) throw conflict('This leave has already been taken and cannot be cancelled.');
  if (!started && reasonType !== 'PLANS_CHANGED') {
    throw badRequest('This leave has not started yet; choose "My plans have changed".');
  }
  if (started && reasonType === 'PLANS_CHANGED') {
    throw badRequest(
      'This leave has started; say whether you were recalled by management or are returning early by choice.',
    );
  }
  const days = await db('leave_request_days')
    .where({ leave_request_id: r.id })
    .select('leave_date', 'charged');
  const untaken = started ? days.filter((d) => d.leave_date > today) : days;
  const untakenDays = round2(untaken.reduce((s, d) => s + Number(d.charged), 0));
  // Policy 2.8 / D24: returning early by choice does not give the days back.
  const daysToReverse = reasonType === 'EARLY_RETURN_BY_CHOICE' ? 0 : untakenDays;
  return { started, untaken, untakenDays, daysToReverse, newEndDate: started ? today : null };
}

export async function requestCancellation(db, actor, requestId, input, audit) {
  return db.transaction(async (trx) => {
    const r = await lockRequest(trx, requestId);
    if (r.employee_id !== actor.id) throw forbidden('You can only cancel your own leave.');
    requireState(r, 'APPROVED');
    const open = await trx('change_requests')
      .where({ leave_request_id: r.id })
      .whereIn('status', ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL'])
      .first('id');
    if (open) throw conflict('A cancellation for this leave is already waiting for approval.');
    const effect = await cancellationEffect(trx, r, input.reasonType, todayInLusaka());
    const employee = await trx('employees').where({ id: r.employee_id }).first();
    const managerId = await resolveManager(trx, employee);
    const status = managerId ? 'PENDING_MANAGER_APPROVAL' : 'PENDING_HR_APPROVAL';
    const [id] = await trx('change_requests').insert({
      leave_request_id: r.id,
      change_type: 'CANCEL',
      cancel_reason_type: input.reasonType,
      days_to_reverse: effect.daysToReverse,
      reason: input.reason,
      status,
      requested_by: actor.id,
      assigned_manager_id: managerId,
      routed_without_manager: !managerId,
    });
    const reference = `CR-${r.start_date.slice(0, 4)}-${String(id).padStart(6, '0')}`;
    await trx('change_requests').where({ id }).update({ reference });
    await recordAction(trx, {
      changeRequestId: id,
      stage: 'EMPLOYEE',
      action: 'SUBMIT',
      actorId: actor.id,
      actingAs: 'EMPLOYEE',
      to: status,
      comment: input.reason,
    });
    await writeAudit(trx, {
      ...audit,
      action: 'LEAVE_CANCELLATION_REQUESTED',
      entityType: 'leave_request',
      entityId: r.id,
      after: { changeRequest: reference, reasonType: input.reasonType, daysToReverse: effect.daysToReverse },
    });
    return { id, reference, status, daysToReverse: effect.daysToReverse };
  });
}

async function lockChange(trx, id, expectedVersion) {
  const c = await trx('change_requests').where({ id }).forUpdate().first();
  if (!c) throw notFound('Change request not found.');
  if (expectedVersion != null && Number(expectedVersion) !== c.version) {
    throw conflict('This change has been updated since you opened it. Refresh to see the latest.');
  }
  return c;
}

export async function changeManagerDecision(db, actor, changeId, input, audit) {
  return db.transaction(async (trx) => {
    const c = await lockChange(trx, changeId, input.version);
    if (c.status !== 'PENDING_MANAGER_APPROVAL') throw conflict('This change is not waiting for a manager.');
    const r = await trx('leave_requests').where({ id: c.leave_request_id }).first();
    const authority = await managerAuthority(trx, actor, {
      ...r,
      assigned_manager_id: c.assigned_manager_id,
    });
    if (!authority) throw forbidden('Only the employee’s manager (or their delegate) can act on this.');
    if (input.action === 'RETURN') throw badRequest('Managers approve or reject.');
    if (input.action === 'REJECT' && !input.comment) throw badRequest('Give a reason for rejecting.');
    const to = input.action === 'APPROVE' ? 'PENDING_HR_APPROVAL' : 'REJECTED_BY_MANAGER';
    await trx('change_requests')
      .where({ id: c.id })
      .update({ status: to, version: c.version + 1 });
    await recordAction(trx, {
      changeRequestId: c.id,
      stage: 'MANAGER',
      action: input.action,
      actorId: actor.id,
      ...authority,
      from: c.status,
      to,
      comment: input.comment,
    });
    await writeAudit(trx, {
      ...audit,
      action: `LEAVE_CANCELLATION_MANAGER_${input.action}D`,
      entityType: 'change_request',
      entityId: c.id,
      after: { status: to },
    });
    return { id: c.id, status: to };
  });
}

export async function changeHrDecision(db, actor, changeId, input, audit) {
  return db.transaction(async (trx) => {
    const c = await lockChange(trx, changeId, input.version);
    if (c.status !== 'PENDING_HR_APPROVAL') throw conflict('This change is not waiting for HR.');
    if (!actor.roles.includes('HR_OFFICER')) throw forbidden('Only HR Officers give final approval.');
    const r = await lockRequest(trx, c.leave_request_id);
    if (actor.id === r.employee_id) throw forbidden('You cannot approve changes to your own leave.');
    if (input.action === 'RETURN') throw badRequest('Approve or reject the cancellation.');
    if (input.action === 'REJECT' && !input.comment) throw badRequest('Give a reason for rejecting.');

    let to = 'REJECTED_BY_HR';
    let result = {};
    if (input.action === 'APPROVE') {
      requireState(r, 'APPROVED');
      const effect = await cancellationEffect(trx, r, c.cancel_reason_type, todayInLusaka());
      const policy = await trx('leave_policy_versions')
        .where({ id: r.policy_version_id })
        .first('consumes_balance');
      if (policy.consumes_balance && effect.daysToReverse > 0) {
        const reverse = chargeByYear(
          effect.untaken.map((d) => ({ date: d.leave_date, charged: Number(d.charged) })),
        );
        for (const [year, amount] of reverse) {
          await postLedger(trx, {
            employeeId: r.employee_id,
            leaveTypeId: r.leave_type_id,
            leaveYear: year,
            amount,
            entryType: 'REVERSAL',
            sourceType: 'CHANGE_REQUEST',
            sourceId: c.id,
            reason: `${c.reference}: ${c.cancel_reason_type === 'PLANS_CHANGED' ? 'cancelled' : 'recalled'} (${r.reference})`,
            createdBy: actor.id,
          });
        }
      }
      if (!effect.started) {
        await trx('leave_requests')
          .where({ id: r.id })
          .update({ status: 'CANCELLED', version: r.version + 1 });
      } else {
        // Leave cut short: record the actual last day. Days no longer taken are removed unless the
        // employee chose to return early, in which case they stay charged (policy 2.8).
        const keepCharged = c.cancel_reason_type === 'EARLY_RETURN_BY_CHOICE' && policy.consumes_balance;
        if (!keepCharged) {
          await trx('leave_request_days')
            .where({ leave_request_id: r.id })
            .andWhere('leave_date', '>', effect.newEndDate)
            .del();
        }
        await trx('leave_requests')
          .where({ id: r.id })
          .update({
            end_date: effect.newEndDate,
            end_portion: 'FULL',
            chargeable_days: keepCharged
              ? r.chargeable_days
              : round2(Number(r.chargeable_days) - effect.untakenDays),
            version: r.version + 1,
          });
      }
      await trx('change_requests').where({ id: c.id }).update({ days_to_reverse: effect.daysToReverse });
      to = 'APPROVED';
      result = { daysReturned: effect.daysToReverse, leaveStatus: effect.started ? 'APPROVED' : 'CANCELLED' };
    }
    await trx('change_requests')
      .where({ id: c.id })
      .update({ status: to, version: c.version + 1 });
    await recordAction(trx, {
      changeRequestId: c.id,
      stage: 'HR',
      action: input.action,
      actorId: actor.id,
      actingAs: 'HR_OFFICER',
      from: c.status,
      to,
      comment: input.comment,
    });
    await writeAudit(trx, {
      ...audit,
      action: `LEAVE_CANCELLATION_HR_${input.action}D`,
      entityType: 'change_request',
      entityId: c.id,
      after: { status: to, ...result },
    });
    return { id: c.id, status: to, ...result };
  });
}
