import { useLocation } from 'react-router';
import { Trail } from './LeaveTrail.jsx';

/*
 * Where you are in Recruitment and Performance management (D114, D115), as in the other modules:
 * Recruitment management › Vacancies › VAC-2026-000001. Records show as "Record" rather than
 * loading their names again.
 */

const MODULES = {
  recruitment: {
    root: { label: 'Recruitment management', to: '/recruitment' },
    pages: {
      requests: ['Hiring requests', '/recruitment/requests'],
      'requests/new': ['Request a hire'],
      vacancies: ['Vacancies', '/recruitment/vacancies'],
      'vacancies/new': ['Open vacancy'],
      candidates: ['Vacancies', '/recruitment/vacancies'],
      jobs: ['Open positions'],
      applications: ['My applications'],
      interviews: ['My interviews'],
      users: ['Users'],
      roles: ['Roles'],
      audit: ['Audit trail'],
    },
    record: { requests: 'Hiring request', vacancies: 'Vacancy', candidates: 'Candidate' },
  },
  float: {
    root: { label: 'Float system', to: '/float' },
    pages: {
      branch: ['Branch'],
      record: ['Record a transaction'],
      approvals: ['Approvals'],
      requisitions: ['Requisitions'],
      daily: ['Daily reports'],
      transactions: ['Transactions'],
      variances: ['Surplus and deficit'],
      branches: ['Branches', '/float/branches'],
      'phone-access': ['Phone sign-in'],
      settings: ['Settings'],
      users: ['Users'],
      roles: ['Roles'],
      audit: ['Audit trail'],
    },
    record: { branches: 'Branch' },
  },
  performance: {
    root: { label: 'Performance management', to: '/performance' },
    pages: {
      mine: ['My appraisals', '/performance/mine'],
      team: ['My team', '/performance/team'],
      appraisals: ['Appraisals', '/performance/team'],
      probation: ['Probation reviews', '/performance/probation'],
      cycles: ['Review cycles', '/performance/cycles'],
      'cycles/new': ['New review cycle'],
      users: ['Users'],
      roles: ['Roles'],
      audit: ['Audit trail'],
    },
    record: { appraisals: 'Appraisal', probation: 'Probation review', cycles: 'Review cycle' },
  },
};

export default function ModuleTrail({ module }) {
  const { pathname } = useLocation();
  const m = MODULES[module];
  const rest = pathname.replace(`/${module}`, '').replace(/^\//, '');
  if (!rest) return <Trail items={[m.root, { label: 'Dashboard' }]} />;
  const [first, second] = rest.split('/');
  const exact = m.pages[rest];
  if (exact) {
    const parent = rest.includes('/') ? m.pages[first] : null;
    return (
      <Trail
        items={[
          m.root,
          ...(parent && parent[1] && parent[0] !== exact[0] ? [{ label: parent[0], to: parent[1] }] : []),
          { label: exact[0] },
        ]}
      />
    );
  }
  const section = m.pages[first];
  return (
    <Trail
      items={[
        m.root,
        ...(section ? [{ label: section[0], to: section[1] }] : []),
        { label: second && /^\d+$/.test(second) ? (m.record[first] ?? 'Record') : (second ?? first) },
      ]}
    />
  );
}
