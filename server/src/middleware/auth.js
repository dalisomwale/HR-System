import crypto from 'node:crypto';
import { loadUser } from '../modules/auth/auth.service.js';
import { forbidden, unauthorised, AppError } from '../utils/errors.js';

/**
 * Attach req.user for signed-in sessions. The employee and roles are re-read on every request,
 * so deactivation or a role change takes effect immediately.
 */
export function loadCurrentUser({ db, config }) {
  const absoluteMs = config.session.absoluteHours * 3600 * 1000;
  return async (req, res, next) => {
    try {
      const s = req.session;
      if (!s?.employeeId) return next();
      if (!s.signedInAt || Date.now() - s.signedInAt > absoluteMs) {
        return s.destroy(() => next());
      }
      const user = await loadUser(db, s.employeeId);
      if (!user) return s.destroy(() => next());
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorised());
  next();
}

/** Allow if the user holds any of the given application roles. */
export function requireRole(...codes) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorised());
    if (!codes.some((c) => req.user.roles.includes(c))) return next(forbidden());
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Synchroniser-token CSRF protection for every state-changing request. */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session?.csrfToken;
  const provided = req.get('x-csrf-token');
  if (
    !expected ||
    !provided ||
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  ) {
    return next(
      new AppError(403, 'CSRF_FAILED', 'Your session has expired. Refresh the page and try again.'),
    );
  }
  next();
}

export function newCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Audit context for the current request. */
export function auditContext(req) {
  return {
    actorType: 'USER',
    actorEmployeeId: req.user?.id ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    requestId: req.id ?? null,
  };
}
