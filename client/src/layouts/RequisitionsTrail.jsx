import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Trail } from './LeaveTrail.jsx';

/* Where you are in Requisitions (D105): Requisitions › Stock › A4 paper ream. */

const ROOT = { label: 'Requisitions', to: '/requisitions' };
const PAGES = {
  '/requisitions': ['Home'],
  '/requisitions/requests': ['Requisitions'],
  '/requisitions/requests/new': ['Requisitions', 'Raise a requisition'],
  '/requisitions/stock': ['Stock'],
  '/requisitions/stock/new': ['Stock', 'Add item'],
  '/requisitions/receive': ['Receive stock'],
  '/requisitions/issue': ['Issue stock'],
  '/requisitions/transactions': ['Transactions'],
  '/requisitions/reports': ['Monthly reports'],
  '/requisitions/categories': ['Categories'],
  '/requisitions/branches': ['Branches'],
  '/requisitions/settings': ['Requisition departments'],
};
const PARENT = { Requisitions: '/requisitions/requests', Stock: '/requisitions/stock' };

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
    trail.push({ label: 'Stock', to: PARENT.Stock });
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
