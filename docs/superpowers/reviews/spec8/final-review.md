# Spec 8 final review (first investment and exit)

Branch `feat/spec8-first-investment`, 545b187..da3d30f. Reviewer: Opus, read-only. I read every API source file in the diff (operations, positions, gas, solana-tx, evm-rpc, bitcoin, LI.FI, investability, routes, migration 0010, validator execution and chains), the web signer, leg progress and Bitcoin link, ADR-014, the ADR-013 amendment, the register and README diffs, and both implementer reports.
Tests I ran: `lifi.test.ts` 12/12, `invest.test.ts` 15/15 (Docker Postgres). I also ran a one-line node check that confirms C1.

Counts: **1 Critical, 8 Important, 14 Minor.**

---

## Critical

### C1. The LI.FI quote schema rejects every real quote, so the feature cannot work in production
`apps/api/src/providers/routes/lifi.ts:50`: `amount: z.string().regex(/^d+$/).nullish()`. The backslash is missing, so the pattern only matches strings of the letter `d` (`new RegExp("^d+$").test("21000000000") === false`). Real LI.FI `estimate.gasCosts[]` entries always carry `amount`, so `parse()` fails and every `quote()` throws `ROUTE_UNAVAILABLE`. Plans, per-leg quotes and sells all fail.
The tests miss it because the only fixture (`test/execution/lifi.test.ts:23`) has `gasCosts` with `amountUSD` only, and the integration tests mock the provider (`chain-mocks.ts`), so `gasNative` is never parsed from a realistic body.
**Fix:** use `/^\d+$/`. Add `amount` (and a realistic `token`) to the LI.FI fixture. Assert that `gasNative` is summed, because it drives gas reservation and drop size.

---

## Important

### I1. One stuck leg locks the user out of every operation, including exits
`operations.ts:410` refuses cancel while any leg is `SUBMITTED`, `PENDING_CHAIN` or `UNKNOWN`. `operations_one_active_per_user` then blocks every new invest or sell. So any leg that never settles locks the user out with no way back. Five ways to get there:
- **A dropped Solana transaction is never marked FAILED.** `cosignAndSubmit` sends once with `maxRetries: 0`, which makes drops common on mainnet. After an unknown send outcome the leg is recorded `SUBMITTED` with the deterministic signature. `solanaFinality` (`solana-tx.ts:75-80`) returns `pending` forever for a signature that never landed. The leg goes `UNKNOWN`, gets 168 hourly rechecks, then is "left for ops". Nothing checks blockhash expiry (`lastValidBlockHeight`), which would make this a definite `FAILED`.
- **`received <= 0` sets UNKNOWN and schedules no recheck.** `positions.ts:101-104`: the next recheck is never enqueued, so the leg stays `UNKNOWN` permanently.
- **One provider or RPC error ends the recheck chain.** Recheck jobs run with `attempts: 1` (`queues.ts`), and the next recheck is only enqueued by a successful run (`positions.ts:51`). In the first window, if all 12 attempts fail before the 30-minute mark (for example LI.FI `INVALID`, which `lifi.ts:113` throws every time, or a missing `destinationTx` passed to `solanaReceived("")`), the leg stays `SUBMITTED` with nothing tracking it.
- **A replaced EVM transaction is never resolved.** If the user speeds up or cancels the transaction in their wallet, the submitted hash never mines and the leg stays `UNKNOWN`.
- **A replaced or double-spent Bitcoin transaction is never resolved.** `finality()` cannot return `failed` for Bitcoin.

Concrete scenario: the user's first invest leg is dropped under congestion. They cannot invest or sell anything for 7 days, and after that only an ops person can free them. The exit guarantee (spec §1.4) is broken.
**Fix:**
- Store `lastValidBlockHeight` with each Solana quote. In the tracker, when the signature is not found and the current block height is past it, mark the leg `FAILED`.
- Always enqueue the next recheck in a `finally`, including on error and on the `received <= 0` path.
- Add an ops resolve command.
- Decide whether the user may stop an operation while a leg is `UNKNOWN` (see "Needs user decision").

