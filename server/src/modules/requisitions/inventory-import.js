import fs from 'node:fs';
import path from 'node:path';

/*
 * One-off copy of the Altus inventory system's data into the Requisitions module (D106).
 *
 *   companies    matched by name (or --map "Inventory name=HR name"); never created here
 *   branches     copied under the matched company
 *   departments  matched by name within the company; unmatched ones keep their name as text
 *   people       matched by email to HR employees; unmatched ones keep their name as text
 *   categories   matched by name, otherwise added
 *   items, branch stock, deliveries, issues, requisitions, their files and history: copied
 *
 * A dry run (the default) only reads both databases and reports what would happen. The copy
 * runs in one transaction and refuses to run twice.
 */

const STATUS = {
  quotes_it: 'QUOTES_IT',
  quotes_dept: 'QUOTES_DEPT',
  returned: 'RETURNED',
  director: 'DIRECTOR',
  accounts: 'ACCOUNTS',
  accounts_manager: 'ACCOUNTS_MANAGER',
  cfo: 'CFO',
  pay: 'PAY',
  paid: 'PAID',
  received: 'RECEIVED',
  cancelled: 'CANCELLED',
  // Older inventory lists, as its own migration converts them.
  pending: 'QUOTES_DEPT',
  needed: 'QUOTES_DEPT',
  approved: 'PAID',
  ordered: 'PAID',
  rejected: 'CANCELLED',
};
const KINDS = { doc: 'DOC', quote: 'QUOTE', pop: 'POP' };
const key = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

async function hasTable(src, name) {
  return src.schema.hasTable(name);
}

/** Read everything needed from the inventory database. */
async function readSource(src) {
  const all = async (t, order = 'id') => ((await hasTable(src, t)) ? src(t).orderBy(order) : []);
  return {
    companies: await all('companies'),
    branches: await all('branches'),
    departments: await all('departments'),
    users: await all('users'),
    categories: await all('categories'),
    items: await all('items'),
    branchStock: (await hasTable(src, 'branch_stock')) ? await src('branch_stock') : [],
    receipts: await all('stock_receiving'),
    issues: await all('stock_issuing'),
    requisitions: await all('procurement'),
    files: await all('requisition_files'),
    log: await all('requisition_log'),
  };
}

