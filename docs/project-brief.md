# PROJECT PROMPT: ALTUS FINANCIAL SERVICES LIMITED — HR LEAVE MANAGEMENT SYSTEM

## 0. How to Use This Prompt

This is a large system. Do not attempt it in one pass. Work through the phases in Section 20 in order, stop at the end of each phase, report what was built and tested, and wait for confirmation before continuing.

Before writing any code, read Sections 1–3 and the Open Decisions register (Section 19). Where a decision is unresolved, use the stated default, record it in `docs/decisions.md`, and flag it in your phase report. Never invent a policy value that is not given here or in the supplied policy document.

## 1. Project Overview

Build a secure, production-grade HR Leave Management System for **Altus Financial Services Limited**. Employees submit leave requests; their manager reviews them; HR gives final approval. The system is backed by a real MySQL database and real integrations. It is not a prototype or demonstration.

This is a **new repository** unless one is supplied. If files already exist, inspect them first and do not overwrite existing functionality without explaining why.

## 2. Supplied Inputs

The following files must be present before the stated phase begins. If any is missing, stop and ask for it. Do not substitute an invented asset or invented values.

| Input | Expected path | Needed from |
|---|---|---|
| Altus logo (SVG preferred, else PNG ≥ 512 px wide) | `client/src/assets/brand/altus-logo.svg` | Phase 4 |
| Primary brand colour (hex, taken from the logo) | Stated in `docs/decisions.md` | Phase 4 |
| "Leave Policy - Altus Group - 29th May 2025" | `docs/policy/altus-leave-policy-2025-05-29.pdf` | Phase 1 |

In Phase 1, extract every leave provision from the policy document into `docs/policy-extraction.md`: one row per rule, with the clause reference, the exact value, how the system will treat it, and whether HR confirmation is required. This document is the single source for the seeded policy configuration.

## 3. Non-Negotiable Rules

1. **No fabricated business data.** No demo employees, sample requests, fictional departments, placeholder statistics or invented approval history in the application, the production database or seed scripts.
2. **What is allowed:** schema, required system configuration, leave-type and policy records taken verbatim from the policy extraction, and test fixtures that exist only in the isolated test database (Section 17).
3. **No non-functional UI.** Every button, link, filter and form must call a real endpoint. No TODO placeholders for critical functionality, no simulated responses.
4. **No business logic in the frontend only.** All validation, state transitions, balance calculations and authorisation happen on the server. The frontend may pre-validate for usability only.
5. **No secrets in the frontend or the repository.** Use environment variables; provide `.env.example` with names only.
6. **Honest status reporting.** Do not claim that authentication, email, approvals or any integration works unless it has been implemented and tested. Distinguish clearly between "implemented and tested against a test tenant / test mail account" and "configured for production".
7. **No emojis, AI assistants, chatbots, AI badges, decorative gradients, glow effects, glassmorphism, floating decorations or gratuitous animation** anywhere, including emails and exports.

Empty states: when a real query returns no records, show a plain message (for example, "No leave requests found.") and, where the user is authorised, the relevant action. Show zero only when a query establishes zero; show "Unavailable" when a query fails.

## 4. Technology Stack

**Frontend:** React (Vite), JavaScript, Tailwind CSS, React Router, TanStack Query for server state, React Hook Form with Zod for form validation, Lucide icons only.

**Backend:** Node.js (LTS), Express, REST API, Zod (or equivalent) request validation, centralised error handler, role- and record-level authorisation middleware, structured logging (pino or similar).

**Database:** MySQL 8, InnoDB, utf8mb4. Version-controlled migrations (Knex or an equivalent migration tool). Use `DATE` columns for leave dates and `DATETIME`/`TIMESTAMP` in UTC for events. Business timezone is `Africa/Lusaka`.

**Authentication:** Microsoft Entra ID, OpenID Connect authorisation-code flow with PKCE, handled **server-side** by Express using `@azure/msal-node` (backend-for-frontend pattern). The browser holds only an HTTP-only, Secure, SameSite cookie for a server-side session stored in MySQL. Never store tokens in localStorage or sessionStorage.

**Email:** Microsoft Graph `sendMail` from a dedicated shared mailbox, using application permissions scoped to that mailbox (ApplicationAccessPolicy). SMTP may be supported as a fallback adapter. See Section 12 for delivery-status semantics.

