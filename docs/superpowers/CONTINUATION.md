# Bytesac — Continuation Brief (handover to a new / cloud Claude session)

Written 2026-10-01 by the local session before it hit its usage limit. Read this **after** `docs/superpowers/HANDOFF.md` (§3 rules and §4 working method are mandatory) and `AGENTS.md`. This file lists everything still to do, in order, including the interrupted work.

Repository: `git@github.com:sameerkrdev/bytesac.git` (default branch `main`). Work branch in flight: **`feat/spec8-first-investment`**.

---

## 0. How the user wants work done (summary — HANDOFF §3/§4 is authoritative)

- Per phase: `superpowers:brainstorming` (one multiple-choice question at a time, recommended option first, then the whole design in **one** message) → written spec in `docs/superpowers/specs/` → user approval → `superpowers:writing-plans` (~4–5 large tasks, full code only for subtle logic) → user approval → `superpowers:subagent-driven-development` adapted: implementer #1 (Sonnet) does the API tasks, implementer #2 (Sonnet) does web + docs, **no per-task reviews**, **one Opus whole-branch review**, **one Sonnet fix wave**, a short scoped re-review if the fix touches security/money, then verify the full gate yourself → present the finishing menu and **wait for the user's merge decision**.
- Anything touching **permissions, money, custody or data migration** → ask the user (AskUserQuestion, recommended option first). Otherwise decide and log `Ruling: … — why — cost if wrong`, and list every ruling in the final report.
- Lean code (`ponytail` skill), official docs first, pinned dependencies (never add `minimumReleaseAgeExclude`), docs rewritten in place, never edit `docs/source/*`, never stage `.claude/settings.json` / root `AGENTS.md` / generated `apps/*/AGENTS.md`/`CLAUDE.md`, branch before committing, commits end with the harness attribution line.
- **Safety (AGENTS.md):** never move real assets, sign or broadcast real transactions, or touch production data. Tests mock LI.FI, RPC, Alchemy and wallets.
- Gate: `pnpm db:up` (Docker Postgres 17 with pg_cron + pgvector, Redis 7) then `pnpm turbo run lint check-types test build` (28 tasks). Known: Windows vitest worker crash `3221226505` (re-run crashed files alone); **`mobile#check-types` already fails on `main`** (TS2322 in `apps/mobile/src/lib/appkit.tsx`, duplicate wagmi/viem peer variants) — pre-existing, fix separately. In a cloud/Linux environment the worker crash should not occur; Docker may be unavailable — if so, run lint/check-types/build and the non-DB tests, and say clearly which DB tests could not run.

---

## 1. State of `main`

Merged: Specs 1–7 and ADR-013 (custody/execution/spend authority). Last merges: Spec 6 `e0ed413`, Spec 7 `9d56ef2`, ADR-013 `545b187`. See HANDOFF §2 for the per-spec summary and §5 for leftovers.

---

## 2. IN FLIGHT — Spec 8 (first investment and exit) on `feat/spec8-first-investment`

- Spec: `docs/superpowers/specs/2026-10-01-first-investment-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-01-spec8-first-investment.md` (approved).
- Implemented and committed: Task 1 `c99e10f`, Task 2 `8188ef5`, Task 3 `fa20310` (API), Task 4 `c1d1363` (web), Task 5 tests `2d9d1a6`, docs `da3d30f`.
- Opus whole-branch review done: **1 Critical, 8 Important, 14 Minor** — full text in `docs/superpowers/reviews/spec8/final-review.md`. Implementer reports and ledger copied to `docs/superpowers/reviews/spec8/` (`task-1-3-report.md`, `task-4-5-report.md`, `progress.md`).
- **Fix wave was interrupted** (usage limit) mid-way. Its partial, **untested** changes are committed as a WIP commit (`wip(api): spec 8 review fixes — interrupted, incomplete`) — it touched `providers/{bitcoin,evm-rpc,solana-tx}.ts`, `providers/routes/{lifi,types}.ts`, `services/{gas,operations}.ts`, validator/app-core execution files, schema + a new migration `0011_positions_review_fixes.sql`. Treat it as a starting point: read the diff of that commit against `final-review.md`, finish every item, and make the gate green. Do not assume any item in it is complete or correct.