/** Work out how everything lines up, without writing anything. */
export async function planImport(db, src, { maps = {}, filesFrom = null } = {}) {
  const s = await readSource(src);
  const warnings = [];
  const hrCompanies = await db('companies').select('id', 'name');
  const hrByName = new Map(hrCompanies.map((c) => [key(c.name), c]));
  const mapKeys = new Map(Object.entries(maps).map(([a, b]) => [key(a), key(b)]));

  const company = new Map(); // inventory company id -> HR company
  const unmatchedCompanies = [];
  for (const c of s.companies) {
    const hr = hrByName.get(mapKeys.get(key(c.name)) ?? key(c.name));
    if (hr) company.set(c.id, hr);
    else unmatchedCompanies.push(c.name);
  }
  // A company only matters if something uses it.
  const used = new Set([
    ...s.branches.map((b) => b.company_id),
    ...s.requisitions.map((r) => r.company_id).filter(Boolean),
  ]);
  const blocking = s.companies.filter((c) => used.has(c.id) && !company.has(c.id)).map((c) => c.name);

  const branchCompany = new Map(s.branches.map((b) => [b.id, b.company_id]));
  const hrDepts = await db('departments').select('id', 'name', 'company_id');
  const department = new Map(); // inventory department id -> HR department id
  const unmatchedDepartments = [];
  for (const d of s.departments) {
    const co = company.get(branchCompany.get(d.branch_id));
    const hr = co && hrDepts.find((x) => x.company_id === co.id && key(x.name) === key(d.name));
    if (hr) department.set(d.id, hr.id);
    else unmatchedDepartments.push(`${d.name}${co ? ` (${co.name})` : ''}`);
  }
  const deptName = new Map(s.departments.map((d) => [d.id, d.name]));

  const hrPeople = await db('employees').whereNotNull('email').select('id', 'email');
  const byEmail = new Map(hrPeople.map((p) => [key(p.email), p.id]));
  const person = new Map(); // inventory user id -> HR employee id
  const personName = new Map();
  const unmatchedPeople = [];
  for (const u of s.users) {
    personName.set(u.id, u.full_name);
    const id = byEmail.get(key(u.email));
    if (id) person.set(u.id, id);
    else unmatchedPeople.push(`${u.full_name} <${u.email}>`);
  }

  // Items whose total has no branch rows (from before branches existed) go to a branch of the
  // first company that has one, so totals and branch stock stay in step.
  const branchRows = new Map();
  for (const r of s.branchStock)
    branchRows.set(r.item_id, (branchRows.get(r.item_id) ?? 0) + Number(r.quantity));
  const fallbackBranch = s.branches.find((b) => company.has(b.company_id))?.id ?? null;
  const unplaced = [];
  for (const it of s.items) {
    const diff = Number(it.current_quantity) - (branchRows.get(it.id) ?? 0);
    if (diff !== 0) unplaced.push({ itemId: it.id, name: it.item_name, quantity: diff });
  }
  if (unplaced.length) {
    if (fallbackBranch) {
      const b = s.branches.find((x) => x.id === fallbackBranch);
      warnings.push(
        `${unplaced.length} item(s) had stock not held at any branch; it will be placed at ${b.name}: ${unplaced.map((u) => `${u.name} (${u.quantity})`).join(', ')}.`,
      );
    } else {
      warnings.push('Some items have stock but there is no branch to hold it.');
    }
  }

  const missingFiles = [];
  if (filesFrom) {
    for (const f of s.files) {
      if (!fs.existsSync(path.join(filesFrom, path.basename(f.stored_name))))
        missingFiles.push(f.original_name);
    }
  } else if (s.files.length) {
    warnings.push(
      `${s.files.length} requisition file(s) will be listed but not copied: pass --files with the inventory storage/requisitions folder.`,
    );
  }
  const unknownStatus = [...new Set(s.requisitions.map((r) => r.status).filter((x) => !STATUS[x]))];
  if (unknownStatus.length)
    warnings.push(
      `Unknown requisition status(es) treated as waiting for quotations: ${unknownStatus.join(', ')}.`,
    );

  return {
    source: s,
    company,
    department,
    deptName,
    person,
    personName,
    unplaced,
    fallbackBranch,
    report: {
      counts: {
        companies: s.companies.length,
        branches: s.branches.length,
        departments: s.departments.length,
        people: s.users.length,
        categories: s.categories.length,
        items: s.items.length,
        deliveries: s.receipts.length,
        issues: s.issues.length,
        requisitions: s.requisitions.length,
        files: s.files.length,
        historyEntries: s.log.length,
      },
      companiesMatched: [...company.entries()].map(([, c]) => c.name),
      unmatchedCompanies,
      blockingCompanies: blocking,
      unmatchedDepartments,
      unmatchedPeople,
      missingFiles,
      warnings,
    },
  };
}