### I2. A transaction is broadcast before the leg is claimed, so cancel, re-quote and submit can race
`submitLeg` verifies and broadcasts first (`operations.ts:365-391`) and only then takes the operation lock (`:393-399`). Two failures follow:
- **Double execution.**
  1. Submit A co-signs and sends.
  2. Before A records `SUBMITTED`, the user (a second tab or a script) calls `/quote`. The leg is still `PLANNED`, so a new `builtMessageHash` is stored.
  3. The user signs and submits B, and the server sends it too.
  4. Both swaps execute: the fee payer pays twice and the user's USDC is spent twice.
  5. B's DB transaction finds the leg no longer `PLANNED` and returns silently (`:396`), so B's signature is lost and the transaction is never tracked or put in the ledger.
- **Cancel during submit.** Cancel sets the operation `CANCELLED` while every leg is still `PLANNED`. The submit then writes the leg `SUBMITTED` inside the cancelled operation, because `setLegStatus` never checks the operation's status. The leg settles and writes a ledger entry under a `CANCELLED` operation, the user's one-active slot is already free, and "CANCELLED only before any submission" is violated.

**Fix:** claim before sending. Under the operation lock, re-check that the operation is operable and that the leg is `PLANNED` with the same `builtMessageHash` or `expectedTx`. Then move the leg to a claim state: a new `SUBMITTING` status, or set `source_tx` to the deterministic signature or txid with a guard column. Send only after that commit. `/quote` and `/cancel` must refuse a claimed leg. For EVM, also add a unique index on `(from_chain, source_tx)`.

### I3. Gas budget: reservations leak on cancel, gas drops can be farmed, and the global cap can be exhausted for free
- **Reservations are never released.** `insertPlan` reserves gas at plan time (`operations.ts:149`), and nothing releases it on `CANCELLED` or expiry. The wizard's Back button and the sell dialog's Back both cancel (report 2, ruling 8), so an ordinary user who goes back and forth a few times uses up their own 0.02 SOL per day and cannot invest that day.
- **The global cap can be exhausted at no cost.** The global cap (`gas.ts:19-27`, about 1.33 SOL per day for Solana) is consumed by plans that never touch the chain. About 70 verified accounts doing plan then cancel (10 per hour each) exhaust it, and every user on the platform then gets `GAS_BUDGET_EXHAUSTED` for invest and sell until UTC midnight. The same works on each EVM chain.
- **EVM gas drops can be farmed.** `quoteLeg` sends the drop (`operations.ts:323-326`) before the user signs anything. The user can plan an EVM sell, call quote, receive the drop, cancel (nothing was submitted, so the operation is `CANCELLED`) and keep the gas, then repeat. This is bounded by the per-user cap (about $5 per chain per day, so about $25 per account per day across 5 chains), and the global cap ($200 per chain) is exhaustible.

**Fix:**
- Release the unspent Solana reservation (plan estimate minus fees actually sent) when an operation reaches `CANCELLED` or expires.
- Keep EVM drops counted once sent, and require a confirmed network-fee commitment or a prior settled leg before dropping, or drop only after the user has signed (EVM cannot do this).
- Add a per-user cap on drops per day.

### I4. The fee payer co-signs bytes that LI.FI built, without checking what it is paying for
`cosignAndSubmit` (`solana-tx.ts:59-72`) only checks that the message hash equals the stored hash and that the fee payer is at index 0. The stored hash is of LI.FI's transaction (`operations.ts:338`), so "byte-identical planner-built" in the spec and ADR-014 really means "byte-identical to what the provider returned".
Nothing bounds the fee payer's exposure. The fee payer could appear as a writable signer or source in other instructions (a System transfer, ATA rent as payer), and there is no limit on compute unit price times limit. AGENTS.md says to treat provider responses as untrusted.
Concrete risk: with `svmSponsor`, the sponsor plausibly pays the rent for the user's destination token account (about 0.002 SOL). The user can later close that account and reclaim the rent, so value transfers from the platform to the user. Whether that rent is included in `gasCosts.amount` is unverified, so the reservation may undercount it.
**Fix:** before storing the hash at quote time, decode the message (resolving lookup tables) and enforce:
- the fee payer is writable and signer only at index 0;
- it appears in no instruction except as the payer of `ATA CreateIdempotent`;
- no SystemProgram instruction uses it as the source;
- the ComputeBudget price times limit is at or below a cap;
- the account count is limited.

