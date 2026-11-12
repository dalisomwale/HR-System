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
  ...ADMIN_AREAS('admin.'),
];

export const MODULES = {
  leave: { key: 'leave', label: 'Leave management', areas: LEAVE_AREAS },
  people: { key: 'people', label: 'Employee management', areas: PEOPLE_AREAS },
  inventory: { key: 'inventory', label: 'Inventory system', areas: INVENTORY_AREAS },
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
