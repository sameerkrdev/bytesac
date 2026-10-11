# Spec 22 — Batched Signing, User-Paid Solana Gas and Direct-Route Rebalances

- **Status:** APPROVED 2026-10-11 (every `DEFAULT` row in §3 approved as written, including B-16)
- **Date:** 2026-10-11
- **Spec number:** 22 (Spec 21 is the basket page flow on another branch; renumber if needed)
- **Related:** ADR-013, ADR-014, ADR-015, ADR-016, ADR-017; D-067, D-068, D-071, D-072, D-073, D-076, D-079, D-082, D-085, D-089, D-090, D-094, D-108, D-109; `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`; `docs/domains/FUTURE-PLANS.md` ("Batched signing by wallet family", "Direct sell-to-buy pairing", "Wallet-rewritten Solana transactions" option 3); `docs/superpowers/BRAINSTORM-LOG.md` (2026-10-11 rows)

---

## 1. Intent and success criteria

**Problem.** Today every leg is its own wallet popup (ADR-014: one leg at a time, fresh quote, sign, submit). A 50-asset basket is 51 popups. A rebalance goes through the USDC-on-Solana hub (D-076), so the buys cannot be signed until the sells have settled, which adds more popups and waiting.

**Goal.** The user should approve as few wallet popups as the wallets allow, without giving up anything in ADR-013: the user signs every value-moving transaction, assets never leave the user's wallets, and the platform pulls nothing.

**Success criteria**

| # | Criterion |
|---|---|
| S1 | First investment with a sign-only-batch Solana wallet (Phantom, Solflare, Coinbase, Bitget, …): **1 approval per chunk**. A chunk holds K transactions (K from P0); when fees are charged, that is the fee plus K − 1 buys (§5.2). Today it is one approval per leg plus the fee. |
| S2 | Rebalance: popups = 1 Solana + 1 per EVM chain sold on (with `wallet_sendCalls`) + 1 if BTC is sold (+1 Solana only when a hub fallback leg exists). What the user buys adds no popups. |
| S3 | Every failure leaves the money in a known place (§8.1), and the user can **Continue**, **Raise slippage**, **Skip an asset** or **Stop**. An unknown outcome is never resent. |
| S4 | The fee is charged per signing group, only on the legs that group sends. An unsent group is never charged. |
| S5 | A wallet without batching falls back to today's per-leg flow, with nothing lost. Mobile keeps the per-leg flow. |
| S6 | No new custody path: the platform's only money-moving action stays the capped EVM gas drop. The Solana fee payer is retired. |

## 2. Understanding (said vs assumed)

**The user said (2026-10-11):**
- Website only.
- The user pays gas.
- Assets never leave the user's wallets.
- No SOL top-up: when SOL is short, show `SOL_REQUIRED` with the exact shortfall at plan time and again at group quote.
- No LI.FI integrator fee.
- Old platform decisions (hub, per-leg signing) may be set aside.
- Batch by source wallet family.

On 2026-10-11 the user answered "a" to the five open recommendations:
- Fee per chunk.
- Direct routes, with the hub only as a fallback.
- The platform EVM gas drop stays for sells.
- The rebalance fee needs USDC on Solana, otherwise an error.
- Fee riding in an EVM batch. Not adopted; see B-16.

**Assumed (DEFAULT, confirm at review):** every row in §3 marked `DEFAULT`.

## 3. Decisions

