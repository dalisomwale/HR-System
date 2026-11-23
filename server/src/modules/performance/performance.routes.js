import { Router } from 'express';
import { z } from 'zod';
import { auditContext, can } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notify.service.js';
import { moduleHolders } from '../access/modules.js';
import { updateEmployee, updateEmployeeSchema } from '../admin/employees.service.js';
import {
  asyncHandler,
  idParam,
  isoDate,
  optionalId,
  optionalText,
  requiredText,
} from '../../utils/validation.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { startDueProbationReviews } from './probation.js';

/*
 * Performance management (D115).
 *
 * Review cycle (one a year), run by HR with "Review cycles: Manage":
 *   Draft → Goal setting → Mid-year → Year end → Closed. Starting it gives every active
 *   employee (of one company, or all) an appraisal with their line manager.
 *
 * Appraisal, step by step:
 *   Goals draft      the employee writes their goals (weights add up to 100) and sends them
 *   Goals sent       the manager agrees them, or sends them back with a comment
 *   Goals agreed     at mid-year the employee records progress on each goal…
 *   Mid-year self    …and the manager adds their mid-year comments
 *   Year end         the employee rates each goal 1–5; then the manager rates each goal, which
 *                    gives the weighted overall score
 *   HR sign-off      HR ("Appraisals: View all and sign off") signs it off, or sends it back
 *
 * Someone with no line manager has their manager steps done by HR. Ratings: 1 Unsatisfactory,
 * 2 Needs improvement, 3 Meets expectations, 4 Exceeds expectations, 5 Outstanding.
 */

const EMAIL = { app: 'performance' };
const name = (f, l) => [f, l].filter(Boolean).join(' ') || null;
const RATING = {
  1: 'Unsatisfactory',
  2: 'Needs improvement',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Outstanding',
};
const ratingText = (score) => (score == null ? null : RATING[Math.round(Number(score))]);
const PHASES = ['DRAFT', 'GOAL_SETTING', 'MID_YEAR', 'YEAR_END', 'CLOSED'];

/** Who acts next on an appraisal, and what they do. */
export function nextStep(status, phase) {
  if (phase === 'CLOSED' || phase === 'DRAFT') return null;
  switch (status) {
    case 'GOALS_DRAFT':
      return { who: 'EMPLOYEE', label: 'Set Goals' };
    case 'GOALS_SUBMITTED':
      return { who: 'MANAGER', label: 'Agree Goals' };
    case 'GOALS_AGREED':
      if (phase === 'MID_YEAR') return { who: 'EMPLOYEE', label: 'Mid-year Self-review' };
      if (phase === 'YEAR_END') return { who: 'EMPLOYEE', label: 'Year-end Self-assessment' };
      return null;
    case 'MID_SELF_DONE':
      return phase === 'YEAR_END'
        ? { who: 'EMPLOYEE', label: 'Year-end Self-assessment' }
        : { who: 'MANAGER', label: 'Mid-year Review' };
    case 'MID_DONE':
      return phase === 'YEAR_END' ? { who: 'EMPLOYEE', label: 'Year-end Self-assessment' } : null;
    case 'FINAL_SELF_DONE':
      return { who: 'MANAGER', label: 'Year-end Appraisal' };
    case 'FINAL_MANAGER_DONE':
      return { who: 'HR', label: 'HR Sign-off' };
    default:
      return null;
  }
}

export const STATUS_LABEL = {
  GOALS_DRAFT: 'Setting Goals',
  GOALS_SUBMITTED: 'Goals With The Manager',
  GOALS_AGREED: 'Goals Agreed',
  MID_SELF_DONE: 'Mid-year: With The Manager',
  MID_DONE: 'Mid-year Done',
  FINAL_SELF_DONE: 'Year End: With The Manager',
  FINAL_MANAGER_DONE: 'Waiting For HR Sign-off',
  SIGNED_OFF: 'Signed Off',
};

const goalSchema = z.object({
  title: requiredText(200),
  description: optionalText(2000),
  measure: optionalText(300),
  weight: z.coerce.number().int().min(1, 'must be at least 1').max(100),
});
const cycleSchema = z.object({
  name: requiredText(120),
  year: z.coerce.number().int().min(2020).max(2100),
  companyId: optionalId,
  goalsDue: isoDate.nullish().or(z.literal('').transform(() => null)),
  midYearDue: isoDate.nullish().or(z.literal('').transform(() => null)),
  yearEndDue: isoDate.nullish().or(z.literal('').transform(() => null)),
});
const rating = z.coerce.number().int().min(1).max(5);