**Testing:** Vitest or Jest for unit tests, Supertest for API tests against a dedicated MySQL test database, Playwright for a small number of end-to-end flows.

## 5. Branding and Interface

- Use the supplied logo unaltered on the sign-in page, the application header or sidebar, PDF/Excel report headers and email templates. Do not recolour, redraw or replace it.
- Primary colour: the navy taken from the logo (hex recorded in `docs/decisions.md`). White and light neutral backgrounds. Restrained, consistent status colours (for example: amber pending, green approved, red rejected, grey withdrawn/cancelled). Status must never be conveyed by colour alone; always include a text label.
- One type scale, one spacing scale, one border radius (small), one icon size per context, one button system. Define these as Tailwind theme tokens.
- Dense, efficient layouts: tables with sorting, filtering and pagination for lists; compact summary figures rather than oversized statistic cards.
- Responsive across desktop, tablet and mobile. Meet WCAG 2.1 AA for contrast, keyboard navigation, focus states and form labelling.
- No welcome banners, slogans or marketing copy inside the authenticated application.

## 6. Identity, Roles and Organisation Model

### Identity
- The immutable link between a person and their employee record is the Entra **object ID (`oid`) plus tenant ID (`tid`)**. Email is stored for display and notification only.
- On sign-in, validate issuer, audience, signature, expiry, nonce and that `tid` equals the configured Altus tenant.
- A valid Altus user with no mapped, active employee record sees an "Access not configured — contact HR" page and nothing else. Log the attempt.
- Deactivated employees cannot sign in; their sessions are revoked on deactivation.

### Role source of truth
Application roles are stored in the MySQL database and managed by HR Administrators (default; see Section 19, D1). Frontend role values are never trusted.

### Roles
A person may hold more than one role (for example, an HR Officer is also an Employee). Permissions are the union, subject to the conflict-of-interest rules below.

**Employee**
- View own profile, entitlements, balances and balance ledger.
- Submit, view, withdraw and (when returned) correct and resubmit own requests.
- Attach supporting documents.
- Request amendment or cancellation of approved leave.
- View own history and own approved-leave calendar.
- Never see another employee's records.

**Manager** (any employee who is the recorded manager of at least one active employee)
- Act on requests from their **direct reports** (default; see D2).
- See team requests, upcoming team absences, overlapping leave and handover status.
- Approve or reject with comments.
- Cannot see sick-leave medical documents (see Section 11).

**HR Officer**
- Final approval authority: approve, reject or return for correction requests in `PENDING_HR_APPROVAL`.
- View company-wide leave records, calendars and reports.
- Record authorised balance adjustments (with mandatory reason).
- View audit history for requests.

**HR Administrator**
- Create, update, activate and deactivate employee records; set employee number, department, job title, manager, start date, end date and working schedule.
- Map Entra identities to employee records.
- Assign roles.
- Maintain leave types, policy versions, public holidays, working calendars, notification settings and overdue thresholds.
- Import employees from a CSV file of real staff records, with row-level validation and a preview before commit.
- View audit logs.

### Conflict-of-interest rules (enforced in the backend)
- Nobody may act on their own request at any stage.
- An HR Officer's own request must be finally approved by a different HR Officer.
- If the manager is also an HR Officer, they act only at the manager stage on that request; a different HR Officer performs the final stage.
- If an employee has no manager recorded (for example, the Executive Director), the request goes directly to `PENDING_HR_APPROVAL` and this routing is recorded in the audit trail (default; see D3).
- If no eligible approver exists for a stage, the request is held and HR Administrators are alerted; it must never auto-advance.

### Delegation
A manager may nominate an active employee as acting approver for a date range (for example, while on leave). Delegations are recorded and audited; the delegate cannot act on their own requests.

## 7. Leave Request State Machine

Implement as a single server-side module. Every transition is validated against the current state, the actor's role and the conflict-of-interest rules, and is written to the approval history and audit log in the same transaction.

### States
`DRAFT`, `PENDING_MANAGER_APPROVAL`, `PENDING_HR_APPROVAL`, `RETURNED_FOR_CORRECTION`, `APPROVED`, `REJECTED_BY_MANAGER`, `REJECTED_BY_HR`, `WITHDRAWN`, `CANCELLED`.

### Transitions