### 2.1 Fix wave — what must be fixed (all of these)

- **C1** `providers/routes/lifi.ts`: regex `/^d+$/` must be `/^\d+$/` (every real quote fails today); add a regression test with a realistic LI.FI fixture that includes `gasCosts.amount`.
- **I1** stuck legs: dropped Solana txs → `FAILED` via blockhash expiry; legs with nothing visible keep rechecking; the recheck chain must survive provider errors; stopping must be possible (see D2); ops resolve tool.
- **I2** claim-before-send in `submitLeg` (a `SUBMITTING` claim state or equivalent guard under the operation lock; `/quote` and `/cancel` refuse claimed legs; unique `(from_chain, source_tx)`; a submit into a `CANCELLED` operation is refused).
- **I3** gas reservations released on cancel/expiry; EVM drops gated (D3); global-cap DoS closed.
- **I4** decode LI.FI Solana messages before storing the hash: fee payer signer/writable only at index 0, appears only as payer of ATA `CreateIdempotent`, never a SystemProgram source, ComputeBudget price×limit ≤ cap, account-count cap; optional simulation with fee-payer lamport delta ≤ reservation. Correct ADR-014/D-068 wording ("planner-built" → provider-built, decoded and validated).
- **I5** Bitcoin PSBT checks (D5).
- **I6** price-move guard (D6) + web shows fresh estimate/minOut before the wallet opens.
- **I7** ledger from chain evidence only (D7), incl. the ERC-20 branch bug in `positions.ts`.
- **I8** native 100% sells leave fee headroom; EVM drop estimate includes the approval transaction.
- Spec §7: block plans when a platform gas wallet is below the next drop (implementation only warned).
- All cheap Minors from `final-review.md`; skip others with reasons. Update docs in place (ADR-014, ADR-013 amendment, D-067..D-070, `apps/api/README.md`, HANDOFF §5).

### 2.2 Binding user decisions for the fix wave (2026-10-01)

- **D1** sell network fee: if the user already holds enough USDC on Solana (≥ fee) the network-fee leg is **first**; otherwise it stays **last** and an unpaid fee is an accepted loss within the gas caps.
- **D2** `UNKNOWN` leg: the user may stop the operation → `PARTIAL`; the unknown leg keeps being tracked/reconciled. Add `POST /v1/ops/operations/:id/legs/:legId/resolve { status: SETTLED|FAILED, amountReceived?, txEvidence, reason }` (`ops_admin`, audited; settle the ledger only from on-chain evidence the server verifies where possible).
- **D3** gas: release unspent reservations when an operation is `CANCELLED` or expires; EVM gas drops only after the operation's network-fee leg is `SETTLED`; max **5 drops per user per day per chain**.
- **D4** Solana token-account rent paid by the platform fee payer: **count it in the gas budget and include it in the network fee**.
- **D5** Bitcoin PSBT: deposit output amount = leg `amountIn`; a refund/change output to the user is required; miner fee ≤ **min(2% of the sell amount, 100,000 sats)**; the user-signed PSBT's inputs must equal the quoted inputs.
- **D6** price move: if a fresh quote's `minOut` < the plan preview's `minOut` for that leg → 409, user must re-plan; always show fresh figures before the wallet opens.
- **D7** ledger: **chain evidence only**; if missing → `UNKNOWN` + recheck; never write provider-reported amounts (native EVM via destination-block balance delta).

### 2.3 After the fix wave

