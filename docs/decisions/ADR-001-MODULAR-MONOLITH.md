# ADR-001: Start with a Modular Monolith

- **Status:** PROPOSED
- **Date:** 2026-09-29
- **Related:** `docs/architecture/ARCHITECTURE.md`

## Context
The platform has several complex domains (identity, onboarding, registry, baskets, ledger, planning, execution and reconciliation). Early microservices would add deployment and distributed-consistency overhead before boundaries are validated.

## Decision
Start with a TypeScript modular monolith. Enforce domain boundaries and provider modules in code; add background workers only when a real queue is needed (ADR-006). Split services only when measured operational or organizational needs justify it.

## Consequences
- Simpler initial deployment and transactions.
- Requires discipline to prevent cross-domain coupling.
- Long-running jobs should not block HTTP requests; scheduled database maintenance runs in Postgres (pg_cron, ADR-006) and a worker process is added when a real queue is needed.
- Domain events/outbox can support later extraction.
