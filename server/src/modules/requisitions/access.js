import { forbidden } from '../../utils/errors.js';
import { ALL_PERMISSIONS } from './permissions.js';

/*
 * Who does what in the Requisitions module (D105). The inventory system gave these rights on its
 * own Roles page; here they come from the HR system's existing roles and departments:
 *
 *   Raise a requisition    Department Managers and line managers, for their own department;
 *                          the System Administrator for any company and department
 *   IT quotations          staff of an IT department
 *   Director approval      Executive Director, Managing Director
 *   Accounts               staff of an Accounts department
 *   Accounts Manager       a Department Manager or line manager in an Accounts department
 *   CFO (final approval)   Accounts Director
 *   Stores                 staff of a Stores department: stock, receiving and issuing
 *   See everything         directors, the Accounts Director and the System Administrator
 *
 * The System Administrator chooses which departments are IT, Accounts and Stores. Each such
 * department serves its own company; a company without one is served by every department with
 * that function, so a single group IT or Stores department works for all companies.
 */

export const FUNCTIONS = ['IT', 'ACCOUNTS', 'STORES'];
const DIRECTORS = ['EXECUTIVE_DIRECTOR', 'MANAGING_DIRECTOR'];

/** Everything the module needs to know about the signed-in person, read once per request. */
export async function requisitionContext(db, user) {
  const me = await db('employees').where({ id: user.id }).first('company_id', 'department_id');
  const configured = await db('requisition_departments as rd')
    .join('departments as d', 'd.id', 'rd.department_id')
    .where('d.is_active', true)
    .select('rd.function_code', 'rd.department_id', 'd.company_id');
  const has = (r) => user.roles.includes(r);
  const isAdmin = has('HR_ADMIN');
  const isManager = Boolean(user.isManager || has('DEPARTMENT_MANAGER'));

  // For each function: the companies whose departments have it, and the companies this person
  // serves through their own department.
  const fn = {};
  for (const code of FUNCTIONS) {
    const rows = configured.filter((r) => r.function_code === code);
    const mine = rows.filter((r) => r.department_id === me?.department_id);
    fn[code] = {
      configuredCompanies: [...new Set(rows.map((r) => r.company_id).filter(Boolean))],
      member: mine.length > 0,
      companies: [...new Set(mine.map((r) => r.company_id).filter(Boolean))],
    };
  }

  // An inventory role (D107) replaces all of the above for that person: exactly the role's
  // rights, as on the inventory system. The System Administrator always has everything.
  const role = isAdmin
    ? null
    : await db('inventory_users as u')
        .join('inventory_roles as r', 'r.id', 'u.role_id')
        .where({ 'u.employee_id': user.id, 'u.is_active': true })
        .first('r.id', 'r.name', 'r.is_system');
  if (role) {
    const perms = new Set(
      (await db('inventory_role_permissions').where({ role_id: role.id }).pluck('permission')).concat(
        role.is_system ? ALL_PERMISSIONS : [],
      ),
    );
    return roleContext({ user, me, perms, role });
  }

  const ctx = {
    id: user.id,
    companyId: me?.company_id ?? null,
    departmentId: me?.department_id ?? null,
    isAdmin,
    isManager,
    isDirector: isAdmin || DIRECTORS.some(has),
    isCfo: isAdmin || has('ACCOUNTS_DIRECTOR'),
    fn,
  };
  ctx.it = isAdmin || fn.IT.member;
  ctx.accounts = isAdmin || fn.ACCOUNTS.member;
  ctx.accountsManager = isAdmin || (fn.ACCOUNTS.member && isManager);
  ctx.stores = isAdmin || fn.STORES.member;
  ctx.viewAll = isAdmin || DIRECTORS.some(has) || has('ACCOUNTS_DIRECTOR');
  ctx.canRaise = isAdmin || (isManager && Boolean(ctx.departmentId));
  ctx.raiseAny = isAdmin;
  // Stock: Stores and those who see everything see all of it; managers see what was issued to
  // their own department.
  ctx.stockAll = ctx.stores || ctx.viewAll;
  ctx.stockDepartment = !ctx.stockAll && isManager && ctx.departmentId ? ctx.departmentId : null;
  ctx.canSeeStock = ctx.stockAll || Boolean(ctx.stockDepartment);
  ctx.canOpen =
    ctx.canRaise || ctx.it || ctx.accounts || ctx.isDirector || ctx.isCfo || ctx.stores || ctx.viewAll;
  // The finer inventory rights, from the HR-role access above.
  ctx.receive = ctx.stores;
  ctx.issue = ctx.stores;
  ctx.itemsManage = ctx.stores;
  ctx.categoriesManage = ctx.stores;
  ctx.transactions = ctx.canSeeStock;
  ctx.reports = ctx.canSeeStock;
  ctx.orgAdmin = isAdmin;
  ctx.usersAdmin = isAdmin;
  ctx.rolesAdmin = isAdmin;
  ctx.inventoryRole = isAdmin ? 'System Administrator' : null;
  return ctx;
}

