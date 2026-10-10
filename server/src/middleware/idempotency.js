import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
import { getSetting } from '../modules/leave/policy.service.js';

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * Optional Idempotency-Key support for state-changing requests. The first request with a key
 * runs normally and its response is stored; a repeat with the same key and body gets the
 * stored response without running again. Same key with a different body is refused.
 */
export function idempotency({ db }) {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!key || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.user) return next();
    if (!KEY_RE.test(key))
      return next(new AppError(400, 'BAD_IDEMPOTENCY_KEY', 'Invalid Idempotency-Key header.'));

    const path = req.originalUrl.split('?')[0];
    const hash = crypto
      .createHash('sha256')
      .update(`${req.method} ${path} ${JSON.stringify(req.body ?? {})}`)
      .digest('hex');
    try {
      const existing = await db('idempotency_keys')
        .where({ employee_id: req.user.id, idempotency_key: key })
        .first();
      if (existing) {
        if (existing.request_hash !== hash) {
          return next(
            new AppError(
              422,
              'IDEMPOTENCY_KEY_REUSED',
              'This request key was already used for a different action.',
            ),
          );
        }
        if (existing.response_status == null) {
          return next(new AppError(409, 'IN_PROGRESS', 'This action is already being processed.'));
        }
        res.set('Idempotent-Replay', 'true');
        const body =
          typeof existing.response_body === 'string'
            ? JSON.parse(existing.response_body)
            : existing.response_body;
        return res.status(existing.response_status).json(body);
      }
      const ttl = Number(await getSetting(db, 'idempotency_ttl_hours', 24)) || 24;
      await db('idempotency_keys').insert({
        employee_id: req.user.id,
        idempotency_key: key,
        method: req.method,
        path: path.slice(0, 255),
        request_hash: hash,
        expires_at: new Date(Date.now() + ttl * 3600 * 1000),
      });
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY')
        return next(new AppError(409, 'IN_PROGRESS', 'This action is already being processed.'));
      return next(err);
    }

    const json = res.json.bind(res);
    res.json = (body) => {
      const done =
        res.statusCode < 500
          ? db('idempotency_keys')
              .where({ employee_id: req.user.id, idempotency_key: key })
              .update({ response_status: res.statusCode, response_body: JSON.stringify(body ?? null) })
          : db('idempotency_keys').where({ employee_id: req.user.id, idempotency_key: key }).del();
      done
        .catch((err) => req.log?.error({ err }, 'Could not store idempotent response'))
        .finally(() => json(body));
      return res;
    };
    next();
  };
}
