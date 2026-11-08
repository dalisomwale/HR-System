import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

/** What the signed-in person can do in Requisitions (D105); the server decides, this only shows. */
export function useRq() {
  return useQuery({ queryKey: ['rq-me'], queryFn: () => api.get('/api/requisitions/me'), retry: false });
}

export const STATUS_TONES = {
  QUOTES_IT: 'pending',
  QUOTES_DEPT: 'pending',
  RETURNED: 'danger',
  DIRECTOR: 'pending',
  ACCOUNTS: 'pending',
  ACCOUNTS_MANAGER: 'pending',
  CFO: 'pending',
  PAY: 'brand',
  PAID: 'brand',
  RECEIVED: 'ok',
  CANCELLED: 'neutral',
};

/** Steps on the tracker, in order, and which one each status sits on. */
export const STEPS = [
  ['RAISED', 'Raised'],
  ['QUOTES', 'Quotations'],
  ['DIRECTOR', 'Director'],
  ['ACCOUNTS', 'Accounts'],
  ['ACCOUNTS_MANAGER', 'Accounts Manager'],
  ['CFO', 'CFO'],
  ['PAY', 'Payment'],
  ['RECEIVED', 'Received'],
];
export function stepOf(status) {
  if (['QUOTES_IT', 'QUOTES_DEPT', 'RETURNED'].includes(status)) return 'QUOTES';
  if (status === 'PAID') return 'RECEIVED';
  if (status === 'CANCELLED') return 'RAISED';
  return status;
}

const k2 = new Intl.NumberFormat('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const k0 = new Intl.NumberFormat('en-ZM', { maximumFractionDigits: 0 });
export const kwacha = (n) => `K${k2.format(Number(n) || 0)}`;
export const kwachaWhole = (n) => `K${k0.format(Math.round(Number(n) || 0))}`;
/** Short form for headline figures: K1.2m, K45k. */
export function kwachaShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `K${(v / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
  if (Math.abs(v) >= 1e4) return `K${Math.round(v / 1e3)}k`;
  return kwachaWhole(v);
}
export const units = (n) => Number(n || 0).toLocaleString('en-GB');
export const fileSize = (b) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/** A timestamp's calendar date in Lusaka, as YYYY-MM-DD. */
export function lusakaDate(value) {
  if (!value) return '';
  const d = new Date(
    typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? `${value.replace(' ', 'T')}Z` : value,
  );
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka' }).format(d);
}

export const today = () => lusakaDate(new Date());

export const STATE_LABELS = { ok: 'In stock', low: 'Below reorder', out: 'Out of stock' };
export const STATE_TONES = { ok: 'ok', low: 'pending', out: 'danger' };

export function daysLeftLabel(days, qty) {
  if (qty <= 0) return 'Out of stock';
  if (days === null || days === undefined) return 'Not used lately';
  if (days === 0) return 'Less than a day';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

const FIELD_LABELS = {
  name: 'Item name',
  itemName: 'Item',
  categoryId: 'Category',
  branchId: 'Branch',
  companyId: 'Company',
  departmentId: 'Department',
  supplier: 'Supplier',
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  reorderLevel: 'Reorder level',
  dateReceived: 'Date received',
  dateIssued: 'Date issued',
  recipient: 'Person receiving',
  reason: 'Reason',
  description: 'Description',
  location: 'Location',
};

/** The server's message, with the first field problem spelt out. */
export function errorText(err) {
  const f = err?.fields?.[0];
  if (!f) return err?.message ?? 'Something went wrong.';
  const key = String(f.path).split('.').pop();
  return `${FIELD_LABELS[key] ?? key}: ${f.message}`;
}
