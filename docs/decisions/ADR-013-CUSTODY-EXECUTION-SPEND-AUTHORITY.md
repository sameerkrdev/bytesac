# ADR-013: Custody, Execution and Spend Authority (Release 1)

- **Status:** APPROVED (user, 2026-10-01)
- **Date:** 2026-10-01
- **Owners:** Product + platform engineering
- **Related:** D-002, D-009, D-013, D-022, D-023, D-024, D-028, D-030, D-033; ADR-004, ADR-010, ADR-011; `docs/source/User-Detailed-Features.txt` §9–§17; `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`

## Context

Investment, rebalance, fix and withdrawal cannot be specified until the platform decides where assets physically sit (D-022), how holdings are attributed when several baskets or outside activity touch the same asset (D-023), and who may sign transactions (D-024). The product sources require that users own the underlying assets, have no lock-in, withdraw without manager approval, and explicitly authorize every investment and rebalance. Settlement starts in USDC on Solana (D-030), while basket constituents may live on any supported chain (ADR-010).

## Decision

### 1. Custody — self-custody in the user's own wallets (D-022)

- Assets always sit in the user's own wallets: the Solana investment wallet (D-002) and the user's linked EVM addresses (Spec 1 chain accounts, ADR-004). The platform never holds private keys, user funds or assets in transit, and operates no vaults or smart contracts in release 1.
- A basket position is a **logical sub-ledger** row: user × basket × deployment → quantity in raw base units (with token decimals preserved). Positions are reconciled against on-chain balances; the chain is the source of truth for what the user holds.

### 2. Execution topology

- Every investment is funded with **USDC on Solana**.
- Constituents may live on any registry chain with an `ACTIVE` deployment and an `ACTIVE` execution route. Native Bitcoin is excluded in release 1; BTC exposure uses wrapped deployments, disclosed as such.
- "ETFs" in baskets means tokenized instruments in the registry (`TOKENIZED_FUND`, `TOKENIZED_EQUITY`). Conventional ETFs remain future scope (D-009).
- Cross-chain legs use **one route aggregator behind an adapter** (provider chosen from current documentation in the execution spec; 0x is the D-013 candidate). Each leg delivers to the user's **own linked address** on the destination chain.
- Destination gas uses the route's gas top-up option where available; otherwise the plan is blocked with an explicit "fund gas on <chain>" requirement.
- A basket with constituents on a chain family where the user has no linked address cannot be invested in until the user links one.
- Rebalance and fix use the same routes (sell on chain A → buy on chain B); each leg is signed on its source chain.

### 3. Operations, legs and states

- Every operation (`invest`, `rebalance`, `fix`, `sell_to_usdc`, `sell_former_assets`) is a **plan of legs**. Each leg states asset, chain, amount, route, fees, minimum received and a quote that expires after 60 seconds.
- Leg states: `PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`. An `UNKNOWN` outcome is reconciled from chain evidence (source transaction, destination delivery) and is **never blindly retried**.
- Operations may be `PARTIAL`; remaining legs need a fresh quote and a fresh signature, or the user stops.
- Every operation carries an idempotency key. Plans are invalidated when prices, balances, the basket version, routes or eligibility change materially.
- A plan always moves from the user's **current reconciled holdings** to the **latest selected target**; skipped rebalance versions are never replayed as a sequence of trades (D-028).

### 4. Spend authority — none delegated (D-024)

- Every transaction is signed by the user, at that moment, against the plan they reviewed.
- Slippage is set by the user per operation (default 1%, maximum 3%); every leg encodes its minimum output on-chain so a worse fill reverts.
- EVM token approvals are for the exact amount only (never unlimited) and are consumed within the operation.
- Wallet authentication, a manager's publication and any earlier approval never authorize a transaction.
- Delegated signing (session keys, smart accounts, standing allowances) requires a future ADR before any implementation.

### 5. Attribution and shortfalls (D-023)

