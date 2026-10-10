import { Router } from 'express';
import { z } from 'zod';
import { writeAudit } from '../audit/audit.service.js';
import { auditContext } from '../../middleware/auth.js';
import {
  asyncHandler,
  idParam,
  isoDate,
  optionalId,
  optionalText,
  requiredText,
} from '../../utils/validation.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';

const holidaySchema = z.object({
  holidayDate: isoDate,
  name: requiredText(120),
  isSubstitute: z.boolean().default(false),
  substitutesForId: optionalId,
  sourceNote: optionalText(255),
});

const fraction = z.union([z.literal(0), z.literal(0.5), z.literal(1)]);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const scheduleSchema = z.object({
  name: requiredText(80),
  days: z.object(Object.fromEntries(DAYS.map((d) => [d, fraction]))),
  isCompanyDefault: z.boolean().default(false),
});

function holidayDto(r) {
  return {
    id: r.id,
    holidayDate: r.holiday_date,
    name: r.name,
    isSubstitute: Boolean(r.is_substitute),
    substitutesForId: r.substitutes_for_id,
    sourceNote: r.source_note,
  };
}
function scheduleDto(r) {
  return {
    id: r.id,
    name: r.name,
    days: Object.fromEntries(DAYS.map((d) => [d, Number(r[`${d}_fraction`])])),
    isCompanyDefault: Boolean(r.is_company_default),
    isActive: Boolean(r.is_active),
    employees: Number(r.employees ?? 0),
  };
}

export function holidayRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const year = Number(req.query.year) || new Date().getUTCFullYear();
      const rows = await db('public_holidays')
        .whereBetween('holiday_date', [`${year}-01-01`, `${year}-12-31`])
        .orderBy('holiday_date');
      res.json({ year, items: rows.map(holidayDto) });
    }),
  );

  const save = (id) =>
    asyncHandler(async (req, res) => {
      const input = holidaySchema.parse(req.body);
      if (input.isSubstitute && !input.substitutesForId) {
        throw badRequest('Choose the holiday this day substitutes for.');
      }
      const row = {
        holiday_date: input.holidayDate,
        name: input.name,
        is_substitute: input.isSubstitute,
        substitutes_for_id: input.isSubstitute ? input.substitutesForId : null,
        source_note: input.sourceNote,
      };
      const newId = await db
        .transaction(async (trx) => {
          let before = null;
          if (id) {
            before = await trx('public_holidays')
              .where({ id: id(req) })
              .forUpdate()
              .first();
            if (!before) throw notFound('Holiday not found.');
            await trx('public_holidays').where({ id: before.id }).update(row);
          } else {
            [row.id] = await trx('public_holidays').insert({ ...row, created_by: req.user.id });
          }
          const entityId = before?.id ?? row.id;
          await writeAudit(trx, {
            ...auditContext(req),
            action: before ? 'HOLIDAY_UPDATED' : 'HOLIDAY_CREATED',
            entityType: 'public_holiday',
            entityId,
            before: before ? holidayDto(before) : null,
            after: input,
          });
          return entityId;
        })
        .catch((err) => {
          if (err?.code === 'ER_DUP_ENTRY') throw conflict('A public holiday already exists on that date.');
          throw err;
        });
      res.status(id ? 200 : 201).json({ id: newId });
    });

  router.post('/', save(null));
  router.put(
    '/:id',
    save((req) => idParam(req)),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await db
        .transaction(async (trx) => {
          const before = await trx('public_holidays').where({ id }).forUpdate().first();
          if (!before) throw notFound('Holiday not found.');
          await trx('public_holidays').where({ id }).del();
          await writeAudit(trx, {
            ...auditContext(req),
            action: 'HOLIDAY_DELETED',
            entityType: 'public_holiday',
            entityId: id,
            before: holidayDto(before),
          });
        })
        .catch((err) => {
          if (err?.code === 'ER_ROW_IS_REFERENCED_2') {
            throw conflict('This holiday is already part of recorded leave and cannot be deleted.');
          }
          throw err;
        });
      res.json({ ok: true });
    }),
  );

  return router;
}

export function scheduleRoutes({ db }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = await db('work_schedules as w')
        .select(
          'w.*',
          db('employees')
            .count('*')
            .whereRaw('employees.work_schedule_id = w.id')
            .andWhere('status', 'ACTIVE')
            .as('employees'),
        )
        .orderBy('w.name');
      res.json({ items: rows.map(scheduleDto) });
    }),
  );

  const save = (getId) =>
    asyncHandler(async (req, res) => {
      const input = scheduleSchema.parse(req.body);
      if (Object.values(input.days).every((v) => v === 0))
        throw badRequest('A schedule needs at least one working day.');
      const row = { name: input.name, is_company_default: input.isCompanyDefault };
      for (const d of DAYS) row[`${d}_fraction`] = input.days[d];
      const id = await db
        .transaction(async (trx) => {
          let before = null;
          let id;
          if (getId) {
            id = getId(req);
            before = await trx('work_schedules').where({ id }).forUpdate().first();
            if (!before) throw notFound('Schedule not found.');
            if (before.is_company_default && !input.isCompanyDefault) {
              throw conflict('Choose another schedule as the company default instead.');
            }
          }
          if (input.isCompanyDefault) {
            await trx('work_schedules')
              .update({ is_company_default: false })
              .where({ is_company_default: true });
          }
          if (before) await trx('work_schedules').where({ id }).update(row);
          else [id] = await trx('work_schedules').insert(row);
          await writeAudit(trx, {
            ...auditContext(req),
            action: before ? 'SCHEDULE_UPDATED' : 'SCHEDULE_CREATED',
            entityType: 'work_schedule',
            entityId: id,
            before: before ? scheduleDto(before) : null,
            after: input,
          });
          return id;
        })
        .catch((err) => {
          if (err?.code === 'ER_DUP_ENTRY') throw conflict('A schedule with that name already exists.');
          throw err;
        });
      res.status(getId ? 200 : 201).json({ id });
    });

  router.post('/', save(null));
  router.put(
    '/:id',
    save((req) => idParam(req)),
  );
  return router;
}
