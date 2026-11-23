import {
  Briefcase,
  CalendarCheck,
  Clock,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  ShoppingCart,
} from 'lucide-react';
import AppFrame from '../layouts/AppFrame.jsx';
import { ActionTile, ActionTiles, PageHeader, TodayDate } from '../components/ui.jsx';
import { can, hasRole, seesWholeGroup, useMe } from '../lib/auth.jsx';
import { useRq } from './requisitions/rq.js';

/*
 * The first page after sign-in: the Altus Group HR applications. Leave management is live
 * (phase 1); Recruitment and Performance management are open to everyone (D114, D115); the
 * others are shown as coming soon to HR, System Administrators and directors.
 * Everyone else sees only the applications they use: Leave management and My profile.
 */

const APPS = [
  {
    id: 'leave',
    name: 'Leave Management',
    description: 'Apply, Balances And Approvals',
    icon: CalendarCheck,
    to: '/home',
    everyone: true,
  },
  {
    id: 'employees',
    name: 'Employee Management',
    description: 'Every Member Of Staff',
    icon: Users,
    to: '/people',
    needs: 'people.view',
  },
  {
    // Brought in from the Altus inventory system (D105); open to everyone with a part in it.
    id: 'requisitions',
    name: 'Inventory System',
    description: 'Stock, Requisitions And Reports',
    icon: ShoppingCart,
    to: '/requisitions',
    requisitions: true,
  },
  {
    // AMS cash and float (D126): its own module, for those with a role in it.
    id: 'float',
    name: 'Float System',
    description: 'AMS Branches: Cash, Airtel And MTN Float',
    icon: Wallet,
    to: '/float',
    needsAny: 'float.',
  },
  {
    // Live from 18 Nov 2026 (D114): everyone sees open positions and their applications.
    id: 'recruitment',
    name: 'Recruitment Management',
    description: 'Hiring Requests, Vacancies And Applicants',
    icon: Briefcase,
    to: '/recruitment',
    everyone: true,
  },
  {
    // Live from 18 Nov 2026 (D115): everyone has their own appraisal.
    id: 'performance',
    name: 'Performance Management',
    description: 'Goals, Appraisals And Probation',
    icon: TrendingUp,
    to: '/performance',
    everyone: true,
  },
  {
    id: 'shifts',
    name: 'Shift Management',
    description: 'Rosters And Attendance',
    icon: Clock,
    comingSoon: true,
  },
  {
    id: 'payroll',
    name: 'Payroll Management',
    description: 'Pay Runs And Payslips',
    icon: Wallet,
    comingSoon: true,
  },
  {
    id: 'profile',
    name: 'My Profile',
    description: 'Your Details',
    icon: UserRound,
    to: '/profile',
    everyone: true,
  },
];

// Each live application keeps its own colour, as the inventory dashboard's tiles do.
const TONES = {
  leave: 'receive',
  employees: 'stock',
  requisitions: 'request',
  recruitment: 'issue',
  float: 'receive',
  performance: 'stock',
  profile: 'reports',
};

export default function LauncherPage() {
  const { data: me } = useMe();
  const seesAll = seesWholeGroup(me) || can(me, 'people.view') || hasRole(me, 'HR_ADMIN');
  const rq = useRq();
  const apps = APPS.filter((a) =>
    a.requisitions
      ? Boolean(rq.data)
      : a.needsAny
        ? (me?.perms ?? []).some((p) => p.startsWith(a.needsAny))
        : a.needs
          ? can(me, a.needs)
          : a.everyone || seesAll,
  );

  return (
    <AppFrame>
      <PageHeader title="Applications" actions={<TodayDate />} />
      <ActionTiles>
        {apps.map((app) => (
          <ActionTile
            key={app.id}
            to={app.to}
            icon={app.icon}
            title={app.name}
            desc={app.description}
            tone={TONES[app.id]}
            off={app.comingSoon}
          />
        ))}
      </ActionTiles>
    </AppFrame>
  );
}
