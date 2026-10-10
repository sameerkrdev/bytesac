# ADR-016: Manager Fees, Platform Fees and Earnings (Release 1)

- **Status:** APPROVED (design approved in conversation 2026-10-02; implemented in Spec 10)
- **Date:** 2026-10-02
- **Owners:** Product + platform engineering
- **Related:** D-006, D-058, D-067, D-071, D-079, D-085 to D-092; ADR-011, ADR-013, ADR-014, ADR-015; spec `docs/superpowers/specs/2026-10-02-fees-payouts-design.md`; `docs/domains/FUND-MANAGER-FEATURES.md`; `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`

## Context

ADR-013 decided that fees are explicit transfer legs inside a plan the user signs, never pulled, and left the recipients, the base, the timing and the reporting open. ADR-011 made the version fee schedule a disclosure only. Spec 10 charges the manager's entry and rebalance fees and a configurable platform fee per operation type, and reports what settled.

## Decision

### 1. Recipients: no escrow (D-085)

- A manager fee is a USDC transfer from the user's wallet straight to the organization's `VERIFIED` payout wallet (D-006) read when the plan is created. Bytesac never holds manager money and runs no payout job.
- A platform fee is a USDC transfer to a platform revenue treasury (`platform_wallets` purpose `revenue_treasury`, env `REVENUE_TREASURY_SOLANA_ADDRESS`). The network fee (D-067) still goes to the gas treasury.
- Fee terms are fixed when the plan is created (`operation_fees`, append-only except `settled_at`). Later schedule, version or payout-wallet changes never touch an open plan.

### 2. Fee math (D-086)

All amounts are micro-USDC `BigInt` in `@repo/validator`.

| Fee | Operation | Base |
|---|---|---|
| `manager_entry` | `invest` | amount entered |
| `manager_rebalance` | `rebalance` applying a newer version (target `latest`) | planned traded value: planned sells plus buys funded from existing basket cash |
| `platform` | `invest`, `rebalance_apply`, `rebalance_drift`, `repair`, `sell_to_usdc`, `sell_former` | amount entered, planned traded value, planned buy cost or planned sale value (quantity x fresh market price) |
| `network` | every plan | gas estimate (D-067) |

- Manager percent: `min(floor(base x bps / 10 000), cap)`; fixed: the amount. The terms come from the plan's target version. A manager fee is not charged on drift fixes, repairs, syncs or sells.
- Platform: `clamp(floor(base x bps / 10 000), min, max)` using the schedule resolved at plan time (section 3). The rate is never above 100 bps.
- A fee below 0.01 USDC is not charged and is recorded with `waivedReason: "dust"`. A platform fee whose base has no fresh price is recorded as waived `no_price`.
- Invest: deployable `D = A - network - manager - platform`; refused ("The amount doesn't cover the fees.") when `D` is not above zero or a constituent share becomes zero.

### 3. Platform fee schedules (D-087)

- A default schedule per operation type plus organization and basket overrides (optional end date). Precedence: active basket override, then active organization override, then the default; an override is active until it is superseded or ended. Default is 0 (nothing charged).
- Rows are versioned (`platform_fee_schedules`): saving supersedes the active row for the same scope and operation in one transaction under an advisory lock; ending an override sets `supersededAt`. Each row needs a reason. Only `ops_admin` edits (audited `platform_fee.updated`, `platform_fee.override_ended`); `ops_reviewer` reads. Edits apply to new plans only.
- A repair spans baskets and has no organization or basket, so only the default schedule can apply to it.
- Public: `GET /v1/public/fees` and the public `/fees` page show the active default schedule (no reason text); the basket page shows the rate that applies to that basket.

### 4. Manager fee terms (D-058, D-088)

The percent variant of an entry or rebalance fee gains an optional `maxUsdc` cap ("1% up to $50"); percent stays 0 to 100 bps and a fixed amount stays at most 1% of the minimum investment. A version without a cap is uncapped. Management and subscription fees remain disclosures: the web labels them "Disclosed — not collected in this release".

### 5. One combined fee leg (D-089)

- The `network_fee` leg keeps its kind name (existing paths and history stay valid) and becomes the combined fee leg; its `amountIn` is the total of the charged fees and the UI labels it "Fees". `operationView.fees[]` carries every fee (`kind`, `amountMicro`, `recipientLabel`, `waivedReason`); `networkFeeUsdc` stays the network row only.
- One server-built Solana transaction: ComputeBudget (limit 1,400,000, price 16,001 micro-lamports, same as live LI.FI Solana quotes), then for each charged fee an idempotent token-account creation for the recipient (funded by the platform fee payer) and one USDC `TransferChecked` from the user, in the order network, manager, platform. The fee payer co-signs the stored message, or a wallet rewrite that changes only ComputeBudget while every transfer still matches (`TX_MISMATCH` otherwise; ADR-014). At plan time the API checks each charged manager and platform recipient's USDC token account (`getAccountInfo`); the network fee and the gas reservation include the token-account rent (priced with the plan's SOL quote, a fixed fallback only when no quote carries a price) only for accounts that do not exist, and an RPC error counts as missing. If an account is closed between plan and signing, the platform pays that rent within its gas reservation.
- A fee leg quotes from the stored fee rows, whose charged sum must equal the leg's `amountIn` (otherwise 503 `ROUTE_UNAVAILABLE`, nothing built). An operation without fee rows (planned before this release) quotes the single transfer of `amountIn` to the gas treasury and its view lists one network fee.
- Placement uses the total: invest first; rebalance and sell follow D-079 and D-071; repair first from free USDC (`free >= fees + buy`). Paid from basket cash, the cash entry debits the total.
- When a plan has a platform fee above the dust threshold and no revenue treasury is configured, planning is refused with 503 `ROUTE_UNAVAILABLE`; the plan is also refused when no gas treasury is configured.

