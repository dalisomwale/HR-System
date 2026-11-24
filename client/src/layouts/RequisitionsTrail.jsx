import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Trail } from './LeaveTrail.jsx';
import { useRq } from '../pages/requisitions/rq.js';

/* Where you are in the Inventory System (D105, D107): Inventory System › Manage stock › A4 paper ream. */

const ROOT = { label: 'Inventory System', to: '/inventory' };
const PAGES = {
  '/inventory': ['Dashboard'],
  '/inventory/requests': ['Requisitions'],
  '/inventory/stock': ['Manage Stock'],
  '/inventory/receive': ['Receive Stock'],
  '/inventory/issue': ['Issue Stock'],
  '/inventory/transactions': ['Transactions'],
  '/inventory/reports': ['Monthly Reports'],
  '/inventory/categories': ['Stock Categories'],
  '/inventory/settings': ['Requisition Departments'],
  '/inventory/suppliers': ['Suppliers'],
  '/inventory/users': ['Users'],
  '/inventory/roles': ['Roles'],
  '/inventory/alerts': ['Stock Alerts'],
  '/inventory/audit': ['Audit Trail'],
};
const PARENT = { Requisitions: '/inventory/requests', 'Manage Stock': '/inventory/stock' };

export default function RequisitionsTrail() {
  const { pathname } = useLocation();
  const rq = useRq();
  const reqId = pathname.match(/^\/inventory\/requests\/(\d+)$/)?.[1];
  const itemId = pathname.match(/^\/inventory\/stock\/(\d+)(\/edit)?$/)?.[1];
  const editing = /\/edit$/.test(pathname);
  const req = useQuery({
    queryKey: ['requisition', reqId],
    queryFn: () => api.get(`/api/requisitions/${reqId}`),
    enabled: !!reqId,
  });
  const item = useQuery({
    queryKey: ['stock-item', itemId],
    queryFn: () => api.get(`/api/stock/items/${itemId}`),
    enabled: !!itemId,
  });
  // The requisitions page is named as in the menu: Raise A Requisition for those who can (D139).
  const reqLabel = rq.data?.canRaise ? 'Raise A Requisition' : 'Requisitions';
  const trail = [ROOT];
  if (reqId) {
    trail.push({ label: reqLabel, to: PARENT.Requisitions }, { label: req.data?.ref ?? '…' });
  } else if (pathname === '/inventory/requests') {
    trail.push({ label: reqLabel });
  } else if (itemId) {
    trail.push({ label: 'Manage Stock', to: PARENT['Manage Stock'] });
    if (editing)
      trail.push({ label: item.data?.name ?? '…', to: `/inventory/stock/${itemId}` }, { label: 'Edit' });
    else trail.push({ label: item.data?.name ?? '…' });
  } else if (PAGES[pathname]) {
    const parts = PAGES[pathname];
    parts.forEach((label, i) => trail.push(i < parts.length - 1 ? { label, to: PARENT[label] } : { label }));
  } else {
    return null;
  }
  return <Trail items={trail} />;
}