| ID | Decision | Source |
|---|---|---|
| B-01 | **Signing groups.** An operation's legs are signed in groups. A group is the legs of one operation that share one source chain, quoted together and approved in one wallet interaction (one chunk). Groups are formed at quote time from `PLANNED` legs in sequence order. | USER |
| B-02 | **Solana sign-only batch is the main path.** The wallet signs every transaction in the chunk (`signAllTransactions`). The server checks every one, claims them all, sends the fee transaction first, waits for `confirmed`, then sends the asset legs in order. It **stops at the first definitive refusal**. | USER |
| B-03 | **The user pays Solana gas in SOL** on every Solana-source transaction: invest, sell, rebalance, repair, recovery, fee transfer, and both the group and per-leg endpoints. LI.FI quotes are requested without `svmSponsor`, and the user's address is the fee payer. A shortfall is 409 `SOL_REQUIRED` with `details: { lamportsRequired, lamportsHeld }`, at plan time and again at group quote. No SOL top-up (D-094 stays). | USER |
| B-04 | **Retire the Solana fee payer:** `svmSponsor`, `sponsorExposure`, co-signing, `quoteSponsorable` (the retry loop over tools that cannot be sponsored), Solana gas caps and reservations, and `SOLANA_FEE_PAYER_SECRET`. This happens in P4, once no open operation has a `platform_fee_payer` leg. Until then, legs planned before the release keep the co-sign path. | USER (approved 2026-10-11) |
| B-05 | **No LI.FI integrator fee.** We keep our own server-built fee transaction (D-089), so a LI.FI transaction is never edited. | USER |
| B-06 | **Fee per group.** Every asset leg gets a fee share at plan time (§6.3). A Solana group's fee transfer charges the uncovered shares of its own legs, and the first Solana group also charges the shares of the plan's EVM and Bitcoin legs, whose gas drop needs a settled fee. A group never sent is never charged. Once sent, a fee is not refunded. This rewrites D-090. Legal review is open (§15). | USER |
| B-07 | **Sign-and-send batch** (wallet broadcasts; for example MetaMask Solana) is a fallback tier. The fee is its own approval first, then the chunk. The server claims before signing and releases on rejection. **Built only if P0 finds a target wallet that cannot sign-only batch.** Otherwise that wallet uses the per-leg tier. | USER (approved 2026-10-11) |
| B-08 | **Failures do not close the operation.** An invest or rebalance with a failed or unsent leg stays `IN_PROGRESS`, with "Needs action": Continue, Raise slippage, Skip asset, Stop. The 5-minute sweep **auto-stops it** without progress and notifies the user, extending D-109: after **24 h** for invest and repair (the leftover is plain USDC), after **7 days** for rebalance and sell (confirmed 2026-10-11). | USER |
| B-09 | **Continue always re-quotes** and rechecks the USDC and SOL balances. Old signed bytes are never reused. If the USDC was spent in the meantime, the user can **invest what's available** (remaining legs scaled down) or stop. | USER |
| B-10 | **Rebalance by direct routes:** each sell is routed straight to a buy in one LI.FI transaction, signed up front. The hub (D-076) is a fallback per pair. This rewrites D-076. | USER |
| B-11 | **Pair planner rules** (§7.1): same-chain pairs first, then greedy matching by value, at most `sells + buys − 1` legs, and legs under the D-077 minimum merged into the largest leg of the same sell. | USER (approved 2026-10-11) |
| B-12 | **A Bitcoin sell has exactly one destination** (one PSBT, one LI.FI destination). It is paired with one buy that can absorb it whole, otherwise it is routed to the hub (USDC on Solana). | USER (approved 2026-10-11) |
| B-13 | **EVM batching** uses EIP-5792 `wallet_sendCalls` with `atomicRequired: false` (the approve and swap calls of every sell on that chain), detected per chain with `wallet_getCapabilities`. Without it, the flow falls back to today's approve-then-swap per leg. | USER (approved 2026-10-11) |
| B-14 | **The platform EVM gas drop stays** for EVM sells: **one drop per EVM group**, sized for every call in the group, sent only after the operation's fee has settled, inside the existing caps (D-068, D-072, D-108). | USER |
| B-15 | **The rebalance fee is paid up front** in the first Solana group, from free USDC or the basket's cash on Solana. If both are short: 409 `INSUFFICIENT_BALANCE` with `details: { usdcRequiredMicro }`, "Add $X USDC on Solana for the rebalance fee". | USER |
| B-16 | **The fee stays on Solana**, even in a rebalance with no Solana sells (a fee-only Solana popup). Putting the fee in an EVM batch is **rejected for now**: the manager's payout wallet is a Solana address (D-006, D-085), and the EVM gas drop needs the fee settled first. This differs from the earlier recommendation; recorded in FUTURE-PLANS. | USER (approved 2026-10-11) |
| B-17 | **Chunk size K** per tier is a constant in `@repo/validator`: `K_SIGN_ALL = 12` and `K_SIGN_AND_SEND = 12` until P0 measures them. | USER (approved 2026-10-11) |
| B-18 | **Continue waives manager and platform fees** for legs already covered (invest) and for the continuation operation (rebalance), recorded as `waivedReason: "continuation"`. The **network fee still applies to new EVM gas drops** (cost recovery). After Stop, D-090 applies: a new plan pays its own fees. | USER (approved 2026-10-11) |
| B-19 | **Repair outcome chooser:** the repair page shows the figures for Buy back (cost), Sync (no transaction, new weights) and Sync then Fix drift (the resulting drift and its trades). A cash shortfall offers Sync only. | USER (approved 2026-10-11) |
| B-20 | **Sync recomputes allocation and drift** in the same request and returns them per affected position. The web then shows Fix drift or Keep custom, or "Still aligned". No transaction and no ledger trade entry. | USER (approved 2026-10-11) |
| B-21 | **Website only.** The web uses group endpoints. Mobile keeps the per-leg endpoints, which stay supported. Mobile Solana legs also become user-paid in P1 under B-03 (confirmed 2026-10-11, knowing mobile Solana signing is not yet device-tested, D-041). A device check of mobile invest with user-paid SOL goes into OPEN-ITEMS with P1. | USER |
| B-22 | **Sell fee placement** stays as in D-071: first from free USDC, otherwise last from the proceeds for Solana-only sells (one extra Solana popup after the sells settle, charging only the shares of legs that settled). A sell with EVM legs and no free USDC is refused, as today. | USER (approved 2026-10-11) |
| B-23 | **Token-account rent is paid by the user** as fee payer: missing destination accounts, and fee-recipient accounts that do not exist yet. It is counted in the SOL requirement. | USER (approved 2026-10-11) |

## 4. Out of scope

- Mobile batching. True merging of several swaps into one Solana transaction (FUTURE-PLANS option 2). Jito bundles.
- Smart-account (ERC-4337) user-operation verification beyond chain evidence (§7.5). EIP-7677 paymasters. Gasless EVM.
- A platform SOL drop, the LI.FI integrator fee, and refunds or credits of fees already sent.
- Re-enabling D-073 (separate pre-launch item, §15).

## 5. Concepts

### 5.1 Tiers

The client reports a tier per group request. The server stores it on the group and uses it only to choose the response shape. Security never depends on it.

| Tier | Family | Wallet call | Who broadcasts | Approvals |
|---|---|---|---|---|
| `sign_all` | Solana | `signAllTransactions` (Reown provider; Wallet Standard `solana:signTransaction` with several inputs) | Server | 1 per chunk |
| `sign_and_send` (B-07) | Solana | Wallet Standard `solana:signAndSendTransaction` with several inputs | Wallet | 1 fee + 1 per chunk |
| `single` | Solana | `signTransaction` per transaction (today) | Server | 1 per transaction |
| `evm_calls` | EVM chain | `wallet_sendCalls` | Wallet | 1 per chain |
| `evm_single` | EVM chain | approve (if needed), then swap, per leg (today) | Wallet | 1–2 per sell |
| `psbt` | Bitcoin | `signPSBT` | Server | 1 |

**Detection on the web:**
- **Solana:** try `sign_all`. If the wallet answers "method not supported" (or the provider lacks the method), downgrade to `single` for the session.
- **EVM:** `getCapabilities` per chain. If the method is missing, use `evm_single`.

A rejected popup (user cancelled) never downgrades the tier.

### 5.2 Approvals estimate

Shown on every plan review as "About N wallet approvals". The server computes it from the tier the client sends, the legs and K:

```
fees    = 1 when the plan charges any fee, else 0      (fee per group, B-06: every chunk with uncovered shares carries its own fee tx)
solana  = sign_all:      ceil(solanaLegs / (K − fees))
          sign_and_send: ceil(solanaLegs / K) × (1 + fees)  (the fee is its own approval before each chunk)
          single:        solanaLegs + fees                  (one fee leg charging every share, §6.5)
evm     = Σ per EVM chain sold on: evm_calls ? 1 : Σ(1 + needsApproval)
bitcoin = 1 if a BTC sell exists
extra   = ceil(hubBuys / K) (hub fallback, §7.1) + 1 (fee-last sell, B-22)
```

