# Spec 9 — Rebalance, Skip/Catch-up, Drift, Repair and Notifications (Design)

- **Date:** 2026-10-02
- **Status:** Approved in conversation (2026-10-02); written spec pending user review
- **Series:** Spec 9 — after Specs 1–8, ADR-013 and ADR-014
- **Builds on:** Spec 6 (versions, `rebalance` disclosures, status transitions, basket emails), Spec 7 (BullMQ worker, prices), Spec 8 (operations, legs, signing, tracking, positions ledger, reconciliation, portfolio), Spec 1 (notification preferences, Resend).
- **Sources:** `docs/source/First-Investment,-Rebalancing,-Drift-&-Fix.txt` §11–§29 and §36–§39; `docs/source/User-Detailed-Features.txt` §20–§33 and §44; ADR-013; ADR-014; D-023, D-028, D-067..D-075.

## 1. Intent

A user holding a basket position can **apply** a newer manager version (one plan from current reconciled holdings straight to the latest target, never replaying skipped versions) or **skip** it; can **rebalance back to their current version** when prices made the weights drift, or **keep a custom allocation**; and must resolve a **`SHORT`** (wallet holds less than the baskets record) by **buying back** the missing quantity or **syncing** the ledgers to what remains. Users learn about every such event in an in-app inbox, by email and by browser push. Managers see aggregate adoption counts. Nothing ever moves without the user's signature.

**Success criteria**
1. Every rebalance and repair is a plan of legs the user signs (ADR-013); publishing a version never trades.
2. A rebalance plans from current reconciled holdings (plus basket cash) to the selected target; skipped versions are never replayed.
3. The applied version changes only when a rebalance completes; partial outcomes are visible and continuable.
4. A shared-asset shortfall produces one repair plan per asset (never one per basket) and never double-buys.
5. Drift, shortfall, version and execution states are shown separately, with a headline state.
6. Notifications never imply a trade happened, are deduplicated, and never fail the business transaction.

## 2. Decisions (this brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | Scope | One spec: rebalance, skip/catch-up, drift fix, keep custom, `SHORT` repair (buy back, sync), portfolio states, notifications (inbox, email, web push), investor basket notices, manager adoption counts. Drift detected by polling (existing reconcile + nightly job); Alchemy webhooks deferred. |
| 2 | Routing | **Hub through USDC on Solana:** sells go to USDC on Solana, then buys run from USDC on Solana sized from what actually arrived (chain evidence). Direct sell→buy pairing is a future plan. This replaces ADR-013's "Solana hub rejected" alternative. |
| 3 | Thresholds | Platform defaults: skip a trade when the instrument's weight gap is under **50 bps** or its value gap is under **$5**; a version may override (`minTradeBps` 10–1000, `minTradeUsdc` 1–100). A removed asset is always sold in full. No trade left → "Already aligned", Apply records the version with no transaction. |
| 4 | Fix / `SHORT` | smallcase-style: a `SHORT` **blocks** rebalance and drift fix for the affected baskets only. **Buy back** = one repair plan per short deployment covering every affected basket, funded with free USDC on Solana; arrivals split by each basket's shortfall. **Sync** = no transaction; the user splits the shortfall across baskets (prefilled pro-rata, must sum exactly). Weight drift: **Rebalance to current version** or **Keep custom**. D-023 becomes "pro-rata by default, user-editable split". One combined repair plan across all short assets is a future plan. |
| 5 | Partial / mid-plan version | Applied version changes only on `COMPLETED`. `PARTIAL`/`FAILED` → "Execution incomplete" with Continue (new plan to the same target, new network fee). A newer publish cancels `PLANNED` rebalances of that basket; `IN_PROGRESS` ones run on. |
| 6 | Drift | Computed on reconcile (nightly + portfolio read). `WEIGHT_DRIFT` when any \|actual − target\| ≥ the version's `driftThresholdBps`, else **500 bps**. Email/push on entering `WEIGHT_DRIFT` at most once per basket per 7 days; inbox and badges always. Keep custom snapshots weights and suppresses prompts until any weight moves a threshold away from the snapshot, or the user reverts or rebalances. |
| 7 | Basket cash | New append-only `position_cash_entries` (micro-USDC): rebalance sells credit what arrived, buys debit what they spent; basket cash is spent before free USDC; reconciled against wallet USDC on Solana like a deployment (pro-rata `SHORT`, Sync only). |
| 8 | Network fee | Extends D-071: fee leg **first** when free USDC on Solana (outside basket cash) covers it; else, for Solana-only sells, **between sells and buys** paid from basket cash; a plan selling an EVM or Bitcoin asset without the fee up front is 409 `INSUFFICIENT_BALANCE`. Repairs always pay the fee first. No platform or manager fees (Spec 10). |
| 9 | Notifications | In-app inbox (table, unread count, header bell, mark read) for every event; email (Resend) and web push alongside, gated by existing preferences. Investor notices for basket paused/unpaused, retirement pending/retired, lead manager changed. |
| 10 | Push | Firebase Cloud Messaging for **web** push (`firebase-admin` on the API, Firebase JS SDK + service worker on web). Mobile push deferred with mobile investing screens. |
| 11 | Manager view | Aggregate counts per published version (open positions, applied, skipped, not responded, in progress); counts under 5 shown as "<5"; no identities, wallets or amounts. |

