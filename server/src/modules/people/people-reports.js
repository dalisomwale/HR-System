import { z } from 'zod';
import { notFound } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import { isoDate } from '../../utils/validation.js';
import { addDays } from '../leave/calendar.js';

/*
 * Employee management reports (D53). HR Officers and directors see the whole company; each report
 * has the same shape as the leave reports, so the same screen shows and exports them.
 */

export const peopleFilterSchema = z.object({
  companyId: z.coerce.number().int().positive().optional().catch(undefined),
  departmentId: z.coerce.number().int().positive().optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
});

const TYPE = { PERMANENT: 'Permanent', FIXED_TERM: 'Fixed-term contract', TEMPORARY: 'Temporary' };
const PROBATION = { ON_PROBATION: 'On probation', EXTENDED: 'Probation extended', CONFIRMED: 'Confirmed' };
const FIELD = {
  employeeNumber: 'Employee number',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Work email',
  jobTitle: 'Job title',
  sex: 'Sex',
  companyId: 'Company',
  departmentId: 'Department',
  lineManagerId: 'Line manager',
  workScheduleId: 'Working schedule',
  employmentStartDate: 'Start date',
  employmentEndDate: 'End date',
  employmentType: 'Employment type',
  contractEndDate: 'Contract end',
  probationEndDate: 'Probation end',
  probationStatus: 'Probation',
  payGrade: 'Pay grade',
};
const EVENT = {
  CREATED: 'Record created',
  UPDATED: 'Changed',
  DEACTIVATED: 'Marked as left',
  REACTIVATED: 'Made active again',
};

const stamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lusaka',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const yearOf = (f) => f.year ?? Number(todayInLusaka().slice(0, 4));
const name = (f, l) => (f ? `${f} ${l}` : '');

