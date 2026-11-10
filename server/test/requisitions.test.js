import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';
import { todayInLusaka } from '../src/utils/dates.js';

let db;
let app;
let entra;

beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());

const PDF = Buffer.from('%PDF-1.4\n% test quotation\n');
const as = (s) => ({
  get: (p) => s.agent.get(p),
  post: (p, body) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .send(body ?? {}),
  put: (p, body) =>
    s.agent
      .put(p)
      .set('X-CSRF-Token', s.csrf)
      .send(body ?? {}),
  upload: (p, buf, name) =>
    s.agent
      .post(p)
      .set('X-CSRF-Token', s.csrf)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(name))
      .send(buf),
});

let co; // company
let dept; // department ids
let branch;
let cat;
let people; // sessions by role
let ids; // employee ids

async function person(key, over) {
  const e = await fixtureEmployee(db, { company_id: co, first_name: key, ...over });
  ids[key] = e.id;
  people[key] = { ...(await signIn(app, entra, { oid: e.oid })), id: e.id };
}

beforeEach(async () => {
  await resetData(db);
  [co] = await db('companies').insert({ code: 'AFS', name: 'Altus Financial Services Limited' });
  const [other] = await db('companies').insert({ code: 'AIB', name: 'Altus Insurance Brokers' });
  dept = {};
  for (const [k, code, name, company] of [
    ['credit', 'CRD', 'Credit', co],
    ['it', 'ITD', 'Information Technology', co],
    ['accounts', 'ACC', 'Accounts', co],
    ['stores', 'STR', 'Stores', co],
    ['otherIt', 'ITD', 'Information Technology', other],
  ]) {
    [dept[k]] = await db('departments').insert({ code, name, company_id: company });
  }
  await db('requisition_departments').insert([
    { department_id: dept.it, function_code: 'IT' },
    { department_id: dept.otherIt, function_code: 'IT' },
    { department_id: dept.accounts, function_code: 'ACCOUNTS' },
    { department_id: dept.stores, function_code: 'STORES' },
  ]);
  [branch] = await db('stock_branches').insert({ company_id: co, name: 'Head Office' });
  [cat] = await db('stock_categories').insert({ name: 'Printer Consumables' });
  people = {};
  ids = {};
  await person('manager', { department_id: dept.credit, roles: ['DEPARTMENT_MANAGER'] });
  await person('staff', { department_id: dept.credit });
  await person('itOfficer', { department_id: dept.it });
  await person('otherIt', { department_id: dept.otherIt, company_id: other });
  await person('clerk', { department_id: dept.accounts });
  await person('accountsManager', { department_id: dept.accounts, roles: ['DEPARTMENT_MANAGER'] });
  await person('director', { roles: ['EXECUTIVE_DIRECTOR'] });
  await person('cfo', { roles: ['ACCOUNTS_DIRECTOR'] });
  await person('storekeeper', { department_id: dept.stores });
  await person('admin', { roles: ['HR_ADMIN'] });
});

const raise = (s, over = {}) =>
  as(s).post('/api/requisitions', {
    itemName: 'HP 305A toner',
    categoryId: cat,
    quantity: 4,
    reason: 'Toner for the Credit department printer',
    ...over,
  });
const act = (s, id, action, extra = {}) =>
  as(s).post(`/api/requisitions/${id}/actions`, { action, ...extra });
const status = async (id) => (await db('requisitions').where({ id }).first('status')).status;

describe('Requisitions: access', () => {
  it('opens only for people with a part in the workflow, from their existing roles and departments', async () => {
    expect((await as(people.staff).get('/api/requisitions/me')).status).toBe(403);
    const m = (await as(people.manager).get('/api/requisitions/me')).body;
    expect(m).toMatchObject({ canRaise: true, raiseAny: false, stock: true, stockDepartment: dept.credit });
    expect((await as(people.itOfficer).get('/api/requisitions/me')).body).toMatchObject({
      it: true,
      canRaise: false,
    });
    expect((await as(people.accountsManager).get('/api/requisitions/me')).body).toMatchObject({
      accounts: true,
      accountsManager: true,
    });
    expect((await as(people.clerk).get('/api/requisitions/me')).body.accountsManager).toBe(false);
    expect((await as(people.cfo).get('/api/requisitions/me')).body).toMatchObject({
      cfo: true,
      viewAll: true,
    });
    expect((await as(people.storekeeper).get('/api/requisitions/me')).body).toMatchObject({
      stores: true,
      stockDepartment: null,
    });
    expect((await as(people.staff).get('/api/stock/items')).status).toBe(403);
  });

  it('lets only the System Administrator choose the IT, Accounts and Stores departments', async () => {
    const body = { IT: [dept.it], ACCOUNTS: [dept.accounts], STORES: [] };
    expect((await as(people.director).put('/api/stock/settings', body)).status).toBe(403);
    expect((await as(people.admin).put('/api/stock/settings', body)).status).toBe(200);
    expect((await as(people.admin).get('/api/stock/settings')).body).toEqual(body);
    expect((await as(people.storekeeper).get('/api/requisitions/me')).status).toBe(403);
  });
});

