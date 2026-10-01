# Spec 8 — First Investment and Exit (Design)

- **Date:** 2026-10-01
- **Status:** Approved in conversation (2026-10-01); written spec pending user review
- **Series:** Spec 8 — after Specs 1–7 and ADR-013 (custody, execution, spend authority)
- **Builds on:** Spec 1 (wallet linking, chain accounts, contact verification), Spec 5 (registry deployments, execution routes, Alchemy RPC), Spec 6 (published baskets, minimums), Spec 7 (BullMQ worker, prices), ADR-013.
- **Sources:** `docs/source/First-Investment,-Rebalancing,-Drift-&-Fix.txt` §1–§10; `docs/source/User-Detailed-Features.txt` §9–§17; ADR-013; D-002, D-012, D-013, D-030, D-032, D-033.

## 1. Intent

A verified user invests **USDC on Solana** into an investable crypto basket (Solana, EVM and native Bitcoin constituents). The platform builds a **plan of legs** routed by **LI.FI**, the user signs every leg in their own wallets, the platform pays network gas from its own gas wallets and recovers it through a user-signed **network fee** leg, tracks each leg to settlement, and records what actually arrived as the user's basket position. The user can **leave** the basket or **sell back to USDC** at any time. No platform or manager fees are charged yet.

**Success criteria**
1. Funds only move by transactions the user signs; the platform only co-signs as Solana fee payer on byte-identical planner-built transactions and sends gas drops from its own wallets.
2. Every leg is tracked to `SETTLED`, `FAILED` or `UNKNOWN`; unknown outcomes are reconciled, never resubmitted.
3. Positions equal amounts actually received (append-only ledger), reconciled against chain balances.
4. Exit (leave, sell, sell former assets) works from day one with no manager approval.
5. Gas costs are recovered transparently via a network fee leg shown in every preview.

## 2. Decisions (this brainstorm)

| Topic | Decision |
|---|---|
| Scope | Invest, positions + ledger, reconciliation (display), portfolio, Leave / Sell to USDC / Sell former basket assets. Crypto and stablecoins including native BTC. |
| Later specs | Spec 9: rebalance, skip/catch-up, drift, fix, `SHORT` repair. Spec 10: subscriptions, platform/manager fees, payouts. Spec 11: RWAs and tokenized ETFs (eligibility engine; LI.FI or other providers). Future plans: LI.Fuel route gas top-up, conventional ETFs/stocks. |
| Provider | **LI.FI only**, behind a `RouteProvider` abstraction (configurable provider order; new providers plug in later). 0x is not used. |
| Bitcoin | Native BTC supported. Users link a Bitcoin address after sign-in (add-chain) with a BIP-322 proof; Bitcoin is never a sign-in method. |
| Gas | Platform gas only: Solana via LI.FI `svmSponsor` (platform fee payer); EVM via native gas drops before each EVM-source transaction; Bitcoin miner fees come from the user's own BTC inside the PSBT (UTXO rule). Caps per user/day/chain + global per chain. |
| Network fee | First leg of every plan: user-signed USDC transfer on Solana to the platform gas treasury = estimated gas for all legs + 20% buffer, no markup, no refund. Sells: paid from proceeds as the last leg. |
| Reconciliation | Per-leg confirmation (RPC + LI.FI status API); nightly and on-demand reconciliation; `SHORT`/surplus display only (repair in Spec 9). |

## 3. Out of scope

Rebalance/skip/drift/fix/repair actions, platform and manager fees, RWAs/tokenized ETFs, LI.Fuel, account abstraction, delegated signing, Bitcoin sign-in, mobile screens, alert webhooks.

## 4. Investability and eligibility

- **Investable basket** (`GET /v1/baskets/:slug/investability`): status `ACTIVE`, published version, every constituent is `CRYPTO` or `STABLECOIN` (no `TOKENIZED_*`), each has an `ACTIVE` deployment with an `ACTIVE` execution route whose provider is enabled (`ROUTE_PROVIDER_ORDER`), and LI.FI reports a connection from USDC on Solana to that deployment (cached 1 h). Bitcoin constituents must be `native` deployments on `bitcoin`. Otherwise `investable: false` with reasons (per instrument).
- **Eligible user:** verified email and phone (Spec 1); a linked address for each chain family the basket needs (`evm`, `bitcoin`; Solana is the investment wallet); no other operation in `PLANNED`/`IN_PROGRESS` (one active operation per user, enforced by a partial unique index).
- **Amount:** ≥ basket minimum; multiple of the increment when set; ≤ user's USDC balance on Solana minus the network fee (checked at plan time and again before the first leg).

