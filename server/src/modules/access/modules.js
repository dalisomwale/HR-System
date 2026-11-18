/*
 * Users, Roles and access levels for every module (D108), in the inventory system's format
 * (D107): each role gets one level per area; a level includes everything in the levels below it;
 * "multi" areas are ticks. A level is a set of access rights; roles store the rights. Each module
 * has a fixed "System Admin" role with every right, and the System Administrator position
 * (HR_ADMIN) has every right in every module.
 *
 * Positions (System Administrator, Department Manager, the directors) stay on the employee
 * record: they decide who approves and signs off in the workflows, not which screens open.
 */

const ADMIN_AREAS = (prefix) => [
  {
    key: 'users',
    label: 'Users',
    hint: 'Who has a role in this module',
    levels: [
      ['No access', "Can't open Users.", []],
      ['Manage', 'Give employees a role, change it, and disable or remove it.', [`${prefix}users`]],
    ],
  },
  {
    key: 'roles',
    label: 'Roles',
    hint: 'Roles and access levels',
    levels: [
      ['No access', "Can't open Roles.", []],
      ['Manage', 'Create roles and choose the access level each role has in every area.', [`${prefix}roles`]],
    ],
  },
  {
    key: 'audit',
    label: 'Audit trail',
    hint: 'Every change made in this module',
    levels: [
      ['No access', "Can't open the Audit trail.", []],
      ['View', 'See who changed what and when, and export it to Excel.', [`${prefix}audit`]],
    ],
  },
];

const LEAVE_AREAS = [
  {
    key: 'approvals',
    label: 'HR approvals',
    hint: 'The final decision on leave',
    levels: [
      ['No access', 'Approves only as a line manager or delegate.', []],
      [
        'Final approval',
        'Give the final decision on leave and cancellation requests, from the HR approvals queue.',
        ['leave.approve_final'],
      ],
    ],
  },
  {
    key: 'requests',
    label: 'Leave requests',
    hint: 'Whose requests they can open',
    levels: [
      ['Own and their team', 'Their own requests, and their team’s as a manager or delegate.', []],
      [
        'All requests',
        'Every leave request in the group, without confidential reasons or medical documents.',
        ['leave.view_all'],
      ],
      [
        'All, including confidential',
        'Every leave request, with confidential reasons and medical documents.',
        ['leave.view_all', 'leave.confidential'],
      ],
    ],
  },
  {
    key: 'overview',
    label: 'Group overview',
    hint: 'Group-wide dashboards and reports',
    levels: [
      ['No access', 'Sees only their own and their team’s figures.', []],
      ['View', 'The group overview, and leave reports for the whole group.', ['leave.overview']],
    ],
  },
  {
    key: 'balances',
    label: 'Balances',
    hint: 'Everyone’s leave balances',
    levels: [
      ['No access', 'Sees only their own balances.', []],
      ['View & adjust', 'See any employee’s balances and record adjustments.', ['leave.balances']],
    ],
  },
  {
    key: 'types',
    label: 'Leave types',
    hint: 'Leave types, rules and balance jobs',
    levels: [
      ['No access', "Can't open Leave types.", []],
      ['Manage', 'Add and change leave types and their rules, and run the balance jobs.', ['leave.types']],
    ],
  },
  {
    key: 'calendar',
    label: 'Calendar',
    hint: 'Public holidays and working schedules',
    levels: [
      ['No access', "Can't change public holidays or working schedules.", []],
      ['Manage', 'Add and change public holidays and working schedules.', ['leave.calendar']],
    ],
  },
  {
    key: 'delegations',
    label: 'Delegations',
    hint: 'Who covers approvals for whom',
    levels: [
      ['Own only', 'Set up and revoke only their own delegations.', []],
      ['Manage everyone’s', 'See, set up and revoke delegations for anyone.', ['leave.delegations']],
    ],
  },
  {
    key: 'settings',
    label: 'Workflow settings',
    hint: 'How the leave workflow behaves',
    levels: [
      ['No access', "Can't open Workflow settings.", []],
      ['Manage', 'Change and confirm the workflow settings.', ['leave.settings']],
    ],
  },
  {
    key: 'emails',
    label: 'Emails',
    hint: 'The email outbox',
    levels: [
      ['No access', "Can't open Emails.", []],
      ['View & resend', 'See every email the system sent and resend failed ones.', ['leave.emails']],
    ],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    hint: 'Which leave notifications are sent and emailed',
    levels: [
      ['No access', "Can't open Notifications.", []],
      [
        'Manage',
        'Choose which leave notifications are sent, and which of them are also emailed.',
        ['leave.notifications'],
      ],
    ],
  },
  ...ADMIN_AREAS('leave.'),
];