- Reconciliation compares, per deployment, the sum of the user's basket sub-ledger quantities with the wallet balance.
- **Shortfall** (wallet holds less): the difference is allocated **pro-rata** across the baskets holding that deployment; affected positions become `SHORT` ("You moved or sold some of this asset outside Bytesac"). The user chooses per basket: **Fix** (a signed plan buys back to target) or **Accept** (the sub-ledger is reduced to the reconciled quantity). Nothing is restored automatically.
- **Surplus** (wallet holds more): the excess is **outside baskets** and is never sold or used by basket operations.
- No physical quantity is ever counted for two baskets; planners use reconciled quantities only.

### 6. Leaving and withdrawing (no manager approval, no lock-in)

- **Leave basket (keep assets):** no transaction. The sub-ledger is closed, its final quantities are kept as a **former basket record**, and the assets become outside-basket holdings. Rebalance offers for that basket stop.
- **Sell to USDC:** a signed plan sells all or part (amount or percentage) of a basket's positions back to USDC on Solana, using cross-chain legs where needed.
- **Sell former basket assets to USDC:** available at any time after leaving; sells `min(recorded quantity, wallet balance)` per deployment, never more.

## Alternatives considered

- **Per-user smart vault with scoped delegation** — one-step execution and strong user ownership, but requires custom on-chain programs per chain family, security audits and a delegation design before launch. Deferred to a future ADR.
- **Shared platform vault with sub-ledgers and netting** — cheapest execution, but it is custody (licensing burden) and conflicts with user ownership of underlying assets. Rejected.
- **Solana-only execution** — simplest, but excludes constituents on other chains, which the product requires. Rejected.
- **Solana as a hub for every cross-chain move** — simpler accounting, double bridge hops and fees on non-Solana rebalances. Rejected.
- **Platform bridging liquidity per chain** — fastest UX, but the platform holds funds in transit. Rejected.
- **Dedicated investment wallet / oldest-basket-first shortfall rules** — simpler accounting or predictability, but fragile or unfair. Rejected in favour of pro-rata with explicit user choice.

## Consequences

### Positive
- No custody of user funds or keys; no smart-contract audit burden in release 1.
- Users can exit at any time without platform or manager involvement; ownership is verifiable on-chain.
- Every movement of value has an explicit, user-signed authorization tied to a reviewed plan.

### Negative / trade-offs
- More signatures per operation, across multiple wallets (Solana plus EVM).
- Users may need gas on destination chains when a route offers no gas top-up.
- Cross-chain legs can take minutes and fail midway; the UI must present `PARTIAL` and `UNKNOWN` states clearly.
- Users can move basket assets outside Bytesac, so reconciliation and `SHORT` handling are permanent product features.

### Security, financial and operational impact
- Planner, route adapter and reconciliation become the critical financial components: idempotency, quote expiry, minimum-output enforcement and chain-specific finality are mandatory.
- Never retry an unknown outcome; reconcile first.
- Fees must be visible legs inside the signed plan (proposal below); nothing is pulled from a user's wallet.

## Migration / rollout

No existing data changes: no positions or operations exist yet. The first-investment spec introduces positions (sub-ledger), operations, legs, reconciliation runs and the route adapter on top of this ADR. Baskets show "Investing opens soon" until then.

## Validation

- Route provider documentation and test quotes for every chain/asset pair offered (coverage, gas top-up, fees, terms).
- Integration tests for partial completion, quote expiry, minimum-output reverts, unknown-outcome reconciliation, shortfall allocation and former-basket sales.
- Legal review of the self-custody model per launch jurisdiction.

## Open questions

1. **Route provider** — which aggregator (0x or another) covers the needed chains and assets, with what fees, limits and terms. Decided in the execution spec from current documentation.
2. **Gas top-up** — which routes can deliver destination gas; where none can, the exact user flow for funding gas.
3. **Fee collection under self-custody** — proposal: platform and manager fees are explicit transfer legs inside the signed plan, paid to the platform wallet and to the organization's verified payout wallet (D-006); never pulled. To be decided in the subscriptions & fees spec.
4. **RWA access rules** — issuer KYC, allowlists and transfer restrictions per RWA route (eligibility engine, D-025).
5. **Legal review** — self-custody model, fee model and RWA distribution per jurisdiction.