describe('Requisitions: the workflow', () => {
  it('goes from the department through the Director, Accounts, Accounts Manager and CFO to payment and stock', async () => {
    const r = await raise(people.manager);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id;
    expect(r.body.status).toBe('QUOTES_DEPT');
    // A second open one for the same item and department is refused.
    expect((await raise(people.manager)).status).toBe(409);

    // Accounts can't see it yet; the department can't send it on without a quotation.
    expect((await as(people.clerk).get(`/api/requisitions/${id}`)).status).toBe(404);
    expect((await act(people.manager, id, 'TO_DIRECTOR')).status).toBe(400);
    const bad = await as(people.manager).upload(
      `/api/requisitions/${id}/files?kind=quote&supplier=Toner%20World&amount=2400`,
      Buffer.from('not a pdf'),
      'quote.pdf',
    );
    expect(bad.status).toBe(400);
    const q1 = await as(people.manager).upload(
      `/api/requisitions/${id}/files?kind=quote&supplier=Toner%20World&amount=2400`,
      PDF,
      'quote.pdf',
    );
    expect(q1.status, JSON.stringify(q1.body)).toBe(201);
    await as(people.manager).upload(
      `/api/requisitions/${id}/files?kind=quote&supplier=Office%20Hub&amount=2650.5`,
      PDF,
      'quote2.pdf',
    );
    expect((await act(people.manager, id, 'TO_DIRECTOR')).status).toBe(200);

    // The Director is told, and approves a quotation.
    expect(
      await db('notifications').where({ recipient_id: ids.director, entity_type: 'requisition' }).first('id'),
    ).toBeTruthy();
    expect((await act(people.cfo, id, 'APPROVE', { quoteId: q1.body.id })).status).toBe(403);
    expect((await act(people.director, id, 'APPROVE')).status).toBe(400);
    expect((await act(people.director, id, 'APPROVE', { quoteId: q1.body.id })).status).toBe(200);
    expect(await status(id)).toBe('ACCOUNTS');

    expect((await act(people.manager, id, 'TO_AM')).status).toBe(403);
    expect((await act(people.clerk, id, 'TO_AM', { note: 'Pay by EFT, invoice 1182' })).status).toBe(200);
    expect((await act(people.clerk, id, 'AM_APPROVE')).status).toBe(403);
    expect((await act(people.accountsManager, id, 'AM_REJECT')).status).toBe(400);
    expect((await act(people.accountsManager, id, 'AM_REJECT', { note: 'Wrong account' })).status).toBe(200);
    expect(await status(id)).toBe('ACCOUNTS');
    await act(people.clerk, id, 'TO_AM');
    expect((await act(people.accountsManager, id, 'AM_APPROVE')).status).toBe(200);
    expect((await act(people.cfo, id, 'CFO_APPROVE')).status).toBe(200);
    expect(await status(id)).toBe('PAY');

    // Proof of payment moves it to Paid; Stores receive it into stock.
    expect(
      (await as(people.manager).upload(`/api/requisitions/${id}/files?kind=pop`, PDF, 'pop.pdf')).status,
    ).toBe(403);
    expect(
      (await as(people.clerk).upload(`/api/requisitions/${id}/files?kind=pop&note=Ref%20889`, PDF, 'pop.pdf'))
        .status,
    ).toBe(201);
    expect(await status(id)).toBe('PAID');
    const detail = (await as(people.storekeeper).get(`/api/requisitions/${id}`)).body;
    expect(detail.can.receive).toBe(true);
    expect(detail.approvedQuote).toEqual({ supplier: 'Toner World', amount: 2400 });

    const rec = await as(people.storekeeper).post('/api/stock/receive', {
      newItem: { name: 'HP 305A toner', categoryId: cat },
      branchId: branch,
      supplier: 'Toner World',
      quantity: 4,
      unitPrice: 600,
      reorderLevel: 2,
      dateReceived: todayInLusaka(),
      requisitionId: id,
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(rec.body).toMatchObject({
      oldStock: 0,
      newStock: 4,
      requisition: `REQ-${String(id).padStart(4, '0')}`,
    });
    expect(await status(id)).toBe('RECEIVED');
    const item = await db('stock_items').where({ id: rec.body.itemId }).first();
    expect(item).toMatchObject({ quantity: 4, reorder_level: 2 });
    const events = (await as(people.manager).get(`/api/requisitions/${id}`)).body.events.map((e) => e.action);
    expect(events).toEqual([
      'RAISED',
      'QUOTE_ADDED',
      'QUOTE_ADDED',
      'TO_DIRECTOR',
      'APPROVED',
      'TO_AM',
      'AM_REJECTED',
      'TO_AM',
      'AM_APPROVED',
      'CFO_APPROVED',
      'POP_SENT',
      'RECEIVED',
    ]);
    // The raiser hears it was received.
    expect(
      await db('notifications')
        .where({ recipient_id: ids.manager, event_type: 'REQUISITION_RECEIVED' })
        .first('id'),
    ).toBeTruthy();
  });

  it("sends IT-related requisitions to the company's own IT for quotations", async () => {
    const id = (await raise(people.manager, { isIt: true, itemName: 'Laptop' })).body.id;
    expect(await status(id)).toBe('QUOTES_IT');
    const url = `/api/requisitions/${id}/files?kind=quote&supplier=Dell&amount=15000`;
    expect((await as(people.manager).upload(url, PDF, 'q.pdf')).status).toBe(403);
    // Another company's IT does not act for a company with its own IT department.
    expect((await as(people.otherIt).upload(url, PDF, 'q.pdf')).status).toBe(404);
    expect((await as(people.itOfficer).upload(url, PDF, 'q.pdf')).status).toBe(201);
    expect((await act(people.itOfficer, id, 'TO_DIRECTOR')).status).toBe(200);
    // Rejected back to the department, which can ask IT for new quotations.
    expect((await act(people.director, id, 'REJECT', { note: 'Too dear' })).status).toBe(200);
    expect(await status(id)).toBe('RETURNED');
    const d = (await as(people.manager).get(`/api/requisitions/${id}`)).body;
    expect(d.rejection).toMatchObject({ note: 'Too dear' });
    expect((await act(people.manager, id, 'BACK_TO_IT')).status).toBe(200);
    expect(await status(id)).toBe('QUOTES_IT');
  });

  it('is cancelled only by the department, with a reason, before approval', async () => {
    const id = (await raise(people.manager)).body.id;
    expect((await act(people.director, id, 'CANCEL', { note: 'No longer needed' })).status).toBe(403);
    expect((await act(people.manager, id, 'CANCEL')).status).toBe(400);
    expect((await act(people.manager, id, 'CANCEL', { note: 'No longer needed' })).status).toBe(200);
    expect(await status(id)).toBe('CANCELLED');
    expect((await act(people.manager, id, 'CANCEL', { note: 'again' })).status).toBe(403);
  });

  it('lists what is waiting for each person', async () => {
    const id = (await raise(people.manager)).body.id;
    await as(people.manager).upload(
      `/api/requisitions/${id}/files?kind=quote&supplier=Toner%20World&amount=10`,
      PDF,
      'q.pdf',
    );
    await act(people.manager, id, 'TO_DIRECTOR');
    const list = (await as(people.director).get('/api/requisitions')).body;
    expect(list.tab).toBe('mine');
    expect(list.items.map((r) => r.id)).toEqual([id]);
    expect(list.items[0]).toMatchObject({
      yourTurn: true,
      statusLabel: 'Waiting for Director approval',
      raisedBy: expect.stringContaining('manager'),
    });
    expect((await as(people.director).get('/api/requisitions/me')).body.waiting).toBe(1);
    expect((await as(people.manager).get('/api/requisitions/me')).body.waiting).toBe(0);
  });
});

describe('Stock', () => {
  async function stocked(qty = 10) {
    const r = await as(people.storekeeper).post('/api/stock/items', {
      name: 'A4 paper ream',
      categoryId: cat,
      reorderLevel: 3,
      unitPrice: 85,
      openingQuantity: qty,
      branchId: branch,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id;
  }

  it('issues to a department, never more than the branch holds, and keeps branch and total in step', async () => {
    const item = await stocked(10);
    const issue = (quantity) =>
      as(people.storekeeper).post('/api/stock/issue', {
        itemId: item,
        branchId: branch,
        departmentId: dept.credit,
        quantity,
        recipient: 'Mary Phiri',
        dateIssued: todayInLusaka(),
      });
    expect((await issue(11)).status).toBe(409);
    const ok = await issue(8);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ oldStock: 10, newStock: 2 });
    expect(await db('stock_items').where({ id: item }).first('quantity')).toEqual({ quantity: 2 });
    expect(await db('branch_stock').where({ item_id: item, branch_id: branch }).first('quantity')).toEqual({
      quantity: 2,
    });
    // Only Stores issue.
    expect((await as(people.manager).post('/api/stock/issue', { itemId: item })).status).toBe(403);

    // Stores see every item with its state; a department manager sees what went to their department.
    const all = (await as(people.storekeeper).get('/api/stock/items')).body;
    expect(all.items[0]).toMatchObject({ name: 'A4 paper ream', quantity: 2, state: 'low', initial: 10 });
    const mine = (await as(people.manager).get('/api/stock/items')).body;
    expect(mine.scoped).toBe(true);
    expect(mine.items[0]).toMatchObject({ issuedToDepartment: 8, value: 680 });
    const tx = (await as(people.manager).get('/api/stock/transactions')).body.items;
    expect(tx.map((t) => t.type)).toEqual(['Issued']);

    // Monthly report by category: opening 0, received 10, issued 8, closing 2.
    const rep = (await as(people.storekeeper).get('/api/stock/reports?by=category')).body;
    expect(rep.groups[0]).toMatchObject({
      name: 'Printer Consumables',
      opening: 0,
      received: 10,
      issued: 8,
      closing: 2,
    });
    const byDept = (await as(people.director).get('/api/stock/reports?by=department')).body;
    expect(byDept.groups[0]).toMatchObject({ name: 'Credit', units: 8, value: 680 });

    // An item with history can't be deleted.
    expect(
      (
        await people.storekeeper.agent
          .delete(`/api/stock/items/${item}`)
          .set('X-CSRF-Token', people.storekeeper.csrf)
      ).status,
    ).toBe(409);
    const xlsx = await as(people.storekeeper).get('/api/stock/items?format=xlsx');
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
  });

  it('dashboard shows stock health and what needs reordering', async () => {
    await stocked(2);
    const d = (await as(people.director).get('/api/stock/dashboard')).body;
    expect(d).toMatchObject({ scope: 'all', items: 1, needReordering: 1, stockValue: 170 });
    expect(d.health).toEqual({ ok: 0, low: 1, out: 0 });
    expect(d.weeks).toHaveLength(8);
  });

  it('branches are managed by the System Administrator only', async () => {
    expect(
      (await as(people.storekeeper).post('/api/stock/branches', { companyId: co, name: 'Kitwe' })).status,
    ).toBe(403);
    const r = await as(people.admin).post('/api/stock/branches', {
      companyId: co,
      name: 'Kitwe',
      location: 'Kitwe CBD',
    });
    expect(r.status).toBe(201);
    expect(
      (await as(people.admin).post('/api/stock/branches', { companyId: co, name: 'kitwe' })).status,
    ).toBe(409);
  });
});

describe('Requisitions: Employee management is the source of people and departments', () => {
  it('tells inventory role-holders when it is their turn, and not those whose role leaves it out', async () => {
    // The staff member gets the inventory Director role; the HR Executive Director gets a role
    // without approval, which replaces what their HR role gave them here (D107).
    const role = async (name) => (await db('inventory_roles').where({ name }).first('id')).id;
    await db('inventory_users').insert([
      { employee_id: ids.staff, role_id: await role('Director') },
      { employee_id: ids.director, role_id: await role('Accountant') },
    ]);
    const r = await raise(people.manager);
    await as(people.manager).upload(
      `/api/requisitions/${r.body.id}/files?kind=quote&supplier=Toner%20World&amount=2400`,
      PDF,
      'quote.pdf',
    );
    expect((await act(people.manager, r.body.id, 'TO_DIRECTOR')).status).toBe(200);
    const told = await db('notifications')
      .where({ entity_type: 'requisition', entity_id: r.body.id })
      .pluck('recipient_id');
    expect(told).toContain(ids.staff);
    expect(told).not.toContain(ids.director);
  });

  it('refuses a requisition from a department closed in Employee management', async () => {
    await db('departments').where({ id: dept.credit }).update({ is_active: false });
    const r = await raise(people.manager);
    expect(r.status).toBe(400);
    expect(r.body.message ?? r.body.error?.message ?? JSON.stringify(r.body)).toMatch(/closed/);
  });
});