### 6. Timing and refunds (D-090)

Fees are charged first, on the planned amount, and are not refunded when the operation ends `PARTIAL` or `FAILED` or is stopped. Every preview says so. Fee credits or refunds are future scope.

### 7. Waivers (D-091)

A manager fee for an organization without a `VERIFIED` payout wallet is waived (recorded with `payout_wallet_unavailable`, no transfer): the user is never blocked, ops get a warning log and the organization owner an email (deduped per organization per day). Waived fees are listed in the earnings and revenue reports.

### 8. Reporting and reconciliation (D-092)

- `earnings.read` (Owner and Admin): `/organization/earnings` and `GET /v1/organizations/:id/earnings` show settled manager fees by basket, version, kind and month, recent transactions with explorer links and a waived count; CSV export (a cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with an apostrophe so a spreadsheet does not run it).
- Ops roles: `/ops/revenue` and `GET /v1/ops/revenue` show settled platform fees by operation type and month and waived manager fees by reason; CSV export. Ops edit schedules at `/ops/fees`.
- Reports read only fees whose leg settled (`settled_at` is stamped when the fee leg settles; `settled_chain_at` holds the fee transaction's block time).
- Daily worker job `revenue-reconcile` (04:00 UTC) compares settled platform fees with the revenue treasury's USDC inflows for the previous UTC day and logs a mismatch; it is read-only. It buckets fees by `coalesce(settled_chain_at, settled_at)`, the on-chain block time where known (D-112), so a settlement recorded just after midnight does not cause a false warning.

### 9. Revenue bucketing by chain time (D-112)

`operation_fees.settled_chain_at` is the fee transaction's Solana block time, recorded when the fee leg settles. The daily reconciliation buckets by `coalesce(settled_chain_at, settled_at)`, so a settlement recorded just after midnight no longer raises a false mismatch.

## Alternatives considered

- **Platform treasury with manager payouts** — one place to dispute and net fees, but Bytesac would hold manager money (custody and licensing burden) and need a payout job. Rejected: direct transfers keep ADR-013.
- **Platform take rate on manager fees** — a share of each manager fee to the platform. Deferred (`FUTURE-PLANS.md`); a separate platform fee per operation covers revenue now.
- **Subscriptions through token delegation** — prepaid signed periods are possible, but auto-renewal needs a standing allowance and ADR-013 forbids delegated spending without its own ADR. The whole feature is deferred.
- **Management-fee accrual** — needs a collection point and a rule for unpaid fees; deferred.
- **Pulling fees at settlement** — rejected: nothing is pulled from a wallet.

## Consequences

### Positive
- No custody of fees; every fee is shown with its recipient before the user signs once.
- Ops can tune the platform fee by operation, organization and basket with a full audit trail; existing plans never change.

### Negative / trade-offs
- Fees are not refunded when an operation stops early.
- A manager without a verified payout wallet loses the fee (waived) rather than blocking the user.
- The fee leg builds from recorded recipient addresses and does not re-read the payout wallet (snapshot at plan time; plans live 30 minutes).
- If a recipient's token account is closed between plan and signing, the platform absorbs the token-account rent (about 0.002 SOL per recipient); it is not part of the gas reservation, which counts rent only for accounts missing at plan time.

### Security, financial and operational impact
- Fee-payer validation refuses a fee transaction with any transfer other than the recorded recipients and amounts. Payout addresses come only from `VERIFIED` wallets. Ops edits need `ops_admin` and a reason.
- Fund the revenue treasury token account and configure `REVENUE_TREASURY_SOLANA_ADDRESS` before any platform fee above zero.

## Migration / rollout

Migration `0013_fees.sql`: enums `fee_kind`, `platform_fee_operation`, `fee_scope`; tables `operation_fees` and `platform_fee_schedules`; `platform_wallet_purpose` gains `revenue_treasury`; permission `earnings.read` for Owner and Admin. Existing operations have no fee rows and need no backfill: their fee leg is the single transfer to the gas treasury as before, and their view shows one network fee from `networkFeeUsdc`. Mobile is unchanged.

## Validation

- Validator: manager fee (percent, cap, fixed, rounding), platform clamp, dust, override resolution, schema bounds. API: plans with every fee, tampered fee transaction, every D-079 branch, waivers, schedule edits after plan creation, settlement stamping, earnings permissions and CSV, revenue, reconciliation. Web: fee lines, cap input, ops fees, earnings, public fees.
- Pre-launch: legal review of manager fees paid by users to organizations and of the platform fee; tax and reporting obligations; revenue treasury funding; fee cap wording (D-058).

## Open questions

1. Platform fee rates (business decision; default 0).
2. Legal review of both fee kinds and any tax statements.
