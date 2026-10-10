# Policy Extraction — Leave Policy, Altus Group, 29 May 2025

**Status: incomplete. The policy document has not been supplied.**

Place the document at `docs/policy/altus-leave-policy-2025-05-29.pdf`. Every row below must then be checked against the document, given its clause reference, and completed. Leave types are not created in the database until their rows are complete and HR has confirmed the flagged items. No value in this file may come from general industry practice.

Columns:

- **Clause** — section or paragraph in the policy document.
- **Policy value** — the rule exactly as the document states it.
- **System treatment** — the field or behaviour that implements it.
- **HR confirmation** — Yes when the rule is ambiguous, conflicting, or would drive automation.
- **Statutory check** — comparison with the Employment Code Act No. 3 of 2019 (and later amendments). To be completed against the Act itself; nothing here should be taken as legal advice.

## Annual leave

Values below are taken from the project brief, which summarises the policy. Each must be verified against the document.

| #   | Clause | Policy value (per brief)                                     | System treatment                                                                                                       | HR confirmation  | Statutory check |
| --- | ------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------- |
| A1  | TBC    | Leave year 1 January to 31 December                          | `system_settings.leave_year_start`                                                                                     | No               | TBC             |
| A2  | TBC    | 25 working days per year                                     | `entitlement_days = 25`, `day_basis = WORKING_DAYS`, `entitlement_period = LEAVE_YEAR`                                 | No               | TBC             |
| A3  | TBC    | Accrues at 2.3 days per month                                | `accrual_method` / `accrual_monthly_amount`. Conflicts with A2 (2.3 × 12 = 27.6). Accrual disabled until resolved (D8) | **Yes**          | TBC             |
| A4  | TBC    | Prorated for joiners and leavers                             | `prorate_for_joiners_leavers = 1`; proration method to confirm                                                         | **Yes** (method) | TBC             |
| A5  | TBC    | Leave may be taken as it accrues                             | Available balance = accrued to date + carry-forward − deductions                                                       | No               | —               |
| A6  | TBC    | At least 10 consecutive days should be taken each year       | `min_consecutive_days_target = 10`; reported, not enforced                                                             | No               | —               |
| A7  | TBC    | Maximum 5 days carried forward, to be used by end of March   | `carry_forward_max_days = 5`, expiry 31 March                                                                          | No               | TBC             |
| A8  | TBC    | Apply at least two weeks before commencement                 | `min_notice_days = 14`, `notice_enforcement = WARN_WITH_REASON` (D5)                                                   | **Yes**          | —               |
| A9  | TBC    | Handover notes prepared and signed off by Head of Department | `handover_required = 1`; sign-off at manager stage (D6)                                                                | **Yes**          | —               |
| A10 | TBC    | Public holidays during annual leave                          | Not charged (working-day basis)                                                                                        | No               | TBC             |

## Other leave types

To be extracted from the document. For each type, record: paid or unpaid; working or calendar days; entitlement and period; whether it uses its own balance or none; eligibility (including service length); required documents and when they are due; maximum single duration; back-dating allowed and window.

| Leave type                                                          | Status            |
| ------------------------------------------------------------------- | ----------------- |
| Sick leave                                                          | Awaiting document |
| Compassionate leave                                                 | Awaiting document |
| Family responsibility leave                                         | Awaiting document |
| Study leave                                                         | Awaiting document |
| Maternity leave                                                     | Awaiting document |
| Paternity leave                                                     | Awaiting document |
| Leave without pay (including stated maximum period and eligibility) | Awaiting document |

## Provisions recorded but not automated

| #   | Clause | Provision                                          | Treatment                                                                                                          |
| --- | ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P1  | TBC    | Manager decisions not communicated within one week | Escalation only after 7 days; never auto-approval (D9). **HR confirmation required.**                              |
| P2  | TBC    | Unused leave on termination                        | Recorded only. No salary deductions, payouts or settlement calculations. **HR and Finance confirmation required.** |
