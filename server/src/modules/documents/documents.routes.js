import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler, idParam } from '../../utils/validation.js';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors.js';
import { REPO_ROOT } from '../../config/env.js';
import { managerAuthority } from '../leave/requests.service.js';
import { seesWholeGroup } from '../../middleware/auth.js';

const MAX_PER_REQUEST = 10;
const CLOSED_STATES = ['WITHDRAWN', 'REJECTED_BY_MANAGER', 'REJECTED_BY_HR', 'CANCELLED'];

/** File type from its first bytes. The declared type and file name are never trusted. */
export function sniffType(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return 'image/png';
  return null;
}

/** Keep a readable, harmless file name for display and download. */
function cleanName(raw, mime) {
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
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mime];
  if (!n || n.startsWith('.')) n = `document${ext}`;
  if (!/\.(pdf|jpe?g|png)$/i.test(n)) n += ext;
  return n;
}

export function storageDir(config) {
  return (
    config.documents.storageDir ||
    path.join(REPO_ROOT, 'storage', config.isTest ? 'documents-test' : 'documents')
  );
}

/** Who may see a request's documents, and whether they may see medical ones. */
async function access(db, viewer, requestId) {
  const r = await db('leave_requests as r')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .where('r.id', requestId)
    .first('r.*', 't.is_confidential', 't.name as type_name');
  if (!r) throw notFound('Leave request not found.');
  const isOwner = r.employee_id === viewer.id;
  const isHr = viewer.roles.includes('HR_OFFICER');
  const authority = await managerAuthority(db, viewer, r);
  const wasManager = r.assigned_manager_id === viewer.id;
  const isDirector = seesWholeGroup(viewer);
  if (!isOwner && !isHr && !isDirector && !authority && !wasManager) {
    throw notFound('Leave request not found.');
  }
  // Directors, like managers, never see medical documents.
  return { r, isOwner, isHr, seesMedical: isOwner || isHr };
}

function docView(d, seesMedical) {
  const restricted = d.is_medical && !seesMedical;
  return {
    id: d.id,
    name: restricted ? null : d.original_name,
    type: restricted ? null : d.mime_type,
    sizeBytes: restricted ? null : d.size_bytes,
    medical: Boolean(d.is_medical),
    restricted,
    uploadedBy: `${d.first_name} ${d.last_name}`,
    uploadedAt: d.created_at,
  };
}

export async function listDocuments(db, requestId, seesMedical) {
  const rows = await db('documents as d')
    .join('employees as e', 'e.id', 'd.uploaded_by')
    .where('d.leave_request_id', requestId)
    .whereNull('d.deleted_at')
    .orderBy('d.id')
    .select('d.*', 'e.first_name', 'e.last_name');
  return rows.map((d) => docView(d, seesMedical));
}

