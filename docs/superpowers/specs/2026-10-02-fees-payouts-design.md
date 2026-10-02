# Spec 10 — Manager Fees, Platform Fees and Earnings (Design)

- **Date:** 2026-10-02
- **Status:** Approved in conversation (2026-10-02); written spec pending user review
- **Series:** Spec 10 — after Specs 1–9 (ADR-013, ADR-014, ADR-015)
- **Builds on:** Spec 3 (organization payout wallet, D-006), Spec 4 (permission matrix), Spec 6 (version fee schedule, D-058), Spec 8 (plans, legs, network fee leg, fee-payer validation, ledger), Spec 9 (rebalance, repair, basket cash, fee placement D-079, notifications).
- **Sources:** `docs/source/Fund-Manager-Detailed-Features.txt` §17 (Fees), §30–§36; `docs/source/User-Detailed-Features.txt` §18–§19 (deferred), §25, §45; ADR-011; ADR-013 open question 3; D-006, D-058, D-067, D-071, D-079.

## 1. Intent

Charge the manager's **investment** and **rebalance** fees, paid by the user straight to the organization's verified payout wallet, and a **platform fee per operation type** configured by ops, all as user-signed transfers inside the plan the user reviews, shown in every preview. Report settled earnings to organizations and platform revenue to ops. Subscriptions and management-fee collection are deferred.

**Success criteria**
1. No fee is ever pulled: every fee is a transfer the user signs, to a recipient and amount the plan showed (ADR-013).
2. Manager fees go only to the organization's `VERIFIED` payout wallet; Bytesac never holds manager money.
3. Every preview lists each fee with its recipient; the fee terms used are fixed when the plan is created.
4. Ops can change the platform fee (defaults and overrides) with an audited, versioned history that never alters existing plans.
5. Earnings and revenue reports are built only from fees whose leg settled on chain.

## 2. Decisions (this brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | Recipient | Manager fees are paid directly to the organization's verified payout wallet; no platform escrow or payout job. |
| 2 | Platform fee | A separate platform fee per operation type, to a platform revenue treasury, editable by ops in the admin panel. |
| 3 | Platform fee configuration | Default schedule per operation type (bps 0–100, optional min/max USDC) plus per-organization and per-basket overrides (optional end date); precedence basket > organization > default; versioned, audited, effective for new plans only; default 0. |
| 4 | Manager fee shape | `entry` and `rebalance`: percent (0–100 bps) with an optional `maxUsdc` cap, or fixed (≤ 1% of the minimum, D-058). Existing versions stay valid (no cap = uncapped). |
| 5 | Management fee | Disclosed, not collected in this release (accrual is a future plan). |
| 6 | Subscriptions | The whole subscription feature moves to future plans; the field stays a disclosure "not collected in this release". |
| 7 | Timing | Fees are charged first (with the network fee), on the **planned** amount, and are not refunded when the operation ends `PARTIAL`, `FAILED` or is stopped; the amount entered for an invest includes every fee. |
| 8 | Rebalance fee source | The whole fee block follows D-079 (first from free USDC; else, Solana-only sells, between sells and buys from basket cash; else refused). "Manager and platform fees always up front" is a future plan. |
| 9 | Manager rebalance fee scope | Charged only when applying a newer manager version (`target: "latest"`); not on drift fix, repair, sync or sell. |
| 10 | No payout wallet | The manager fee is waived (recorded), ops warned, organization emailed; users are never blocked. |
| 11 | Reporting | `/organization/earnings` (Owner and Admin, new permission `earnings.read`) and `/ops/revenue`, CSV export, daily revenue reconciliation. |

## 3. Out of scope (recorded in `docs/domains/FUTURE-PLANS.md`)

The subscription feature (prepaid signed periods, auto-renew through token delegation with a delegation ADR, lapse effects, subscription management page); management-fee accrual and collection; manager and platform fees always paid up front from free USDC; fee credits or refunds for incomplete operations; tax statements; platform take rate on manager fees; fees on mobile.

## 4. Fees and math (`@repo/validator`, BigInt micro-USDC)

| Fee | Operation | Base | Recipient |
|---|---|---|---|
| `manager_entry` | `invest` | amount entered `A` | organization payout wallet |
| `manager_rebalance` | `rebalance` with target latest (a newer version than applied) | planned traded value `T` = Σ planned sell values + buys funded from existing basket cash | organization payout wallet |
| `platform` | `invest` (`A`), `rebalance_apply` (`T`), `rebalance_drift` (`T`), `repair` (planned buy cost), `sell_to_usdc` / `sell_former` (planned sale value) | as listed | platform revenue treasury |
| `network` | every plan (unchanged, D-067) | gas estimate | gas treasury |