## 3. Out of scope (recorded in `docs/domains/FUTURE-PLANS.md`)

Direct sell→buy pairing (one hop per pair); one combined repair plan across all short assets (one network fee); Alchemy address-activity webhooks; mobile push and mobile rebalance screens; platform/manager/rebalance fees (Spec 10); RWAs and async settlement (Spec 11); allocating outside-basket assets into a basket; auto-closing fully sold positions (Spec 8 leftover).

## 4. Operations and planner

### 4.1 Kinds

`operation_kind` gains `rebalance` and `repair`.

| Kind | Target | Legs |
|---|---|---|
| `rebalance` | `versionId` = the basket's current published version (**apply**, `target: "latest"`) or, for a **drift fix** (`target: "applied"`), the applied version, allowed only when it is still the current version (else 409 `VERSION_NOT_CURRENT`: apply the latest instead) | sells (asset → USDC on Solana) → optional fee → buys (USDC on Solana → asset) |
| `repair` | one deployment; `repair_shares` = positionId → shortfall (raw units) | fee → one buy of the total shortfall |

Both reuse Spec 8 leg kinds (`network_fee`, `swap`, `cross_chain`), quoting, signing, claim-before-send, tracking, gas reservation, the one-active-operation-per-user index and idempotency keys. Rebalance requires the target version to be investable (D-069: `ACTIVE` basket, buy routes and connections); skip, sync, keep custom, leave and sell always work.

### 4.2 Rebalance planning (server, at plan time)

1. Reconcile the user (as Spec 8). Refuse with 409 `DATA_STALE` when a balance or a needed market price is unavailable or stale; refuse with 409 `REPAIR_REQUIRED` when any deployment of the position or its cash is `SHORT`.
2. Holdings `q_d` = the latest reconciliation `allocatedQuantity` per deployment (equals the ledger when not short); cash `C` = sum of `position_cash_entries`.
3. Value `V = Σ q_d × price_d + C` (decimal, display precision; quantities stay BigInt).
4. Per instrument of the union (held ∪ target): `target_i = V × w_i`, `gap_i = target_i − current_i`. Trade only when `|w_actual − w_target| ≥ minTradeBps` **and** `|gap_i| ≥ minTradeUsdc`; an instrument with target weight 0 (removed) is sold in full regardless.
5. Sells: quantity = `min(gap value / price, q_d, wallet balance)` in raw units (removed: `min(q_d, balance)`, Bitcoin keeps the miner-fee ceiling as Spec 8). Buys: planned USDC = `gap_i`, scaled down pro-rata if the planned buy total exceeds `estimated sell proceeds + C − fee-from-cash`.
6. No legs → 200 with `{ aligned: true }`; Apply records the version on the position (audit `position.version_applied`) and no operation is created.
7. Network fee per §4.4; gas reserved per Spec 8.

