import fs from 'node:fs';
import express, { Router } from 'express';
import { z } from 'zod';
import { auditContext, can } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notify.service.js';
import { moduleHolders } from '../access/modules.js';
import {
  createEmployee,
  createEmployeeSchema,
  mapEmployeeUniqueError,
  updateEmployee,
  updateEmployeeSchema,
} from '../admin/employees.service.js';
import {
  asyncHandler,
  idParam,
  isoDate,
  optionalId,
  optionalText,
  requiredText,
} from '../../utils/validation.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { addDays } from '../leave/calendar.js';
import { candidateFileType, readStored, storeFile } from './files.js';

/*
 * Recruitment management (D114).
 *
 *   Hiring request   a manager asks for a position for their own team (or anyone with "Raise for
 *                    any department"); HR checks it and sends it to a director, who approves or
 *                    rejects it. Turned down at either step with a reason.
 *   Vacancy          opened by HR from an approved request; shown to staff under Open Positions
 *                    when it is internal.
 *   Candidate        recorded by HR (CV from email, an agency, a walk-in) or applying from inside;
 *                    moves Applied → Screening → Shortlisted → Interview → Offer → Hired, or
 *                    Rejected / Withdrawn. Every move is kept with its comment.
 *   Interview        a time, a place and a panel; each panel member gives a rating (1–5), a
 *                    recommendation and comments.
 *   Hire             a candidate who accepted an offer: a new employee is created in Employee
 *                    management on probation (an internal applicant's record is updated instead).
 *
 * Who sees what: the module's rights (Vacancies & candidates: View / Manage / Manage & hire), and
 * otherwise what someone is part of: the hiring manager sees their vacancy and its candidates, a
 * panel member sees the candidate they interview.
 */

const STAGES = [
  'APPLIED',
  'SCREENING',
  'SHORTLISTED',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
];
const ACTIVE = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'OFFER'];
const STAGE_LABEL = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Not Successful',
  WITHDRAWN: 'Withdrawn',
};
const MAX_FILES = 10;

const name = (f, l) => [f, l].filter(Boolean).join(' ') || null;
const ref = (prefix, id, at = todayInLusaka()) =>
  `${prefix}-${at.slice(0, 4)}-${String(id).padStart(6, '0')}`;
const isManager = (u) => Boolean(u.isManager || u.roles?.includes('DEPARTMENT_MANAGER'));
const EMAIL = { app: 'recruitment' };
const parseDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'must be a date and time')
  .refine((s) => !Number.isNaN(new Date(`${s}:00Z`).getTime()), 'must be a real date and time');

const requestSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  departmentId: z.coerce.number().int().positive(),
  branchId: optionalId,
  jobTitle: requiredText(120),
  positions: z.coerce.number().int().min(1).max(50).default(1),
  employmentType: z.enum(['PERMANENT', 'FIXED_TERM', 'TEMPORARY']),
  reason: z.enum(['NEW_POSITION', 'REPLACEMENT']),
  replacingEmployeeId: optionalId,
  justification: requiredText(4000),
  payGrade: optionalText(20),
  targetStartDate: isoDate.nullish().or(z.literal('').transform(() => null)),
});
const vacancySchema = z.object({
  hiringRequestId: optionalId,
  jobTitle: requiredText(120),
  companyId: z.coerce.number().int().positive(),
  departmentId: z.coerce.number().int().positive(),
  branchId: optionalId,
  employmentType: z.enum(['PERMANENT', 'FIXED_TERM', 'TEMPORARY']),
  positions: z.coerce.number().int().min(1).max(50).default(1),
  description: optionalText(8000),
  requirements: optionalText(8000),
  closingDate: isoDate.nullish().or(z.literal('').transform(() => null)),
  isInternal: z.boolean().default(true),
  hiringManagerId: optionalId,
  status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED', 'FILLED']).optional(),
});
const candidateSchema = z.object({
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
  phone: optionalText(40),
  source: z.enum(['EMAIL', 'AGENCY', 'WALK_IN', 'REFERRAL', 'OTHER']),
  notes: optionalText(4000),
});

