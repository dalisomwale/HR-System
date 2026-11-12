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
 * (phase 1); the others are shown as coming soon to HR, System Administrators and directors.
 * Everyone else sees only the applications they use: Leave management and My profile.
 */

const APPS = [
  {
    id: 'leave',
    name: 'Leave management',
    description: 'Apply, balances and approvals',
    icon: CalendarCheck,
    to: '/home',
    everyone: true,
  },
  {
    id: 'employees',
    name: 'Employee management',
    description: 'Every member of staff',
    icon: Users,
    to: '/people',
    needs: 'people.view',
  },
  {
    // Brought in from the Altus inventory system (D105); open to everyone with a part in it.
    id: 'requisitions',
    name: 'Inventory system',
    description: 'Stock, requisitions and reports',
    icon: ShoppingCart,
    to: '/requisitions',
    requisitions: true,
  },
  {
    id: 'recruitment',
    name: 'Recruitment management',
    description: 'Vacancies and applicants',
    icon: Briefcase,
    comingSoon: true,
  },
  {
    id: 'performance',
    name: 'Performance management',
    description: 'Goals and appraisals',
    icon: TrendingUp,
    comingSoon: true,
  },
  {
    id: 'shifts',
    name: 'Shift management',
    description: 'Rosters and attendance',
    icon: Clock,
    comingSoon: true,
  },
  {
    id: 'payroll',
    name: 'Payroll management',
    description: 'Pay runs and payslips',
    icon: Wallet,
    comingSoon: true,
  },
  {
    id: 'profile',
    name: 'My profile',
    description: 'Your details',
    icon: UserRound,
    to: '/profile',
    everyone: true,
  },
];

// Each live application keeps its own colour, as the inventory dashboard's tiles do.
const TONES = { leave: 'receive', employees: 'stock', requisitions: 'request', profile: 'reports' };

export default function LauncherPage() {
  const { data: me } = useMe();
  const seesAll = seesWholeGroup(me) || can(me, 'people.view') || hasRole(me, 'HR_ADMIN');
  const rq = useRq();
  const apps = APPS.filter((a) =>
    a.requisitions ? Boolean(rq.data) : a.needs ? can(me, a.needs) : a.everyone || seesAll,
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
            badge={app.comingSoon ? 'Coming soon' : undefined}
          />
        ))}
      </ActionTiles>
    </AppFrame>
  );
}
