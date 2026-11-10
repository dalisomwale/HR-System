import fs from 'node:fs';
import express, { Router } from 'express';
import { z } from 'zod';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, idParam, pagination } from '../../utils/validation.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { isDepartmentSide, myTurn, need, servesCompany, visibleTo, waitingFor } from './access.js';
import { ACTIONS, OPEN, ORDER, STAGES, logEvent, move, notifyStage, ref } from './workflow.js';
import { MAX_BYTES, VIEWABLE, checkFile, filePath, storeFile } from './files.js';

const MAX_QUOTES = 10;
const MAX_DOCS = 5;

const raiseSchema = z.object({
  itemName: z.string().trim().min(2, 'needs at least 2 characters').max(200),
  categoryId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(100000),
  reason: z.string().trim().min(3, 'needs at least 3 characters').max(500),
  isIt: z.boolean().default(false),
  companyId: z.coerce.number().int().positive().nullish(),
  departmentId: z.coerce.number().int().positive().nullish(),
});

const actionSchema = z.object({
  action: z.enum([
    'TO_DIRECTOR',
    'BACK_TO_IT',
    'APPROVE',
    'REJECT',
    'TO_AM',
    'AM_APPROVE',
    'AM_REJECT',
    'CFO_APPROVE',
    'CFO_REJECT',
    'CANCEL',
  ]),
  note: z.string().trim().max(1000).optional().default(''),
  quoteId: z.coerce.number().int().positive().optional(),
});

const TABS = {
  mine: { label: 'Waiting for me' },
  progress: {
    label: 'In progress',
    where: (q) => q.whereNotIn('r.status', ['PAID', 'RECEIVED', 'CANCELLED']),
  },
  paid: { label: 'Paid', where: (q) => q.where('r.status', 'PAID') },
  received: { label: 'Received', where: (q) => q.where('r.status', 'RECEIVED') },
  cancelled: { label: 'Cancelled', where: (q) => q.where('r.status', 'CANCELLED') },
  all: { label: 'All', where: () => {} },
};

const personName = (first, last, fallback) => [first, last].filter(Boolean).join(' ') || fallback || null;

function baseQuery(db) {
  return db('requisitions as r')
    .leftJoin('employees as e', 'e.id', 'r.requested_by')
    .leftJoin('stock_categories as c', 'c.id', 'r.category_id')
    .leftJoin('departments as d', 'd.id', 'r.department_id')
    .leftJoin('companies as co', 'co.id', 'r.company_id')
    .leftJoin('stock_branches as b', 'b.id', 'r.branch_id');
}

function view(r, ctx) {
  const open = OPEN.includes(r.status);
  return {
    id: r.id,
    ref: ref(r.id),
    itemName: r.item_name,
    itemId: r.item_id,
    quantity: r.quantity,
    reason: r.reason,
    isIt: Boolean(r.is_it),
    status: r.status,
    statusLabel: STAGES[r.status]?.label ?? r.status,
    waitingFor: STAGES[r.status]?.who ?? '',
    stageAt: r.stage_at,
    createdAt: r.created_at,
    category: r.category_name ? { id: r.category_id, name: r.category_name } : null,
    company: r.company_name ? { id: r.company_id, name: r.company_name } : null,
    department: r.dept_name
      ? { id: r.department_id, name: r.dept_name }
      : r.department_name
        ? { id: null, name: r.department_name }
        : null,
    branch: r.branch_name ? { id: r.branch_id, name: r.branch_name } : null,
    raisedBy: personName(r.first_name, r.last_name, r.requested_by_name),
    supplier: r.supplier,
    quoteCount: r.quotes === undefined ? undefined : Number(r.quotes),
    yourTurn: open && myTurn(ctx, r),
  };
}