- Manager percent: `min(floor(base × bps / 10 000), maxMicro ?? ∞)`; fixed: the amount. The fee terms come from the plan's **target version** (invest: the published version; rebalance apply: the latest version).
- Platform: `clamp(floor(base × bps / 10 000), minMicro ?? 0, maxMicro ?? ∞)`, using the schedule resolved at plan time: active basket override, else active organization override, else the default for the operation type. An override is active when not superseded and `endsAt` is null or in the future.
- A fee below **10 000 micro-USDC (0.01 USDC)** is not charged (no transfer); it is recorded with `waivedReason: "dust"`.
- Invest: deployable `D = A − network − manager − platform`; refused (`VALIDATION_FAILED`, "The amount doesn't cover the fees.") when `D ≤ 0` or a constituent share becomes 0.
- Sell base uses the planned sale value (quantity × market price; no price → platform fee 0 with `waivedReason: "no_price"`).

## 5. The fee leg

- The existing `network_fee` leg becomes the combined fee leg (kind name kept, so every existing code path and history row stays valid; the UI labels it "Fees"). Its `amountIn` is the total of the charged fees.
- The leg is one server-built Solana transaction: for each charged fee, an idempotent ATA `CreateIdempotent` for the recipient's USDC account (funded by the platform fee payer, rent counted in the gas reservation and the network fee as today) and one USDC `TransferChecked` from the user's token account. Order: network (gas treasury), manager (payout wallet), platform (revenue treasury). The user signs once; the fee payer co-signs only the byte-identical stored message (existing `TX_MISMATCH` flow).
- Validation extends the existing fee-payer rules: the transaction must contain exactly the expected transfers (recipient token account derived from the recorded recipient address and the USDC mint, amount equal to the recorded fee) and nothing else.
- Placement: invest → first. Rebalance and sell → the D-079/D-071 rules applied to the **total** fee. Repair → first from free USDC (balance check `free ≥ fees + buy`). When paid from basket cash, the cash entry `network_fee` (renamed in display as "fees") debits the total.
- Settlement: the leg settles like the network fee leg today; each `operation_fees` row of the operation gets `settledAt`. A fee leg that fails or is never signed leaves the rows unsettled (not revenue).
- Waiver: the organization has no `VERIFIED` payout wallet (D-006 keeps the old wallet active during a replacement, so this is rare) → manager fee row `waivedReason: "payout_wallet_unavailable"`, no transfer; ops get a warning log and the organization owner an email (deduped per organization per day).

## 6. Platform fee configuration

- `platform_fee_schedules` rows: `scope` (`default` | `organization` | `basket`), `scopeId` (null for default), `operationKind` (`invest`, `rebalance_apply`, `rebalance_drift`, `repair`, `sell_to_usdc`, `sell_former`), `bps` (0–100), `minMicro?`, `maxMicro?` (min ≤ max), `endsAt?` (overrides only), `reason` (required, ≤ 500), `createdBy`, `createdAt`, `supersededAt?`. Saving a new row for the same (scope, scopeId, operationKind) supersedes the previous one in the same transaction (partial unique index on active rows). Ending an override sets `supersededAt` on its active row through an audited "end override" action (no new row); the default schedule cannot be ended, only replaced (set `bps` 0 to stop charging).
- Only `ops_admin` edits (audited `platform_fee.updated` / `platform_fee.override_ended`); `ops_reviewer` reads.
- Public: `GET /v1/public/fees` returns the active default schedule; the basket page shows the platform rate that applies to that basket (override included, no reason text).

## 7. Manager fee schema

`feeSchema` percent variant gains optional `maxUsdc` (`DecimalString`, > 0). D-058 bounds unchanged (percent 0–100 bps; fixed and subscription ≤ 1% of the minimum). Validation, wizard (cap input next to percent), ops review checklist "fees" and the public fee display show the cap ("1% up to $50"). Management and subscription display "Disclosed — not collected in this release".

## 8. Data model (`@repo/db`, migration `0013_fees.sql`)

- `operation_fees` (append-only except `settled_at`): `id, operation_id, leg_id?, kind (network | manager_entry | manager_rebalance | platform), base_micro, bps?, cap_micro?, amount_micro, recipient_address?, organization_id?, basket_id?, schedule_id? (platform), waived_reason?, settled_at, created_at`; index `(organization_id, settled_at)`, `(kind, settled_at)`.
- `platform_fee_schedules` as §6; partial unique `(scope, coalesce(scope_id), operation_kind) where superseded_at is null`.
- `platform_wallet_purpose` + `revenue_treasury`; env `REVENUE_TREASURY_SOLANA_ADDRESS` (required when any platform fee > 0 is configured; a plan with a platform fee and no treasury → 503 `ROUTE_UNAVAILABLE`).
- Permission matrix: `earnings.read` for `OWNER` and `ADMIN`.
- Runtime role: SELECT/INSERT/UPDATE (no DELETE).

