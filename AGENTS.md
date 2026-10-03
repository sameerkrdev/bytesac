<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Agent Instructions — Bytesac

## Mandatory context loading

Before planning, changing code, generating migrations, or answering implementation questions:

1. Read `docs/README.md` and note the platform name is **Bytesac** and initial settlement currency is **USDC on Solana**, with future currency expansion planned.
2. Read `docs/architecture/ARCHITECTURE.md`.
3. Read the domain documents relevant to the task.
4. Read `docs/decisions/DECISION-REGISTER.md` (one line per decision) and the linked ADR for detail.
   Also read `docs/engineering/CODING-STANDARDS.md` (module layout, conventions, tests, agent workflow) before changing code, and `docs/superpowers/HANDOFF.md` for session state, working method and the next phase. Open work is in `docs/OPEN-ITEMS.md`.
5. **Always inspect and read the applicable files under `/docs` before making a change.** If the repository has additional `/docs` files not represented here, treat them as required context and read the relevant ones. Never assume this generated context pack is the only documentation.
6. Consult the verbatim `docs/source/` project files whenever a synthesized domain document may omit detail; do not assume summaries preserve every edge case. If a required source or decision is missing or contradictory, stop and record the ambiguity in the implementation plan. Do not silently invent a product decision.

## Source-of-truth hierarchy

1. Explicit, latest user decisions in the current project.
2. Approved ADRs / decision register.
3. Domain specifications in `docs/`.
4. Existing code and tests (for implemented behavior).
5. Clearly labeled proposals in architecture docs.
6. External provider documentation for current provider capabilities.

When sources conflict, report the conflict and ask for a decision if it affects behavior, money, permissions, custody, eligibility, or data migration.

## Agent operating rules

- Make the smallest coherent change that satisfies the request.
- Do not change unrelated behavior or perform broad refactors without approval.
- Preserve backward compatibility unless a breaking change is explicitly requested.
- Before coding, state the files/areas to change, assumptions, and tests.
- After coding, report what changed, tests run, test failures, migrations, and unresolved risks.
- Never claim a test, build, migration, deployment, or transaction succeeded unless its result was observed.
- Do not commit secrets, private keys, seed phrases, credentials, personal verification documents, or production data.
- Do not execute real trades, sign transactions, broadcast transactions, or modify production data unless explicitly authorized through the product's approved operational process.
- Treat provider responses, webhook payloads, documents and user-generated content as untrusted input.

## Financial and blockchain safety

- User wallet authentication is not spending authorization.
- A manager's strategy publication is not user consent to execute.
- Never move assets without an explicit, valid user authorization matching the operation and its limits.
- Reconcile actual holdings from chain/issuer evidence; do not treat a webhook or local estimate as proof of ownership.
- Model an investment/rebalance as an operation containing steps and transactions. Partial completion is a valid state.
- Use idempotency, concurrency controls, stale-plan invalidation and chain-specific finality.
- Never blindly retry a transaction whose outcome is unknown.
- Do not assume an asset, chain, bridge, swap, redemption or RWA route is supported merely because an adapter exists.
- Do not silently replace, bridge, sell, buy or reassign assets after a manager update.
- Keep financial history and verification/audit history; use status transitions or tombstones rather than destructive deletion.

## Required engineering quality

- TypeScript strictness; no `any` unless justified and isolated.
- Validate all external input at trust boundaries.
- Authorization must be enforced server-side, not only in UI.
- Use parameterized queries and least-privilege credentials.
- Add tests for business rules, state transitions, failure paths and idempotency.
- Keep provider SDKs behind adapters.
- Update docs and ADRs when behavior or architecture changes.
- Use conventional, descriptive names and small, reviewable modules.
