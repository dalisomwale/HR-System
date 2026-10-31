import { inflateRawSync } from 'node:zlib';
import { badRequest } from '../../utils/errors.js';

/*
 * Reads the first worksheet of an Excel (.xlsx) file into rows of text, so an import can be
 * uploaded as Excel as well as CSV (D78). No dependency: an .xlsx file is a ZIP of XML parts,
 * and Node's zlib inflates them. Limits guard against oversized or malicious files.
 */

const MAX_PART_BYTES = 30 * 1024 * 1024; // any one XML part, uncompressed
const MAX_TOTAL_BYTES = 60 * 1024 * 1024; // all parts read, uncompressed

function unreadable() {
  return badRequest('The file could not be read as an Excel workbook (.xlsx). Save it as .xlsx or CSV.');
}

/** Map of entry name -> Buffer for the parts we need, read from the ZIP central directory. */
function unzip(buf, wanted) {
  // End of central directory: signature 0x06054b50 within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let total = 0;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw unreadable();
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (size > MAX_PART_BYTES) throw badRequest('The Excel file is too large to import.');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw unreadable();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    let content;
    try {
      if (method === 0) content = Buffer.from(data);
      else if (method === 8) content = inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
      else throw unreadable();
    } catch (err) {
      if (err.status) throw err;
      throw unreadable();
    }
    total += content.length;
    if (total > MAX_TOTAL_BYTES) throw badRequest('The Excel file is too large to import.');
    out.set(name, content.toString('utf8'));
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text of an <si> or <is> element: every <t>, ignoring phonetic runs. */
function textOf(fragment) {
  const noPhonetic = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let text = '';
  for (const m of noPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += m[1];
  return unescapeXml(text);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unescapeXml(m[1]) : null;
}

/** "BC12" -> 54 (0-based column index). */
function columnIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Rows of the first worksheet as arrays of strings (formula cells give their last result).
 * Numbers stay as Excel shows them in raw form; dates arrive as serial numbers.
 */
export function readFirstSheet(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw unreadable();
  const parts = unzip(
    buffer,
    (n) =>
      n === 'xl/workbook.xml' ||
      n === 'xl/_rels/workbook.xml.rels' ||
      n === 'xl/sharedStrings.xml' ||
      n.startsWith('xl/worksheets/sheet'),
  );
  const workbook = parts.get('xl/workbook.xml');
  if (!workbook) throw unreadable();

  // The first sheet in the workbook's order, through its relationship.
  const firstSheet = workbook.match(/<sheet\b[^>]*>/);
  const relId = firstSheet && (attr(firstSheet[0], 'r:id') ?? attr(firstSheet[0], 'id'));
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rels = parts.get('xl/_rels/workbook.xml.rels');
  if (relId && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], 'Id') === relId) {
        const target = attr(m[0], 'Target') ?? '';
        sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      }
    }
  }
  const sheet = parts.get(sheetPath);
  if (!sheet) throw unreadable();

  const shared = [];
  const sst = parts.get('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    const body = rowMatch[1] ?? '';
    for (const cell of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${cell[1]}>`;
      const inner = cell[2] ?? '';
      const ref = attr(tag, 'r');
      const index = ref ? columnIndex(ref) : row.length;
      const type = attr(tag, 't');
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = unescapeXml(v);
      if (index >= 0 && index < 200) row[index] = value;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

/** Excel's date serial (1900 system) to YYYY-MM-DD. */
export function serialToIsoDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  // Day 60 is Excel's non-existent 29 Feb 1900; serials from 61 are one day ahead.
  const days = Math.floor(n) - (n >= 61 ? 1 : 0);
  const ms = Date.UTC(1899, 11, 31) + days * 864e5;
  return new Date(ms).toISOString().slice(0, 10);
}

/** CSV text from rows, quoting every value so commas, quotes and line breaks survive. */
export function rowsToCsv(rows) {
  return rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

const DATE_COLUMNS = new Set(['employment_start_date', 'employment_end_date']);

/**
 * An uploaded Excel import as CSV text for the same checks as a CSV upload. Dates typed as
 * dates in Excel arrive as serial numbers and become YYYY-MM-DD; empty rows are dropped.
 */
export function xlsxImportToCsv(buffer) {
  const rows = readFirstSheet(buffer).filter((r) => r.some((v) => String(v).trim() !== ''));
  if (rows.length === 0) throw badRequest('The first sheet of the workbook is empty.');
  const header = rows[0].map((h) =>
    String(h)
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_'),
  );
  const dateCols = header.map((h) => DATE_COLUMNS.has(h));
  const body = rows.slice(1).map((r) =>
    header.map((_, i) => {
      const v = String(r[i] ?? '').trim();
      return dateCols[i] && /^\d+(\.\d+)?$/.test(v) ? (serialToIsoDate(v) ?? v) : v;
    }),
  );
  return rowsToCsv([rows[0].map((h) => String(h).trim()), ...body]);
}
