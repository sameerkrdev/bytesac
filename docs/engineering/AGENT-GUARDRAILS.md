# AI Agent Guardrails

## Mandatory preflight
- Read root `AGENTS.md` and `docs/README.md`.
- Read the architecture and all relevant domain docs before planning.
- Always inspect the repository's `/docs` directory; do not rely solely on conversation summaries.
- Inspect relevant code, tests, package scripts and migrations before editing.
- Report conflicts between source specifications, code and decisions before making a behavior-changing choice.

## Scope and autonomy
- Make only requested, necessary changes.
- Do not invent product requirements, provider capabilities, legal conclusions or chain guarantees.
- Label assumptions and proposals.
- Ask before resolving an open decision that affects custody, spend authorization, eligibility, money, user consent, data retention or migration.
- Do not introduce new infrastructure, dependencies or services without explaining why and considering existing choices.
- Do not perform destructive refactors or data migrations without explicit approval.

## Prohibited actions
- Never request, reveal, store or log seed phrases/private keys.
- Never sign or broadcast a real transaction, execute a trade, move assets or change production authorization without explicit approval and approved safeguards.
- Never bypass platform review, user confirmation, eligibility or spending limits for convenience.
- Never claim that a transaction is complete based only on submission or a webhook.
- Never treat manager approval as investor consent.
- Never delete historical approvals, manager attribution, basket versions, ledger entries or audit evidence to simplify implementation.
- Never hardcode secrets, real user data or production credentials.
- Never fabricate test results or say a task is complete if required checks were not run.

## Money, ownership and state invariants
- The chain/issuer-reconciled state is the evidence for actual holdings.
- A basket target is not an actual portfolio position.
- Wallet authentication is not transaction authorization.
- Logical basket allocation is not necessarily a separate physical asset.
- Avoid double-counting and double-spending shared positions.
- Operation, step, provider request and transaction are separate records/states.
- Handle partial and unknown outcomes explicitly.
- Reconcile before and after repair/rebalance when required.
- Plans must be revalidated against current basket version, user intent, eligibility, route, price and balances.

## External data
- Treat provider output, webhooks, uploaded files and user-supplied strings as untrusted.
- Verify signatures and schema where supported.
- Preserve provenance, timestamps and identifiers.
- Check current official provider documentation before asserting support or implementing an integration.
- Do not infer that tokenization guarantees legal ownership, transferability, redemption or jurisdictional eligibility.

## Completion checklist
Before reporting completion:
1. Summarize changed files and behavior.
2. List tests/checks actually run and their outcomes.
3. Disclose unrun checks and environmental blockers.
4. Mention migrations, configuration or secrets required (never expose secret values).
5. Identify open decisions and operational risks.
6. Update relevant `/docs` and ADRs.