| From | Action | Actor | To |
|---|---|---|---|
| DRAFT | submit | Employee | PENDING_MANAGER_APPROVAL (or PENDING_HR_APPROVAL if no manager) |
| PENDING_MANAGER_APPROVAL | approve | Manager / delegate | PENDING_HR_APPROVAL |
| PENDING_MANAGER_APPROVAL | reject (reason required) | Manager / delegate | REJECTED_BY_MANAGER |
| PENDING_MANAGER_APPROVAL | withdraw | Employee | WITHDRAWN |
| PENDING_HR_APPROVAL | approve | HR Officer | APPROVED |
| PENDING_HR_APPROVAL | reject (reason required) | HR Officer | REJECTED_BY_HR |
| PENDING_HR_APPROVAL | return (reason required) | HR Officer | RETURNED_FOR_CORRECTION |
| PENDING_HR_APPROVAL | withdraw | Employee | WITHDRAWN |
| RETURNED_FOR_CORRECTION | resubmit | Employee | PENDING_MANAGER_APPROVAL (default; see D4) |
| RETURNED_FOR_CORRECTION | withdraw | Employee | WITHDRAWN |

`REJECTED_*`, `WITHDRAWN` and `CANCELLED` are terminal.

### Amendment and cancellation of approved leave
Handled as a separate **change request** linked to the original, with its own two-stage approval (manager then HR) and its own history:
- **Cancellation** before the leave starts: on final approval, the original moves to `CANCELLED` and the full deduction is reversed in the ledger.
- **Cancellation or curtailment after leave has started:** only untaken future working days are reversed. The days already taken remain deducted.
- **Amendment of dates:** on final approval, the original deduction is reversed and the new deduction applied in one transaction. If the new dates fail validation, the change request is rejected and the original leave stands.

### Concurrency and idempotency
- Every transition locks the request row (`SELECT … FOR UPDATE`) and checks the expected current state; a mismatch returns HTTP 409.
- Every mutating endpoint accepts an `Idempotency-Key` header; repeated keys return the original result without re-executing.
- Requests carry a version number; stale updates are rejected.

### Policy provision on uncommunicated decisions
The policy contains a provision about manager decisions not communicated within one week. **Do not auto-approve.** Implement it only as an escalation: after the configured threshold, notify the manager, the manager's own manager (if any) and HR, and mark the request overdue. Record the provision in the policy extraction as requiring HR confirmation.

## 8. Request Validation

On submission and again inside the final-approval transaction, validate:
- Leave type is active and the employee is eligible (service length, gender-neutral eligibility rules as configured, employment status).
- Start date ≤ end date; half-day markers are valid for the leave type.
- No overlap with the employee's own pending or approved leave.
- Sufficient available balance, where the leave type consumes a balance.
- Required documents attached, or a permitted deferral window applies (for example, a sick-note uploaded within N days of return).
- Notice period. The two-week advance notice for annual leave is a **warning that requires the employee to give a reason**, not a hard block (default; see D5).
- Back-dated requests are permitted only for leave types configured to allow them (for example, sick and compassionate leave) and within a configured window.

Return field-level error messages that tell the employee what to change.

## 9. Leave Types and Altus Policy

Configure the eight leave types in the policy: Annual, Sick, Compassionate, Family Responsibility, Study, Maternity, Paternity, Leave Without Pay.

Each leave type is a database record with, at minimum: code, name, paid/unpaid, day basis (working days or calendar days), whether it consumes a balance, entitlement amount and period, accrual method, carry-forward limit and expiry, eligibility rules, required documents and when they are due, whether half days are allowed, whether back-dating is allowed and for how long, maximum single duration, and whether medical confidentiality applies.

Policies are **versioned**: an edit creates a new version with an effective date. Requests are evaluated against the version in force on their start date. Past versions are never altered.

### Annual leave values from the supplied policy
- Leave year 1 January – 31 December.
- 25 working days per year.
- Accrual stated as 2.3 days per month.
- Prorated for joiners and leavers.
- Leave may be taken as it accrues.
- At least 10 consecutive days should be taken each year (track and report; do not block).
- Maximum 5 days carried forward, expiring 31 March of the following year.
- Applications normally at least two weeks before commencement.
- Handover notes prepared and signed off by the Head of Department (see D6).
- Public holidays falling within annual leave are not deducted.

