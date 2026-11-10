/*
 * Period filter and Excel export for every table (project owner, 10 Nov 2026), as on the
 * inventory system: a funnel button with a menu of periods ending today, and "Export to Excel".
 */
import { xlsxBlob } from './xlsx.js';

export const PERIODS = [
  ['all', 'All time'],
  ['day', 'Today'],
  ['7d', 'Last 7 days'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['3m', 'Last 3 months'],
  ['6m', 'Last 6 months'],
  ['12m', 'Last 12 months'],
];

const iso = (d) => d.toISOString().slice(0, 10);
/** Today in Lusaka, as a UTC-midnight Date. */
function today() {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka' }).format(new Date());
  return new Date(`${s}T00:00:00Z`);
}
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
function addMonths(d, n) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

/** First and last day ('YYYY-MM-DD') of a period ending today; null for all time. */
export function periodRange(key) {
  const t = today();
  const from = {
    day: t,
    '7d': addDays(t, -6),
    week: addDays(t, -((t.getUTCDay() + 6) % 7)), // Monday
    month: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)),
    '3m': addDays(addMonths(t, -3), 1),
    '6m': addDays(addMonths(t, -6), 1),
    '12m': addDays(addMonths(t, -12), 1),
  }[key];
  return from ? [iso(from), iso(t)] : null;
}

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const DMY = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]* (\d{4})\b/i;
const ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;

/** The first date in a piece of text, as 'YYYY-MM-DD' (10 Nov 2026, or 2026-11-10). */
export function dateIn(text) {
  const m = DMY.exec(text);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    return `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const i = ISO.exec(text);
  return i ? `${i[1]}-${i[2]}-${i[3]}` : null;
}

const cellText = (el) => (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The headings of a table; empty for columns with no visible heading (action buttons). */
export function headings(table) {
  return [...table.querySelectorAll('thead th')].map((th) => {
    const sr = th.querySelector('.sr-only');
    const t = cellText(th);
    return sr && t === cellText(sr) ? '' : t;
  });
}

/** Each body row's cells, placed under their column (colspan rows are left out). */
function bodyRows(table) {
  return [...table.querySelectorAll('tbody > tr')].filter(
    (tr) => ![...tr.children].some((c) => Number(c.getAttribute('colspan') ?? 1) > 1),
  );
}

/**
 * Each row's date: its data-date, or the first column where most rows show a date.
 * Returns a Map of row → 'YYYY-MM-DD' (rows without one are absent); empty when the table has
 * no dates.
 */
export function rowDates(table) {
  const rows = bodyRows(table);
  const out = new Map();
  if (rows.some((tr) => tr.dataset.date)) {
    for (const tr of rows) {
      const d = tr.dataset.date ? dateIn(String(tr.dataset.date)) : null;
      if (d) out.set(tr, d);
    }
    return out;
  }
  const heads = headings(table);
  for (let col = 0; col < heads.length; col += 1) {
    if (!heads[col]) continue;
    const found = rows.map((tr) => dateIn(cellText(tr.children[col])));
    const hits = found.filter(Boolean).length;
    if (rows.length && hits / rows.length >= 0.5) {
      rows.forEach((tr, i) => found[i] && out.set(tr, found[i]));
      return out;
    }
  }
  return out;
}

const NUMBER = /^-?K?\s?\d{1,3}(,\d{3})*(\.\d+)?$|^-?K?\s?\d+(\.\d+)?$/;
function cellValue(text) {
  if (!text || text === '—') return { t: 'text', v: '' };
  // Codes with leading zeros (employee numbers) stay text.
  if (NUMBER.test(text) && !/^0\d/.test(text)) return { t: 'number', v: Number(text.replace(/[K,\s]/g, '')) };
  const d = dateIn(text);
  if (
    d &&
    text
      .replace(DMY, '')
      .replace(ISO, '')
      .replace(/[,\s:0-9]/g, '') === ''
  )
    return { t: 'date', v: d };
  return { t: 'text', v: text };
}

/** Download what the table shows now (visible rows, columns with headings) as an Excel file. */
export function exportTable(table, name) {
  const heads = headings(table);
  const keep = heads.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
  const rows = bodyRows(table)
    .filter((tr) => !tr.hidden)
    .map((tr) => keep.map((i) => cellValue(cellText(tr.children[i]))));
  const title = (name || document.querySelector('main h1')?.textContent || 'Export').trim();
  const blob = xlsxBlob(
    keep.map((i) => heads[i]),
    rows,
    title,
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()} ${iso(today())}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
