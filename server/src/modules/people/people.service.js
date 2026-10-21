import { notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { addDays } from '../leave/calendar.js';
import { personalOf } from '../profile/profile.routes.js';

/*
 * Employee management (phase 2, D52): the central employee record. Every HR module reads people
 * from here; only this module (and the leave system's HR screens, which call the same service)
 * changes them.
 */

const name = (f, l) => (f ? `${f} ${l}` : null);

/** Length-of-service bands used by the charts. */
export const SERVICE_BANDS = [
  { key: 'lt1', label: 'Under 1 year', max: 12 },
  { key: 'y1to2', label: '1 to 2 years', max: 24 },
  { key: 'y2to5', label: '2 to 5 years', max: 60 },
  { key: 'y5to10', label: '5 to 10 years', max: 120 },
  { key: 'gt10', label: 'Over 10 years', max: Infinity },
];
function monthsOfService(start, today) {
  if (!start || start > today) return null;
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}
const bandOf = (months) => SERVICE_BANDS.find((b) => months < b.max).key;
const emptyBands = () => Object.fromEntries(SERVICE_BANDS.map((b) => [b.key, 0]));
const SOON_DAYS = 30;
const CONTRACT_DAYS = 60;

/** Quick filters on the directory, each a condition on the active staff list. */
export const QUICK_FILTERS = {
  probation: {
    label: 'On probation',
    apply: (q) => q.whereIn('e.probation_status', ['ON_PROBATION', 'EXTENDED']),
  },
  contractEnding: {
    label: 'Contract ending soon',
    apply: (q, today) => q.whereBetween('e.contract_end_date', [today, addDays(today, CONTRACT_DAYS)]),
  },
  startingSoon: {
    label: 'Starting soon',
    apply: (q, today) =>
      q
        .where('e.employment_start_date', '>', today)
        .andWhere('e.employment_start_date', '<=', addDays(today, SOON_DAYS)),
  },
  leavingSoon: {
    label: 'Leaving soon',
    apply: (q, today) => q.whereBetween('e.employment_end_date', [today, addDays(today, SOON_DAYS)]),
  },
  noManager: { label: 'No line manager', apply: (q) => q.whereNull('e.line_manager_id') },
  notLinked: { label: 'No Microsoft account linked', apply: (q) => q.whereNull('l.id') },
};

function baseList(db) {
  return db('employees as e')
    .leftJoin('companies as c', 'c.id', 'e.company_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('employees as m', 'm.id', 'e.line_manager_id')
    .leftJoin('identity_links as l', 'l.employee_id', 'e.id');
}

/** The directory: search, filters and one quick filter, paged. */
export async function listEmployees(db, query, { page, pageSize, offset }) {
  const today = todayInLusaka();
  const q = baseList(db);
  const search = String(query.search ?? '').trim();
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
    q.where((w) =>
      w
        .where('e.first_name', 'like', like)
        .orWhere('e.last_name', 'like', like)
        .orWhere('e.employee_number', 'like', like)
        .orWhere('e.email', 'like', like)
        .orWhere('e.job_title', 'like', like)
        .orWhereRaw("CONCAT(e.first_name, ' ', e.last_name) LIKE ?", [like]),
    );
  }
  if (['ACTIVE', 'INACTIVE'].includes(query.status)) q.where('e.status', query.status);
  if (query.companyId === 'none') q.whereNull('e.company_id');
  else if (query.companyId) q.where('e.company_id', Number(query.companyId) || 0);
  if (query.departmentId) q.where('e.department_id', Number(query.departmentId) || 0);
  if (query.employmentType) q.where('e.employment_type', String(query.employmentType));
  if (query.linked === 'false') q.whereNull('l.id');
  if (query.linked === 'true') q.whereNotNull('l.id');
  const quick = QUICK_FILTERS[query.filter];
  if (quick) {
    q.where('e.status', 'ACTIVE');
    quick.apply(q, today);
  }

  const { total } = await q.clone().count({ total: '*' }).first();
  const rows = await q
    .select(
      'e.id',
      'e.employee_number',
      'e.first_name',
      'e.last_name',
      'e.email',
      'e.job_title',
      'e.status',
      'e.employment_type',
      'e.employment_start_date',
      'e.employment_end_date',
      'e.contract_end_date',
      'e.probation_end_date',
      'e.probation_status',
      'c.name as company_name',
      'd.name as department_name',
      'm.id as manager_id',
      'm.first_name as manager_first',
      'm.last_name as manager_last',
      db.raw('l.id IS NOT NULL as linked'),
    )
    .orderBy([{ column: 'e.last_name' }, { column: 'e.first_name' }])
    .limit(pageSize)
    .offset(offset);
  const ids = rows.map((r) => r.id);
  const roleRows = ids.length
    ? await db('employee_roles as er')
        .join('roles as r', 'r.id', 'er.role_id')
        .whereIn('er.employee_id', ids)
        .select('er.employee_id', 'r.code')
    : [];
  return {
    total: Number(total),
    page,
    pageSize,
    items: rows.map((r) => ({
      id: r.id,
      employeeNumber: r.employee_number,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      jobTitle: r.job_title,
      status: r.status,
      company: r.company_name,
      department: r.department_name,
      lineManager: name(r.manager_first, r.manager_last),
      lineManagerId: r.manager_id,
      employmentType: r.employment_type,
      employmentStartDate: r.employment_start_date,
      employmentEndDate: r.employment_end_date,
      contractEndDate: r.contract_end_date,
      probationEndDate: r.probation_end_date,
      probationStatus: r.probation_status,
      linked: Boolean(r.linked),
      roles: roleRows.filter((x) => x.employee_id === r.id).map((x) => x.code),
    })),
  };
}

/** How many active people each quick filter would show, for the chips above the directory. */
export async function quickFilterCounts(db, companyId = null, departmentId = null) {
  const today = todayInLusaka();
  const out = {};
  for (const [key, f] of Object.entries(QUICK_FILTERS)) {
    const q = baseList(db).where('e.status', 'ACTIVE');
    if (companyId) q.where('e.company_id', companyId);
    if (departmentId) q.where('e.department_id', departmentId);
    f.apply(q, today);
    const { n } = await q.count({ n: '*' }).first();
    out[key] = { label: f.label, count: Number(n) };
  }
  return out;
}

/** One employee's full record, pay grade included: only HR and directors reach it. */
export async function employeeRecord(db, id) {
  const e = await db('employees as e')
    .leftJoin('companies as c', 'c.id', 'e.company_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('employees as m', 'm.id', 'e.line_manager_id')
    .leftJoin('work_schedules as w', 'w.id', 'e.work_schedule_id')
    .where('e.id', id)
    .first(
      'e.*',
      'c.name as company_name',
      'd.name as department_name',
      'm.first_name as manager_first',
      'm.last_name as manager_last',
      'm.employee_number as manager_number',
      'w.name as schedule_name',
    );
  if (!e) throw notFound('Employee not found.');
  const link = await db('identity_links').where({ employee_id: id }).first();
  const roles = await db('employee_roles as er')
    .join('roles as r', 'r.id', 'er.role_id')
    .where('er.employee_id', id)
    .pluck('r.code');
  const reports = await db('employees')
    .where({ line_manager_id: id, status: 'ACTIVE' })
    .orderBy(['last_name', 'first_name'])
    .select('id', 'first_name', 'last_name', 'employee_number', 'job_title');
  return {
    id: e.id,
    employeeNumber: e.employee_number,
    firstName: e.first_name,
    lastName: e.last_name,
    email: e.email,
    jobTitle: e.job_title,
    sex: e.sex,
    companyId: e.company_id,
    company: e.company_name,
    departmentId: e.department_id,
    department: e.department_name,
    lineManagerId: e.line_manager_id,
    lineManager: e.manager_first ? `${e.manager_first} ${e.manager_last} (${e.manager_number})` : null,
    workScheduleId: e.work_schedule_id,
    workSchedule: e.schedule_name,
    employmentStartDate: e.employment_start_date,
    employmentEndDate: e.employment_end_date,
    employmentType: e.employment_type,
    contractEndDate: e.contract_end_date,
    probationEndDate: e.probation_end_date,
    probationStatus: e.probation_status,
    payGrade: e.pay_grade,
    personal: personalOf(e),
    status: e.status,
    deactivatedAt: e.deactivated_at,
    roles,
    identity: link
      ? {
          objectId: link.object_id,
          email: link.email_at_link,
          linkedVia: link.linked_via,
          linkedAt: link.linked_at,
          lastSignInAt: link.last_sign_in_at,
        }
      : null,
    directReports: reports.map((r) => ({
      id: r.id,
      name: `${r.first_name} ${r.last_name}`,
      employeeNumber: r.employee_number,
      jobTitle: r.job_title,
    })),
  };
}

/** The record's history, newest first. */
export async function employeeHistory(db, id, limit = 200) {
  const rows = await db('employee_history as h')
    .leftJoin('employees as a', 'a.id', 'h.actor_id')
    .where('h.employee_id', id)
    .orderBy('h.id', 'desc')
    .limit(limit)
    .select('h.*', 'a.first_name', 'a.last_name');
  return rows.map((h) => ({
    id: h.id,
    event: h.event,
    field: h.field,
    from: h.old_value,
    to: h.new_value,
    reason: h.reason,
    by: name(h.first_name, h.last_name) ?? 'System',
    at: h.created_at,
  }));
}

/** Figures and lists for the Employee management dashboard, optionally for one company. */
export async function peopleDashboard(db, companyId = null) {
  const today = todayInLusaka();
  const year = Number(today.slice(0, 4));
  const inCompany = (q) => (companyId ? q.where('e.company_id', companyId) : q);
  const active = () => db('employees as e').where('e.status', 'ACTIVE').modify(inCompany);
  const count = async (q) => Number((await q.count({ n: '*' }).first()).n);

  const people = (q) =>
    q
      .leftJoin('departments as d', 'd.id', 'e.department_id')
      .leftJoin('companies as c', 'c.id', 'e.company_id')
      .select(
        'e.id',
        'e.first_name',
        'e.last_name',
        'e.job_title',
        'd.name as department',
        'c.name as company',
        'e.employment_start_date',
        'e.employment_end_date',
        'e.contract_end_date',
        'e.probation_end_date',
        'e.probation_status',
      );
  const person = (r) => ({
    id: r.id,
    name: name(r.first_name, r.last_name),
    jobTitle: r.job_title,
    department: r.department,
    company: r.company,
    startDate: r.employment_start_date,
    endDate: r.employment_end_date,
    contractEndDate: r.contract_end_date,
    probationEndDate: r.probation_end_date,
    probationStatus: r.probation_status,
  });

  const headcount = await count(active());
  const startingSoon = await people(active())
    .where('e.employment_start_date', '>', today)
    .andWhere('e.employment_start_date', '<=', addDays(today, SOON_DAYS))
    .orderBy('e.employment_start_date');
  const leavingSoon = await people(active())
    .whereBetween('e.employment_end_date', [today, addDays(today, SOON_DAYS)])
    .orderBy('e.employment_end_date');
  const contractsEnding = await people(active())
    .whereBetween('e.contract_end_date', [today, addDays(today, CONTRACT_DAYS)])
    .orderBy('e.contract_end_date');
  const probationDue = await people(active())
    .whereIn('e.probation_status', ['ON_PROBATION', 'EXTENDED'])
    .andWhere('e.probation_end_date', '<=', addDays(today, SOON_DAYS))
    .orderBy('e.probation_end_date');

  const byCompany = await db('employees as e')
    .leftJoin('companies as c', 'c.id', 'e.company_id')
    .where('e.status', 'ACTIVE')
    .modify(inCompany)
    .groupBy('e.company_id', 'c.name')
    .select('e.company_id as id', 'c.name')
    .count({ n: '*' });
  const byDepartment = await db('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('companies as c', 'c.id', 'e.company_id')
    .where('e.status', 'ACTIVE')
    .modify(inCompany)
    .groupBy('e.department_id', 'd.name', 'c.name')
    .select('e.department_id as id', 'd.name', 'c.name as company')
    .count({ n: '*' });
  // Recorded sex of active staff (D61): female, male, or not recorded.
  const bySex = await active().groupBy('e.sex').select('e.sex as sex').count({ n: '*' });
  const byType = await active()
    .groupBy('e.employment_type')
    .select('e.employment_type as type')
    .count({ n: '*' });

  // Joiners and leavers by month of the year, from start and end dates.
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, joined: 0, left: 0 }));
  const joined = await db('employees as e')
    .modify(inCompany)
    .whereBetween('e.employment_start_date', [`${year}-01-01`, `${year}-12-31`])
    .groupByRaw('MONTH(e.employment_start_date)')
    .select(db.raw('MONTH(e.employment_start_date) as m'))
    .count({ n: '*' });
  const left = await db('employees as e')
    .modify(inCompany)
    .whereBetween('e.employment_end_date', [`${year}-01-01`, `${year}-12-31`])
    .groupByRaw('MONTH(e.employment_end_date)')
    .select(db.raw('MONTH(e.employment_end_date) as m'))
    .count({ n: '*' });
  // Headcount at the end of each of the last 12 months (this month: today), from start and end dates.
  const dated = await db('employees as e')
    .modify(inCompany)
    .select('e.employment_start_date as s', 'e.employment_end_date as e2', 'e.status', 'e.deactivated_at');
  // When someone stopped counting: their end date, else the day they were marked as left.
  const endOf = (r) =>
    r.e2 ??
    (r.status !== 'ACTIVE' && r.deactivated_at
      ? new Date(r.deactivated_at).toISOString().slice(0, 10)
      : null);
  const trend = [];
  const [ty, tm] = today.split('-').map(Number);
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ty, tm - 1 - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const last = i === 0 ? today : new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const count = dated.filter((r) => {
      const end = endOf(r);
      return r.s <= last && (!end || end > last);
    }).length;
    trend.push({ year: y, month: m, headcount: count });
  }
  const bands = emptyBands();
  for (const r of dated) {
    if (r.status !== 'ACTIVE') continue;
    const months = monthsOfService(r.s, today);
    if (months !== null) bands[bandOf(months)] += 1;
  }
  for (const r of joined) monthly[Number(r.m) - 1].joined = Number(r.n);
  for (const r of left) monthly[Number(r.m) - 1].left = Number(r.n);

  const recent = await db('employee_history as h')
    .join('employees as e', 'e.id', 'h.employee_id')
    .leftJoin('employees as a', 'a.id', 'h.actor_id')
    .modify(inCompany)
    .orderBy('h.id', 'desc')
    .limit(10)
    .select('h.*', 'e.first_name', 'e.last_name', 'a.first_name as a_first', 'a.last_name as a_last');

  const companies = await db('companies').where({ is_active: true }).orderBy('name').select('id', 'name');

  return {
    year,
    companyId,
    companies,
    headcount,
    counts: {
      startingSoon: startingSoon.length,
      leavingSoon: leavingSoon.length,
      contractsEnding: contractsEnding.length,
      probationDue: probationDue.length,
    },
    startingSoon: startingSoon.map(person),
    leavingSoon: leavingSoon.map(person),
    contractsEnding: contractsEnding.map(person),
    probationDue: probationDue.map(person),
    byCompany: byCompany
      .map((r) => ({ id: r.id, name: r.name ?? 'No company', count: Number(r.n) }))
      .sort((a, b) => b.count - a.count),
    byDepartment: byDepartment
      .map((r) => ({ id: r.id, name: r.name ?? 'No department', company: r.company, count: Number(r.n) }))
      .sort((a, b) => b.count - a.count),
    byType: byType.map((r) => ({ type: r.type, count: Number(r.n) })),
    bySex: {
      FEMALE: Number(bySex.find((r) => r.sex === 'FEMALE')?.n ?? 0),
      MALE: Number(bySex.find((r) => r.sex === 'MALE')?.n ?? 0),
      NONE: Number(bySex.find((r) => r.sex == null)?.n ?? 0),
    },
    monthly,
    headcountTrend: trend,
    serviceBands: SERVICE_BANDS.map((b) => ({ key: b.key, label: b.label, count: bands[b.key] })),
    recentChanges: recent.map((h) => ({
      id: h.id,
      employeeId: h.employee_id,
      employee: name(h.first_name, h.last_name),
      event: h.event,
      field: h.field,
      from: h.old_value,
      to: h.new_value,
      by: name(h.a_first, h.a_last) ?? 'System',
      at: h.created_at,
    })),
  };
}

