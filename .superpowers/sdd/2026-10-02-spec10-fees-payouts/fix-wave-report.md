# Spec 10 fix wave

Commit 58288da on feat/spec10-fees.

## Fixed
- I1 (apps/api/src/services/operations.ts, quoteLeg fee-leg branch and operationView): no rows -> one transfer of `amountIn` to the gas treasury; rows present -> charged sum must equal `amountIn`, else 503 ROUTE_UNAVAILABLE (nothing built). The view of a legacy operation lists one network fee from `networkFeeUsdc`. No migration. Tests in test/fees/plan-fees.test.ts: legacy quote + view + settle; mismatched rows -> 503.
- I2 (apps/api/src/services/fees.ts planFees): `connection.getAccountInfo(ata, "confirmed")` per distinct charged manager/platform recipient; RPC error counts as missing; rent added to the network fee only for missing accounts, priced with the new `solPriceUsd` (first quote with `nativePriceUsd`; fallback 150 only if none). Passed from createInvestPlan and createSellPlan (operations.ts), rebalance and repair (rebalance.ts). chain-mocks.ts mocks `getAccountInfo` (`state.tokenAccounts`, default missing). Tests: existing ATAs -> same fee as no-fee baseline and reservation < 1 rent; missing ATAs -> existing rent test.
- I3 (fees.ts csvLine): cells starting `= + - @ tab CR` get a leading `'`, then the usual quoting. Test with `=HYPERLINK(...)` in test/fees/earnings.test.ts.
- I4 (packages/app-core/src/execution.ts legTitle -> "Fees"; execution.test.ts, web exit-dialogs and invest-wizard tests).
- Minor 1: fees-editor.tsx keeps the cap on percent change.
- Minor 4: rebalance rate chosen from `targetVersionId !== position.appliedVersionId`.
- Minor 8: REVENUE_TREASURY_SOLANA_ADDRESS in apps/api/.env.example.
- Docs rewritten in place: ADR-016 (section 5, trade-offs, migration, CSV line, open question 3 removed), D-089, D-092.

## Skipped Minors
- 2 (reconcile by signature): changes the reconciliation algorithm; log-only, tracked.
- 3 (waived counts incl. abandoned plans): needs a join/status design.
- 5 (T from clamped sells): touches the money base; needs its own test.
- 6 (recheck payout wallet at quote): new refusal path, design call.
- 7 (DB CHECK, column-level grant): needs a migration.
- 9 (same treasury address): needs an env validation hook; tracked.
- 10, 11: deferred by the review itself.

## Tests (all foreground)
- plan-fees 19/19, earnings 7/7, schedules 7/7, fees/reconcile 4/4 (one crash on the first run, passed alone), execution invest 25, rebalance 18, repair 6, sell 23, solana-cosign 12, tracking 20, reconcile 10.
- packages/app-core 20/20; web 377/377 (63 files).
- `pnpm turbo run lint check-types --filter='!mobile'`: 16/16 successful.

## Rulings
- Legacy transfer builds even when no fee rows exist but GAS_TREASURY is unset -> 503 ROUTE_UNAVAILABLE.
- Rent check covers manager/platform recipients only (the network row's gas-treasury account is not checked), as ruled.

## Fix wave 2

- N1: `solPriceUsd` now only from Solana-sourced quotes: `operations.ts:381` (sell, `sells[n].chain === "solana"`), `rebalance.ts:161` (sell quotes filtered to solana chain + buy quotes). Invest (`operations.ts:304`) and repair (`rebalance.ts:237`) unchanged (Solana-sourced); fallback `SOL_USD_FALLBACK` otherwise.
- N3: `fees.ts` `validAddress` helper (before `planFees`): invalid stored payout address -> manager fee waived `payout_wallet_unavailable`; invalid/missing gas or revenue treasury -> 503 `ROUTE_UNAVAILABLE`.
- N2: ADR-016 line 88 and D-089 rewritten: platform absorbs ~0.002 SOL/recipient rent if an account is closed after planning; rent priced with Solana-quote SOL price.
- Tests (`test/fees/plan-fees.test.ts`, new describe "token-account rent price"): ETH sell and EVM-sell rebalance network fee equals the no-EVM-price run (both fail without the fix); invalid payout address waives the manager fee.
- Run (vitest, one file each): plan-fees 22, sell 23, rebalance 18, invest 25, repair 6, all passed; no 3221226505 crash. `pnpm turbo run lint check-types --filter=api --filter=@repo/validator`: 4/4 successful.
