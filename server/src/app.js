import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { csrfProtection, loadCurrentUser, requireAuth } from './middleware/auth.js';
import { KnexSessionStore } from './modules/auth/session-store.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { adminRoutes } from './modules/admin/index.js';
import { profileRoutes } from './modules/profile/profile.routes.js';
import { leaveRoutes, approvalRoutes, hrRoutes } from './modules/leave/leave.routes.js';
import { idempotency } from './middleware/idempotency.js';
import { REPO_ROOT } from './config/env.js';

/**
 * Build the Express application. Dependencies are passed in so tests can use the test
 * database, a silent logger and a stand-in for Microsoft's servers.
 */
export function createApp({ config, db, logger, entra = null, sessionStore }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming)
            ? incoming
            : crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // One short line per request: no headers, cookies or query values in the logs.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: (req.originalUrl ?? req.url)?.split('?')[0] }),
        res: (res) => ({ status: res.statusCode }),
      },
      customSuccessMessage: (req, res, ms) =>
        `${req.method} ${(req.originalUrl ?? req.url)?.split('?')[0]} ${res.statusCode} ${Math.round(ms)}ms`,
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'", 'https://login.microsoftonline.com'],
          'upgrade-insecure-requests': config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );

  // Liveness and database reachability. Reports nothing about configuration or data.
  app.get('/api/health', async (req, res) => {
    try {
      await db.raw('SELECT 1');
      res.set('Cache-Control', 'no-store').json({ status: 'ok', database: 'reachable' });
    } catch (err) {
      req.log.error({ err }, 'Health check: database unreachable');
      res.status(503).set('Cache-Control', 'no-store').json({ status: 'degraded', database: 'unreachable' });
    }
  });

  // Small JSON bodies everywhere except the employee import, which parses its own (2 MB).
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) =>
    req.path.startsWith('/api/admin/employees/import/') ? next() : smallJson(req, res, next),
  );

  app.use(
    '/api',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: 'draft-7', legacyHeaders: false }),
  );

  app.use(
    session({
      name: config.session.cookieName,
      secret: config.session.secret,
      store: sessionStore ?? new KnexSessionStore(db),
      resave: false,
      saveUninitialized: false,
      rolling: true, // each request extends the idle timeout
      cookie: {
        httpOnly: true,
        secure: config.session.cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: config.session.idleMinutes * 60 * 1000,
      },
    }),
  );
  app.use(loadCurrentUser({ db, config }));

  const deps = { db, config, logger, entra };
  app.use('/api/auth', authRoutes(deps));

  // Everything below needs a signed-in user and a CSRF token for changes.
  app.use('/api', requireAuth, csrfProtection, idempotency({ db }));
  app.use('/api/me/profile', profileRoutes(deps));
  app.use('/api/admin', adminRoutes(deps));
  app.use('/api/leave', leaveRoutes(deps));
  app.use('/api/approvals', approvalRoutes(deps));
  app.use('/api/hr', hrRoutes(deps));

  app.use('/api', notFoundHandler);

  // In production the built client is served by the API so both share one origin.
  const clientDist = path.join(REPO_ROOT, 'client', 'dist');
  if (config.isProduction && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