1. Scoped Sonnet re-review of the fix diff (fund safety: fee-payer constraints, claim-before-send, gas gating, PSBT checks, ledger evidence).
2. Verify the full gate yourself; record results honestly (which DB tests ran).
3. Report: commits, tests, migrations (`0010_positions`, `0011_positions_review_fixes`), every ruling with cost-if-wrong (the earlier rulings are in `docs/superpowers/reviews/spec8/progress.md`), open items. Present the finishing menu (merge locally / PR / keep) and **wait for the user**. After merge: gate on `main`, delete the branch, update HANDOFF §0/§2/§5.
4. **Pre-launch (user actions, not machine-verifiable):** LI.FI key + terms + integrator fee; confirm `svmSponsor` / `toAddress` behaviour and Solana tx encoding with a real key; Alchemy Bitcoin `/tx` and `/sendtx` shapes; Phantom/Solflare manual test (wallets that add instructions get `TX_MISMATCH` by design); Reown Bitcoin `signPSBT` of the BIP-322 virtual tx; fund platform wallets (Solana fee payer, EVM gas wallet per chain, gas treasury); move platform keys to a KMS; legal review of the network fee and self-custody flows; small-amount mainnet checklist in `apps/api/README.md`.

---

## 3. Remaining roadmap (each phase = full cycle in §0; start each only with the user's go-ahead)

| Phase | Scope (agreed with the user) |
|---|---|
| **Spec 9 — Rebalance / skip / drift / fix / `SHORT` repair** | Reuses Spec 8 planner, legs, tracking, reconciliation. Manager-published version → user notified → apply or skip; plan from current reconciled holdings to the latest selected target (never replay skipped versions); netting within the user's wallets only; thresholds/tolerances; drift detection (Alchemy activity webhooks); Fix vs Accept for `SHORT` positions (pro-rata, ADR-013); removed assets; network-fee leg and platform gas drops on every transaction (user decision); LI.FI routes. Source: `First-Investment,-Rebalancing,-Drift-&-Fix.txt` §11–end; `User-Detailed-Features.txt` §20–§33. |
| **Spec 10 — Subscriptions, fees, manager payouts** | Platform and manager fees as explicit fee legs inside the user-signed plan (ADR-013 proposal — confirm with the user), paid to the platform and the organization's verified payout wallet (D-006); subscription billing; fee base/timing/refunds (Spec 6 fee schedule: percent ≤ 100 bps, fixed ≤ 1% of minimum). The user agreed rebalance (9) comes before fees (10) unless they say otherwise. Source: `User-Detailed-Features.txt` §18–§19, `Fund-Manager-Detailed-Features.txt`. |
| **Spec 11 — RWAs and tokenized ETFs/equities** | Eligibility engine (user + instrument + provider + route + jurisdiction + action; KYC/allowlists; D-025); RWA routes via LI.FI or other providers plugged into the `RouteProvider` abstraction; async settlement states (`PENDING_SETTLEMENT`, `ISSUANCE_PENDING`, …); RWA data vendor selection. 0x xStocks are opt-in, geo-restricted (not US/Canada/UK/Australia) and enablement was paused — only if the user decides to add 0x later. |
| **Future plans** (`docs/domains/FUTURE-PLANS.md`, only with explicit user approval) | LI.Fuel route gas top-up; conventional ETFs/stocks (broker-held; needs its own custody ADR); delegated signing / session keys (needs an ADR); price backfill; investor counts; jobs dashboard; mobile investing screens. |

Also unresolved from earlier specs (HANDOFF §5/§7): Spec 4–7 deferred minors; `mobile#check-types` dependency fix; Resend email copy/sender domain; re-apply cooldown; jurisdiction templates; document retention and 7-year audit retention (compliance); real-R2 and AppKit Solana signing manual checks; Gemini model/terms check with a real key; CoinMarketCap plan + `price: null` batch issue; pgvector on Supabase; deploy the BullMQ worker (`start:worker`); final disclosure wording; fee-cap confirmation; pending user actions in HANDOFF §7.

---

## 4. Where things are

- Specs/plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`; reviews: `docs/superpowers/reviews/`.
- Decisions: `docs/decisions/DECISION-REGISTER.md`, ADR-001..ADR-014.
- The local `.superpowers/sdd/` workspace (git-ignored) does not travel; regenerate briefs with the subagent-driven-development skill's `scripts/sdd-workspace` and `scripts/task-brief` if you need them.