### 4.3 Buy sizing at execution (subtle — full code in the plan)

Buys run only after every sell leg is final (sequential legs). At the **first buy's quote**, under the operation lock: `available = basket cash now` (includes credits from settled sells and any pre-existing cash), `r = available / plannedBuyTotal` (rational: numerator and denominator stored in `operations.buy_scale` as `{ num, den }`, fixed once). Each buy's amount = `floor(planned × num / den)`; the **last** buy takes `available − Σ earlier scaled buys − already spent` so no cash is stranded by rounding; each minimum received is scaled the same way and the D-073 price guard compares the fresh quote against the scaled minimum. `r` may exceed 1 (better fills) and is capped so no buy exceeds `available`. A buy never spends free USDC outside basket cash.

### 4.4 Network fee placement

- Free USDC on Solana (`wallet USDC − Σ all baskets' cash`, never negative) ≥ fee → fee leg **first**.
- Otherwise, if every sell is on Solana → fee leg **after the sells, before the buys**, paid from basket cash (cash entry `network_fee`, negative); buys get the remainder.
- Otherwise 409 `INSUFFICIENT_BALANCE` with the D-071 message ("Add at least $X USDC on Solana to pay the network fee before selling assets on <chain>").
- A plan with only buys (cash-funded) and insufficient free USDC pays the fee from basket cash first.
- Repair: fee first, always from free USDC; balance check `free USDC ≥ fee + buy amount`.

### 4.5 Repair (buy back)

`POST /v1/operations/repair { deploymentId, slippageBps, idempotencyKey }`: reconcile; collect every open position of the user whose latest reconciliation for the deployment is `SHORT`; `shortfall_p = ledger − allocated`; total `S`. The buy spends `ceil(S × price × (1 + slippageBps/10 000))` micro-USDC (market price, one step of rounding up) from USDC on Solana to the deployment; the preview shows the estimated output and minimum. Needs an `ACTIVE` route and a fresh price. On `SETTLED`, the received amount (chain evidence) is split over positions by `shortfall_p / S` with the remainder to the largest share (oldest on tie), each capped at `shortfall_p`, written as `repair` ledger entries; any excess stays outside baskets (surplus) and any deficit stays `SHORT` (repair again or sync). A repair never covers cash `SHORT` (Sync only).

### 4.6 Settlement effects

- Rebalance sell `SETTLED`: ledger `rebalance` −`amountIn` on the source deployment; cash `rebalance_sell` + received USDC (chain evidence, D-075).
- Rebalance buy `SETTLED`: cash `rebalance_buy` −`amountIn`; ledger `rebalance` + received.
- Fee leg paid from cash: cash `network_fee` −fee when it settles.
- Operation `COMPLETED` → position `appliedVersionId = operation.versionId`, `allocation_status` recomputed, audit `position.version_applied`; any active `keep_custom` ends (decision `revert_custom`, reason `rebalanced`).
- Sell to USDC (Spec 8) also releases `percent` of basket cash (cash entry `sell`, negative) — the USDC is already in the wallet; no leg.
- Leave keeps cash in the former-position record (closed position; cash becomes outside-basket).

### 4.7 Invalidation

Publishing a new version enqueues `rebalance-available` (worker): cancels `PLANNED` `rebalance` operations of that basket (status `CANCELLED`, gas reservation released, audit), then fans out notifications to holders of open positions. `IN_PROGRESS` operations continue to their own target.

## 5. Decisions, sync and custom

`position_decisions` (append-only): `id, position_id, kind (skip | keep_custom | revert_custom | sync), version_id?, data jsonb, actor_user_id, created_at`.