export function requisitionRoutes({ db, config, logger }) {
  const router = Router();
  router.use(need((c) => c.canOpen, 'You do not have access to Requisitions.'));

  // What the signed-in person can do here: the client builds its menus from this.
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const waiting = await db('requisitions as r')
        .where(visibleTo(c))
        .andWhere(waitingFor(c))
        .whereIn('r.status', OPEN)
        .count({ n: '*' })
        .first();
      res.json({
        canRaise: c.canRaise,
        raiseAny: c.raiseAny,
        it: c.it,
        accounts: c.accounts,
        accountsManager: c.accountsManager,
        director: c.isDirector,
        cfo: c.isCfo,
        stores: c.stores,
        viewAll: c.viewAll,
        admin: c.isAdmin,
        stock: c.canSeeStock,
        stockDepartment: c.stockDepartment,
        receive: c.receive,
        issue: c.issue,
        itemsManage: c.itemsManage,
        categoriesManage: c.categoriesManage,
        transactions: c.transactions,
        reports: c.reports,
        orgAdmin: c.orgAdmin,
        usersAdmin: c.usersAdmin,
        rolesAdmin: c.rolesAdmin,
        role: c.inventoryRole,
        waiting: Number(waiting.n),
      });
    }),
  );

  // Choices for the raise form.
  router.get(
    '/options',
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const categories = await db('stock_categories').orderBy('name').select('id', 'name');
      const items = await db('stock_items').orderBy('name').distinct().pluck('name');
      const depts = await db('departments as d')
        .join('companies as co', 'co.id', 'd.company_id')
        .where({ 'd.is_active': true, 'co.is_active': true })
        .modify((q) => {
          if (!c.raiseAny) q.where('d.id', c.departmentId ?? 0);
        })
        .orderBy(['co.name', 'd.name'])
        .select('d.id', 'd.name', 'd.company_id', 'co.name as company_name');
      const companies = c.raiseAny
        ? await db('companies').where({ is_active: true }).orderBy('name').select('id', 'name')
        : [...new Map(depts.map((d) => [d.company_id, { id: d.company_id, name: d.company_name }])).values()];
      res.json({
        categories,
        items,
        companies,
        departments: depts.map((d) => ({ id: d.id, name: d.name, companyId: d.company_id })),
        myDepartmentId: c.raiseAny ? null : c.departmentId,
      });
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const companyId = Number(req.query.companyId) || null;
      const visible = (q) => {
        q.where(visibleTo(c));
        if (companyId) q.where('r.company_id', companyId);
      };
      const counts = {};
      for (const [k, t] of Object.entries(TABS)) {
        const q = db('requisitions as r').where(visible);
        if (k === 'mine') q.where(waitingFor(c)).whereIn('r.status', OPEN);
        else t.where(q);
        counts[k] = Number((await q.count({ n: '*' }).first()).n);
      }
      const tab = TABS[req.query.tab] ? req.query.tab : counts.mine ? 'mine' : 'progress';
      const { page, pageSize, offset } = pagination(req.query, { defaultSize: 50, maxSize: 200 });
      const list = baseQuery(db).where(visible);
      if (tab === 'mine') list.where(waitingFor(c)).whereIn('r.status', OPEN);
      else TABS[tab].where(list);
      const rows = await list
        .select(
          'r.*',
          'e.first_name',
          'e.last_name',
          'c.name as category_name',
          'd.name as dept_name',
          'co.name as company_name',
          'b.name as branch_name',
          db.raw(
            "(SELECT COUNT(*) FROM requisition_files f WHERE f.requisition_id = r.id AND f.kind = 'QUOTE') as quotes",
          ),
        )
        .orderByRaw(`FIELD(r.status, ${ORDER.map(() => '?').join(',')})`, ORDER)
        .orderBy('r.created_at', 'desc')
        .limit(pageSize)
        .offset(offset);
      // Companies in what this person can see, for the filter.
      const companies = await db('requisitions as r')
        .join('companies as co', 'co.id', 'r.company_id')
        .where(visibleTo(c))
        .distinct('co.id', 'co.name')
        .orderBy('co.name');
      res.json({
        tab,
        tabs: Object.entries(TABS).map(([id, t]) => ({ id, label: t.label, count: counts[id] })),
        items: rows.map((r) => view(r, c)),
        total: counts[tab],
        page,
        pageSize,
        companies,
      });
    }),
  );

  // Raise a requisition. Supporting files are uploaded straight after, to /:id/files?kind=doc.
  router.post(
    '/',
    need((c) => c.canRaise, "You can't raise requisitions."),
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const input = raiseSchema.parse(req.body);
      const category = await db('stock_categories').where({ id: input.categoryId }).first('id', 'name');
      if (!category) throw badRequest('Choose a category.');

      let dept = null;
      let companyId = null;
      if (c.raiseAny) {
        if (!input.companyId) throw badRequest('Choose the company.');
        const company = await db('companies').where({ id: input.companyId, is_active: true }).first('id');
        if (!company) throw badRequest('Choose the company.');
        companyId = company.id;
        const hasDepts = await db('departments')
          .where({ company_id: companyId, is_active: true })
          .first('id');
        if (hasDepts) {
          dept = await db('departments')
            .where({ id: input.departmentId ?? 0, company_id: companyId, is_active: true })
            .first('id', 'name', 'company_id');
          if (!dept) throw badRequest('Choose the department that needs this.');
        }
      } else {
        // Your department as Employee management has it now, open and in an open company.
        dept = await db('departments as d')
          .join('companies as co', 'co.id', 'd.company_id')
          .where({ 'd.id': c.departmentId ?? 0, 'd.is_active': true, 'co.is_active': true })
          .first('d.id', 'd.name', 'd.company_id');
        if (!dept) {
          throw badRequest(
            'Your department is not set or has been closed in Employee management, so you cannot raise a requisition.',
          );
        }
        companyId = dept.company_id;
      }

      const dup = await db('requisitions')
        .whereRaw('LOWER(item_name) = LOWER(?)', [input.itemName])
        .where((q) => (dept ? q.where('department_id', dept.id) : q.whereNull('department_id')))
        .whereIn('status', OPEN)
        .first('id');
      if (dup) {
        throw conflict(
          `There is already an open requisition for "${input.itemName}"${dept ? ` for ${dept.name}` : ''} (${ref(dup.id)}).`,
        );
      }
      const item = await db('stock_items')
        .whereRaw('LOWER(name) = LOWER(?)', [input.itemName])
        .where({ category_id: category.id })
        .first('id');
      const status = input.isIt ? 'QUOTES_IT' : 'QUOTES_DEPT';

      const id = await db.transaction(async (trx) => {
        const [newId] = await trx('requisitions').insert({
          item_name: input.itemName,
          item_id: item?.id ?? null,
          category_id: category.id,
          quantity: input.quantity,
          reason: input.reason,
          company_id: companyId,
          department_id: dept?.id ?? null,
          is_it: input.isIt,
          status,
          stage_at: trx.fn.now(),
          requested_by: c.id,
        });
        await logEvent(trx, {
          requisitionId: newId,
          actorId: c.id,
          action: 'RAISED',
          to: status,
          note: input.isIt ? 'IT-related' : null,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'REQUISITION_RAISED',
          entityType: 'requisition',
          entityId: newId,
          after: { itemName: input.itemName, quantity: input.quantity, departmentId: dept?.id ?? null },
        });
        const r = await trx('requisitions').where({ id: newId }).first();
        await notifyStage(trx, r, status, c.id);
        return newId;
      });
      res.status(201).json({ id, ref: ref(id), status });
    }),
  );

  async function load(id, c) {
    const r = await baseQuery(db)
      .where('r.id', id)
      .where(visibleTo(c))
      .first(
        'r.*',
        'e.first_name',
        'e.last_name',
        'c.name as category_name',
        'd.name as dept_name',
        'co.name as company_name',
        'b.name as branch_name',
      );
    if (!r) throw notFound("That requisition doesn't exist, or you don't have access to it.");
    return r;
  }

  function abilities(c, r, quotes) {
    const deptSide = isDepartmentSide(c, r) || c.isAdmin;
    const canQuote =
      (r.status === 'QUOTES_IT' && servesCompany(c, 'IT', r.company_id)) ||
      (['QUOTES_DEPT', 'RETURNED'].includes(r.status) && deptSide);
    const accounts = servesCompany(c, 'ACCOUNTS', r.company_id);
    return {
      addQuote: canQuote && quotes < MAX_QUOTES,
      removeQuote: canQuote,
      addDoc: ['QUOTES_IT', 'QUOTES_DEPT', 'RETURNED'].includes(r.status) && deptSide,
      toDirector: canQuote && quotes > 0,
      backToIt: r.status === 'RETURNED' && deptSide && Boolean(r.is_it),
      approve: r.status === 'DIRECTOR' && c.isDirector,
      reject: r.status === 'DIRECTOR' && c.isDirector,
      toAm: r.status === 'ACCOUNTS' && accounts,
      amApprove: r.status === 'ACCOUNTS_MANAGER' && c.accountsManager && accounts,
      amReject: r.status === 'ACCOUNTS_MANAGER' && c.accountsManager && accounts,
      cfoApprove: r.status === 'CFO' && c.isCfo,
      cfoReject: r.status === 'CFO' && c.isCfo,
      pop: r.status === 'PAY' && accounts,
      receive: r.status === 'PAID' && servesCompany(c, 'STORES', r.company_id),
      cancel: ['QUOTES_IT', 'QUOTES_DEPT', 'RETURNED', 'DIRECTOR'].includes(r.status) && deptSide,
    };
  }

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const r = await load(idParam(req), c);
      const files = await db('requisition_files as f')
        .leftJoin('employees as e', 'e.id', 'f.uploaded_by')
        .where('f.requisition_id', r.id)
        .orderBy('f.created_at')
        .orderBy('f.id')
        .select('f.*', 'e.first_name', 'e.last_name');
      const events = await db('requisition_events as v')
        .leftJoin('employees as e', 'e.id', 'v.actor_id')
        .where('v.requisition_id', r.id)
        .orderBy('v.created_at')
        .orderBy('v.id')
        .select('v.*', 'e.first_name', 'e.last_name', 'e.job_title');
      const fileView = (f) => ({
        id: f.id,
        kind: f.kind,
        supplier: f.supplier,
        amount: f.amount === null ? null : Number(f.amount),
        name: f.original_name,
        sizeBytes: f.size_bytes,
        viewable: VIEWABLE.includes(f.mime_type),
        uploadedBy: personName(f.first_name, f.last_name, f.uploaded_by_name),
        uploadedAt: f.created_at,
        approved: f.kind === 'QUOTE' && f.id === r.quote_id,
      });
      const quotes = files.filter((f) => f.kind === 'QUOTE');
      const approved = quotes.find((q) => q.id === r.quote_id);
      const last = events.at(-1);
      res.json({
        ...view(r, c),
        lastNote: r.last_note,
        // The latest rejection or cancellation, shown as a warning on the page.
        rejection:
          last &&
          ['REJECTED', 'AM_REJECTED', 'CFO_REJECTED', 'CANCELLED'].includes(last.action) &&
          r.last_note
            ? {
                action: ACTIONS[last.action],
                by: personName(last.first_name, last.last_name, last.actor_name),
                note: r.last_note,
              }
            : null,
        approvedQuote: approved ? { supplier: approved.supplier, amount: Number(approved.amount) } : null,
        quotes: quotes.map(fileView),
        docs: files.filter((f) => f.kind === 'DOC').map(fileView),
        pops: files.filter((f) => f.kind === 'POP').map(fileView),
        events: events.map((v) => ({
          id: v.id,
          action: v.action,
          label: ACTIONS[v.action] ?? v.action,
          by: personName(v.first_name, v.last_name, v.actor_name),
          jobTitle: v.job_title,
          note: v.note,
          at: v.created_at,
        })),
        can: abilities(c, r, quotes.length),
      });
    }),
  );

  router.post(
    '/:id/actions',
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const input = actionSchema.parse(req.body);
      const r = await load(idParam(req), c);
      const quotes = await db('requisition_files').where({ requisition_id: r.id, kind: 'QUOTE' }).select('*');
      const can = abilities(c, r, quotes.length);
      const note = input.note;
      const reason = () => {
        if (note.length < 3) throw badRequest('Please give a reason (at least 3 characters).');
      };
      const refused = () => forbidden("It isn't your turn on this requisition.");
      let to;
      let action;
      let set = {};
      switch (input.action) {
        case 'TO_DIRECTOR':
          if (!can.toDirector) {
            throw can.removeQuote
              ? badRequest('Attach at least one quotation before sending it to the Director.')
              : refused();
          }
          to = 'DIRECTOR';
          action = r.status === 'RETURNED' ? 'RESUBMITTED' : 'TO_DIRECTOR';
          break;
        case 'BACK_TO_IT':
          if (!can.backToIt) throw refused();
          to = 'QUOTES_IT';
          action = 'BACK_TO_IT';
          break;
        case 'APPROVE': {
          if (!can.approve)
            throw forbidden('Only a Director can approve this, while it is waiting for approval.');
          const q = quotes.find((x) => x.id === input.quoteId);
          if (!q) throw badRequest('Choose the quotation you are approving.');
          to = 'ACCOUNTS';
          action = 'APPROVED';
          set = { quote_id: q.id, supplier: q.supplier, director_at: db.fn.now(), approved_by: c.id };
          input.note = `Quotation: ${q.supplier}, K${Number(q.amount).toLocaleString('en-ZM', { minimumFractionDigits: 2 })}${note ? `. ${note}` : ''}`;
          break;
        }
        case 'REJECT':
          if (!can.reject)
            throw forbidden('Only a Director can reject this, while it is waiting for approval.');
          reason();
          to = 'RETURNED';
          action = 'REJECTED';
          break;
        case 'TO_AM':
          if (!can.toAm) throw refused();
          to = 'ACCOUNTS_MANAGER';
          action = 'TO_AM';
          break;
        case 'AM_APPROVE':
          if (!can.amApprove) throw refused();
          to = 'CFO';
          action = 'AM_APPROVED';
          break;
        case 'AM_REJECT':
          if (!can.amReject) throw refused();
          reason();
          to = 'ACCOUNTS';
          action = 'AM_REJECTED';
          break;
        case 'CFO_APPROVE':
          if (!can.cfoApprove) throw refused();
          to = 'PAY';
          action = 'CFO_APPROVED';
          break;
        case 'CFO_REJECT':
          if (!can.cfoReject) throw refused();
          reason();
          to = 'ACCOUNTS_MANAGER';
          action = 'CFO_REJECTED';
          break;
        case 'CANCEL':
          if (!can.cancel) {
            throw forbidden('It can only be cancelled by the department, before the Director approves it.');
          }
          reason();
          to = 'CANCELLED';
          action = 'CANCELLED';
          break;
        default:
          throw badRequest('Unknown action.');
      }
      await db.transaction(async (trx) => {
        await move(trx, r, { to, action, actorId: c.id, note: input.note || null, set });
        await writeAudit(trx, {
          ...auditContext(req),
          action: `REQUISITION_${action}`,
          entityType: 'requisition',
          entityId: r.id,
          before: { status: r.status },
          after: { status: to, note: input.note || null },
        });
        await notifyStage(trx, r, to, c.id);
      });
      res.json({ id: r.id, status: to, statusLabel: STAGES[to].label });
    }),
  );

  // Files: quotations (?kind=quote&supplier=&amount=), supporting documents (?kind=doc) and the
  // proof of payment (?kind=pop&note=), which also moves the requisition to Paid.
  const rawBody = express.raw({ type: () => true, limit: MAX_BYTES });
  router.post(
    '/:id/files',
    (req, res, next) =>
      rawBody(req, res, (err) =>
        next(
          err?.type === 'entity.too.large'
            ? new AppError(413, 'FILE_TOO_LARGE', 'The file is too big. The limit is 10 MB.')
            : err,
        ),
      ),
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const r = await load(idParam(req), c);
      const kind = { quote: 'QUOTE', doc: 'DOC', pop: 'POP' }[req.query.kind];
      if (!kind) throw badRequest('Unknown file kind.');
      const quotes = Number(
        (
          await db('requisition_files')
            .where({ requisition_id: r.id, kind: 'QUOTE' })
            .count({ n: '*' })
            .first()
        ).n,
      );
      const can = abilities(c, r, quotes);
      let supplier = null;
      let amount = null;
      const note = String(req.query.note ?? '')
        .trim()
        .slice(0, 1000);
      if (kind === 'QUOTE') {
        if (!can.removeQuote) throw forbidden("You can't add quotations at this stage.");
        if (quotes >= MAX_QUOTES) throw conflict(`A requisition can have up to ${MAX_QUOTES} quotations.`);
        supplier = String(req.query.supplier ?? '')
          .trim()
          .slice(0, 200);
        amount = Number(req.query.amount);
        if (supplier.length < 2) throw badRequest('Enter the supplier (at least 2 characters).');
        if (!Number.isFinite(amount) || amount < 0.01 || amount > 1e9) {
          throw badRequest('Enter the amount, more than zero.');
        }
        amount = Math.round(amount * 100) / 100;
      } else if (kind === 'DOC') {
        if (!can.addDoc) throw forbidden("You can't add documents at this stage.");
        const docs = await db('requisition_files')
          .where({ requisition_id: r.id, kind: 'DOC' })
          .count({ n: '*' })
          .first();
        if (Number(docs.n) >= MAX_DOCS) throw conflict(`You can attach up to ${MAX_DOCS} documents.`);
      } else if (!can.pop) {
        throw forbidden('The proof of payment is attached by Accounts after the CFO approves.');
      }
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const file = checkFile(buf, req.get('x-file-name'));
      const stored = await storeFile(config, buf, file.ext);
      try {
        const id = await db.transaction(async (trx) => {
          const [fileId] = await trx('requisition_files').insert({
            requisition_id: r.id,
            kind,
            supplier,
            amount,
            original_name: file.name,
            stored_name: stored.stored,
            mime_type: file.mime,
            size_bytes: buf.length,
            uploaded_by: c.id,
          });
          if (kind === 'POP') {
            await move(trx, r, {
              to: 'PAID',
              action: 'POP_SENT',
              actorId: c.id,
              note: note || null,
              set: { paid_at: trx.fn.now() },
            });
            await notifyStage(trx, r, 'PAID', c.id);
          } else {
            await logEvent(trx, {
              requisitionId: r.id,
              actorId: c.id,
              action: kind === 'QUOTE' ? 'QUOTE_ADDED' : 'DOCS_ADDED',
              note:
                kind === 'QUOTE'
                  ? `${supplier}, K${amount.toLocaleString('en-ZM', { minimumFractionDigits: 2 })}`
                  : file.name,
            });
          }
          await writeAudit(trx, {
            ...auditContext(req),
            action: `REQUISITION_FILE_${kind}`,
            entityType: 'requisition',
            entityId: r.id,
            after: { fileId, name: file.name, supplier, amount },
          });
          return fileId;
        });
        res.status(201).json({ id });
      } catch (err) {
        await stored.discard();
        throw err;
      }
    }),
  );

  router.post(
    '/files/:fileId/remove',
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const f = await db('requisition_files')
        .where({ id: idParam(req, 'fileId') })
        .first();
      if (!f) throw notFound('That file is no longer attached.');
      const r = await load(f.requisition_id, c);
      if (f.kind !== 'QUOTE' || !abilities(c, r, 0).removeQuote) {
        throw forbidden("You can't remove quotations at this stage.");
      }
      await db.transaction(async (trx) => {
        await trx('requisition_files').where({ id: f.id }).del();
        await logEvent(trx, {
          requisitionId: r.id,
          actorId: c.id,
          action: 'QUOTE_REMOVED',
          note: f.supplier,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'REQUISITION_QUOTE_REMOVED',
          entityType: 'requisition',
          entityId: r.id,
          before: { fileId: f.id, supplier: f.supplier, amount: Number(f.amount) },
        });
      });
      await fs.promises.unlink(filePath(config, f.stored_name)).catch(() => {});
      res.json({ ok: true });
    }),
  );

  router.get(
    '/files/:fileId/download',
    asyncHandler(async (req, res) => {
      const f = await db('requisition_files')
        .where({ id: idParam(req, 'fileId') })
        .first();
      if (!f) throw notFound('File not found.');
      await load(f.requisition_id, req.rq);
      let data;
      try {
        data = await fs.promises.readFile(filePath(config, f.stored_name));
      } catch (err) {
        logger?.error({ err, fileId: f.id }, 'Stored requisition file is missing');
        throw new AppError(410, 'FILE_MISSING', 'The stored file could not be found. Contact IT.');
      }
      const inline = req.query.view === '1' && VIEWABLE.includes(f.mime_type);
      const ascii = f.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      res
        .set({
          'Content-Type': f.mime_type,
          'Content-Length': data.length,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(data);
    }),
  );

  return router;
}
