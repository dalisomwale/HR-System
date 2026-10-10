import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { resolveSignIn } from './auth.service.js';
import { csrfProtection, newCsrfToken, requireAuth } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';

const promisify = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

export function authRoutes({ db, config, entra, logger }) {
  const router = Router();
  const clientUrl = (path) => new URL(path, config.clientOrigin).toString();

  const signInLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.signInRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.redirect(clientUrl('/sign-in?error=rate_limited')),
  });

  // Public: whether Microsoft sign-in is configured on this server.
  router.get('/status', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ signInAvailable: Boolean(entra) });
  });

  router.get('/login', signInLimiter, async (req, res) => {
    if (!entra) return res.redirect(clientUrl('/sign-in?error=not_configured'));
    try {
      const { url, checks } = await entra.beginSignIn();
      req.session.oidc = { ...checks, startedAt: Date.now() };
      await promisify((cb) => req.session.save(cb));
      res.redirect(url);
    } catch (err) {
      logger.error({ err }, 'Could not start Microsoft sign-in');
      res.redirect(clientUrl('/sign-in?error=unavailable'));
    }
  });

  router.get('/callback', signInLimiter, async (req, res) => {
    const checks = req.session?.oidc;
    if (!entra || !checks || Date.now() - checks.startedAt > 10 * 60 * 1000) {
      return res.redirect(clientUrl('/sign-in?error=expired'));
    }
    if (req.query.error) {
      // The person cancelled, or Entra refused (e.g. user not assigned to the app).
      return res.redirect(clientUrl('/sign-in?error=cancelled'));
    }

    let claims;
    try {
      claims = await entra.completeSignIn(req, checks);
    } catch (err) {
      req.log.warn({ err: { message: err.message, name: err.name } }, 'Microsoft sign-in validation failed');
      return res.redirect(clientUrl('/sign-in?error=failed'));
    }

    try {
      const result = await resolveSignIn(db, claims, config.entra, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.id,
      });
      // New session ID on every sign-in attempt (prevents session fixation).
      await promisify((cb) => req.session.regenerate(cb));
      if (result.status !== 'OK') {
        const reason = result.status === 'INACTIVE' ? 'inactive' : 'not_configured';
        return res.redirect(clientUrl(`/access-not-configured?reason=${reason}`));
      }
      req.session.employeeId = result.employeeId;
      req.session.signedInAt = Date.now();
      req.session.csrfToken = newCsrfToken();
      await promisify((cb) => req.session.save(cb));
      res.redirect(clientUrl('/'));
    } catch (err) {
      req.log.error({ err }, 'Sign-in could not be completed');
      res.redirect(clientUrl('/sign-in?error=failed'));
    }
  });

  // Current user, with the CSRF token the client must send on every change.
  router.get('/me', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ user: req.user, csrfToken: req.session.csrfToken });
  });

  router.post('/logout', csrfProtection, async (req, res, next) => {
    try {
      const employeeId = req.session?.employeeId;
      if (employeeId) {
        await writeAudit(db, {
          actorType: 'USER',
          actorEmployeeId: employeeId,
          action: 'SIGN_OUT',
          entityType: 'employee',
          entityId: employeeId,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          requestId: req.id,
        });
      }
      await promisify((cb) => req.session.destroy(cb));
      res.clearCookie(config.session.cookieName, { path: '/' });
      let logoutUrl = clientUrl('/signed-out');
      if (entra) {
        try {
          logoutUrl = await entra.signOutUrl(clientUrl('/signed-out'));
        } catch {
          // Local session is already ended; Microsoft sign-out page is a convenience.
        }
      }
      res.json({ logoutUrl });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
