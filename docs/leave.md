# Leave workflow and first-time setup

## How a request moves

1. **Employee** applies under _Apply for leave_. The right-hand panel shows the server's own calculation (working days on their schedule, public holidays excluded, balance after the request) and any rule that would stop the request. The server repeats every check on submit.
2. **Line manager** sees it under _Team approvals_ (shown to anyone with direct reports). They approve or reject; rejecting needs a reason (policy 1.3.2(c)). A delegate covering for the manager can act on their behalf.
3. **HR Officer** gives final approval under _HR approvals_, or rejects, or returns it for correction (both need a comment). Approval deducts the days from the balance exactly once. HR cannot finally approve their own leave or a request they already approved as line manager.
4. If the employee has no active line manager, the request goes straight to HR and is marked as such (D3).

After approval the employee can ask to cancel. Before the leave starts the reason is "plans changed" and the days come back once manager and HR approve. After it starts, a recall by management returns the untaken days; returning early by choice does not (policy 2.8, D24).

Until the employee or HR acts, a pending request can be withdrawn by the employee.

## First-time setup for HR

1. **Give yourself the HR Officer role** if you also need to approve leave or manage balances (Employees → your record → Roles). HR Administrator alone manages settings, not leave.
2. **Record each employee's sex** where maternity, paternity, Mother's Day or pregnancy-loss leave applies (Employees → record, or the `sex` column in CSV import: F, M, Female or Male).
3. **Review leave types** (Administration → Leave types). All ten were created from the policy as _inactive_. Check each one's rules against the policy; use _Change rules_ to correct anything, then _Review done – activate_. Activating records who confirmed the rules and when.
4. **Opening balances**: on each employee's record, under _Leave balances_, record an _Opening balance_ for annual leave with a reason. Every entry is kept in the ledger and audited.
5. **Accrual stays off** until HR confirms the rule: the policy says both 25 days a year and 2.3 days a month (27.6). Set the method and tick _Accrual rule confirmed by HR_ in _Change rules_ for annual leave, then run _Monthly accrual_ under _Balance jobs_.

## Balance jobs

Run by hand from Leave types → Balance jobs until scheduling is added in Phase 7:

- **Monthly accrual** for a month (refused while the rule is unconfirmed).
- **Carry forward** at year end: up to the limit (5 days) moves into the next year.
- **Carry-forward expiry**: removes carried days not used by 31 March.

Each job records a run per period and posts ledger entries with unique keys, so running it twice never posts twice.

## API

All routes need a signed-in session; changes need the `X-CSRF-Token` header and accept an optional `Idempotency-Key`.

| Route                                                               | Who                 | Purpose                                              |
| ------------------------------------------------------------------- | ------------------- | ---------------------------------------------------- |
| `GET /api/leave/types`                                              | everyone            | Active leave types and whether the user may use them |
| `GET /api/leave/balances?year=`                                     | everyone            | Own balances and allowances                          |
| `POST /api/leave/requests/preview`                                  | everyone            | Calculate and check without saving                   |
| `POST /api/leave/requests`                                          | everyone            | Submit                                               |
| `GET /api/leave/requests[/:id]`                                     | everyone            | Own requests; detail if allowed to see it            |
| `POST /api/leave/requests/:id/withdraw` · `/resubmit` · `/cancel`   | owner               | Employee actions                                     |
| `GET /api/approvals/manager`                                        | managers, delegates | Manager queue                                        |
| `POST /api/approvals/requests/:id/manager` · `/changes/:id/manager` | manager, delegate   | Decide                                               |
| `GET /api/approvals/hr`                                             | HR Officer          | HR queue                                             |
| `POST /api/approvals/requests/:id/hr` · `/changes/:id/hr`           | HR Officer          | Final decision                                       |
| `GET /api/hr/employees/:id/balances` · `POST /api/hr/balances`      | HR Officer          | Balances, ledger, adjustments                        |
| `/api/admin/leave-types`, `/api/admin/jobs`                         | HR Administrator    | Leave type rules and jobs                            |
