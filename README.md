# Altus Leave Management System

HR leave management for Altus Financial Services Limited: employees apply for leave, line managers review, HR gives final approval. Backed by MySQL, with Microsoft Entra ID sign-in.

The full specification is in [`docs/project-brief.md`](docs/project-brief.md). It is delivered in seven phases.

## Status

| Phase | Scope                                                                                     | Status                                                            |
| ----- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1     | Foundations: scaffold, configuration, schema, decisions register, administrator bootstrap | Done, except the policy extraction (awaiting the policy document) |
| 2     | Entra sign-in, sessions, role middleware, HR administration screens                       | Not started                                                       |
| 3     | Leave engine: working days, ledger, accrual, validation, state machine                    | Not started                                                       |
| 4     | Employee, Manager and HR portals                                                          | Not started                                                       |
| 5     | Notifications and email                                                                   | Not started                                                       |
| 6     | Reports and exports                                                                       | Not started                                                       |
| 7     | Hardening, end-to-end tests, deployment and recovery documentation                        | Not started                                                       |

Nothing in this repository should be described as production-ready until Phase 7 is complete and the open decisions in [`docs/decisions.md`](docs/decisions.md) are confirmed.

## Getting started

See [`docs/setup.md`](docs/setup.md).

```bash
npm install
npm run migrate
npm test
```

## Documentation

- [Setup](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Decisions register](docs/decisions.md)
- [Policy extraction](docs/policy-extraction.md)
