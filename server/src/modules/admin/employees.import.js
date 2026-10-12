import { parse } from 'csv-parse/sync';
import { createEmployeeSchema, createEmployee } from './employees.service.js';
import { writeAudit } from '../audit/audit.service.js';
import { badRequest } from '../../utils/errors.js';

/** Columns in the template, in order. */
export const IMPORT_COLUMNS = [
  'employee_number',
  'first_name',
  'last_name',
  'email',
  'job_title',
  'company_name',
  'company_code',
  'department_name',
  'department_code',
  'manager_employee_name',
  'employment_start_date',
];
// Still accepted so files made from the earlier template keep working.
const EXTRA_COLUMNS = ['sex', 'employment_end_date', 'manager_employee_number'];
const ALL_COLUMNS = [...IMPORT_COLUMNS, ...EXTRA_COLUMNS];
const ALIASES = { line_manager_employee_number: 'manager_employee_number' };
const personKey = (s) =>
  String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
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
      // "Department name" and "department-name" are read as department_name.
      columns: (header) =>
        header.map((h) => {
          const name = String(h)
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
          return ALIASES[name] ?? name;
        }),
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
  const unknown = header.filter((c) => !ALL_COLUMNS.includes(c));
  if (unknown.length) throw badRequest(`Unrecognised column(s): ${unknown.join(', ')}.`);

  const companies = await db('companies').select('id', 'code', 'name', 'is_active');
  const companyByCode = new Map(companies.map((c) => [c.code.toUpperCase(), c]));
  const companyByName = new Map(companies.map((c) => [personKey(c.name), c]));
  const departments = await db('departments').select('id', 'company_id', 'code', 'name', 'is_active');
  // Departments are looked up within their company. Ones with no company yet can be adopted.
  const deptKey = (companyKey, x) => `${companyKey}|${x}`;
  const deptByCode = new Map(departments.map((d) => [deptKey(d.company_id, d.code.toUpperCase()), d]));
  const deptByName = new Map(departments.map((d) => [deptKey(d.company_id, personKey(d.name)), d]));
  const existing = await db('employees').select(
    'id',
    'employee_number',
    'email',
    'status',
    'first_name',
    'last_name',
  );
  // Managers named in the file are matched by full name, among active staff and the file itself.
  const peopleByName = new Map();
  const addPerson = (key, who) => peopleByName.set(key, [...(peopleByName.get(key) ?? []), who]);
  for (const e of existing.filter((x) => x.status === 'ACTIVE')) {
    addPerson(personKey(`${e.first_name} ${e.last_name}`), { existingId: e.id, number: e.employee_number });
  }
  for (const r of records) {
    const n = clean(r.employee_number);
    if (n && !existing.some((e) => e.employee_number === n)) {
      addPerson(personKey(`${r.first_name ?? ''} ${r.last_name ?? ''}`), { inFile: n, number: n });
    }
  }
  // New companies and departments named in the file: one name per code, names not taken.
  const newCompanies = new Map();
  const newDepartments = new Map(); // key companyKey|CODE -> { companyKey, code, name }
  const adoptions = new Map(); // legacy department id -> companyKey
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
    const raw = Object.fromEntries(ALL_COLUMNS.map((c) => [c, clean(r[c]) ?? '']));
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

    // Company: an existing code (its name must match), a new code with a name, or an existing name.
    let companyKey = null; // existing id, or 'new:CODE'
    const cCode = raw.company_code.toUpperCase();
    const cName = raw.company_name;
    if (cCode) {
      const c = companyByCode.get(cCode);
      if (c) {
        if (!c.is_active) errors.push(`company ${c.name} is inactive`);
        else if (cName && personKey(cName) !== personKey(c.name)) {
          errors.push(`company_code ${cCode} is ${c.name}, not ${cName}`);
        } else companyKey = c.id;
      } else if (!cName) {
        errors.push(`company_code ${cCode} does not exist; add company_name to create it`);
      } else if (cCode.length > 20 || cName.length > 160) {
        errors.push('company_code can be up to 20 characters and company_name up to 160');
      } else {
        const taken = companyByName.get(personKey(cName));
        const earlier = newCompanies.get(cCode);
        if (taken) errors.push(`company ${cName} already exists with code ${taken.code}`);
        else if (earlier && personKey(earlier) !== personKey(cName)) {
          errors.push(`company_code ${cCode} is given two names in this file`);
        } else {
          newCompanies.set(cCode, earlier ?? cName);
          companyKey = `new:${cCode}`;
        }
      }
    } else if (cName) {
      const c = companyByName.get(personKey(cName));
      if (!c) errors.push(`company ${cName} does not exist; add company_code to create it`);
      else if (!c.is_active) errors.push(`company ${c.name} is inactive`);
      else companyKey = c.id;
    } else {
      errors.push('company_name or company_code is required');
    }

    // Department, within the row's company.
    let departmentId = null;
    let newDepartment = null;
    const code = raw.department_code.toUpperCase();
    const deptName = raw.department_name;
    const companyLabel = cName || cCode;
    const findDept = (byCode) => {
      const map = byCode ? deptByCode : deptByName;
      const x = byCode ? code : personKey(deptName);
      const own = typeof companyKey === 'number' ? map.get(deptKey(companyKey, x)) : null;
      return own ?? map.get(deptKey(null, x)) ?? null;
    };
    const useDept = (d) => {
      if (!d.is_active) return errors.push(`department ${d.name} is inactive`);
      if (d.company_id === null) {
        const earlier = adoptions.get(d.id);
        if (earlier !== undefined && earlier !== companyKey) {
          return errors.push(
            `department ${d.name} has no company yet and is used under two companies in this file; set its company on the Departments page first`,
          );
        }
        adoptions.set(d.id, companyKey);
      }
      departmentId = d.id;
    };
    if (companyKey === null && (code || deptName)) {
      // The company is missing or wrong; that error is already on the row.
    } else if (code) {
      const d = findDept(true);
      if (d) {
        if (deptName && personKey(deptName) !== personKey(d.name)) {
          errors.push(`department_code ${code} is ${d.name}, not ${deptName}`);
        } else useDept(d);
      } else if (!deptName) {
        errors.push(
          `department_code ${code} does not exist in ${companyLabel}; add department_name to create it`,
        );
      } else if (code.length > 20 || deptName.length > 120) {
        errors.push('department_code can be up to 20 characters and department_name up to 120');
      } else {
        const taken = findDept(false);
        const key = deptKey(companyKey, code);
        const earlier = newDepartments.get(key);
        if (taken) errors.push(`department ${deptName} already exists with code ${taken.code}`);
        else if (earlier && personKey(earlier.name) !== personKey(deptName)) {
          errors.push(`department_code ${code} is given two names in this file`);
        } else {
          newDepartments.set(key, earlier ?? { companyKey, code, name: deptName });
          newDepartment = key;
        }
      }
    } else if (deptName) {
      const d = findDept(false);
      if (!d) {
        errors.push(
          `department ${deptName} does not exist in ${companyLabel}; add department_code to create it`,
        );
      } else useDept(d);
    }

    let manager = null;
    if (raw.manager_employee_number) {
      if (raw.manager_employee_number === raw.employee_number) {
        errors.push('an employee cannot be their own manager');
      } else if (existingByNumber.has(raw.manager_employee_number)) {
        const m = existingByNumber.get(raw.manager_employee_number);
        if (m.status !== 'ACTIVE') errors.push('manager is not an active employee');
        else manager = { existingId: m.id };
      } else if (fileNumbers.has(raw.manager_employee_number)) {
        manager = { inFile: raw.manager_employee_number };
      } else {
        errors.push(`manager_employee_number ${raw.manager_employee_number} not found`);
      }
    }
    if (!raw.manager_employee_number && raw.manager_employee_name) {
      const self = personKey(`${raw.first_name} ${raw.last_name}`);
      const wanted = personKey(raw.manager_employee_name);
      const matches = (peopleByName.get(wanted) ?? []).filter((m) => m.number !== raw.employee_number);
      if (wanted === self && matches.length === 0) errors.push('an employee cannot be their own manager');
      else if (matches.length === 0) {
        errors.push(
          `manager_employee_name ${raw.manager_employee_name} not found among active staff or this file`,
        );
      } else if (matches.length > 1) {
        errors.push(
          `manager_employee_name ${raw.manager_employee_name} matches more than one person; use manager_employee_number instead`,
        );
      } else {
        manager = matches[0].existingId
          ? { existingId: matches[0].existingId }
          : { inFile: matches[0].inFile };
      }
    }

    return {
      line: i + 2, // header is line 1
      employeeNumber: raw.employee_number,
      name: `${raw.first_name} ${raw.last_name}`.trim(),
      errors,
      input: parsed.success ? { ...parsed.data, departmentId } : null,
      companyKey,
      newDepartment,
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
    newCompanies: [...newCompanies].map(([code, name]) => ({ code, name })),
    newDepartments: [...newDepartments.values()].map((d) => ({
      company:
        typeof d.companyKey === 'number'
          ? companies.find((c) => c.id === d.companyKey).name
          : newCompanies.get(d.companyKey.slice(4)),
      code: d.code,
      name: d.name,
    })),
    _rows: rows,
    _newDepartments: newDepartments,
    _adoptions: adoptions,
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
    const companyIdByKey = new Map();
    for (const c of result.newCompanies) {
      const [id] = await trx('companies').insert({ code: c.code, name: c.name });
      companyIdByKey.set(`new:${c.code}`, id);
      await writeAudit(trx, {
        ...audit,
        action: 'COMPANY_CREATED',
        entityType: 'company',
        entityId: id,
        after: { code: c.code, name: c.name, via: 'employee import' },
      });
    }
    const companyId = (key) => (typeof key === 'number' ? key : companyIdByKey.get(key));
    for (const [deptId, key] of result._adoptions) {
      await trx('departments')
        .where({ id: deptId })
        .whereNull('company_id')
        .update({ company_id: companyId(key) });
      await writeAudit(trx, {
        ...audit,
        action: 'DEPARTMENT_UPDATED',
        entityType: 'department',
        entityId: deptId,
        before: { companyId: null },
        after: { companyId: companyId(key), via: 'employee import' },
      });
    }
    const deptIdByKey = new Map();
    for (const [key, d] of result._newDepartments) {
      const [id] = await trx('departments').insert({
        company_id: companyId(d.companyKey),
        code: d.code,
        name: d.name,
      });
      deptIdByKey.set(key, id);
      await writeAudit(trx, {
        ...audit,
        action: 'DEPARTMENT_CREATED',
        entityType: 'department',
        entityId: id,
        after: { companyId: companyId(d.companyKey), code: d.code, name: d.name, via: 'employee import' },
      });
    }
    const idByNumber = new Map();
    for (const row of result._rows) {
      const departmentId = row.newDepartment ? deptIdByKey.get(row.newDepartment) : row.input.departmentId;
      const id = await createEmployee(
        trx,
        { ...row.input, companyId: companyId(row.companyKey), departmentId, lineManagerId: null },
        { ...audit },
      );
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
      after: {
        count: result.totalRows,
        companiesCreated: result.newCompanies.length,
        departmentsCreated: result.newDepartments.length,
      },
    });
    return {
      imported: result.totalRows,
      companiesCreated: result.newCompanies.length,
      departmentsCreated: result.newDepartments.length,
    };
  });
}
