# Spec 8, Tasks 1-3 report (implementer #1)

Commits: `c99e10f` (Task 1), `8188ef5` (Task 2), `fa20310` (Task 3). Branch `feat/spec8-first-investment`. `.claude/settings.json` untouched and never staged.

## Task 1: data, validator, RouteProvider + LI.FI, investability

Changes
- `@repo/validator`: `execution.ts` (states, transition maps verbatim, `splitInvestment`, `minOut`, `networkFeeMicro`, `canTransition`, request/response schemas), 10 new error codes (+ HTTP statuses, + copy in `@repo/app-core` error-copy).
- Bitcoin typing: `chainSchema`/`chainFamilySchema`/`CHAINS` gain `bitcoin`; auth input schemas use the new `signInChainSchema` (excludes bitcoin) so Bitcoin is never a sign-in chain; `chainFromEvmChainId` and `ConnectedAccount` use `SignInChain`. Verification methods gain `bip322`, `bip137`.
- `@repo/db`: `schema/execution.ts` + migration `0010_positions.sql` (enum extensions, wallet check constraints rewritten with `::text` casts, 8 tables, partial uniques, grants, RLS). Ledger and reconciliation tables are SELECT+INSERT only (stricter than the brief's SELECT/INSERT/UPDATE).
- API: `providers/routes/{types,lifi,index}.ts`, `services/investability.ts`, `GET /v1/baskets/:slug/investability` (optional session), env `LIFI_API_KEY`, `LIFI_INTEGRATOR`, `ROUTE_PROVIDER_ORDER`; api-client `getInvestability`.
- Also touched (type fallout of widening `Chain`): web `application-form`, `organization/members`, `profile/wallet-section`; mobile `wallet-section` method labels.
- Files: see the three commits.

Deps: none.

Docs confirmed (LI.FI, docs.li.fi): `/v1/quote` params (`fromChain,toChain,fromToken,toToken,fromAmount,fromAddress,toAddress,slippage` as decimal 0.005, `integrator`, `svmSponsor` = "SVM-specific wallet address to sponsor transaction costs"); response `action`, `estimate.{toAmount,toAmountMin,gasCosts,approvalAddress}`, `transactionRequest`; `/v1/status` (NOT_FOUND/INVALID/PENDING/DONE/FAILED, substatus, `receiving.{txHash,amount}`); `/v1/connections` (`fromChain,toChain,fromToken,toToken`; `connections[].fromTokens/toTokens`); `/v1/gas/suggestion/{chain}` (not used: quote `gasCosts` supply the estimates). Chain ids: Solana `1151111081099710`, Bitcoin `20000000000001`, EVM = chain id. Native tokens: EVM zero address, Solana `11111111111111111111111111111111`, Bitcoin `bitcoin`. Bitcoin source quotes return a PSBT (hex or base64; both accepted) with outputs deposit, OP_RETURN memo, refund; "modifying a PSBT can lose funds".
Not confirmed by docs (assumed, to verify with a real key): `action.toAddress` echoed in the quote response (required by our validation); Solana `transactionRequest.data` is a base64 versioned transaction; exact PSBT encoding.

Tests (all mocked): `lifi.test.ts` (12), `investability.test.ts` (10), `execution.test.ts` in validator (8 in 97 total). Gate `pnpm turbo run lint check-types test --filter=api... --filter=@repo/validator --filter=@repo/db --filter=@repo/api-client`: all green (api 68 files / 770 tests at that point).

## Task 2: Bitcoin linking, platform wallets, Solana co-signing, EVM gas drops, budgets

Changes
- `providers/bitcoin.ts`: BIP-322 "simple" verification built from the standard's `to_spend`/`to_sign` (P2WPKH, P2TR, P2SH-P2WPKH; accepts the wallet's signed `to_sign` PSBT or a simple witness, optional `smp` prefix), BIP-137 (P2PKH/P2SH-P2WPKH/P2WPKH headers), `psbtOutputs`, `expectedBtcOutputs` (deposit, OP_RETURN, refund must be the user), `checkPsbtOutputs` (409 `PSBT_MISMATCH`), `finalizePsbt`, Alchemy REST `bitcoinBalance`/`bitcoinTx`/`broadcastBitcoin`.
- `providers/solana-tx.ts`: `cosignAndSubmit` (exact core: hash of serialized message vs stored, fee payer index 0, adds only the fee-payer signature, one send, `maxRetries: 0`), `buildFeeTransfer` (USDC TransferChecked + idempotent treasury ATA creation, hand-encoded: no `@solana/spl-token`), `solanaFinality`, `solanaBalance`, `solanaReceived`, `describeUnsigned`.
- `providers/evm-rpc.ts`: `evmBalance`, `evmTransaction`, `evmReceipt`, `gasWalletAddress`, `sendNativeFromGasWallet` (viem wallet client; key stays in the module); Polygon host added.
- `services/gas.ts`: `seedPlatformWallets` (API `server.ts` and worker start), `platformAddress`, `reserveGas` (advisory xact lock per chain + `FOR UPDATE` on the user row, per-user and global caps), `sendGasDrop` (one drop per leg via unique index; skipped when balance suffices; unknown send outcome stays `pending`, never resent; audited).
- Linking: `POST /v1/me/chain-accounts/bitcoin/{challenge,verify}` reuse `issueChallenge`/`verifyChallenge` (purpose `add_chain_account`, family `bitcoin`), so one-per-family, not-linked-elsewhere 409, session rotation and audit are the Spec 1 code paths; link message says "link your Bitcoin account"; rate limit `bitcoinLinkUser` 10/h; `respondVerified` extracted from `routes/auth.ts`.
- Env: `SOLANA_FEE_PAYER_SECRET`, `EVM_GAS_WALLET_SECRET`, `GAS_TREASURY_SOLANA_ADDRESS` (optional; empty disables). Test run generates throwaway keys in `vitest.config.ts` (nothing committed).