/*
 * Company and department overviews (D53): the same figures for each company or department, so
 * they can be compared side by side.
 */
async function groupFigures(db, groupColumn, companyId = null) {
  const today = todayInLusaka();
  const year = today.slice(0, 4);
  const rows = await db('employees as e')
    .modify((q) => companyId && q.where('e.company_id', companyId))
    .select(
      `e.${groupColumn} as gid`,
      'e.status',
      'e.employment_type',
      'e.sex',
      'e.probation_status',
      'e.contract_end_date',
      'e.employment_start_date',
      'e.employment_end_date',
      'e.line_manager_id',
      'e.id',
    );
  const managers = new Set(
    await db('employees')
      .where({ status: 'ACTIVE' })
      .whereNotNull('line_manager_id')
      .distinct()
      .pluck('line_manager_id'),
  );
  const by = new Map();
  const blank = () => ({ ...emptyFigures(), serviceMonths: 0 });
  const soon = addDays(today, CONTRACT_DAYS);
  for (const r of rows) {
    const g = by.get(r.gid ?? null) ?? blank();
    if (r.employment_start_date?.startsWith(year)) g.joinedThisYear += 1;
    if (r.employment_end_date?.startsWith(year) && r.employment_end_date <= today) g.leftThisYear += 1;
    if (r.status === 'ACTIVE') {
      g.headcount += 1;
      g.byType[r.employment_type ?? 'NONE'] += 1;
      g.bySex[r.sex ?? 'NONE'] += 1;
      if (['ON_PROBATION', 'EXTENDED'].includes(r.probation_status)) g.onProbation += 1;
      if (r.contract_end_date && r.contract_end_date >= today && r.contract_end_date <= soon)
        g.contractsEnding += 1;
      if (managers.has(r.id)) g.managers += 1;
      if (!r.line_manager_id) g.noManager += 1;
      const months = monthsOfService(r.employment_start_date, today);
      if (months !== null) {
        g.serviceMonths += months;
        g.serviceBands[bandOf(months)] += 1;
      }
    }
    by.set(r.gid ?? null, g);
  }
  for (const g of by.values()) {
    g.averageServiceYears = g.headcount ? Math.round((g.serviceMonths / g.headcount / 12) * 10) / 10 : 0;
    delete g.serviceMonths;
  }
  return by;
}

