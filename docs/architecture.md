# Architecture

## Overview

```
Browser (React SPA)  ──HTTPS──>  Nginx  ──>  Express API (Node.js)  ──>  MySQL 8
                                                │
                                                ├── Microsoft Entra ID (OIDC, server-side)
                                                ├── Microsoft Graph (email, from outbox worker)
                                                └── Document storage (outside web root)
```

- The browser holds only an HTTP-only session cookie. Sign-in, token validation and role resolution happen in Express (backend-for-frontend).
- All business rules (validation, state transitions, balance calculation, authorisation) live in the API. The client only presents data and pre-validates forms for convenience.

## Repository layout

| Path                        | Contents                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `server/src/config`         | Environment validation and production guards                                         |
| `server/src/db`             | Knex connection setup                                                                |
| `server/src/middleware`     | Error handling; authentication and authorisation (Phase 2)                           |
| `server/src/modules/<area>` | One folder per business area: routes, service, validation                            |
| `server/scripts`            | Operator commands (administrator bootstrap; employee import in Phase 2)              |
| `server/test`               | Unit and API tests against the `_test` database                                      |
| `database/migrations`       | Versioned schema                                                                     |
| `docs`                      | Setup, decisions, policy extraction, and (later phases) API, deployment and recovery |
| `client`                    | React application (Phase 4)                                                          |

## Data model

Organisation: `departments`, `employees` (with `line_manager_id`), `identity_links` (Entra tenant ID + object ID, unique), `roles`, `employee_roles`, `delegations`, `work_schedules`.

Configuration: `leave_types`, `leave_policy_versions` (versioned, effective-dated, never edited after use), `public_holidays`, `system_settings`.

Workflow: `leave_requests` (state, assigned manager, version for optimistic locking), `leave_request_days` (per-day charge breakdown shown to the employee), `change_requests` (amend or cancel approved leave), `approval_actions` (append-only history), `documents`.

Balances: `balance_ledger` (append-only source of truth), `balance_cache` (derived, reconciled against the ledger), `scheduled_job_runs`.

Platform: `notifications`, `email_outbox`, `audit_log` (append-only), `sessions`, `idempotency_keys`.

## Integrity guarantees enforced by the database

| Guarantee                                                           | Mechanism                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| A request is deducted at most once per leave type and year          | Unique key `uq_ledger_source_once`                              |
| A periodic accrual runs at most once per employee and period        | Unique key `uq_ledger_period_once`                              |
| A ledger entry is reversed at most once                             | Unique key `uq_ledger_reversed_once`                            |
| Ledger, audit log and approval history cannot be changed or deleted | `BEFORE UPDATE` / `BEFORE DELETE` triggers                      |
| Adjustments and opening balances carry a reason                     | CHECK `chk_ledger_reason`                                       |
| One Entra identity maps to one employee, and vice versa             | Unique keys on `identity_links`                                 |
| Date ranges are valid                                               | CHECK constraints on requests, delegations, policies, employees |

## Request state machine

Implemented in Phase 3. States and transitions follow section 7 of `docs/project-brief.md`.
