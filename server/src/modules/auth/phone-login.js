import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { csrfProtection, newCsrfToken, requireAuth } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { normalisePhone } from '../../utils/phone.js';
import { AppError, badRequest } from '../../utils/errors.js';

/*
 * Phone sign-in for AMS branch staff (D119). Only active Altus Money Solutions employees posted
 * to an AMS branch, whose phone sign-in the System Admin has set up, can use it; everyone else
 * signs in with Microsoft.
 *
 *   First time   phone number + the one-time code from the System Admin (8 digits, 72 hours),
 *                then they choose their own 6-digit PIN
 *   After that   phone number + PIN
 *   5 wrong      the account locks until the System Admin gives a new code
 *
 * PINs and codes are stored only as salted scrypt hashes and compared in constant time.
 */

export const MAX_ATTEMPTS = 5;
export const CODE_HOURS = 72;
const SETUP_MINUTES = 10;

const scrypt = (secret, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(secret, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
export async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(String(secret), salt)).toString('hex')}`;
}
export async function checkSecret(secret, stored) {
  const [kind, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) {
    await scrypt(String(secret), Buffer.alloc(16)); // same work either way
    return false;
  }
  const got = await scrypt(String(secret), Buffer.from(salt, 'hex'));
  const want = Buffer.from(hash, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

/** An 8-digit one-time code. */
export const newCode = () => String(crypto.randomInt(0, 100000000)).padStart(8, '0');

/** A PIN people can remember but others cannot easily guess. */
export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, 'must be 6 digits')
  .refine((p) => !/^(\d)\1{5}$/.test(p), 'cannot be the same digit six times')
  .refine(
    (p) =>
      ![
        '012345',
        '123456',
        '234567',
        '345678',
        '456789',
        '987654',
        '876543',
        '765432',
        '654321',
        '543210',
      ].includes(p),
    'cannot be a run of digits like 123456',
  );

/** Is this employee AMS branch staff (and so allowed to sign in with a phone number)? */
export async function isAmsBranchStaff(db, employeeId) {
  const s = await db('float_settings').where({ id: 1 }).first('company_id');
  if (!s?.company_id) return false;
  return Boolean(
    await db('employees as e')
      .join('stock_branches as b', 'b.id', 'e.branch_id')
      .where({
        'e.id': employeeId,
        'e.status': 'ACTIVE',
        'e.company_id': s.company_id,
        'b.company_id': s.company_id,
        'b.is_active': true,
      })
      .first('e.id'),
  );
}

const promisify = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));
const wrong = () => new AppError(401, 'SIGN_IN_FAILED', 'The phone number or PIN is not right.');

export function phoneLoginRoutes({ db, config }) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.signInRateLimit ?? 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) =>
      res
        .status(429)
        .json({ error: { code: 'RATE_LIMITED', message: 'Too many tries. Wait 15 minutes and try again.' } }),
  });
  // JSON only: a form on another site cannot post here.
  const jsonOnly = (req, res, next) =>
    req.is('application/json') ? next() : next(badRequest('Send the details as JSON.'));
  const audit = (req, action, employeeId, after) =>
    writeAudit(db, {
      actorType: employeeId ? 'USER' : 'SYSTEM',
      actorEmployeeId: employeeId ?? null,
      action,
      entityType: 'employee',
      entityId: employeeId ?? null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
      after,
    });
  async function startSession(req, employeeId) {
    await promisify((cb) => req.session.regenerate(cb));
    req.session.employeeId = employeeId;
    req.session.signedInAt = Date.now();
    req.session.csrfToken = newCsrfToken();
    req.session.authMethod = 'PHONE';
    await promisify((cb) => req.session.save(cb));
    await db('phone_logins')
      .where({ employee_id: employeeId })
      .update({ failed_attempts: 0, last_sign_in_at: db.fn.now() });
    await audit(req, 'SIGN_IN', employeeId, { method: 'phone' });
  }

  const loginSchema = z.object({ phone: z.string().max(40), pin: z.string().max(20) });
  router.post('/login', limiter, jsonOnly, async (req, res, next) => {
    try {
      const { phone, pin } = loginSchema.parse(req.body ?? {});
      const e164 = normalisePhone(phone);
      const emp = e164 ? await db('employees').where({ phone_e164: e164 }).first('id') : null;
      const acct = emp ? await db('phone_logins').where({ employee_id: emp.id }).first() : null;
      if (!emp || !acct || !(await isAmsBranchStaff(db, emp.id))) {
        await checkSecret(pin, null);
        throw wrong();
      }
      if (acct.locked_at) {
        throw new AppError(
          423,
          'LOCKED',
          'Phone sign-in is locked after too many wrong tries. Ask your System Administrator for a new code.',
        );
      }
      const firstTime = !acct.pin_hash;
      const ok = firstTime
        ? Boolean(acct.code_hash) &&
          new Date(acct.code_expires_at) > new Date() &&
          (await checkSecret(pin, acct.code_hash))
        : await checkSecret(pin, acct.pin_hash);
      if (!ok) {
        const attempts = acct.failed_attempts + 1;
        await db('phone_logins')
          .where({ employee_id: emp.id })
          .update({ failed_attempts: attempts, locked_at: attempts >= MAX_ATTEMPTS ? db.fn.now() : null });
        await audit(req, attempts >= MAX_ATTEMPTS ? 'PHONE_SIGN_IN_LOCKED' : 'SIGN_IN_FAILED', emp.id, {
          method: 'phone',
          attempts,
        });
        if (firstTime && acct.code_expires_at && new Date(acct.code_expires_at) <= new Date()) {
          throw new AppError(
            401,
            'CODE_EXPIRED',
            'That code has expired. Ask your System Administrator for a new one.',
          );
        }
        throw wrong();
      }
      if (firstTime) {
        // The code worked: now they choose their PIN (within 10 minutes, in this session only).
        await promisify((cb) => req.session.regenerate(cb));
        req.session.phoneSetup = { employeeId: emp.id, at: Date.now() };
        await promisify((cb) => req.session.save(cb));
        return res.json({ status: 'SET_PIN' });
      }
      await startSession(req, emp.id);
      res.json({ status: 'OK' });
    } catch (err) {
      next(err);
    }
  });

  const setSchema = z
    .object({ pin: pinSchema, pinConfirm: z.string() })
    .refine((v) => v.pin === v.pinConfirm, {
      message: 'does not match',
      path: ['pinConfirm'],
    });
  router.post('/set-pin', limiter, jsonOnly, async (req, res, next) => {
    try {
      const setup = req.session?.phoneSetup;
      if (!setup || Date.now() - setup.at > SETUP_MINUTES * 60 * 1000) {
        throw new AppError(401, 'SETUP_EXPIRED', 'Start again: sign in with your phone number and code.');
      }
      const { pin } = setSchema.parse(req.body ?? {});
      if (!(await isAmsBranchStaff(db, setup.employeeId))) throw wrong();
      await db('phone_logins')
        .where({ employee_id: setup.employeeId })
        .update({
          pin_hash: await hashSecret(pin),
          code_hash: null,
          code_expires_at: null,
          updated_at: db.fn.now(),
        });
      await audit(req, 'PHONE_PIN_SET', setup.employeeId);
      await startSession(req, setup.employeeId);
      res.json({ status: 'OK' });
    } catch (err) {
      next(err);
    }
  });

  const changeSchema = z
    .object({ currentPin: z.string().max(20), pin: pinSchema, pinConfirm: z.string() })
    .refine((v) => v.pin === v.pinConfirm, { message: 'does not match', path: ['pinConfirm'] });
  router.post('/change-pin', requireAuth, csrfProtection, async (req, res, next) => {
    try {
      const input = changeSchema.parse(req.body ?? {});
      const acct = await db('phone_logins').where({ employee_id: req.user.id }).first();
      if (!acct?.pin_hash) throw badRequest('You do not sign in with a phone number.');
      if (!(await checkSecret(input.currentPin, acct.pin_hash))) {
        throw new AppError(400, 'WRONG_PIN', 'Your current PIN is not right.');
      }
      await db('phone_logins')
        .where({ employee_id: req.user.id })
        .update({ pin_hash: await hashSecret(input.pin), updated_at: db.fn.now() });
      await audit(req, 'PHONE_PIN_CHANGED', req.user.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