**Accrual conflict:** 2.3 × 12 = 27.6 days, which does not equal 25 days (25 ÷ 12 ≈ 2.083). Implement accrual as a configurable method (fixed monthly amount, or annual entitlement ÷ 12) with configurable rounding. Production accrual runs must remain **disabled until an HR Administrator records the confirmed rule**. Display a persistent admin notice while unconfirmed.

### Other leave types
Take entitlements and conditions from `docs/policy-extraction.md`. Do not fill gaps from general industry practice.

### Statutory check
In the policy extraction, add a column comparing each provision with the Zambian Employment Code Act No. 3 of 2019 (and any later amendment). Where the Altus policy appears to fall below a statutory minimum, flag it for HR and legal confirmation. Do not change the value yourself.

### Out of scope until confirmed
No salary deductions, leave payouts, encashment or final-settlement calculations. Termination-related leave rules are recorded in the extraction and flagged only.

## 10. Balance Engine and Ledger

- Balances are derived from an **append-only ledger**. Each entry records employee, leave type, leave year, amount (+/−), entry type, source reference (request, change request, accrual run, adjustment, carry-forward, expiry), actor, timestamp and reason. Entries are never updated or deleted; corrections are reversing entries.
- Entry types: opening balance, entitlement grant, accrual, approved deduction, reversal, carry-forward in, carry-forward expiry, authorised adjustment.
- A cached balance table may be kept for performance, but it must be updated in the same transaction as the ledger and a reconciliation job must verify it against the ledger.
- **Deduction occurs only on final HR approval**, inside the same transaction as the state change. A unique constraint on (request ID, entry type) guarantees a request is deducted at most once.
- Pending requests do not deduct. If reservations are enabled for a leave type, they are separate ledger entries released on rejection, withdrawal or cancellation.
- Negative balances are blocked unless the leave type explicitly permits them.
- Opening balances for existing staff are entered by HR Administrators (individually or by CSV import) with a mandatory note, not generated.
- Accrual, carry-forward and expiry run as scheduled jobs that are idempotent per employee per period and log their results.

## 11. Working Days, Calendars and Documents

### Working days
- Company working week is configurable (default Monday–Friday). Employee-specific schedules override it where set.
- Public holidays are records maintained by HR Administrators, including holidays declared at short notice. Support a "substitute day" rule for holidays falling on a weekend, configurable to match Zambian practice (to be confirmed by HR; see D7).
- Calendar-day leave types (as specified in the policy) count every day; working-day types exclude weekends and public holidays.
- Before submission, show the calculated duration and a breakdown: total days in range, weekends excluded, public holidays excluded (named), half days, resulting chargeable days.

### Supporting documents
- Allowed types: PDF, JPEG, PNG. Configurable size limit (default 5 MB). Validate by file signature, not extension.
- Store outside the web root (or in private object storage) under random names. Serve only through an authorised download endpoint that checks record-level permissions on every request.
- **Medical documents** for sick leave are visible to the employee and HR only. Managers see that a document has been provided, not its contents.
- Log every download in the audit log.

## 12. Notifications

### Events
Submission, manager decision, arrival at HR, HR decision, return for correction, resubmission, change-request submission and decision, overdue approval (manager and HR thresholds configurable, default 3 working days), document due, carry-forward expiry approaching, and the "access not configured" event (to HR Administrators).

### In-system
Notification list with unread count, mark-as-read, and links to the relevant record. Generated from the same transaction that records the workflow event (via an outbox table), so a notification never exists for an event that was rolled back.

### Email
- Sent asynchronously from an outbox table by a worker process, with retry and exponential backoff, and a dead-letter state after the configured number of attempts.
- Record statuses honestly: `QUEUED`, `SENDING`, `ACCEPTED` (the mail service accepted the message), `FAILED` (with error). The system cannot confirm inbox delivery and must not label anything "delivered".
- Plain, branded HTML template with a plain-text alternative. Content limited to: request reference, leave type (except where confidential), dates, status, required action and a link. No medical details, no attachments, no balance figures for other people.
- HR Administrators can view failed emails and trigger a resend.

## 13. Dashboards

All figures come from real queries scoped to the user's authorisation.

**Employee:** balances by leave type with accrual detail; pending requests and their stage; upcoming approved leave; recent decisions; required actions.

