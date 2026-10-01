# ADR-014: First Investment Execution — LI.FI Routing, Platform Gas and the Network Fee Leg

- **Status:** APPROVED (design approved in conversation 2026-10-01; implemented in Spec 8)
- **Date:** 2026-10-01
- **Owners:** Product + platform engineering
- **Related:** D-002, D-012, D-013, D-030, D-032, D-033, D-067, D-068, D-069, D-070; ADR-004, ADR-010, ADR-011, ADR-013; spec `docs/superpowers/specs/2026-10-01-first-investment-design.md`

## Context

ADR-013 decided self-custody, user-signed plans of legs and USDC-on-Solana funding, and left open the route provider, destination gas, fee legs and native Bitcoin. Spec 8 implements first investment and exit (invest, positions, portfolio, leave, sell to USDC, sell former assets) and needs those answers.

## Decision

### 1. Route provider: LI.FI only, behind `RouteProvider` (D-013)

- One aggregator, **LI.FI**, behind a `RouteProvider` interface (`connections`, `quote`, `status`) in `apps/api/src/providers/routes/`. The interface exists because Spec 11 (RWAs, tokenized ETFs) adds providers; selection iterates `ROUTE_PROVIDER_ORDER` (default `lifi`) filtered by the provider named on the registry execution route. 0x is not used.
- Quotes carry `fromChain`, `toChain`, `fromToken`, `toToken`, `fromAmount`, `fromAddress`, `toAddress` (the user's own linked address), `slippage` and `integrator`, plus `svmSponsor` when the source is Solana. Responses are zod-validated; the quote's tokens, chains, `toAddress` and minimum output are checked against the leg before use, and a mismatch is a provider error.
- Env: `LIFI_API_KEY`, `LIFI_INTEGRATOR`, `ROUTE_PROVIDER_ORDER`.

### 2. Plan, leg kinds and order

- Invest: `network_fee` first, then one asset leg per constituent: `swap` (Solana to Solana token) or `cross_chain` (USDC on Solana to an EVM token or native BTC, delivered to the user's linked address). Sell: one asset leg per held deployment (`swap` or `cross_chain` back to USDC on Solana), then `network_fee` last, paid from the proceeds.
- The amount the user enters **includes** the network fee: deployable `D = A - F`, split by weight with the remainder to the largest weight. The balance check is `balance >= A`.
- Each leg stores amounts, minimum received (user slippage, default 100 bps, max 300 bps), provider and route summary, 60 s quote expiry, gas payer. Legs are strictly sequential; the first asset leg may follow a `network_fee` that is on chain. A plan expires 30 minutes after creation if nothing was submitted; one `PLANNED`/`IN_PROGRESS` operation per user (partial unique index) and an idempotency key per request.
- Operation outcomes: `COMPLETED`; `PARTIAL` when an asset leg settled and the user stops or a leg fails; `FAILED` when nothing but the fee settled; `CANCELLED` only before any submission. `PARTIAL`, `FAILED` and `CANCELLED` are terminal: continuing means a new plan. Nothing is retried automatically.

### 3. Signing per source chain

- **Solana source:** the server fetches a fresh quote with `svmSponsor` (the platform fee payer) and stores the SHA-256 of the message; the wallet signs with `signTransaction`; the client posts the signed transaction; the server verifies the message bytes equal the stored message (otherwise 409 `TX_MISMATCH`, nothing is signed or sent), checks the fee payer is account 0, adds only the fee-payer signature and sends once (`maxRetries: 0`). The `network_fee` transfer is a server-built USDC `TransferChecked` (with idempotent creation of the treasury token account) handled the same way. An unknown send outcome is recorded with the deterministic transaction signature and tracked, never resent.
- **EVM source (sells):** a platform gas drop first (below), confirmed; the wallet sends the LI.FI transaction (exact-amount ERC-20 approval first when needed, mined before the main transaction); the client posts the hash; the server checks `to`, the hash of `data` and `value` against the quote.
- **Bitcoin source (sells):** LI.FI returns a PSBT built from the user's UTXOs; the wallet signs every input with `signPSBT`; the server checks the outputs (vault deposit, OP_RETURN memo, refund to the user) against the quoted ones (otherwise 409 `PSBT_MISMATCH`), finalizes and broadcasts. The miner fee comes from the user's own BTC inside the PSBT.

### 4. Platform gas and the network fee leg (D-067, D-068)

- **Platform wallets** (`platform_wallets`: Solana fee payer, EVM gas wallet, gas treasury): keys come from env secrets (`SOLANA_FEE_PAYER_SECRET`, `EVM_GAS_WALLET_SECRET`; KMS before launch), stay inside one module each, are never logged and never receive user assets except the network fee at the treasury.
- **EVM:** before each EVM-source leg the gas wallet sends native gas (LI.FI estimate x 1.5) to the user's address on that chain, skipped when the balance already covers it. One drop per leg (unique index); a drop whose send outcome is unknown stays `pending` and is never resent. The client waits until it is confirmed before asking for a signature.
- **Network fee:** estimated gas in USD for all legs x 1.2 (no markup, no refund), converted with the USDC price (1.0 when no fresh price), at least 0.01 USDC. It is a user-signed USDC transfer on Solana to the gas treasury and is shown in every preview as "Network fee (paid to Bytesac for gas)". Money is BigInt raw units; floats only for display and one rounding step.
- **Caps:** per user per day Solana 0.02 SOL and about $5 per EVM chain; global per day about $200 per chain. The caps are constants in native units in `services/gas.ts` (assuming SOL $150, ETH $2,500, BNB $600, POL $0.20) and need re-tuning. Gas is reserved at plan time under a per-chain advisory lock (a refused budget is 409 `GAS_BUDGET_EXHAUSTED` and leaves no operation). A low platform wallet balance only logs a warning (`gas-wallet-check` every 15 minutes); it does not yet block plans.

### 5. Bitcoin (D-032, D-033)

- Native BTC is supported (constituents must be `native` deployments on `bitcoin`). Bitcoin addresses are **linked after sign-in** (`POST /v1/me/chain-accounts/bitcoin/challenge` and `/verify`, purpose `add_chain_account`, one address per user, not linked elsewhere, session rotation, audit). Bitcoin is **never a sign-in method**: the auth input schemas use `signInChainSchema`, which excludes it.
- Proof: BIP-322 "simple". The server builds the standard's `to_spend`/`to_sign` virtual transactions, returns the unsigned `to_sign` PSBT with the challenge, the wallet only calls `signPSBT`, and the server verifies the witness for P2WPKH, P2TR and P2SH-P2WPKH (verified against the BIP's official test vectors). Wallets whose `signPSBT` cannot sign it fall back to a BIP-137 message signature (legacy, P2SH-P2WPKH, P2WPKH), because Reown's `signMessage` ignores the BIP-322 protocol parameter.

### 6. Tracking, finality and reconciliation (D-070)

- `track-leg` after submission: source finality (Solana `finalized`; EVM receipt plus confirmations Ethereum 12, Base 10, BNB 15, Arbitrum 10, Polygon 128; Bitcoin 2), cross-chain delivery through the LI.FI status API, then the received amount. Backoff for 30 minutes, then `UNKNOWN`; re-checked hourly for 7 days, then left for ops. A leg never goes back to a submitter.
- On `SETTLED` an asset leg writes an append-only ledger entry (`position_ledger_entries`) and the operation status is recomputed in one transaction. Positions equal what actually arrived.
- `reconcile-positions` (nightly and on `GET /v1/portfolio`, at most once a minute per user) compares wallet balances (SPL, ERC-20, native, Bitcoin confirmed balance) with the summed ledger; a shortfall is allocated pro-rata (ADR-013) and shown as `SHORT`, a surplus is outside baskets. Display only: repair is Spec 9.
- Exit: Leave closes the position with no transaction; Sell sells `min(ledger x percent, wallet balance)` per deployment; Sell former assets uses a closed position. Exits do not depend on the registry route status, so a retired basket can always be exited.

### 7. Dependencies (pinned exact, newest allowed by the minimum release age; no exclusions)

`@solana/web3.js` 1.99.0, `@scure/btc-signer` 2.4.1, `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0 (API; BIP-322 is built on these because `@scure/btc-signer` cannot verify it, which avoids a `bip322-js` dependency); web: `@reown/appkit-adapter-bitcoin` 1.8.24 (same as the other AppKit packages) and `@solana/web3.js` 1.99.0.

## Alternatives considered

- **0x or several providers now** — rejected: LI.FI covers Solana, EVM and Bitcoin sources and destinations in one API; the abstraction keeps later providers possible.
- **User pays gas on every chain** — rejected: users would need native gas on each chain; the product asks for platform gas recovered transparently.
- **Network fee deducted by the platform** — rejected: it would be a pull from the user's wallet; a user-signed transfer leg keeps ADR-013's rule that nothing is pulled.
- **Bitcoin sign-in** — rejected for release 1: wallet coverage of BIP-322 is uneven and Bitcoin has no use as an identity here.
- **Unlimited ERC-20 approvals / delegated signing** — rejected (ADR-013).

## Consequences

- Positive: funds only move by transactions the user signs; the platform co-signs only byte-identical planner-built Solana transactions and sends capped gas drops; unknown outcomes are reconciled, never resubmitted; positions equal arrived amounts.
- Negative: several signatures per operation across up to three wallet types; a wallet that adds instructions to a Solana transaction (for example guard programs) changes the message and is refused with `TX_MISMATCH` by design; `PARTIAL` and `FAILED` are terminal, so continuing needs a new plan and a new network fee; the fee is not refunded when a plan stops early.
- Security: the fee-payer and gas keys are the highest-value platform secrets (KMS before launch); plan-time gas reservation bounds platform exposure per user and per day.

## Pre-launch checks (not machine-verified; tests mock LI.FI, RPC, Alchemy and wallets)

1. LI.FI with a real key: the quote echoes `toAddress` (our validation requires it); `svmSponsor` works on every Solana leg type; the Solana `transactionRequest.data` is a base64 versioned transaction; the Bitcoin PSBT encoding (hex or base64 are both accepted) and its output shape (deposit, OP_RETURN memo, optional refund); minimum-output rounding (one unit of tolerance); terms, rate limits and integrator fee settings.
2. Alchemy Bitcoin: `/tx/{txid}` and `POST /sendtx/` follow Blockbook parity, but only the address endpoint was confirmed from documentation; `ALCHEMY_API_KEY` also needs the Bitcoin host.
3. Wallets that modify Solana transactions (guard instructions): tested manually with Phantom and Solflare; a changed message is `TX_MISMATCH`.
4. Reown Bitcoin `signPSBT` of the BIP-322 virtual transaction per wallet (Xverse, Leather, Unisat, OKX); the BIP-137 fallback covers the others; Taproot has no BIP-137.
5. Gas cap values, treasury funding, KMS for the platform keys, legal review of the network fee and self-custody flows, and a mainnet small-amount manual test (a user action) of invest, partial stop, leave, sell and sell former assets on every chain.

## Open items

Gas cap tuning and an env or table override; blocking plans below the next drop when a platform wallet is low; LI.Fuel route gas top-up and conventional ETFs/stocks (`FUTURE-PLANS.md`); repair, rebalance, skip and drift (Spec 9); fees (Spec 10); RWAs (Spec 11).
