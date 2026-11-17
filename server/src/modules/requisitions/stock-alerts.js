import { todayInLusaka } from '../../utils/dates.js';
import { runOnce } from '../leave/jobs.service.js';
import { notify } from '../notifications/notify.service.js';
import { forecast, runningLow } from './stock.service.js';

/*
 * Stock threshold alerts by email (D111). The people who look after stock hear, in the system
 * and by email:
 *   - at once, when an item's total stock falls to its reorder level or below, or runs out
 *     (once per crossing: it alerts again only after stock has gone back above the level);
 *   - once a day, a summary of every item below its reorder level, out of stock, or set to run
 *     out within two weeks (nothing is sent on a day when nothing is low).
 *
 * Who gets them (D112): inventory users whose role can receive stock or manage items, or who have
 * the System Admin role, and of those only the ones the System Admin leaves the alerts on for, on
 * Inventory system › Admin › Stock alerts.
 */

const SYSTEM = { actorType: 'SYSTEM' };
const units = (n) => Number(n).toLocaleString('en-GB');
export const stockState = (quantity, reorderLevel) =>
  quantity <= 0 ? 'out' : quantity <= reorderLevel ? 'low' : 'ok';

/** Rights that make someone a stock keeper, who can get the alerts. */
export const KEEPER_RIGHTS = ['stock.receive', 'items.manage'];

/**
 * Active inventory users who can get stock alerts: their role can receive stock or manage items,
 * or it is the System Admin role. `chosenOnly` keeps those the System Admin left the alerts on for.
 */
export function stockKeepersQuery(db, { chosenOnly = true } = {}) {
  return db('access_users as u')
    .join('access_roles as r', 'r.id', 'u.role_id')
    .join('employees as e', 'e.id', 'u.employee_id')
    .where({ 'u.module': 'inventory', 'u.is_active': true, 'e.status': 'ACTIVE' })
    .modify((q) => chosenOnly && q.where('u.stock_alerts', true))
    .where((w) =>
      w
        .where('r.is_system', true)
        .orWhereExists(
          db('access_role_permissions as p')
            .whereRaw('p.role_id = r.id')
            .whereIn('p.permission', KEEPER_RIGHTS),
        ),
    );
}

/** The people the alerts go to. */
export async function stockKeepers(db) {
  return stockKeepersQuery(db).pluck('e.id');
}

/**
 * After an item's total stock changed from `before` to `after` (or its reorder level changed),
 * tell the stock keepers if it has just become low or run out. Written in the caller's
 * transaction, so a change that rolls back sends nothing.
 */
export async function alertIfCrossed(trx, { item, before, after, levelBefore, levelAfter }) {
  const was = stockState(before, levelBefore ?? item.reorder_level);
  const now = stockState(after, levelAfter ?? item.reorder_level);
  if (now === 'ok' || now === was) return { alerted: 0 };
  const level = levelAfter ?? item.reorder_level;
  const out = now === 'out';
  const title = out ? `${item.name} is out of stock` : `${item.name} is running low`;
  const recipients = await stockKeepers(trx);
  const r = await notify(trx, {
    recipients,
    event: out ? 'STOCK_OUT' : 'STOCK_LOW',
    title,
    body: out
      ? 'None left across all branches.'
      : `${units(after)} left across all branches; reorder level ${units(level)}.`,
    link: `/requisitions/stock/${item.id}`,
    entityType: 'stock_item',
    entityId: item.id,
    email: {
      subject: title,
      heading: title,
      intro: out
        ? `${item.name} has run out across all branches.`
        : `${item.name} has fallen to its reorder level or below.`,
      rows: [
        ['Item', item.name],
        ['In stock', `${units(after)} across all branches`],
        ['Reorder level', units(level)],
      ],
      action: 'Raise a requisition or receive stock so it does not run out.',
      app: 'inventory',
    },
  });
  return { alerted: r.notified, emailed: r.emailed };
}

/** The daily summary of what needs reordering, sent once per Lusaka day. */
export async function sendStockDigest(db, today = todayInLusaka()) {
  return runOnce(
    db,
    'STOCK_DIGEST',
    today,
    async () => {
      const low = runningLow(await forecast(db));
      if (!low.length) return { items: 0, notified: 0 };
      const out = low.filter((r) => r.state === 'out').length;
      const title = low.length === 1 ? '1 item needs reordering' : `${low.length} items need reordering`;
      const shown = low.slice(0, 25);
      const rows = shown.map((r) => [
        r.name,
        r.state === 'out'
          ? 'Out of stock'
          : `${units(r.quantity)} in stock · reorder at ${units(r.reorderLevel)}${
              r.daysLeft !== null ? ` · about ${r.daysLeft} ${r.daysLeft === 1 ? 'day' : 'days'} left` : ''
            }`,
      ]);
      if (low.length > shown.length) rows.push(['…', `and ${low.length - shown.length} more`]);
      const recipients = await stockKeepers(db);
      const r = await db.transaction((trx) =>
        notify(trx, {
          recipients,
          event: 'STOCK_DIGEST',
          title,
          body: out ? `${out} out of stock.` : 'Below the reorder level or running out within two weeks.',
          link: '/requisitions/stock?status=low',
          email: {
            subject: title,
            heading: title,
            intro:
              'These items are below their reorder level, out of stock, or will run out within two weeks at the rate they are being issued.',
            rows,
            action: 'Raise requisitions for them, or receive the stock that is on its way.',
            app: 'inventory',
          },
        }),
      );
      return { items: low.length, outOfStock: out, notified: r.notified, emailed: r.emailed };
    },
    SYSTEM,
  );
}
