import { Router } from 'express';
import { z } from 'zod';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, idParam, isoDate } from '../../utils/validation.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { toXlsx } from '../reports/export-files.js';
import { FUNCTIONS, need } from './access.js';
import { changeBranchStock, forecast, kwacha, movementCount, runningLow } from './stock.service.js';
import { logEvent, notifyStage, ref } from './workflow.js';

/*
 * Stock (D105): items, categories, branches, receiving, issuing, transactions, monthly reports and
 * the dashboard, as in the inventory system. Stores (and the System Administrator) change stock;
 * directors and the Accounts Director see all of it; managers see what was issued to their own
 * department.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const money = z.coerce.number().min(0).max(100000000);
const count = (min) => z.coerce.number().int().min(min).max(1000000);
const text = (min, max) => z.string().trim().min(min, `needs at least ${min} characters`).max(max);
const optional = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const pastDate = isoDate.refine((d) => d <= todayInLusaka(), 'cannot be in the future');

const sendXlsx = (res, name, columns, rows, title) =>
  res
    .set('Content-Type', XLSX)
    .set('Content-Disposition', `attachment; filename="${name.replace(/[^\w .-]/g, '_')}.xlsx"`)
    .set('Cache-Control', 'private, no-store')
    .send(toXlsx(columns, rows, { sheetName: title.slice(0, 31), title }));

const wantsXlsx = (req) => req.query.format === 'xlsx';
const personName = (first, last, fallback) => [first, last].filter(Boolean).join(' ') || fallback || null;
const monthOf = (q) => {
  const now = todayInLusaka().slice(0, 7);
  const m = /^\d{4}-\d{2}$/.test(String(q ?? '')) ? String(q) : now;
  return m > now ? now : m;
};
const monthEnd = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

export function stockRoutes({ db }) {
  const router = Router();
  // The inventory's access rights (D107); without an inventory role they follow D105.
  const items = need((c) => c.itemsManage, 'You cannot add or change items.');
  const receive = need((c) => c.receive, 'You cannot receive stock.');
  const issue = need((c) => c.issue, 'You cannot issue stock.');
  const categories = need((c) => c.categoriesManage, 'You cannot change categories.');
  const org = need((c) => c.orgAdmin, 'You cannot change branches or requisition departments.');
  const transactions = need((c) => c.transactions, 'You do not have access to transactions.');
  const reports = need((c) => c.reports, 'You do not have access to stock reports.');
  const seeStock = need((c) => c.canSeeStock, 'You do not have access to stock.');

  async function branches({ activeOnly = true } = {}) {
    return db('stock_branches as b')
      .join('companies as co', 'co.id', 'b.company_id')
      .modify((q) => activeOnly && q.where({ 'b.is_active': true, 'co.is_active': true }))
      .orderBy(['co.name', 'b.name'])
      .select('b.id', 'b.name', 'b.location', 'b.is_active', 'b.company_id', 'co.name as company_name');
  }
  const branchView = (b) => ({
    id: b.id,
    name: b.name,
    location: b.location,
    isActive: Boolean(b.is_active),
    companyId: b.company_id,
    company: b.company_name,
  });

  // ── Lookups ──────────────────────────────────────────────────────────────────────────────────
  router.get(
    '/options',
    seeStock,
    asyncHandler(async (req, res) => {
      const [categories, bs, companies, departments] = await Promise.all([
        db('stock_categories').orderBy('name').select('id', 'name', 'description'),
        branches(),
        db('companies').where({ is_active: true }).orderBy('name').select('id', 'name'),
        db('departments as d')
          .join('companies as co', 'co.id', 'd.company_id')
          .where({ 'd.is_active': true, 'co.is_active': true })
          .orderBy(['co.name', 'd.name'])
          .select('d.id', 'd.name', 'd.company_id', 'co.name as company_name'),
      ]);
      res.json({
        categories,
        branches: bs.map(branchView),
        companies,
        departments: departments.map((d) => ({
          id: d.id,
          name: d.name,
          companyId: d.company_id,
          company: d.company_name,
        })),
      });
    }),
  );

  // ── Dashboard ────────────────────────────────────────────────────────────────────────────────
  router.get(
    '/dashboard',
    seeStock,
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const dept = c.stockDepartment;
      const issuedBetween = async (fromDays, toDays) => {
        const q = db('stock_issues')
          .where('created_at', '>=', db.raw('NOW() - INTERVAL ? DAY', [fromDays]))
          .andWhere('created_at', '<', db.raw('NOW() - INTERVAL ? DAY', [toDays]));
        if (dept) q.where('department_id', dept);
        return Number((await q.sum({ q: 'quantity' }).first()).q ?? 0);
      };
      const issued = { current: await issuedBetween(30, 0), previous: await issuedBetween(60, 30) };
      const byCategoryIssued = await db('stock_issues as s')
        .join('stock_items as i', 'i.id', 's.item_id')
        .join('stock_categories as c', 'c.id', 'i.category_id')
        .where('s.created_at', '>=', db.raw('NOW() - INTERVAL 30 DAY'))
        .modify((q) => dept && q.where('s.department_id', dept))
        .groupBy('c.id', 'c.name')
        .select('c.name as label')
        .sum({ value: 's.quantity' })
        .orderBy('value', 'desc');
      const topIssued = await db('stock_issues as s')
        .join('stock_items as i', 'i.id', 's.item_id')
        .where('s.created_at', '>=', db.raw('NOW() - INTERVAL 30 DAY'))
        .modify((q) => dept && q.where('s.department_id', dept))
        .groupBy('i.id', 'i.name')
        .select('i.name as label')
        .sum({ value: 's.quantity' })
        .orderBy('value', 'desc')
        .limit(6);
      const num = (rows) => rows.map((r) => ({ label: r.label, value: Number(r.value) }));
      if (dept) {
        const value = await db('stock_issues as s')
          .join('stock_items as i', 'i.id', 's.item_id')
          .where('s.department_id', dept)
          .where('s.created_at', '>=', db.raw('NOW() - INTERVAL 30 DAY'))
          .sum({ v: db.raw('s.quantity * i.unit_price') })
          .first();
        const items = await db('stock_issues')
          .where({ department_id: dept })
          .countDistinct({ n: 'item_id' })
          .first();
        const name = await db('departments').where({ id: dept }).first('name');
        return res.json({
          scope: 'department',
          department: name?.name ?? null,
          issued,
          valueIssued: Number(value.v ?? 0),
          itemsUsed: Number(items.n),
          byCategoryIssued: num(byCategoryIssued),
          topIssued: num(topIssued),
        });
      }
      const rows = await forecast(db);
      const low = runningLow(rows);
      // Units received and issued per week, Monday-start, for the last 8 weeks.
      const today = new Date(`${todayInLusaka()}T00:00:00Z`);
      const monday = new Date(today);
      monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7) - 7 * 7);
      const from = monday.toISOString().slice(0, 10);
      const weeks = [];
      for (let i = 0; i < 8; i += 1) {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + 7 * i);
        weeks.push({ week: d.toISOString().slice(0, 10), received: 0, issued: 0 });
      }
      for (const [key, table] of [
        ['received', 'stock_receipts'],
        ['issued', 'stock_issues'],
      ]) {
        const wk = await db(table)
          .where('created_at', '>=', from)
          .groupByRaw('wk')
          .select(
            db.raw(
              'DATE_FORMAT(DATE_SUB(DATE(created_at), INTERVAL WEEKDAY(created_at) DAY), "%Y-%m-%d") as wk',
            ),
          )
          .sum({ q: 'quantity' });
        for (const w of wk) {
          const slot = weeks.find((x) => x.week === w.wk);
          if (slot) slot[key] = Number(w.q);
        }
      }
      const valueByCategory = {};
      for (const r of rows) {
        if (r.quantity > 0 && r.unitPrice > 0) {
          valueByCategory[r.category] = (valueByCategory[r.category] ?? 0) + r.quantity * r.unitPrice;
        }
      }
      res.json({
        scope: 'all',
        stockValue: rows.reduce((s, r) => s + Math.max(0, r.quantity) * r.unitPrice, 0),
        issued,
        items: rows.length,
        health: {
          ok: rows.filter((r) => r.state === 'ok').length,
          low: rows.filter((r) => r.state === 'low').length,
          out: rows.filter((r) => r.state === 'out').length,
        },
        needReordering: low.length,
        runningLow: low.slice(0, 10),
        weeks,
        byCategoryIssued: num(byCategoryIssued),
        valueByCategory: Object.entries(valueByCategory)
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value),
        topIssued: num(topIssued),
      });
    }),
  );

  // ── Items (Manage stock) ─────────────────────────────────────────────────────────────────────
  router.get(
    '/items',
    seeStock,
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const q = String(req.query.q ?? '')
        .trim()
        .slice(0, 100)
        .toLowerCase();
      const categoryId = Number(req.query.categoryId) || 0;
      const scopedDept = c.stockDepartment;
      const status = scopedDept
        ? ''
        : ['ok', 'low', 'out', 'soon'].includes(req.query.status)
          ? req.query.status
          : '';
      const all = await branches();
      const companyId = scopedDept ? 0 : Number(req.query.companyId) || 0;
      let branchId = scopedDept ? 0 : Number(req.query.branchId) || 0;
      const departmentId = scopedDept ?? (Number(req.query.departmentId) || 0);
      if (branchId && !all.some((b) => b.id === branchId && (!companyId || b.company_id === companyId)))
        branchId = 0;
      const scope = branchId
        ? [branchId]
        : companyId
          ? all.filter((b) => b.company_id === companyId).map((b) => b.id)
          : null;
      const fc = new Map((await forecast(db, { branchIds: scope })).map((r) => [r.id, r]));
      const items = await db('stock_items as i')
        .join('stock_categories as c', 'c.id', 'i.category_id')
        .select(
          'i.*',
          'c.name as category_name',
          db.raw(
            '(SELECT COUNT(*) FROM stock_receipts WHERE item_id = i.id) + (SELECT COUNT(*) FROM stock_issues WHERE item_id = i.id) as moves',
          ),
        );
      // Initial stock = the item's first delivery (in the chosen branches).
      const firsts = await db('stock_receipts as r')
        .join(
          db('stock_receipts')
            .modify((x) => scope && x.whereIn('branch_id', scope.length ? scope : [0]))
            .groupBy('item_id')
            .select('item_id')
            .min({ id: 'id' })
            .as('f'),
          'f.id',
          'r.id',
        )
        .select('r.item_id', 'r.quantity');
      const initial = new Map(firsts.map((r) => [r.item_id, r.quantity]));
      let issuedTo = null;
      let lastIssued = new Map();
      if (departmentId) {
        const di = await db('stock_issues')
          .where({ department_id: departmentId })
          .groupBy('item_id')
          .select('item_id')
          .sum({ q: 'quantity' })
          .max({ last: 'created_at' });
        issuedTo = new Map(di.map((r) => [r.item_id, Number(r.q)]));
        lastIssued = new Map(di.map((r) => [r.item_id, r.last]));
      }
      const rows = items
        .filter((r) => !issuedTo || issuedTo.get(r.id))
        .map((r) => {
          const f = fc.get(r.id);
          const quantity = f?.quantity ?? r.quantity;
          const issued = issuedTo ? (issuedTo.get(r.id) ?? 0) : null;
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            categoryId: r.category_id,
            category: r.category_name,
            initial: initial.get(r.id) ?? null,
            quantity,
            reorderLevel: r.reorder_level,
            unitPrice: Number(r.unit_price),
            value: (scopedDept ? issued : Math.max(0, quantity)) * Number(r.unit_price),
            issuedToDepartment: issued,
            lastIssued: lastIssued.get(r.id) ?? null,
            daysLeft: f?.daysLeft ?? null,
            state: f?.state ?? 'ok',
            createdAt: r.created_at,
            canDelete: Number(r.moves) === 0,
          };
        });
      const totals = {
        items: rows.length,
        units: rows.reduce((s, r) => s + r.quantity, 0),
        value: rows.reduce((s, r) => s + r.value, 0),
        low: rows.filter((r) => r.state === 'low').length,
        out: rows.filter((r) => r.state === 'out').length,
      };
      let shown = rows.filter((r) => {
        if (q && !`${r.name} ${r.description ?? ''}`.toLowerCase().includes(q)) return false;
        if (categoryId && r.categoryId !== categoryId) return false;
        if (status === 'soon') return r.state === 'ok' && r.daysLeft !== null && r.daysLeft <= 14;
        if (status && r.state !== status) return false;
        return true;
      });
      const sorts = {
        name: (a, b) => a.name.localeCompare(b.name),
        stock: (a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name),
        value: (a, b) => b.value - a.value,
        added: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
        issued: (a, b) =>
          (b.issuedToDepartment ?? 0) - (a.issuedToDepartment ?? 0) || a.name.localeCompare(b.name),
        last: (a, b) => String(b.lastIssued ?? '').localeCompare(String(a.lastIssued ?? '')),
      };
      shown = shown.sort(sorts[req.query.sort] ?? sorts.name);
      const where = scopedDept
        ? 'department'
        : departmentId
          ? 'department'
          : branchId
            ? 'branch'
            : companyId
              ? 'company'
              : 'all';
      if (wantsXlsx(req)) {
        const stateNames = { ok: 'In stock', low: 'Below reorder', out: 'Out of stock' };
        const columns = scopedDept
          ? [
              { key: 'name', label: 'Item' },
              { key: 'category', label: 'Category' },
              { key: 'issuedToDepartment', label: 'Issued to department', type: 'number' },
              { key: 'unitPrice', label: 'Unit price (K)', type: 'number' },
              { key: 'value', label: 'Value (K)', type: 'number' },
              { key: 'lastIssued', label: 'Last issued', type: 'date' },
            ]
          : [
              { key: 'name', label: 'Item' },
              { key: 'description', label: 'Description' },
              { key: 'category', label: 'Category' },
              { key: 'initial', label: 'Initial stock', type: 'number' },
              { key: 'quantity', label: 'In stock', type: 'number' },
              ...(departmentId
                ? [{ key: 'issuedToDepartment', label: 'Issued to department', type: 'number' }]
                : []),
              { key: 'reorderLevel', label: 'Reorder at', type: 'number' },
              { key: 'stateName', label: 'Status' },
              { key: 'unitPrice', label: 'Unit price (K)', type: 'number' },
              { key: 'value', label: 'Value (K)', type: 'number' },
              { key: 'createdAt', label: 'Date added', type: 'date' },
            ];
        const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
        return sendXlsx(
          res,
          `Stock ${todayInLusaka()}`,
          columns,
          shown.map((r) => ({
            ...r,
            stateName: stateNames[r.state],
            createdAt: iso(r.createdAt),
            lastIssued: iso(r.lastIssued),
          })),
          'Stock levels',
        );
      }
      res.json({
        items: shown,
        totals,
        scope: where,
        departmentId: departmentId || null,
        scoped: Boolean(scopedDept),
      });
    }),
  );

  router.get(
    '/items/:id',
    seeStock,
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const item = await db('stock_items as i')
        .join('stock_categories as c', 'c.id', 'i.category_id')
        .where('i.id', idParam(req))
        .first('i.*', 'c.name as category_name');
      if (!item) throw notFound('That item no longer exists.');
      const dept = c.stockDepartment;
      if (dept) {
        const any = await db('stock_issues').where({ item_id: item.id, department_id: dept }).first('id');
        if (!any) throw notFound("That item hasn't been issued to your department.");
      }
      const issues = db('stock_issues as s')
        .leftJoin('employees as e', 'e.id', 's.issued_by')
        .leftJoin('stock_branches as b', 'b.id', 's.branch_id')
        .where('s.item_id', item.id)
        .modify((q) => dept && q.where('s.department_id', dept))
        .select(
          db.raw("'Issued' as type"),
          's.created_at',
          's.quantity',
          's.issued_to as party',
          's.recipient',
          's.purpose',
          's.old_stock',
          's.new_stock',
          'b.name as branch_name',
          'e.first_name',
          'e.last_name',
          's.issued_by_name as by_name',
        );
      const receipts = db('stock_receipts as r')
        .leftJoin('employees as e', 'e.id', 'r.received_by')
        .leftJoin('stock_branches as b', 'b.id', 'r.branch_id')
        .where('r.item_id', item.id)
        .select(
          db.raw("'Received' as type"),
          'r.created_at',
          'r.quantity',
          'r.supplier as party',
          db.raw('NULL as recipient'),
          db.raw('NULL as purpose'),
          'r.old_stock',
          'r.new_stock',
          'b.name as branch_name',
          'e.first_name',
          'e.last_name',
          'r.received_by_name as by_name',
        );
      const history = (dept ? await issues : [...(await issues), ...(await receipts)])
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 200)
        .map((h) => ({
          type: h.type,
          at: h.created_at,
          quantity: h.quantity,
          party: h.party,
          recipient: h.recipient,
          purpose: h.purpose,
          oldStock: h.old_stock,
          newStock: h.new_stock,
          branch: h.branch_name,
          by: personName(h.first_name, h.last_name, h.by_name),
        }));
      const perBranch = dept
        ? []
        : await db('branch_stock as bs')
            .join('stock_branches as b', 'b.id', 'bs.branch_id')
            .join('companies as co', 'co.id', 'b.company_id')
            .where('bs.item_id', item.id)
            .where('bs.quantity', '<>', 0)
            .orderBy(['co.name', 'b.name'])
            .select('b.id', 'b.name', 'co.name as company', 'bs.quantity');
      const f = (await forecast(db)).find((r) => r.id === item.id);
      if (wantsXlsx(req)) {
        return sendXlsx(
          res,
          `Stock history ${item.name} ${todayInLusaka()}`,
          [
            { key: 'at', label: 'Date' },
            { key: 'type', label: 'Type' },
            { key: 'qty', label: 'Qty', type: 'number' },
            { key: 'from', label: 'From' },
            { key: 'to', label: 'To' },
            { key: 'purpose', label: 'Purpose' },
            { key: 'by', label: 'By' },
          ],
          history.map((h) => ({
            at: new Date(h.at).toISOString().replace('T', ' ').slice(0, 16),
            type: h.type,
            qty: h.type === 'Issued' ? -h.quantity : h.quantity,
            from: h.type === 'Issued' ? h.branch : h.party,
            to: h.type === 'Issued' ? h.party : h.branch,
            purpose: h.purpose,
            by: h.by,
          })),
          `Stock history - ${item.name}`,
        );
      }
      const moves = await movementCount(db, item.id);
      res.json({
        id: item.id,
        name: item.name,
        description: item.description,
        categoryId: item.category_id,
        category: item.category_name,
        quantity: item.quantity,
        reorderLevel: item.reorder_level,
        unitPrice: Number(item.unit_price),
        createdAt: item.created_at,
        state: f?.state ?? 'ok',
        daysLeft: f?.daysLeft ?? null,
        perWeek: f ? f.perDay * 7 : 0,
        suggest: f?.suggest ?? 0,
        perBranch,
        history,
        received: history.filter((h) => h.type === 'Received').reduce((s, h) => s + h.quantity, 0),
        issued: history.filter((h) => h.type === 'Issued').reduce((s, h) => s + h.quantity, 0),
        scoped: Boolean(dept),
        hasHistory: moves > 0,
        canEdit: c.itemsManage,
      });
    }),
  );

  const itemSchema = z.object({
    name: text(2, 200),
    categoryId: z.coerce.number().int().positive(),
    description: optional(500),
    reorderLevel: count(0),
    unitPrice: money.optional(),
    // New items only: opening stock at a branch.
    openingQuantity: count(0).optional(),
    branchId: z.coerce.number().int().positive().optional(),
    supplier: optional(200),
  });

  async function checkCategory(trx, categoryId) {
    const cat = await trx('stock_categories').where({ id: categoryId }).first('id', 'name');
    if (!cat) throw badRequest('Choose a category.');
    return cat;
  }
  async function checkBranch(trx, branchId) {
    const b = await trx('stock_branches as b')
      .join('companies as co', 'co.id', 'b.company_id')
      .where({ 'b.id': branchId ?? 0, 'b.is_active': true, 'co.is_active': true })
      .first('b.id', 'b.name', 'b.company_id');
    if (!b) throw badRequest('Choose the branch.');
    return b;
  }
  async function noDuplicate(trx, categoryId, name, exceptId = 0) {
    const dup = await trx('stock_items')
      .where({ category_id: categoryId })
      .whereRaw('LOWER(name) = LOWER(?)', [name])
      .whereNot('id', exceptId)
      .first('id');
    if (dup) throw conflict(`An item in this category is already called "${name}".`);
  }

  router.post(
    '/items',
    items,
    asyncHandler(async (req, res) => {
      const input = itemSchema.parse(req.body);
      const id = await db.transaction(async (trx) => {
        const cat = await checkCategory(trx, input.categoryId);
        await noDuplicate(trx, cat.id, input.name);
        const [newId] = await trx('stock_items').insert({
          name: input.name,
          category_id: cat.id,
          description: input.description,
          reorder_level: input.reorderLevel,
          unit_price: input.unitPrice ?? 0,
        });
        if (input.openingQuantity) {
          const b = await checkBranch(trx, input.branchId);
          const [o, n] = await changeBranchStock(trx, newId, b.id, input.openingQuantity);
          await trx('stock_receipts').insert({
            item_id: newId,
            branch_id: b.id,
            supplier: input.supplier || 'Opening stock',
            quantity: input.openingQuantity,
            unit_price: input.unitPrice ?? 0,
            date_received: todayInLusaka(),
            received_by: req.user.id,
            old_stock: o,
            new_stock: n,
          });
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'STOCK_ITEM_ADDED',
          entityType: 'stock_item',
          entityId: newId,
          after: { name: input.name, category: cat.name, opening: input.openingQuantity ?? 0 },
        });
        return newId;
      });
      res.status(201).json({ id });
    }),
  );

  router.put(
    '/items/:id',
    items,
    asyncHandler(async (req, res) => {
      const input = itemSchema.parse(req.body);
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const item = await trx('stock_items').where({ id }).forUpdate().first();
        if (!item) throw notFound('That item no longer exists.');
        const cat = await checkCategory(trx, input.categoryId);
        await noDuplicate(trx, cat.id, input.name, id);
        // Once an item has stock history its price is set by deliveries, not edited by hand.
        const locked = (await movementCount(trx, id)) > 0;
        const changes = {
          name: input.name,
          category_id: cat.id,
          description: input.description,
          reorder_level: input.reorderLevel,
          ...(locked || input.unitPrice === undefined ? {} : { unit_price: input.unitPrice }),
        };
        await trx('stock_items').where({ id }).update(changes);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'STOCK_ITEM_UPDATED',
          entityType: 'stock_item',
          entityId: id,
          before: {
            name: item.name,
            categoryId: item.category_id,
            reorderLevel: item.reorder_level,
            unitPrice: Number(item.unit_price),
          },
          after: changes,
        });
      });
      res.json({ id });
    }),
  );

  router.delete(
    '/items/:id',
    items,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await db.transaction(async (trx) => {
        const item = await trx('stock_items').where({ id }).forUpdate().first();
        if (!item) throw notFound('That item no longer exists.');
        if ((await movementCount(trx, id)) > 0) {
          throw conflict(
            `"${item.name}" has received or issued stock, so it can't be deleted. Its history must be kept.`,
          );
        }
        await trx('requisitions').where({ item_id: id }).update({ item_id: null });
        await trx('branch_stock').where({ item_id: id }).del();
        await trx('stock_items').where({ id }).del();
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'STOCK_ITEM_DELETED',
          entityType: 'stock_item',
          entityId: id,
          before: { name: item.name },
        });
      });
      res.json({ ok: true });
    }),
  );

  // ── Receiving ────────────────────────────────────────────────────────────────────────────────
  const receiveSchema = z
    .object({
      itemId: z.coerce.number().int().positive().optional(),
      newItem: z
        .object({
          name: text(2, 200),
          categoryId: z.coerce.number().int().positive(),
          description: optional(500),
        })
        .optional(),
      branchId: z.coerce.number().int().positive(),
      supplier: text(2, 200),
      quantity: count(1),
      unitPrice: money,
      reorderLevel: count(0),
      dateReceived: pastDate,
      requisitionId: z.coerce.number().int().positive().optional(),
    })
    .refine((v) => Boolean(v.itemId) !== Boolean(v.newItem), {
      message: 'Choose an item, or add a new one.',
    });

  router.post(
    '/receive',
    receive,
    asyncHandler(async (req, res) => {
      const input = receiveSchema.parse(req.body);
      const out = await db.transaction(async (trx) => {
        const b = await checkBranch(trx, input.branchId);
        let req_ = null;
        if (input.requisitionId) {
          req_ = await trx('requisitions').where({ id: input.requisitionId }).forUpdate().first();
          if (!req_ || req_.status !== 'PAID') {
            throw conflict('Only a requisition that has been paid for can be received.');
          }
        }
        let item;
        if (input.newItem) {
          const cat = await checkCategory(trx, input.newItem.categoryId);
          await noDuplicate(trx, cat.id, input.newItem.name);
          const [id] = await trx('stock_items').insert({
            name: input.newItem.name,
            category_id: cat.id,
            description: input.newItem.description,
            reorder_level: input.reorderLevel,
            unit_price: input.unitPrice,
          });
          item = {
            id,
            name: input.newItem.name,
            unit_price: input.unitPrice,
            reorder_level: input.reorderLevel,
          };
        } else {
          item = await trx('stock_items').where({ id: input.itemId }).first();
          if (!item) throw badRequest('Choose an item.');
        }
        const [o, n] = await changeBranchStock(trx, item.id, b.id, input.quantity);
        await trx('stock_receipts').insert({
          item_id: item.id,
          branch_id: b.id,
          supplier: input.supplier,
          quantity: input.quantity,
          unit_price: input.unitPrice,
          date_received: input.dateReceived,
          received_by: req.user.id,
          requisition_id: req_?.id ?? null,
          old_stock: o,
          new_stock: n,
        });
        // The delivery sets the item's current price and reorder level.
        await trx('stock_items')
          .where({ id: item.id })
          .update({ unit_price: input.unitPrice, reorder_level: input.reorderLevel });
        if (req_) {
          await trx('requisitions')
            .where({ id: req_.id, status: 'PAID' })
            .update({
              status: 'RECEIVED',
              received_at: trx.fn.now(),
              stage_at: trx.fn.now(),
              last_note: null,
              item_id: item.id,
              branch_id: req_.branch_id ?? b.id,
            });
          await logEvent(trx, {
            requisitionId: req_.id,
            actorId: req.user.id,
            action: 'RECEIVED',
            from: 'PAID',
            to: 'RECEIVED',
          });
          await notifyStage(trx, req_, 'RECEIVED', req.user.id);
        }
        await writeAudit(trx, {
          ...auditContext(req),
          action: input.newItem ? 'STOCK_NEW_ITEM_RECEIVED' : 'STOCK_RECEIVED',
          entityType: 'stock_item',
          entityId: item.id,
          after: {
            branch: b.name,
            quantity: input.quantity,
            supplier: input.supplier,
            unitPrice: input.unitPrice,
            old: o,
            new: n,
            requisition: req_ ? ref(req_.id) : null,
          },
        });
        return {
          itemId: item.id,
          branch: b.name,
          oldStock: o,
          newStock: n,
          requisition: req_ ? ref(req_.id) : null,
        };
      });
      res.status(201).json(out);
    }),
  );

  // What the receive form needs: items with their price, reorder level, last supplier and stock per branch.
  router.get(
    '/receive/form',
    receive,
    asyncHandler(async (req, res) => {
      const items = await db('stock_items as i')
        .join('stock_categories as c', 'c.id', 'i.category_id')
        .orderBy(['c.name', 'i.name'])
        .select('i.id', 'i.name', 'i.category_id', 'c.name as category', 'i.unit_price', 'i.reorder_level');
      const last = await db('stock_receipts as r')
        .join(
          db('stock_receipts')
            .whereNotNull('supplier')
            .whereNotIn('supplier', ['', 'Opening stock', 'Initial Stock'])
            .groupBy('item_id')
            .select('item_id')
            .max({ id: 'id' })
            .as('m'),
          'm.id',
          'r.id',
        )
        .select('r.item_id', 'r.supplier');
      const lastSupplier = new Map(last.map((r) => [r.item_id, r.supplier]));
      const stock = await db('branch_stock').select('item_id', 'branch_id', 'quantity');
      let requisition = null;
      if (req.query.requisitionId) {
        const r = await db('requisitions')
          .where({ id: Number(req.query.requisitionId) || 0, status: 'PAID' })
          .first();
        if (r) {
          let itemId = r.item_id;
          if (!itemId) {
            const m = await db('stock_items')
              .whereRaw('LOWER(name) = LOWER(?)', [r.item_name])
              .orderByRaw('category_id = ? DESC', [r.category_id ?? 0])
              .first('id');
            itemId = m?.id ?? null;
          }
          requisition = {
            id: r.id,
            ref: ref(r.id),
            itemName: r.item_name,
            categoryId: r.category_id,
            quantity: r.quantity,
            supplier: r.supplier,
            branchId: r.branch_id,
            companyId: r.company_id,
            itemId,
          };
        }
      }
      res.json({
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          categoryId: i.category_id,
          category: i.category,
          unitPrice: Number(i.unit_price),
          reorderLevel: i.reorder_level,
          lastSupplier: lastSupplier.get(i.id) ?? null,
        })),
        stock: stock.map((s) => ({ itemId: s.item_id, branchId: s.branch_id, quantity: s.quantity })),
        requisition,
      });
    }),
  );

  // ── Issuing ──────────────────────────────────────────────────────────────────────────────────
  const issueSchema = z.object({
    itemId: z.coerce.number().int().positive(),
    branchId: z.coerce.number().int().positive(),
    departmentId: z.coerce.number().int().positive(),
    quantity: count(1),
    recipient: text(2, 150),
    purpose: optional(255),
    dateIssued: pastDate,
  });

  router.post(
    '/issue',
    issue,
    asyncHandler(async (req, res) => {
      const input = issueSchema.parse(req.body);
      const out = await db.transaction(async (trx) => {
        const b = await checkBranch(trx, input.branchId);
        const item = await trx('stock_items').where({ id: input.itemId }).first('id', 'name');
        if (!item) throw badRequest('Choose an item.');
        const dept = await trx('departments as d')
          .join('companies as co', 'co.id', 'd.company_id')
          .where({ 'd.id': input.departmentId, 'd.is_active': true })
          .first('d.id', 'd.name', 'co.name as company');
        if (!dept) throw badRequest('Choose the department receiving the stock.');
        const [o, n] = await changeBranchStock(trx, item.id, b.id, -input.quantity);
        const issuedTo = `${dept.name} — ${dept.company}`;
        await trx('stock_issues').insert({
          item_id: item.id,
          branch_id: b.id,
          department_id: dept.id,
          issued_to: issuedTo,
          recipient: input.recipient,
          purpose: input.purpose,
          quantity: input.quantity,
          date_issued: input.dateIssued,
          issued_by: req.user.id,
          old_stock: o,
          new_stock: n,
        });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'STOCK_ISSUED',
          entityType: 'stock_item',
          entityId: item.id,
          after: {
            branch: b.name,
            quantity: input.quantity,
            issuedTo,
            recipient: input.recipient,
            old: o,
            new: n,
          },
        });
        return {
          item: item.name,
          issuedTo,
          branch: b.name,
          oldStock: o,
          newStock: n,
          quantity: input.quantity,
        };
      });
      res.status(201).json(out);
    }),
  );

  // Items in stock anywhere in a company, with the branches that hold each.
  router.get(
    '/issue/available',
    issue,
    asyncHandler(async (req, res) => {
      const companyId = Number(req.query.companyId) || 0;
      const rows = await db('branch_stock as bs')
        .join('stock_branches as b', 'b.id', 'bs.branch_id')
        .join('stock_items as i', 'i.id', 'bs.item_id')
        .join('stock_categories as c', 'c.id', 'i.category_id')
        .where({ 'b.company_id': companyId, 'b.is_active': true })
        .where('bs.quantity', '>', 0)
        .orderBy(['i.name', 'b.name'])
        .select(
          'i.id',
          'i.name',
          'i.category_id',
          'c.name as category',
          'i.reorder_level',
          'b.id as branch_id',
          'b.name as branch',
          'bs.quantity',
        );
      const items = new Map();
      for (const r of rows) {
        const it = items.get(r.id) ?? {
          id: r.id,
          name: r.name,
          categoryId: r.category_id,
          category: r.category,
          reorderLevel: r.reorder_level,
          available: 0,
          branches: [],
        };
        it.available += r.quantity;
        it.branches.push({ id: r.branch_id, name: r.branch, quantity: r.quantity });
        items.set(r.id, it);
      }
      for (const it of items.values())
        it.branches.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
      res.json({ items: [...items.values()] });
    }),
  );

  // ── Recent and all movements (Transactions) ──────────────────────────────────────────────────
  router.get(
    '/transactions',
    transactions,
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const dept = c.stockDepartment;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? req.query.date : null;
      const type = dept ? 'issued' : ['received', 'issued'].includes(req.query.type) ? req.query.type : 'all';
      const itemId = Number(req.query.itemId) || 0;
      const categoryId = Number(req.query.categoryId) || 0;
      const limit = date ? 1000 : 50;
      const common = (q, alias) => {
        if (date) q.whereRaw(`DATE(${alias}.created_at) = ?`, [date]);
        if (itemId) q.where(`${alias}.item_id`, itemId);
        if (categoryId) q.where('i.category_id', categoryId);
        return q.orderBy(`${alias}.created_at`, 'desc').limit(limit);
      };
      const received =
        type === 'issued'
          ? []
          : await common(
              db('stock_receipts as r')
                .join('stock_items as i', 'i.id', 'r.item_id')
                .join('stock_categories as c', 'c.id', 'i.category_id')
                .leftJoin('employees as e', 'e.id', 'r.received_by')
                .leftJoin('stock_branches as b', 'b.id', 'r.branch_id')
                .select(
                  'r.id',
                  'r.created_at',
                  'r.quantity',
                  'r.supplier as party',
                  'r.old_stock',
                  'r.new_stock',
                  'i.id as item_id',
                  'i.name as item',
                  'c.name as category',
                  'b.name as branch',
                  'e.first_name',
                  'e.last_name',
                  'r.received_by_name as by_name',
                  db.raw('NULL as purpose'),
                  db.raw('NULL as recipient'),
                ),
              'r',
            );
      const issued =
        type === 'received'
          ? []
          : await common(
              db('stock_issues as s')
                .join('stock_items as i', 'i.id', 's.item_id')
                .join('stock_categories as c', 'c.id', 'i.category_id')
                .leftJoin('employees as e', 'e.id', 's.issued_by')
                .leftJoin('stock_branches as b', 'b.id', 's.branch_id')
                .modify((q) => dept && q.where('s.department_id', dept))
                .select(
                  's.id',
                  's.created_at',
                  's.quantity',
                  's.issued_to as party',
                  's.old_stock',
                  's.new_stock',
                  'i.id as item_id',
                  'i.name as item',
                  'c.name as category',
                  'b.name as branch',
                  'e.first_name',
                  'e.last_name',
                  's.issued_by_name as by_name',
                  's.purpose',
                  's.recipient',
                ),
              's',
            );
      const rows = [
        ...received.map((r) => ({ ...r, type: 'Received' })),
        ...issued.map((r) => ({ ...r, type: 'Issued' })),
      ]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit)
        .map((r) => ({
          key: `${r.type}-${r.id}`,
          type: r.type,
          at: r.created_at,
          itemId: r.item_id,
          item: r.item,
          category: r.category,
          branch: r.branch,
          quantity: r.quantity,
          party: r.party,
          recipient: r.recipient,
          purpose: r.purpose,
          oldStock: r.old_stock,
          newStock: r.new_stock,
          by: personName(r.first_name, r.last_name, r.by_name),
        }));
      if (wantsXlsx(req)) {
        return sendXlsx(
          res,
          `Transactions ${date ?? 'latest'}`,
          [
            { key: 'type', label: 'Type' },
            { key: 'time', label: 'Date and time' },
            { key: 'item', label: 'Item' },
            { key: 'category', label: 'Category' },
            { key: 'branch', label: 'Branch' },
            { key: 'quantity', label: 'Qty', type: 'number' },
            { key: 'by', label: 'By' },
            { key: 'party', label: 'Supplier / issued to' },
            { key: 'recipient', label: 'Received by' },
            { key: 'purpose', label: 'Purpose' },
          ],
          rows.map((r) => ({ ...r, time: new Date(r.at).toISOString().replace('T', ' ').slice(0, 16) })),
          'Transactions',
        );
      }
      res.json({ items: rows, date, type, scoped: Boolean(dept) });
    }),
  );

  // ── Monthly reports ──────────────────────────────────────────────────────────────────────────
  router.get(
    '/reports',
    reports,
    asyncHandler(async (req, res) => {
      const c = req.rq;
      const dept = c.stockDepartment;
      const by = dept
        ? 'department'
        : ['category', 'company', 'branch', 'department'].includes(req.query.by)
          ? req.query.by
          : 'category';
      const month = monthOf(req.query.month);
      const from = `${month}-01`;
      const to = monthEnd(month);
      let sel = dept ?? (Number(req.query.id) || 0);
      const groups = new Map();
      let rows = [];
      const inMonth = (t) =>
        db(t)
          .groupBy('item_id')
          .select('item_id')
          .sum({ m: db.raw('CASE WHEN DATE(created_at) BETWEEN ? AND ? THEN quantity END', [from, to]) })
          .sum({ a: db.raw('CASE WHEN DATE(created_at) > ? THEN quantity END', [to]) });
      const finish = (r) => {
        const closing = Number(r.current) - Number(r.receivedAfter) + Number(r.issuedAfter);
        const opening = closing - Number(r.received) + Number(r.issued);
        return { ...r, closing, opening, value: closing * Number(r.unitPrice) };
      };

      if (by === 'department') {
        // Departments don't hold stock: what was issued to each in the month.
        const issued = await db('stock_issues as s')
          .join('departments as d', 'd.id', 's.department_id')
          .join('companies as co', 'co.id', 'd.company_id')
          .join('stock_items as i', 'i.id', 's.item_id')
          .join('stock_categories as c', 'c.id', 'i.category_id')
          .whereRaw('DATE(s.created_at) BETWEEN ? AND ?', [from, to])
          .modify((q) => dept && q.where('s.department_id', dept))
          .groupBy('d.id', 'd.name', 'co.name', 'i.id', 'i.name', 'c.name', 'i.unit_price')
          .select(
            'd.id as gid',
            'd.name as gname',
            'co.name as company',
            'i.id',
            'i.name',
            'c.name as category',
            'i.unit_price',
          )
          .sum({ units: 's.quantity' })
          .sum({ value: db.raw('s.quantity * i.unit_price') })
          .count({ times: '*' });
        for (const r of issued) {
          const g = groups.get(r.gid) ?? {
            id: r.gid,
            name: r.gname,
            sub: r.company,
            items: 0,
            units: 0,
            value: 0,
            times: 0,
          };
          g.items += 1;
          g.units += Number(r.units);
          g.value += Number(r.value);
          g.times += Number(r.times);
          groups.set(r.gid, g);
          if (!sel || r.gid === sel) {
            rows.push({
              id: r.id,
              name: r.name,
              category: r.category,
              unitPrice: Number(r.unit_price),
              units: Number(r.units),
              value: Number(r.value),
              times: Number(r.times),
            });
          }
        }
        if (!sel) rows = [];
        rows.sort((a, b) => b.units - a.units);
      } else if (by === 'category') {
        const [recv, iss] = await Promise.all([inMonth('stock_receipts'), inMonth('stock_issues')]);
        const R = new Map(recv.map((r) => [r.item_id, r]));
        const I = new Map(iss.map((r) => [r.item_id, r]));
        const items = await db('stock_items as i')
          .join('stock_categories as c', 'c.id', 'i.category_id')
          .whereRaw('DATE(i.created_at) <= ?', [to])
          .orderBy(['c.name', 'i.name'])
          .select(
            'i.id',
            'i.name',
            'i.category_id',
            'c.name as category',
            'i.quantity',
            'i.reorder_level',
            'i.unit_price',
          );
        for (const it of items) {
          const r = finish({
            id: it.id,
            name: it.name,
            category: it.category,
            gid: it.category_id,
            current: it.quantity,
            reorderLevel: it.reorder_level,
            unitPrice: Number(it.unit_price),
            received: Number(R.get(it.id)?.m ?? 0),
            receivedAfter: Number(R.get(it.id)?.a ?? 0),
            issued: Number(I.get(it.id)?.m ?? 0),
            issuedAfter: Number(I.get(it.id)?.a ?? 0),
          });
          r.status = r.closing <= 0 ? 'Out of stock' : r.closing <= r.reorderLevel ? 'Below reorder' : 'OK';
          const g = groups.get(r.gid) ?? {
            id: r.gid,
            name: r.category,
            sub: '',
            items: 0,
            opening: 0,
            received: 0,
            issued: 0,
            closing: 0,
            value: 0,
            low: 0,
          };
          g.items += 1;
          for (const k of ['opening', 'received', 'issued', 'closing', 'value']) g[k] += r[k];
          if (r.status !== 'OK') g.low += 1;
          groups.set(r.gid, g);
          if (!sel || r.gid === sel) rows.push(r);
        }
      } else {
        // Company and branch: from each branch's own stock and movements.
        const per = (t) =>
          db(t)
            .groupBy('item_id', 'branch_id')
            .select('item_id', 'branch_id')
            .sum({ m: db.raw('CASE WHEN DATE(created_at) BETWEEN ? AND ? THEN quantity END', [from, to]) })
            .sum({ a: db.raw('CASE WHEN DATE(created_at) > ? THEN quantity END', [to]) });
        const [recv, iss, stock, bs, items] = await Promise.all([
          per('stock_receipts'),
          per('stock_issues'),
          db('branch_stock').select('item_id', 'branch_id', 'quantity'),
          branches({ activeOnly: false }),
          db('stock_items as i')
            .join('stock_categories as c', 'c.id', 'i.category_id')
            .select('i.id', 'i.name', 'c.name as category', 'i.unit_price'),
        ]);
        const key = (i, b) => `${i}:${b}`;
        const R = new Map(recv.map((r) => [key(r.item_id, r.branch_id), r]));
        const I = new Map(iss.map((r) => [key(r.item_id, r.branch_id), r]));
        const S = new Map(stock.map((r) => [key(r.item_id, r.branch_id), r.quantity]));
        const B = new Map(bs.map((b) => [b.id, b]));
        const keys = new Set([...R.keys(), ...I.keys(), ...S.keys()]);
        const perItem = new Map();
        const itemById = new Map(items.map((i) => [i.id, i]));
        for (const k of keys) {
          const [itemId, branchId] = k.split(':').map(Number);
          const b = B.get(branchId);
          const it = itemById.get(itemId);
          if (!b || !it) continue;
          const r = finish({
            current: S.get(k) ?? 0,
            unitPrice: Number(it.unit_price),
            received: Number(R.get(k)?.m ?? 0),
            receivedAfter: Number(R.get(k)?.a ?? 0),
            issued: Number(I.get(k)?.m ?? 0),
            issuedAfter: Number(I.get(k)?.a ?? 0),
          });
          if (!r.opening && !r.received && !r.issued && !r.closing) continue;
          const gid = by === 'company' ? b.company_id : b.id;
          const g = groups.get(gid) ?? {
            id: gid,
            name: by === 'company' ? b.company_name : b.name,
            sub: by === 'company' ? '' : b.company_name,
            itemSet: new Set(),
            opening: 0,
            received: 0,
            issued: 0,
            closing: 0,
            value: 0,
          };
          g.itemSet.add(itemId);
          for (const f of ['opening', 'received', 'issued', 'closing', 'value']) g[f] += r[f];
          groups.set(gid, g);
          if (sel && gid !== sel) continue;
          const p = perItem.get(itemId) ?? {
            id: itemId,
            name: it.name,
            category: it.category,
            unitPrice: Number(it.unit_price),
            opening: 0,
            received: 0,
            issued: 0,
            closing: 0,
            value: 0,
          };
          for (const f of ['opening', 'received', 'issued', 'closing', 'value']) p[f] += r[f];
          perItem.set(itemId, p);
        }
        for (const g of groups.values()) {
          g.items = g.itemSet.size;
          delete g.itemSet;
        }
        rows = sel
          ? [...perItem.values()].sort(
              (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
            )
          : [];
      }
      if (sel && !groups.has(sel) && !dept) sel = 0;
      const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
      const selected = sel ? (groups.get(sel) ?? null) : null;
      const isIssue = by === 'department';
      if (wantsXlsx(req)) {
        const itemsPart = sel || (by === 'category' && req.query.part === 'items');
        const stockCols = [
          { key: 'opening', label: 'Opening', type: 'number' },
          { key: 'received', label: 'Received', type: 'number' },
          { key: 'issued', label: 'Issued', type: 'number' },
          { key: 'closing', label: 'Closing', type: 'number' },
        ];
        const columns = itemsPart
          ? isIssue
            ? [
                { key: 'name', label: 'Item' },
                { key: 'category', label: 'Category' },
                { key: 'units', label: 'Units issued', type: 'number' },
                { key: 'unitPrice', label: 'Unit price (K)', type: 'number' },
                { key: 'value', label: 'Value issued (K)', type: 'number' },
                { key: 'times', label: 'Times issued', type: 'number' },
              ]
            : [
                { key: 'name', label: 'Item' },
                { key: 'category', label: 'Category' },
                ...stockCols,
                ...(by === 'category'
                  ? [
                      { key: 'reorderLevel', label: 'Reorder at', type: 'number' },
                      { key: 'status', label: 'Status' },
                    ]
                  : []),
                { key: 'unitPrice', label: 'Unit price (K)', type: 'number' },
                { key: 'value', label: 'Closing value (K)', type: 'number' },
              ]
          : isIssue
            ? [
                { key: 'name', label: 'Department' },
                { key: 'sub', label: 'Company' },
                { key: 'items', label: 'Items', type: 'number' },
                { key: 'units', label: 'Units issued', type: 'number' },
                { key: 'value', label: 'Value issued (K)', type: 'number' },
                { key: 'times', label: 'Times issued', type: 'number' },
              ]
            : [
                { key: 'name', label: by[0].toUpperCase() + by.slice(1) },
                ...(by === 'branch' ? [{ key: 'sub', label: 'Company' }] : []),
                { key: 'items', label: 'Items', type: 'number' },
                ...stockCols,
                { key: 'value', label: 'Closing value (K)', type: 'number' },
              ];
        const data = itemsPart ? rows : list;
        return sendXlsx(
          res,
          `Monthly report by ${by} ${month}${selected ? ` ${selected.name}` : ''}`,
          columns,
          data,
          `Monthly report by ${by}`,
        );
      }
      res.json({
        by,
        month,
        from,
        to,
        scoped: Boolean(dept),
        groups: list,
        selected,
        rows,
      });
    }),
  );

  // ── Categories ───────────────────────────────────────────────────────────────────────────────
  router.get(
    '/categories',
    seeStock,
    asyncHandler(async (req, res) => {
      const rows = await db('stock_categories as c')
        .orderBy('c.name')
        .select(
          'c.id',
          'c.name',
          'c.description',
          db.raw('(SELECT COUNT(*) FROM stock_items i WHERE i.category_id = c.id) as items'),
          db.raw(
            '(SELECT COALESCE(SUM(i.quantity), 0) FROM stock_items i WHERE i.category_id = c.id) as units',
          ),
          db.raw(
            '(SELECT COALESCE(SUM(GREATEST(i.quantity, 0) * i.unit_price), 0) FROM stock_items i WHERE i.category_id = c.id) as value',
          ),
          db.raw('(SELECT COUNT(*) FROM requisitions r WHERE r.category_id = c.id) as requisitions'),
        );
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          items: Number(r.items),
          units: Number(r.units),
          value: Number(r.value),
          canDelete: Number(r.items) === 0 && Number(r.requisitions) === 0,
        })),
      });
    }),
  );

  const categorySchema = z.object({ name: text(2, 100), description: optional(255) });
  async function uniqueCategory(name, exceptId = 0) {
    const dup = await db('stock_categories')
      .whereRaw('LOWER(name) = LOWER(?)', [name])
      .whereNot('id', exceptId)
      .first('id');
    if (dup) throw conflict(`A category called "${name}" already exists.`);
  }
  router.post(
    '/categories',
    categories,
    asyncHandler(async (req, res) => {
      const input = categorySchema.parse(req.body);
      await uniqueCategory(input.name);
      const id = await db.transaction(async (trx) => {
        const [newId] = await trx('stock_categories').insert(input);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'STOCK_CATEGORY_ADDED',
          entityType: 'stock_category',
          entityId: newId,
          after: input,
        });
        return newId;
      });
      res.status(201).json({ id });
    }),
  );
  router.put(
    '/categories/:id',
    categories,
    asyncHandler(async (req, res) => {
      const input = categorySchema.parse(req.body);
      const id = idParam(req);
      const cat = await db('stock_categories').where({ id }).first();
      if (!cat) throw notFound('That category no longer exists.');
      await uniqueCategory(input.name, id);
      await db.transaction(async (trx) => {
        await trx('stock_categories').where({ id }).update(input);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'STOCK_CATEGORY_UPDATED',
          entityType: 'stock_category',
          entityId: id,
          before: { name: cat.name, description: cat.description },
          after: input,
        });
      });
      res.json({ id });
    }),
  );
  router.delete(
    '/categories/:id',
    categories,
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const cat = await db('stock_categories').where({ id }).first();
      if (!cat) throw notFound('That category no longer exists.');
      const used = await db('stock_items').where({ category_id: id }).first('id');
      const usedReq = await db('requisitions').where({ category_id: id }).first('id');
      if (used || usedReq) throw conflict(`"${cat.name}" has items or requisitions, so it can't be deleted.`);
      await db.transaction(async (trx) => {
        await trx('stock_categories').where({ id }).del();
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'STOCK_CATEGORY_DELETED',
          entityType: 'stock_category',
          entityId: id,
          before: { name: cat.name },
        });
      });
      res.json({ ok: true });
    }),
  );

  // ── Branches (stock locations; the System Administrator manages them) ──────────────────────
  router.get(
    '/branches',
    seeStock,
    asyncHandler(async (req, res) => {
      const rows = await branches({ activeOnly: false });
      const held = await db('branch_stock as bs')
        .join('stock_items as i', 'i.id', 'bs.item_id')
        .groupBy('bs.branch_id')
        .select('bs.branch_id')
        .sum({ units: 'bs.quantity' })
        .sum({ value: db.raw('GREATEST(bs.quantity, 0) * i.unit_price') });
      const H = new Map(held.map((h) => [h.branch_id, h]));
      res.json({
        items: rows.map((b) => ({
          ...branchView(b),
          units: Number(H.get(b.id)?.units ?? 0),
          value: Number(H.get(b.id)?.value ?? 0),
        })),
      });
    }),
  );
  const branchSchema = z.object({
    companyId: z.coerce.number().int().positive(),
    name: text(2, 150),
    location: optional(200),
    isActive: z.boolean().default(true),
  });
  async function saveBranch(req, id = null) {
    const input = branchSchema.parse(req.body);
    const co = await db('companies').where({ id: input.companyId }).first('id');
    if (!co) throw badRequest('Choose the company.');
    const dup = await db('stock_branches')
      .where({ company_id: input.companyId })
      .whereRaw('LOWER(name) = LOWER(?)', [input.name])
      .whereNot('id', id ?? 0)
      .first('id');
    if (dup) throw conflict(`This company already has a branch called "${input.name}".`);
    const row = {
      company_id: input.companyId,
      name: input.name,
      location: input.location,
      is_active: input.isActive,
    };
    return db.transaction(async (trx) => {
      let branchId = id;
      if (id) {
        const before = await trx('stock_branches').where({ id }).first();
        if (!before) throw notFound('That branch no longer exists.');
        if (before.company_id !== input.companyId) {
          const holds = await trx('branch_stock')
            .where({ branch_id: id })
            .where('quantity', '<>', 0)
            .first('item_id');
          if (holds) throw conflict('This branch holds stock, so it cannot move to another company.');
        }
        await trx('stock_branches').where({ id }).update(row);
      } else {
        [branchId] = await trx('stock_branches').insert(row);
      }
      await writeAudit(trx, {
        ...auditContext(req),
        action: id ? 'STOCK_BRANCH_UPDATED' : 'STOCK_BRANCH_ADDED',
        entityType: 'stock_branch',
        entityId: branchId,
        after: input,
      });
      return branchId;
    });
  }
  router.post(
    '/branches',
    org,
    asyncHandler(async (req, res) => res.status(201).json({ id: await saveBranch(req) })),
  );
  router.put(
    '/branches/:id',
    org,
    asyncHandler(async (req, res) => res.json({ id: await saveBranch(req, idParam(req)) })),
  );

  // ── Which departments are IT, Accounts and Stores ──────────────────────────────────────────
  router.get(
    '/settings',
    org,
    asyncHandler(async (req, res) => {
      const rows = await db('requisition_departments').select('department_id', 'function_code');
      const out = Object.fromEntries(
        FUNCTIONS.map((f) => [f, rows.filter((r) => r.function_code === f).map((r) => r.department_id)]),
      );
      res.json(out);
    }),
  );
  const settingsSchema = z.object(
    Object.fromEntries(FUNCTIONS.map((f) => [f, z.array(z.coerce.number().int().positive()).max(200)])),
  );
  router.put(
    '/settings',
    org,
    asyncHandler(async (req, res) => {
      const input = settingsSchema.parse(req.body);
      const ids = [...new Set(Object.values(input).flat())];
      const found = ids.length ? await db('departments').whereIn('id', ids).pluck('id') : [];
      if (found.length !== ids.length) throw badRequest('One of the departments no longer exists.');
      await db.transaction(async (trx) => {
        const before = await trx('requisition_departments').select('department_id', 'function_code');
        await trx('requisition_departments').del();
        const rows = FUNCTIONS.flatMap((f) => input[f].map((d) => ({ department_id: d, function_code: f })));
        if (rows.length) await trx('requisition_departments').insert(rows);
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'REQUISITION_DEPARTMENTS_UPDATED',
          entityType: 'system_setting',
          entityId: 'requisition_departments',
          before,
          after: input,
        });
      });
      res.json(input);
    }),
  );

  return router;
}

export { kwacha };