export function documentRoutes({ db, config, logger }) {
  const router = Router();
  const dir = storageDir(config);
  const maxBytes = config.documents.maxBytes;

  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `doc-${req.user.id}`,
    handler: (req, res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many uploads. Wait a few minutes and try again.')),
  });
  // The body is the file itself; the browser sends its name in a header.
  const rawBody = express.raw({ type: () => true, limit: maxBytes });

  router.get(
    '/requests/:id',
    asyncHandler(async (req, res) => {
      const { seesMedical } = await access(db, req.user, idParam(req));
      res.json({ items: await listDocuments(db, idParam(req), seesMedical), maxBytes });
    }),
  );

  router.post(
    '/requests/:id',
    uploadLimiter,
    (req, res, next) =>
      rawBody(req, res, (err) => {
        if (err?.type === 'entity.too.large') {
          return next(
            new AppError(
              413,
              'FILE_TOO_LARGE',
              `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`,
            ),
          );
        }
        next(err);
      }),
    asyncHandler(async (req, res) => {
      const requestId = idParam(req);
      const { r, isOwner, isHr } = await access(db, req.user, requestId);
      if (!isOwner && !isHr) throw notFound('Leave request not found.');
      if (CLOSED_STATES.includes(r.status)) throw conflict('Documents cannot be added to a closed request.');
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length === 0) throw badRequest('Choose a file to upload.');
      const mime = sniffType(buf);
      if (!mime) throw badRequest('Only PDF, JPEG and PNG files can be uploaded.');

      const storedName = crypto.randomBytes(24).toString('hex');
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const originalName = cleanName(req.get('x-file-name'), mime);
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      const target = path.join(dir, storedName);
      const temp = `${target}.part`;
      await fs.promises.writeFile(temp, buf, { mode: 0o600, flag: 'wx' });
      await fs.promises.rename(temp, target);

      try {
        const id = await db.transaction(async (trx) => {
          await trx('leave_requests').where({ id: requestId }).forUpdate().first('id');
          const count = await trx('documents')
            .where({ leave_request_id: requestId })
            .whereNull('deleted_at')
            .count({ n: '*' })
            .first();
          if (Number(count.n) >= MAX_PER_REQUEST) {
            throw conflict(`A request can have at most ${MAX_PER_REQUEST} documents.`);
          }
          const [docId] = await trx('documents').insert({
            leave_request_id: requestId,
            uploaded_by: req.user.id,
            original_name: originalName,
            stored_name: storedName,
            mime_type: mime,
            size_bytes: buf.length,
            sha256,
            is_medical: Boolean(r.is_confidential),
          });
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'DOCUMENT_UPLOADED',
            entityType: 'document',
            entityId: docId,
            after: { leaveRequestId: requestId, name: originalName, type: mime, sizeBytes: buf.length },
          });
          return docId;
        });
        res.status(201).json({ id });
      } catch (err) {
        await fs.promises.unlink(target).catch(() => {});
        throw err;
      }
    }),
  );

  router.get(
    '/:id/download',
    asyncHandler(async (req, res) => {
      const d = await db('documents')
        .where({ id: idParam(req) })
        .whereNull('deleted_at')
        .first();
      if (!d) throw notFound('Document not found.');
      const { seesMedical } = await access(db, req.user, d.leave_request_id);
      if (d.is_medical && !seesMedical) throw notFound('Document not found.');
      const file = path.join(dir, d.stored_name);
      let data;
      try {
        data = await fs.promises.readFile(file);
      } catch (err) {
        logger?.error({ err, documentId: d.id }, 'Stored document is missing');
        throw new AppError(410, 'DOCUMENT_MISSING', 'The stored file could not be found. Contact IT.');
      }
      await writeAudit(db, {
        ...auditContext(req),
        action: 'DOCUMENT_DOWNLOADED',
        entityType: 'document',
        entityId: d.id,
        after: { leaveRequestId: d.leave_request_id, medical: Boolean(d.is_medical) },
      });
      const ascii = d.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      res
        .set({
          'Content-Type': d.mime_type,
          'Content-Length': data.length,
          'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.original_name)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(data);
    }),
  );

  // Removing hides the document; the file and audit trail are kept.
  router.post(
    '/:id/remove',
    asyncHandler(async (req, res) => {
      const d = await db('documents')
        .where({ id: idParam(req) })
        .whereNull('deleted_at')
        .first();
      if (!d) throw notFound('Document not found.');
      const { r, isOwner, isHr, seesMedical } = await access(db, req.user, d.leave_request_id);
      if (d.is_medical && !seesMedical) throw notFound('Document not found.');
      const ownUpload = isOwner && d.uploaded_by === req.user.id;
      if (!isHr && !ownUpload) throw notFound('Document not found.');
      if (
        !isHr &&
        !['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL', 'RETURNED_FOR_CORRECTION'].includes(r.status)
      ) {
        throw conflict('Documents can only be removed while the request is waiting for a decision. Ask HR.');
      }
      await db.transaction(async (trx) => {
        await trx('documents')
          .where({ id: d.id })
          .update({ deleted_at: trx.fn.now(), deleted_by: req.user.id });
        await writeAudit(trx, {
          ...auditContext(req),
          action: 'DOCUMENT_REMOVED',
          entityType: 'document',
          entityId: d.id,
          before: { leaveRequestId: d.leave_request_id, name: d.original_name },
        });
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