Optionally `simulateTransaction` and require the fee payer's lamport delta to be at or below the reserved amount. Correct the ADR-014 and D-068 wording.

### I5. Bitcoin PSBT checks: deposit amount unchecked, miner fee unbounded, PSBTs without change accepted
`expectedBtcOutputs` (`bitcoin.ts:126-134`) accepts 2 or 3 outputs. It does not check that the deposit amount equals the leg's `amountIn` or `action.fromAmount`, although spec §6 requires "LI.FI deposit address **and amount**". It also never computes the fee.
Concrete scenario: the user holds one UTXO of 1 BTC and sells 0.1 BTC. A buggy or malicious LI.FI PSBT pays a 0.1 BTC deposit plus OP_RETURN with no refund output. The server accepts it, the user signs every input (the wallet may or may not warn clearly), and 0.9 BTC goes to miners. Report 1, ruling 12, accepted "miner fee not capped".
**Fix:**
- Require `outputs[0].amount === leg.amountIn`.
- Compute fee = sum of `witnessUtxo` input amounts minus sum of outputs on the quoted PSBT. Refuse with `ROUTE_UNAVAILABLE` above a cap (absolute, or fee rate times vsize).
- At submit, also require the user-signed PSBT's inputs to equal the quoted inputs, so the fee stays bounded.

### I6. No price-movement guard between the plan and each signed quote
`quoteLeg` overwrites `minOut` with the fresh quote's (`operations.ts:336`) and never compares it with the plan's `minOut` or `estimatedOut`. Spec §6 says a plan is "invalidated when the version, routes, balances or prices change materially". The web flow goes straight from quote to the wallet (`leg-progress.tsx:58-69`) without showing the fresh figures, and the wallet shows an opaque transaction. If the price moves 20% between preview and signing (plans live 30 minutes), the user signs at the new price having agreed to the old one.
**Fix:** refuse (409, re-plan) when `q.minOut < leg.minOut` from the plan, or when the shortfall is beyond a threshold the user agrees to. Show the fresh `estimatedOut` and `minOut` before opening the wallet.

### I7. Ledger amounts sometimes come from the provider's report instead of chain evidence
- **ERC-20 delivery without a destination hash (a bug).** In `positions.ts:95-99` the branch is `else if (token && destinationTx) {...} else received = providerAmount`. An ERC-20 delivery whose LI.FI status has no `receiving.txHash` therefore writes LI.FI's `receiving.amount` straight into the append-only ledger. Only bridged native assets were meant to use that path.
- **Bridged native EVM assets (report 1, ruling 11).** This trusts an untrusted provider for a ledger write, against AGENTS.md ("reconcile actual holdings from chain/issuer evidence"). Reconciliation flags the error but only for display. The sell quantity is bounded by the wallet balance, so the impact is a wrong position and wrong SHORT/SURPLUS figures, not a loss of funds.

**Fix:** require `destinationTx` for every chain-evidence path, and go `UNKNOWN` with a recheck when it is missing. For native EVM, use the balance delta at the destination block (`getBalance` at block N-1 vs N; Alchemy supports historical blocks), falling back to `UNKNOWN`, never to the provider figure.