## 5. Provider abstraction (`apps/api/src/providers/routes/`)

```ts
interface RouteProvider {
  id: "lifi";
  connections(i: { fromChain: AssetChain; fromToken: string; toChain: AssetChain; toToken: string }): Promise<boolean>;
  quote(i: LegQuoteInput): Promise<LegQuote>;        // includes toAddress, slippage, svmSponsor where Solana is the source
  status(i: { txHash: string; fromChain: AssetChain; toChain: AssetChain }): Promise<LegStatus>;
}
```

- One implementation now (`lifi.ts`); the interface exists because Spec 11 adds providers (RWAs/ETFs) — selection iterates `env.ROUTE_PROVIDER_ORDER` (default `lifi`) filtered by the registry route's provider.
- LI.FI quote uses `fromChain`, `toChain`, `fromToken`, `toToken`, `fromAmount`, `fromAddress`, `toAddress` (the user's own address on the destination chain), `slippage`, `integrator`, and `svmSponsor` (platform Solana fee payer) when the source is Solana. Responses are zod-validated; the quote's `toAddress`, tokens, chains and minimum output are checked against the leg before use; a mismatch is a provider error.
- Env: `LIFI_API_KEY`, `LIFI_INTEGRATOR`, `ROUTE_PROVIDER_ORDER`.

## 6. Plan and legs

- **Invest allocation:** amount `A` (micro-USDC BigInt); network fee `F` (§7); deployable `D = A − F`; per constituent `D × bps / 10000`, remainder to the largest weight.
- **Leg kinds and order:** (1) `network_fee` — USDC transfer on Solana to the gas treasury; (2..n) one leg per constituent: `swap` (Solana → Solana token via LI.FI) or `cross_chain` (USDC on Solana → EVM token or native BTC via LI.FI, delivered to the user's linked address).
- **Each leg:** source/destination chain and deployment, amount in, minimum received (from user slippage, default 100 bps, max 300 bps), provider + route summary, quote expiry (60 s), estimated gas, gas payer (`platform_fee_payer`, `platform_gas_drop`, `user_btc_inputs`).
- **Plan binding:** basket version, user addresses, idempotency key; invalidated when the version, routes, balances or prices change materially; a plan expires 30 min after creation if no leg was submitted.
- **Signing per leg** (strictly sequential; the next leg starts after the previous is `SETTLED`, except `network_fee` → first asset leg which may proceed once `network_fee` is `PENDING_CHAIN` confirmed):
  - **Solana source:** server fetches a fresh LI.FI quote with `svmSponsor`, returns the unsigned transaction and stores its message hash; the user's wallet signs; client posts the signed transaction; server verifies the message bytes equal the stored message (else 409 `TX_MISMATCH`), adds the fee-payer signature and submits. The `network_fee` transfer is built by the server (SPL transfer, fee payer = platform) and handled the same way.
  - **EVM source** (sell legs): platform gas drop first (§7), confirmed; then the user's wallet signs and submits the LI.FI transaction (exact-amount approval where needed); client posts the tx hash; server verifies the transaction's `to`, `data` hash and `value` match the quote.
  - **Bitcoin source** (sell legs): LI.FI returns a PSBT built from the user's UTXOs; the user signs via the wallet's `signPSBT`; server verifies outputs (LI.FI deposit address and amount, OP_RETURN memo, refund address = user) match the quote (else 409 `PSBT_MISMATCH`) and broadcasts.
- **Leg states:** `PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`; an expired quote leaves the leg `PLANNED` (fresh quote + signature required). **Operation states:** `PLANNED → IN_PROGRESS → COMPLETED | PARTIAL | FAILED | CANCELLED` (`PARTIAL` when some asset legs settled and the user stops or a leg fails; `CANCELLED` only before any submission).
- Unspent USDC stays in the user's wallet (outside baskets). Nothing is retried automatically.

## 7. Gas model

- **Platform wallets** (`platform_wallets`: chain, purpose `solana_fee_payer` | `evm_gas` | `gas_treasury`, address): keys from env secrets (`SOLANA_FEE_PAYER_SECRET`, `EVM_GAS_WALLET_SECRET`; KMS before launch); they hold platform funds only and never receive user assets except the network fee (treasury).
- **Solana:** LI.FI transactions carry the fee payer via `svmSponsor`; the server co-signs only verified bytes. Fallback if a route cannot be sponsored: a SOL gas drop to the user's wallet before the leg.
- **EVM:** before each EVM-source leg, `evm_gas` sends native gas = LI.FI/RPC gas estimate × 1.5 to the user's address on that chain (skipped if the user's balance already covers it); the drop is a `gas_drops` row (leg, chain, recipient, amount, tx, status) and must confirm before the user signs.
- **Bitcoin:** miner fees are paid from the user's BTC inputs in the PSBT and shown in BTC; no platform gas.
- **Network fee estimate:** sum over legs of estimated gas in USD (Solana fee-payer fees + EVM drops + 0 for BTC) × 1.2, converted to USDC (prices via `getPrices`), minimum 0.01 USDC. For sells, the last leg transfers the fee from proceeds.
- **Caps** (`gas_budgets` config + `sponsor_usage` per user/day/chain under a row lock): defaults per user/day — Solana 0.02 SOL, each EVM chain the equivalent of $5; global per day per chain — $200 equivalent (values confirmed in review). Exceeded → 409 `GAS_BUDGET_EXHAUSTED` before any leg is submitted. Low wallet balance → ops warning log and plans blocked when below the next drop.

## 8. Positions, ledger and data model (`@repo/db`, migration `0010_positions.sql`)

- Bitcoin linking: wallet address family `bitcoin`, verification method `bip322` (§9).
- `basket_positions`: `id`, `user_id`, `basket_id`, `status` (`OPEN`, `CLOSED`), `applied_version_id`, `opened_at`, `closed_at`; partial unique one `OPEN` per `(user_id, basket_id)`.
- `position_ledger_entries` (append-only): `id`, `position_id`, `deployment_id`, `quantity_delta` numeric (raw base units, signed), `reason` (`invest`, `sell`), `leg_id`, `created_at`. Holding = sum per deployment.
- `operations`: `id`, `user_id`, `basket_id`, `position_id`, `kind` (`invest`, `sell_to_usdc`, `sell_former`), `status`, `amount_usdc` numeric, `sell_percent` int, `slippage_bps`, `network_fee_usdc` numeric, `version_id`, `idempotency_key` (unique per user), `expires_at`, timestamps; partial unique one `PLANNED|IN_PROGRESS` per user.
- `operation_legs`: `id`, `operation_id`, `sequence`, `kind` (`network_fee`, `swap`, `cross_chain`), `from_chain`, `from_deployment_id`, `to_chain`, `to_deployment_id`, `amount_in` numeric, `min_out` numeric, `provider`, `route_summary` jsonb, `quote_expires_at`, `built_message_hash`, `status`, `source_tx`, `destination_tx`, `amount_received` numeric, `gas_payer`, `failure_reason`, `unknown_since`, timestamps.
- `gas_drops`, `platform_wallets`, `sponsor_usage` (`user_id`, `chain`, `day`, `amount_native` numeric; PK `(user_id, chain, day)`).
- `position_reconciliations`: `position_id`, `deployment_id`, `ledger_quantity`, `allocated_quantity`, `wallet_balance`, `status` (`OK`, `SHORT`, `SURPLUS`), `checked_at` (latest row per pair is current; append-only history).
- Grants/RLS as before; no DELETE.

## 9. Bitcoin address linking (Spec 1 extension)

- Logged-in add-chain only: `POST /v1/me/chain-accounts/bitcoin/challenge` → message (Spec 1 challenge rules); `POST /v1/me/chain-accounts/bitcoin/verify { address, signature, method: "bip322" | "bip137" }`.
- BIP-322 proof built as the standard's virtual `to_spend`/`to_sign` transactions: the client asks the wallet to `signPSBT` the `to_sign` PSBT; the server verifies the witness against the address (P2WPKH, P2TR, P2SH-P2WPKH). Fallback `bip137` message signatures accepted for address types that support them (legacy/P2WPKH) because Reown's Bitcoin `signMessage` ignores the BIP-322 protocol parameter.
- Same rules as other chain accounts: one Bitcoin address per user, address cannot be linked to another user, audited; no Bitcoin sign-in.

## 10. Tracking and reconciliation (BullMQ worker)

- `track-leg { legId }` — after submission: source finality via Alchemy (Solana `finalized`; EVM receipt + per-chain confirmations: Ethereum 12, Base 10, BNB 15, Arbitrum 10, Polygon 128; Bitcoin 2 confirmations via Alchemy Bitcoin API); cross-chain delivery via LI.FI status API, then the destination transaction; `amount_received` from the destination balance change/logs (or UTXO value for BTC). Backoff to 30 min, then `UNKNOWN` (re-checked hourly up to 7 days, then left for ops). On `SETTLED`: ledger entry (invest legs) and operation status recompute in one transaction. Never resubmits.
- `reconcile-positions` — nightly and on `GET /v1/portfolio` (60 s cache per user): Alchemy balances (SPL, ERC-20, native, Bitcoin UTXO sum) per deployment vs summed ledger across the user's open positions; shortfall allocated pro-rata (ADR-013) → `SHORT`; excess → `SURPLUS` (outside baskets). Display only in this spec.
- `gas-wallet-check` — every 15 min: platform wallet balances vs thresholds → warning logs.

## 11. API (session; verified email + phone for operations)

| Method & path | Purpose |
|---|---|
| `GET /v1/baskets/:slug/investability` | Investable flag, reasons, required chain families, minimum, user eligibility. |
| `POST /v1/operations/invest { basketId, amountUsdc, slippageBps, idempotencyKey }` | Plan (legs, network fee, estimates). |
| `POST /v1/operations/:id/legs/:legId/quote` | Fresh quote + unsigned transaction / PSBT (and gas drop status for EVM). |
| `POST /v1/operations/:id/legs/:legId/submit { signedTx? , txHash?, signedPsbt? }` | Submit (Solana co-sign; EVM hash verify; BTC PSBT verify + broadcast). |
| `POST /v1/operations/:id/cancel` | Cancel when nothing submitted; or stop a `PARTIAL` (remaining legs abandoned). |
| `GET /v1/operations/:id` · `GET /v1/portfolio` | Operation detail · positions, holdings, values (`getPrices`), reconciliation, open operations, former positions. |
| `POST /v1/positions/:id/leave` | Close position (no transaction). |
| `POST /v1/operations/sell { positionId, percent, slippageBps, idempotencyKey }` | Sell to USDC (open or closed position; closed ⇒ `sell_former`). Quantities per deployment = `min(ledger × percent/100, wallet balance)`. |
| `POST /v1/me/chain-accounts/bitcoin/challenge` · `/verify` | Bitcoin linking (§9). |

Errors (new): `NOT_INVESTABLE`, `NOT_ELIGIBLE`, `OPERATION_IN_PROGRESS`, `QUOTE_EXPIRED`, `TX_MISMATCH`, `PSBT_MISMATCH`, `GAS_BUDGET_EXHAUSTED`, `ROUTE_UNAVAILABLE`, `BTC_ADDRESS_REQUIRED`, `INSUFFICIENT_BALANCE`. Rate limits: 10 operations/h per user; 60 quotes/min per user; 10 Bitcoin link attempts/h per user.

## 12. Web (no mobile)

- Basket page: Invest button enabled when investable + eligible; otherwise the reason with an action link ("Verify your phone", "Link an EVM wallet", "Link a Bitcoin wallet", "Not investable yet").
- Profile: "Link Bitcoin wallet" (Reown AppKit Bitcoin adapter; BIP-322 via `signPSBT`, BIP-137 fallback).
- Invest wizard: amount (min, increment), slippage (default 1%, max 3%), preview (legs with estimated outputs and minimum received, routes, network fee line "Network fee (paid to Bytesac for gas): $X", "No platform or manager fees are charged yet"), then per-leg signing with progress (getting quote → approve in wallet → submitted → pending → settled; "Quote expired — get a new quote"; Bitcoin legs show expected confirmation time), result (completed / partial with remaining legs and "Stop here").
- `/portfolio`: positions (value, actual vs target weights, `SHORT`/outside-baskets notice), operation history with leg details and explorer links, former positions with "Sell former assets".
- Exit dialogs: "Leave basket (keep assets)" with explanation; "Sell to USDC" with percentage, preview incl. network fee from proceeds.

## 13. Security & safety

- User signs every value-moving transaction; the platform's fee payer only co-signs byte-identical planner-built Solana transactions; gas drops come only from platform gas wallets, capped, audited, for planner-built legs.
- Quote checks: tokens, chains, `toAddress` = user's own address, minimum output enforced by the route transaction; PSBT output checks; EVM transaction checks.
- Exact-amount approvals; idempotency keys; one active operation per user; no automatic retry; unknown outcomes reconciled.
- Platform keys never logged; KMS before launch. Provider responses untrusted (zod). Tests mock LI.FI, RPC, Alchemy and wallets; no real funds. Mainnet small-amount manual checks are a user action before launch.

## 14. Testing

- **Unit:** allocation split and remainder; network fee estimate (+20%, minimum); slippage → min out; leg/operation state maps; pro-rata `SHORT` allocation; provider selection order; BIP-322 verification vectors (from the BIP test vectors) and BIP-137 fallback; PSBT output checks.
- **Integration** (mocked LI.FI/RPC/Alchemy): investability reasons (RWA, missing route, BTC without native deployment); eligibility gates (unverified phone, missing EVM/BTC link, operation in progress); plan + idempotency; Solana quote → submit with `svmSponsor`, `TX_MISMATCH` rejection; EVM gas drop then submit, hash mismatch rejected; BTC PSBT submit, `PSBT_MISMATCH` rejected; gas caps per user and global; `track-leg` to `SETTLED` with ledger entry, `FAILED`, timeout → `UNKNOWN` never resubmitted; partial operation and stop; network fee leg first (invest) and last (sell); leave; sell percent with `min(ledger, wallet)`; sell former; reconciliation `SHORT`/`SURPLUS`; Bitcoin linking (duplicate address refused); grants no DELETE.
- **Web:** investability states and links; Bitcoin linking; wizard preview (network fee line), per-leg progress, quote expiry, partial result; portfolio; exit dialogs.

## 15. Execution shape

Five tasks, one review at the end: (1) DB + migration + validator (plan math, network fee, states, schemas) + `RouteProvider` + LI.FI adapter (quote with `toAddress`/`svmSponsor`, Solana/EVM/BTC transaction data, status) + investability/eligibility; (2) Bitcoin linking (BIP-322/BIP-137) + platform wallets + fee-payer co-signing + EVM gas drops + budgets; (3) invest and exit operations (plan, quote, submit, network fee legs, leave, sell, sell former) + `track-leg`, `reconcile-positions`, `gas-wallet-check` jobs + ledger + portfolio API; (4) web: Bitcoin linking, invest wizard, portfolio, exit dialogs; (5) web tests + docs (ADR-014 execution/LI.FI/gas/network fee; ADR-013 amended: native BTC included, platform gas, network fee; D-013, D-032/D-033 updated; `FUTURE-PLANS.md`: LI.Fuel, conventional ETFs; domain docs; `apps/api/README.md` platform wallets, keys, budgets, LI.FI env; HANDOFF).

## 16. Open items

- LI.FI terms, rate limits, integrator fee settings; confirm `svmSponsor` and `toAddress` behaviour on every leg type with a real key.
- Reown AppKit Bitcoin adapter: wallet coverage for `signPSBT` of BIP-322 virtual transactions.
- Gas cap values, treasury funding and KMS for platform keys.
- Legal review of the network fee and self-custody flows; mainnet manual test plan (user).
