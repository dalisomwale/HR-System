import { useLocation, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Trail } from '../../layouts/LeaveTrail.jsx';
import { api } from '../../lib/api.js';

/*
 * Where you are in Employee management (D60): Employee management › Company overview › Altus
 * Financial Services Limited. Worked out from the address; names come from the same queries the
 * pages use, so they are usually already loaded. Shows nothing outside /people.
 */

const ROOT = { label: 'Employee management', to: '/people' };
const SECTIONS = {
  employees: { label: 'Employees', to: '/people/employees' },
  companies: { label: 'Company overview', to: '/people/companies' },
  departments: { label: 'Department overview', to: '/people/departments' },
  reports: { label: 'Reports', to: '/people/reports' },
  users: { label: 'Users', to: '/people/users' },
  roles: { label: 'Roles', to: '/people/roles' },
  positions: { label: 'Positions', to: '/people/positions' },
  audit: { label: 'Audit trail', to: '/people/audit' },
};
const FIXED = {
  'employees/new': 'Add employee',
  'companies/manage': 'Add or edit companies',
  'departments/manage': 'Add or edit departments',
};

const isId = (v) => /^\d+$/.test(v ?? '');

function useEmployeeName(id) {
  const q = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/api/people/employees/${id}`),
    enabled: isId(id),
  });
  if (!isId(id)) return null;
  return q.data ? `${q.data.firstName} ${q.data.lastName}` : '…';
}

function useGroupName(section, id) {
  const companies = useQuery({
    queryKey: ['people-companies'],
    queryFn: () => api.get('/api/people/companies-overview'),
    enabled: isId(id) && section === 'companies',
  });
  const departments = useQuery({
    queryKey: ['people-departments', ''],
    queryFn: () => api.get('/api/people/departments-overview'),
    enabled: isId(id) && section === 'departments',
  });
  if (!isId(id)) return null;
  if (section === 'companies') return companies.data?.companies.find((c) => String(c.id) === id)?.name ?? '…';
  if (section === 'departments') {
    return departments.data?.departments.find((d) => String(d.id) === id)?.name ?? '…';
  }
  return null;
}

/** The company a department belongs to, shown before it in the path (D86). */
function useDepartmentCompany(section, id) {
  const departments = useQuery({
    queryKey: ['people-departments', ''],
    queryFn: () => api.get('/api/people/departments-overview'),
    enabled: isId(id) && section === 'departments',
  });
  if (section !== 'departments' || !isId(id)) return null;
  const d = departments.data?.departments.find((x) => String(x.id) === id);
  if (!d?.companyId) return null;
  return { label: d.companyCode ?? d.company, to: `/people/departments?companyId=${d.companyId}` };
}

function useReportTitle(on, id) {
  const q = useQuery({
    queryKey: ['reports', '/api/people/reports'],
    queryFn: () => api.get('/api/people/reports'),
    enabled: on,
  });
  if (!on || !q.data) return null;
  return (q.data.items.find((r) => r.id === id) ?? q.data.items[0])?.title ?? null;
}

export default function PeopleTrail() {
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const parts = pathname
    .replace(/^\/people\/?/, '')
    .split('/')
    .filter(Boolean);
  const [section, rest, sub, subId] = parts;
  // An employee opened inside a company or department keeps that place in the path (D62).
  const nested = (section === 'companies' || section === 'departments') && sub === 'employees';
  const groupName = useGroupName(section, rest);
  const departmentCompany = useDepartmentCompany(section, rest);
  const employeeName = useEmployeeName(nested ? subId : section === 'employees' ? rest : null);
  const reportTitle = useReportTitle(section === 'reports', search.get('report'));
  if (!pathname.startsWith('/people')) return null;

  const trail = [ROOT];
  if (!section) trail.push({ label: 'Home' });
  else if (section === 'import') trail.push(SECTIONS.employees, { label: 'Import employees' });
  else if (section === 'reports') {
    trail.push(reportTitle ? SECTIONS.reports : { label: 'Reports' });
    if (reportTitle) trail.push({ label: reportTitle });
  } else if (nested) {
    trail.push(SECTIONS[section]);
    if (departmentCompany) trail.push(departmentCompany);
    trail.push({ label: groupName, to: `/people/${section}/${rest}` });
    if (!subId) trail.push({ label: 'Employees' });
    else {
      trail.push({ label: 'Employees', to: `/people/${section}/${rest}/employees` });
      trail.push({ label: subId === 'new' ? 'Add employee' : employeeName });
    }
  } else {
    const s = SECTIONS[section];
    if (s) trail.push(rest ? s : { label: s.label });
    if (departmentCompany) trail.push(departmentCompany);
    if (rest) {
      trail.push({
        label: FIXED[`${section}/${rest}`] ?? (section === 'employees' ? employeeName : groupName) ?? rest,
      });
    }
  }

  return <Trail items={trail} />;
}