const emptyFigures = () => ({
  headcount: 0,
  byType: { PERMANENT: 0, FIXED_TERM: 0, TEMPORARY: 0, NONE: 0 },
  bySex: { FEMALE: 0, MALE: 0, NONE: 0 },
  serviceBands: emptyBands(),
  onProbation: 0,
  contractsEnding: 0,
  joinedThisYear: 0,
  leftThisYear: 0,
  managers: 0,
  noManager: 0,
  averageServiceYears: 0,
});

export async function companiesOverview(db) {
  const figures = await groupFigures(db, 'company_id');
  const companies = await db('companies').orderBy('name').select('id', 'code', 'name', 'is_active');
  const depts = await db('employees as e')
    .join('departments as d', 'd.id', 'e.department_id')
    .where('e.status', 'ACTIVE')
    .groupBy('e.company_id', 'd.id', 'd.name')
    .select('e.company_id', 'd.id', 'd.name')
    .count({ n: '*' });
  return {
    year: Number(todayInLusaka().slice(0, 4)),
    companies: companies
      .filter((c) => c.is_active || figures.get(c.id)?.headcount)
      .map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        isActive: Boolean(c.is_active),
        ...emptyFigures(),
        ...(figures.get(c.id) ?? {}),
        departments: depts
          .filter((d) => d.company_id === c.id)
          .map((d) => ({ id: d.id, name: d.name, count: Number(d.n) }))
          .sort((x, y) => y.count - x.count),
      })),
    withoutCompany: figures.get(null)?.headcount ?? 0,
  };
}

export async function departmentsOverview(db, companyId = null) {
  const figures = await groupFigures(db, 'department_id', companyId);
  const departments = await db('departments as d')
    .leftJoin('companies as c', 'c.id', 'd.company_id')
    .modify((q) => companyId && q.where('d.company_id', companyId))
    .orderBy([{ column: 'c.name' }, { column: 'd.name' }])
    .select('d.id', 'd.code', 'd.name', 'd.is_active', 'd.company_id', 'c.name as company');
  const companies = await db('companies').where({ is_active: true }).orderBy('name').select('id', 'name');
  return {
    year: Number(todayInLusaka().slice(0, 4)),
    companyId,
    companies,
    departments: departments
      .filter((d) => d.is_active || figures.get(d.id)?.headcount)
      .map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        isActive: Boolean(d.is_active),
        companyId: d.company_id,
        company: d.company,
        ...emptyFigures(),
        ...(figures.get(d.id) ?? {}),
      })),
    withoutDepartment: figures.get(null)?.headcount ?? 0,
  };
}
