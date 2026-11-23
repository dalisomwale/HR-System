import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb } from './helpers/db.js';

let db;
beforeAll(() => {
  db = createTestDb();
});
afterAll(() => db.destroy());

describe('leave type names (D134)', () => {
  it('calls leave after a miscarriage or stillbirth Maternal Recovery Leave, keeping its details', async () => {
    const t = await db('leave_types').where({ code: 'PREGNANCY_LOSS' }).first('name', 'description');
    expect(t.name).toBe('Maternal Recovery Leave');
    expect(t.description).toMatch(/third-trimester miscarriage or a stillbirth/);
  });
});

describe('leave without pay (D136)', () => {
  it('is switched off but kept, so past requests still read correctly', async () => {
    const t = await db('leave_types').where({ code: 'UNPAID' }).first('name', 'is_active');
    expect(t).toBeTruthy();
    expect(Boolean(t.is_active)).toBe(false);
  });
});
