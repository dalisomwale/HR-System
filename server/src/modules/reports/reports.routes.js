import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { auditContext } from '../../middleware/auth.js';
import { writeAudit } from '../audit/audit.service.js';
import { asyncHandler } from '../../utils/validation.js';
import { AppError } from '../../utils/errors.js';
import { todayInLusaka } from '../../utils/dates.js';
import {
  REPORTS,
  ENTRY_TYPES,
  STATUS_OPTIONS,
  filterSchema,
  findReport,
  reportScope,
} from './reports.service.js';
import { toCsv, toXlsx } from './export-files.js';

const PREVIEW_ROWS = 500;
const EXPORT_ROWS = 50_000;

/** Filters that were actually applied, for the audit log and the file name. */
const applied = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));

export function reportRoutes({ db }) {
  const router = Router();

  const exportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `export-${req.user.id}`,
    handler: (req, res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many exports. Wait a few minutes and try again.')),
  });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const scope = await reportScope(db, req.user);
      const items = REPORTS.filter((r) => r.levels.includes(scope.level)).map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        filters: r.filters,
      }));
      // Filter choices limited to what the viewer may see.
      const employees = await db('employees as e')
        .modify((q) => scope.ids && q.whereIn('e.id', scope.ids.length ? scope.ids : [0]))
        .orderBy(['e.last_name', 'e.first_name'])
        .select('e.id', 'e.first_name', 'e.last_name', 'e.employee_number', 'e.status');
      const departments =
        scope.level === 'HR' ? await db('departments').orderBy('name').select('id', 'name') : [];
      const leaveTypes = await db('leave_types').orderBy('display_order').select('id', 'name');
      res.json({
        scope: scope.level,
        items,
        options: {
          employees: employees.map((e) => ({
            id: e.id,
            label: `${e.first_name} ${e.last_name} (${e.employee_number})${e.status === 'ACTIVE' ? '' : ' – inactive'}`,
          })),
          departments,
          leaveTypes,
          statuses: STATUS_OPTIONS,
          entryTypes: ENTRY_TYPES,
        },
      });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const scope = await reportScope(db, req.user);
      const report = findReport(req.params.id, scope);
      const filters = filterSchema.parse(req.query);
      const rows = await report.run(db, scope, filters);
      res.json({
        id: report.id,
        title: report.title,
        columns: report.columns,
        rows: rows.slice(0, PREVIEW_ROWS),
        total: rows.length,
        truncated: rows.length > PREVIEW_ROWS,
        filters: applied(filters),
      });
    }),
  );

  router.get(
    '/:id/export',
    exportLimiter,
    asyncHandler(async (req, res) => {
      const scope = await reportScope(db, req.user);
      const report = findReport(req.params.id, scope);
      const format = z.enum(['csv', 'xlsx']).catch('csv').parse(req.query.format);
      const filters = filterSchema.parse(req.query);
      const rows = await report.run(db, scope, filters);
      if (rows.length > EXPORT_ROWS) {
        throw new AppError(
          413,
          'EXPORT_TOO_LARGE',
          `This export has ${rows.length} rows; narrow the filters to ${EXPORT_ROWS} or fewer.`,
        );
      }
      const file =
        format === 'xlsx'
          ? toXlsx(report.columns, rows, { sheetName: report.title, title: report.title })
          : toCsv(report.columns, rows);
      await writeAudit(db, {
        ...auditContext(req),
        action: 'REPORT_EXPORTED',
        entityType: 'report',
        entityId: report.id,
        after: { format, rows: rows.length, scope: scope.level, filters: applied(filters) },
      });
      const fileName = `altus-${report.id}-${todayInLusaka()}.${format}`;
      res
        .set({
          'Content-Type':
            format === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(file);
    }),
  );

  return router;
}
