import { Fragment } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { hasRole, useMe } from '../lib/auth.jsx';

/*
 * Where you are in Leave management (D68), the same way as in Employee management:
 * Leave management › Leave types › Annual leave. Worked out from the address; names come from
 * the queries the pages already use.
 */

const ROOT = { label: 'Leave management', to: '/home' };
const PAGES = {
  '/home': 'Home',
  '/leave': 'My leave',
  '/leave/apply': 'Apply for leave',
  '/leave/balances': 'My balances',
  '/notifications': 'Notifications',
  '/team': 'Departmental overview',
  '/team/members': 'Members',
  '/approvals': 'Approvals',
  '/delegation': 'Delegation',
  '/hr/approvals': 'HR approvals',
  '/admin/leave-types': 'Leave types',
  '/admin/delegations': 'Delegations',
  '/admin/holidays': 'Public holidays',
  '/admin/schedules': 'Working schedules',
  '/reports': 'Reports',
  '/admin/roles': 'Roles',
  '/admin/sign-in-requests': 'Sign-in requests',
  '/admin/settings': 'Workflow settings',
  '/admin/emails': 'Emails',
  '/admin/audit': 'Audit log',
};

export default function LeaveTrail() {
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const { data: me } = useMe();
  const requestId = pathname.match(/^\/leave\/requests\/(\d+)/)?.[1];
  const leaveTypeId = pathname.match(/^\/admin\/leave-types\/(\d+)/)?.[1];
  const request = useQuery({
    queryKey: ['leave-request', requestId],
    queryFn: () => api.get(`/api/leave/requests/${requestId}`),
    enabled: !!requestId,
  });
  const leaveType = useQuery({
    queryKey: ['admin-leave-type', leaveTypeId],
    queryFn: () => api.get(`/api/admin/leave-types/${leaveTypeId}`),
    enabled: !!leaveTypeId,
  });
  const reports = useQuery({
    queryKey: ['reports', '/api/reports'],
    queryFn: () => api.get('/api/reports'),
    enabled: pathname === '/reports',
  });

  const trail = [ROOT];
  if (pathname === '/hr') {
    trail.push({ label: hasRole(me, 'HR_OFFICER') ? 'HR overview' : 'Group overview' });
  } else if (requestId) {
    // A request sits under the place it is usually reached from: your own leave, or the
    // approvals of whoever is looking at it.
    const r = request.data;
    const own = r && r.employee?.id === me?.id;
    const parent = own
      ? { label: 'My leave', to: '/leave' }
      : hasRole(me, 'HR_OFFICER')
        ? { label: 'HR approvals', to: '/hr/approvals' }
        : me?.isManager || me?.isDelegate
          ? { label: 'Approvals', to: '/approvals' }
          : { label: 'Group overview', to: '/hr' };
    trail.push(parent, { label: r ? (r.reference ?? 'Draft request') : '…' });
  } else if (leaveTypeId) {
    trail.push({ label: 'Leave types', to: '/admin/leave-types' }, { label: leaveType.data?.name ?? '…' });
  } else if (pathname === '/reports') {
    const items = reports.data?.items ?? [];
    const chosen = items.find((x) => x.id === search.get('report')) ?? items[0];
    trail.push(chosen ? { label: 'Reports', to: '/reports' } : { label: 'Reports' });
    if (chosen) trail.push({ label: chosen.title });
  } else if (PAGES[pathname]) {
    trail.push({ label: PAGES[pathname] });
  } else {
    return null;
  }

  return <Trail items={trail} />;
}

/** The path shown at the top of a page: links to each step, the last one plain. */
export function Trail({ items }) {
  return (
    <nav aria-label="You are here" className="mb-4">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {items.map((t, i) => {
          const last = i === items.length - 1;
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
