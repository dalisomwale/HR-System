import { parse } from 'csv-parse/sync';
import { createEmployeeSchema, createEmployee } from './employees.service.js';
import { writeAudit } from '../audit/audit.service.js';
import { badRequest } from '../../utils/errors.js';

export const IMPORT_COLUMNS = [
  'employee_number',
  'first_name',
  'last_name',
  'email',
  'job_title',
  'sex',
  'department_code',
  'line_manager_employee_number',
  'employment_start_date',
  'employment_end_date',
];
const REQUIRED_COLUMNS = ['employee_number', 'first_name', 'last_name', 'employment_start_date'];
export const MAX_IMPORT_ROWS = 2000;

/** Neutralise spreadsheet formula prefixes in imported text. */
const clean = (v) => (typeof v === 'string' ? v.trim() : v);

/**
 * Parse and validate a CSV of real staff records without writing anything.
 * Each row is checked on its own and against the database and the rest of the file.
 */
export async function validateImport(db, csvText) {
  let records;
  try {
    records = parse(csvText, {
      columns: (header) => header.map((h) => String(h).trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    throw badRequest(`The file could not be read as CSV: ${err.message}`);
  }
  if (records.length === 0) throw badRequest('The file has no data rows.');
  if (records.length > MAX_IMPORT_ROWS) throw badRequest(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);

  const header = Object.keys(records[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw badRequest(`Missing required column(s): ${missing.join(', ')}.`);
  const unknown = header.filter((c) => !IMPORT_COLUMNS.includes(c));
  if (unknown.length) throw badRequest(`Unrecognised column(s): ${unknown.join(', ')}.`);

  const departments = await db('departments').select('id', 'code', 'is_active');
  const deptByCode = new Map(departments.map((d) => [d.code.toUpperCase(), d]));
  const existing = await db('employees').select('id', 'employee_number', 'email', 'status');
  const existingByNumber = new Map(existing.map((e) => [e.employee_number, e]));
  const existingEmails = new Set(existing.filter((e) => e.email).map((e) => e.email.toLowerCase()));

  const fileNumbers = new Map();
  const fileEmails = new Map();
  records.forEach((r, i) => {
    const n = clean(r.employee_number);
    const e = clean(r.email)?.toLowerCase();
    if (n) fileNumbers.set(n, [...(fileNumbers.get(n) ?? []), i]);
    if (e) fileEmails.set(e, [...(fileEmails.get(e) ?? []), i]);
  });

  const rows = records.map((r, i) => {
    const errors = [];
    const raw = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, clean(r[c]) ?? '']));
    for (const [k, v] of Object.entries(raw)) {
      if (/^[=+\-@]/.test(v) && !(k.endsWith('_date') && /^\d/.test(v))) {
        errors.push(`${k} starts with a formula character`);
      }
    }
    const sexRaw = raw.sex.toUpperCase();
    const sex = { F: 'FEMALE', FEMALE: 'FEMALE', M: 'MALE', MALE: 'MALE', '': null }[sexRaw];
    if (sex === undefined) errors.push('sex must be F, M, Female, Male or blank');
    const parsed = createEmployeeSchema.safeParse({
      employeeNumber: raw.employee_number,
      firstName: raw.first_name,
      lastName: raw.last_name,
      email: raw.email || null,
      jobTitle: raw.job_title || null,
      sex: sex ?? null,
      employmentStartDate: raw.employment_start_date,
      employmentEndDate: raw.employment_end_date || null,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${issue.path.join('.')} ${issue.message}`);
    }
    if (raw.employee_number && existingByNumber.has(raw.employee_number)) {
      errors.push('employee_number already exists in the system');
    }
    if ((fileNumbers.get(raw.employee_number) ?? []).length > 1) {
      errors.push('employee_number appears more than once in this file');
    }
    const email = raw.email.toLowerCase();
    if (email && existingEmails.has(email)) errors.push('email already belongs to an existing employee');
    if (email && (fileEmails.get(email) ?? []).length > 1)
      errors.push('email appears more than once in this file');

    let departmentId = null;
    if (raw.department_code) {
      const d = deptByCode.get(raw.department_code.toUpperCase());
      if (!d) errors.push(`department_code ${raw.department_code} does not exist`);
      else if (!d.is_active) errors.push(`department ${raw.department_code} is inactive`);
      else departmentId = d.id;
    }

    let manager = null;
    if (raw.line_manager_employee_number) {
      if (raw.line_manager_employee_number === raw.employee_number) {
        errors.push('an employee cannot be their own line manager');
      } else if (existingByNumber.has(raw.line_manager_employee_number)) {
        const m = existingByNumber.get(raw.line_manager_employee_number);
        if (m.status !== 'ACTIVE') errors.push('line manager is not an active employee');
        else manager = { existingId: m.id };
      } else if (fileNumbers.has(raw.line_manager_employee_number)) {
        manager = { inFile: raw.line_manager_employee_number };
      } else {
        errors.push(`line_manager_employee_number ${raw.line_manager_employee_number} not found`);
      }
    }

    return {
      line: i + 2, // header is line 1
      employeeNumber: raw.employee_number,
      name: `${raw.first_name} ${raw.last_name}`.trim(),
      errors,
      input: parsed.success ? { ...parsed.data, departmentId } : null,
      manager,
    };
  });

  // Reporting loops among new employees within the file.
  const managerOf = new Map(
    rows.filter((r) => r.manager?.inFile).map((r) => [r.employeeNumber, r.manager.inFile]),
  );
  for (const row of rows) {
    let current = managerOf.get(row.employeeNumber);
    const seen = new Set([row.employeeNumber]);
    while (current) {
      if (seen.has(current)) {
        row.errors.push('creates a reporting loop within the file');
        break;
      }
      seen.add(current);
      current = managerOf.get(current);
    }
  }

  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.errors.length === 0).length,
    rows: rows.map(({ line, employeeNumber, name, errors }) => ({ line, employeeNumber, name, errors })),
    _rows: rows,
  };
}

/** Commit a fully valid import in one transaction. Any error means nothing is written. */
export async function commitImport(db, csvText, audit) {
  const result = await validateImport(db, csvText);
  if (result.validRows !== result.totalRows) {
    throw badRequest('Fix the rows with errors and upload the file again. Nothing was imported.', {
      rows: result.rows.filter((r) => r.errors.length),
    });
  }
  return db.transaction(async (trx) => {
    const idByNumber = new Map();
    for (const row of result._rows) {
      const id = await createEmployee(trx, { ...row.input, lineManagerId: null }, { ...audit });
      idByNumber.set(row.employeeNumber, id);
    }
    for (const row of result._rows) {
      if (!row.manager) continue;
      const managerId = row.manager.existingId ?? idByNumber.get(row.manager.inFile);
      await trx('employees')
        .where({ id: idByNumber.get(row.employeeNumber) })
        .update({ line_manager_id: managerId });
    }
    await writeAudit(trx, {
      ...audit,
      action: 'EMPLOYEES_IMPORTED',
      entityType: 'employee',
      after: { count: result.totalRows },
    });
    return { imported: result.totalRows };
  });
}
