# SDD ledger — plan: docs/superpowers/plans/2026-10-01-spec8-first-investment.md

Spec: docs/superpowers/specs/2026-10-01-first-investment-design.md
Branch: feat/spec8-first-investment (from main 545b187)
Execution model (user): implementer #1 (sonnet) T1–3 API; implementer #2 (sonnet) T4–5 web+docs; no per-task reviews; one Opus review; one Sonnet fix wave; ask before merge.

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1→T2/T3 | schemas, RouteProvider, investability | same implementer — OK |
| T2→T3 | cosignAndSubmit, reserveGas, sendGasDrop, bitcoin helpers | same implementer — OK |
| T2→T4 | server builds BIP-322 to_sign PSBT returned with challenge | T4 consumes — OK (plan text explicit) |
| T3→T4 | operations/portfolio API + client | OK |
| T3 self | tracker never submits; UNKNOWN rechecks via delayed jobs | OK |
| T1 self | addressFamilySchema separate from auth chainFamilySchema | OK |

## Rulings
- Ruling 1: No per-task reviews; one final Opus review + one fix wave (user model) — cost if wrong: bigger fix wave.

## Progress
- Implementer #1 dispatched; BASE adec092
- implementer #1 agent id: a0a422c9487ccf748
- Task 1 committed c99e10f; implementer #1 hit session limit → resumed via SendMessage for T2–T3
- Tasks 1–3 complete: c99e10f, 8188ef5, fa20310 (no per-task review). Deps: @solana/web3.js 1.99.0, @scure/btc-signer 2.4.1, @noble/curves 2.4.0, @noble/hashes 2.4.0 (own BIP-322 verifier, passes BIP vectors).
- Flags for final review: Chain type widened with bitcoin + new signInChainSchema (verify Bitcoin can never sign in); gas caps hardcoded (no env override); low gas wallet only warns (spec §7 says block) ; LI.FI toAddress echo / Solana base64 and Alchemy BTC /tx,/sendtx shapes unverified; PARTIAL/FAILED terminal.
- Implementer #2 dispatched; BASE fa20310
- implementer #2 agent id: a1e86458303bddc12
- Tasks 4–5 complete: c1d1363 (web), 2d9d1a6 (tests), da3d30f (docs). API additions: toSignPsbt in BTC challenge, basketId/decimals/inputCount/history fields; Polygon in web AppKit; lockfile peer churn from bitcoin adapter.
- Final Opus review dispatched
- reviewer agent id: a0e5fb70b28fad38f
- Final review: 1 Critical (C1 lifi regex), 8 Important (I1 stuck leg lockout, I2 submit race double-exec, I3 gas reservation leak/farming/global-cap DoS, I4 fee payer no instruction/fee cap, I5 PSBT deposit/miner fee unchecked, I6 no price guard across legs, I7 ledger uses LI.FI amounts, I8 100% native sell impossible), 14 Minor, 6 user decisions.
- User decisions (2026-10-01):
  - D1 sell network fee: first leg when user already holds enough USDC on Solana; otherwise last (unpaid = accepted loss within caps).
  - D2 UNKNOWN leg: user may stop → operation PARTIAL, leg keeps tracking/reconciling; add ops resolve tool.
  - D3 gas: release unspent reservations on cancel/expiry; EVM drops only after the network-fee leg settled; max 5 drops/user/day/chain.
  - D4 token rent: count in gas budget and include in network fee.
  - D5 BTC PSBT: miner fee ≤ min(2% of sell amount, 100k sats); deposit = sell amount; refund/change output to user required; signed PSBT inputs = quoted inputs.
  - D6 price move: refuse (re-plan) when fresh quote minOut < plan preview minOut; show fresh figures before wallet opens.
  - D7 ledger: chain evidence only; missing → UNKNOWN + recheck; never provider amounts.
- Fix wave dispatched (Sonnet) BASE da3d30f
- fix-wave agent id: a40cdc7c2d938d848