## 9. Reporting

- `GET /v1/organizations/:id/earnings?from&to&format=csv` (`earnings.read`): settled manager fees grouped by basket, version, kind and month; totals; the 50 most recent fee transactions (explorer link from the fee leg's source tx); waived fees counted separately. CSV: one row per settled fee (date, basket, version, kind, amount, tx).
- `GET /v1/ops/revenue?from&to&format=csv` (ops roles): platform fees by operation kind and month; waived manager fees by reason; CSV.
- Worker job `revenue-reconcile` (daily 04:00 UTC): sums settled platform fees per UTC day and compares with the revenue treasury's USDC token-account inflows for that day (Solana RPC signatures + parsed transfers); a difference logs `revenue reconciliation mismatch` with both totals. Read-only.

## 10. API

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/operations/invest`, `/rebalance`, `/repair`, `/sell` | operation view gains `fees: { kind, amountMicro, recipientLabel, waivedReason? }[]` |
| GET | `/v1/public/fees` | active default schedule |
| GET/POST | `/v1/ops/fees` | list history / save default row (`ops_admin` to save) |
| GET/POST | `/v1/ops/fees/overrides`, `POST /v1/ops/fees/overrides/:id/end` | organization/basket overrides |
| GET | `/v1/organizations/:id/earnings` | `earnings.read`; `format=csv` |
| GET | `/v1/ops/revenue` | ops roles; `format=csv` |

Basket public detail gains `platformFee` (applicable rates). Error codes: none new (`VALIDATION_FAILED`, `INSUFFICIENT_BALANCE`, `ROUTE_UNAVAILABLE`, `TX_MISMATCH` reused).

## 11. Web (no mobile)

Previews in the invest wizard, rebalance review, repair and sell dialogs list each fee ("Manager fee (to <organization>)", "Platform fee", "Network fee (paid to Bytesac for gas)") with "waived" labels and "Fees are not refunded if the operation does not complete"; the old "No platform or manager fees are charged yet" line is removed. Wizard: cap input. Ops: `/ops/fees` (default schedule table with history, overrides list with create/end), `/ops/revenue`. Organization: `/organization/earnings` (Owner/Admin). Public `/fees` page; basket page fee section shows manager terms, platform rate and the not-collected labels.

## 12. Security & safety

Transfers only to recorded recipients with recorded amounts; fee-payer validation refuses anything else. Payout addresses come only from `VERIFIED` payout wallets read at plan time. Fee terms are snapshotted in `operation_fees`; later schedule or version changes never touch an open plan. Ops fee edits need `ops_admin`, a reason, and are audited; earnings need `earnings.read`; revenue needs an ops role. Reports read settled rows only. Tests mock RPC, LI.FI and wallets; nothing is broadcast.

## 13. Testing

Validator: manager fee (percent, cap, fixed, rounding down), platform fee (min/max clamp), dust, deployable after fees, override resolution and expiry, schema cap bounds. API: invest plan with manager and platform fees (one fees leg, three transfers, correct recipients), tampered fee transaction → `TX_MISMATCH`, fees in all D-079 branches (first, between from cash, refused), drift fix / repair / sell carry no manager fee but the configured platform fee, waived payout wallet (no transfer, row recorded, email once), schedule edit after plan creation leaves the plan unchanged, settledAt only after settlement, earnings permission (Owner/Admin yes; Manager/Analyst/Viewer 403) and CSV, ops revenue and CSV, revenue reconciliation mismatch logged, a plan with only a network fee (no manager or platform fee) is unchanged from Spec 9. Web: fee lines in previews, waived label, cap input, ops fees admin, earnings page, public fees page.

## 14. Execution shape

Five tasks: (1) data, validator, fee math and schema cap; (2) the combined fee leg (build, validation, settlement) and fee integration into invest, rebalance, repair and sell plans with waivers; (3) ops schedules and overrides, public fees, earnings and revenue APIs, reconciliation job, waiver email; (4) web; (5) web tests and docs (ADR-016, ADR-013 open question 3 closed, ADR-011/D-058 cap, D-079 rewritten, D-085 onward, FUTURE-PLANS, READMEs).

## 15. Open items

Fee caps and disclosure wording (compliance; D-058); platform fee rates (business decision; default 0); revenue treasury address and funding of its token account; legal review of manager fees paid directly by users to organizations and of the platform fee; tax/reporting obligations; Spec 8/9 pre-launch checks still apply.
