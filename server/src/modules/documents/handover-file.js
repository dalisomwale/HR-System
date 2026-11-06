import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../utils/errors.js';
import { writeAudit } from '../audit/audit.service.js';
import { readFirstSheet } from '../admin/xlsx-read.js';

/*
 * The handover sheet (D98, D99): the Excel handover template filled in by the employee. It is the
 * only form of handover, sent with the request itself so a request is never saved without one.
 */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** An Excel workbook (.xlsx): a ZIP package whose first worksheet can actually be read. */
export function isXlsx(buf) {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  try {
    readFirstSheet(buf);
    return true;
  } catch {
    return false;
  }
}

function sheetError(message) {
  const e = new AppError(400, 'VALIDATION_FAILED', 'Some fields need attention.');
  e.fields = [{ path: 'handoverSheet', message }];
  return e;
}

export function handoverFileName(raw) {
  const n = path
    .basename(String(raw ?? '').replace(/\\/g, '/'))
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!n || n.startsWith('.')) return 'handover.xlsx';
  return /\.xlsx$/i.test(n) ? n : `${n}.xlsx`;
}

/**
 * Check an uploaded sheet ({ name, data: base64 }) and write it to storage. Returns what the
 * documents row needs; `discard()` removes the file if the request is then not saved.
 */
export async function storeHandoverSheet(dir, maxBytes, sheet) {
  if (!sheet?.data) return null;
  const buf = Buffer.from(sheet.data, 'base64');
  if (buf.length === 0) throw sheetError('Attach your handover sheet.');
  if (buf.length > maxBytes) {
    throw sheetError(`The handover sheet is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  if (!isXlsx(buf)) {
    throw sheetError('The handover sheet must be an Excel file (.xlsx). Use the handover template.');
  }
  const storedName = crypto.randomBytes(24).toString('hex');
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, storedName);
  await fs.promises.writeFile(`${target}.part`, buf, { mode: 0o600, flag: 'wx' });
  await fs.promises.rename(`${target}.part`, target);
  return {
    storedName,
    originalName: handoverFileName(sheet.name),
    sizeBytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    discard: () => fs.promises.unlink(target).catch(() => {}),
  };
}

/** Record the stored sheet on the request, replacing any earlier one. */
export async function attachHandoverSheet(trx, { requestId, actorId, file, sensitive, audit }) {
  await trx('documents')
    .where({ leave_request_id: requestId, kind: 'HANDOVER' })
    .whereNull('deleted_at')
    .update({ deleted_at: trx.fn.now(), deleted_by: actorId });
  const [docId] = await trx('documents').insert({
    leave_request_id: requestId,
    uploaded_by: actorId,
    original_name: file.originalName,
    stored_name: file.storedName,
    mime_type: XLSX_MIME,
    size_bytes: file.sizeBytes,
    sha256: file.sha256,
    kind: 'HANDOVER',
    is_medical: Boolean(sensitive),
  });
  await writeAudit(trx, {
    ...audit,
    action: 'DOCUMENT_UPLOADED',
    entityType: 'document',
    entityId: docId,
    after: {
      leaveRequestId: requestId,
      kind: 'HANDOVER',
      name: file.originalName,
      type: XLSX_MIME,
      sizeBytes: file.sizeBytes,
    },
  });
  return docId;
}