/** Copy the data. Returns the report; throws if it cannot run. */
export async function runImport(
  db,
  src,
  { maps = {}, filesFrom = null, filesTo = null, actorId = null } = {},
) {
  const plan = await planImport(db, src, { maps, filesFrom });
  const { source: s, company, department, deptName, person, personName } = plan;
  if (plan.report.blockingCompanies.length) {
    throw new Error(
      `These inventory companies have no match in the HR system: ${plan.report.blockingCompanies.join(', ')}. Add them in Employee management, or map them with --map "Inventory name=HR name".`,
    );
  }
  const already =
    (await db('requisitions').whereNotNull('legacy_id').first('id')) ||
    (await db('stock_items').whereNotNull('legacy_id').first('id'));
  if (already) throw new Error('The inventory data has already been imported.');

  const copied = [];
  if (filesFrom && filesTo) {
    await fs.promises.mkdir(filesTo, { recursive: true, mode: 0o700 });
    for (const f of s.files) {
      const from = path.join(filesFrom, path.basename(f.stored_name));
      const to = path.join(filesTo, path.basename(f.stored_name));
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        await fs.promises.copyFile(from, to);
        copied.push(to);
      }
    }
  }
  const who = (id) => person.get(id) ?? null;
  const whoName = (id) => (id && !person.has(id) ? (personName.get(id) ?? null) : null);

  try {
    await db.transaction(async (trx) => {
      const branch = new Map();
      for (const b of s.branches) {
        const co = company.get(b.company_id);
        const existing = await trx('stock_branches')
          .where({ company_id: co.id })
          .whereRaw('LOWER(name) = LOWER(?)', [b.name])
          .first('id');
        if (existing) branch.set(b.id, existing.id);
        else {
          const [id] = await trx('stock_branches').insert({
            company_id: co.id,
            name: b.name,
            location: b.location ?? null,
            is_active: Boolean(b.active ?? 1),
            legacy_id: b.id,
          });
          branch.set(b.id, id);
        }
      }

      const category = new Map();
      const catByName = new Map(
        (await trx('stock_categories').select('id', 'name')).map((c) => [key(c.name), c.id]),
      );
      const ensureCategory = async (name, description = null, legacyId = null) => {
        const k = key(name || 'Other');
        if (!catByName.has(k)) {
          const [id] = await trx('stock_categories').insert({
            name: (name || 'Other').trim().slice(0, 100),
            description,
            legacy_id: legacyId,
          });
          catByName.set(k, id);
        }
        return catByName.get(k);
      };
      for (const c of s.categories)
        category.set(c.id, await ensureCategory(c.name, c.description ?? null, c.id));

      const item = new Map();
      for (const it of s.items) {
        const catId =
          it.category_id && category.has(it.category_id)
            ? category.get(it.category_id)
            : await ensureCategory(it.category);
        let name = String(it.item_name).trim().slice(0, 200);
        // Two items with the same name in one category would clash here; keep both, apart.
        if (
          await trx('stock_items')
            .where({ category_id: catId })
            .whereRaw('LOWER(name) = LOWER(?)', [name])
            .first('id')
        ) {
          name = `${name} (${it.id})`.slice(0, 200);
          plan.report.warnings.push(
            `Item "${it.item_name}" appears twice in one category; imported as "${name}".`,
          );
        }
        const [id] = await trx('stock_items').insert({
          category_id: catId,
          name,
          description: it.description ? String(it.description).slice(0, 500) : null,
          quantity: Number(it.current_quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          reorder_level: Math.max(0, Number(it.reorder_level) || 0),
          legacy_id: it.id,
          created_at: it.created_at ?? trx.fn.now(),
          updated_at: it.updated_at ?? trx.fn.now(),
        });
        item.set(it.id, id);
      }
      const stockRows = new Map();
      const add = (itemId, branchId, q) => {
        const k = `${itemId}:${branchId}`;
        stockRows.set(k, {
          item_id: itemId,
          branch_id: branchId,
          quantity: (stockRows.get(k)?.quantity ?? 0) + q,
        });
      };
      for (const r of s.branchStock) {
        if (item.has(r.item_id) && branch.has(r.branch_id))
          add(item.get(r.item_id), branch.get(r.branch_id), Number(r.quantity));
      }
      if (plan.fallbackBranch) {
        for (const u of plan.unplaced) add(item.get(u.itemId), branch.get(plan.fallbackBranch), u.quantity);
      }
      if (stockRows.size) await trx('branch_stock').insert([...stockRows.values()]);

      for (const r of s.receipts) {
        if (!item.has(r.item_id)) continue;
        await trx('stock_receipts').insert({
          item_id: item.get(r.item_id),
          branch_id: r.branch_id ? (branch.get(r.branch_id) ?? null) : null,
          supplier: r.supplier ?? null,
          quantity: r.quantity,
          unit_price: Number(r.unit_price) || 0,
          date_received: r.date_received ?? r.created_at,
          received_by: who(r.received_by),
          received_by_name: whoName(r.received_by),
          old_stock: r.old_stock ?? null,
          new_stock: r.new_stock ?? null,
          legacy_id: r.id,
          created_at: r.created_at,
        });
      }
      for (const r of s.issues) {
        if (!item.has(r.item_id)) continue;
        await trx('stock_issues').insert({
          item_id: item.get(r.item_id),
          branch_id: r.branch_id ? (branch.get(r.branch_id) ?? null) : null,
          department_id: r.department_id ? (department.get(r.department_id) ?? null) : null,
          issued_to:
            (r.issued_to ?? (r.department_id ? deptName.get(r.department_id) : null))?.slice(0, 200) ?? null,
          recipient: r.recipient ?? null,
          purpose: r.purpose ? String(r.purpose).slice(0, 255) : null,
          quantity: r.quantity,
          date_issued: r.date_issued ?? r.created_at,
          issued_by: who(r.issued_by),
          issued_by_name: whoName(r.issued_by),
          old_stock: r.old_stock ?? null,
          new_stock: r.new_stock ?? null,
          legacy_id: r.id,
          created_at: r.created_at,
        });
      }

      const req = new Map();
      for (const p of s.requisitions) {
        const [id] = await trx('requisitions').insert({
          item_name: String(p.item_name).slice(0, 200),
          item_id: p.item_id ? (item.get(p.item_id) ?? null) : null,
          category_id: p.category_id
            ? (category.get(p.category_id) ?? null)
            : p.category
              ? await ensureCategory(p.category)
              : null,
          quantity: p.quantity,
          reason: p.reason ?? null,
          company_id: p.company_id ? (company.get(p.company_id)?.id ?? null) : null,
          branch_id: p.branch_id ? (branch.get(p.branch_id) ?? null) : null,
          department_id: p.department_id ? (department.get(p.department_id) ?? null) : null,
          department_name:
            p.department_id && !department.has(p.department_id)
              ? (deptName.get(p.department_id) ?? null)
              : null,
          is_it: Boolean(p.is_it),
          status: STATUS[p.status] ?? 'QUOTES_DEPT',
          supplier: p.supplier ?? null,
          last_note: p.last_note ?? null,
          stage_at: p.stage_at ?? p.created_at,
          director_at: p.director_at ?? null,
          paid_at: p.paid_at ?? null,
          received_at: p.received_at ?? null,
          requested_by: who(p.requested_by),
          requested_by_name: whoName(p.requested_by),
          approved_by: p.approved_by ? who(p.approved_by) : null,
          legacy_id: p.id,
          created_at: p.created_at,
        });
        req.set(p.id, id);
      }
      const fileId = new Map();
      for (const f of s.files) {
        if (!req.has(f.requisition_id)) continue;
        const [id] = await trx('requisition_files').insert({
          requisition_id: req.get(f.requisition_id),
          kind: KINDS[f.kind] ?? 'DOC',
          supplier: f.supplier ?? null,
          amount: f.amount ?? null,
          original_name: String(f.original_name).slice(0, 255),
          stored_name: path.basename(f.stored_name),
          mime_type: f.mime,
          size_bytes: f.size,
          uploaded_by: who(f.uploaded_by),
          uploaded_by_name: whoName(f.uploaded_by),
          created_at: f.created_at,
        });
        fileId.set(f.id, id);
      }
      for (const p of s.requisitions) {
        if (p.quote_id && fileId.has(p.quote_id)) {
          await trx('requisitions')
            .where({ id: req.get(p.id) })
            .update({ quote_id: fileId.get(p.quote_id) });
        }
      }
      for (const l of s.log) {
        if (!req.has(l.requisition_id)) continue;
        await trx('requisition_events').insert({
          requisition_id: req.get(l.requisition_id),
          actor_id: who(l.user_id),
          actor_name: whoName(l.user_id),
          action: String(l.action).toUpperCase().slice(0, 40),
          from_status: l.from_status ? (STATUS[l.from_status] ?? l.from_status.toUpperCase()) : null,
          to_status: l.to_status ? (STATUS[l.to_status] ?? l.to_status.toUpperCase()) : null,
          note: l.note ?? null,
          created_at: l.created_at,
        });
      }
      // One audit entry for the whole import.
      await trx('audit_log').insert({
        actor_type: 'CLI',
        actor_employee_id: actorId,
        action: 'INVENTORY_IMPORTED',
        entity_type: 'system_setting',
        entity_id: 'inventory_import',
        after_data: JSON.stringify(plan.report.counts),
      });
    });
  } catch (err) {
    for (const f of copied) await fs.promises.unlink(f).catch(() => {});
    throw err;
  }
  plan.report.filesCopied = copied.length;
  return plan.report;
}
