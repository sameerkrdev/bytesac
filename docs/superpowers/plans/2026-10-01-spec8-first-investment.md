# Spec 8 — First Investment and Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** few large tasks (five here), tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle; everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Verified users invest USDC on Solana into investable crypto baskets (Solana, EVM, native BTC) via LI.FI legs they sign themselves; the platform co-signs Solana fees, drops EVM gas and recovers gas via a signed network-fee leg; legs are tracked to settlement into an append-only position ledger; users leave or sell back to USDC at any time.

**Architecture:** migration `0010_positions.sql`; `@repo/validator` `execution.ts` (states, plan math, network fee, schemas); API `providers/routes/{types,lifi}.ts` (`RouteProvider`), `providers/solana-tx.ts` (deserialize/verify/co-sign/submit), `providers/bitcoin.ts` (BIP-322/137 verify, PSBT output checks, Alchemy Bitcoin balances/broadcast), `services/investability.ts`, `services/gas.ts` (platform wallets, drops, budgets), `services/operations.ts` (plan/quote/submit/cancel/leave/sell), `services/positions.ts` (ledger, portfolio, reconciliation), worker jobs `track-leg`, `reconcile-positions`, `gas-wallet-check`; web invest wizard, `/portfolio`, Bitcoin linking, exit dialogs.

