import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sniffType, storageDir } from '../documents/documents.routes.js';

/*
 * Candidates' CVs and other documents (D114). Stored like leave documents: a random file name in
 * the documents folder, never the name the file came with, and the type read from the file's
 * own content. CVs also come as Word documents, so .docx is accepted here as well as PDF, JPEG
 * and PNG.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', [DOCX_MIME]: '.docx' };

/** A Word document (.docx): a ZIP package holding word/document.xml. */
export function isDocx(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  return buf.includes(Buffer.from('word/document.xml', 'latin1'));
}

export const candidateFileType = (buf) => sniffType(buf) ?? (isDocx(buf) ? DOCX_MIME : null);

export function cleanFileName(raw, mime) {
  let n = '';
  try {
    n = decodeURIComponent(String(raw ?? ''));
  } catch {
    n = '';
  }
  n = path
    .basename(n.replace(/\\/g, '/'))
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const ext = EXT[mime];
  if (!n || n.startsWith('.')) n = `document${ext}`;
  if (!n.toLowerCase().endsWith(ext) && !(ext === '.jpg' && /\.jpe?g$/i.test(n))) n += ext;
  return n;
}

/** Write the file under a random name; returns what to record. Throws nothing about content. */
export async function storeFile(config, buf, mime, rawName) {
  const dir = storageDir(config);
  const storedName = crypto.randomBytes(24).toString('hex');
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, storedName);
  await fs.promises.writeFile(`${target}.part`, buf, { mode: 0o600, flag: 'wx' });
  await fs.promises.rename(`${target}.part`, target);
  return {
    storedName,
    target,
    originalName: cleanFileName(rawName, mime),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

export const readStored = (config, storedName) =>
  fs.promises.readFile(path.join(storageDir(config), storedName));
