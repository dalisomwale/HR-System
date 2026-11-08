import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import knex from 'knex';
import { createTestDb, resetData } from './helpers/db.js';
import { fixtureEmployee } from './helpers/app.js';
import { getConfig } from '../src/config/env.js';
import { planImport, runImport } from '../src/modules/requisitions/inventory-import.js';

/*
 * The inventory import (D106) against a real inventory schema (the inventory system's own
 * sql/setup.sql) in a database of its own, inventory_src_test. Skipped where the test user has
 * no access to that database.
 */
const SRC_DB = 'inventory_src_test';
let db;
let src;
let available = false;

beforeAll(async () => {
  db = createTestDb();
  const c = getConfig().db;
  src = knex({
    client: 'mysql2',
    connection: {
      host: c.host,
      port: c.port,
      user: c.user,
      password: c.password,
      database: SRC_DB,
      multipleStatements: true,
    },
    pool: { min: 0, max: 1 },
  });
  try {
    await src.raw('SELECT 1');
    available = true;
  } catch {
    available = false;
  }
});
afterAll(async () => {
  await src?.destroy();
  await db.destroy();
});

async function loadInventory() {
  const [tables] = await src.raw(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
    [SRC_DB],
  );
  await src.raw('SET FOREIGN_KEY_CHECKS = 0');
  for (const { name } of tables) await src.raw('DROP TABLE ??', [name]);
  await src.raw('SET FOREIGN_KEY_CHECKS = 1');
  const sql = fs
    .readFileSync(path.join(import.meta.dirname, 'fixtures', 'inventory-setup.sql'), 'utf8')
    .replace(/^CREATE DATABASE.*$/m, '')
    .replace(/^USE .*$/m, '');
  await src.raw(sql);
  // The inventory as it might stand: one branch, two departments, two people, an item with
  // stock and movements, and a paid requisition with a quotation and a proof of payment.
  await src('branches').insert({ id: 2, company_id: 1, name: 'Kitwe' });
  await src('departments').insert([
    { id: 1, branch_id: 1, name: 'Credit' },
    { id: 2, branch_id: 1, name: 'Marketing' },
  ]);
  await src('users').insert([
    {
      id: 1,
      full_name: 'Mary Phiri',
      email: 'MARY@altus.test',
      password: 'x',
      role_id: 3,
      company_id: 1,
      department_id: 1,
    },
    {
      id: 2,
      full_name: 'Old Storekeeper',
      email: 'gone@altus.test',
      password: 'x',
      role_id: 2,
      company_id: 1,
    },
  ]);
  const cat = (await src('categories').where({ name: 'Stationery' }).first('id')).id;
  await src('items').insert({
    id: 1,
    item_name: 'A4 paper ream',
    category: 'Stationery',
    category_id: cat,
    current_quantity: 30,
    unit_price: 85,
    reorder_level: 5,
  });
  await src('branch_stock').insert({ item_id: 1, branch_id: 1, quantity: 25 }); // 5 not at any branch
  await src('stock_receiving').insert({
    id: 1,
    item_id: 1,
    supplier: 'Paper Co',
    quantity: 40,
    unit_price: 85,
    date_received: '2026-10-01',
    received_by: 2,
    branch_id: 1,
    old_stock: 0,
    new_stock: 40,
  });
  await src('stock_issuing').insert({
    id: 1,
    item_id: 1,
    quantity: 10,
    issued_to: 'Credit — Head Office',
    recipient: 'Mary Phiri',
    date_issued: '2026-10-05',
    issued_by: 2,
    branch_id: 1,
    department_id: 1,
    old_stock: 40,
    new_stock: 30,
  });
  await src('procurement').insert({
    id: 7,
    item_name: 'Toner',
    quantity: 2,
    reason: 'Printer',
    category_id: cat,
    category: 'Stationery',
    company_id: 1,
    branch_id: 1,
    department_id: 2,
    status: 'paid',
    stage_at: '2026-10-10 10:00:00',
    requested_by: 1,
    supplier: 'Toner World',
  });
  await src('requisition_files').insert([
    {
      id: 11,
      requisition_id: 7,
      kind: 'quote',
      supplier: 'Toner World',
      amount: 1200,
      original_name: 'q.pdf',
      stored_name: 'aaaa.pdf',
      mime: 'application/pdf',
      size: 10,
      uploaded_by: 1,
    },
    {
      id: 12,
      requisition_id: 7,
      kind: 'pop',
      original_name: 'pop.pdf',
      stored_name: 'bbbb.pdf',
      mime: 'application/pdf',
      size: 10,
      uploaded_by: 2,
    },
  ]);
  await src('procurement').where({ id: 7 }).update({ quote_id: 11 });
  await src('requisition_log').insert([
    { requisition_id: 7, user_id: 1, action: 'raised', to_status: 'quotes_dept' },
    { requisition_id: 7, user_id: 2, action: 'pop_sent', from_status: 'pay', to_status: 'paid' },
  ]);
}

