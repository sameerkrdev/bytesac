# Project Documentation and Context Index

Bytesac is a manager-led, multi-chain investment-basket platform. Initial settlement currency is **USDC on Solana**, with future currency expansion planned. This directory is the project's durable engineering context; the root `AGENTS.md` makes reading it mandatory for coding agents.

## Reading order

1. `superpowers/HANDOFF.md` — current state, working method, environment traps, next phase and roadmap (start here in a new session).
2. `architecture/ARCHITECTURE.md` — runtime, module layout, data stores, stack.
3. `decisions/DECISION-REGISTER.md` — one line per decision with status; the linked ADR holds the detail.
4. The relevant domain document (current product behavior):
   - `domains/USER-AUTHENTICATION.md`
   - `domains/MANAGER-ORGANISATION-ONBOARDING.md`
   - `domains/ASSET-REGISTRY.md`
   - `domains/BASKET-CREATION.md`
   - `domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`
   - `domains/USER-FEATURES.md`
   - `domains/FUND-MANAGER-FEATURES.md`
5. `engineering/CODING-STANDARDS.md` — conventions, tests and the agent workflow.
6. `engineering/INTEGRATION-AUDIT.md` — third-party integration audit against official documentation (Spec 14): versions, findings, fixes, deferrals.
7. `OPEN-ITEMS.md` — everything still open (user actions, compliance, manual checks, technical debt).
8. `domains/FUTURE-PLANS.md` — deferred scope; not supported until separately approved.
9. `BYTESAC_Design_System.md` — UI design system.

## Document roles (one home per topic)

| Topic | Home |
|---|---|
| Session state, working method, traps, next phase, roadmap, starter prompt | `superpowers/HANDOFF.md` |
| Open work | `OPEN-ITEMS.md` |
| Decisions | ADRs in `decisions/`, indexed by `DECISION-REGISTER.md` |
| Current product behavior | `domains/*.md` |
| Architecture | `architecture/ARCHITECTURE.md` |
| Conventions and agent workflow | `engineering/CODING-STANDARDS.md` and root `AGENTS.md` |
| Provider and library audit (versions, deprecations, live-check evidence) | `engineering/INTEGRATION-AUDIT.md` |
| Deferred scope | `domains/FUTURE-PLANS.md` |
| History (dated, never rewritten) | `superpowers/specs/`, `superpowers/plans/`, `superpowers/reviews/`, `superpowers/audits/`, `superpowers/BRAINSTORM-LOG.md` |

## Source fidelity

The domain files are synthesized from the project source files and may condense examples. If a specific field, state, permission or edge case is needed, read the original in `docs/source/` (verbatim, never edited). Do not treat a proposal as an approved decision unless marked approved.

- `docs/source/User-Authentication-Flow.txt`
- `docs/source/Fund-Manager-&-Organisation-Onboarding-Flow.txt`
- `docs/source/Future-Plans.txt`
- `docs/source/User-Detailed-Features.txt`
- `docs/source/Fund-Manager-Detailed-Features.txt`
- `docs/source/Assets-Registry.txt`
- `docs/source/Basket-Creation.txt`
- `docs/source/First-Investment,-Rebalancing,-Drift-&-Fix.txt`

## Updating documentation

Update the relevant domain document, the register line and the ADR in the same change as the code; rewrite in place (no "update" notes). Record unresolved choices as `OPEN`. Initial scope is crypto assets, crypto tokens and approved RWAs on supported chains; conventional stocks, ETFs, deposits, treasuries and similar are future plans.
