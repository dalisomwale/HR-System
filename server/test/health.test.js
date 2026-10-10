import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config/env.js';
import { createTestDb } from './helpers/db.js';

let db;
let app;
beforeAll(() => {
  db = createTestDb();
  app = createApp({ config: getConfig(), db, logger: pino({ level: 'silent' }) });
});
afterAll(() => db.destroy());

describe('API foundation', () => {
  it('reports health without exposing configuration', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'reachable' });
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('returns structured 404s for unknown API routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 503 when the database is unreachable', async () => {
    const brokenDb = { raw: () => Promise.reject(new Error('down')) };
    const brokenApp = createApp({ config: getConfig(), db: brokenDb, logger: pino({ level: 'silent' }) });
    const res = await request(brokenApp).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.database).toBe('unreachable');
  });
});