/**
 * Access from an inventory role (D107). The workflow parts (IT, Accounts, Stores) serve the
 * person's own company, as "for their own company" on the inventory's Roles page; a person with
 * no company serves every company.
 */
function roleContext({ user, me, perms, role }) {
  const can = (p) => perms.has(p);
  const companyId = me?.company_id ?? null;
  const part = (on) => ({
    member: on,
    companies: on && companyId ? [companyId] : [],
    configuredCompanies: on && companyId ? [companyId] : [],
  });
  const receiving = can('stock.receive');
  const ctx = {
    id: user.id,
    companyId,
    departmentId: me?.department_id ?? null,
    isAdmin: false,
    isManager: Boolean(user.isManager),
    isDirector: can('requisitions.approve'),
    isCfo: can('requisitions.cfo'),
    fn: {
      IT: part(can('requisitions.it_quotes')),
      ACCOUNTS: part(can('requisitions.accounts') || can('requisitions.accounts_review')),
      STORES: part(receiving),
    },
    inventoryRole: role.name,
  };
  ctx.it = can('requisitions.it_quotes');
  ctx.accounts = can('requisitions.accounts');
  ctx.accountsManager = can('requisitions.accounts_review');
  ctx.stores = receiving || can('stock.issue');
  ctx.viewAll = can('requisitions.view_all');
  ctx.canRaise = can('requisitions.raise') && (can('requisitions.raise_any') || Boolean(ctx.departmentId));
  ctx.raiseAny = can('requisitions.raise_any');
  // Own department only: held to the department on their employee record. Without one they see
  // no stock at all (the stock routes read a missing department as "everything").
  const limited = can('scope.department');
  const allowed = !limited || Boolean(ctx.departmentId);
  ctx.stockAll = can('stock.view') && !limited;
  ctx.stockDepartment = limited && ctx.departmentId ? ctx.departmentId : null;
  ctx.canSeeStock = can('stock.view') && allowed;
  ctx.receive = receiving;
  ctx.issue = can('stock.issue');
  ctx.itemsManage = can('items.manage');
  ctx.categoriesManage = can('categories.manage');
  ctx.transactions = can('transactions.view') && allowed;
  ctx.reports = can('reports.view') && allowed;
  ctx.orgAdmin = can('admin.org');
  ctx.usersAdmin = can('admin.users');
  ctx.rolesAdmin = can('admin.roles');
  ctx.canOpen =
    ctx.canRaise ||
    ctx.it ||
    ctx.accounts ||
    ctx.accountsManager ||
    ctx.isDirector ||
    ctx.isCfo ||
    ctx.canSeeStock ||
    ctx.viewAll ||
    ctx.transactions ||
    ctx.reports ||
    ctx.categoriesManage ||
    ctx.orgAdmin ||
    ctx.usersAdmin ||
    ctx.rolesAdmin;
  return ctx;
}

/** Does this person act for function `code` on a requisition of company `companyId`? */
export function servesCompany(ctx, code, companyId) {
  if (ctx.isAdmin) return true;
  const f = ctx.fn[code];
  if (!f.member) return false;
  if (companyId && f.companies.includes(companyId)) return true;
  return !companyId || !f.configuredCompanies.includes(companyId);
}

/** SQL (knex where-callback) for "company served by this person for function `code`". */
function servedWhere(ctx, code, col = 'r.company_id') {
  return function where() {
    if (ctx.isAdmin) return this.whereRaw('1 = 1');
    const f = ctx.fn[code];
    if (!f.member) return this.whereRaw('1 = 0');
    if (f.companies.length) this.orWhereIn(col, f.companies);
    this.orWhereNull(col);
    if (f.configuredCompanies.length) this.orWhereNotIn(col, f.configuredCompanies);
    else this.orWhereNotNull(col);
  };
}