Deps (pinned exact, newest allowed; no `minimumReleaseAgeExclude`; `pnpm-workspace.yaml` unchanged): `@solana/web3.js` 1.99.0, `@scure/btc-signer` 2.4.1, `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0. `@scure/btc-signer` cannot verify BIP-322, so a small verifier was written on it + noble instead of adding `bip322-js`.

Docs confirmed: BIP-322 text (to_spend/to_sign, simple encoding) and the BIP's `basic-test-vectors.json` and `generated-test-vectors.json` (used verbatim: P2WPKH x4 valid, P2TR valid, and the error vectors for wrong message/wrong signer, all rejected); @scure/btc-signer and noble v2 typings (note noble v2 `verify`/`recoverPublicKey` need `prehash: false`); Solana web3.js v1 `VersionedTransaction` (`message.serialize`, `staticAccountKeys`, `sign` keeps other signatures); LI.FI `svmSponsor` (above); Alchemy Bitcoin: base `https://bitcoin-mainnet.g.alchemy.com/v2/{key}/api/v2/`, "full Blockbook parity" (address balance endpoint confirmed in the migration guide).
Not confirmed: Blockbook `/tx/{txid}` and `POST /sendtx/` shapes (assumed from Blockbook parity).

Tests: `bitcoin-link.test.ts` (21: official vectors, PSBT for 3 address kinds, BIP-137, linking, 409s, bad signature, rate limit), `solana-cosign.test.ts` (6: identical co-signed once with valid signatures; altered instruction `TX_MISMATCH` and send not called; wrong fee payer; no stored hash; fee transfer encoding; finality), `gas.test.ts` (9: per-user cap, chains separate, two parallel reservations near the global cap, one passes; drop skipped/sent once/confirmed/refused over budget/unknown outcome never resent; wallets seeded). Gate green after fixing a regression I introduced (the ops CLI must not import env-dependent modules; canonical Bitcoin address helper lives in `services/wallets.ts`).

## Task 3: operations, tracking, reconciliation, portfolio

Changes
- `services/operations.ts`: `createInvestPlan`, `createSellPlan`, `quoteLeg`, `submitLeg`, `cancelOperation`, `leavePosition`, `getOperation`, `operationView`, `setLegStatus`/`refreshOperationStatus` (every transition validated against the maps, under an operation row lock, audited).
- `services/positions.ts`: `trackLeg`, `reconcilePositions`, `getPortfolio` (reconciles at most once per 60 s per user, Redis `SET NX`), `checkGasWallets`.
- Routes `/v1/operations/{invest,sell,:id,:id/legs/:legId/quote|submit,:id/cancel}`, `/v1/portfolio`, `/v1/positions/:id/leave`; mutations need verified email and phone; limits `operationsUser` 10/h, `quotesUser` 60/min. Worker: `track-leg` queue (first tracking 12 attempts, 15 s exponential; hourly rechecks `leg_<id>_recheck_<n>` up to 168), nightly `reconcile-positions` 02:30 UTC, `gas-wallet-check` every 15 min. api-client methods added. Existing `jobs.test.ts` updated for the new queues.
- Review focus coverage: 1 (`TX_MISMATCH`) Task 2 + invest test; 2 (UNKNOWN, no resubmit, recheck settles) tracking test; 3 (double click) invest test incl. true concurrency; 4 (min(ledger, wallet)) sell test; 5 (budget refused, no operation row) invest test + gas test.

Tests: `invest.test.ts` (15), `sell.test.ts` (7), `tracking.test.ts` (9), `reconcile.test.ts` (10 incl. grants and gas wallet check). Final: filtered gate green; repo-wide `pnpm turbo run lint check-types test --continue`: everything green except the known `mobile#check-types` (pre-existing wagmi duplicate types) and Windows vitest crash 3221226505 on random files (re-ran each alone: all pass). Mobile jest 55/55, web 295/295, api 847/847 after re-runs.

## Deviations / rulings (what, why, cost if wrong)