const PEOPLE_AREAS = [
  {
    key: 'employees',
    label: 'Employees',
    hint: 'Employee records',
    levels: [
      ['No access', "Can't open Employee management.", []],
      [
        'View',
        'See every employee record, company and department, the dashboards and the reports.',
        ['people.view'],
      ],
      [
        'Add & edit',
        'Everything in View, plus add, edit, import and mark employees as left.',
        ['people.view', 'people.edit'],
      ],
    ],
  },
  {
    key: 'organisation',
    label: 'Organisation',
    hint: 'Companies, branches and departments',
    levels: [
      ['No access', "Can't change companies, branches or departments.", []],
      [
        'Manage',
        'Add, rename and close companies, their branches and departments.',
        ['people.view', 'people.org'],
      ],
    ],
  },
  {
    key: 'positions',
    label: 'Positions & accounts',
    hint: 'Positions and Microsoft accounts',
    levels: [
      ['No access', "Can't change positions or Microsoft accounts.", []],
      [
        'Manage',
        'Give positions (System Administrator, Department Manager, the directors), set direct reports and link Microsoft accounts. Includes making someone System Administrator.',
        ['people.view', 'people.positions'],
      ],
    ],
  },
  ...ADMIN_AREAS('people.'),
];

const INVENTORY_AREAS = [
  {
    key: 'stock',
    label: 'Stock',
    hint: 'Stock levels, receiving and issuing',
    levels: [
      ['No access', "Can't open any stock pages.", []],
      ['View', 'See stock levels per branch, item details and stock history.', ['stock.view']],
      [
        'Receive & issue',
        'Everything in View, plus record deliveries (including new items) and issue stock to departments.',
        ['stock.view', 'stock.receive', 'stock.issue'],
      ],
      [
        'Full control',
        'Everything in Receive & issue, plus add, edit and delete items and change prices and reorder levels.',
        ['stock.view', 'stock.receive', 'stock.issue', 'items.manage'],
      ],
    ],
  },
  {
    key: 'requisitions',
    label: 'Requisitions',
    hint: 'Who does what in the requisition workflow',
    multi: true,
    levels: [
      [
        'Raise for their department',
        "Raise requisitions for their own department, attach quotations when it isn't IT-related, resubmit after a rejection and cancel before approval. Sees their department's requisitions.",
        ['requisitions.raise'],
      ],
      [
        'Raise for any company or department',
        'Raise requisitions for any company and department in the group, not just their own. Sees the requisitions they raised.',
        ['requisitions.raise', 'requisitions.raise_any'],
      ],
      [
        'IT quotations',
        'Attach quotations to IT-related requisitions and send them to the Director.',
        ['requisitions.it_quotes'],
      ],
      [
        'Director approval',
        'Approve a requisition and pick the quotation, or reject it back to the department with a reason.',
        ['requisitions.approve'],
      ],
      [
        'Accounts',
        'Prepare payment for approved requisitions, then attach the proof of payment once the CFO approves.',
        ['requisitions.accounts'],
      ],
      [
        'Accounts Manager',
        'Check payments from Accounts: approve them on to the CFO or send them back to Accounts.',
        ['requisitions.accounts_review'],
      ],
      [
        'Chief Finance Officer',
        'Final approval of payments, or send them back to the Accounts Manager.',
        ['requisitions.cfo'],
      ],
      [
        'See all requisitions',
        'See every requisition at any stage, without taking part.',
        ['requisitions.view_all'],
      ],
    ],
  },
  {
    key: 'categories',
    label: 'Categories',
    hint: 'Stock categories',
    levels: [
      ['No access', "Can't open Categories.", []],
      ['Manage', 'Add, rename and delete categories.', ['categories.manage']],
    ],
  },
  {
    key: 'transactions',
    label: 'Transactions',
    hint: 'Every stock movement by date',
    levels: [
      ['No access', "Can't open Transactions.", []],
      ['View', 'See every receipt and issue, filtered by date, item and category.', ['transactions.view']],
    ],
  },
  {
    key: 'reports',
    label: 'Monthly reports',
    hint: 'Monthly stock reports and category activity',
    levels: [
      ['No access', "Can't open Monthly Reports.", []],
      [
        'View & export',
        'See monthly stock reports for any month, print them and export them to Excel.',
        ['reports.view'],
      ],
    ],
  },
  {
    key: 'scope',
    label: 'Department limit',
    hint: 'Whose stock, transactions and reports they see',
    levels: [
      [
        'Whole organisation',
        'See stock, transactions and reports for every department (as far as their other access allows).',
        [],
      ],
      [
        'Own department only',
        'See only what was issued to their own department (from their employee record): its stock, its transactions and its monthly report.',
        ['scope.department'],
      ],
    ],
  },
  {
    key: 'organisation',
    label: 'Requisition departments',
    hint: 'Which departments do the IT, Accounts and Stores steps',
    levels: [
      ['No access', "Can't change the requisition departments.", []],
      [
        'Manage',
        'Choose the IT, Accounts and Stores departments. Companies, branches and departments are kept in Employee management.',
        ['admin.org'],
      ],
    ],
  },
  {
    key: 'alerts',
    label: 'Stock alerts',
    hint: 'Who gets the low-stock emails',
    levels: [
      ['No access', "Can't open Stock alerts.", []],
      [
        'Manage',
        'Choose which stock keepers get the low-stock and out-of-stock alerts and the daily reorder summary.',
        ['admin.alerts'],
      ],
    ],
  },
  // Cash and float for Altus Money Solutions (D117, D121).
  {
    key: 'float',
    label: 'AMS cash and float',
    hint: 'Deposits, withdrawals and float at the AMS branches',
    levels: [
      ['No access', "Can't open AMS cash and float.", []],
      [
        'Branch staff',
        'Open and close their own branch (from their employee record), record deposits and withdrawals, count at handover, record cash to finance and raise requisitions. Reports to the Operations Officer.',
        ['float.record'],
      ],
      ['View all branches', 'See every AMS branch, the dashboard and the daily reports, read only.', ['float.view_all']],
      [
        'Operations Officer',
        'Supervises every branch: approves float movements, reversals and cash to finance, reviews large transactions, handles surpluses and deficits, reconciles and signs off the daily report, and approves requisitions on to the manager.',
        ['float.view_all', 'float.supervise'],
      ],
      [
        'Manager',
        'Everything the Operations Officer does, plus approves requisitions on to the directors.',
        ['float.view_all', 'float.supervise', 'float.approve'],
      ],
    ],
  },
  {
    key: 'float_director',
    label: 'AMS director approvals',
    hint: 'Write-offs above the limit',
    levels: [
      ['No access', 'No director approvals.', []],
      [
        'Approve',
        'See every AMS branch, approve write-offs above the director limit and give the final approval of AMS requisitions; receives the daily reports.',
        ['float.view_all', 'float.director'],
      ],
    ],
  },
  {
    key: 'float_shortages',
    label: 'AMS staff shortages',
    hint: 'For HR follow-up',
    levels: [
      ['No access', "Can't see shortages by member of staff.", []],
      ['View', 'See the deficits found at counts and who was on duty, for follow-up.', ['float.shortages']],
    ],
  },
  {
    key: 'float_admin',
    label: 'AMS set-up',
    hint: 'Branches, accounts, the week, limits and commission',
    levels: [
      ['No access', "Can't change the AMS set-up.", []],
      [
        'Manage',
        'Add AMS branches and their opening balances, set minimum floats, the trading days, the week and report time, the limits and the commission tables, and record commission received.',
        ['float.admin'],
      ],
    ],
  },
  ...ADMIN_AREAS('admin.'),
];