export function recruitmentRoutes({ db, config, logger }) {
  const router = Router();
  const maxBytes = config.documents.maxBytes;
  const rights = (u) => ({
    raise: can(u, 'recruitment.raise_any') || isManager(u),
    raiseAny: can(u, 'recruitment.raise_any'),
    review: can(u, 'recruitment.review'),
    approve: can(u, 'recruitment.approve'),
    requestsAll: can(u, 'recruitment.requests_all'),
    view: can(u, 'recruitment.view'),
    manage: can(u, 'recruitment.manage'),
    hire: can(u, 'recruitment.hire'),
    usersAdmin: can(u, 'recruitment.users'),
    rolesAdmin: can(u, 'recruitment.roles'),
    auditAdmin: can(u, 'recruitment.audit'),
  });
  const mustManage = (req) => {
    if (!can(req.user, 'recruitment.manage')) throw forbidden('You cannot change vacancies or candidates.');
  };

  // ── Who the signed-in person is here ─────────────────────────────────────────────────────────
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const r = rights(req.user);
      const me = req.user.id;
      const count = async (q) => Number((await q.count({ n: '*' }).first()).n);
      res.json({
        ...r,
        counts: {
          toReview: r.review ? await count(db('hiring_requests').where({ status: 'PENDING_REVIEW' })) : 0,
          toApprove: r.approve ? await count(db('hiring_requests').where({ status: 'PENDING_APPROVAL' })) : 0,
          feedbackDue: await count(
            db('interview_panel as p')
              .join('interviews as i', 'i.id', 'p.interview_id')
              .where({ 'p.employee_id': me, 'i.status': 'SCHEDULED' })
              .whereNull('p.submitted_at'),
          ),
          myVacancies: await count(
            db('vacancies').where({ hiring_manager_id: me }).whereIn('status', ['OPEN', 'ON_HOLD']),
          ),
        },
      });
    }),
  );

  // Choices for the forms: the organisation and active employees.
  router.get(
    '/options',
    asyncHandler(async (req, res) => {
      const [companies, departments, branches, employees] = await Promise.all([
        db('companies').where({ is_active: true }).orderBy('name').select('id', 'name'),
        db('departments').where({ is_active: true }).orderBy('name').select('id', 'name', 'company_id'),
        db('stock_branches').where({ is_active: true }).orderBy('name').select('id', 'name', 'company_id'),
        db('employees as e')
          .leftJoin('departments as d', 'd.id', 'e.department_id')
          .where('e.status', 'ACTIVE')
          .orderBy(['e.first_name', 'e.last_name'])
          .select('e.id', 'e.first_name', 'e.last_name', 'e.job_title', 'd.name as department'),
      ]);
      const me = await db('employees').where({ id: req.user.id }).first('company_id', 'department_id');
      res.json({
        companies,
        departments: departments.map((d) => ({ id: d.id, name: d.name, companyId: d.company_id })),
        branches: branches.map((b) => ({ id: b.id, name: b.name, companyId: b.company_id })),
        employees: employees.map((e) => ({
          id: e.id,
          name: name(e.first_name, e.last_name),
          jobTitle: e.job_title,
          department: e.department,
        })),
        mine: { companyId: me?.company_id ?? null, departmentId: me?.department_id ?? null },
      });
    }),
  );

  // ── Hiring requests ──────────────────────────────────────────────────────────────────────────
  const requestRows = () =>
    db('hiring_requests as h')
      .join('companies as co', 'co.id', 'h.company_id')
      .join('departments as d', 'd.id', 'h.department_id')
      .leftJoin('stock_branches as b', 'b.id', 'h.branch_id')
      .join('employees as rq', 'rq.id', 'h.requested_by')
      .leftJoin('employees as rv', 'rv.id', 'h.reviewed_by')
      .leftJoin('employees as dc', 'dc.id', 'h.decided_by')
      .leftJoin('employees as rp', 'rp.id', 'h.replacing_employee_id')
      .leftJoin('vacancies as v', 'v.hiring_request_id', 'h.id')
      .select(
        'h.*',
        'co.name as company',
        'd.name as department',
        'b.name as branch',
        'rq.first_name as rq_first',
        'rq.last_name as rq_last',
        'rv.first_name as rv_first',
        'rv.last_name as rv_last',
        'dc.first_name as dc_first',
        'dc.last_name as dc_last',
        'rp.first_name as rp_first',
        'rp.last_name as rp_last',
        'v.id as vacancy_id',
        'v.reference as vacancy_reference',
      );
  const requestView = (h, u) => ({
    id: h.id,
    reference: h.reference,
    company: h.company,
    companyId: h.company_id,
    department: h.department,
    departmentId: h.department_id,
    branch: h.branch,
    branchId: h.branch_id,
    jobTitle: h.job_title,
    positions: h.positions,
    employmentType: h.employment_type,
    reason: h.reason,
    replacing: name(h.rp_first, h.rp_last),
    justification: h.justification,
    payGrade: h.pay_grade,
    targetStartDate: h.target_start_date,
    status: h.status,
    requestedBy: { id: h.requested_by, name: name(h.rq_first, h.rq_last) },
    requestedAt: h.created_at,
    review: h.reviewed_at
      ? { by: name(h.rv_first, h.rv_last), at: h.reviewed_at, comment: h.review_comment }
      : null,
    decision: h.decided_at
      ? { by: name(h.dc_first, h.dc_last), at: h.decided_at, comment: h.decision_comment }
      : null,
    vacancy: h.vacancy_id ? { id: h.vacancy_id, reference: h.vacancy_reference } : null,
    ...(u
      ? {
          can: {
            review: h.status === 'PENDING_REVIEW' && can(u, 'recruitment.review') && h.requested_by !== u.id,
            decide:
              h.status === 'PENDING_APPROVAL' && can(u, 'recruitment.approve') && h.requested_by !== u.id,
            cancel: ['PENDING_REVIEW', 'PENDING_APPROVAL'].includes(h.status) && h.requested_by === u.id,
            openVacancy: h.status === 'APPROVED' && !h.vacancy_id && can(u, 'recruitment.manage'),
          },
        }
      : {}),
  });
  const seesAllRequests = (u) =>
    can(u, 'recruitment.requests_all') || can(u, 'recruitment.review') || can(u, 'recruitment.approve');

  router.get(
    '/requests',
    asyncHandler(async (req, res) => {
      const all = seesAllRequests(req.user) && req.query.scope !== 'mine';
      const rows = await requestRows()
        .modify((q) => !all && q.where('h.requested_by', req.user.id))
        .modify((q) => req.query.status && q.where('h.status', String(req.query.status)))
        .orderBy('h.id', 'desc')
        .limit(500);
      res.json({ items: rows.map((h) => requestView(h)), all });
    }),
  );

  async function loadRequest(id, u) {
    const h = await requestRows().where('h.id', id).first();
    if (!h || (h.requested_by !== u.id && !seesAllRequests(u))) throw notFound('Hiring request not found.');
    return h;
  }
  router.get(
    '/requests/:id',
    asyncHandler(async (req, res) => {
      res.json(requestView(await loadRequest(idParam(req), req.user), req.user));
    }),
  );

  router.post(
    '/requests',
    asyncHandler(async (req, res) => {
      const r = rights(req.user);
      if (!r.raise) throw forbidden('Only managers can ask for a new position.');
      const input = requestSchema.parse(req.body);
      const dept = await db('departments').where({ id: input.departmentId, is_active: true }).first();
      if (!dept || dept.company_id !== input.companyId)
        throw badRequest('Choose a department of the company.');
      if (!r.raiseAny) {
        const me = await db('employees').where({ id: req.user.id }).first('department_id');
        if (me?.department_id !== input.departmentId) {
          throw forbidden('You can ask for positions in your own department only.');
        }
      }
      if (input.branchId) {
        const b = await db('stock_branches').where({ id: input.branchId }).first('company_id');
        if (!b || b.company_id !== input.companyId) throw badRequest('Choose a branch of the company.');
      }
      if (input.reason === 'REPLACEMENT' && !input.replacingEmployeeId) {
        throw badRequest('Choose the employee being replaced.');
      }
      const id = await db.transaction(async (trx) => {
        const [newId] = await trx('hiring_requests').insert({
          company_id: input.companyId,
          department_id: input.departmentId,
          branch_id: input.branchId,
          job_title: input.jobTitle,
          positions: input.positions,
          employment_type: input.employmentType,
          reason: input.reason,
          replacing_employee_id: input.reason === 'REPLACEMENT' ? input.replacingEmployeeId : null,
          justification: input.justification,
          pay_grade: input.payGrade,
          target_start_date: input.targetStartDate,
          requested_by: req.user.id,
        });
        const reference = ref('HQ', newId);
        await trx('hiring_requests').where({ id: newId }).update({ reference });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'HIRING_REQUEST_SUBMITTED',
          entityType: 'hiring_request',
          entityId: newId,
          after: { reference, ...input },
        });
        const who = name(req.user.firstName, req.user.lastName);
        await notify(trx, {
          recipients: await moduleHolders(trx, 'recruitment', ['recruitment.review'], [req.user.id]),
          event: 'HIRING_REQUEST_TO_REVIEW',
          title: `Hiring request to check: ${input.jobTitle}`,
          body: `${who} asked for ${input.positions} × ${input.jobTitle} in ${dept.name}.`,
          link: `/recruitment/requests/${newId}`,
          entityType: 'hiring_request',
          entityId: newId,
          email: {
            ...EMAIL,
            subject: `Hiring request to check: ${reference}`,
            heading: 'Hiring request to check',
            intro: `${who} has asked for a new position.`,
            rows: [
              ['Reference', reference],
              ['Position', input.jobTitle],
              ['Department', dept.name],
              ['Positions', String(input.positions)],
            ],
            action: 'Please check it and send it to a director, or turn it down.',
          },
        });
        return newId;
      });
      res.status(201).json({ id });
    }),
  );

  const decisionSchema = z.object({
    action: z.enum(['FORWARD', 'APPROVE', 'REJECT']),
    comment: optionalText(2000),
  });
  async function decide(req, stage) {
    const id = idParam(req);
    const { action, comment } = decisionSchema.parse(req.body);
    if (action === 'REJECT' && !comment) throw badRequest('Give a reason for turning it down.');
    await db.transaction(async (trx) => {
      const h = await trx('hiring_requests').where({ id }).forUpdate().first();
      if (!h) throw notFound('Hiring request not found.');
      if (h.requested_by === req.user.id) throw forbidden('You cannot decide your own request.');
      const review = stage === 'review';
      if (review && !can(req.user, 'recruitment.review')) throw forbidden();
      if (!review && !can(req.user, 'recruitment.approve')) throw forbidden();
      if (h.status !== (review ? 'PENDING_REVIEW' : 'PENDING_APPROVAL')) {
        throw conflict('This request has already moved on. The page has been refreshed.');
      }
      if (review && action === 'APPROVE') throw badRequest('Send it to a director, or turn it down.');
      if (!review && action === 'FORWARD') throw badRequest('Approve it, or turn it down.');
      const status =
        action === 'REJECT' ? 'REJECTED' : action === 'FORWARD' ? 'PENDING_APPROVAL' : 'APPROVED';
      await trx('hiring_requests')
        .where({ id })
        .update(
          review
            ? { status, reviewed_by: req.user.id, reviewed_at: trx.fn.now(), review_comment: comment }
            : { status, decided_by: req.user.id, decided_at: trx.fn.now(), decision_comment: comment },
        );
      await writeAudit(trx, {
        ...auditContext(req),
        action: `HIRING_REQUEST_${status === 'PENDING_APPROVAL' ? 'FORWARDED' : status}`,
        entityType: 'hiring_request',
        entityId: id,
        before: { status: h.status },
        after: { status, comment },
      });
      const link = `/recruitment/requests/${id}`;
      const rows = [
        ['Reference', h.reference],
        ['Position', h.job_title],
        ['Positions', String(h.positions)],
      ];
      if (status === 'PENDING_APPROVAL') {
        await notify(trx, {
          recipients: await moduleHolders(trx, 'recruitment', ['recruitment.approve'], [h.requested_by]),
          event: 'HIRING_REQUEST_TO_APPROVE',
          title: `Hiring request to approve: ${h.job_title}`,
          body: `${h.reference}: checked by HR and waiting for a director.`,
          link,
          entityType: 'hiring_request',
          entityId: id,
          email: {
            ...EMAIL,
            subject: `Hiring request to approve: ${h.reference}`,
            heading: 'Hiring request to approve',
            intro: 'HR has checked this request for a new position. It needs a director’s decision.',
            rows,
            action: 'Please approve it or turn it down in the recruitment system.',
          },
        });
      }
      const outcome = { APPROVED: 'approved', REJECTED: 'not approved', PENDING_APPROVAL: null }[status];
      if (outcome) {
        await notify(trx, {
          recipients: [h.requested_by],
          event: `HIRING_REQUEST_${status}`,
          title: `Your hiring request was ${outcome}: ${h.job_title}`,
          body:
            status === 'APPROVED'
              ? `${h.reference}: HR will open the vacancy.`
              : `${h.reference}: ${comment ?? 'see the reason in the system.'}`,
          link,
          entityType: 'hiring_request',
          entityId: id,
          email: {
            ...EMAIL,
            subject: `Your hiring request was ${outcome}: ${h.reference}`,
            heading: `Hiring request ${outcome}`,
            intro:
              status === 'APPROVED'
                ? 'Your request for a new position was approved. HR will open the vacancy.'
                : `Your request for a new position was not approved${review ? ' by HR' : ''}.`,
            rows: [...rows, ...(comment ? [['Comment', comment]] : [])],
          },
        });
      }
    });
    return id;
  }
  router.post(
    '/requests/:id/review',
    asyncHandler(async (req, res) => res.json({ id: await decide(req, 'review') })),
  );
  router.post(
    '/requests/:id/decide',
    asyncHandler(async (req, res) => res.json({ id: await decide(req, 'decide') })),
  );
  router.post(
    '/requests/:id/cancel',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const h = await trx('hiring_requests').where({ id }).forUpdate().first();
        if (!h || h.requested_by !== req.user.id) throw notFound('Hiring request not found.');
        if (!['PENDING_REVIEW', 'PENDING_APPROVAL'].includes(h.status)) {
          throw conflict('Only a request still being checked can be cancelled.');
        }
        await trx('hiring_requests').where({ id }).update({ status: 'CANCELLED' });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'HIRING_REQUEST_CANCELLED',
          entityType: 'hiring_request',
          entityId: id,
          before: { status: h.status },
        });
      });
      res.json({ id });
    }),
  );

  // ── Vacancies ────────────────────────────────────────────────────────────────────────────────
  const vacancyRows = () =>
    db('vacancies as v')
      .join('companies as co', 'co.id', 'v.company_id')
      .join('departments as d', 'd.id', 'v.department_id')
      .leftJoin('stock_branches as b', 'b.id', 'v.branch_id')
      .leftJoin('employees as hm', 'hm.id', 'v.hiring_manager_id')
      .leftJoin('hiring_requests as h', 'h.id', 'v.hiring_request_id')
      .select(
        'v.*',
        'co.name as company',
        'd.name as department',
        'b.name as branch',
        'hm.first_name as hm_first',
        'hm.last_name as hm_last',
        'h.reference as request_reference',
      );
  const vacancyView = (v, counts = {}) => ({
    id: v.id,
    reference: v.reference,
    jobTitle: v.job_title,
    company: v.company,
    companyId: v.company_id,
    department: v.department,
    departmentId: v.department_id,
    branch: v.branch,
    branchId: v.branch_id,
    employmentType: v.employment_type,
    positions: v.positions,
    description: v.description,
    requirements: v.requirements,
    closingDate: v.closing_date,
    isInternal: Boolean(v.is_internal),
    status: v.status,
    hiringManager: v.hiring_manager_id
      ? { id: v.hiring_manager_id, name: name(v.hm_first, v.hm_last) }
      : null,
    hiringRequest: v.hiring_request_id ? { id: v.hiring_request_id, reference: v.request_reference } : null,
    createdAt: v.created_at,
    candidates: counts,
  });
  async function stageCounts(ids) {
    if (!ids.length) return new Map();
    const rows = await db('candidates')
      .whereIn('vacancy_id', ids)
      .groupBy('vacancy_id', 'stage')
      .select('vacancy_id', 'stage')
      .count({ n: '*' });
    const out = new Map();
    for (const r of rows) {
      const m = out.get(r.vacancy_id) ?? { total: 0, active: 0 };
      m[r.stage] = Number(r.n);
      m.total += Number(r.n);
      if (ACTIVE.includes(r.stage)) m.active += Number(r.n);
      out.set(r.vacancy_id, m);
    }
    return out;
  }
  const seesVacancy = async (u, v) =>
    can(u, 'recruitment.view') ||
    v.hiring_manager_id === u.id ||
    Boolean(
      await db('interview_panel as p')
        .join('interviews as i', 'i.id', 'p.interview_id')
        .join('candidates as c', 'c.id', 'i.candidate_id')
        .where({ 'c.vacancy_id': v.id, 'p.employee_id': u.id })
        .first('p.interview_id'),
    );

  router.get(
    '/vacancies',
    asyncHandler(async (req, res) => {
      const all = can(req.user, 'recruitment.view');
      const rows = await vacancyRows()
        .modify((q) => !all && q.where('v.hiring_manager_id', req.user.id))
        .modify((q) => req.query.status && q.where('v.status', String(req.query.status)))
        .orderBy('v.id', 'desc')
        .limit(500);
      const counts = await stageCounts(rows.map((v) => v.id));
      res.json({
        items: rows.map((v) => vacancyView(v, counts.get(v.id) ?? { total: 0, active: 0 })),
        canManage: can(req.user, 'recruitment.manage'),
      });
    }),
  );

  async function checkOrg(trx, input) {
    const dept = await trx('departments').where({ id: input.departmentId }).first('company_id', 'name');
    if (!dept || dept.company_id !== input.companyId) throw badRequest('Choose a department of the company.');
    if (input.branchId) {
      const b = await trx('stock_branches').where({ id: input.branchId }).first('company_id');
      if (!b || b.company_id !== input.companyId) throw badRequest('Choose a branch of the company.');
    }
    if (input.hiringManagerId) {
      const m = await trx('employees').where({ id: input.hiringManagerId, status: 'ACTIVE' }).first('id');
      if (!m) throw badRequest('Choose an active employee as the hiring manager.');
    }
    return dept;
  }

  router.post(
    '/vacancies',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const input = vacancySchema.parse(req.body);
      const id = await db.transaction(async (trx) => {
        let request = null;
        if (input.hiringRequestId) {
          request = await trx('hiring_requests').where({ id: input.hiringRequestId }).forUpdate().first();
          if (!request || request.status !== 'APPROVED')
            throw badRequest('That hiring request is not approved.');
          if (await trx('vacancies').where({ hiring_request_id: request.id }).first('id')) {
            throw conflict('A vacancy is already open for that hiring request.');
          }
        }
        await checkOrg(trx, input);
        const [newId] = await trx('vacancies').insert({
          hiring_request_id: input.hiringRequestId,
          job_title: input.jobTitle,
          company_id: input.companyId,
          department_id: input.departmentId,
          branch_id: input.branchId,
          employment_type: input.employmentType,
          positions: input.positions,
          description: input.description,
          requirements: input.requirements,
          closing_date: input.closingDate,
          is_internal: input.isInternal,
          hiring_manager_id: input.hiringManagerId ?? request?.requested_by ?? null,
          status: 'OPEN',
          created_by: req.user.id,
        });
        const reference = ref('VAC', newId);
        await trx('vacancies').where({ id: newId }).update({ reference });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'VACANCY_OPENED',
          entityType: 'vacancy',
          entityId: newId,
          after: { reference, ...input },
        });
        const manager = input.hiringManagerId ?? request?.requested_by ?? null;
        if (manager && manager !== req.user.id) {
          await notify(trx, {
            recipients: [manager],
            event: 'VACANCY_OPENED',
            title: `Vacancy opened: ${input.jobTitle}`,
            body: `${reference}. You are the hiring manager: you will see its candidates here.`,
            link: `/recruitment/vacancies/${newId}`,
            entityType: 'vacancy',
            entityId: newId,
            email: {
              ...EMAIL,
              subject: `Vacancy opened: ${reference}`,
              heading: 'Vacancy opened',
              intro: `HR has opened the vacancy for ${input.jobTitle}. You are its hiring manager.`,
              rows: [
                ['Reference', reference],
                ['Position', input.jobTitle],
                ['Closing Date', input.closingDate ?? 'Not set'],
              ],
              action: 'You can follow its candidates and give interview feedback in the recruitment system.',
            },
          });
        }
        return newId;
      });
      res.status(201).json({ id });
    }),
  );

  async function loadVacancy(id, u) {
    const v = await vacancyRows().where('v.id', id).first();
    if (!v || !(await seesVacancy(u, v))) throw notFound('Vacancy not found.');
    return v;
  }

  router.get(
    '/vacancies/:id',
    asyncHandler(async (req, res) => {
      const v = await loadVacancy(idParam(req), req.user);
      const full = can(req.user, 'recruitment.view') || v.hiring_manager_id === req.user.id;
      const candidates = await db('candidates as c')
        .where('c.vacancy_id', v.id)
        .modify(
          (q) =>
            !full &&
            q.whereExists(
              db('interview_panel as p')
                .join('interviews as i', 'i.id', 'p.interview_id')
                .whereRaw('i.candidate_id = c.id')
                .where('p.employee_id', req.user.id),
            ),
        )
        .orderBy('c.id')
        .select('c.*');
      const files = candidates.length
        ? await db('candidate_files')
            .whereIn(
              'candidate_id',
              candidates.map((c) => c.id),
            )
            .whereNull('deleted_at')
            .groupBy('candidate_id')
            .select('candidate_id')
            .count({ n: '*' })
        : [];
      const F = new Map(files.map((f) => [f.candidate_id, Number(f.n)]));
      const counts = (await stageCounts([v.id])).get(v.id) ?? { total: 0, active: 0 };
      res.json({
        ...vacancyView(v, counts),
        canManage: can(req.user, 'recruitment.manage'),
        items: candidates.map((c) => ({
          id: c.id,
          name: name(c.first_name, c.last_name),
          firstName: c.first_name,
          lastName: c.last_name,
          email: c.email,
          phone: c.phone,
          source: c.source,
          stage: c.stage,
          internal: Boolean(c.employee_id),
          files: F.get(c.id) ?? 0,
          appliedAt: c.created_at,
        })),
      });
    }),
  );

  router.put(
    '/vacancies/:id',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const id = idParam(req);
      const input = vacancySchema.parse(req.body);
      await db.transaction(async (trx) => {
        const before = await trx('vacancies').where({ id }).forUpdate().first();
        if (!before) throw notFound('Vacancy not found.');
        await checkOrg(trx, input);
        const row = {
          job_title: input.jobTitle,
          company_id: input.companyId,
          department_id: input.departmentId,
          branch_id: input.branchId,
          employment_type: input.employmentType,
          positions: input.positions,
          description: input.description,
          requirements: input.requirements,
          closing_date: input.closingDate,
          is_internal: input.isInternal,
          hiring_manager_id: input.hiringManagerId,
          ...(input.status ? { status: input.status } : {}),
        };
        await trx('vacancies').where({ id }).update(row);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'VACANCY_UPDATED',
          entityType: 'vacancy',
          entityId: id,
          before: {
            jobTitle: before.job_title,
            status: before.status,
            closingDate: before.closing_date,
            positions: before.positions,
          },
          after: input,
        });
      });
      res.json({ id });
    }),
  );

  // ── Candidates ───────────────────────────────────────────────────────────────────────────────
  async function addEvent(trx, candidateId, from, to, comment, actorId) {
    await trx('candidate_events').insert({
      candidate_id: candidateId,
      from_stage: from,
      to_stage: to,
      comment: comment ?? null,
      actor_id: actorId,
    });
  }

  router.post(
    '/vacancies/:id/candidates',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const vacancyId = idParam(req);
      const input = candidateSchema.parse(req.body);
      const id = await db.transaction(async (trx) => {
        const v = await trx('vacancies').where({ id: vacancyId }).forUpdate().first();
        if (!v) throw notFound('Vacancy not found.');
        if (['CLOSED', 'FILLED'].includes(v.status)) throw conflict('This vacancy is closed.');
        if (input.email) {
          const dup = await trx('candidates')
            .where({ vacancy_id: vacancyId, email: input.email })
            .first('id');
          if (dup) throw conflict('A candidate with this email has already applied for this vacancy.');
        }
        const [newId] = await trx('candidates').insert({
          vacancy_id: vacancyId,
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email,
          phone: input.phone,
          source: input.source,
          notes: input.notes,
          stage: 'APPLIED',
          created_by: req.user.id,
        });
        await addEvent(trx, newId, null, 'APPLIED', null, req.user.id);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'CANDIDATE_ADDED',
          entityType: 'candidate',
          entityId: newId,
          after: { vacancy: v.reference, name: name(input.firstName, input.lastName), source: input.source },
        });
        return newId;
      });
      res.status(201).json({ id });
    }),
  );

  /** A candidate, and how the viewer relates to them. */
  async function loadCandidate(id, u) {
    const c = await db('candidates as c')
      .join('vacancies as v', 'v.id', 'c.vacancy_id')
      .where('c.id', id)
      .first(
        'c.*',
        'v.hiring_manager_id',
        'v.job_title',
        'v.reference as vacancy_reference',
        'v.status as vacancy_status',
      );
    if (!c) throw notFound('Candidate not found.');
    const panel = Boolean(
      await db('interview_panel as p')
        .join('interviews as i', 'i.id', 'p.interview_id')
        .where({ 'i.candidate_id': id, 'p.employee_id': u.id })
        .first('p.interview_id'),
    );
    const sees = can(u, 'recruitment.view') || c.hiring_manager_id === u.id || panel;
    if (!sees) throw notFound('Candidate not found.');
    return { c, panel };
  }

  router.get(
    '/candidates/:id',
    asyncHandler(async (req, res) => {
      const { c } = await loadCandidate(idParam(req), req.user);
      const [files, events, interviews] = await Promise.all([
        db('candidate_files as f')
          .join('employees as e', 'e.id', 'f.uploaded_by')
          .where('f.candidate_id', c.id)
          .whereNull('f.deleted_at')
          .orderBy('f.id')
          .select('f.*', 'e.first_name', 'e.last_name'),
        db('candidate_events as x')
          .join('employees as e', 'e.id', 'x.actor_id')
          .where('x.candidate_id', c.id)
          .orderBy('x.id')
          .select('x.*', 'e.first_name', 'e.last_name'),
        db('interviews').where({ candidate_id: c.id }).orderBy('scheduled_at'),
      ]);
      const panel = interviews.length
        ? await db('interview_panel as p')
            .join('employees as e', 'e.id', 'p.employee_id')
            .whereIn(
              'p.interview_id',
              interviews.map((i) => i.id),
            )
            .select('p.*', 'e.first_name', 'e.last_name')
        : [];
      const manage = can(req.user, 'recruitment.manage');
      res.json({
        id: c.id,
        name: name(c.first_name, c.last_name),
        firstName: c.first_name,
        lastName: c.last_name,
        email: c.email,
        phone: c.phone,
        source: c.source,
        stage: c.stage,
        notes: c.notes,
        internal: Boolean(c.employee_id),
        employeeId: c.employee_id,
        hiredEmployeeId: c.hired_employee_id,
        appliedAt: c.created_at,
        vacancy: {
          id: c.vacancy_id,
          reference: c.vacancy_reference,
          jobTitle: c.job_title,
          status: c.vacancy_status,
        },
        offer: c.offer_status
          ? { startDate: c.offer_start_date, notes: c.offer_notes, status: c.offer_status }
          : null,
        files: files.map((f) => ({
          id: f.id,
          kind: f.kind,
          name: f.original_name,
          type: f.mime_type,
          sizeBytes: f.size_bytes,
          uploadedBy: name(f.first_name, f.last_name),
          uploadedAt: f.created_at,
        })),
        history: events.map((x) => ({
          from: x.from_stage,
          to: x.to_stage,
          comment: x.comment,
          by: name(x.first_name, x.last_name),
          at: x.created_at,
        })),
        interviews: interviews.map((i) => ({
          id: i.id,
          scheduledAt: i.scheduled_at,
          location: i.location,
          notes: i.notes,
          status: i.status,
          panel: panel
            .filter((p) => p.interview_id === i.id)
            .map((p) => ({
              employeeId: p.employee_id,
              name: name(p.first_name, p.last_name),
              rating: p.rating,
              recommendation: p.recommendation,
              comments: p.comments,
              submittedAt: p.submitted_at,
            })),
          myFeedbackDue:
            i.status === 'SCHEDULED' &&
            panel.some((p) => p.interview_id === i.id && p.employee_id === req.user.id && !p.submitted_at),
        })),
        can: {
          manage,
          hire: can(req.user, 'recruitment.hire') && c.stage === 'OFFER' && c.offer_status === 'ACCEPTED',
          upload: manage,
        },
      });
    }),
  );

  router.put(
    '/candidates/:id',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const id = idParam(req);
      const input = candidateSchema.parse(req.body);
      await db.transaction(async (trx) => {
        const c = await trx('candidates').where({ id }).forUpdate().first();
        if (!c) throw notFound('Candidate not found.');
        await trx('candidates')
          .where({ id })
          .update({
            first_name: input.firstName,
            last_name: input.lastName,
            email: input.email,
            phone: input.phone,
            source: c.employee_id ? 'INTERNAL' : input.source,
            notes: input.notes,
          });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'CANDIDATE_UPDATED',
          entityType: 'candidate',
          entityId: id,
          after: input,
        });
      });
      res.json({ id });
    }),
  );

  const stageSchema = z.object({
    stage: z.enum(['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN']),
    comment: optionalText(2000),
  });
  router.post(
    '/candidates/:id/stage',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const id = idParam(req);
      const { stage, comment } = stageSchema.parse(req.body);
      if (stage === 'REJECTED' && !comment)
        throw badRequest('Give a reason (kept in the candidate’s history).');
      await db.transaction(async (trx) => {
        const c = await trx('candidates as c')
          .join('vacancies as v', 'v.id', 'c.vacancy_id')
          .where('c.id', id)
          .forUpdate()
          .first('c.*', 'v.job_title');
        if (!c) throw notFound('Candidate not found.');
        if (c.stage === 'HIRED') throw conflict('This candidate has been hired.');
        if (c.stage === stage) return;
        await trx('candidates').where({ id }).update({ stage });
        await addEvent(trx, id, c.stage, stage, comment, req.user.id);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'CANDIDATE_STAGE_CHANGED',
          entityType: 'candidate',
          entityId: id,
          before: { stage: c.stage },
          after: { stage, comment },
        });
        // An internal applicant hears when their application ends (the reason is not sent).
        if (c.employee_id && stage === 'REJECTED') {
          await notify(trx, {
            recipients: [c.employee_id],
            event: 'APPLICATION_UNSUCCESSFUL',
            title: `Your application for ${c.job_title}`,
            body: 'Thank you for applying. On this occasion your application was not successful.',
            link: '/recruitment/applications',
            entityType: 'candidate',
            entityId: id,
            email: {
              ...EMAIL,
              subject: `Your application for ${c.job_title}`,
              heading: 'Your application',
              intro: `Thank you for applying for ${c.job_title}. On this occasion your application was not successful.`,
              action: 'HR will be glad to talk it through with you.',
            },
          });
        }
      });
      res.json({ id });
    }),
  );

  const offerSchema = z.object({
    startDate: isoDate,
    notes: optionalText(2000),
    status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED']),
  });
  router.post(
    '/candidates/:id/offer',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const id = idParam(req);
      const input = offerSchema.parse(req.body);
      await db.transaction(async (trx) => {
        const c = await trx('candidates').where({ id }).forUpdate().first();
        if (!c) throw notFound('Candidate not found.');
        if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(c.stage))
          throw conflict('This candidate is no longer active.');
        await trx('candidates').where({ id }).update({
          stage: 'OFFER',
          offer_start_date: input.startDate,
          offer_notes: input.notes,
          offer_status: input.status,
        });
        if (c.stage !== 'OFFER') await addEvent(trx, id, c.stage, 'OFFER', 'Offer made', req.user.id);
        if (input.status !== 'PENDING' && input.status !== c.offer_status) {
          await addEvent(
            trx,
            id,
            'OFFER',
            'OFFER',
            input.status === 'ACCEPTED' ? 'Offer accepted' : 'Offer declined',
            req.user.id,
          );
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'CANDIDATE_OFFER_RECORDED',
          entityType: 'candidate',
          entityId: id,
          before: { stage: c.stage, offerStatus: c.offer_status },
          after: input,
        });
      });
      res.json({ id });
    }),
  );

  // Hire: a new employee in Employee Management, or an internal applicant's record moved to the
  // new position. The vacancy is marked filled once all its positions are.
  const hireSchema = z.object({
    employeeNumber: z.string().trim().max(30).optional(),
    email: z.string().trim().max(254).nullish(),
    jobTitle: requiredText(120),
    companyId: z.coerce.number().int().positive(),
    departmentId: z.coerce.number().int().positive(),
    branchId: optionalId,
    lineManagerId: optionalId,
    employmentStartDate: isoDate,
    employmentType: z.enum(['PERMANENT', 'FIXED_TERM', 'TEMPORARY']),
    contractEndDate: isoDate.nullish().or(z.literal('').transform(() => null)),
    probationEndDate: isoDate.nullish().or(z.literal('').transform(() => null)),
  });
  router.post(
    '/candidates/:id/hire',
    asyncHandler(async (req, res) => {
      if (!can(req.user, 'recruitment.hire')) throw forbidden('You cannot hire candidates.');
      const id = idParam(req);
      const input = hireSchema.parse(req.body);
      try {
        const out = await db.transaction(async (trx) => {
          const c = await trx('candidates as c')
            .join('vacancies as v', 'v.id', 'c.vacancy_id')
            .where('c.id', id)
            .forUpdate()
            .first(
              'c.*',
              'v.positions',
              'v.reference as vacancy_reference',
              'v.hiring_manager_id',
              'v.job_title as vacancy_title',
            );
          if (!c) throw notFound('Candidate not found.');
          if (c.stage !== 'OFFER' || c.offer_status !== 'ACCEPTED') {
            throw conflict('Record the offer as accepted before hiring.');
          }
          const audit = { ...auditContext(req), historyReason: `Hired through ${c.vacancy_reference}` };
          const record = {
            jobTitle: input.jobTitle,
            companyId: input.companyId,
            departmentId: input.departmentId,
            branchId: input.branchId ?? null,
            lineManagerId: input.lineManagerId ?? null,
            employmentType: input.employmentType,
            contractEndDate: input.contractEndDate ?? null,
            probationEndDate: input.probationEndDate ?? null,
            probationStatus: input.probationEndDate ? 'ON_PROBATION' : null,
          };
          let employeeId = c.employee_id;
          if (employeeId) {
            // An internal applicant moves to the new position; their start date stays.
            await updateEmployee(trx, employeeId, updateEmployeeSchema.parse(record), audit);
          } else {
            if (!input.employeeNumber) throw badRequest('Give the new employee’s number.');
            employeeId = await createEmployee(
              trx,
              createEmployeeSchema.parse({
                ...record,
                employeeNumber: input.employeeNumber,
                firstName: c.first_name,
                lastName: c.last_name,
                email: input.email ?? c.email,
                employmentStartDate: input.employmentStartDate,
              }),
              audit,
            );
          }
          await trx('candidates').where({ id }).update({ stage: 'HIRED', hired_employee_id: employeeId });
          await addEvent(
            trx,
            id,
            'OFFER',
            'HIRED',
            `Hired, starting ${input.employmentStartDate}`,
            req.user.id,
          );
          const hired = await trx('candidates')
            .where({ vacancy_id: c.vacancy_id, stage: 'HIRED' })
            .count({ n: '*' })
            .first();
          if (Number(hired.n) >= c.positions) {
            await trx('vacancies').where({ id: c.vacancy_id }).update({ status: 'FILLED' });
          }
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'CANDIDATE_HIRED',
            entityType: 'candidate',
            entityId: id,
            after: { employeeId, vacancy: c.vacancy_reference, startDate: input.employmentStartDate },
          });
          const who = name(c.first_name, c.last_name);
          await notify(trx, {
            recipients: [c.hiring_manager_id, input.lineManagerId].filter((x) => x && x !== req.user.id),
            event: 'CANDIDATE_HIRED',
            title: `${who} hired as ${input.jobTitle}`,
            body: `Starting ${input.employmentStartDate}.`,
            link: `/recruitment/candidates/${id}`,
            entityType: 'candidate',
            entityId: id,
            email: {
              ...EMAIL,
              subject: `${who} hired as ${input.jobTitle}`,
              heading: 'Candidate hired',
              intro: `${who} has been hired for ${c.vacancy_title} (${c.vacancy_reference}).`,
              rows: [
                ['Position', input.jobTitle],
                ['Starts', input.employmentStartDate],
                ...(input.probationEndDate ? [['Probation Ends', input.probationEndDate]] : []),
              ],
            },
          });
          if (c.employee_id) {
            await notify(trx, {
              recipients: [c.employee_id],
              event: 'APPLICATION_SUCCESSFUL',
              title: `Congratulations: you have been appointed ${input.jobTitle}`,
              body: `Starting ${input.employmentStartDate}.`,
              link: '/recruitment/applications',
              entityType: 'candidate',
              entityId: id,
              email: {
                ...EMAIL,
                subject: `Your application for ${c.vacancy_title}`,
                heading: 'Congratulations',
                intro: `You have been appointed ${input.jobTitle}, starting ${input.employmentStartDate}.`,
              },
            });
          }
          return { employeeId };
        });
        res.status(201).json(out);
      } catch (err) {
        throw mapEmployeeUniqueError(err);
      }
    }),
  );

  // ── Candidate files ──────────────────────────────────────────────────────────────────────────
  const rawBody = express.raw({ type: () => true, limit: maxBytes });
  router.post(
    '/candidates/:id/files',
    (req, res, next) =>
      rawBody(req, res, (err) => {
        if (err?.type === 'entity.too.large') {
          return next(
            new AppError(
              413,
              'FILE_TOO_LARGE',
              `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`,
            ),
          );
        }
        next(err);
      }),
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const c = await db('candidates').where({ id }).first('id', 'employee_id');
      if (!c) throw notFound('Candidate not found.');
      // HR, or an internal applicant adding their own CV.
      const own = c.employee_id === req.user.id;
      if (!own && !can(req.user, 'recruitment.manage'))
        throw forbidden('You cannot add files to this candidate.');
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buf.length) throw badRequest('Choose a file to upload.');
      const mime = candidateFileType(buf);
      if (!mime) throw badRequest('Only PDF, Word (.docx), JPEG and PNG files can be uploaded.');
      const kind = req.query.kind === 'other' ? 'OTHER' : 'CV';
      const stored = await storeFile(config, buf, mime, req.get('x-file-name'));
      try {
        const fileId = await db.transaction(async (trx) => {
          const n = await trx('candidate_files')
            .where({ candidate_id: id })
            .whereNull('deleted_at')
            .count({ n: '*' })
            .first();
          if (Number(n.n) >= MAX_FILES) throw conflict(`A candidate can have at most ${MAX_FILES} files.`);
          const [fid] = await trx('candidate_files').insert({
            candidate_id: id,
            kind,
            original_name: stored.originalName,
            stored_name: stored.storedName,
            mime_type: mime,
            size_bytes: buf.length,
            sha256: stored.sha256,
            uploaded_by: req.user.id,
          });
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'CANDIDATE_FILE_UPLOADED',
            entityType: 'candidate_file',
            entityId: fid,
            after: { candidateId: id, kind, name: stored.originalName, sizeBytes: buf.length },
          });
          return fid;
        });
        res.status(201).json({ id: fileId });
      } catch (err) {
        await fs.promises.unlink(stored.target).catch(() => {});
        throw err;
      }
    }),
  );

  router.get(
    '/files/:id/download',
    asyncHandler(async (req, res) => {
      const f = await db('candidate_files')
        .where({ id: idParam(req) })
        .whereNull('deleted_at')
        .first();
      if (!f) throw notFound('File not found.');
      const c = await db('candidates').where({ id: f.candidate_id }).first('employee_id');
      if (c?.employee_id !== req.user.id) await loadCandidate(f.candidate_id, req.user);
      let data;
      try {
        data = await readStored(config, f.stored_name);
      } catch (err) {
        logger?.error({ err, fileId: f.id }, 'Stored candidate file is missing');
        throw new AppError(410, 'DOCUMENT_MISSING', 'The stored file could not be found. Contact IT.');
      }
      const view =
        req.query.view === '1' && ['application/pdf', 'image/jpeg', 'image/png'].includes(f.mime_type);
      await writeAudit(db, {
        ...auditContext(req),
        action: view ? 'CANDIDATE_FILE_VIEWED' : 'CANDIDATE_FILE_DOWNLOADED',
        entityType: 'candidate_file',
        entityId: f.id,
        after: { candidateId: f.candidate_id },
      });
      const ascii = f.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      res
        .set({
          'Content-Type': f.mime_type,
          'Content-Length': data.length,
          'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(data);
    }),
  );

  router.delete(
    '/files/:id',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const f = await trx('candidate_files').where({ id }).whereNull('deleted_at').forUpdate().first();
        if (!f) throw notFound('File not found.');
        await trx('candidate_files')
          .where({ id })
          .update({ deleted_at: trx.fn.now(), deleted_by: req.user.id });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'CANDIDATE_FILE_REMOVED',
          entityType: 'candidate_file',
          entityId: id,
          before: { candidateId: f.candidate_id, name: f.original_name },
        });
      });
      res.json({ ok: true });
    }),
  );

  // ── Interviews ───────────────────────────────────────────────────────────────────────────────
  const interviewSchema = z.object({
    scheduledAt: parseDateTime,
    location: optionalText(200),
    notes: optionalText(2000),
    panel: z.array(z.coerce.number().int().positive()).min(1, 'needs at least one person').max(10),
  });
  router.post(
    '/candidates/:id/interviews',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const candidateId = idParam(req);
      const input = interviewSchema.parse(req.body);
      const panel = [...new Set(input.panel)];
      const id = await db.transaction(async (trx) => {
        const c = await trx('candidates as c')
          .join('vacancies as v', 'v.id', 'c.vacancy_id')
          .where('c.id', candidateId)
          .forUpdate()
          .first('c.*', 'v.job_title', 'v.reference as vacancy_reference');
        if (!c) throw notFound('Candidate not found.');
        if (!ACTIVE.includes(c.stage)) throw conflict('This candidate is no longer active.');
        if (c.employee_id && panel.includes(c.employee_id))
          throw badRequest('A candidate cannot be on their own panel.');
        const found = await trx('employees').whereIn('id', panel).where({ status: 'ACTIVE' }).pluck('id');
        if (found.length !== panel.length) throw badRequest('Choose active employees for the panel.');
        const [newId] = await trx('interviews').insert({
          candidate_id: candidateId,
          scheduled_at: input.scheduledAt,
          location: input.location,
          notes: input.notes,
          created_by: req.user.id,
        });
        await trx('interview_panel').insert(
          panel.map((employee_id) => ({ interview_id: newId, employee_id })),
        );
        if (['APPLIED', 'SCREENING', 'SHORTLISTED'].includes(c.stage)) {
          await trx('candidates').where({ id: candidateId }).update({ stage: 'INTERVIEW' });
          await addEvent(trx, candidateId, c.stage, 'INTERVIEW', 'Interview scheduled', req.user.id);
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'INTERVIEW_SCHEDULED',
          entityType: 'interview',
          entityId: newId,
          after: { candidateId, ...input, panel },
        });
        const who = name(c.first_name, c.last_name);
        const when = input.scheduledAt.replace('T', ' at ');
        await notify(trx, {
          recipients: panel.filter((p) => p !== req.user.id),
          event: 'INTERVIEW_SCHEDULED',
          title: `Interview: ${who} for ${c.job_title}`,
          body: `${when}${input.location ? `, ${input.location}` : ''}. You are on the panel.`,
          link: `/recruitment/candidates/${candidateId}`,
          entityType: 'interview',
          entityId: newId,
          email: {
            ...EMAIL,
            subject: `Interview panel: ${who} for ${c.job_title}`,
            heading: 'You are on an interview panel',
            intro: `You have been asked to interview ${who} for ${c.job_title} (${c.vacancy_reference}).`,
            rows: [['When', when], ...(input.location ? [['Where', input.location]] : [])],
            action:
              'The CV is in the recruitment system. Please give your feedback there after the interview.',
          },
        });
        return newId;
      });
      res.status(201).json({ id });
    }),
  );

  const feedbackSchema = z.object({
    rating: z.coerce.number().int().min(1).max(5),
    recommendation: z.enum(['HIRE', 'MAYBE', 'NO_HIRE']),
    comments: optionalText(4000),
  });
  router.post(
    '/interviews/:id/feedback',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = feedbackSchema.parse(req.body);
      await db.transaction(async (trx) => {
        const i = await trx('interviews').where({ id }).forUpdate().first();
        if (!i) throw notFound('Interview not found.');
        if (i.status === 'CANCELLED') throw conflict('This interview was cancelled.');
        const seat = await trx('interview_panel')
          .where({ interview_id: id, employee_id: req.user.id })
          .first();
        if (!seat) throw forbidden('Only the panel gives feedback on this interview.');
        await trx('interview_panel')
          .where({ interview_id: id, employee_id: req.user.id })
          .update({ ...input, submitted_at: trx.fn.now() });
        // Once everyone on the panel has given feedback, the interview is done.
        const left = await trx('interview_panel')
          .where({ interview_id: id })
          .whereNull('submitted_at')
          .first('employee_id');
        if (!left) await trx('interviews').where({ id }).update({ status: 'DONE' });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'INTERVIEW_FEEDBACK_GIVEN',
          entityType: 'interview',
          entityId: id,
          after: { rating: input.rating, recommendation: input.recommendation },
        });
      });
      res.json({ id });
    }),
  );

  router.post(
    '/interviews/:id/cancel',
    asyncHandler(async (req, res) => {
      mustManage(req);
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const i = await trx('interviews').where({ id }).forUpdate().first();
        if (!i) throw notFound('Interview not found.');
        if (i.status !== 'SCHEDULED') throw conflict('Only a scheduled interview can be cancelled.');
        await trx('interviews').where({ id }).update({ status: 'CANCELLED' });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'INTERVIEW_CANCELLED',
          entityType: 'interview',
          entityId: id,
        });
      });
      res.json({ id });
    }),
  );

  // Interviews the signed-in person sits on.
  router.get(
    '/interviews/mine',
    asyncHandler(async (req, res) => {
      const rows = await db('interview_panel as p')
        .join('interviews as i', 'i.id', 'p.interview_id')
        .join('candidates as c', 'c.id', 'i.candidate_id')
        .join('vacancies as v', 'v.id', 'c.vacancy_id')
        .where('p.employee_id', req.user.id)
        .whereNot('i.status', 'CANCELLED')
        .orderBy('i.scheduled_at', 'desc')
        .limit(200)
        .select(
          'i.id',
          'i.scheduled_at',
          'i.location',
          'i.status',
          'p.submitted_at',
          'p.rating',
          'c.id as candidate_id',
          'c.first_name',
          'c.last_name',
          'v.job_title',
          'v.reference',
        );
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          scheduledAt: r.scheduled_at,
          location: r.location,
          status: r.status,
          feedbackGiven: Boolean(r.submitted_at),
          rating: r.rating,
          candidate: {
            id: r.candidate_id,
            name: name(r.first_name, r.last_name),
            firstName: r.first_name,
            lastName: r.last_name,
          },
          vacancy: { jobTitle: r.job_title, reference: r.reference },
        })),
      });
    }),
  );

  // ── Open positions for staff, and their own applications ─────────────────────────────────────
  const openInternal = () =>
    vacancyRows()
      .where({ 'v.status': 'OPEN', 'v.is_internal': true })
      .where((w) => w.whereNull('v.closing_date').orWhere('v.closing_date', '>=', todayInLusaka()));

  router.get(
    '/jobs',
    asyncHandler(async (req, res) => {
      const rows = await openInternal().orderBy('v.closing_date').orderBy('v.id', 'desc');
      const mine = await db('candidates').where({ employee_id: req.user.id }).pluck('vacancy_id');
      res.json({
        items: rows.map((v) => ({ ...vacancyView(v), applied: mine.includes(v.id) })),
      });
    }),
  );

  router.post(
    '/jobs/:id/apply',
    asyncHandler(async (req, res) => {
      const vacancyId = idParam(req);
      const { note } = z.object({ note: optionalText(2000) }).parse(req.body ?? {});
      const id = await db.transaction(async (trx) => {
        const v = await openInternal().where('v.id', vacancyId).first();
        if (!v) throw notFound('This position is no longer open.');
        if (await trx('candidates').where({ vacancy_id: vacancyId, employee_id: req.user.id }).first('id')) {
          throw conflict('You have already applied for this position.');
        }
        const me = await trx('employees')
          .where({ id: req.user.id })
          .first('first_name', 'last_name', 'email');
        const [newId] = await trx('candidates').insert({
          vacancy_id: vacancyId,
          employee_id: req.user.id,
          first_name: me.first_name,
          last_name: me.last_name,
          email: me.email,
          source: 'INTERNAL',
          notes: note,
          stage: 'APPLIED',
          created_by: req.user.id,
        });
        await addEvent(trx, newId, null, 'APPLIED', 'Applied from inside the company', req.user.id);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'CANDIDATE_APPLIED',
          entityType: 'candidate',
          entityId: newId,
          after: { vacancy: v.reference },
        });
        const who = name(me.first_name, me.last_name);
        await notify(trx, {
          recipients: await moduleHolders(trx, 'recruitment', ['recruitment.manage'], [req.user.id]),
          event: 'APPLICATION_RECEIVED',
          title: `New internal application: ${who}`,
          body: `For ${v.job_title} (${v.reference}).`,
          link: `/recruitment/candidates/${newId}`,
          entityType: 'candidate',
          entityId: newId,
        });
        await notify(trx, {
          recipients: [req.user.id],
          event: 'APPLICATION_SUBMITTED',
          title: `Application sent: ${v.job_title}`,
          body: 'HR has your application. You can add your CV on My Applications.',
          link: '/recruitment/applications',
          entityType: 'candidate',
          entityId: newId,
          email: {
            ...EMAIL,
            subject: `Application received: ${v.job_title}`,
            heading: 'Application received',
            intro: `HR has received your application for ${v.job_title} (${v.reference}).`,
            action: 'You can add your CV and follow your application in the recruitment system.',
          },
        });
        return newId;
      });
      res.status(201).json({ id });
    }),
  );

  // What an applicant sees of their own applications: where it stands, never notes or feedback.
  const APPLICANT_STATUS = {
    APPLIED: 'Received',
    SCREENING: 'Being Considered',
    SHORTLISTED: 'Being Considered',
    INTERVIEW: 'Interview',
    OFFER: 'Offer',
    HIRED: 'Successful',
    REJECTED: 'Not Successful',
    WITHDRAWN: 'Withdrawn',
  };
  router.get(
    '/applications',
    asyncHandler(async (req, res) => {
      const rows = await db('candidates as c')
        .join('vacancies as v', 'v.id', 'c.vacancy_id')
        .join('departments as d', 'd.id', 'v.department_id')
        .where('c.employee_id', req.user.id)
        .orderBy('c.id', 'desc')
        .select('c.id', 'c.stage', 'c.created_at', 'v.job_title', 'v.reference', 'd.name as department');
      const files = rows.length
        ? await db('candidate_files')
            .whereIn(
              'candidate_id',
              rows.map((r) => r.id),
            )
            .whereNull('deleted_at')
            .select('id', 'candidate_id', 'original_name')
        : [];
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          jobTitle: r.job_title,
          reference: r.reference,
          department: r.department,
          status: APPLICANT_STATUS[r.stage],
          active: ACTIVE.includes(r.stage),
          appliedAt: r.created_at,
          files: files
            .filter((f) => f.candidate_id === r.id)
            .map((f) => ({ id: f.id, name: f.original_name })),
        })),
      });
    }),
  );

  router.post(
    '/applications/:id/withdraw',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const c = await trx('candidates').where({ id, employee_id: req.user.id }).forUpdate().first();
        if (!c) throw notFound('Application not found.');
        if (!ACTIVE.includes(c.stage)) throw conflict('This application has already ended.');
        await trx('candidates').where({ id }).update({ stage: 'WITHDRAWN' });
        await addEvent(trx, id, c.stage, 'WITHDRAWN', 'Withdrawn by the applicant', req.user.id);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'CANDIDATE_WITHDRAWN',
          entityType: 'candidate',
          entityId: id,
          before: { stage: c.stage },
        });
      });
      res.json({ id });
    }),
  );

  // ── Dashboard ────────────────────────────────────────────────────────────────────────────────
  router.get(
    '/summary',
    asyncHandler(async (req, res) => {
      const all = can(req.user, 'recruitment.view');
      const year = todayInLusaka().slice(0, 4);
      const scoped = (q) => (all ? q : q.where('v.hiring_manager_id', req.user.id));
      const n = async (q) => Number((await q.count({ n: '*' }).first()).n);
      const byStage = await scoped(
        db('candidates as c')
          .join('vacancies as v', 'v.id', 'c.vacancy_id')
          .whereIn('v.status', ['OPEN', 'ON_HOLD']),
      )
        .groupBy('c.stage')
        .select('c.stage')
        .count({ n: '*' });
      const today = todayInLusaka();
      res.json({
        seesAll: all,
        openVacancies: await n(scoped(db('vacancies as v').where('v.status', 'OPEN'))),
        activeCandidates: await n(
          scoped(
            db('candidates as c').join('vacancies as v', 'v.id', 'c.vacancy_id').whereIn('c.stage', ACTIVE),
          ),
        ),
        interviewsThisWeek: await n(
          scoped(
            db('interviews as i')
              .join('candidates as c', 'c.id', 'i.candidate_id')
              .join('vacancies as v', 'v.id', 'c.vacancy_id')
              .where('i.status', 'SCHEDULED')
              .whereBetween('i.scheduled_at', [`${today}T00:00`, `${addDays(today, 7)}T23:59`]),
          ),
        ),
        hiredThisYear: await n(
          scoped(
            db('candidate_events as x')
              .join('candidates as c', 'c.id', 'x.candidate_id')
              .join('vacancies as v', 'v.id', 'c.vacancy_id')
              .where('x.to_stage', 'HIRED')
              .where('x.created_at', '>=', `${year}-01-01`),
          ),
        ),
        pipeline: STAGES.filter((s) => ACTIVE.includes(s)).map((s) => ({
          stage: s,
          label: STAGE_LABEL[s],
          count: Number(byStage.find((b) => b.stage === s)?.n ?? 0),
        })),
      });
    }),
  );

  return router;
}