describe('Inventory import', () => {
  let mary;
  let afs;
  beforeEach(async () => {
    if (!available) return;
    await resetData(db);
    await loadInventory();
    [afs] = await db('companies').insert({ code: 'AFS', name: 'Altus Financial Services Limited' });
    await db('departments').insert({ code: 'CRD', name: 'Credit', company_id: afs });
    mary = await fixtureEmployee(db, { email: 'mary@altus.test', company_id: afs });
  });

  it('dry run reports how companies, departments and people line up, and changes nothing', async (ctx) => {
    if (!available) ctx.skip();
    const { report } = await planImport(db, src);
    expect(report.counts).toMatchObject({ items: 1, requisitions: 1, files: 2, deliveries: 1, issues: 1 });
    expect(report.companiesMatched).toEqual(['Altus Financial Services Limited']);
    expect(report.blockingCompanies).toEqual([]);
    expect(report.unmatchedDepartments).toEqual(['Marketing (Altus Financial Services Limited)']);
    expect(report.unmatchedPeople).toEqual(['Old Storekeeper <gone@altus.test>']);
    expect(report.warnings.join(' ')).toMatch(/A4 paper ream \(5\)/);
    expect(await db('stock_items').count({ n: '*' }).first()).toEqual({ n: 0 });
  });

  it('copies stock, movements, requisitions, files and history, keeping unmatched names', async (ctx) => {
    if (!available) ctx.skip();
    const from = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-files-'));
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-files-'));
    fs.writeFileSync(path.join(from, 'aaaa.pdf'), '%PDF-1.4 quote');
    const report = await runImport(db, src, { filesFrom: from, filesTo: to });
    expect(report.missingFiles).toEqual(['pop.pdf']);
    expect(report.filesCopied).toBe(1);
    expect(fs.existsSync(path.join(to, 'aaaa.pdf'))).toBe(true);

    const item = await db('stock_items').first();
    expect(item).toMatchObject({ name: 'A4 paper ream', quantity: 30, legacy_id: 1 });
    // Totals and branch stock agree: the 5 not at a branch went to the first branch.
    const held = await db('branch_stock').where({ item_id: item.id }).sum({ q: 'quantity' }).first();
    expect(Number(held.q)).toBe(30);
    expect(await db('stock_branches').pluck('name')).toEqual(
      expect.arrayContaining(['Head Office', 'Kitwe']),
    );

    const issue = await db('stock_issues').first();
    expect(issue.department_id).not.toBeNull();
    expect(issue).toMatchObject({ issued_by: null, issued_by_name: 'Old Storekeeper', quantity: 10 });

    const r = await db('requisitions').first();
    expect(r).toMatchObject({
      status: 'PAID',
      requested_by: mary.id,
      department_id: null,
      department_name: 'Marketing',
      legacy_id: 7,
    });
    const quote = await db('requisition_files').where({ kind: 'QUOTE' }).first();
    expect(r.quote_id).toBe(quote.id);
    expect(await db('requisition_events').where({ requisition_id: r.id }).pluck('action')).toEqual([
      'RAISED',
      'POP_SENT',
    ]);

    await expect(runImport(db, src, {})).rejects.toThrow(/already been imported/);
  });

  it('refuses when a company in use has no match, unless it is mapped', async (ctx) => {
    if (!available) ctx.skip();
    await db('companies').where({ id: afs }).update({ name: 'Altus Financial Services Ltd' });
    await expect(runImport(db, src, {})).rejects.toThrow(/no match in the HR system/);
    const report = await runImport(db, src, {
      maps: { 'Altus Financial Services Limited': 'Altus Financial Services Ltd' },
    });
    expect(report.counts.requisitions).toBe(1);
  });
});