/** The raiser's side: the person who raised it, or a manager of that department. */
export function isDepartmentSide(ctx, r) {
  if (r.requested_by === ctx.id) return true;
  return ctx.canRaise && !ctx.raiseAny && ctx.departmentId && r.department_id === ctx.departmentId;
}

/** Is it this person's turn on the requisition? */
export function myTurn(ctx, r) {
  switch (r.status) {
    case 'QUOTES_IT':
      return servesCompany(ctx, 'IT', r.company_id);
    case 'QUOTES_DEPT':
    case 'RETURNED':
      return isDepartmentSide(ctx, r) || ctx.isAdmin;
    case 'DIRECTOR':
      return ctx.isDirector;
    case 'ACCOUNTS':
    case 'PAY':
      return servesCompany(ctx, 'ACCOUNTS', r.company_id);
    case 'ACCOUNTS_MANAGER':
      return ctx.accountsManager && servesCompany(ctx, 'ACCOUNTS', r.company_id);
    case 'CFO':
      return ctx.isCfo;
    case 'PAID':
      return servesCompany(ctx, 'STORES', r.company_id);
    default:
      return false;
  }
}

/** Restrict a knex query on requisitions (alias r) to those this person may see. */
export function visibleTo(ctx) {
  return function where() {
    if (ctx.viewAll) return this.whereRaw('1 = 1');
    this.where('r.requested_by', ctx.id);
    if (ctx.canRaise && ctx.departmentId) this.orWhere('r.department_id', ctx.departmentId);
    if (ctx.it) this.orWhere((q) => q.where('r.is_it', true).andWhere(servedWhere(ctx, 'IT')));
    if (ctx.isDirector) this.orWhereNot('r.status', 'CANCELLED');
    if (ctx.accounts || ctx.isCfo) {
      this.orWhere((q) =>
        q
          .whereIn('r.status', ['ACCOUNTS', 'ACCOUNTS_MANAGER', 'CFO', 'PAY', 'PAID', 'RECEIVED'])
          .andWhere(ctx.isCfo ? () => {} : servedWhere(ctx, 'ACCOUNTS')),
      );
    }
    if (ctx.stores) {
      this.orWhere((q) => q.whereIn('r.status', ['PAID', 'RECEIVED']).andWhere(servedWhere(ctx, 'STORES')));
    }
  };
}

/** Restrict to those waiting for this person (mirrors myTurn). */
export function waitingFor(ctx) {
  return function where() {
    this.where((q) =>
      q.whereIn('r.status', ['QUOTES_DEPT', 'RETURNED']).andWhere((d) => {
        d.where('r.requested_by', ctx.id);
        if (ctx.canRaise && !ctx.raiseAny && ctx.departmentId) d.orWhere('r.department_id', ctx.departmentId);
        if (ctx.isAdmin) d.orWhereRaw('1 = 1');
      }),
    );
    if (ctx.it) this.orWhere((q) => q.where('r.status', 'QUOTES_IT').andWhere(servedWhere(ctx, 'IT')));
    if (ctx.isDirector) this.orWhere('r.status', 'DIRECTOR');
    if (ctx.accounts) {
      this.orWhere((q) => q.whereIn('r.status', ['ACCOUNTS', 'PAY']).andWhere(servedWhere(ctx, 'ACCOUNTS')));
    }
    if (ctx.accountsManager) {
      this.orWhere((q) => q.where('r.status', 'ACCOUNTS_MANAGER').andWhere(servedWhere(ctx, 'ACCOUNTS')));
    }
    if (ctx.isCfo) this.orWhere('r.status', 'CFO');
    if (ctx.stores) this.orWhere((q) => q.where('r.status', 'PAID').andWhere(servedWhere(ctx, 'STORES')));
  };
}

/** Middleware: attach req.rq (the context) and require the module at all. */
export function loadRequisitionContext({ db }) {
  return async (req, res, next) => {
    try {
      req.rq = await requisitionContext(db, req.user);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const need = (check, message) => (req, res, next) =>
  check(req.rq) ? next() : next(forbidden(message));