**Manager:** requests awaiting my review (oldest first, overdue flagged); team members currently on leave; upcoming team leave over the next 30 days; overlapping absences; outstanding handovers.

**HR:** requests awaiting final approval; requests pending with managers (with age); exceptions (overdue, held for no eligible approver, unconfirmed policy rules, failed emails, missing documents); staff currently on leave; utilisation by department; carry-forward due to expire.

## 14. Reports and Exports

Reports: requests by status; leave taken by employee; utilisation by department; current balances; upcoming absences; carry-forward and expiry; ledger transactions and adjustments; approval activity by manager and HR; outstanding and overdue requests; leave over a date range; employees who have not taken 10 consecutive annual-leave days.

Filters: employee, department, leave type, status, date range. Export to CSV and XLSX. Authorisation is applied in the query, before data is retrieved, never by filtering results afterwards. Exports are logged in the audit log. Neutralise CSV formula injection (cells beginning with `=`, `+`, `-`, `@`).

## 15. Database Design

Normalised schema with foreign keys, indexes on all foreign keys and common filter columns, `CHECK` and unique constraints where applicable. Tables at minimum:

`employees`, `identity_links` (oid, tid, employee_id), `departments`, `roles`, `employee_roles`, `delegations`, `leave_types`, `leave_policy_versions`, `leave_requests`, `leave_request_days` (optional per-day breakdown), `approval_actions`, `change_requests`, `balance_ledger`, `balance_cache`, `public_holidays`, `work_schedules`, `documents`, `notifications`, `email_outbox`, `audit_log`, `sessions`, `idempotency_keys`, `system_settings`, `scheduled_job_runs`.

The audit log is append-only at the application level and records actor, action, entity, entity ID, before/after values for configuration changes, IP address, user agent and timestamp.

Installation creates the schema and required system settings only. **Initial administrator bootstrap:** a documented CLI command (`npm run bootstrap:admin -- --oid <oid> --email <email>`) that can run only while no HR Administrator exists, creates that one link and role, and writes an audit entry.

## 16. Security

- Entra ID validation as in Section 6. Server-side sessions with idle timeout (default 30 minutes) and absolute timeout (default 10 hours); logout destroys the server session and redirects to Entra sign-out.
- Cookies: HTTP-only, Secure, SameSite=Lax. CSRF protection on all state-changing requests (synchroniser token or double-submit).
- Role-based and record-level authorisation on every endpoint, covered by tests.
- Parameterised queries only. Output encoding by default (React); no `dangerouslySetInnerHTML` with user content.
- Helmet with a strict Content Security Policy; CORS limited to the configured client origin.
- Rate limiting on authentication, submission, upload and export endpoints.
- Secrets from environment variables or an approved secret store. Separate databases and credentials for development, test and production; the application refuses to start if `NODE_ENV=production` and any development-only setting is enabled.
- Dependency audit (`npm audit`) in CI; no high or critical findings at release.
- Documented daily database backups, retention period, and a tested restore procedure.

## 17. Testing

Test fixtures exist only in the test database, which is created and destroyed by the test runner. Production and development databases never receive fixtures.

**Local development without a live Entra tenant:** provide a development-only sign-in adapter that selects an existing employee record from the local development database. It must be impossible to enable when `NODE_ENV=production` (startup check plus test). The development database starts empty apart from what the developer creates through the application or the bootstrap command.

At minimum, test:
- Identity mapping, tenant rejection, unmapped and deactivated users.
- Employees cannot read or act on others' records (including by changing IDs in API calls).
- Managers act only on direct reports or delegated scope; cannot act on their own requests.
- HR cannot act before manager approval; managers cannot perform the HR stage; HR Officers cannot finally approve their own leave.
- Every state-machine transition, valid and invalid.
- Rejection, withdrawal and return do not deduct; final approval deducts exactly once, including under concurrent duplicate approvals.
- Cancellation and curtailment reverse exactly the right number of days.
- Working-day calculations across weekends, public holidays, substitute days, half days and leave-year boundaries.
- Proration, accrual (both methods), carry-forward cap and 31 March expiry.
- File-type rejection, size limit, unauthorised download, manager access to medical documents denied.
- Notifications and emails created only for committed events.
- Reports and exports exclude unauthorised records.
- Production startup refuses the development sign-in adapter.

## 18. Project Structure