A rebalance or sell charges its whole fee in the first Solana group (§6.3), so only that chunk holds a fee transaction.

### 5.3 The SOL requirement (B-03, B-23)

```
need = Σ per Solana tx (5 000 × signatures + ceil(cuLimit × cuPriceMicroLamports / 1 000 000))
     + Σ rent of token accounts the user funds (destination ATAs missing, fee recipients missing, temporary accounts)
     + native SOL sold by the plan
     + SOL_BUFFER_LAMPORTS (1 000 000; keeps the wallet above the 890 880 rent-exempt floor and absorbs wallet priority-fee padding)
```

- **At plan time** the sum is built from estimates:
  - LI.FI `gasCosts` per Solana leg.
  - The known fee transaction.
  - `getAccountInfo` for each destination and recipient account. An RPC error counts as missing, as today.
- **At group quote** it is rebuilt from the decoded transactions. Today's `sponsorExposure` decoding is renamed `solanaCost` and counts the user's costs instead of the platform's.
- **Shortfall:** 409 `SOL_REQUIRED`, `details: { lamportsRequired, lamportsHeld }`. Web: "Add about 0.0042 SOL to your Solana wallet, then continue."

## 6. First investment

### 6.1 Plan

- **Plan legs** are as today: one per constituent. Every leg is Solana-source (USDC on Solana, swap or cross-chain), with `gasPayer: "user_solana"`.
- **Network fee** is 0 for invest, because the platform pays no gas. The fee leg carries only the manager and platform fees, and no fee transaction exists when both are 0 or waived. D-067 now applies only to plans with EVM gas drops.
- **Plan checks:**
  - **USDC:** `balance ≥ amount` (as today).
  - **SOL:** `≥ need` (§5.3), checked at plan time.
- **The response gains:**
  - `approvalsEstimate` (for the tier in the request, default `sign_all`).
  - `solRequiredLamports`.
  - Per-leg `feeShare`.

### 6.2 Group flow, sign-only (`sign_all`)

1. **Request a group.** The client calls `POST /operations/:id/groups { chain: "solana", tier, idempotencyKey }`. Under the operation lock the server:
   - Takes the first `PLANNED` Solana legs in sequence order: K of them, or K − 1 when the group carries a fee transaction.
   - Expires any earlier unclaimed group of the same chain.
   - Builds the group's fee transaction (§6.3).
2. **Quote in parallel.** Each leg is quoted fresh (60 s, no `svmSponsor`), with every ADR-014/017 validation:
   - Token, chain and `toAddress` checks.
   - Minimum tolerance.
   - D-107 impact.
   - Deny lists.
   - RWA re-evaluation.
   - D-073 (pilot waiver kept).

   A leg whose quote fails (`ROUTE_UNAVAILABLE`, `NOT_ELIGIBLE`, …) is **left out of the group** with its error and stays `PLANNED`. The rest of the group continues. If every leg fails, the request answers with the first error.
3. **Recheck balances.**
   - USDC: `≥ group fee + Σ group leg amounts`. The first group of an invest checks the whole amount, as today.
   - SOL: `≥ need`.
4. **Respond.** Ordered transactions `[fee?, leg1..legN]` with each leg's estimate, minimum, route fees and impact, plus `sendBy = quotedAt + 40 s`, stored on the group. A Solana blockhash lives about 60 s from the quote, so `sendBy` leaves at least 20 s to send.
5. **Sign, with no second review screen.** The detailed review happens earlier, on the plan's estimates (§11). Pressing **Confirm** requests the group and opens the wallet straight away.
   - **Prices updated strip.** The web shows the fresh figures in a compact strip with a visible countdown to `sendBy`.
   - **Price moved.** If any leg's fresh minimum is below the plan's stored minimum (possible while the D-073 waiver is on), the wallet does **not** open by itself. The strip asks for an explicit **Accept new prices** tap first.
   - **Submit.** After the wallet signs everything, the client posts `POST /operations/:id/groups/:gid/submit { signed: [{ legId, signedTx }] }`. A submit that arrives after `sendBy` is 409 `GROUP_EXPIRED`: nothing is claimed, and the client gets a new group, which means one more popup.
