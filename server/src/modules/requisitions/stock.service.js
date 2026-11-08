import { conflict } from '../../utils/errors.js';

/*
 * Stock held per branch (D105), as in the inventory system. stock_items.quantity is the total
 * across branches; branch_stock holds each branch's share. Every change goes through
 * changeBranchStock inside a transaction, which locks the rows so two people cannot over-issue.
 */

/** Change an item's stock at one branch by delta. Returns [old, new] for that branch. */
export async function changeBranchStock(trx, itemId, branchId, delta) {
  // Lock in a fixed order (item, then branch row) to avoid deadlocks.
  await trx('stock_items').where({ id: itemId }).forUpdate().first('id');
  await trx.raw('INSERT IGNORE INTO branch_stock (item_id, branch_id, quantity) VALUES (?, ?, 0)', [
    itemId,
    branchId,
  ]);
  const row = await trx('branch_stock')
    .where({ item_id: itemId, branch_id: branchId })
    .forUpdate()
    .first('quantity');
  const old = Number(row?.quantity ?? 0);
  const next = old + delta;
  if (next < 0) {
    throw conflict(`Only ${old} in stock at this branch. Stock may have changed while you were working.`);
  }
  await trx('branch_stock')
    .where({ item_id: itemId, branch_id: branchId })
    .update({ quantity: next, updated_at: trx.fn.now() });
  await trx('stock_items')
    .where({ id: itemId })
    .update({ quantity: trx.raw('quantity + ?', [delta]) });
  return [old, next];
}

/** Number of stock movements of an item (an item with any can't be deleted or repriced by hand). */
export async function movementCount(db, itemId) {
  const [a, b] = await Promise.all([
    db('stock_receipts').where({ item_id: itemId }).count({ n: '*' }).first(),
    db('stock_issues').where({ item_id: itemId }).count({ n: '*' }).first(),
  ]);
  return Number(a.n) + Number(b.n);
}

/**
 * Every item with how fast it is used (issued in the last `window` days) and how long the stock
 * will last. With branchIds, stock and usage are for those branches only.
 */
export async function forecast(db, { window = 30, branchIds = null } = {}) {
  const items = await db('stock_items as i')
    .leftJoin('stock_categories as c', 'c.id', 'i.category_id')
    .select(
      'i.id',
      'i.name',
      'i.category_id',
      'c.name as category_name',
      'i.quantity',
      'i.reorder_level',
      'i.unit_price',
    );
  let qty = null;
  if (branchIds) {
    const rows = branchIds.length
      ? await db('branch_stock')
          .whereIn('branch_id', branchIds)
          .groupBy('item_id')
          .select('item_id')
          .sum({ q: 'quantity' })
      : [];
    qty = new Map(rows.map((r) => [r.item_id, Number(r.q)]));
  }
  const usedQ = db('stock_issues')
    .where('created_at', '>=', db.raw('NOW() - INTERVAL ? DAY', [window]))
    .groupBy('item_id')
    .select('item_id')
    .sum({ q: 'quantity' });
  if (branchIds) usedQ.whereIn('branch_id', branchIds.length ? branchIds : [0]);
  const used = new Map((await usedQ).map((r) => [r.item_id, Number(r.q)]));
  return items.map((r) => {
    const quantity = qty ? (qty.get(r.id) ?? 0) : Number(r.quantity);
    const perDay = (used.get(r.id) ?? 0) / window;
    const daysLeft = perDay > 0 ? Math.floor(quantity / perDay) : null;
    // Aim to hold a month of usage on top of the reorder level.
    const target = Math.max(r.reorder_level * 2, Math.ceil(perDay * 30) + r.reorder_level);
    return {
      id: r.id,
      name: r.name,
      categoryId: r.category_id,
      category: r.category_name,
      quantity,
      reorderLevel: r.reorder_level,
      unitPrice: Number(r.unit_price),
      perDay,
      daysLeft,
      suggest: Math.max(0, target - quantity),
      state: quantity <= 0 ? 'out' : quantity <= r.reorder_level ? 'low' : 'ok',
    };
  });
}

/** Below reorder level or running out within `days`, most urgent first. */
export function runningLow(rows, days = 14) {
  const key = (r) => (r.quantity === 0 ? -1 : (r.daysLeft ?? 9999));
  return rows
    .filter((r) => r.state !== 'ok' || (r.daysLeft !== null && r.daysLeft <= days))
    .sort((a, b) => key(a) - key(b) || a.quantity - b.quantity);
}

export const kwacha = (n) =>
  `K${Number(n).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
