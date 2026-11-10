import { Router } from 'express';
import { asyncHandler } from '../../utils/validation.js';
import { need } from './access.js';

/*
 * The inventory system's Suppliers page (D107). Its Users and Roles are the shared ones of every
 * module (modules/access, D108).
 */
export function inventoryAdminRoutes({ db }) {
  const router = Router();
  const seeStock = need((c) => c.canSeeStock, 'You do not have access to stock.');

  // ── Suppliers ────────────────────────────────────────────────────────────────────────────────
  // As on the inventory system: every supplier named on a delivery, with how often and how much.
  router.get(
    '/suppliers',
    seeStock,
    asyncHandler(async (req, res) => {
      const rows = await db('stock_receipts as s')
        .whereNotNull('s.supplier')
        .whereNot('s.supplier', '')
        .groupBy('s.supplier')
        .orderBy('s.supplier')
        .select('s.supplier')
        .count({ deliveries: '*' })
        .sum({ units: 's.quantity' })
        .sum({ value: db.raw('s.quantity * s.unit_price') })
        .max({ last: 's.date_received' });
      res.json({
        items: rows.map((r) => ({
          name: r.supplier,
          deliveries: Number(r.deliveries),
          units: Number(r.units ?? 0),
          value: Number(r.value ?? 0),
          lastDelivery: r.last,
        })),
      });
    }),
  );

  return router;
}
