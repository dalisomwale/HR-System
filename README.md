# Altus Leave Management System

HR leave management for the Altus Group of companies: employees apply for leave, managers review, HR gives final approval. Backed by MySQL, with Microsoft Entra ID sign-in.

The full specification is in [`docs/project-brief.md`](docs/project-brief.md). It is delivered in seven phases.

## Status

| Phase | Scope                                                                                     | Status                                                                             |
| ----- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1     | Foundations: scaffold, configuration, schema, decisions register, administrator bootstrap | Done; policy extracted from the 29 May 2025 Leave Policy                           |
| 2     | Entra sign-in, sessions, role middleware, HR administration screens                       | Done; Microsoft sign-in verified against the Altus tenant (10 Oct 2026)            |
| 3     | Leave engine: working days, ledger, accrual, validation, state machine                    | Done; leave types await HR review; accrual off until HR confirms (D8)              |
| 4     | Employee, Manager and HR portals                                                          | Done: dashboards, documents, delegation, Altus branding                            |
| 5     | Notifications and email                                                                   | Done; email tested with a stand-in for Microsoft, not yet against the Altus tenant |
| 6     | Reports and exports                                                                       | Done: 13 reports, Excel and CSV exports, audited                                   |
| 7     | Hardening, end-to-end tests, deployment and recovery documentation                        | Not started                                                                        |

Nothing in this repository should be described as production-ready until Phase 7 is complete and the open decisions in [`docs/decisions.md`](docs/decisions.md) are confirmed.

## Getting started

See [`docs/setup.md`](docs/setup.md).

```bash
npm install
npm run migrate
npm run dev        # then open http://localhost:5173
```

## Documentation

- [Setup](docs/setup.md)
- [Microsoft Entra ID setup](docs/entra-setup.md)
- [Email setup](docs/email-setup.md)
- [Architecture](docs/architecture.md)
- [Decisions register](docs/decisions.md)
- [Policy extraction](docs/policy-extraction.md)
- [Leave workflow and first-time setup](docs/leave.md)