### I8. Selling 100% of a native asset cannot work
- **EVM native.** `sendGasDrop` skips the drop when `balance >= drop` (`gas.ts:77`). For a native ETH, BNB or POL sell, `amountIn` is `min(ledger, wallet)`, which can be the whole balance. The drop is skipped, and the wallet then cannot pay `value + gas`. The drop also covers only LI.FI's main-transaction estimate, not the exact-amount approval transaction that the client sends first (`use-leg-signer.ts:49-54`).
- **Bitcoin.** Selling the full BTC balance leaves nothing for the miner fee inside the PSBT, so LI.FI cannot build it or the user overspends.

Users therefore cannot fully exit native positions, against spec §1.4.
**Fix:** for native sources, cap the sell quantity at the wallet balance minus the estimated fee, or compare `balance - amountIn` against the drop. Include approval gas in the drop estimate.

---

## Minor

1. **Server accepts `bitcoin` where only the UI forbids it.** `packages/validator/src/managers.ts:36` and `members.ts:40` (`walletChain: chainSchema`) now accept `bitcoin`. Only the web forms restrict it (`signInChainSchema` is imported but unused in both validator files). Use `signInChainSchema` server-side.
2. **No service-level guard on Bitcoin sign-in.** `issueChallenge` does not itself refuse `sign_in` for the bitcoin family; only the schema stands between Bitcoin and sign-in. Add a service guard.
3. **LI.FI `PARTIAL` is treated as a failure.** A `DONE/PARTIAL` status means the user received a different token. It is mapped to `FAILED` (`lifi.ts:117`), which loses track of funds that did move. Use `UNKNOWN` with a reason. `REFUNDED` as `FAILED` is fine.
4. **Incomplete PSBT gives a 500.** `finalizePsbt` (`bitcoin.ts:150`) throws a raw error when a PSBT is not fully signed. Map it to 409 `PSBT_MISMATCH` or 400.
5. **A rejected Bitcoin broadcast reuses `PSBT_MISMATCH`** (`bitcoin.ts:199`). The semantics are loose; add `BROADCAST_REJECTED`.
6. **Gas drop send errors are always treated as unknown outcomes** (`gas.ts:97-99`), including definitive refusals such as insufficient funds, nonce too low, or a nonce collision between concurrent drops from the single gas wallet. The drop then stays `pending` with no hash forever. Classify RPC refusals as `failed`, and serialize sends per chain (a nonce manager, or an advisory lock around the send).
7. **Low gas wallet only warns.** Spec §7 says "block when below the next drop"; the implementation only warns (report 1, ruling 16). Together with item 6, a dry wallet consumes budget and gets users stuck on "waiting for gas". Block plans when the wallet balance is below the planned drops.
8. **`networkFeeMicro` can crash with a 500.** It throws `RangeError` on a malformed `amountUSD` (NaN) or a USDC price of `"0"` (`execution.ts:42-44`). Validate `amountUSD` as decimal and guard the price.
9. **Missing rate limits.** `POST /operations/:id/legs/:legId/submit` and `POST /me/chain-accounts/bitcoin/challenge` have none (each submit triggers RPC calls).
10. **Fully sold positions stay `OPEN` with zero holdings,** and the FAILED copy says "Nothing was bought or sold" even though the network fee was paid and not refunded (`leg-progress.tsx:111`).
11. **Sell quantity ignores the ADR-013 pro-rata allocation.** It uses the raw wallet balance. When two positions share a deployment and the wallet is short, selling position A can consume B's tokens. This matches the spec, but note it for Spec 9.
12. **Reconciliation rows grow fast.** A row is appended per position and deployment on every on-demand run (up to one per minute per user, report 1, ruling 13). Skip unchanged rows, or retain them.
13. **Registry deployments on `bitcoin` now accept an address.** `canonicalizeAddress("bitcoin")` used to refuse; it now returns a canonical address (`wallets.ts:28`), so ops can register a Bitcoin deployment with an address. Investability still requires `native`, but keep the old refusal for registry callers.
14. **Client checks `startsWith("bc1p")`** (`bitcoin-link.tsx`), which misses uppercase bech32. The server canonicalizes, so the only effect is a wrong sighash or fallback choice.