1. Ruling: widened `Chain`/`ChainFamily` with `bitcoin`, kept the auth input schemas narrow via `signInChainSchema`; no separate `addressFamilySchema` (the widened `chainFamilySchema` is it). Why: the DB `chain` enum must hold bitcoin rows and every reader compiles against `Chain`. Cost: a future caller using `chainSchema` for an input must remember to use `signInChainSchema`.
2. Ruling: challenge purpose is the existing `add_chain_account` (brief said `add_chain`). Wallet-address check constraints now tie bitcoin family to chain bitcoin and methods bip322/bip137.
3. Ruling: `getInvestability(db, { slug } | { id }, userId)` (brief: slug); returns planner data (`constituents`, `versionId`) that the route strips. First enabled provider/connected deployment per constituent wins.
4. Ruling: registry provider matched by normalized name (`"LI.FI"`/`"lifi"` -> `lifi`); ops must name the provider LI.FI. Exits do not depend on registry route status (sell uses the first provider in `ROUTE_PROVIDER_ORDER`) so a retired basket can always be exited.
5. Ruling (money): the amount `A` includes the network fee (`D = A - F` per spec section 6), so the balance check is `balance >= A`, not `A + F`. Cost if wrong: users need slightly more USDC.
6. Ruling: gas caps are constants in native units in `services/gas.ts` (assumes SOL $150, ETH $2,500, BNB $600, POL $0.20; per user Solana 0.02 SOL, others about $5; global about $200); no env override or `gas_budgets` table yet (spec mentions a config). Cost: tuning needs a code change.
7. Ruling: plan-time `reserveGas` consumes the budget for Solana fee-payer legs and for EVM drops (so a refused budget refuses the plan, Review Focus 5); a planned leg's drop is flagged `gasReserved` in `expected_tx` and `sendGasDrop` then does not reserve again; it sends exactly the planned drop amount (estimate x 1.5 at plan time). Cost: if the real gas need grows between plan and quote the planned drop may be short.
8. Ruling: network fee conversion uses the registry USDC market price when fresh, otherwise 1.0 (stablecoin peg); the fee transfer's own cost is a flat 0.002 USD estimate.
9. Ruling: operation outcomes. Leg failure: `PARTIAL` if an asset leg settled else `FAILED`; user "stop" on an `IN_PROGRESS` operation: `PARTIAL` if an asset leg settled, else `FAILED` (not `CANCELLED`, which is only before any submission); blocked while a leg is pending. `PARTIAL`/`FAILED` are terminal (map), so continuing means a new plan. Plans expire lazily (cancelled when touched, and when the user plans again).
10. Ruling: Solana unknown send outcome: `cosignAndSubmit` attaches the deterministic fee-payer signature (`unknownOutcomeSignature`) to non-preflight errors and `submitLeg` records the leg SUBMITTED with it; a preflight rejection leaves the leg PLANNED. Bitcoin: transport failure on broadcast is recorded as submitted (txid is deterministic); a rejection is `PSBT_MISMATCH` 409 (a definitive refusal, error code reuse). Cost: error code semantics for a rejected broadcast are loose.
11. Ruling: bridged native EVM assets have no log to read, so `amount_received` uses LI.FI's reported amount; delivered-but-zero-visible goes `UNKNOWN`. The nightly reconciliation checks wallet balances.
12. Ruling: BTC PSBT shape expected from LI.FI: deposit, OP_RETURN, optional refund to the user (outputs 2-3), validated at quote; the user-signed PSBT must equal those outputs exactly. The wallet-chosen miner fee is not capped.
13. Ruling: reconciliation appends a row per position and deployment on every run (history rows also on unchanged state); closed positions are not reconciled; Bitcoin uses the confirmed balance.
14. Ruling: eligibility ignores a PLANNED operation past its 30-minute expiry.
15. Quote response shape additions: `approval` (exact-amount ERC-20 approval from LI.FI `approvalAddress`), `transaction` and `quoteExpiresAt` nullable while an EVM gas drop is confirming (no quote is fetched until it confirms; the client polls the quote endpoint).
16. Platform gas wallets blocking plans "below the next drop" (spec section 7) is not implemented beyond the warning log; a drop that cannot be sent stays `pending`.

## Concerns / pre-launch checks (not machine-verified)

- Real-key LI.FI checks (spec open items): `toAddress` echoed in the quote, `svmSponsor` on every Solana leg type, Solana `data` encoding, Bitcoin PSBT format, minimum-output rounding tolerance (we allow 1 unit).
- Wallets that add instructions before signing (for example Lighthouse guards) change the Solana message and will be refused with `TX_MISMATCH` by design; needs a manual wallet test (Phantom, Solflare).
- Alchemy Bitcoin endpoints (`/tx`, `/sendtx`, balance) follow Blockbook parity but only the address endpoint was confirmed from docs.
- BIP-322: P2SH-P2WPKH is verified through the signed PSBT path only (no official vector; tested with self-signed PSBTs); legacy P2PKH BIP-322 and "full" signatures are unsupported (BIP-137 covers legacy).
- Solana source legs rely on LI.FI's sponsored transaction having the platform fee payer at index 0; anything else is refused.
- Fee payer / gas wallet keys are env secrets (KMS before launch); treasury ATA is created by the fee-transfer transaction if missing (platform pays rent once).
- Windows vitest crash 3221226505 hit random files on every full run; each passed alone.