export function performanceRoutes({ db }) {
  const router = Router();
  const rights = (u) => ({
    cycles: can(u, 'performance.cycles'),
    viewAll: can(u, 'performance.view_all'),
    signoff: can(u, 'performance.signoff'),
    probation: can(u, 'performance.probation'),
    usersAdmin: can(u, 'performance.users'),
    rolesAdmin: can(u, 'performance.roles'),
    auditAdmin: can(u, 'performance.audit'),
  });

  const appraisalRows = (k = db) =>
    k('appraisals as a')
      .join('review_cycles as c', 'c.id', 'a.cycle_id')
      .join('employees as e', 'e.id', 'a.employee_id')
      .leftJoin('employees as m', 'm.id', 'a.manager_id')
      .leftJoin('departments as d', 'd.id', 'e.department_id')
      .leftJoin('companies as co', 'co.id', 'e.company_id')
      .select(
        'a.*',
        'c.name as cycle_name',
        'c.year as cycle_year',
        'c.status as phase',
        'c.goals_due',
        'c.mid_year_due',
        'c.year_end_due',
        'e.first_name',
        'e.last_name',
        'e.job_title',
        'e.employee_number',
        'd.name as department',
        'co.name as company',
        'm.first_name as m_first',
        'm.last_name as m_last',
      );
  /** How the viewer relates to an appraisal. HR stands in for a missing manager. */
  const relation = (u, a) => {
    const self = a.employee_id === u.id;
    const manager = !self && (a.manager_id === u.id || (!a.manager_id && can(u, 'performance.signoff')));
    const hr = !self && can(u, 'performance.signoff');
    return {
      self,
      manager,
      hr,
      sees: self || manager || a.manager_id === u.id || can(u, 'performance.view_all'),
    };
  };
  const summaryView = (a) => ({
    id: a.id,
    cycle: { id: a.cycle_id, name: a.cycle_name, year: a.cycle_year, phase: a.phase },
    employee: {
      id: a.employee_id,
      name: name(a.first_name, a.last_name),
      firstName: a.first_name,
      lastName: a.last_name,
      jobTitle: a.job_title,
      employeeNumber: a.employee_number,
      department: a.department,
      company: a.company,
    },
    manager: a.manager_id ? { id: a.manager_id, name: name(a.m_first, a.m_last) } : null,
    status: a.status,
    statusLabel: STATUS_LABEL[a.status],
    next: nextStep(a.status, a.phase),
    overallScore: a.overall_score == null ? null : Number(a.overall_score),
    overallRating: ratingText(a.overall_score),
    updatedAt: a.updated_at,
  });

  // ── Who the signed-in person is here, and what is waiting for them ────────────────────────────
  async function waiting(u) {
    const open = await appraisalRows()
      .whereIn('c.status', ['GOAL_SETTING', 'MID_YEAR', 'YEAR_END'])
      .where((w) => {
        w.where('a.employee_id', u.id).orWhere('a.manager_id', u.id);
        if (can(u, 'performance.signoff'))
          w.orWhere('a.status', 'FINAL_MANAGER_DONE').orWhereNull('a.manager_id');
      });
    let mine = 0;
    let team = 0;
    let signoff = 0;
    for (const a of open) {
      const n = nextStep(a.status, a.phase);
      if (!n) continue;
      const r = relation(u, a);
      if (n.who === 'EMPLOYEE' && r.self) mine += 1;
      else if (n.who === 'MANAGER' && r.manager) team += 1;
      else if (n.who === 'HR' && r.hr) signoff += 1;
    }
    const probation = Number(
      (
        await db('probation_reviews')
          .where((w) => {
            w.where({ status: 'PENDING_MANAGER', manager_id: u.id });
            if (can(u, 'performance.probation')) {
              w.orWhere('status', 'PENDING_HR').orWhere((x) =>
                x.where('status', 'PENDING_MANAGER').whereNull('manager_id'),
              );
            }
          })
          .count({ n: '*' })
          .first()
      ).n,
    );
    return { mine, team, signoff, probation };
  }
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const isManager = Boolean(
        await db('employees').where({ line_manager_id: req.user.id, status: 'ACTIVE' }).first('id'),
      );
      res.json({ ...rights(req.user), isManager, counts: await waiting(req.user) });
    }),
  );

  // ── Review cycles ────────────────────────────────────────────────────────────────────────────
  const mustCycles = (req) => {
    if (!can(req.user, 'performance.cycles')) throw forbidden('You cannot manage review cycles.');
  };
  async function cycleProgress(cycleIds) {
    if (!cycleIds.length) return new Map();
    const rows = await db('appraisals')
      .whereIn('cycle_id', cycleIds)
      .groupBy('cycle_id', 'status')
      .select('cycle_id', 'status')
      .count({ n: '*' });
    const out = new Map();
    for (const r of rows) {
      const m = out.get(r.cycle_id) ?? { total: 0 };
      m[r.status] = Number(r.n);
      m.total += Number(r.n);
      out.set(r.cycle_id, m);
    }
    return out;
  }
  const cycleView = (c, progress = { total: 0 }) => ({
    id: c.id,
    name: c.name,
    year: c.year,
    company: c.company ?? null,
    companyId: c.company_id,
    status: c.status,
    goalsDue: c.goals_due,
    midYearDue: c.mid_year_due,
    yearEndDue: c.year_end_due,
    createdAt: c.created_at,
    progress,
  });
  const cycleRows = () =>
    db('review_cycles as c')
      .leftJoin('companies as co', 'co.id', 'c.company_id')
      .select('c.*', 'co.name as company');

  router.get(
    '/cycles',
    asyncHandler(async (req, res) => {
      if (!can(req.user, 'performance.cycles') && !can(req.user, 'performance.view_all')) throw forbidden();
      const rows = await cycleRows().orderBy('c.year', 'desc').orderBy('c.id', 'desc');
      const p = await cycleProgress(rows.map((c) => c.id));
      res.json({
        items: rows.map((c) => cycleView(c, p.get(c.id))),
        canManage: can(req.user, 'performance.cycles'),
      });
    }),
  );
  router.post(
    '/cycles',
    asyncHandler(async (req, res) => {
      mustCycles(req);
      const input = cycleSchema.parse(req.body);
      const id = await db.transaction(async (trx) => {
        const [newId] = await trx('review_cycles').insert({
          name: input.name,
          year: input.year,
          company_id: input.companyId,
          goals_due: input.goalsDue,
          mid_year_due: input.midYearDue,
          year_end_due: input.yearEndDue,
          created_by: req.user.id,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'REVIEW_CYCLE_CREATED',
          entityType: 'review_cycle',
          entityId: newId,
          after: input,
        });
        return newId;
      });
      res.status(201).json({ id });
    }),
  );
  router.get(
    '/cycles/:id',
    asyncHandler(async (req, res) => {
      if (!can(req.user, 'performance.cycles') && !can(req.user, 'performance.view_all')) throw forbidden();
      const c = await cycleRows().where('c.id', idParam(req)).first();
      if (!c) throw notFound('Review cycle not found.');
      const p = await cycleProgress([c.id]);
      const items = await appraisalRows().where('a.cycle_id', c.id).orderBy(['e.first_name', 'e.last_name']);
      res.json({
        ...cycleView(c, p.get(c.id)),
        canManage: can(req.user, 'performance.cycles'),
        items: items.map(summaryView),
      });
    }),
  );

  /** Give an appraisal to every active employee in scope who has none in this cycle. */
  async function addParticipants(trx, cycle) {
    const have = await trx('appraisals').where({ cycle_id: cycle.id }).pluck('employee_id');
    const people = await trx('employees')
      .where({ status: 'ACTIVE' })
      .modify((q) => cycle.company_id && q.where('company_id', cycle.company_id))
      .whereNotIn('id', have.length ? have : [0])
      .select('id', 'line_manager_id');
    if (people.length) {
      await trx('appraisals').insert(
        people.map((p) => ({ cycle_id: cycle.id, employee_id: p.id, manager_id: p.line_manager_id ?? null })),
      );
    }
    return people.map((p) => p.id);
  }

  const phaseSchema = z.object({ to: z.enum(['GOAL_SETTING', 'MID_YEAR', 'YEAR_END', 'CLOSED']) });
  router.post(
    '/cycles/:id/phase',
    asyncHandler(async (req, res) => {
      mustCycles(req);
      const id = idParam(req);
      const { to } = phaseSchema.parse(req.body);
      const out = await db.transaction(async (trx) => {
        const c = await trx('review_cycles').where({ id }).forUpdate().first();
        if (!c) throw notFound('Review cycle not found.');
        if (PHASES.indexOf(to) !== PHASES.indexOf(c.status) + 1) {
          throw conflict('A review cycle moves on one step at a time.');
        }
        await trx('review_cycles').where({ id }).update({ status: to });
        const added = to === 'GOAL_SETTING' ? await addParticipants(trx, c) : [];
        await writeAudit(trx, {
          ...auditContext(req),
          action: `REVIEW_CYCLE_${to}`,
          entityType: 'review_cycle',
          entityId: id,
          before: { status: c.status },
          after: { status: to, appraisalsCreated: added.length || undefined },
        });
        const everyone = await trx('appraisals').where({ cycle_id: id }).pluck('employee_id');
        const due = { GOAL_SETTING: c.goals_due, MID_YEAR: c.mid_year_due, YEAR_END: c.year_end_due }[to];
        const what = {
          GOAL_SETTING: ['Set your goals', 'agree your goals for the year with your manager'],
          MID_YEAR: ['Mid-year review', 'record your progress on each goal'],
          YEAR_END: ['Year-end appraisal', 'rate yourself against each goal'],
        }[to];
        if (what) {
          await notify(trx, {
            recipients: everyone,
            event: `CYCLE_${to}`,
            title: `${what[0]}: ${c.name}`,
            body: `Please ${what[1]}${due ? ` by ${due}` : ''}.`,
            link: '/performance/mine',
            entityType: 'review_cycle',
            entityId: id,
            email: {
              ...EMAIL,
              subject: `${what[0]}: ${c.name}`,
              heading: what[0],
              intro: `The ${c.name} review cycle has moved to ${what[0].toLowerCase()}. Please ${what[1]}.`,
              rows: due ? [['Due By', due]] : [],
              action: 'Open your appraisal in the performance system.',
            },
          });
        }
        return { status: to, appraisals: everyone.length };
      });
      res.json(out);
    }),
  );
  router.post(
    '/cycles/:id/add-missing',
    asyncHandler(async (req, res) => {
      mustCycles(req);
      const id = idParam(req);
      const added = await db.transaction(async (trx) => {
        const c = await trx('review_cycles').where({ id }).forUpdate().first();
        if (!c) throw notFound('Review cycle not found.');
        if (['DRAFT', 'CLOSED'].includes(c.status)) throw conflict('Start the cycle first, or it is closed.');
        const ids = await addParticipants(trx, c);
        if (ids.length) {
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'REVIEW_CYCLE_PEOPLE_ADDED',
            entityType: 'review_cycle',
            entityId: id,
            after: { added: ids.length },
          });
          await notify(trx, {
            recipients: ids,
            event: 'CYCLE_GOAL_SETTING',
            title: `Set your goals: ${c.name}`,
            body: 'You have been added to the review cycle. Agree your goals with your manager.',
            link: '/performance/mine',
            entityType: 'review_cycle',
            entityId: id,
          });
        }
        return ids.length;
      });
      res.json({ added });
    }),
  );

  // ── Appraisals ───────────────────────────────────────────────────────────────────────────────
  router.get(
    '/appraisals',
    asyncHandler(async (req, res) => {
      const scope = ['mine', 'team', 'all'].includes(req.query.scope) ? req.query.scope : 'mine';
      if (scope === 'all' && !can(req.user, 'performance.view_all')) throw forbidden();
      const rows = await appraisalRows()
        .modify((q) => {
          if (scope === 'mine') q.where('a.employee_id', req.user.id);
          if (scope === 'team') q.where('a.manager_id', req.user.id);
          if (req.query.cycleId) q.where('a.cycle_id', Number(req.query.cycleId));
          if (req.query.status) q.where('a.status', String(req.query.status));
        })
        .orderBy('c.year', 'desc')
        .orderBy(['e.first_name', 'e.last_name'])
        .limit(2000);
      res.json({ items: rows.map(summaryView) });
    }),
  );

  async function loadAppraisal(id, u, k = db) {
    const a = await appraisalRows(k).where('a.id', id).first();
    if (!a) throw notFound('Appraisal not found.');
    const r = relation(u, a);
    if (!r.sees) throw notFound('Appraisal not found.');
    return { a, r };
  }
  const goalsOf = (id, trx = db) =>
    trx('appraisal_goals').where({ appraisal_id: id }).orderBy(['sort', 'id']);

  router.get(
    '/appraisals/:id',
    asyncHandler(async (req, res) => {
      const { a, r } = await loadAppraisal(idParam(req), req.user);
      const [goals, events] = await Promise.all([
        goalsOf(a.id),
        db('appraisal_events as x')
          .leftJoin('employees as e', 'e.id', 'x.actor_id')
          .where('x.appraisal_id', a.id)
          .orderBy('x.id')
          .select('x.*', 'e.first_name', 'e.last_name'),
      ]);
      const n = nextStep(a.status, a.phase);
      const yours =
        n &&
        ((n.who === 'EMPLOYEE' && r.self) || (n.who === 'MANAGER' && r.manager) || (n.who === 'HR' && r.hr));
      // The employee's own ratings are hidden from the manager until the employee sends them,
      // and the manager's until the manager has finished.
      const showSelf = ['FINAL_SELF_DONE', 'FINAL_MANAGER_DONE', 'SIGNED_OFF'].includes(a.status) || r.self;
      const showManager = ['FINAL_MANAGER_DONE', 'SIGNED_OFF'].includes(a.status) || r.manager;
      res.json({
        ...summaryView(a),
        cycle: {
          id: a.cycle_id,
          name: a.cycle_name,
          year: a.cycle_year,
          phase: a.phase,
          goalsDue: a.goals_due,
          midYearDue: a.mid_year_due,
          yearEndDue: a.year_end_due,
        },
        midSelfComment: a.mid_self_comment,
        midManagerComment: a.mid_manager_comment,
        finalSelfComment: showSelf ? a.final_self_comment : null,
        finalManagerComment: showManager ? a.final_manager_comment : null,
        hrComment: a.hr_comment,
        signedOffAt: a.signed_off_at,
        goals: goals.map((g) => ({
          id: g.id,
          title: g.title,
          description: g.description,
          measure: g.measure,
          weight: g.weight,
          midProgress: g.mid_progress,
          selfRating: showSelf ? g.self_rating : null,
          selfComment: showSelf ? g.self_comment : null,
          managerRating: showManager ? g.manager_rating : null,
          managerComment: showManager ? g.manager_comment : null,
        })),
        history: events.map((x) => ({
          action: x.action,
          to: x.to_status,
          comment: x.comment,
          by: name(x.first_name, x.last_name) ?? 'System',
          at: x.created_at,
        })),
        viewer: { self: r.self, manager: r.manager, hr: r.hr },
        yourTurn: Boolean(yours),
        can: {
          editGoals:
            !['CLOSED', 'DRAFT'].includes(a.phase) &&
            ((r.self && a.status === 'GOALS_DRAFT') ||
              (r.manager && ['GOALS_DRAFT', 'GOALS_SUBMITTED'].includes(a.status))),
        },
      });
    }),
  );

  router.put(
    '/appraisals/:id/goals',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const { goals } = z
        .object({ goals: z.array(goalSchema).max(15, 'can have at most 15 goals') })
        .parse(req.body);
      await db.transaction(async (trx) => {
        const { a, r } = await loadAppraisal(id, req.user, trx);
        await trx('appraisals').where({ id }).forUpdate().first('id');
        const ok =
          !['CLOSED', 'DRAFT'].includes(a.phase) &&
          ((r.self && a.status === 'GOALS_DRAFT') ||
            (r.manager && ['GOALS_DRAFT', 'GOALS_SUBMITTED'].includes(a.status)));
        if (!ok) throw conflict('The goals cannot be changed at this step.');
        await trx('appraisal_goals').where({ appraisal_id: id }).del();
        if (goals.length) {
          await trx('appraisal_goals').insert(
            goals.map((g, i) => ({
              appraisal_id: id,
              sort: i,
              title: g.title,
              description: g.description,
              measure: g.measure,
              weight: g.weight,
            })),
          );
        }
        await trx('appraisals').where({ id }).update({ updated_at: trx.fn.now() });
      });
      res.json({ id });
    }),
  );

  const actionSchema = z.object({
    action: z.enum([
      'SUBMIT_GOALS',
      'AGREE_GOALS',
      'RETURN_GOALS',
      'MID_SELF',
      'MID_MANAGER',
      'FINAL_SELF',
      'FINAL_MANAGER',
      'SIGN_OFF',
      'RETURN_TO_MANAGER',
    ]),
    comment: optionalText(4000),
    goals: z
      .array(
        z.object({
          id: z.coerce.number().int().positive(),
          midProgress: optionalText(2000),
          rating: rating.nullish(),
          comment: optionalText(2000),
        }),
      )
      .default([]),
  });

  router.post(
    '/appraisals/:id/action',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = actionSchema.parse(req.body);
      const out = await db.transaction(async (trx) => {
        await trx('appraisals').where({ id }).forUpdate().first('id');
        const { a, r } = await loadAppraisal(id, req.user, trx);
        const goals = await goalsOf(id, trx);
        const given = new Map(input.goals.map((g) => [g.id, g]));
        const totalWeight = goals.reduce((s, g) => s + g.weight, 0);
        const needWeights = () => {
          if (!goals.length) throw badRequest('Add at least one goal.');
          if (totalWeight !== 100)
            throw badRequest(`The goal weights add up to ${totalWeight}; they must add up to 100.`);
        };
        const needComment = (what) => {
          if (!input.comment) throw badRequest(`Give ${what}.`);
        };
        const phase = a.phase;
        const step = (cond, msg = 'This step is not open now.') => {
          if (!cond) throw conflict(msg);
        };
        let to;
        const row = {};
        switch (input.action) {
          case 'SUBMIT_GOALS':
            step(r.self && a.status === 'GOALS_DRAFT' && phase !== 'CLOSED');
            needWeights();
            to = 'GOALS_SUBMITTED';
            break;
          case 'AGREE_GOALS':
            step(r.manager && ['GOALS_DRAFT', 'GOALS_SUBMITTED'].includes(a.status) && phase !== 'CLOSED');
            needWeights();
            to = 'GOALS_AGREED';
            break;
          case 'RETURN_GOALS':
            step(r.manager && a.status === 'GOALS_SUBMITTED');
            needComment('a comment saying what to change');
            to = 'GOALS_DRAFT';
            break;
          case 'MID_SELF':
            step(r.self && a.status === 'GOALS_AGREED' && ['MID_YEAR', 'YEAR_END'].includes(phase));
            for (const g of goals) {
              await trx('appraisal_goals')
                .where({ id: g.id })
                .update({ mid_progress: given.get(g.id)?.midProgress ?? null });
            }
            row.mid_self_comment = input.comment;
            to = 'MID_SELF_DONE';
            break;
          case 'MID_MANAGER':
            step(r.manager && a.status === 'MID_SELF_DONE' && ['MID_YEAR', 'YEAR_END'].includes(phase));
            needComment('your mid-year comments');
            row.mid_manager_comment = input.comment;
            to = 'MID_DONE';
            break;
          case 'FINAL_SELF':
            step(
              r.self &&
                ['GOALS_AGREED', 'MID_SELF_DONE', 'MID_DONE'].includes(a.status) &&
                phase === 'YEAR_END',
            );
            for (const g of goals) {
              const x = given.get(g.id);
              if (!x?.rating) throw badRequest(`Rate yourself on "${g.title}".`);
              await trx('appraisal_goals')
                .where({ id: g.id })
                .update({ self_rating: x.rating, self_comment: x.comment ?? null });
            }
            row.final_self_comment = input.comment;
            to = 'FINAL_SELF_DONE';
            break;
          case 'FINAL_MANAGER': {
            step(r.manager && a.status === 'FINAL_SELF_DONE' && phase === 'YEAR_END');
            let sum = 0;
            for (const g of goals) {
              const x = given.get(g.id);
              if (!x?.rating) throw badRequest(`Give a rating for "${g.title}".`);
              sum += x.rating * g.weight;
              await trx('appraisal_goals')
                .where({ id: g.id })
                .update({ manager_rating: x.rating, manager_comment: x.comment ?? null });
            }
            needComment('your overall comments');
            row.final_manager_comment = input.comment;
            row.overall_score = Math.round((sum / (totalWeight || 1)) * 100) / 100;
            to = 'FINAL_MANAGER_DONE';
            break;
          }
          case 'SIGN_OFF':
            step(r.hr && a.status === 'FINAL_MANAGER_DONE');
            row.hr_comment = input.comment;
            row.signed_off_by = req.user.id;
            row.signed_off_at = trx.fn.now();
            to = 'SIGNED_OFF';
            break;
          case 'RETURN_TO_MANAGER':
            step(r.hr && a.status === 'FINAL_MANAGER_DONE');
            needComment('a comment saying what to look at again');
            row.hr_comment = input.comment;
            to = 'FINAL_SELF_DONE';
            break;
          default:
            throw badRequest('Unknown action.');
        }
        await trx('appraisals')
          .where({ id })
          .update({ ...row, status: to });
        await trx('appraisal_events').insert({
          appraisal_id: id,
          action: input.action,
          from_status: a.status,
          to_status: to,
          comment: input.comment ?? null,
          actor_id: req.user.id,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: `APPRAISAL_${input.action}`,
          entityType: 'appraisal',
          entityId: id,
          before: { status: a.status },
          after: { status: to, ...(row.overall_score != null ? { overallScore: row.overall_score } : {}) },
        });
        await tellNext(trx, a, input.action, to, row, req.user.id);
        return { status: to };
      });
      res.json(out);
    }),
  );

  /** Tell whoever acts next, and the employee when something is decided about them. */
  async function tellNext(trx, a, action, to, row, actorId) {
    const who = name(a.first_name, a.last_name);
    const link = `/performance/appraisals/${a.id}`;
    const base = { link, entityType: 'appraisal', entityId: a.id };
    const managerOrHr = async () =>
      a.manager_id
        ? [a.manager_id]
        : moduleHolders(trx, 'performance', ['performance.signoff'], [a.employee_id]);
    const send = async (recipients, event, title, body, intro) =>
      notify(trx, {
        ...base,
        recipients: recipients.filter((x) => x && x !== actorId),
        event,
        title,
        body,
        email: {
          ...EMAIL,
          subject: title,
          heading: title.split(':')[0],
          intro,
          rows: [
            ['Employee', who],
            ['Review Cycle', a.cycle_name],
          ],
          action: 'Open the appraisal in the performance system.',
        },
      });
    if (action === 'SUBMIT_GOALS') {
      await send(
        await managerOrHr(),
        'APPRAISAL_GOALS_TO_AGREE',
        `Goals to agree: ${who}`,
        'Agree them, or send them back with a comment.',
        `${who} has sent their goals for ${a.cycle_name}.`,
      );
    } else if (action === 'AGREE_GOALS') {
      await send(
        [a.employee_id],
        'APPRAISAL_GOALS_AGREED',
        `Your goals are agreed: ${a.cycle_name}`,
        'Your manager agreed your goals.',
        'Your manager has agreed your goals for the year.',
      );
    } else if (action === 'RETURN_GOALS') {
      await send(
        [a.employee_id],
        'APPRAISAL_GOALS_RETURNED',
        `Your goals were sent back: ${a.cycle_name}`,
        'See your manager’s comment, change them and send them again.',
        'Your manager has asked you to change your goals.',
      );
    } else if (action === 'MID_SELF') {
      await send(
        await managerOrHr(),
        'APPRAISAL_MID_TO_REVIEW',
        `Mid-year review: ${who}`,
        'Add your mid-year comments.',
        `${who} has recorded their mid-year progress.`,
      );
    } else if (action === 'MID_MANAGER') {
      await send(
        [a.employee_id],
        'APPRAISAL_MID_DONE',
        `Mid-year review done: ${a.cycle_name}`,
        'Your manager added their mid-year comments.',
        'Your manager has completed your mid-year review.',
      );
    } else if (action === 'FINAL_SELF' || action === 'RETURN_TO_MANAGER') {
      await send(
        await managerOrHr(),
        action === 'FINAL_SELF' ? 'APPRAISAL_FINAL_TO_RATE' : 'APPRAISAL_RETURNED_TO_MANAGER',
        `Year-end appraisal${action === 'RETURN_TO_MANAGER' ? ' sent back by HR' : ''}: ${who}`,
        action === 'FINAL_SELF'
          ? 'Rate each goal and give your overall comments.'
          : 'See HR’s comment and look at it again.',
        action === 'FINAL_SELF'
          ? `${who} has completed their year-end self-assessment.`
          : `HR has sent ${who}’s appraisal back to you.`,
      );
    } else if (action === 'FINAL_MANAGER') {
      await send(
        await moduleHolders(trx, 'performance', ['performance.signoff'], [a.employee_id]),
        'APPRAISAL_TO_SIGN_OFF',
        `Appraisal to sign off: ${who}`,
        `Overall ${row.overall_score} (${ratingText(row.overall_score)}).`,
        `${who}’s manager has completed their year-end appraisal.`,
      );
    } else if (action === 'SIGN_OFF') {
      await send(
        [a.employee_id, a.manager_id],
        'APPRAISAL_SIGNED_OFF',
        `Appraisal signed off: ${a.cycle_name}`,
        `${who}’s appraisal is complete.`,
        `HR has signed off ${who}’s appraisal for ${a.cycle_name}.`,
      );
    }
  }

  // ── Probation reviews ────────────────────────────────────────────────────────────────────────
  const probationRows = (k = db) =>
    k('probation_reviews as p')
      .join('employees as e', 'e.id', 'p.employee_id')
      .leftJoin('employees as m', 'm.id', 'p.manager_id')
      .leftJoin('employees as h', 'h.id', 'p.decided_by')
      .leftJoin('departments as d', 'd.id', 'e.department_id')
      .select(
        'p.*',
        'e.first_name',
        'e.last_name',
        'e.job_title',
        'e.employment_start_date',
        'e.probation_status',
        'd.name as department',
        'm.first_name as m_first',
        'm.last_name as m_last',
        'h.first_name as h_first',
        'h.last_name as h_last',
      );
  const probationView = (p) => ({
    id: p.id,
    employee: {
      id: p.employee_id,
      name: name(p.first_name, p.last_name),
      firstName: p.first_name,
      lastName: p.last_name,
      jobTitle: p.job_title,
      department: p.department,
      startDate: p.employment_start_date,
      probationStatus: p.probation_status,
    },
    manager: p.manager_id ? { id: p.manager_id, name: name(p.m_first, p.m_last) } : null,
    probationEndDate: p.probation_end_date,
    status: p.status,
    ratings: {
      work: p.rating_work,
      conduct: p.rating_conduct,
      attendance: p.rating_attendance,
      learning: p.rating_learning,
    },
    managerComment: p.manager_comment,
    recommendation: p.recommendation,
    recommendedExtendTo: p.recommended_extend_to,
    managerDoneAt: p.manager_done_at,
    decision: p.decision,
    extendedTo: p.extended_to,
    hrComment: p.hr_comment,
    decidedBy: p.decided_by ? name(p.h_first, p.h_last) : null,
    decidedAt: p.decided_at,
    createdAt: p.created_at,
  });
  const probationRelation = (u, p) => ({
    manager: p.manager_id === u.id || (!p.manager_id && can(u, 'performance.probation')),
    hr: can(u, 'performance.probation') && p.employee_id !== u.id,
    sees:
      p.manager_id === u.id ||
      ((can(u, 'performance.probation') || can(u, 'performance.view_all')) && p.employee_id !== u.id),
  });

  router.get(
    '/probation',
    asyncHandler(async (req, res) => {
      const all =
        (can(req.user, 'performance.probation') || can(req.user, 'performance.view_all')) &&
        req.query.scope !== 'mine';
      const rows = await probationRows()
        .modify((q) =>
          all ? q.whereNot('p.employee_id', req.user.id) : q.where('p.manager_id', req.user.id),
        )
        .orderByRaw("FIELD(p.status, 'PENDING_MANAGER', 'PENDING_HR', 'COMPLETED')")
        .orderBy('p.probation_end_date')
        .limit(1000);
      // Employees whose probation ends soon with no review yet, for HR to start one.
      const due = can(req.user, 'performance.probation')
        ? await db('employees as e')
            .leftJoin('departments as d', 'd.id', 'e.department_id')
            .where('e.status', 'ACTIVE')
            .whereIn('e.probation_status', ['ON_PROBATION', 'EXTENDED'])
            .whereNotNull('e.probation_end_date')
            .whereNotExists(
              db('probation_reviews as p')
                .whereRaw('p.employee_id = e.id')
                .whereRaw('p.probation_end_date = e.probation_end_date'),
            )
            .orderBy('e.probation_end_date')
            .limit(200)
            .select('e.id', 'e.first_name', 'e.last_name', 'e.probation_end_date', 'd.name as department')
        : [];
      res.json({
        items: rows.map(probationView),
        all,
        canDecide: can(req.user, 'performance.probation'),
        notStarted: due.map((e) => ({
          id: e.id,
          name: name(e.first_name, e.last_name),
          firstName: e.first_name,
          lastName: e.last_name,
          department: e.department,
          probationEndDate: e.probation_end_date,
        })),
      });
    }),
  );

  router.post(
    '/probation',
    asyncHandler(async (req, res) => {
      if (!can(req.user, 'performance.probation')) throw forbidden();
      const { employeeId } = z.object({ employeeId: z.coerce.number().int().positive() }).parse(req.body);
      const e = await db('employees').where({ id: employeeId, status: 'ACTIVE' }).first();
      if (!e?.probation_end_date)
        throw badRequest('This employee has no probation end date on their record.');
      const id = await db.transaction(async (trx) => {
        const exists = await trx('probation_reviews')
          .where({ employee_id: employeeId, probation_end_date: e.probation_end_date })
          .first('id');
        if (exists) throw conflict('A probation review for this probation period already exists.');
        const [newId] = await trx('probation_reviews').insert({
          employee_id: employeeId,
          manager_id: e.line_manager_id,
          probation_end_date: e.probation_end_date,
          started_by: req.user.id,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'PROBATION_REVIEW_STARTED',
          entityType: 'probation_review',
          entityId: newId,
          after: { employeeId, probationEndDate: e.probation_end_date },
        });
        if (e.line_manager_id && e.line_manager_id !== req.user.id) {
          await notify(trx, {
            recipients: [e.line_manager_id],
            event: 'PROBATION_REVIEW_DUE',
            title: `Probation review: ${name(e.first_name, e.last_name)}`,
            body: `Probation ends ${e.probation_end_date}. Complete the review and recommend an outcome.`,
            link: `/performance/probation/${newId}`,
            entityType: 'probation_review',
            entityId: newId,
            email: {
              ...EMAIL,
              subject: `Probation review: ${name(e.first_name, e.last_name)}`,
              heading: 'Probation review due',
              intro: `${name(e.first_name, e.last_name)}’s probation ends on ${e.probation_end_date}.`,
              action:
                'Please complete the review in the performance system: confirm, extend or do not confirm.',
            },
          });
        }
        return newId;
      });
      res.status(201).json({ id });
    }),
  );

  async function loadProbation(id, u, k = db) {
    const p = await probationRows(k).where('p.id', id).first();
    if (!p) throw notFound('Probation review not found.');
    const r = probationRelation(u, p);
    if (!r.sees) throw notFound('Probation review not found.');
    return { p, r };
  }
  router.get(
    '/probation/:id',
    asyncHandler(async (req, res) => {
      const { p, r } = await loadProbation(idParam(req), req.user);
      res.json({
        ...probationView(p),
        can: {
          review: p.status === 'PENDING_MANAGER' && r.manager,
          decide: p.status === 'PENDING_HR' && r.hr,
        },
      });
    }),
  );

  const outcome = z.enum(['CONFIRM', 'EXTEND', 'NOT_CONFIRM']);
  const managerSchema = z.object({
    ratings: z.object({ work: rating, conduct: rating, attendance: rating, learning: rating }),
    comment: requiredText(4000),
    recommendation: outcome,
    extendTo: isoDate.nullish().or(z.literal('').transform(() => null)),
  });
  router.post(
    '/probation/:id/manager',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = managerSchema.parse(req.body);
      await db.transaction(async (trx) => {
        await trx('probation_reviews').where({ id }).forUpdate().first('id');
        const { p, r } = await loadProbation(id, req.user, trx);
        if (p.status !== 'PENDING_MANAGER' || !r.manager)
          throw conflict('This review is not waiting for you.');
        if (
          input.recommendation === 'EXTEND' &&
          (!input.extendTo || input.extendTo <= p.probation_end_date)
        ) {
          throw badRequest('Give the new probation end date, after the current one.');
        }
        await trx('probation_reviews')
          .where({ id })
          .update({
            rating_work: input.ratings.work,
            rating_conduct: input.ratings.conduct,
            rating_attendance: input.ratings.attendance,
            rating_learning: input.ratings.learning,
            manager_comment: input.comment,
            recommendation: input.recommendation,
            recommended_extend_to: input.recommendation === 'EXTEND' ? input.extendTo : null,
            manager_done_at: trx.fn.now(),
            status: 'PENDING_HR',
          });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'PROBATION_REVIEW_RECOMMENDED',
          entityType: 'probation_review',
          entityId: id,
          after: { recommendation: input.recommendation, extendTo: input.extendTo },
        });
        const who = name(p.first_name, p.last_name);
        await notify(trx, {
          recipients: await moduleHolders(
            trx,
            'performance',
            ['performance.probation'],
            [p.employee_id, req.user.id],
          ),
          event: 'PROBATION_TO_DECIDE',
          title: `Probation decision: ${who}`,
          body: `The manager recommends: ${{ CONFIRM: 'confirm', EXTEND: 'extend', NOT_CONFIRM: 'do not confirm' }[input.recommendation]}.`,
          link: `/performance/probation/${id}`,
          entityType: 'probation_review',
          entityId: id,
          email: {
            ...EMAIL,
            subject: `Probation decision: ${who}`,
            heading: 'Probation decision needed',
            intro: `${who}’s manager has completed their probation review.`,
            rows: [['Probation Ends', p.probation_end_date]],
            action: 'Please make the final decision in the performance system.',
          },
        });
      });
      res.json({ id });
    }),
  );

  const decideSchema = z.object({
    decision: outcome,
    extendTo: isoDate.nullish().or(z.literal('').transform(() => null)),
    comment: optionalText(4000),
  });
  router.post(
    '/probation/:id/decide',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = decideSchema.parse(req.body);
      await db.transaction(async (trx) => {
        await trx('probation_reviews').where({ id }).forUpdate().first('id');
        const { p, r } = await loadProbation(id, req.user, trx);
        if (p.status !== 'PENDING_HR' || !r.hr)
          throw conflict('This review is not waiting for your decision.');
        if (input.decision === 'EXTEND' && (!input.extendTo || input.extendTo <= p.probation_end_date)) {
          throw badRequest('Give the new probation end date, after the current one.');
        }
        if (input.decision !== p.recommendation && !input.comment) {
          throw badRequest('Say why the decision differs from the manager’s recommendation.');
        }
        await trx('probation_reviews')
          .where({ id })
          .update({
            decision: input.decision,
            extended_to: input.decision === 'EXTEND' ? input.extendTo : null,
            hr_comment: input.comment,
            decided_by: req.user.id,
            decided_at: trx.fn.now(),
            status: 'COMPLETED',
          });
        // The employee record follows the decision (D115).
        const audit = { ...auditContext(req), historyReason: 'Probation review' };
        if (input.decision === 'CONFIRM') {
          await updateEmployee(
            trx,
            p.employee_id,
            updateEmployeeSchema.parse({ probationStatus: 'CONFIRMED' }),
            audit,
          );
        } else if (input.decision === 'EXTEND') {
          await updateEmployee(
            trx,
            p.employee_id,
            updateEmployeeSchema.parse({ probationStatus: 'EXTENDED', probationEndDate: input.extendTo }),
            audit,
          );
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: `PROBATION_${input.decision}`,
          entityType: 'probation_review',
          entityId: id,
          after: input,
        });
        const who = name(p.first_name, p.last_name);
        const text = {
          CONFIRM: 'confirmed in their position',
          EXTEND: `on extended probation until ${input.extendTo}`,
          NOT_CONFIRM: 'not confirmed',
        }[input.decision];
        await notify(trx, {
          recipients: [p.manager_id].filter((x) => x && x !== req.user.id),
          event: 'PROBATION_DECIDED',
          title: `Probation decided: ${who}`,
          body: `${who} is ${text}.${input.decision === 'NOT_CONFIRM' ? ' HR will arrange the next steps.' : ''}`,
          link: `/performance/probation/${id}`,
          entityType: 'probation_review',
          entityId: id,
        });
        // The employee hears of a confirmation or an extension; not being confirmed is told in person.
        if (input.decision !== 'NOT_CONFIRM') {
          await notify(trx, {
            recipients: [p.employee_id],
            event: 'PROBATION_OUTCOME',
            title:
              input.decision === 'CONFIRM'
                ? 'Your probation is complete'
                : 'Your probation has been extended',
            body:
              input.decision === 'CONFIRM'
                ? 'Congratulations: you are confirmed in your position.'
                : `Your probation now ends on ${input.extendTo}. Your manager will talk it through with you.`,
            link: '/profile',
            entityType: 'probation_review',
            entityId: id,
            email: {
              ...EMAIL,
              subject:
                input.decision === 'CONFIRM'
                  ? 'Your probation is complete'
                  : 'Your probation has been extended',
              heading: input.decision === 'CONFIRM' ? 'Probation complete' : 'Probation extended',
              intro:
                input.decision === 'CONFIRM'
                  ? 'Congratulations: you are confirmed in your position.'
                  : `Your probation has been extended until ${input.extendTo}. Your manager will talk it through with you.`,
            },
          });
        }
      });
      res.json({ id });
    }),
  );

  // Run the daily start of probation reviews now (HR), e.g. after setting probation dates.
  router.post(
    '/probation/run',
    asyncHandler(async (req, res) => {
      if (!can(req.user, 'performance.probation')) throw forbidden();
      res.json({ started: await startDueProbationReviews(db, todayInLusaka()) });
    }),
  );

  // ── Dashboard ────────────────────────────────────────────────────────────────────────────────
  router.get(
    '/summary',
    asyncHandler(async (req, res) => {
      const current = await db('review_cycles')
        .whereIn('status', ['GOAL_SETTING', 'MID_YEAR', 'YEAR_END'])
        .orderBy('year', 'desc')
        .orderBy('id', 'desc');
      const mine = await appraisalRows()
        .where('a.employee_id', req.user.id)
        .whereIn(
          'a.cycle_id',
          current.map((c) => c.id),
        );
      const team = await appraisalRows()
        .where('a.manager_id', req.user.id)
        .whereIn(
          'a.cycle_id',
          current.map((c) => c.id),
        )
        .orderBy(['e.first_name', 'e.last_name']);
      const all = can(req.user, 'performance.view_all')
        ? await cycleProgress(current.map((c) => c.id))
        : new Map();
      res.json({
        cycles: current.map((c) => cycleView(c, all.get(c.id))),
        mine: mine.map(summaryView),
        team: team.map(summaryView),
      });
    }),
  );

  return router;
}
