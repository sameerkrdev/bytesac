# Spec 8, Tasks 4-5 report (implementer #2)

Branch `feat/spec8-first-investment`. `.claude/settings.json`, root `AGENTS.md` and generated `AGENTS.md`/`CLAUDE.md` never staged.

## Commits
- `c1d1363` feat(web): add invest flow, portfolio, exit and bitcoin wallet linking (Task 4)
- `2d9d1a6` test(web): cover invest, portfolio and exit (Task 5 tests)
- docs commit `docs: record execution, LI.FI and gas decisions` (Task 5 docs; hash in the final reply)

## What was built
Web: `lib/appkit.tsx` (Bitcoin adapter, Polygon added), `lib/wallet/use-leg-signer.ts` (the only wallet touchpoint: Solana `signTransaction`, wagmi `sendTransaction` with exact-amount approval waited for, Bitcoin `signPSBT` for every input), `components/profile/bitcoin-link.tsx`, `components/invest/{invest-button,invest-wizard,leg-progress}.tsx`, `components/portfolio/{positions-list,operation-detail,exit-dialogs}.tsx`, `app/(app)/portfolio/page.tsx`, nav item, basket page Invest button, profile Bitcoin section. `@repo/app-core/execution.ts` (labels, `formatUnits`, explorer links, leg summaries; + test, `WrongWalletError`, INSUFFICIENT_BALANCE copy no longer mentions the fee).
Deps: web `@reown/appkit-adapter-bitcoin` 1.8.24 (same as other AppKit packages, available), `@solana/web3.js` 1.99.0.
Tests: 7 new web test files plus fixtures (invest-button, invest-wizard, leg-progress, portfolio, exit-dialogs, bitcoin-link) and `execution.test.ts` in app-core; public-basket test updated to mock `InvestButton`. Wallets and API mocked; nothing signed or broadcast.
Docs: ADR-014 (new), ADR-013 amended in place, register (D-012, D-013, D-032, D-033 rewritten; D-067..D-070 added), FUTURE-PLANS, INVESTMENT-REBALANCING-DRIFT-FIX, USER-FEATURES, USER-AUTHENTICATION, ARCHITECTURE, `apps/api/README.md` (env, wallet funding, caps, KMS note, manual mainnet checklist), `apps/api/.env.example` (the Spec 8 variables were missing), HANDOFF (starter prompt, section 2 row, section 5).

## Deviations / rulings (what, why, cost if wrong)
1. Deviation: the plan says the server returns the BIP-322 `to_sign` PSBT with the Bitcoin challenge; implementer #1 had not built it. I added `bip322ToSignPsbt` (refactored the verifier's shared `bip322Txs`) and `toSignPsbt` on the challenge response (`bitcoinChallengeResponseSchema`), tested. Cost: an unverified assumption that wallets sign this PSBT (pre-launch check); BIP-137 fallback exists.
2. Deviation: API additions the web needed that the spec did not list: `basketId` on investability (invest needs it and the public basket page has no id); `decimals` in leg `routeSummary` (raw amounts need them); `inputCount` on Bitcoin quote transactions (`signPSBT` needs `signInputs` per input); `history` (20 finished operations) on `GET /v1/portfolio` (spec 12 requires operation history; only open operations were returned). Existing assertions updated; new assertions added. Cost: API response shape grew (additive).
3. Ruling: Polygon added to the web AppKit/wagmi networks (EVM sells on Polygon need chain switching). Cost: Polygon shows in the wallet network list and is "unsupported" for sign-in.
4. Ruling: Bitcoin wallet connect uses `open({ view: "Connect", namespace: "bip122" })` and `useAppKitAccount({ namespace: "bip122" })`; the active network is not switched back. Cost: unverified against a real wallet.
5. Ruling: BIP-322 PSBT signing uses `sighashTypes [1]` (`[0]` for Taproot); BIP-137 fallback only for non-Taproot; wallet hex signatures converted to base64. Cost: wallet-specific behaviour may differ.
6. Ruling: "Sign step N" is one click that does quote, gas-drop wait (up to 40 x 3 s polling of the quote endpoint), approval, signing and submit; an expired quote shows "Quote expired" and the same button becomes "Get a new quote". No proactive countdown. Cost: user may sign a quote that expires during a slow wallet prompt (server refuses, nothing submitted).
7. Ruling: "Stop here"/"Cancel" are the server cancel endpoint (label by whether an asset leg settled); `PARTIAL`/`FAILED` show what did not run and say a new plan is needed (terminal per implementer #1 ruling 9).
8. Ruling: the wizard's Back and the sell dialog's Back cancel the planned operation (a PLANNED operation blocks other plans for 30 minutes); closing the dialog leaves it open and the portfolio offers Continue. Cost: an abandoned plan blocks a new one until it is cancelled or expires.
9. Ruling: portfolio shows the basket slug (the API has no name); history shows only the last 20 operations.
10. Ruling: slippage input is a percent with up to 2 decimals (1 to 300 bps); amount validation uses BigInt micro-USDC and the server rules (min, increment).
11. Ruling: `.env.example` gained the Spec 8 variables (not in implementer #1's commits).

## Scope cuts (spec 12)
None cut. Not done: mobile (out of scope); no countdown for the 60 s quote; no automatic switch back of the active AppKit network after Bitcoin linking.

## Gate
See the final section below.

Final gate `pnpm turbo run lint check-types test build --continue`: 25 of 28 tasks green. Failures: `mobile#check-types` (known, on main); `api#test` and `web#test` hit the Windows vitest crash (3221226505 in `bitcoin-link.test.ts`; web exit 134). Re-run alone: `bitcoin-link.test.ts` 21/21, web 53 files / 326 tests, `@repo/app-core` 20/20. Full API run before the crash: 839 of 847 passed with the crashed file the only error. Lint, check-types and build (web, api) green.
Commit 3: `da3d30f` docs: record execution, LI.FI and gas decisions.

## Top concerns
1. Wallet behaviour is unverified: BIP-322 `signPSBT`, Solana guard-instruction wallets (`TX_MISMATCH`), the Bitcoin Connect view, wagmi chain switching for Polygon.
2. Abandoned plans block a new plan until cancelled or expired (30 min); Continue/Cancel is on /portfolio.
3. pnpm lockfile churn: adding the Bitcoin adapter re-resolved many peer variants (zod, babel core); lint, build and tests pass.
