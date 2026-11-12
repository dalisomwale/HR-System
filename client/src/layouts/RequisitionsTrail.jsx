import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Trail } from './LeaveTrail.jsx';

/* Where you are in the Inventory System (D105, D107): Inventory System › Manage stock › A4 paper ream. */

const ROOT = { label: 'Inventory system', to: '/requisitions' };
const PAGES = {
  '/requisitions': ['Dashboard'],
  '/requisitions/requests': ['Requisitions'],
  '/requisitions/requests/new': ['Requisitions', 'Raise a requisition'],
  '/requisitions/stock': ['Manage stock'],
  '/requisitions/stock/new': ['Manage stock', 'Add item'],
  '/requisitions/receive': ['Receive stock'],
  '/requisitions/issue': ['Issue stock'],
  '/requisitions/transactions': ['Transactions'],
  '/requisitions/reports': ['Monthly reports'],
  '/requisitions/categories': ['Categories'],
  '/requisitions/settings': ['Requisition departments'],
  '/requisitions/suppliers': ['Suppliers'],
  '/requisitions/users': ['Users'],
  '/requisitions/roles': ['Roles'],
};
const PARENT = { Requisitions: '/requisitions/requests', 'Manage stock': '/requisitions/stock' };

export default function RequisitionsTrail() {
  const { pathname } = useLocation();
  const reqId = pathname.match(/^\/requisitions\/requests\/(\d+)$/)?.[1];
  const itemId = pathname.match(/^\/requisitions\/stock\/(\d+)(\/edit)?$/)?.[1];
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
  const trail = [ROOT];
  if (reqId) {
    trail.push({ label: 'Requisitions', to: PARENT.Requisitions }, { label: req.data?.ref ?? '…' });
  } else if (itemId) {
    trail.push({ label: 'Manage stock', to: PARENT['Manage stock'] });
    if (editing)
      trail.push({ label: item.data?.name ?? '…', to: `/requisitions/stock/${itemId}` }, { label: 'Edit' });
    else trail.push({ label: item.data?.name ?? '…' });
  } else if (PAGES[pathname]) {
    const parts = PAGES[pathname];
    parts.forEach((label, i) => trail.push(i < parts.length - 1 ? { label, to: PARENT[label] } : { label }));
  } else {
    return null;
  }
  return <Trail items={trail} />;
}
