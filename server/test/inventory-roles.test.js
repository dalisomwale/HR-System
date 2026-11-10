import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createTestDb, resetData } from './helpers/db.js';
import { testApp, fixtureEmployee, signIn } from './helpers/app.js';

/* The inventory system's own Users and Roles (D107). */

let db;
let app;
let entra;

beforeAll(() => {
  db = createTestDb();
  ({ app, entra } = testApp(db));
});
afterAll(() => db.destroy());

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
  del: (p) => s.agent.delete(p).set('X-CSRF-Token', s.csrf),
});

let co;
let dept;
let people;
const roleId = async (name) => (await db('inventory_roles').where({ name }).first('id')).id;

async function person(key, over) {
  const e = await fixtureEmployee(db, { company_id: co, first_name: key, ...over });
  people[key] = { ...(await signIn(app, entra, { oid: e.oid })), id: e.id };
}

beforeEach(async () => {
  await resetData(db);
  [co] = await db('companies').insert({ code: 'AFS', name: 'Altus Financial Services Limited' });
  [dept] = await db('departments').insert({ code: 'CRD', name: 'Credit', company_id: co });
  people = {};
  await person('admin', { roles: ['HR_ADMIN'] });
  await person('clerk', { department_id: dept });
  await person('noDept', {});
});

describe('Inventory roles and users', () => {
  it('installs the inventory system default roles', async () => {
    const r = await as(people.admin).get('/api/inventory/roles');
    expect(r.status).toBe(200);
    expect(r.body.items.map((x) => x.name)).toEqual(
      expect.arrayContaining(['System Admin', 'Staff', 'Director', 'Chief Finance Officer']),
    );
    const staff = r.body.items.find((x) => x.name === 'Staff');
    expect(staff.levels.stock).toBe(3);
    expect(r.body.items.find((x) => x.isSystem).levels.roles).toBe(1);
  });

  it('gives an employee exactly their role rights, and nothing without one', async () => {
    expect((await as(people.clerk).get('/api/requisitions/me')).status).toBe(403);
    const add = await as(people.admin).post('/api/inventory/users', {
      employeeId: people.clerk.id,
      roleId: await roleId('Staff'),
    });
    expect(add.status).toBe(201);
    const me = (await as(people.clerk).get('/api/requisitions/me')).body;
    expect(me).toMatchObject({
      stock: true,
      receive: true,
      issue: true,
      itemsManage: true,
      categoriesManage: true,
      canRaise: true,
      cfo: false,
      usersAdmin: false,
      role: 'Staff',
    });
    expect((await as(people.clerk).get('/api/inventory/users')).status).toBe(403);
  });

  it('builds a custom role from levels and enforces it on the stock routes', async () => {
    const made = await as(people.admin).post('/api/inventory/roles', {
      name: 'Viewer',
      levels: { stock: 1, reports: 1, requisitions: [] },
    });
    expect(made.status).toBe(201);
    await as(people.admin).post('/api/inventory/users', {
      employeeId: people.clerk.id,
      roleId: made.body.id,
    });
    const me = (await as(people.clerk).get('/api/requisitions/me')).body;
    expect(me).toMatchObject({ stock: true, reports: true, receive: false, transactions: false });
    expect((await as(people.clerk).get('/api/stock/transactions')).status).toBe(403);
    expect((await as(people.clerk).post('/api/stock/categories', { name: 'Paper' })).status).toBe(403);
    // A role in use cannot be deleted; the System Admin role cannot be changed.
    expect((await as(people.admin).del(`/api/inventory/roles/${made.body.id}`)).status).toBe(409);
    const sys = await roleId('System Admin');
    expect(
      (await as(people.admin).put(`/api/inventory/roles/${sys}`, { name: 'X', levels: {} })).status,
    ).toBe(400);
  });

  it('holds an own-department-only role to the department, and to nothing without one', async () => {
    const made = await as(people.admin).post('/api/inventory/roles', {
      name: 'Department viewer',
      levels: { stock: 1, scope: 1 },
    });
    for (const p of [people.clerk, people.noDept]) {
      await as(people.admin).post('/api/inventory/users', { employeeId: p.id, roleId: made.body.id });
    }
    expect((await as(people.clerk).get('/api/requisitions/me')).body).toMatchObject({
      stock: true,
      stockDepartment: dept,
    });
    // No department means no stock, and with nothing else in the role, no access at all.
    expect((await as(people.noDept).get('/api/requisitions/me')).status).toBe(403);
  });

  it('disables access, and stops people changing their own', async () => {
    await as(people.admin).post('/api/inventory/users', {
      employeeId: people.clerk.id,
      roleId: await roleId('Staff'),
    });
    const off = await as(people.admin).put(`/api/inventory/users/${people.clerk.id}`, {
      roleId: await roleId('Staff'),
      isActive: false,
    });
    expect(off.status).toBe(200);
    expect((await as(people.clerk).get('/api/requisitions/me')).status).toBe(403);

    await as(people.admin).post('/api/inventory/users', {
      employeeId: people.noDept.id,
      roleId: await roleId('System Admin'),
    });
    const self = await as(people.noDept).del(`/api/inventory/users/${people.noDept.id}`);
    expect(self.status).toBe(400);
  });

  it('lists suppliers from deliveries', async () => {
    const [cat] = await db('stock_categories').insert({ name: 'Paper' });
    const [item] = await db('stock_items').insert({ category_id: cat, name: 'A4 ream', unit_price: 50 });
    await db('stock_receipts').insert([
      { item_id: item, supplier: 'Novatek', quantity: 10, unit_price: 50, date_received: '2026-11-01' },
      { item_id: item, supplier: 'Novatek', quantity: 5, unit_price: 52, date_received: '2026-11-05' },
    ]);
    const r = await as(people.admin).get('/api/inventory/suppliers');
    expect(r.body.items).toEqual([
      expect.objectContaining({ name: 'Novatek', deliveries: 2, units: 15, value: 760 }),
    ]);
  });
});