const RECRUITMENT_AREAS = [
  {
    key: 'requests',
    label: 'Hiring requests',
    hint: 'Asking for, checking and approving new positions',
    multi: true,
    levels: [
      [
        'Raise for any department',
        'Ask for a position in any company and department. Managers can always ask for their own team without this.',
        ['recruitment.raise_any'],
      ],
      [
        'HR review',
        'Check hiring requests and send them to a director, or turn them down with a reason.',
        ['recruitment.review'],
      ],
      ['Director approval', 'Approve or reject hiring requests.', ['recruitment.approve']],
      ['See all requests', 'See every hiring request at any stage.', ['recruitment.requests_all']],
    ],
  },
  {
    key: 'vacancies',
    label: 'Vacancies & candidates',
    hint: 'Running vacancies, candidates and interviews',
    levels: [
      [
        'No access',
        'Sees open positions to apply for, and the vacancies and interviews they are part of.',
        [],
      ],
      ['View', 'See every vacancy, its candidates and their CVs.', ['recruitment.view']],
      [
        'Manage',
        'Everything in View, plus open and change vacancies, add candidates, move them between stages, schedule interviews and make offers.',
        ['recruitment.view', 'recruitment.manage'],
      ],
      [
        'Manage & hire',
        'Everything in Manage, plus hire a candidate who accepted an offer, which adds them to Employee management.',
        ['recruitment.view', 'recruitment.manage', 'recruitment.hire'],
      ],
    ],
  },
  ...ADMIN_AREAS('recruitment.'),
];