- **Skip** `POST /v1/positions/:id/skip { versionId }`: `versionId` must be the basket's current published version and differ from the applied one; idempotent per (position, version) (unique partial index on kind = skip).
- **Keep custom** `POST /v1/positions/:id/custom`: stores `{ weights: { instrumentId: bps } }` (current actual weights); refused when `REPAIR_REQUIRED`. **Revert** `POST /v1/positions/:id/custom/revert`.
- **Sync** `POST /v1/portfolio/sync { deploymentId | asset: "cash", split: [{ positionId, quantity }], idempotencyKey }`: reconcile first; the split must cover exactly the affected positions, each `0 ≤ quantity ≤ that position's ledger quantity`, summing exactly to the current total shortfall (else 409 `SHORTFALL_CHANGED` with the fresh figures). Writes one decision per position and `sync` ledger (or cash) entries, negative, in one transaction under a per-user advisory lock; audit `position.synced`.

## 6. Data model (`@repo/db`, migration `0012_rebalance.sql`)

- Enums: `operation_kind` + `rebalance`, `repair`; `ledger_reason` + `rebalance`, `repair`, `sync`; new `cash_reason` (`rebalance_sell`, `rebalance_buy`, `network_fee`, `sell`, `sync`); new `decision_kind`; new `allocation_status` (`ALIGNED`, `WEIGHT_DRIFT`, `CUSTOMIZED`); new `notification_kind` (`rebalance_available`, `drifted`, `repair_required`, `execution_incomplete`, `basket_paused`, `basket_unpaused`, `basket_retirement_pending`, `basket_retired`, `lead_changed`).
- `operations`: `basket_id` nullable with check `(kind = 'repair') = (basket_id is null)`; `repair_shares jsonb`, `deployment_id` (repair), `buy_scale jsonb`.
- `position_ledger_entries.leg_id` nullable (sync entries have `decision_id` instead); check exactly one of the two; unique `(leg_id, deployment_id)` and `(decision_id, deployment_id)`; a repair leg writes one entry per position → unique becomes `(leg_id, position_id, deployment_id)`.
- `position_cash_entries`: `id, position_id, amount_micro numeric (signed), reason, leg_id?, decision_id?, created_at`; unique `(leg_id, reason)`.
- `position_reconciliations.deployment_id` nullable for cash rows (check: cash rows have null deployment).
- `basket_positions`: `allocation_status` default `ALIGNED`, `allocation_checked_at`.
- `position_decisions` as §5.
- `notifications`: `id, user_id, kind, basket_id?, position_id?, data jsonb, dedupe_key, read_at, created_at`; unique `(user_id, dedupe_key)`; index `(user_id, created_at desc)`.
- `push_tokens`: `id, user_id, token unique, user_agent, created_at, revoked_at`.
- `basket_versions.rebalance` jsonb: optional `minTradeBps`, `minTradeUsdc` (validator `basketRebalanceSchema`).
- Runtime role: no DELETE (D-038); everything above is insert/update only.

## 7. States (derived on portfolio read)

| Dimension | Values | Rule |
|---|---|---|
| Version | `CURRENT`, `OUT_OF_DATE`, `SKIPPED` | basket current version = applied → CURRENT; skip decision for the current version → SKIPPED; else OUT_OF_DATE |
| Backing | `VERIFIED`, `REPAIR_REQUIRED`, `DATA_STALE` | any latest reconciliation `SHORT` (deployment or cash) → REPAIR_REQUIRED; latest reconciliation older than 26 h or a missing price → DATA_STALE |
| Allocation | `ALIGNED`, `WEIGHT_DRIFT`, `CUSTOMIZED` | stored `allocation_status` (set by reconcile, §8) |
| Execution | `NONE`, `PENDING`, `INCOMPLETE` | open operation on the position → PENDING; latest rebalance on the position `PARTIAL`/`FAILED` and no later completed one → INCOMPLETE |

