# Spec 22 P1b — Faster Landing and MetaMask Sign-and-Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A batched first investment no longer stalls on a slow fee transaction (spec §16, B-24 to B-26).
- MetaMask on Solana needs 2 approvals instead of one per transaction (B-27, which builds B-07 from §6.4).

**Architecture:**
- **Fee transaction (server-built):** right-sized compute (200 000 CU) and a market-based priority price.
- **Rebroadcast:** Solana sends use the RPC's default rebroadcast, and the fee's identical bytes are re-sent every 2 s while the server waits.
- **Next group:** gated on the previous fee being `confirmed` on chain (not `SETTLED`), with a "fee confirming" 409 the web retries.
- **Tracking:** first backoff 5 s.
- **Sign-and-send tier:**
  - The server claims a group before the wallet signs, records the signatures the wallet returns, and releases the claim on a clear rejection.
  - A sweep resolves claims that never got a signature by looking up the user's recent signatures and matching messages.
  - The web picks this tier for MetaMask through the Wallet Standard `solana:signAndSendTransaction` feature.

**Tech Stack:** Express 5, Drizzle, Zod, `@solana/web3.js` 1.99.0 (`getRecentPrioritizationFees`, `getSignatureStatuses`, `getSignaturesForAddress`, `getTransaction`, `isBlockhashValid`), BullMQ, Next 16 + Reown AppKit 1.8.24, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-batched-signing-direct-routes-design.md` §16 (B-24 to B-27), §6.4, §6.2, §6.3.

## Global Constraints

- **Fee transfer (B-24):**
  - `USER_FEE_CU_LIMIT = 200_000`.
  - Price = 75th percentile of the non-zero `prioritizationFee` values from `connection.getRecentPrioritizationFees({ lockedWritableAccounts: [<user USDC ATA>] })`, clamped to `[16_001, 2_500_000]` µlamports. An RPC error or no non-zero values gives `16_001`.
  - Applies only to `payer: "user"`. The platform-paid builder keeps 1 400 000 / 16 001.
- **Rebroadcast (B-25):**
  - `sendSolana` sends with `{ skipPreflight: false }` and no `maxRetries`, so the RPC rebroadcasts until expiry.
  - `solanaConfirmed(signature, waitMs, raw?)` re-sends `raw` every 2 000 ms while it polls (send errors ignored).
  - Never re-sign, rebuild or replace a transaction. An unknown outcome is never re-planned.
- **Next group (B-26):**
  - A fee leg counts as "landed" when `getSignatureStatuses([sourceTx])` shows `confirmed`/`finalized` with `err === null`.
  - A group request while the previous fee is unconfirmed is 409 `OPERATION_IN_PROGRESS` with `details: { reason: "fee_confirming" }`.
  - The web retries every 1 000 ms for up to 60 000 ms.
  - Track-leg first-pass backoff: `{ type: "exponential", delay: 5_000 }` (was 15 000).
- **Fee coverage rule** (needed once groups proceed at `confirmed`): a leg is covered when `feeCoveredBy` is set **or** its id is in `routeSummary.covers` of a `network_fee` leg of the same operation whose status is not `FAILED`. Group fees charge only uncovered shares.
- **Sign-and-send (B-27, §6.4):**
  - `K_SIGN_AND_SEND = 12`.
  - With a fee to charge, a `sign_and_send` group holds **only** the fee transfer, covering the next `K_SIGN_AND_SEND` `PLANNED` Solana asset legs. The following group (requested after the fee is confirmed) holds those asset legs with no fee.
  - With nothing to charge, the group is the asset chunk.
- **Signatures:** base58 strings that decode to exactly 64 bytes; one per claimed leg, in the order of the group's `transactions`.
- **Web tier choice:** `SIGN_AND_SEND_WALLETS = ["MetaMask"]` (exact Reown `walletInfo.name`), and the connected Wallet Standard wallet exposes `solana:signAndSendTransaction`. Otherwise today's `sign_all` / `single` logic applies.
- Copied from P1 (unchanged):
  - Claim before send; verify before claim on server-sent tiers.
  - The runtime role has no DELETE.
  - No new dependencies, exact pins.
  - Lean code (no one-caller helpers, no wrappers).
  - Tests one file at a time with `< /dev/null`.
  - Never stage `.claude/settings.json`, `.gitignore`, `apps/api/.env.example`, `firebase-service-account.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`, or `.superpowers/**`.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Python is not installed; files are CRLF.
  - Branch `feat/spec22-p1b-landing`.

## Review Focus

1. **Double charge after B-26.** A single-tier or sign-and-send flow requests the next group while the fee leg is `SUBMITTED` but confirmed, before the tracker sets `feeCoveredBy`. The covered legs must not be charged again. Test in Task 1 (`next group after a confirmed fee does not re-charge covered legs`).
2. **The wallet broadcast some transactions, then threw.** The claim stays (no release on a non-rejection error). The sweep finds the landed signatures by message match and sets `sourceTx`; unmatched legs whose blockhash is invalid become `FAILED`/`NOT_LANDED`, and nothing is resent. Test in Task 1 (`sweep resolves a claim without signatures`).
3. **`/sent` with a signature for a leg outside the claimed group, a duplicate, a malformed signature, or a count mismatch.** 400/409, nothing recorded. Test in Task 1.
4. **Priority-fee RPC failure, or an absurd value.** Falls back to the floor, or is clamped to the cap; the SOL requirement reflects the actual price. Test in Task 1.
5. **A MetaMask user who cancels the first popup.** `/release` returns the legs to `PLANNED` and no tier downgrade happens; a second attempt works. Test in Task 2.

---

### Task 1: API — fee pricing, rebroadcast, confirmed gating, coverage rule, sign-and-send endpoints and sweep

**Files:**
- Modify: `apps/api/src/providers/solana-tx.ts`, `apps/api/src/config/queues.ts`
- Modify: `apps/api/src/modules/operations/groups.service.ts`, `operations.route.ts`, `operations.controller.ts`
- Modify: `apps/api/src/modules/portfolio/tracking.service.ts` (the sweep for unsigned claims, and the after-the-fact message check for `sign_and_send` legs)
- Modify: `packages/validator/src/execution.ts` (`groupRequestSchema.tier` adds `"sign_and_send"`; `groupSentSchema`; `SIGN_AND_SEND_WALLETS` constant lives in web, not here)
- Modify: `packages/api-client/src/client.ts` (`claimGroup`, `sentGroup`, `releaseGroup`)
- Modify: `apps/api/test/helpers/chain-mocks.ts` (`getRecentPrioritizationFees`, `getSignaturesForAddress`, `getTransaction` mocks)
- Test: `apps/api/test/modules/operations/groups.test.ts` (extend), new `apps/api/test/modules/operations/sign-and-send.test.ts`
- Update the route-table snapshot (3 new paths)

**Interfaces (produced):**
- `groupSentSchema = z.strictObject({ signatures: z.array(z.strictObject({ legId: z.uuid(), signature: z.string().min(80).max(90) })).min(1).max(K_SIGN_AND_SEND) })` (the server also checks that the base58 decodes to 64 bytes)
- Routes, all under `requireSession` and verified contacts like the others, with the `submitsUser` limiter:
  - `POST /v1/operations/:id/groups/:groupId/claim` (empty body)
  - `POST /v1/operations/:id/groups/:groupId/sent` (`groupSentSchema`)
  - `POST /v1/operations/:id/groups/:groupId/release` (empty body)
- Client: `claimGroup(id, groupId): Promise<OperationView>`, `sentGroup(id, groupId, body): Promise<OperationView>`, `releaseGroup(id, groupId): Promise<OperationView>`

- [ ] **Step 1: Write the failing tests.**
  1. **Fee price.** The fee transfer built at group quote has `SetComputeUnitLimit(200 000)`, and its price is the p75 of the mocked fees.
     - Mock `[0, 5_000, 20_000, 40_000, 90_000]`: p75 of the non-zero values is 40 000.
     - An RPC throw gives 16 001.
     - A value of `9_000_000` is clamped to 2 500 000.
     - `solRequiredLamports` changes accordingly.
  2. **Send options.** `sendRawTransaction` is called with `{ skipPreflight: false }` and no `maxRetries`.
  3. **Rebroadcast while waiting for the fee.** Mock statuses: two polls with `null`, then `confirmed`. The fee's raw bytes are sent 1 + 2 times (fake timers advance 2 s per poll), and the buys are sent after that. Nothing else is resent.
  4. **Confirmed gating:**
     - The fee leg is `SUBMITTED` with status `null`: requesting the next group is 409 with `details.reason === "fee_confirming"`.
     - With status `confirmed`, the next group is created.
     - With status `confirmed` and `err` set, it is 409 `OPERATION_IN_PROGRESS` with no `fee_confirming` reason. The tracker decides later.
  5. **Coverage rule (Review Focus 1).** A single-tier operation: the fee-only group's fee leg is `SUBMITTED` and confirmed. The next group (one asset leg) carries **no** fee transaction. A third group also carries none.
  6. **Sign-and-send, fee first:**
     - With tier `sign_and_send` and 14 legs, the first group's `transactions` is `[fee]`, and `routeSummary.covers` lists the first 12 asset legs.
     - `claim` moves the fee leg to `SUBMITTING` with `sourceTx` null and the group to `CLAIMED`.
     - `sent` with the wallet's signature gives the leg `SUBMITTED` with `sourceTx` set, the group `SENT`, and `track-leg` enqueued.
     - After the fee is confirmed, the next group holds 12 asset legs and no fee; claim and sent for 12 signatures.
     - The third group holds the last 2 legs plus a fee covering them.
  7. **`/sent` validation (Review Focus 3).** Each of these is 400 or 409 and records nothing:
     - a signature for a leg not in the group;
     - a duplicate `legId`;
     - a base58 string that does not decode to 64 bytes;
     - fewer signatures than claimed legs, when the client marks the batch complete. **Rule:** `/sent` may record a subset, and the legs left without a signature stay claimed for the sweep.
     - `sent` on a group that is not `CLAIMED`.
  8. **`release`.** Claimed legs without `sourceTx` go back to `PLANNED`, with `builtMessageHash` and `expectedTx.preparedBase64` cleared, and the group becomes `RELEASED`. `release` after `sent` changes nothing for legs that have a signature.
  9. **Claim checks.** `claim` after `sendBy` is 409 `GROUP_EXPIRED`. Two concurrent `claim` calls give one 200 and one 409.
  10. **Sweep (Review Focus 2):**
      - A claimed leg without `sourceTx`, older than 2 minutes. `getSignaturesForAddress(owner)` returns three signatures; `getTransaction` for one returns a message equal to the leg's prepared message, or a ComputeBudget-only difference. That leg gets `sourceTx` and `SUBMITTED`, and `track-leg` is enqueued.
      - A claimed leg with no match and `isBlockhashValid === false` becomes `FAILED`/`NOT_LANDED`.
      - With no match and the blockhash still valid, nothing changes.
  11. **After-the-fact mismatch.** The tracker's first check of a `sign_and_send` leg whose landed message is not the prepared one (non-ComputeBudget difference) writes audit `leg.tx_mismatch_after_send` and `logger.error`. Tracking continues on chain evidence.
  12. **Tracker backoff.** The `track-leg` job is enqueued with `backoff.delay === 5_000`.

- [ ] **Step 2: Run them and see them fail.** `pnpm --filter api exec vitest run test/modules/operations/sign-and-send.test.ts < /dev/null`, then `groups.test.ts`.

- [ ] **Step 3: Implement.**
  - **`solana-tx.ts`:**
    - `buildFeeTransfer` for `payer: "user"` uses `USER_FEE_CU_LIMIT` and `await feePriceMicro(ownerUsdcAta)`. `feePriceMicro` is used once inside `buildFeeTransfer`, so inline it: `getRecentPrioritizationFees`, take the non-zero values, sort, `p75 = values[Math.floor((values.length - 1) * 0.75)]`, then clamp.
    - `sendSolana` drops `maxRetries: 0`.
    - `solanaConfirmed(signature, waitMs, raw?: Uint8Array)` re-sends `raw` every 2 000 ms (`.catch(() => {})`) while polling.
  - **`groups.service.ts`:**
    1. Change the in-flight fee gate to the signature-status rule. A confirmed fee does not block.
    2. Apply the coverage rule in the fee-share sum:

```ts
// A leg is covered once a fee that lists it is on its way (not FAILED); waiting for SETTLED would charge it twice now that groups proceed at `confirmed`.
const covering = new Set(legs.filter((l) => l.kind === "network_fee" && l.status !== "FAILED").flatMap((l) => ((l.routeSummary?.covers ?? []) as string[])));
const uncovered = (l: Leg) => !l.feeCoveredBy && !covering.has(l.id);
```

    3. Add `tier === "sign_and_send"` group forming: a fee-only group when shares are uncovered, otherwise the asset chunk.
    4. Add `claimGroup`, `sentGroup` and `releaseGroup`, all under `lockOperation`:
       - **`claimGroup`:** group `QUOTED` and `sendBy > now`, then legs `PLANNED` → `SUBMITTING` with `sourceTx: null`, group → `CLAIMED`. Also clear `needsActionSince`.
       - **`sentGroup`:** each signature must belong to a claimed leg of this group without `sourceTx` and decode to 64 bytes. Set `sourceTx`, call `markSubmitted`, and enqueue `track-leg`. The group becomes `SENT` when every leg has a signature.
       - **`releaseGroup`:** legs `SUBMITTING` without `sourceTx` → `PLANNED`, bytes cleared, `lastError: "WALLET_REJECTED"`; the group → `RELEASED`.
  - **`tracking.service.ts`:**
    - Extend `trackStaleClaims`: for `SUBMITTING` legs with `sourceTx` null and `updatedAt` more than 2 minutes ago, group them by owner. Call `getSignaturesForAddress(owner, { limit: 50 })`, keep signatures whose `blockTime` is after the claim, `getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })`, and match messages with the existing `sameExceptComputeBudget` against `expectedTx.preparedBase64` (export it from `solana-tx.ts`; it now has two callers).
      - A match sets `sourceTx` and `SUBMITTED`, and enqueues tracking.
      - No match with an invalid blockhash gives `FAILED`/`NOT_LANDED`.
      - Each claim is handled in its own try/catch, like the other sweeps.
    - The first `trackOnce` of a `sign_and_send` leg runs the message check (Step 1 case 11).
  - **`queues.ts`:** the first-pass `track-leg` `delay: 5_000`.
  - **Routes and controller:** the three routes, plus the snapshot.

- [ ] **Step 4: Run the tests and see them pass.** Run `sign-and-send.test.ts`, `groups.test.ts`, `continue.test.ts`, `user-paid-gas.test.ts`, `invest.test.ts`, `tracking.test.ts`, `recovery.test.ts`, `route-table.test.ts` and `no-cycles.test.ts`, one at a time. Then `pnpm --filter api check-types` and `lint`, validator tests, and api-client check-types.

- [ ] **Step 5: Commit.** `feat(api): right-sized fee tx, rebroadcast, confirmed gating and sign-and-send groups (spec 22 B-24..B-27)`.

### Task 2: Web — MetaMask sign-and-send tier, fee-confirming retry, docs

**Files:**
- Create: `apps/web/lib/wallet/standard-wallets.ts`. Move the Wallet Standard discovery out of `apps/web/lib/wallet-lab.ts`, so it returns wallet objects (`{ name, features, accounts }`) and the lab and the signer share it (two callers).
- Modify: `apps/web/lib/wallet-lab.ts`, `apps/web/components/dev/wallet-lab.tsx` (use the shared discovery)
- Modify: `packages/app-core/src/leg-signer.ts` (`Signer.signAndSendSolanaAll?(serializedBase64: string[]): Promise<Uint8Array[]>`, which returns the raw 64-byte signatures in input order; app-core encodes them to base58 with its existing `bs58` dependency)
- Modify: `packages/app-core/src/group-signer.ts` (+ test): the `sign_and_send` tier, and the `fee_confirming` retry
- Modify: `apps/web/lib/wallet/use-leg-signer.ts` (`signAndSendSolanaAll` and the tier choice), `apps/web/components/invest/invest-flow.tsx` (pass the tier), `apps/web/components/invest/group-progress.tsx` ("Confirming fee…" state)
- Test: `packages/app-core/src/group-signer.test.ts`, `apps/web/test/group-flow.test.tsx`, `apps/web/test/wallet-lab.test.ts` (still green after the move)
- Docs:
  - ADR-023 (B-24 to B-27).
  - `DECISION-REGISTER.md`: new rows D-127 to D-130, and rewrite D-090/D-123 where they mention SETTLED gating.
  - `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md` (approvals: MetaMask 2).
  - `docs/OPEN-ITEMS.md`: a manual check of MetaMask's 2-popup flow; extend `SIGN_AND_SEND_WALLETS` from telemetry.
  - BRAINSTORM-LOG entry (already written by the controller; do not duplicate).

**Interfaces:**
- `SIGN_AND_SEND_WALLETS = ["MetaMask"] as const` in `use-leg-signer.ts`.
- **Tier choice:** `walletName` is in the list and the connected standard wallet has `solana:signAndSendTransaction`, giving `"sign_and_send"`. Otherwise `"sign_all"` (which downgrades to `single` as today).
- **`signAndSendSolanaAll`:**
  - Find the standard wallet with the name from `walletName`.
  - `account = wallet.accounts.find((a) => a.address === linked("solana"))`, otherwise `WrongWalletError`.
  - Call `wallet.features["solana:signAndSendTransaction"].signAndSendTransaction(...txs.map((t) => ({ account, chain: "solana:mainnet", transaction: fromBase64(t) })))`.
  - Return `outputs.map((o) => o.signature)` as raw bytes. Web has no `bs58` dependency; `runGroup` in app-core encodes them.
- **`runGroup` for `sign_and_send`:**
  1. `requestGroup`, then (Accept new prices), then `claimGroup`, then `signer.signAndSendSolanaAll(txs)`, then `sentGroup({ signatures })`, with each signature `bs58.encode`d by app-core.
  2. On `WalletRejectedError`, `releaseGroup` and end `failed` with `WALLET_REJECTED` (no downgrade).
  3. On any other error, end `failed` with code `OUTCOME_UNKNOWN` ("Confirming with the network — don't sign again"), with **no** release. The server sweep resolves it.
- **Drive loop:** on 409 `OPERATION_IN_PROGRESS` with `details.reason === "fee_confirming"`, wait 1 000 ms and request again, for up to 60 000 ms, showing "Confirming fee…".

- [ ] **Step 1: Write the failing tests.**
  - **app-core:**
    1. `sign_and_send` calls `claimGroup` before the wallet, and `sentGroup` with the signatures in transaction order.
    2. Rejection calls `releaseGroup`, with no downgrade.
    3. Another error ends `OUTCOME_UNKNOWN` with no release.
    4. `fee_confirming` is retried until it passes, and fails after 60 s (fake timers).
  - **web:**
    1. MetaMask with the feature present uses tier `sign_and_send` and makes 2 wallet calls for 1 fee group plus 1 asset group.
    2. Phantom still uses `sign_all`.
    3. "Confirming fee…" renders while it is retrying.

- [ ] **Step 2: Implement**, per the Interfaces above.

- [ ] **Step 3: Gates.**
  - `pnpm --filter @repo/app-core test`
  - web `lint`, `check-types`, `exec vitest run --maxWorkers=2`, `build`
  - `pnpm --filter mobile test`: only the two known failing suites may fail.

- [ ] **Step 4: Docs** in place, as listed under Files.

- [ ] **Step 5: Commit.** `feat(web,app-core): MetaMask sign-and-send batches and fee-confirming retry (spec 22 B-24..B-27)`, plus `docs:` if separate.