**Tech Stack:** Express 5, Drizzle + Postgres, BullMQ (Spec 7 worker), viem (installed), LI.FI REST API (no SDK unless docs require), new pinned deps: a Solana transaction library (`@solana/web3.js` v1 or `@solana/kit` — choose from current docs) and a Bitcoin library (`@scure/btc-signer` preferred; a BIP-322 verifier such as `bip322-js` only if `@scure/btc-signer` cannot verify BIP-322), Reown AppKit Bitcoin adapter (`@reown/appkit-adapter-bitcoin`, same version as other AppKit packages), Next.js 16, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-first-investment-design.md`

## Global Constraints

- Follow existing patterns: Spec 1 add-chain/challenge flow (`services/sign-in.ts`, `services/wallets.ts`, `routes/auth.ts`, challenge state machine), `services/payout-wallets.ts` (wallet proof binding), `services/pricing.ts` (`getPrices`), `providers/evm-rpc.ts` (transport-failure classification → `VERIFIER_UNAVAILABLE`), Spec 7 `queues.ts`/`worker.ts` (`enqueue`, schedulers, deterministic job ids), `middleware/{auth,validate,rate-limit}.ts`, `services/audit.ts`; tests `apps/api/test/*` + helpers; web `components/baskets/*`, `app/(app)/profile/*`, tests `apps/web/test/*`.
- **No extra functions**: no one-caller helpers, no wrappers. The `RouteProvider` interface is justified (Spec 11 adds providers). Invoke `ponytail`.
- **Official docs first** (record what you confirmed): LI.FI `/v1/quote`, `/v1/connections`, `/v1/status`, `/v1/gas/suggestion`, Solana `svmSponsor`, `toAddress`, Bitcoin PSBT flow; Solana versioned transactions (message serialization, adding the fee-payer signature); BIP-322 virtual transactions; Alchemy Bitcoin UTXO API; Reown AppKit Bitcoin adapter (`signPSBT`, `signMessage`).
- **Supply chain:** pin exact versions; newest allowed by pnpm minimum release age; never add `minimumReleaseAgeExclude`.
- **Money:** USDC and token quantities as BigInt raw base units / numeric columns; never JS `number`. Gas estimates may be floats only for display, converted to micro-USDC with BigInt before charging.
- Values exactly: quote expiry 60 s; plan expiry 30 min without a submitted leg; slippage default 100 bps, max 300 bps; network fee = estimated gas USD × 1.2, minimum 0.01 USDC; EVM drop = estimate × 1.5; caps per user/day Solana 0.02 SOL and $5 equivalent per EVM chain, global per day $200 equivalent per chain; confirmations Ethereum 12, Base 10, BNB 15, Arbitrum 10, Polygon 128, Bitcoin 2, Solana `finalized`; leg pending > 30 min → `UNKNOWN`, re-check hourly for 7 days; rate limits 10 operations/h, 60 quotes/min, 10 Bitcoin link attempts/h per user.
- Leg states `PLANNED, SUBMITTED, PENDING_CHAIN, SETTLED, FAILED, UNKNOWN`; operation states `PLANNED, IN_PROGRESS, COMPLETED, PARTIAL, FAILED, CANCELLED`; leg kinds `network_fee, swap, cross_chain`; gas payers `platform_fee_payer, platform_gas_drop, user_btc_inputs`; operation kinds `invest, sell_to_usdc, sell_former`.
- New error codes exactly: `NOT_INVESTABLE`, `NOT_ELIGIBLE`, `OPERATION_IN_PROGRESS`, `QUOTE_EXPIRED`, `TX_MISMATCH`, `PSBT_MISMATCH`, `GAS_BUDGET_EXHAUSTED`, `ROUTE_UNAVAILABLE`, `BTC_ADDRESS_REQUIRED`, `INSUFFICIENT_BALANCE`.
- **Safety:** the user signs every value-moving transaction; the platform fee payer co-signs only byte-identical stored messages; gas drops only from platform gas wallets for planner-built legs within caps; never resubmit or auto-retry a leg; unknown outcomes reconciled; platform keys from env (`SOLANA_FEE_PAYER_SECRET`, `EVM_GAS_WALLET_SECRET`), never logged. **Tests mock LI.FI, RPC, Alchemy and wallets — no real network calls, no real funds.** Never broadcast to a real chain from tests or tooling.
- Runtime DB role: SELECT/INSERT/UPDATE (no DELETE); ledger and reconciliation history append-only.
- Web: dark design system, 44 px, status text + icon, lucide only; no mobile changes. Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`.
- Known issues: Windows vitest worker crash 3221226505 → re-run crashed files alone; `mobile#check-types` fails on `main` already — ignore that task only; never run two suites concurrently.

## Review Focus

1. **Client tampers with a Solana transaction between quote and submit** (changes recipient/amount) → 409 `TX_MISMATCH`, fee payer never signs, nothing submitted; test in Task 2.
2. **Leg submitted, then the tracker can't confirm for 31 minutes** → `UNKNOWN`, no resubmission, operation stays open, hourly re-check later settles it; test in Task 3.
3. **User double-clicks Invest / opens two tabs** → one operation (idempotency key + one active operation per user); second attempt 409 `OPERATION_IN_PROGRESS` or returns the same plan; test in Task 3.
4. **User sells 50% after moving half their tokens elsewhere** → sell quantity = `min(ledger × 50%, wallet balance)`, never more than the wallet holds; test in Task 3.
5. **Gas budget exhausted mid-day** → plan refused before any leg (`GAS_BUDGET_EXHAUSTED`), no partial operation created; test in Task 2.

---

## File Structure

```
packages/validator/src/execution.ts (+ test)        states, plan math, network fee, request/response schemas
packages/validator/src/{chains,errors,index}.ts     bitcoin family; new error codes
packages/db/src/schema/execution.ts                 positions, ledger, operations, legs, gas_drops, platform_wallets, sponsor_usage, position_reconciliations
packages/db/src/schema/{auth,index}.ts               wallet family/method enum additions (bitcoin, bip322, bip137)
packages/db/migrations/0010_positions.sql
apps/api/src/providers/routes/{types,lifi}.ts        RouteProvider + LI.FI
apps/api/src/providers/solana-tx.ts                  versioned tx verify, fee-payer co-sign, submit
apps/api/src/providers/bitcoin.ts                    BIP-322/137 verify, PSBT checks, Alchemy Bitcoin balances/broadcast/confirmations
apps/api/src/services/{investability,gas,operations,positions}.ts
apps/api/src/services/wallets.ts, sign-in.ts         Bitcoin add-chain
apps/api/src/routes/{operations,portfolio}.ts, routes/{baskets,me}.ts
apps/api/src/worker.ts, queues.ts                    track-leg, reconcile-positions, gas-wallet-check
apps/api/src/env.ts                                  LIFI_*, ROUTE_PROVIDER_ORDER, platform wallet secrets, cap overrides
apps/api/test/execution/*.test.ts
packages/api-client/src/client.ts
apps/web/components/invest/*, apps/web/app/(app)/portfolio/page.tsx, apps/web/components/portfolio/*, apps/web/components/profile/bitcoin-link.tsx
apps/web/lib/appkit (Bitcoin adapter registration)
apps/web/test/invest-*.test.tsx, portfolio-*.test.tsx, bitcoin-link.test.tsx
docs/…                                               ADR-014, ADR-013 amend, FUTURE-PLANS, register, domain, README, HANDOFF
```

---

### Task 1: Data, validator, RouteProvider + LI.FI, investability and eligibility

**Files:** create `packages/validator/src/execution.ts` + test, `packages/db/src/schema/execution.ts`, `apps/api/src/providers/routes/{types,lifi}.ts`, `apps/api/src/services/investability.ts`, `apps/api/test/execution/{lifi,investability}.test.ts`; modify `packages/validator/src/{chains,errors,index}.ts`, `packages/db/src/schema/{auth,index}.ts`, `apps/api/src/env.ts`, `apps/api/src/routes/baskets.ts` (or `public.ts` per where basket slug routes live), `packages/api-client/src/client.ts`; migration `0010_positions.sql`.

**Produces:** `LEG_STATES`, `OPERATION_STATES`, `LEG_TRANSITIONS`, `OPERATION_TRANSITIONS`, `splitInvestment(amountMicro: bigint, feeMicro: bigint, weights: {deploymentId, bps}[]): {deploymentId, amountMicro}[]`, `minOut(quotedOut: bigint, slippageBps: number): bigint`, `networkFeeMicro(gasUsd: number[], usdcPrice: string): bigint`, request schemas (`investRequestSchema`, `sellRequestSchema`, `legSubmitSchema`, `bitcoinVerifySchema`), response schemas (`investabilitySchema`, `operationSchema`, `portfolioSchema`); `RouteProvider`, `lifi` implementation; `getInvestability(conn, basketSlug, userId | null)`.

- [ ] **Step 1: Validator.** `chainFamilySchema` gains `bitcoin` only in a separate `addressFamilySchema` (keep the auth `chainFamilySchema` unchanged; Bitcoin is never a sign-in chain). Transition maps (exact):

```ts
export const LEG_TRANSITIONS = { PLANNED: ["SUBMITTED"], SUBMITTED: ["PENDING_CHAIN", "FAILED", "UNKNOWN"], PENDING_CHAIN: ["SETTLED", "FAILED", "UNKNOWN"], UNKNOWN: ["SETTLED", "FAILED"], SETTLED: [], FAILED: [] } as const;
export const OPERATION_TRANSITIONS = { PLANNED: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED", "PARTIAL", "FAILED"], PARTIAL: [], COMPLETED: [], FAILED: [], CANCELLED: [] } as const;
```

  `splitInvestment`: `deployable = amount − fee`; each share `deployable × bps / 10000n`; remainder added to the largest-weight row (ties → first). `minOut = quoted × (10000 − slippageBps) / 10000` (BigInt floor). `networkFeeMicro`: sum of USD estimates × 1.2, converted with the USDC price to micro-USDC via BigInt (scale floats with `Math.round(x × 1e6)` once, then BigInt), floor at 10 000 micro (0.01 USDC). Tests: remainder rule, min-out floor, fee minimum and buffer, state maps.
- [ ] **Step 2: Schema + migration.** Tables per spec §8 in `schema/execution.ts`; wallet enums gain family `bitcoin` and methods `bip322`, `bip137` (check how Spec 1 stores family/method and extend that enum). Partial uniques: one `OPEN` position per `(user_id, basket_id)`; one `PLANNED|IN_PROGRESS` operation per user; unique `(user_id, idempotency_key)`. `pnpm --filter @repo/db db:generate --name=positions`; append grants + RLS (copy from `0009_discovery.sql`); regenerate → "No schema changes"; migrate dev DB.
- [ ] **Step 3: RouteProvider + LI.FI.** `types.ts` interface per spec §5 (`connections`, `quote`, `status`); `lifi.ts` with `fetch` against `https://li.quest/v1` (`x-lifi-api-key`, `AbortSignal.timeout(10_000)`), zod-validated responses; `quote` passes `fromAddress`, `toAddress`, `slippage` (bps/10000), `integrator`, `svmSponsor` (platform fee payer address) when `fromChain` is Solana; returns `{ estimatedOut, minOut, toolSummary, transaction: { kind: "solana", serializedBase64 } | { kind: "evm", to, data, value, chainId } | { kind: "bitcoin", psbtBase64 }, gasEstimateUsd, expiresAt }`; chain/token ids mapped from registry deployments (`ASSET_CHAINS` → LI.FI chain ids; native tokens per LI.FI conventions — confirm from docs). Selection over `env.ROUTE_PROVIDER_ORDER` (default `"lifi"`) filtered by the registry route's provider. `connections` cached in Redis 1 h.
- [ ] **Step 4: Investability + eligibility.** `getInvestability`: spec §4 rules → `{ investable, reasons: { instrumentId?, code, message }[], requiredFamilies, minimumUsdc, eligibility?: { eligible, reasons } }`; eligibility (when a user is given): verified email + phone contacts, linked addresses per required family, no active operation. Route `GET /v1/baskets/:slug/investability` (session optional; eligibility only with session).
- [ ] **Step 5: Tests.** `lifi.test.ts` (fetch mocked): quote request carries `toAddress`/`svmSponsor`; response with a different `toAddress` or token → provider error; status mapping; connections cache. `investability.test.ts`: RWA constituent → reason; missing route → reason; BTC non-native → reason; investable basket; eligibility: unverified phone, missing EVM link, missing BTC link (`BTC_ADDRESS_REQUIRED` reason), active operation.
- [ ] **Step 6: Gate + commit.** `pnpm db:up`; `pnpm turbo run lint check-types test --filter=api... --filter=@repo/validator --filter=@repo/db --filter=@repo/api-client`; commit `feat(api): add execution data, LI.FI route provider and investability`.

---

### Task 2: Bitcoin linking, platform wallets, Solana co-signing, EVM gas drops, budgets

**Files:** create `apps/api/src/providers/{solana-tx,bitcoin}.ts`, `apps/api/src/services/gas.ts`, `apps/api/test/execution/{bitcoin-link,gas,solana-cosign}.test.ts`; modify `apps/api/src/services/{wallets,sign-in}.ts` (add-chain for Bitcoin), `apps/api/src/routes/me.ts`, `apps/api/src/env.ts`, `apps/api/src/middleware/rate-limit.ts`, `packages/api-client/src/client.ts`.

**Produces:** `verifyBitcoinProof({ address, message, signature, method }): boolean`, `checkPsbtOutputs(psbtBase64, expected): void` (throws `PSBT_MISMATCH`), `bitcoinBalance(address)`, `bitcoinTx(txid)`, `broadcastBitcoin(rawHex)`; `cosignAndSubmit(signedBase64, storedMessageHash)` (throws `TX_MISMATCH`), `solanaFinality(sig)`; `reserveGas(tx, { userId, chain, amountNative })` (throws `GAS_BUDGET_EXHAUSTED`), `sendGasDrop(legId, chain, recipient, amountNative)`, `platformAddress(chain, purpose)`.

- [ ] **Step 1: Bitcoin linking.** Challenge reuses Spec 1 challenge issuance with purpose `add_chain` and chain family `bitcoin` (message format per Spec 1); `POST /v1/me/chain-accounts/bitcoin/verify` verifies BIP-322 (P2WPKH, P2TR, P2SH-P2WPKH) via the virtual `to_spend`/`to_sign` construction — client signs `to_sign` with `signPSBT` and posts the signed PSBT; server extracts the witness and verifies — or BIP-137 compact signature for legacy/P2WPKH; then links address (family `bitcoin`, method `bip322|bip137`) with Spec 1 rules (one per user; not linked elsewhere → 409 existing code; audit). Rate limit 10/h per user. Use BIP-322 official test vectors in tests.
- [ ] **Step 2: Platform wallets + budgets.** Seed `platform_wallets` rows at worker/API start from env-derived public addresses (fee payer pubkey, EVM gas address, gas treasury SPL owner `GAS_TREASURY_SOLANA_ADDRESS`). `reserveGas`: inside the caller's tx, `SELECT … FOR UPDATE` the `sponsor_usage` row (insert if missing), compare against per-user cap and global cap (sum of today's rows for the chain, also under an advisory xact lock keyed by chain), add amount or throw `GAS_BUDGET_EXHAUSTED`.
- [ ] **Step 3: Solana co-sign (subtle — exact core):**

```ts
/** Verifies the user-signed transaction is byte-identical to the message we built, then adds the platform fee-payer signature and submits. */
export async function cosignAndSubmit(signedBase64: string, storedMessageHash: string): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64"));
  const messageBytes = tx.message.serialize();
  if (createHash("sha256").update(messageBytes).digest("hex") !== storedMessageHash) throw createHttpError(409, "The transaction changed after it was prepared.", { code: "TX_MISMATCH" });
  if (!tx.message.staticAccountKeys[0].equals(feePayer.publicKey)) throw createHttpError(409, "Unexpected fee payer.", { code: "TX_MISMATCH" });
  tx.sign([feePayer]); // adds only the fee-payer signature; user signatures already present stay valid because the message is unchanged
  return connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 });
}
```

  Adapt to the chosen Solana library's API (keep the logic: hash the serialized message, compare, check fee payer index 0, add signature, send once with no retries). `storedMessageHash` is recorded when the quote's unsigned transaction is returned to the client. Never sign anything whose hash was not stored by the planner.
- [ ] **Step 4: EVM gas drops.** `sendGasDrop`: viem wallet client from `EVM_GAS_WALLET_SECRET` on the Alchemy transport for the chain; skip when the recipient's native balance ≥ amount; `reserveGas` then send; record `gas_drops` (pending → confirmed via receipt); audited. Never more than the computed drop.
- [ ] **Step 5: Tests.** `bitcoin-link.test.ts`: BIP-322 vectors valid/invalid; BIP-137 valid; address already linked to another user → 409; rate limit. `solana-cosign.test.ts` (connection mocked): byte-identical → signed + sent once; altered instruction → `TX_MISMATCH`, `sendRawTransaction` not called (Review Focus 1); wrong fee payer → `TX_MISMATCH`. `gas.test.ts`: per-user cap, global cap under concurrency (two parallel reservations → only one passes when near cap) (Review Focus 5); drop skipped when balance sufficient; drop recorded.
- [ ] **Step 6: Gate + commit.** Filtered gate; commit `feat(api): add bitcoin linking, platform gas wallets and solana fee co-signing`.

---

### Task 3: Operations (invest, sell, leave), tracking, reconciliation, portfolio

**Files:** create `apps/api/src/services/{operations,positions}.ts`, `apps/api/src/routes/{operations,portfolio}.ts`, `apps/api/test/execution/{invest,sell,tracking,reconcile}.test.ts`; modify `apps/api/src/{app,worker,queues}.ts`, `apps/api/src/middleware/rate-limit.ts`, `packages/api-client/src/client.ts`.

**Produces:** `createInvestPlan(ctx, body)`, `quoteLeg(ctx, opId, legId)`, `submitLeg(ctx, opId, legId, body)`, `cancelOperation(ctx, opId)`, `leavePosition(ctx, positionId)`, `createSellPlan(ctx, body)`, `getOperation(ctx, id)`, `getPortfolio(ctx)`, `trackLeg(legId)`, `reconcilePositions(userId?)`, `checkGasWallets()`.

- [ ] **Step 1: Invest plan.** `createInvestPlan`: investability + eligibility (409 `NOT_INVESTABLE` / `NOT_ELIGIBLE`); idempotency (existing operation with same key → return it); amount rules; USDC balance (Alchemy SPL balance) ≥ amount (`INSUFFICIENT_BALANCE`); estimate gas per leg (LI.FI gas suggestion / quote estimates + Solana fee estimate), `networkFeeMicro`, `splitInvestment`; in one tx: `reserveGas` for every platform-paid chain (Review Focus 5 — refuse before inserting the operation), insert operation (`PLANNED`, `expires_at = now() + 30 min`) + legs (`network_fee` first, then asset legs in weight order) + audit. One active operation per user enforced by the partial unique (unique violation → 409 `OPERATION_IN_PROGRESS`) (Review Focus 3).
- [ ] **Step 2: Quote + submit.** `quoteLeg`: leg `PLANNED`, previous leg settled (or `network_fee` submitted for the first asset leg), operation not expired; build: `network_fee` → server-built SPL transfer (user → `gas_treasury`, fee payer platform); asset legs → `RouteProvider.quote` with min-out from slippage; Solana → store `built_message_hash`; EVM → `sendGasDrop` first (status returned; client waits until confirmed) and store expected `to`/`data` hash/`value`; Bitcoin → store expected outputs; set `quote_expires_at`. `submitLeg`: expired → 409 `QUOTE_EXPIRED`; Solana → `cosignAndSubmit`; EVM → fetch tx by hash, verify fields; Bitcoin → `checkPsbtOutputs`, finalize, `broadcastBitcoin`; leg → `SUBMITTED` (`source_tx`), operation → `IN_PROGRESS`; enqueue `track-leg` (`jobId` `leg_<id>`). Every transition validated against `LEG_TRANSITIONS`/`OPERATION_TRANSITIONS` under a row lock on the operation, with audit.
- [ ] **Step 3: Tracking (subtle).** `trackLeg(legId)`: load leg; source finality per spec §10; cross-chain → LI.FI `status` until `DONE`/`FAILED`, then destination tx; `amount_received` from destination balance delta / logs (EVM `Transfer` to the user; Solana token balance change in tx meta; Bitcoin output value to the user's address); on success in one tx: leg `SETTLED`, ledger entry (`invest` +received, `sell` −sold), recompute operation status (`COMPLETED` when all legs settled; `PARTIAL`/`FAILED` per spec §6); if not final yet → throw a retryable error so BullMQ backs off (cap total wait 30 min, then set `UNKNOWN` + `unknown_since` and schedule hourly re-checks via a delayed job `leg_<id>_recheck_<n>` up to 7 days) (Review Focus 2). Never resubmit; never call submit paths from the tracker.
- [ ] **Step 4: Exit.** `leavePosition`: own `OPEN` position → `CLOSED` (`closed_at`), audit; no transactions. `createSellPlan`: position own (open → `sell_to_usdc`, closed → `sell_former`); per deployment quantity = `min(ledger holding × percent / 100, wallet balance)` (Review Focus 4); zero-quantity deployments skipped; legs: per deployment `swap` (Solana) or `cross_chain` (EVM/BTC → USDC on Solana), then `network_fee` last from proceeds (amount computed at plan time; leg quoted when previous legs settled); gas reservations as invest.
- [ ] **Step 5: Reconciliation + portfolio.** `reconcilePositions(userId?)`: balances per deployment (Alchemy SPL/ERC-20/native, Bitcoin UTXO sum); ledger sums across the user's `OPEN` positions; shortfall allocated pro-rata (BigInt; remainder to the largest position) → append `position_reconciliations` rows with `OK|SHORT|SURPLUS`. `getPortfolio`: open positions (holdings, values via `getPrices`, actual vs target weights, latest reconciliation status), open operations, closed positions (former records), cached reconciliation 60 s per user (Redis key). Worker: `reconcile-positions` nightly 02:30 UTC; `gas-wallet-check` every 15 min (warning logs below thresholds).
- [ ] **Step 6: Routes + client.** Spec §11 routes with session + verified-contacts check for operations; rate limits `operationsUser` 10/h, `quotesUser` 60/min. API client methods.
- [ ] **Step 7: Tests.** `invest.test.ts` (LI.FI/RPC/Alchemy mocked): plan creation with network fee first and weights split; idempotent repeat returns the same plan; second operation → `OPERATION_IN_PROGRESS` (Review Focus 3); budget exhausted → no operation row (Review Focus 5); Solana leg quote → submit → `SUBMITTED`; EVM sell leg waits for gas drop; BTC PSBT mismatch → `PSBT_MISMATCH`; expired quote → `QUOTE_EXPIRED`; cancel before submit → `CANCELLED`. `tracking.test.ts`: settled with amount received → ledger entry; failed; timeout → `UNKNOWN`, no resubmit, later recheck settles (Review Focus 2); operation `PARTIAL` when stopped. `sell.test.ts`: percent sell uses `min(ledger × p, wallet)` (Review Focus 4); network fee last; leave closes without transactions; sell former on closed position. `reconcile.test.ts`: `OK`, `SHORT` pro-rata across two positions, `SURPLUS`; history rows appended; grants no DELETE on new tables.
- [ ] **Step 8: Gate + commit.** Filtered gate, then repo-wide `pnpm turbo run lint check-types test` (pre-existing `mobile#check-types` excepted); commit `feat(api): add invest and exit operations, leg tracking and portfolio`.

