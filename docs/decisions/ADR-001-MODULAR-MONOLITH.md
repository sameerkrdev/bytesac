# ADR-001: Start with a Modular Monolith

- **Status:** PROPOSED
- **Date:** 2026-09-29
- **Related:** `docs/architecture/ARCHITECTURE.md`

## Context
The platform has several complex domains (identity, onboarding, registry, baskets, ledger, planning, execution and reconciliation). Early microservices would add deployment and distributed-consistency overhead before boundaries are validated.

## Decision
Start with a TypeScript modular monolith and separate background workers. Enforce domain boundaries and adapter interfaces in code. Split services only when measured operational or organizational needs justify it.

## Consequences
- Simpler initial deployment and transactions.
- Requires discipline to prevent cross-domain coupling.
- Long-running jobs should run in workers rather than blocking HTTP requests.
- Domain events/outbox can support later extraction.