const PERFORMANCE_AREAS = [
  {
    key: 'appraisals',
    label: 'Appraisals',
    hint: 'Whose appraisals they see, and HR sign-off',
    levels: [
      ['Own and their team', 'Their own appraisals, and their team’s as a manager.', []],
      ['View all', 'Every appraisal in the group, read only.', ['performance.view_all']],
      [
        'View all and sign off',
        'Every appraisal, plus the final HR sign-off of year-end appraisals (or sending them back to the manager).',
        ['performance.view_all', 'performance.signoff'],
      ],
    ],
  },
  {
    key: 'cycles',
    label: 'Review cycles',
    hint: 'Starting the year and moving it on',
    levels: [
      ['No access', "Can't open Review cycles.", []],
      [
        'Manage',
        'Start a review cycle, which gives every employee an appraisal, and move it from goal setting to mid-year, year end and closed.',
        ['performance.cycles'],
      ],
    ],
  },
  {
    key: 'probation',
    label: 'Probation reviews',
    hint: 'Confirming staff at the end of probation',
    levels: [
      ['Their team only', 'Complete the probation reviews of the people who report to them.', []],
      [
        'Decide',
        'See every probation review, start one, and make the final decision (confirm, extend or not confirm), which updates the employee record.',
        ['performance.probation'],
      ],
    ],
  },
  ...ADMIN_AREAS('performance.'),
];

export const MODULES = {
  leave: { key: 'leave', label: 'Leave management', areas: LEAVE_AREAS },
  people: { key: 'people', label: 'Employee management', areas: PEOPLE_AREAS },
  inventory: { key: 'inventory', label: 'Inventory system', areas: INVENTORY_AREAS },
  recruitment: { key: 'recruitment', label: 'Recruitment management', areas: RECRUITMENT_AREAS },
  performance: { key: 'performance', label: 'Performance management', areas: PERFORMANCE_AREAS },
};
export const MODULE_KEYS = Object.keys(MODULES);

const allOf = (areas) => [...new Set(areas.flatMap((a) => a.levels.flatMap(([, , p]) => p)))];
/** Every right in a module. Department limit is a restriction, not a right, so it is left out. */
export const allPermissions = (module) =>
  allOf(MODULES[module].areas).filter((p) => p !== 'scope.department');

/** Rights for a set of levels, e.g. { stock: 2, reports: 1, requisitions: [0, 2] }. */
export function permsForLevels(module, levels = {}) {
  const perms = new Set();
  for (const area of MODULES[module].areas) {
    const chosen = levels[area.key];
    if (area.multi) {
      for (const i of Array.isArray(chosen) ? chosen : []) {
        for (const p of area.levels[Number(i)]?.[2] ?? []) perms.add(p);
      }
    } else {
      const lvl = Math.max(0, Math.min(area.levels.length - 1, Number(chosen) || 0));
      for (const p of area.levels[lvl][2]) perms.add(p);
    }
  }
  return [...perms];
}

/** The level in each area a set of rights gives (the highest level fully covered). */
export function levelsFromPerms(module, perms) {
  const have = new Set(perms);
  const out = {};
  for (const area of MODULES[module].areas) {
    const covered = (need) => need.every((p) => have.has(p));
    if (area.multi) {
      out[area.key] = area.levels.map(([, , need], i) => (covered(need) ? i : -1)).filter((i) => i >= 0);
    } else {
      out[area.key] = 0;
      area.levels.forEach(([, , need], i) => {
        if (need.length && covered(need)) out[area.key] = i;
      });
    }
  }
  return out;
}

/** "Stock: Receive & issue" style summary of a role (areas with some access only). */
export function levelsSummary(module, perms) {
  const levels = levelsFromPerms(module, perms);
  const out = [];
  for (const area of MODULES[module].areas) {
    const lvl = levels[area.key];
    if (area.multi) {
      if (lvl.length) out.push({ area: area.label, level: lvl.map((i) => area.levels[i][0]).join(', ') });
    } else if (lvl > 0) {
      out.push({ area: area.label, level: area.levels[lvl][0] });
    }
  }
  return out;
}

/**
 * Active employees whose role in `module` has any of `perms`, or is the module's System Admin
 * role. Used to decide who is told about work waiting for them.
 */
export async function moduleHolders(db, module, perms, exclude = []) {
  return db('access_users as u')
    .join('access_roles as r', 'r.id', 'u.role_id')
    .join('employees as e', 'e.id', 'u.employee_id')
    .where({ 'u.module': module, 'u.is_active': true, 'e.status': 'ACTIVE' })
    .where((w) =>
      w
        .where('r.is_system', true)
        .orWhereExists(
          db('access_role_permissions as p').whereRaw('p.role_id = r.id').whereIn('p.permission', perms),
        ),
    )
    .whereNotIn('e.id', exclude.filter(Boolean))
    .distinct()
    .pluck('e.id');
}
