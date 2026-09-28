# Project Documentation and Context Index

This directory is the project’s durable engineering context. Read the relevant docs before making changes. The root `AGENTS.md` makes this mandatory for coding agents.

## Reading order
1. `architecture/ARCHITECTURE.md` — system boundaries and end-to-end behavior.
2. `decisions/DECISION-REGISTER.md` — current decisions and unresolved items.
3. Relevant domain specification:
   - `domains/USER-AUTHENTICATION.md`
   - `domains/MANAGER-ORGANISATION-ONBOARDING.md`
   - `domains/ASSET-REGISTRY.md`
   - `domains/BASKET-CREATION.md`
   - `domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`
   - `domains/USER-FEATURES.md`
   - `domains/FUND-MANAGER-FEATURES.md`
   - `domains/FUTURE-PLANS.md`
4. `engineering/CODING-STANDARDS.md`
5. `engineering/AGENT-GUARDRAILS.md`
6. `engineering/CONTEXT-MANAGEMENT.md`

## Document roles
- **Architecture** explains how the system is divided and how components interact.
- **Domain specifications** describe intended product behavior from supplied project files.
- **Decision register** distinguishes confirmed direction from proposals and open questions.
- **ADRs** record material decisions, context, consequences and status.
- **Coding standards** define implementation conventions.
- **Agent guardrails** define safe autonomous behavior.
- **Context management** defines how docs stay current and how agents load context.

## Source fidelity
The domain files are synthesized from the project source files supplied with this request. They preserve the stated intent but may condense examples. If a specific field, state, permission or edge case is needed, inspect the original source file as well. Do not treat an implementation proposal as an approved product decision unless marked approved.

## Updating documentation
Update the relevant domain document and decision record in the same change as the code when behavior changes. Add an ADR for significant architecture decisions. Record unresolved choices as `OPEN`; do not convert them into facts by implication.

## Current product scope reminder
The supplied material describes an initial focus on crypto assets, crypto tokens and approved RWAs on supported chains. Conventional stocks, ETFs, fixed deposits, recurring deposits, treasuries, commodities, indices, rates/currencies and pre-IPO products appear as future plans unless separately approved.

## Original project source files

The complete supplied project source files are preserved verbatim under `docs/source/`. These are included so that no source details are lost in the synthesized domain documents. When exact field names, edge cases, wording or detailed feature behavior matter, consult the corresponding original source file. Do not replace the originals with summaries.

- `docs/source/User-Authentication-Flow.txt`
- `docs/source/Fund-Manager-&-Organisation-Onboarding-Flow.txt`
- `docs/source/Future-Plans.txt`
- `docs/source/User-Detailed-Features.txt`
- `docs/source/Fund-Manager-Detailed-Features.txt`
- `docs/source/Assets-Registry.txt`
- `docs/source/Basket-Creation.txt`
- `docs/source/First-Investment,-Rebalancing,-Drift-&-Fix.txt`