```
client/
  src/
    assets/brand/
    components/
    layouts/
    pages/{auth,employee,manager,hr,admin}/
    services/
    hooks/
    routes/
    utils/
server/
  src/
    config/
    middleware/
    modules/{auth,employees,departments,roles,leave-types,policies,leave-requests,
             approvals,change-requests,balances,calendars,documents,notifications,
             reports,audit}/
    jobs/
    workers/
    app.js
    server.js
  scripts/          (bootstrap-admin, import-employees)
  test/
database/
  migrations/
docs/
  setup.md  architecture.md  api.md  roles-and-permissions.md
  deployment.md  backup-and-recovery.md  entra-setup.md  email-setup.md
  decisions.md  policy-extraction.md
.env.example
.gitignore
README.md
```

## 19. Open Decisions Register

Use the default until confirmed. Record each in `docs/decisions.md` with its status.

| ID | Question | Default |
|---|---|---|
| D1 | Are roles managed in the app database or by Entra app roles/groups? | App database |
| D2 | Do managers approve direct reports only, or their whole reporting line? | Direct reports only |
| D3 | Who approves leave for staff with no manager (e.g. Executive Director)? | Skip to HR stage, audited |
| D4 | After HR returns a request for correction, does resubmission go back to the manager or straight to HR? | Back to the manager |
| D5 | Is the two-week notice for annual leave a hard block or a warning? | Warning with mandatory reason |
| D6 | Is the "Head of Department" who signs off handovers the manager, or a separate role? | The manager, at the manager stage |
| D7 | Rule for public holidays falling on a weekend | HR confirms; configurable substitute-day rule |
| D8 | Annual accrual: 2.3 days per month or 25 ÷ 12, and rounding | Accrual disabled until confirmed |
| D9 | Policy provision on manager decisions not communicated within one week | Escalation only, never auto-approval |
| D10 | Half-day leave allowed for which types? | Annual leave only |
| D11 | Deployment target (VPS with Nginx/PM2, Azure App Service, or other) | Linux VPS, Nginx reverse proxy, PM2, MySQL on the same host or managed |
| D12 | Email sender: Graph from a shared mailbox, or SMTP relay? | Graph shared mailbox |
| D13 | Document storage: local disk outside web root, or object storage? | Local disk outside web root, included in backups |
| D14 | Provisions in the policy below Employment Code Act minimums | Flag only, do not change |

## 20. Delivery Phases

Each phase ends with: what was built, tests run and results, decisions taken, and anything not yet working. Do not start the next phase until confirmed.

1. **Foundations and policy.** Repository scaffold, linting, environment configuration, migrations for the full schema, policy extraction document, decisions register, bootstrap-admin command.
2. **Authentication and administration.** Entra sign-in (BFF), sessions, CSRF, development sign-in adapter with production guard, role middleware, HR Admin screens for employees, departments, identity mapping, roles, CSV import, leave types, policy versions, holidays and schedules. Audit logging.
3. **Leave engine.** Working-day calculator, balance ledger, accrual/carry-forward/expiry jobs, request validation, state machine, change requests, idempotency and concurrency handling, with the full test suite for these.
4. **Portals.** Employee, Manager and HR interfaces wired to the API, dashboards, documents, branding.
5. **Notifications.** In-system notifications, outbox, email worker, templates, overdue escalation job.
6. **Reports and exports.**
7. **Hardening and documentation.** Security review against Section 16, Playwright flows, backup and restore test, complete documentation, release checklist.

## 21. Definition of Done

The system is complete when:
- All seven phases are delivered and their tests pass.
- Entra sign-in works against the Altus tenant (or a documented test tenant, with production configuration steps written out).
- The full workflow (submit, manager approval, HR final approval, deduction exactly once) works end to end on real records.
- Rejection, return, withdrawal, cancellation and amendment work and are audited.
- In-system notifications and email work against a real mailbox, with honest delivery statuses.
- HR can manage employees, policies, holidays, balances and reports.
- Every open decision is either confirmed or explicitly listed as outstanding.
- The repository contains no demo data, emojis or AI-themed interface elements.
- Setup, Entra, email, deployment, backup/recovery, API and role documentation is complete.

Do not describe the system as production-ready while any Section 19 decision affecting automation is unconfirmed, or while Entra and email are configured only against test accounts.
