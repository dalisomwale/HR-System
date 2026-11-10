/*
 * Inventory access levels (D107), as on the Altus inventory system's Admin › Roles page
 * (includes/permissions.php there). Each role gets one level per area; a level includes
 * everything in the levels below it. Requisitions is a set of ticks, since a role can play any
 * number of parts in the workflow. Underneath, a level is a set of access rights and roles store
 * the rights. The System Admin role always has every right and cannot be changed.
 */
export const ACCESS_AREAS = [
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
    label: 'Organisation',
    hint: 'Branches and requisition departments',
    levels: [
      ['No access', "Can't change Branches or Requisition departments.", []],
      [
        'Manage',
        'Add, rename and disable branches, and choose the IT, Accounts and Stores departments. Companies and departments are managed in Employee management.',
        ['admin.org'],
      ],
    ],
  },
  {
    key: 'users',
    label: 'Users',
    hint: 'Who can use the inventory system',
    levels: [
      ['No access', "Can't open Users.", []],
      ['Manage', 'Give employees access, choose their role, and disable or remove access.', ['admin.users']],
    ],
  },
  {
    key: 'roles',
    label: 'Roles',
    hint: 'Roles and access levels',
    levels: [
      ['No access', "Can't open Roles.", []],
      ['Manage', 'Create roles and choose the access level each role has in every area.', ['admin.roles']],
    ],
  },
];

/** Every access right that exists. */
export const ALL_PERMISSIONS = [
  ...new Set(ACCESS_AREAS.flatMap((a) => a.levels.flatMap(([, , perms]) => perms))),
];

/** Rights for a set of levels, e.g. { stock: 2, reports: 1, requisitions: [0, 2] }. */
export function permsForLevels(levels = {}) {
  const perms = new Set();
  for (const area of ACCESS_AREAS) {
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
export function levelsFromPerms(perms) {
  const have = new Set(perms);
  const out = {};
  for (const area of ACCESS_AREAS) {
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
export function levelsSummary(perms) {
  const levels = levelsFromPerms(perms);
  const out = [];
  for (const area of ACCESS_AREAS) {
    const lvl = levels[area.key];
    if (area.multi) {
      if (lvl.length) out.push({ area: area.label, level: lvl.map((i) => area.levels[i][0]).join(', ') });
    } else if (lvl > 0) {
      out.push({ area: area.label, level: area.levels[lvl][0] });
    }
  }
  return out;
}
