import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

/**
 * Build the Express application. Dependencies are passed in so tests can use the test
 * database and a silent logger.
 */
export function createApp({ config, db, logger }) {
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
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );

  app.use(express.json({ limit: '100kb' }));

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

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
