import { Router } from 'express';
import { asyncHandler } from '../../utils/validation.js';

/** The signed-in employee's own record. Never takes an employee ID from the client. */
export function profileRoutes({ db }) {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const e = await db('employees as e')
        .leftJoin('companies as c', 'c.id', 'e.company_id')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .leftJoin('employees as m', 'm.id', 'e.line_manager_id')
        .leftJoin('work_schedules as w', 'w.id', 'e.work_schedule_id')
        .where('e.id', req.user.id)
        .first(
          'e.employee_number',
          'e.first_name',
          'e.last_name',
          'e.email',
          'e.job_title',
          'e.employment_start_date',
          'c.name as company',
          'd.name as department',
          'm.first_name as manager_first',
          'm.last_name as manager_last',
          'w.name as schedule',
        );
      const reports = await db('employees')
        .where({ line_manager_id: req.user.id, status: 'ACTIVE' })
        .orderBy(['last_name', 'first_name'])
        .select('first_name', 'last_name', 'job_title');
      res.json({
        employeeNumber: e.employee_number,
        firstName: e.first_name,
        lastName: e.last_name,
        email: e.email,
        jobTitle: e.job_title,
        company: e.company,
        department: e.department,
        lineManager: e.manager_first ? `${e.manager_first} ${e.manager_last}` : null,
        workSchedule: e.schedule,
        employmentStartDate: e.employment_start_date,
        roles: req.user.roles,
        directReports: reports.map((r) => ({
          name: `${r.first_name} ${r.last_name}`,
          jobTitle: r.job_title,
        })),
      });
    }),
  );
  return router;
}
