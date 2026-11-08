import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { badRequest } from '../../utils/errors.js';
import { storageDir } from '../documents/documents.routes.js';
import { sniffType } from '../documents/documents.routes.js';

/*
 * Quotations, supporting documents and proofs of payment (D105): PDF, JPEG, PNG, Word or Excel,
 * up to 10 MB, as in the inventory system. The content must match the file's extension.
 */

export const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const VIEWABLE = ['application/pdf', 'image/jpeg', 'image/png'];

const isZip = (b) => b.length >= 4 && b.readUInt32LE(0) === 0x04034b50;
const isOle = (b) => b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1;

export function requisitionFilesDir(config) {
  // A folder of its own inside the documents storage, so backups of one cover both.
  return path.join(storageDir(config), 'requisitions');
}

export function cleanFileName(raw) {
  let n = '';
  try {
    n = decodeURIComponent(String(raw ?? ''));
  } catch {
    n = '';
  }
  return path
    .basename(n.replace(/\\/g, '/'))
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Check an uploaded file; returns { name, mime }. */
export function checkFile(buf, rawName) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('Choose a file to attach.');
  if (buf.length > MAX_BYTES) throw badRequest('The file is too big. The limit is 10 MB.');
  const name = cleanFileName(rawName);
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const mime = TYPES[ext];
  if (!mime) throw badRequest('Attach a PDF, image (JPG or PNG), Word or Excel file.');
  const sniffed = sniffType(buf);
  const ok = {
    pdf: sniffed === 'application/pdf',
    jpg: sniffed === 'image/jpeg',
    jpeg: sniffed === 'image/jpeg',
    png: sniffed === 'image/png',
    doc: isOle(buf),
    xls: isOle(buf),
    docx: isZip(buf),
    xlsx: isZip(buf),
  }[ext];
  if (!ok) throw badRequest(`That file doesn't look like a real .${ext} file.`);
  return { name, mime, ext };
}

/** Write the file to storage; returns the stored name and a function to remove it again. */
export async function storeFile(config, buf, ext) {
  const dir = requisitionFilesDir(config);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const stored = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const target = path.join(dir, stored);
  await fs.promises.writeFile(target, buf, { mode: 0o600, flag: 'wx' });
  return { stored, discard: () => fs.promises.unlink(target).catch(() => {}) };
}

export function filePath(config, stored) {
  return path.join(requisitionFilesDir(config), path.basename(stored));
}