/** Whole years and months between two dates, as "3 years 2 months". */
export function serviceLength(start, today) {
  if (!start || start > today) return { years: 0, text: 'Not started' };
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} ${y === 1 ? 'year' : 'years'}`);
  if (m || !y) parts.push(`${m} ${m === 1 ? 'month' : 'months'}`);
  return { years: Math.round((months / 12) * 10) / 10, text: parts.join(' ') };
}

function staff(db, f) {
  const q = db('employees as e')
    .leftJoin('companies as c', 'c.id', 'e.company_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('employees as m', 'm.id', 'e.line_manager_id')
    .select(
      'e.*',
      'c.name as company',
      'd.name as department',
      'm.first_name as m_first',
      'm.last_name as m_last',
    )
    .orderBy([
      { column: 'c.name' },
      { column: 'd.name' },
      { column: 'e.last_name' },
      { column: 'e.first_name' },
    ]);
  if (f.companyId) q.where('e.company_id', f.companyId);
  if (f.departmentId) q.where('e.department_id', f.departmentId);
  return q;
}

const PERSON = [
  { key: 'number', label: 'Employee number', type: 'text' },
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'jobTitle', label: 'Job title', type: 'text' },
  { key: 'company', label: 'Company', type: 'text' },
  { key: 'department', label: 'Department', type: 'text' },
];
const person = (r) => ({
  number: r.employee_number,
  name: name(r.first_name, r.last_name),
  jobTitle: r.job_title ?? '',
  company: r.company ?? '',
  department: r.department ?? '',
});

export const PEOPLE_REPORTS = [
  {
    id: 'staff-list',
    title: 'Staff list',
    description: 'Everyone active, with their job, manager and employment terms.',
    filters: ['company', 'department'],
    columns: [
      ...PERSON,
      { key: 'manager', label: 'Line manager', type: 'text' },
      { key: 'type', label: 'Employment type', type: 'text' },
      { key: 'start', label: 'Start date', type: 'date' },
      { key: 'contractEnd', label: 'Contract end', type: 'date' },
      { key: 'probation', label: 'Probation', type: 'text' },
      { key: 'payGrade', label: 'Pay grade', type: 'text' },
      { key: 'email', label: 'Work email', type: 'text' },
      { key: 'mobile', label: 'Mobile', type: 'text' },
    ],
    async run(db, f) {
      return (await staff(db, f).where('e.status', 'ACTIVE')).map((r) => ({
        ...person(r),
        manager: name(r.m_first, r.m_last),
        type: TYPE[r.employment_type] ?? '',
        start: r.employment_start_date,
        contractEnd: r.contract_end_date,
        probation: PROBATION[r.probation_status] ?? '',
        payGrade: r.pay_grade ?? '',
        email: r.email ?? '',
        mobile: r.mobile_phone ?? '',
      }));
    },
  },
  {
    id: 'headcount',
    title: 'Headcount by department',
    description: 'Active staff in each department, by employment type.',
    filters: ['company'],
    columns: [
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'department', label: 'Department', type: 'text' },
      { key: 'total', label: 'Staff', type: 'number' },
      { key: 'permanent', label: 'Permanent', type: 'number' },
      { key: 'fixed', label: 'Fixed-term', type: 'number' },
      { key: 'temporary', label: 'Temporary', type: 'number' },
      { key: 'notRecorded', label: 'Type not recorded', type: 'number' },
      { key: 'probation', label: 'On probation', type: 'number' },
      { key: 'female', label: 'Female', type: 'number' },
      { key: 'male', label: 'Male', type: 'number' },
      { key: 'sexNotRecorded', label: 'Sex not recorded', type: 'number' },
    ],
    async run(db, f) {
      const rows = await staff(db, { companyId: f.companyId }).where('e.status', 'ACTIVE');
      const by = new Map();
      for (const r of rows) {
        const key = `${r.company ?? ''}|${r.department ?? ''}`;
        const g = by.get(key) ?? {
          company: r.company ?? 'No company',
          department: r.department ?? 'No department',
          total: 0,
          permanent: 0,
          fixed: 0,
          temporary: 0,
          notRecorded: 0,
          probation: 0,
          female: 0,
          male: 0,
          sexNotRecorded: 0,
        };
        g.total += 1;
        if (r.employment_type === 'PERMANENT') g.permanent += 1;
        else if (r.employment_type === 'FIXED_TERM') g.fixed += 1;
        else if (r.employment_type === 'TEMPORARY') g.temporary += 1;
        else g.notRecorded += 1;
        if (['ON_PROBATION', 'EXTENDED'].includes(r.probation_status)) g.probation += 1;
        if (r.sex === 'FEMALE') g.female += 1;
        else if (r.sex === 'MALE') g.male += 1;
        else g.sexNotRecorded += 1;
        by.set(key, g);
      }
      return [...by.values()];
    },
  },
  {
    id: 'joiners-leavers',
    title: 'Joiners and leavers',
    description: 'Everyone who started or left in the year.',
    filters: ['year', 'company', 'department'],
    columns: [
      { key: 'event', label: 'Joined or left', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      ...PERSON,
      { key: 'type', label: 'Employment type', type: 'text' },
    ],
    async run(db, f) {
      const y = yearOf(f);
      const from = `${y}-01-01`;
      const to = `${y}-12-31`;
      const joined = await staff(db, f).whereBetween('e.employment_start_date', [from, to]);
      const left = await staff(db, f).whereBetween('e.employment_end_date', [from, to]);
      return [
        ...joined.map((r) => ({
          event: 'Joined',
          date: r.employment_start_date,
          ...person(r),
          type: TYPE[r.employment_type] ?? '',
        })),
        ...left.map((r) => ({
          event: 'Left',
          date: r.employment_end_date,
          ...person(r),
          type: TYPE[r.employment_type] ?? '',
        })),
      ].sort((a, b) => a.date.localeCompare(b.date));
    },
  },
  {
    id: 'contracts-ending',
    title: 'Contracts ending',
    description: 'Active staff whose contract ends in the period (the next 90 days unless dates are set).',
    filters: ['from', 'to', 'company', 'department'],
    columns: [
      ...PERSON,
      { key: 'type', label: 'Employment type', type: 'text' },
      { key: 'contractEnd', label: 'Contract end', type: 'date' },
      { key: 'manager', label: 'Line manager', type: 'text' },
    ],
    async run(db, f) {
      const today = todayInLusaka();
      const rows = await staff(db, f)
        .where('e.status', 'ACTIVE')
        .whereBetween('e.contract_end_date', [f.from ?? today, f.to ?? addDays(today, 90)])
        .clearOrder()
        .orderBy('e.contract_end_date');
      return rows.map((r) => ({
        ...person(r),
        type: TYPE[r.employment_type] ?? '',
        contractEnd: r.contract_end_date,
        manager: name(r.m_first, r.m_last),
      }));
    },
  },
  {
    id: 'probation',
    title: 'Probation',
    description: 'Active staff still on probation, or with probation extended.',
    filters: ['company', 'department'],
    columns: [
      ...PERSON,
      { key: 'status', label: 'Probation', type: 'text' },
      { key: 'ends', label: 'Probation end', type: 'date' },
      { key: 'start', label: 'Start date', type: 'date' },
      { key: 'manager', label: 'Line manager', type: 'text' },
    ],
    async run(db, f) {
      const rows = await staff(db, f)
        .where('e.status', 'ACTIVE')
        .whereIn('e.probation_status', ['ON_PROBATION', 'EXTENDED'])
        .clearOrder()
        .orderBy('e.probation_end_date');
      return rows.map((r) => ({
        ...person(r),
        status: PROBATION[r.probation_status],
        ends: r.probation_end_date,
        start: r.employment_start_date,
        manager: name(r.m_first, r.m_last),
      }));
    },
  },
  {
    id: 'service',
    title: 'Length of service',
    description: 'Active staff with their start date and time with the group, longest first.',
    filters: ['company', 'department'],
    columns: [
      ...PERSON,
      { key: 'start', label: 'Start date', type: 'date' },
      { key: 'service', label: 'Service', type: 'text' },
      { key: 'years', label: 'Years', type: 'number' },
    ],
    async run(db, f) {
      const today = todayInLusaka();
      const rows = await staff(db, f)
        .where('e.status', 'ACTIVE')
        .clearOrder()
        .orderBy('e.employment_start_date');
      return rows.map((r) => {
        const s = serviceLength(r.employment_start_date, today);
        return { ...person(r), start: r.employment_start_date, service: s.text, years: s.years };
      });
    },
  },
  {
    id: 'missing-details',
    title: 'Missing details',
    description: 'Active staff whose record is incomplete, and what is missing.',
    filters: ['company', 'department'],
    columns: [...PERSON, { key: 'missing', label: 'Missing', type: 'text' }],
    async run(db, f) {
      const rows = await staff(db, f)
        .leftJoin('identity_links as l', 'l.employee_id', 'e.id')
        .select(db.raw('l.id IS NOT NULL as linked'))
        .where('e.status', 'ACTIVE');
      return rows
        .map((r) => {
          const missing = [
            !r.department_id && 'department',
            !r.line_manager_id && 'line manager',
            !r.email && 'work email',
            !r.linked && 'Microsoft account',
            !r.employment_type && 'employment type',
            r.employment_type && r.employment_type !== 'PERMANENT' && !r.contract_end_date && 'contract end',
          ].filter(Boolean);
          return { ...person(r), missing: missing.join(', ') };
        })
        .filter((r) => r.missing);
    },
  },
  {
    id: 'changes',
    title: 'Record changes',
    description: 'Every change to employee records in the period, with who made it.',
    filters: ['from', 'to', 'company', 'department'],
    columns: [
      { key: 'when', label: 'When', type: 'text' },
      ...PERSON,
      { key: 'change', label: 'Change', type: 'text' },
      { key: 'field', label: 'Field', type: 'text' },
      { key: 'from', label: 'From', type: 'text' },
      { key: 'to', label: 'To', type: 'text' },
      { key: 'by', label: 'By', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' },
    ],
    async run(db, f) {
      const y = yearOf(f);
      const from = f.from ?? `${y}-01-01`;
      const to = f.to ?? `${y}-12-31`;
      const q = db('employee_history as h')
        .join('employees as e', 'e.id', 'h.employee_id')
        .leftJoin('companies as c', 'c.id', 'e.company_id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .leftJoin('employees as a', 'a.id', 'h.actor_id')
        .whereRaw('DATE(h.created_at) BETWEEN ? AND ?', [from, to])
        .orderBy('h.id', 'desc')
        .select(
          'h.*',
          'e.*',
          'c.name as company',
          'd.name as department',
          'a.first_name as a_first',
          'a.last_name as a_last',
          'h.created_at as h_at',
        );
      if (f.companyId) q.where('e.company_id', f.companyId);
      if (f.departmentId) q.where('e.department_id', f.departmentId);
      return (await q).map((r) => ({
        when: stamp.format(new Date(r.h_at)),
        ...person(r),
        change: EVENT[r.event] ?? r.event,
        field: FIELD[r.field] ?? r.field ?? '',
        from: r.old_value ?? '',
        to: r.new_value ?? '',
        by: name(r.a_first, r.a_last) || 'System',
        reason: r.reason ?? '',
      }));
    },
  },
];

export function findPeopleReport(id) {
  const r = PEOPLE_REPORTS.find((x) => x.id === id);
  if (!r) throw notFound('Report not found.');
  return r;
}