6. **Verify everything before claiming anything.** For each transaction:
   - The message is byte-identical to the quote, or differs only in ComputeBudget against `preparedBase64` (today's rule).
   - The fee payer at index 0 is the user's Solana address.
   - The user's ed25519 signature verifies (`@noble/curves`).

   Any mismatch is 409 `TX_MISMATCH`: nothing is claimed and nothing is sent.
7. **Claim.** One transaction under the lock moves every leg to `SUBMITTING` with its signature (claim before send, D-071). A leg that changed is refused for the whole group.
8. **Send the fee.** The fee transaction is sent with `maxRetries: 0` and preflight on, then the server waits for `confirmed`, for at most `min(30 s, sendBy − now)`.
   - **Refused:** every claim is released (`PLANNED`, bytes cleared) and the response is 503 `ROUTE_UNAVAILABLE`.
   - **Not confirmed in time:** the fee leg is `SUBMITTED` and tracked. The asset legs are released unsent, and Continue waits for the fee leg to resolve.
9. **Send the asset legs** in order, without waiting for each to confirm. `sendBy` gates only the submit and the fee wait; each leg is gated by its **real blockhash**. A leg is sent only when both hold:
   - `isBlockhashValid(recentBlockhash, { commitment: "confirmed" })` is true.
   - The current block height is at most `quoteBlockHeight + 150 − BLOCKHASH_MARGIN_BLOCKS` (20 blocks, about 8 s).

   `quoteBlockHeight` is the server's `getBlockHeight("confirmed")` at group quote. LI.FI fetches its blockhash at quote time, so the margin is approximate.

   The first leg that fails this check is released unsent, with every later leg (`lastError: "QUOTE_STALE"`), and they return to Continue instead of being sent with a blockhash about to expire. Otherwise:
   - A preflight refusal (`SendTransactionError`) **stops**: that leg and every later one are released to `PLANNED` with bytes cleared, and the refusal is stored as the leg's `lastError`.
   - An unknown send outcome becomes `SUBMITTED` (tracked, never resent), and sending goes on.
10. **Respond.** The operation view comes back. `track-leg` is enqueued per sent leg. The client polls the operation for "Sending 7 of 12 … confirmed 5". Remaining chunks repeat from step 1, with no fee when every share is covered.

The send loop runs inside the request (jobs never move money, D-018). A disconnected client does not stop it.

### 6.3 Fee shares (B-06)

- **Plan time:** the operation's fee rows are computed as today (ADR-016). For each kind, each asset leg gets `feeShare[kind] = floor(total × legBase / Σ legBase)`, with the remainder to the leg with the largest base.
  - The base is the leg's planned micro-USDC value: invest and repair `amountIn`; sells and rebalances the planned sale value used for the fee base.
  - The network fee's shares go only to the EVM legs that need a gas drop, by their own gas estimate.
  - The dust rule (D-086) is applied once, to the operation total, as today.
- **Group time:** the fee transaction charges each kind's sum of uncovered shares of (a) the group's legs and (b) for the first Solana group, every non-Solana leg. A kind summing to 0 is left out. Transfers stay in today's order: network, manager, platform (D-089).
- **Settlement:** when a fee leg settles, its legs get `feeCoveredBy = feeLegId`. A failed fee leg covers nothing. An unknown fee leg blocks sending until it resolves.
- **Fee-last sells (B-22):** the final fee group charges only the shares of legs that settled.
- **Ledger and reports:** `operation_fees` rows stay one per kind per operation, with `amountMicro` the planned total. A new append-only `operation_fee_charges` row is written per fee leg and kind (`amountMicro`, `feeLegId`, `settledAt`, `settledChainAt`). Earnings, revenue and `revenue-reconcile` read charges, not plan rows.

### 6.4 Sign-and-send (`sign_and_send`, only if built per B-07)

1. **Fee first.** When the chunk has a fee, the client gets a group of just the fee transaction:
   - `POST .../groups/:gid/claim` moves the legs to `SUBMITTING` with no signature.
   - The wallet signs and sends.
   - `POST .../groups/:gid/sent { signatures }` records them as `SUBMITTED`.
   - A user rejection calls `POST .../groups/:gid/release`, which returns the legs to `PLANNED`.
   - The client waits until the fee leg is `SETTLED` before requesting the asset chunk.
2. **Asset chunk.** Same claim, then sign-and-send, then `sent`. Order is not guaranteed, so several legs can fail at once.
3. **Wallet error with an unclear outcome:** the server looks up signatures (`getSignaturesForAddress` since the claim) and matches each transaction to a claimed leg by the same message comparison as step 6 of §6.2.
4. **Sweep:** a claim without a signature after 5 minutes gets the same lookup. Found means `SUBMITTED`. Not found, with every blockhash expired, means `FAILED` / `NOT_LANDED`.
5. **After-the-fact mismatch:** the transaction landed but does not match. The leg is tracked from chain evidence, and ops get `tx_mismatch_after_send`.

### 6.5 Single tier

Today's per-leg flow, with user-paid gas: `POST /legs/:legId/quote`, then `signTransaction`, then `POST /legs/:legId/submit`. Submit verifies and sends; there is no co-sign. This is the fallback and mobile's flow. Fee shares apply: the fee leg is quoted as one group of one, charging every share.

## 7. Sell, repair and rebalance

### 7.1 Direct-route planner (B-10, B-11, B-12)

**Input:** the reconciled sells (deployment, quantity, USD value) and buys (deployment, USD value) from today's ADR-015 planner. Thresholds, removed assets, investability and eligibility work as today.

1. **Same-chain pairs.** Per chain, match sells to buys greedily by descending value. Each match is `min(sellLeft, buyLeft)`.
2. **Cross-chain pairs.** Repeat the same matching across chains.
3. **Bitcoin (B-12).** A BTC sell goes whole to the largest remaining buy whose need is at least its value. Otherwise it becomes a hub sell (BTC to USDC on Solana).
4. **Routes.** `RouteProvider.estimate` is called per pair. A pair without a route becomes a hub sell plus a hub buy.
5. **Dust.** A pair leg under the D-077 minimum (`minTradeUsdc`, default 5) is merged into the largest leg of the same sell. A hub buy under it is dropped, and its value stays basket cash.
6. **Sell quantities.** Each sell's quantity is split across its pair legs by value share; the last leg takes the remainder in base units. A pair leg's `minOut` is the estimate's `toAmountMin`.

**Output legs:**
- Pair legs: `fromDeploymentId` and `toDeploymentId` both set.
- Hub sells: `toDeploymentId = null`, to USDC on Solana as basket cash (today's shape).
- Hub buys: `fromDeploymentId = null`, `routeSummary.fromCash`, sized from arrived cash by `buy_scale` (today's mechanism, now used only for hub buys).
- The leg count is at most `sells + buys − 1` plus the hub legs.

**Example:** sell $300 JUP + $200 AAPL(eth), buy $400 BTC + $100 BONK gives JUP→BONK $100 (same chain), then JUP→BTC $200 and AAPL→BTC $200.

### 7.2 Rebalance execution order

| Order | Group | Contents | Waits for |
|---|---|---|---|
| 1 | Solana | Fee (B-15: free USDC or basket cash, else `INSUFFICIENT_BALANCE`) + Solana-source pair legs and hub sells | — |
| 2 | Each EVM chain sold on | Gas drop (B-14), then `wallet_sendCalls`: approve + swap per sell | Fee `SETTLED` |
| 3 | Bitcoin | One PSBT | Fee `SETTLED` |
| 4 | Solana hub buys | Buys sized from arrived cash | Every hub sell final |

- Groups 2 and 3 can be requested in parallel as soon as the fee settles. On a quiet network all popups come back to back.
- A rebalance with no Solana sells still has group 1, holding the fee alone (B-16).

### 7.3 Sell to USDC and Sell former

- Legs per held deployment to USDC on Solana (as today). Groups are formed per source chain.
- Fee placement follows B-22.
- Solana-only sells without free USDC end with a fee-last Solana group, available once every sell is final.

### 7.4 Repair (B-19)

- Buy back stays one operation per short deployment (D-080): fee first, then one buy, signed as one Solana group (1 approval).
- The repair page loads `GET /portfolio/repair/:deploymentId/outcomes`, which returns:
  - **Buy back:** cost and fees.
  - **Sync:** each basket's new quantity and resulting weights and allocation status.
  - **Sync then Fix drift:** the drift trades and an approvals estimate.

  A cash shortfall returns Sync only.

### 7.5 EVM groups (B-13, B-14)

1. **Gas drop.** `POST /operations/:id/groups { chain: "<evm>", tier }`:
   - Before the fee has settled it returns `{ status: "waiting_fee" }`.
   - Otherwise one drop per group (`gas_drops.group_id` unique): Σ per-call gas × 1.5, skipped when the balance already covers it plus any native amount sold.
   - The response is `{ status: "gas_pending" }` until the drop is confirmed. The client polls, as today.
2. **Quotes.** Each sell is quoted in parallel. The response gives the calls in order (`approve` exact amount when needed, then `swap`) with their expected `to`, data hash and value.
3. **Send.** `evm_calls`: the client calls `sendCalls({ calls, atomicRequired: false })`, then `waitForCallsStatus`, and posts `POST .../groups/:gid/submit { txHashes }`.
4. **Server verification** (after the fact, as today for EVM), for each hash:
   - `to` equals an expected call target: compare `from`, `to`, `sha256(data)` and `value` as today.
   - `to` equals the user's own address (EIP-7702): decode the ERC-7821 `execute` batch and match every inner call.
   - Anything else, or an unmatched call: the leg is `UNKNOWN`, ops get `evm_batch_unverified`, and the leg is tracked by chain evidence and never resent.
5. **Approve landed, swap failed:** the leg is `FAILED` with `approvalLeft: true`. Continue reuses the allowance (LI.FI skips the approve call when the allowance is enough), and the needs-action panel offers "Revoke approval": a user-signed `approve(spender, 0)`, which is not a leg.
6. **Fallback.** `evm_single` is today's per-leg flow, sharing the group's single gas drop.
7. **Stop.** Stopping releases the unspent drop budget (D-072, D-108).

### 7.6 Bitcoin

- One group per BTC sell, with one PSBT checked as in D-074.
- There is no batching to do here: one leg means one signature.

### 7.7 Sync (B-20)

- `POST /portfolio/sync` keeps its contract (exact split, `SHORTFALL_CHANGED`, idempotency) and adds `positions: [{ positionId, allocationStatus, maxDriftBps, driftThresholdBps }]`, recomputed with fresh prices in the same request.
- The web then prompts **Fix drift** / **Keep custom** for drifted positions, or "Still aligned".
- A Fix drift after a Sync plans from the synced quantities.

## 8. Failure and continue

### 8.1 Where the money is

| Failure | Money | User sees | Next |
|---|---|---|---|
| Swap reverted (slippage, expiry) | Still the source token (USDC or the sold asset) | "Not bought, $X still in your wallet" | Continue |
| Leg released unsent | Still the source token | "Not sent, nothing spent" | Continue |
| `SOL_REQUIRED` at plan, quote or preflight | Unchanged | "Add ~0.003 SOL, then continue" | Continue after topping up |
| Cross-chain: destination swap failed | Delivered token, or refund in progress | "Arrived as 300 USDC on Ethereum" | Recovery leg (D-096, 1 approval) |
| EVM approve landed, swap failed | Still the token; exact allowance open | "Not sold; approval left open" | Continue or Revoke |
| Fee leg unknown | Tracked | "Confirming fee…" | Wait. Never resent. |
| Leg unknown | Tracked (Solana resolves within ~90 s of blockhash expiry) | "Confirming…" | Wait. Never resent. |

### 8.2 Operation status

- **Recomputed** when a leg reaches a final state:
  - `COMPLETED`: every non-recovery asset leg `SETTLED`.
  - Stays `IN_PROGRESS` with `needsAction: true` while a leg is `PLANNED` with no open group, or `FAILED` with a reason the user can continue from.
- **Ends `PARTIAL` or `FAILED`** only through:
  - **Stop:** `PARTIAL` if any asset leg settled, else `FAILED`.
  - **Auto-stop** (B-08: no leg submitted, quoted or resolved for 24 h (invest, repair) or 7 days (rebalance, sell), audit `operation.auto_stopped`, notice "We stopped your unfinished investment; $X USDC is still in your wallet").
  - **Every remaining leg skipped.**
- `CANCELLED` stays "before any submission".
- The one-open-operation-per-user rule is unchanged, so an operation needing action blocks new plans until Continue or Stop. The web shows it on every invest and sell entry point.

### 8.3 Continue — invest, repair, sell

`POST /operations/:id/continue { idempotencyKey, slippageBps?, skipLegIds?, scaleToAvailable? }`, under the operation lock:

1. **Refused (409 `OPERATION_IN_PROGRESS`)** while any leg is `SUBMITTING`, `SUBMITTED`, `PENDING_CHAIN` or `UNKNOWN`.
2. **Skips.** `skipLegIds` legs (`PLANNED` or definitively `FAILED`) become `FAILED` / `SKIPPED`. Their USDC stays free, outside the basket.
3. **Retry legs.** Each other definitively `FAILED` leg (not `DESTINATION_SWAP_FAILED`, not `SKIPPED`) gets a new `PLANNED` leg with:
   - `retry_of` (unique).
   - The same route ends and amount.
   - `feeShare` and `feeCoveredBy` copied, so a covered leg pays no fee again (B-18).
4. **Slippage.** `slippageBps` (1–300) updates the operation.
5. **Balances.** USDC is checked against `Σ remaining amounts + uncovered fee shares`, SOL against `need`.
   - Short USDC without `scaleToAvailable`: 409 `INSUFFICIENT_BALANCE` with `{ usdcRequiredMicro, usdcHeldMicro }`, and the web offers "Invest what's available".
   - With it: remaining amounts and uncovered shares are scaled by `available / needed` (floor, remainder to the largest), and a leg scaled to 0 is `SKIPPED`.
6. **Return.** The operation view comes back; the client requests groups as in §6.2.

### 8.4 Continue — rebalance (continuation operation)

- **Same request.** Under the user's plan lock, in one transaction:
  1. The old operation becomes `PARTIAL` (or `FAILED`).
  2. A new `rebalance` operation is planned **from current reconciled holdings** to the same target version, with `continuation_of = old.id` (unique).
  3. Manager and platform fee rows are recorded as waived `continuation`. A network fee is charged only for new EVM gas drops.
- **Newer version published:** Continue is refused with 409 `INVALID_TRANSITION`, "A newer version is available. Stop and review the update."
- **Nothing left to trade:** the old operation ends, and the version is recorded if the position is now aligned (D-077 `aligned`).

### 8.5 Rules for every path

- Old signed bytes are never reused. Continue never resends an unknown leg.
- Recovery (D-096) stays separate from Continue and keeps its own 7-day auto-stop.
- Stop releases unsent claims, open groups and unspent EVM gas budget.

## 9. Data model (migration `0025_signing_groups.sql`)

| Change | Detail |
|---|---|
| `operation_groups` (new) | `id`, `operation_id` FK, `chain` (`asset_chain`), `tier` (enum `sign_all`, `sign_and_send`, `single`, `evm_calls`, `evm_single`, `psbt`), `status` (enum `QUOTED`, `CLAIMED`, `SENT`, `EXPIRED`, `RELEASED`), `fee_leg_id` FK null, `expires_at`, `send_by` (quote time + 40 s), `wallet_name` text null (at most 64 characters, client-reported, telemetry only), `idempotency_key`, `created_at`, `updated_at`. Unique `(operation_id, idempotency_key)`. Partial unique index: one `QUOTED`/`CLAIMED` group per `(operation_id, chain)`. |
| `operation_legs` | + `group_id` FK null (latest group that quoted it), + `fee_share` jsonb `{ network?, manager_entry?, manager_rebalance?, platform? }` micro strings, + `fee_covered_by` FK → `operation_legs` null, + `retry_of` FK unique null, + `last_error` text null. Pair legs need no column: both deployments are set, and the planner (not a constraint) keeps them to rebalances. |
| `gas_payer` enum | + `user_solana`. |
| `operations` | + `continuation_of` FK unique null, + `needs_action_since` timestamptz null (auto-stop clock). |
| `operation_fees` | `waived_reason` accepts `continuation`. |
| `operation_fee_charges` (new, append-only) | `id`, `operation_id`, `fee_leg_id`, `kind`, `recipient_address`, `amount_micro`, `settled_at`, `settled_chain_at`. |
| `gas_drops` | `leg_id` nullable, + `group_id` FK unique null, check exactly one of the two. |
| Grants/RLS | As in earlier migrations: SELECT/INSERT/UPDATE, no DELETE. |

Backfill: none. Existing operations keep their legs. A `platform_fee_payer` leg keeps the co-sign path until P4.

## 10. API

| Method and path | Purpose | Notes |
|---|---|---|
| `POST /v1/operations/invest`, `/sell`, `/rebalance`, `/repair` | Plan | + `tier` hint in the body (optional); response + `approvalsEstimate`, `solRequiredLamports`, per-leg `feeShare`. Rebalance plans use §7.1. |
| `POST /v1/operations/:id/groups` | Form and quote the next group for a chain | Body `{ chain, tier, walletName?, idempotencyKey }`. Response `{ groupId, status: "quoted" \| "waiting_fee" \| "gas_pending", expiresAt, sendBy, priceMoved, transactions[], legs[] (estimatedOut, minOut, routeFees, priceImpact, error?), approvalsEstimate }`. |
| `POST /v1/operations/:id/groups/:gid/submit` | Verify, claim and send (sign-only, PSBT) or verify after the fact (EVM) | Body `{ signed: [{ legId, signedTx }] }`, `{ txHashes: string[] }` or `{ signedPsbt }`. |
| `POST /v1/operations/:id/groups/:gid/claim`, `/sent`, `/release` | Sign-and-send (B-07) | Only if built. |
| `POST /v1/operations/:id/continue` | §8.3, §8.4 | Idempotent per key. Returns the operation (or the continuation operation). |
| `POST /v1/operations/:id/cancel` | Stop | Unchanged path; also releases open groups. |
| `GET /v1/operations/:id` | View | + `groups[]`, `needsAction`, per-leg `feeCoveredBy`, `retryOf`, `lastError`, `approvalLeft`; `fees[]` + `charged[]`. |
| `GET /v1/portfolio/repair/:deploymentId/outcomes` | B-19 | |
| `POST /v1/portfolio/sync` | B-20 | Response + `positions[]`. |
| Per-leg `quote` / `submit` | Mobile and `single` tier | Kept. |

- **Error codes:** new `GROUP_EXPIRED` (409). `SOL_REQUIRED` and `INSUFFICIENT_BALANCE` gain `details`. Existing codes are otherwise reused.
- **Rate limits:** group quote shares the leg-quote limiter, counting each leg.
- **Validation:**
  - Every body has a Zod schema in `@repo/validator`.
  - `signed[]` at most `K_SIGN_ALL` entries, base64 at most 1232 bytes decoded per transaction.
  - `txHashes` at most 2 × legs in the group.
- **Route table snapshot:** updated for the new paths.

## 11. Web

- **`@repo/app-core`:**
  - `Signer` gains optional `signSolanaAll(txs)`, `signAndSendSolanaAll(txs)` and `sendEvmCalls({ chainId, calls })`. Mobile does not implement them, so it stays on the per-leg flow.
  - A new `group-signer.ts` reducer and runner, next to `leg-signer.ts`: `idle → quoting → waitingFee | gasPending → (priceMoved →) signing → sending → tracking → done | needsAction | failed`, with tier downgrade on "method not supported". There is no review state between quote and wallet (§6.2 step 5).
- **`apps/web/lib/wallet`:**
  - Solana batch through the Reown Solana provider's `signAllTransactions`.
  - EVM through wagmi `sendCalls`, `waitForCallsStatus` and `getCapabilities` (installed `wagmi` 2.19.5; confirm against wagmi docs).
- **Review screen (plan estimates, before Confirm).** The user reads the details here at their own pace: no quote is open yet, so nothing can expire. Confirm then requests the group and opens the wallet (§6.2 step 5). Contents:
  - "About N wallet approvals".
  - A SOL line ("Network fees: about 0.004 SOL, paid by you in SOL").
  - Per-leg estimate, minimum, route fees and impact.
  - Fee lines "charged per batch; batches you never send aren't charged".
  - For groups above 10 legs, a checkbox "I've checked the minimum amounts" (§15 Q6).
- **Prices updated strip:** the fresh figures per leg, compact, with a countdown to `sendBy`. When a fresh minimum is below the plan's, it holds an **Accept new prices** button and the wallet waits for it.
- **Stop is prominent everywhere.** While an operation needs action, every invest, sell, rebalance and repair entry point shows a banner: "Finish or stop your open <investment>", with **Continue** and **Stop**. A new plan is blocked until then (one open operation per user).
- **Wallet telemetry.** At Confirm, the client sends `walletName` (the Reown wallet info name, at most 64 characters) and the detected tier per chain with the group request. The server stores both on `operation_groups` and logs `group.quoted { walletName, chain, tier, legs, approvals }`. No addresses are sent or logged. A tier downgrade shows as the next group's lower tier. This tells us how many users get the 1-popup flow and whether B-07 is worth building.
- **Progress panel:** groups with "Sending 7 of 12", per-leg status, and confirmations.
- **Needs-action panel:** the failed leg's reason, plus Continue, Raise slippage (to at most 3%), Skip `<asset>`, Stop, Invest what's available, and Revoke approval. "Continue is free until <auto-stop time>; stopping keeps fees already paid." The time shown is the auto-stop deadline (24 h or 7 days, B-08).
- **Errors:**
  - `SOL_REQUIRED` with the exact shortfall.
  - `INSUFFICIENT_BALANCE` with the USDC needed.
  - `GROUP_EXPIRED` with "Quotes expired — get new quotes".
- **Repair chooser (B-19)** and the **post-Sync prompt (B-20)**.

## 12. Testing

API (Vitest; LI.FI, RPC and wallets mocked):

- **Planner (§7.1):**
  - Same-chain first.
  - Leg bound `sells + buys − 1`.
  - Dust merge.
  - BTC single destination, and the BTC fallback to the hub.
  - Missing pair route goes to the hub.
  - Removed asset sold in full.
  - Thresholds (D-077).
- **Fee shares and group fees:**
  - Sums and remainder.
  - Network shares only on drop legs.
  - First Solana group carries the non-Solana shares.
  - Fee-last sell charges only settled legs.
  - `continuation` waiver.
  - No manager fee on drift, repair or sell (ADR-016).
  - `operation_fee_charges` feeds earnings and `revenue-reconcile`.
- **SOL requirement:**
  - ATA exists or is missing.
  - Temporary wSOL.
  - Native SOL sold.
  - Buffer.
  - Plan time versus group quote recheck.
  - Mid-batch preflight failure.
- **Group quote:**
  - Parallel quoting.
  - One leg's `ROUTE_UNAVAILABLE` leaves the leg out without sinking the group.
  - Idempotency.
  - One open group per chain.
  - Expiry gives `GROUP_EXPIRED`.
  - Concurrent quote, submit and cancel under the lock.
- **Submit, sign-only:**
  - Verify all before claiming any.
  - `TX_MISMATCH` claims nothing; a ComputeBudget-only change is accepted.
  - Wrong fee payer and bad signature are refused.
  - Fee first and confirmed before any asset leg.
  - Fee not confirmed releases the asset legs.
  - Stop after the first definitive refusal: unsent legs go to `PLANNED` with bytes cleared.
  - Unknown goes to `SUBMITTED`, never resent, and sending continues.
  - A submit after `sendBy` gives `GROUP_EXPIRED` and claims nothing.
  - The fee wait is capped at `sendBy`.
  - A leg whose blockhash is invalid, or inside the 20-block margin, is released as `QUOTE_STALE` together with every later leg.
  - A leg after `sendBy` with a still-valid blockhash is still sent.
  - `priceMoved` is set when a fresh minimum is below the plan's.
  - `walletName` and tier are stored and logged, with no address in the log.
- **Submit, sign-and-send (if built):**
  - Claim before sign, release on reject.
  - Signature lookup on an ambiguous error and in the sweep.
  - `NOT_LANDED` after blockhash expiry.
  - Mismatch alert after the fact.
- **EVM:**
  - `waiting_fee` and `gas_pending`.
  - Group drop sizing, unique key, sent only after the fee settled, cap, release on Stop.
  - Per-call hash verification.
  - EIP-7702 `execute` decoding.
  - An unmatched call makes the leg `UNKNOWN` and raises an alert.
  - Approve landed but swap failed, and its Continue.
- **Continue:**
  - Invest retry legs with no double fee.
  - Skip.
  - Raise slippage.
  - Balance recheck and `scaleToAvailable`.
  - Refused while a leg is in flight.
  - Rebalance continuation planned from current holdings.
  - Refused after a newer version.
  - Auto-stop after 24 h (invest, repair) and after 7 days (rebalance, sell), with its notice.
- **Ledger:**
  - Pair leg debit and credit from chain evidence only.
  - Hub cash entries.
  - Recovery accounting (ADR-017) for pair legs.
- **Reconciliation:** skips in-flight pair legs on both deployments.
- **Sync (B-20):**
  - No transaction or trade entry.
  - Allocation and drift returned per position.
  - `SHORTFALL_CHANGED` and idempotency unchanged.
- **Repair outcomes (B-19):** the three paths' figures; a cash shortfall gives Sync only.
- **Regression:**
  - Per-leg endpoints with user-paid gas (mobile).
  - A pre-release `platform_fee_payer` leg still co-signs.
  - Route-table snapshot.
  - No-cycles.

Web (Vitest):
- Tier detection and downgrade.
- `signSolanaAll` / `sendEvmCalls` wrappers.
- Group-signer reducer transitions.
- Review approvals estimate and SOL line.
- Progress and needs-action actions.
- `SOL_REQUIRED` / `INSUFFICIENT_BALANCE` / `GROUP_EXPIRED` rendering.
- Repair chooser and post-Sync prompt.

E2E (`apps/web/e2e`, mocked API):
- Invest happy path.
- Partial invest, then continue.
- Rebalance across several chains.

## 13. Order of work

| Phase | Scope | Size |
|---|---|---|
| **P0 – wallet test** | A dev-only page `/dev/wallet-batch` (behind an env flag, never in production builds) that asks the connected wallet to sign batches of 2/5/10/20/30 memo-only Solana transactions (`sign_all`, and `sign_and_send` where offered) and EVM `wallet_sendCalls` of N zero-value self-calls, then records the following per wallet: popup count, rewritten bytes, max batch, order on sign-and-send, behaviour on a reverting call. The **user** runs it on mainnet with their own tiny amounts (Phantom, Solflare, Backpack, MetaMask Solana, Coinbase, Bitget, OKX, Trust via WalletConnect; EVM: MetaMask, Coinbase, Rabby, Phantom EVM, Trust, OKX on the 5 chains). LI.FI with a real key: Solana quotes without `svmSponsor`, ERC-20→Solana token and Solana token→BTC direct routes. **Output:** the tier matrix, K per tier, and whether B-07 is needed. | 2–3 days |
| **P1 – first investment** | §5, §6 (groups, fee shares and charges, SOL requirement, user-paid Solana gas on every flow incl. per-leg), §8.2–§8.3 for invest, §9 migration, §10 group and continue endpoints, §11 invest UI (estimate-first review, prices-updated strip, `sendBy` rule, Stop banners, wallet telemetry). | ~2 weeks |
| **P2 – sell, exit, repair** | §7.3, §7.4, §7.5, §7.6 on groups; EVM group gas drop; Continue for sells and repair; B-19, B-20. | ~1 week |
| **P3 – rebalance and drift fix** | §7.1, §7.2, §8.4: direct-route planner, pair legs and ledger, `wallet_sendCalls`, hub fallback, continuation operations. | ~3 weeks |
| **P4 – cleanup** | Retire the Solana fee payer (B-04) once no open operation uses it; docs, ADRs, register, OPEN-ITEMS, HANDOFF. | ~3 days |

Each phase is its own plan → execute → review → merge cycle (HANDOFF §4).

## 14. Docs to update with the code

- **ADR-023** (new) records this design and links to the rewritten sections:
  - ADR-014: sequencing becomes signing groups; Solana gas becomes user-paid; EVM drops are per group.
  - ADR-015: the hub becomes direct routes with a hub fallback; continuation operations.
  - ADR-016: fee per group and `operation_fee_charges`; D-090 wording.
  - ADR-017: recovery gas becomes user-paid on Solana.
- **`DECISION-REGISTER.md`:**
  - Rewrite in place D-067, D-068, D-072, D-076, D-079, D-082, D-089, D-090 and D-094.
  - New rows for B-01 … B-23 as approved.
- **`docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`**, `ARCHITECTURE.md` §4, `docs/OPEN-ITEMS.md` (P0 results, open defaults), `docs/superpowers/HANDOFF.md`.
- **`FUTURE-PLANS.md`:**
  - Remove "Batched signing by wallet family", "Direct sell-to-buy pairing" and option 3 once built.
  - Add the fee-in-EVM-batch idea (B-16) and true multi-swap merge.
- **Help and fees copy:** "You pay Solana network fees in SOL; Bytesac covers EVM gas for sells and recovers it in the network fee."

## 15. Open questions (carry into the implementation plan)

1. ~~Confirm the `DEFAULT` rows~~ — approved 2026-10-11, including B-16.
2. Tune K per tier and `sendBy` (40 s, `GROUP_SEND_WINDOW_MS`):
   - from P0, which measures how long each wallet takes to sign a 12-transaction batch;
   - then from production telemetry: `group.quoted`, `group.expired` and `leg.released { reason: "QUOTE_STALE" }`. Is a user allowed more than 60 s in the wallet for a big chunk? If not, K is smaller (blockhash and quote expiry).
3. Re-enable the D-073 price guard before public launch (pilot waiver).
4. Legal and fees review of per-group charging (B-06) against the published "charged up front, not refunded" wording (D-090).
5. LI.FI rate limits for parallel quoting (12 quotes per group, ×chains).
6. Blind-signing risk: a wallet shows N transactions, so our screen must carry the totals and minimums. Is the checkbox above 10 legs right?
7. ERC-4337 smart wallets (Coinbase Smart Wallet) under `wallet_sendCalls`: tracked by chain evidence only (§7.5) until P0 shows their receipt shape.
8. An operation needing action blocks new plans for up to 24 h (invest, repair) or 7 days (rebalance, sell) (B-08). Stop banners on every entry point (§11) soften this. Per-asset reservations stay in FUTURE-PLANS.

## Sources

- [Phantom: sending transactions](https://docs.phantom.com/solana/sending-a-transaction), [Phantom priority fees](https://docs.phantom.com/developer-powertools/solana-priority-fees)
- [MetaMask Solana batch](https://docs.metamask.io/metamask-connect/solana/guides/batch-transactions/), [wallet_sendCalls](https://docs.metamask.io/metamask-connect/evm/reference/json-rpc-api/wallet_sendCalls.md), [wallet_getCapabilities](https://docs.metamask.io/metamask-connect/evm/reference/json-rpc-api/wallet_getCapabilities.md)
- [Solflare signAllTransactions](https://docs.solflare.com/solflare/technical/deeplinks/provider-methods/signalltransactions), [Coinbase Wallet Solana](https://docs.cdp.coinbase.com/coinbase-wallet/solana-developers/injected-solana-provider/sending-transactions), [Bitget Solana](https://web3.bitget.com/en/docs/connect/mainnet/solana/), [Brave Solana](https://wallet-docs.brave.com/solana/provider-api/methods), [OneKey Solana](https://developer.onekey.so/en/connect-to-software/provider/solana/sending-a-transaction/), [WalletConnect Solana](https://docs.walletconnect.com/wallets/chains/solana)
- [Solana partial signing](https://solana.com/docs/core/transactions/partial-signing), [Solana batch payments](https://solana.com/docs/payments/send-payments/payment-processing/batch-payments)
- [EIP-5792 wallet list](https://www.eip5792.xyz/ecosystem/wallets), [ERC-7821](https://eips.ethereum.org/EIPS/eip-7821), [Alchemy: EIP-7702 and wallets](https://www.alchemy.com/overviews/eip-7702-metamask-and-wallets.md)
- [LI.FI multi-step Solana with Jito bundles](https://li.fi/knowledge-hub/how-li-fi-lands-multi-step-transactions-on-solana-with-jito-bundles)
- Installed: `@reown/appkit-adapter-solana` 1.8.24 providers expose `signAllTransactions` and single `signAndSendTransaction`; `wagmi` 2.19.5 exports `useSendCalls`, `useCapabilities`, `useWaitForCallsStatus`.