---

### Task 4: Web — Bitcoin linking, invest wizard, portfolio, exit dialogs

**Files:** create `apps/web/components/invest/{invest-button,invest-wizard,leg-progress}.tsx`, `apps/web/app/(app)/portfolio/page.tsx`, `apps/web/components/portfolio/{positions-list,operation-detail,exit-dialogs}.tsx`, `apps/web/components/profile/bitcoin-link.tsx`; modify the web AppKit setup (register the Bitcoin adapter), `apps/web/app/baskets/[slug]/page.tsx` (Invest button), `apps/web/app/(app)/profile/page.tsx`, app nav (Portfolio), `packages/app-core/src/*` (labels, error copy for new codes).

- [ ] **Step 1: Bitcoin wallet.** Add `@reown/appkit-adapter-bitcoin` (same version as other AppKit packages) to the existing AppKit config; `bitcoin-link.tsx`: connect, request challenge, the server builds the BIP-322 `to_sign` PSBT and returns it with the challenge; the client only calls `signPSBT` and posts the signed PSBT; BIP-137 fallback path when the wallet returns a message signature; success/error states.
- [ ] **Step 2: Invest.** Basket page `invest-button` uses `GET investability`: enabled or reason + action link. `invest-wizard`: amount (min/increment validation), slippage (1–3%), preview (legs, estimated/minimum outputs, routes, "Network fee (paid to Bytesac for gas): $X", "No platform or manager fees are charged yet"), then `leg-progress` per leg: get quote → sign in the right wallet (Solana via AppKit Solana `signTransaction`; EVM via wagmi `sendTransaction` after gas drop confirmation; Bitcoin via `signPSBT`) → submit → poll `GET /operations/:id` until settled; quote expiry message + "Get a new quote"; Bitcoin confirmation-time note; result screen (completed / partial with remaining legs and "Stop here").
- [ ] **Step 3: Portfolio + exit.** `/portfolio`: positions (value, actual vs target weights bar, reconciliation notice for `SHORT`/outside baskets), open operations, history with leg details and explorer links, former positions. Exit dialogs: "Leave basket (keep assets)" (explanation, confirm), "Sell to USDC" (percentage slider/input, preview with network fee from proceeds, then the same leg progress), "Sell former assets".
- [ ] **Step 4: Gate + commit.** `pnpm --filter web lint check-types build`, `pnpm --filter @repo/app-core test`; commit `feat(web): add invest flow, portfolio, exit and bitcoin wallet linking`.

