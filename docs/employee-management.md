# Employee management

Employee management is where all staff are managed. It is the central employee record: one
record per person that the leave system and the later HR modules read, covering the whole
lifecycle from onboarding to offboarding (decision D52).

## Who uses it

| Role                           | Can do                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------ |
| HR Officer                     | Everything below: add, edit and import employees; companies and departments    |
| System Administrator           | As HR Officer, plus Microsoft account links, roles and marking someone as left |
| Executive or Managing Director | Read the dashboard, employee list and records; no changes                      |
| Everyone else                  | No access; they keep their own personal details on My profile                  |

## Screens (`/people`)

The menu is Home, Employees, Company overview, Department overview and Reports (D53).

- **Home**: active staff, starting and leaving in the next 30 days, contracts ending in 60 days;
  staff by company and department; joiners and leavers by month; contracts and probation
  ending; recent changes. Can be limited to one company.
- **Employees**: search by name, job title, number or email; filter by company, department,
  employment type and status; quick filters (on probation, contract ending soon, starting soon,
  leaving soon, no line manager, no Microsoft account linked).
- **Employee record**: header with status and employment type; tabs for Overview (employment
  and personal details, direct reports, Microsoft account, roles), Leave (balances) and History.
- **Company overview**: each company side by side: staff, employment type split, departments,
  managers, on probation, contracts ending in 60 days, joined and left this year, average
  service, no line manager, staff by department. HR Officers manage companies from here.
- **Department overview**: every department compared on the same figures, with a company filter.
  HR Officers manage departments from here.
- **Statistics** (D54): Home shows staff at each month end over the last 12 months and length
  of service; both overview pages chart staff by employment type, joined and left this year,
  and length of service, for the whole group or one company.
- **Reports**: staff list, headcount by department, joiners and leavers, contracts ending,
  probation, length of service, missing details and record changes. Each can be filtered and
  downloaded as Excel or CSV; every download is recorded in the audit log.

## The record

On top of the existing details, the record holds:

- employment type: permanent, fixed-term contract or temporary
- contract end date
- probation status (on probation, extended, confirmed) and end date
- pay grade, seen only by HR and directors

## History

Every change is written to `employee_history`, one row per field, with the old and new value as
people saw them (names, not ids) and who made it. The table is append-only: database triggers
refuse updates and deletes. Creating, importing, marking someone as left and making them active
again are recorded too.

## API

| Method | Path                                   | Notes                                                                                      |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/people/dashboard?companyId=`     | HR Officers and directors                                                                  |
| GET    | `/api/people/organisation`             | Companies and departments for filters                                                      |
| GET    | `/api/people/employees`                | Employee list; `search`, `companyId`, `departmentId`, `employmentType`, `status`, `filter` |
| GET    | `/api/people/quick-filters?companyId=` | Count for each quick filter                                                                |
| GET    | `/api/people/employees/:id`            | The full record                                                                            |
| GET    | `/api/people/employees/:id/history`    | Newest first                                                                               |

Changes still go through `/api/admin/employees` (HR Officers).

## Next stages

1. Employee documents: contracts, ID copies, certificates, kept per employee.
2. Change requests with approval: job, department, line manager, pay grade; applied on the
   effective date.
3. Onboarding and offboarding checklists with tasks for HR, IT and the manager.
