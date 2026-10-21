import { Fragment } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
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
  import: { label: 'Import employees', to: '/people/import' },
};
const FIXED = {
  'employees/new': 'Add employee',
  'companies/manage': 'Add or edit companies',
  'departments/manage': 'Add or edit departments',
};

function useName(section, id) {
  const numeric = /^\d+$/.test(id ?? '');
  const employee = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/api/people/employees/${id}`),
    enabled: numeric && section === 'employees',
  });
  const companies = useQuery({
    queryKey: ['people-companies'],
    queryFn: () => api.get('/api/people/companies-overview'),
    enabled: numeric && section === 'companies',
  });
  const departments = useQuery({
    queryKey: ['people-departments', ''],
    queryFn: () => api.get('/api/people/departments-overview'),
    enabled: numeric && section === 'departments',
  });
  if (!numeric) return null;
  if (section === 'employees') {
    return employee.data ? `${employee.data.firstName} ${employee.data.lastName}` : '…';
  }
  if (section === 'companies') {
    return companies.data?.companies.find((c) => String(c.id) === id)?.name ?? '…';
  }
  if (section === 'departments') {
    return departments.data?.departments.find((d) => String(d.id) === id)?.name ?? '…';
  }
  return null;
}

export default function PeopleTrail() {
  const { pathname } = useLocation();
  const parts = pathname
    .replace(/^\/people\/?/, '')
    .split('/')
    .filter(Boolean);
  const [section, rest] = parts;
  const name = useName(section, rest);
  if (!pathname.startsWith('/people')) return null;

  const trail = [ROOT];
  if (!section) trail.push({ label: 'Home' });
  else if (section === 'import') trail.push(SECTIONS.employees, { label: 'Import employees' });
  else {
    const s = SECTIONS[section];
    if (s) trail.push(rest ? s : { label: s.label });
    if (rest) trail.push({ label: FIXED[`${section}/${rest}`] ?? name ?? rest });
  }

  return (
    <nav aria-label="You are here" className="mb-4">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {trail.map((t, i) => {
          const last = i === trail.length - 1;
          return (
            <Fragment key={`${t.label}-${i}`}>
              <li className={`flex items-center gap-1.5 ${last ? 'min-w-0' : ''}`}>
                {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden />}
                {last || !t.to ? (
                  <span aria-current="page" className="font-medium text-ink">
                    {t.label}
                  </span>
                ) : (
                  <Link to={t.to} className="text-brand hover:underline">
                    {t.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