---

## Deviations I disagree with

**Report 1 (implementer #1):**
- **Ruling 7 (plan-time reservation): partly.** Reserving at plan time is good; never releasing on cancel or expiry is not (I3).
- **Ruling 9 (stop and fail outcomes): mostly agree.** The terminal outcomes are fine, but combined with cancel being blocked on `UNKNOWN` they produce permanent lockout (I1).
- **Ruling 10 (unknown send outcome): agree in principle.** It needs the blockhash-expiry check (I1). The rejected-broadcast error code is loose (Minor 5).
- **Ruling 11 (LI.FI amount for bridged native assets): disagree** (I7). It also spreads to ERC-20 legs through the `destinationTx` branch.
- **Ruling 12 (miner fee not capped): disagree** (I5).
- **Ruling 16 (low wallet warns only): disagree mildly** (Minor 6 and 7).
- **Agree:** rulings 1-6, 8, 13 (with a retention note), 14 and 15. Ruling 5 (the amount includes the fee) matches spec §6 `D = A - F`. Ruling 6 (hardcoded caps) is acceptable for now because it is documented, but caps in native units drift with prices.

**Report 2 (implementer #2):**
- **Ruling 6 (one click from quote to wallet): disagree.** The fresh quote has to be shown or guarded on the server (I6).
- **Ruling 8 (Back cancels): agree with the UX,** but it burns gas budget (I3).
- **Agree:** deviations 1-2 and rulings 3-5, 7 and 9-11.

---

## Needs user decision (money, custody or permissions where the spec is silent)

1. **Sell network fee can be skipped.** The sell fee is the last leg (spec §2), so a user can stop after the asset legs (giving `PARTIAL`) and never pay, while the platform has already paid the EVM drops and Solana fees. Options:
   - (a) accept the loss within the caps;
   - (b) charge the sell fee first from the user's existing USDC when there is enough;
   - (c) make the network-fee leg mandatory before the operation can reach `PARTIAL`.
2. **User lockout while a leg is `UNKNOWN`.** May the user stop the operation (it becomes `PARTIAL` and the leg keeps being tracked), so they can exit or invest again? Or is lockout until ops resolves it intended? Either way an ops resolve tool is needed (I1).
3. **Gas budget and drop farming policy.** Should reservations be released on cancel or expiry? Should EVM drops require a prior commitment, and should drops have a per-user daily count limit (I3)?
4. **Sponsor-paid rent.** Should rent the platform fee payer pays for the user's new token accounts through `svmSponsor` count against the budget, be recovered in the network fee, or be refused (I4)?
5. **Bitcoin miner-fee cap value** (I5), and **the price-movement threshold** that invalidates a plan (I6).
6. **Source of received amounts for bridged native EVM assets** (I7): a provider-reported amount or `UNKNOWN` until a balance delta proves it.

## Docs

ADR-014, the ADR-013 amendment, D-012/013/032/033/067-070, the README env table and the mainnet checklist are accurate to the code, with these exceptions:
- "co-signs only byte-identical planner-built transactions" (ADR-014 §3 and §4, D-068, the ADR-013 amendment) should say provider-built and validated (I4);
- ADR-014 §6 ("re-checked hourly for 7 days") overstates liveness (I1).

Dependencies are pinned exactly. No keys are committed or logged (the test keys are generated in `vitest.config.ts`). I did not re-check HANDOFF line by line.

## Verdict

**Not ready to merge.** C1 is a one-character fix but blocks the whole feature. Fix I1, I2, I3 and I5 before any mainnet test: they cover user lockout, double execution, platform-wide denial of service, and BTC fund loss through a bad PSBT. I4 and I6-I8 should go in the same fix wave. The custody model is sound: the user signs every value-moving transaction, the platform co-signs only after a hash check, all access is scoped to the session user, the ledger is append-only, and money math is BigInt throughout.