---

### Task 5: Web tests + docs

**Files:** create `apps/web/test/{invest-button,invest-wizard,leg-progress,portfolio,exit-dialogs,bitcoin-link}.test.tsx`, `docs/decisions/ADR-014-EXECUTION-LIFI-GAS.md`; modify `docs/decisions/ADR-013-CUSTODY-EXECUTION-SPEND-AUTHORITY.md`, `docs/decisions/DECISION-REGISTER.md`, `docs/domains/{FUTURE-PLANS,INVESTMENT-REBALANCING-DRIFT-FIX,USER-FEATURES,USER-AUTHENTICATION}.md`, `docs/architecture/ARCHITECTURE.md`, `apps/api/README.md`, `docs/superpowers/HANDOFF.md`.

- [ ] **Step 1: Web tests:** investability states and action links; wizard validation (min/increment, slippage bounds), preview shows network fee and no-fees note; leg progress happy path, quote expiry, partial result + stop; EVM leg waits for gas drop; Bitcoin linking success and BIP-137 fallback; portfolio renders positions, `SHORT` notice, former positions; leave and sell dialogs (percent, network fee from proceeds).
- [ ] **Step 2: Docs (in place).** ADR-014 (LI.FI-only provider behind `RouteProvider`, leg kinds/order, Solana `svmSponsor` co-signing, EVM gas drops, Bitcoin PSBT flow and BIP-322 linking, network fee leg, caps, tracking/finality, reconciliation, consequences, open items spec §16). ADR-013 amended in place: native BTC included (Bitcoin addresses linked via BIP-322), gas paid by platform wallets with a network fee leg, LI.FI route provider. `DECISION-REGISTER.md`: rewrite D-013 (LI.FI only, abstraction), D-032/D-033 (Bitcoin linkable via add-chain, never sign-in), D-012 (Alchemy incl. Bitcoin UTXO API); add `D-067` network fee leg, `D-068` platform gas model and caps, `D-069` investability rules, `D-070` position ledger + reconciliation. `FUTURE-PLANS.md`: LI.Fuel route gas top-up; conventional ETFs/stocks (broker-held; needs custody ADR). Domain docs updated to implemented behaviour; `ARCHITECTURE.md` execution flow + data model; `apps/api/README.md` env (`LIFI_*`, `ROUTE_PROVIDER_ORDER`, platform wallet secrets, `GAS_TREASURY_SOLANA_ADDRESS`, caps), wallet funding and KMS note, manual mainnet test checklist (user); HANDOFF §2 Spec 8 row + §5.
- [ ] **Step 3: Gate + commit.** `pnpm db:up`; `pnpm turbo run lint check-types test build` (pre-existing `mobile#check-types` excepted); commits `test(web): cover invest, portfolio and exit` and `docs: record execution, LI.FI and gas decisions`.

---

## Self-Review Notes

- Spec coverage: §4 → T1 S4; §5 → T1 S3; §6 → T1 S1, T3 S1–S2, S4; §7 → T2 S2–S4, T3 S1; §8 → T1 S2; §9 → T2 S1, T4 S1; §10 → T3 S3, S5; §11 → T1 S4, T3 S6; §12 → T4; §13 → constraints + tests; §14 → per-task tests; §15 → task split; §16 → ADR-014.
- Plan decisions beyond the spec: the server builds the BIP-322 `to_sign` PSBT and returns it with the challenge (client only signs); one active operation per user enforced by a partial unique index; `track-leg` uses BullMQ backoff then delayed re-check jobs for `UNKNOWN`.
- Names consistent: `RouteProvider`, `splitInvestment`, `minOut`, `networkFeeMicro`, `cosignAndSubmit`, `reserveGas`, `sendGasDrop`, `verifyBitcoinProof`, `checkPsbtOutputs`, `createInvestPlan`, `quoteLeg`, `submitLeg`, `trackLeg`, `reconcilePositions`.