Headline (priority): `EXECUTION_PENDING` > `REPAIR_REQUIRED` > `EXECUTION_INCOMPLETE` > `REBALANCE_AVAILABLE` (OUT_OF_DATE) > `DRIFTED` > `CUSTOMIZED` > `ALIGNED`. `SKIPPED` shows as "Update skipped" with Apply still available.

## 8. Reconciliation and drift

- `reconcilePositions` additionally: per user, `wallet USDC on Solana` vs `Σ basket cash` → cash rows (`SHORT` pro-rata by cash, remainder rule as deployments; surplus is free USDC).
- After reconciling, compute weights per open position with fresh market prices (skip if any price missing): target = applied version weights (or the keep-custom snapshot when CUSTOMIZED). `WEIGHT_DRIFT` when any |actual − target| ≥ threshold (`driftThresholdBps` ?? 500). CUSTOMIZED stays CUSTOMIZED until a weight moves ≥ threshold from the snapshot (→ WEIGHT_DRIFT, decision `revert_custom` reason `moved`) or the user reverts.
- Transitions emit notifications: into `WEIGHT_DRIFT` → `drifted` (dedupe `drifted:<position>:<ISO week>` and at most once per 7 days); a new `SHORT` (previous row not SHORT) → `repair_required` (dedupe `short:<position>:<deployment|cash>:<reconciliation id>`).
- Nightly `reconcile-positions` job already exists; it now also writes allocation status and notifications.

## 9. Notifications

- `notify(userId, kind, refs, data, dedupeKey)` inserts into `notifications` (`on conflict do nothing`), then, outside the business transaction, sends email (Resend) and web push (FCM) according to preferences: `rebalance` → `rebalance_available`; `portfolioUpdates` → `drifted`, `repair_required`, `execution_incomplete`; `managerUpdates` → basket notices and `lead_changed`. Send failures are logged, never thrown. Push goes to every non-revoked token; FCM "unregistered/invalid token" responses revoke the token.
- Triggers: version publish (worker fan-out, also invalidation §4.7); reconcile transitions (§8); operation ending `PARTIAL`/`FAILED` for a rebalance or repair; Spec 6 basket transitions (pause/unpause, retirement pending, retired) and lead assignment approval → fan-out to holders of open positions via the worker.
- Copy (placeholder, compliance later): "A new basket version is available — applying creates a plan you review and sign; skipping changes nothing." "Your basket has drifted from its target." "Wallet activity changed this basket's holdings — review to buy back or update your baskets." Never states that a trade happened.
- FCM: `firebase-admin` (pinned exact) initialised from `FIREBASE_SERVICE_ACCOUNT` (JSON, env secret, optional: no value → push disabled with a startup warning). Web: Firebase JS SDK (pinned) `getMessaging`/`getToken` with the VAPID key and `firebase-messaging-sw.js`; env `NEXT_PUBLIC_FIREBASE_*`. Implementation follows the current Firebase docs.

## 10. API (session; operations need the Spec 8 eligibility)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/portfolio` | + per position: `states`, `headline`, `cash`, `latestVersion { id, number, rationale, diff }`, `appliedVersion`, `driftThresholdBps`; + `repairs[]` (deployment, total shortfall, affected positions) |
| POST | `/v1/operations/rebalance` | `{ positionId, target: "latest" \| "applied", slippageBps, idempotencyKey }` → operation view or `{ aligned: true }` |
| POST | `/v1/operations/repair` | `{ deploymentId, slippageBps, idempotencyKey }` |
| POST | `/v1/positions/:id/skip` | `{ versionId }` |
| POST | `/v1/positions/:id/custom` · `/custom/revert` | keep / revert custom |
| POST | `/v1/portfolio/sync` | §5 |
| GET | `/v1/me/notifications` | keyset paginated, `unreadCount` |
| POST | `/v1/me/notifications/read` | `{ ids } \| { all: true }` |
| POST | `/v1/me/push-tokens` · `/v1/me/push-tokens/revoke` | `{ token, userAgent? }` |
| GET | `/v1/baskets/:id/adoption` | member with basket `read`; per published version counts, `<5` masked as the string `"<5"` |

