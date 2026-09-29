# Coding Standards

These standards are the default for implementation unless the repository's existing, documented conventions are stricter.

## TypeScript
- Enable `strict` and avoid `any`; use `unknown` at untrusted boundaries and narrow it.
- Prefer explicit domain types and discriminated unions for state machines.
- Avoid broad type assertions and non-null assertions; justify exceptional use.
- Keep public function inputs/outputs typed.
- Use `type` for unions/compositions and `interface` where extension contracts are useful.
- Avoid implicit `enum` serialization; use stable string literal unions or documented enums.

## Project structure
- Organize backend by domain/capability, not only by technical file type.
- Keep HTTP controllers thin: parse/validate, call application services, map results.
- Put business rules in domain/application layers, not controllers or React components.
- Keep provider SDKs and chain-specific logic inside `apps/api/src/providers` (module-level instances configured from env) or chain-specific service modules.
- API layout: `app.ts` exports the configured express `app`, `server.ts` only listens, `env.ts` validates env with envalid; code lives in `middleware/`, `routes/`, `services/`, `providers/`. No app factory or dependency-injection container; tests replace providers with `vi.mock`.
- Shared infrastructure lives in `packages/` (`@repo/db`, `@repo/validator`, `@repo/logger`, `@repo/api-client`, `@repo/app-core`); apps contain only app code.
- Avoid circular dependencies. Dependencies should point inward toward domain contracts.
- Share API schemas/types intentionally; never import server-only packages into clients.

## API and validation
- Validate request params, query strings, bodies and webhook payloads at boundaries.
- Use Zod for all boundary validation; shared request/response schemas live in `packages/validator`, which re-exports zod so every app uses one instance.
- Throw `http-errors` with a stable `code` from `@repo/validator` (`createHttpError(409, "...", { code: "ADDRESS_ALREADY_LINKED" })`); the single error handler builds `{ error: { code, message, details? } }`.
- Log through `@repo/logger` (winston); never log tokens, cookies, Authorization, signatures, OTP codes or full email/phone. Request logs use morgan at the `http` level.
- Read environment variables only in `env.ts` files, validated with envalid; load local `.env` files with Node's `--env-file-if-exists`.
- Internal packages export TypeScript source (`"exports": { ".": "./src/index.ts" }`), have no build step, and use extensionless relative imports.
- Return stable error codes and safe user-facing messages; do not expose stack traces or secrets.
- Use pagination for potentially large collections.
- Make mutating operations idempotent where retries are possible.
- Enforce authentication and authorization on every protected endpoint.
- Document API changes and update client types.

## Database and financial correctness
- Use Drizzle schema and reviewed migrations (in `packages/db`) as the schema source of truth.
- Scheduled database maintenance is a SQL function scheduled with `pg_cron` in a migration, guarded for environments without the extension.
- Never edit production schema manually without a tracked migration.
- Use transactions for multi-row invariants.
- Use exact `numeric`/decimal or integer base units for money and token quantities; never JavaScript `number` for authoritative financial arithmetic.
- Store chain amounts in raw base units where applicable and preserve token decimals.
- Add foreign keys, unique constraints, check constraints and indexes for important invariants.
- Avoid destructive deletion of financial, verification, approval or public-history records; use status changes or tombstones.
- Keep ledger records auditable and append-only where feasible.
- Separate observed balances from logical allocations and pending/reserved amounts.
- Add idempotency and concurrency protection for execution and shared-asset operations.

## Blockchain and provider integrations
- Use a provider interface and adapter per chain/provider capability.
- Normalize data without discarding raw identifiers, provider references or timestamps needed for audit.
- Verify webhook signatures where supported; deduplicate and tolerate out-of-order delivery.
- Treat timeouts as unknown outcomes until reconciled.
- Respect chain-specific finality, confirmation and reorganization behavior.
- Do not blindly retry transaction submission or replay completed operation steps.
- Validate route support, slippage, minimums, fees, limits, expiry and eligibility before execution.
- Never assume all chains support the same signing, delegation, transfer or settlement semantics.

## State machines and domain behavior
- Represent lifecycle states explicitly; avoid arbitrary string status values.
- Centralize allowed state transitions and test invalid transitions.
- Keep operation, operation step, provider request and blockchain transaction states distinct.
- Model partial completion, retryable failure, terminal failure, pending settlement and reconciliation.
- Invalidate/recompute plans when basket version, balances, prices, route, eligibility or pending operations materially change.
- Do not silently change a user's allocation or execute manager updates.

## Security and privacy
- Never log private keys, seed phrases, access tokens, credentials, full sensitive verification documents or unnecessary personal data.
- Use least-privilege credentials and separate public/client configuration from server secrets.
- Sanitize logs and error payloads.
- Store sensitive evidence with restricted access and retention controls.
- Keep authorization checks server-side and test negative permission cases.
- Treat all external data and uploaded content as untrusted.

## React and mobile
- Keep components focused and accessible.
- Separate server state, form state and ephemeral UI state.
- Avoid duplicating authoritative business calculations in the client; display server-calculated plans and validate critical values server-side.
- Handle loading, empty, stale, partial, error and offline states.
- Ensure wallet actions clearly describe what the user is signing and why.
- Keep platform-specific behavior behind shared abstractions where appropriate; do not force false cross-platform uniformity.

## Testing
- Test runner: Vitest (mobile smoke tests: jest-expo).
- Unit-test domain calculations, state transitions and policy decisions.
- Integration-test database transactions, idempotency, adapters and webhook processing.
- Test first investment, rebalance, skip/catch-up, drift, fix, external trades, shared-asset shortages and partial execution.
- Include adversarial tests: duplicate events, stale plans, insufficient funds/gas, route disappearance, price staleness, provider outage, reorg and authorization denial.
- Use deterministic fixtures and mocked provider responses; never use production wallets or funds in tests.
- Add regression tests for every fixed bug.
- Run formatting, lint, typecheck, unit and relevant integration tests before marking work complete.

## Naming and documentation
- Use descriptive names that reflect domain language (`investmentOperation`, `basketVersion`, `instrumentDeployment`).
- Avoid ambiguous names such as `data`, `process`, `handle` for domain services.
- Document non-obvious invariants and security-sensitive decisions.
- Update docs and decision records when behavior changes.
- Keep comments focused on why, constraints and edge cases rather than restating code.
