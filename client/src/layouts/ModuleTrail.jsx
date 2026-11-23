import { useLocation } from 'react-router';
import { Trail } from './LeaveTrail.jsx';

/*
 * Where you are in Recruitment and Performance management (D114, D115), as in the other modules:
 * Recruitment management › Vacancies › VAC-2026-000001. Records show as "Record" rather than
 * loading their names again.
 */

const MODULES = {
  recruitment: {
    root: { label: 'Recruitment Management', to: '/recruitment' },
    pages: {
      requests: ['Hiring Requests', '/recruitment/requests'],
      'requests/new': ['Request A Hire'],
      vacancies: ['Vacancies', '/recruitment/vacancies'],
      'vacancies/new': ['Open Vacancy'],
      candidates: ['Vacancies', '/recruitment/vacancies'],
      jobs: ['Open Positions'],
      applications: ['My Applications'],
      interviews: ['My Interviews'],
      users: ['Users'],
      roles: ['Roles'],
      audit: ['Audit Trail'],
    },
    record: { requests: 'Hiring request', vacancies: 'Vacancy', candidates: 'Candidate' },
  },
  float: {
    root: { label: 'Float System', to: '/float' },
    pages: {
      branch: ['Branch'],
      record: ['Record A Transaction'],
      approvals: ['Approvals'],
      requisitions: ['Requisitions'],
      daily: ['Daily Reports'],
      transactions: ['Transactions'],
      variances: ['Surplus And Deficit'],
      branches: ['Branches', '/float/branches'],
      'phone-access': ['Phone Sign-in'],
      settings: ['Settings'],
      users: ['Users'],
      roles: ['Roles'],
      audit: ['Audit Trail'],
    },
    record: { branches: 'Branch' },
  },
  performance: {
    root: { label: 'Performance Management', to: '/performance' },
    pages: {
      mine: ['My Appraisals', '/performance/mine'],
      team: ['My Team', '/performance/team'],
      appraisals: ['Appraisals', '/performance/team'],
      probation: ['Probation Reviews', '/performance/probation'],
      cycles: ['Review Cycles', '/performance/cycles'],
      'cycles/new': ['New Review Cycle'],
      users: ['Users'],
      roles: ['Roles'],
      audit: ['Audit Trail'],
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