Existing `GET /v1/operations/:id`, leg quote/submit, cancel, ops leg resolve are unchanged except buy scaling. New error codes: `DATA_STALE`, `REPAIR_REQUIRED`, `SHORTFALL_CHANGED`, `VERSION_NOT_CURRENT`, `ALREADY_ALIGNED` (not an error: 200 body).

## 11. Web (no mobile)

- Portfolio: headline badge per basket and actions (Review update, Rebalance, Keep custom/Revert, Repair, Continue).
- `/portfolio/[positionId]/rebalance?target=latest|applied`: version diff with the manager's rationale, current vs target weights, plan preview (sells, network fee and where it is paid from, buys estimated and minimum, "No platform or manager fees are charged yet", buys are sized from actual proceeds), Apply → the Spec 8 leg signer; Skip (latest only).
- `/portfolio/repair/[deploymentId]` (or `cash`): affected baskets and shares; Buy back (cost preview → signer) or Sync form (prefilled pro-rata, live sum check).
- Header bell with unread count (fetch on load and focus) and `/notifications` (list, mark read, links).
- Preferences: "Browser notifications" toggle (permission prompt → token registration; off → revoke).
- Manager basket page: adoption table. Basket wizard: optional `minTradeBps` / `minTradeUsdc` fields; ops review and public page show them.

## 12. Security & safety

Wallet auth and manager publication never authorize a trade; every leg is user-signed (ADR-013). Position, repair, sync and decision routes check ownership server-side; adoption checks membership permission and never returns identities. Plans refuse stale data; buys never spend free USDC; sells never exceed `min(allocated, balance)`; a `SHORT` blocks rebalance. Concurrency: one active operation per user (existing index); sync and plan creation run under a per-user advisory lock; buy scale fixed once under the operation lock. Notification content holds no wallet addresses or amounts beyond the user's own; FCM tokens are never logged. Firebase credentials are env secrets.

## 13. Testing (all providers mocked: LI.FI, RPC, Alchemy, FCM, Resend)

Validator: threshold bounds; sync split schema. API: planner (threshold skip, removed asset sold in full, aligned → no operation, stale → `DATA_STALE`, `SHORT` → `REPAIR_REQUIRED`); buy scaling up/down and last-buy remainder; fee placement (first / between / refused for EVM); settlement effects on ledger and cash; applied version only on `COMPLETED`; continue after `PARTIAL` plans from actual state; skip then apply latest (no replay, holdings after a manual change); invalidation on publish (PLANNED cancelled, IN_PROGRESS kept); repair across two baskets (one plan, split with remainder); sync exact sum and `SHORTFALL_CHANGED`; cash reconciliation `SHORT`; drift transition and 7-day dedupe; keep custom suppression and auto-revert; notification preference gating, dedupe, send failure tolerated, invalid FCM token revoked; adoption counts and `<5`; authorization negatives (other user's position, non-member adoption). Web: rebalance review, repair/sync form, bell and inbox, push toggle (mocked Firebase).

## 14. Execution shape

Five tasks: (1) data model, validator, planner math (pure functions with tests); (2) rebalance, repair, sync, skip and custom operations reusing Spec 8 legs, settlement effects and buy scaling; (3) states, cash reconciliation, drift, notifications (inbox, email, FCM), invalidation fan-out, investor notices, adoption API; (4) web; (5) web tests and docs (ADR-015, ADR-013 amended, D-023 rewritten, D-076+, domain doc, ARCHITECTURE, FUTURE-PLANS, `apps/api/README.md`).

## 15. Open items

Firebase project, VAPID key and service account (user action, pre-launch); notification copy and sender domain (compliance/Resend); threshold defaults tuning; rebalance fee collection (Spec 10); repair cost when the quote's rounding leaves a residual shortfall below the threshold (left as dust, shown `SHORT` until synced); Spec 8 pre-launch checks still apply to every new leg.
