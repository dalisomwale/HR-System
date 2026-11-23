import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

/* Shared by the AMS cash and float pages (D117). */

export const useFloat = () =>
  useQuery({ queryKey: ['float-me'], queryFn: () => api.get('/api/float/me'), staleTime: 20_000 });

const k2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => `K${k2.format(Number(n) || 0)}`;
export const signed = (n) =>
  `${Number(n) > 0 ? '+' : Number(n) < 0 ? '−' : ''}${money(Math.abs(Number(n) || 0))}`;

export const ACCOUNT = { CASH: 'Cash', AIRTEL: 'Airtel Money', MTN: 'MTN MoMo' };
export const NETWORK = { AIRTEL: 'Airtel Money', MTN: 'MTN MoMo' };
export const NETWORK_TONE = { AIRTEL: 'danger', MTN: 'pending' };
export const KIND = { DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal' };
export const TXN_STATUS = {
  POSTED: ['Recorded', 'ok'],
  REVERSAL_PENDING: ['Reversal Asked', 'pending'],
  REVERSED: ['Reversed', 'neutral'],
};
export const VARIANCE_STATUS = {
  OPEN: ['To Resolve', 'pending'],
  PENDING_DIRECTOR: ['With The Director', 'pending'],
  EXPLAINED: ['Explained', 'ok'],
  RECOVERED: ['Recovered', 'ok'],
  WRITTEN_OFF: ['Written Off', 'neutral'],
};
export const DAYS = [
  ['MON', 'Monday'],
  ['TUE', 'Tuesday'],
  ['WED', 'Wednesday'],
  ['THU', 'Thursday'],
  ['FRI', 'Friday'],
  ['SAT', 'Saturday'],
  ['SUN', 'Sunday'],
];
/** Kwacha notes and coins, for counting cash at close. */
export const DENOMINATIONS = [100, 50, 20, 10, 5, 2, 1, 0.5];

export const timeOf = (v) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lusaka' }).format(
    new Date(v),
  );

/**
 * The branch someone who works across branches (Operations Officer, manager, System Admin) has
 * chosen, remembered on this device (D122). Branch staff always work at their own branch.
 */
const KEY = 'ams-branch';
export function useWorkingBranch() {
  const [id, setId] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });
  const choose = (v) => {
    setId(String(v ?? ''));
    try {
      if (v) window.localStorage.setItem(KEY, String(v));
      else window.localStorage.removeItem(KEY);
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  };
  return [id, choose];
}
