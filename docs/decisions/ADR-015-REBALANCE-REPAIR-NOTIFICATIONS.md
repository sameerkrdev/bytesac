# ADR-015: Rebalance, Skip, Drift, Repair and Notifications (Release 1)

- **Status:** APPROVED (design approved in conversation 2026-10-02; implemented in Spec 9)
- **Date:** 2026-10-02
- **Owners:** Product + platform engineering
- **Related:** D-023, D-028, D-071, D-073, D-075, D-076 to D-084; ADR-011, ADR-013, ADR-014; spec `docs/superpowers/specs/2026-10-02-rebalance-drift-repair-design.md`; `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`

## Context

ADR-013 decided self-custody and user-signed plans; ADR-014 built invest and exit. Spec 9 lets a holder apply or skip a newer basket version, fix weight drift, resolve a wallet shortfall (`SHORT`), and learn about every such event, without ever moving an asset the user did not sign for.

## Decision

### 1. Routing: hub through USDC on Solana (D-076)

A rebalance sells every asset it reduces to USDC on Solana, then buys every asset it increases from USDC on Solana. Buys are sized from what the sells actually delivered (chain evidence, D-075), never from the quote. At the first buy's quote, under the operation lock, `available` is the basket's cash; the ratio `available / planned buy total` is stored once as a rational (`operations.buy_scale`), each buy is `floor(planned x num / den)` with the last buy taking the remainder so nothing is stranded by rounding, and each minimum received scales the same way before the price-move guard (D-073) compares it. A buy never spends free USDC outside the basket's cash. A buy left with no cash fails as `NO_FUNDS` without being sent (a `PLANNED` leg may go to `FAILED`).

### 2. Trade thresholds (D-077)

A trade is skipped when the instrument's weight gap is under 50 bps or its value gap is under 5 USDC. A published version may override both (`minTradeBps` 10 to 1000, `minTradeUsdc` 1 to 100); the wizard shows them as optional fields and the public and ops views show them when set. A removed asset (target weight 0) is sold in full. When nothing needs trading the answer is `{ aligned: true }`: the version is recorded on the position and no operation exists.

### 3. Basket cash (D-078)

Sale proceeds that have not yet been spent live in an append-only `position_cash_entries` ledger (micro-USDC, signed). A rebalance sell credits what arrived, a buy debits what it spent, a network fee paid from cash debits it. Basket cash is spent before free USDC and is reconciled against the wallet's USDC on Solana like a deployment; a cash shortfall is split pro-rata and can only be resolved by Sync. Sell to USDC and Sell former release their percentage of basket cash (the USDC is already in the wallet) when the operation's first sell leg settles, once; a cancelled or failed sale releases nothing.

### 4. Network fee placement (D-079, extends D-071)

The fee leg is first when free USDC on Solana (wallet USDC minus every basket's cash) covers it. Otherwise, for plans whose sells are all on Solana, it sits between the sells and the buys and is paid from basket cash (its leg carries `fromCash` in both placements, because settlement debits cash by that flag). A plan that sells an EVM or Bitcoin asset without the fee up front is refused with 409 `INSUFFICIENT_BALANCE`. A buy-only plan with too little free USDC pays the fee from basket cash first. Repairs always pay the fee first from free USDC. Platform and manager fees stay out of scope (Spec 10).

### 5. Repair and sync (D-080)

- **Legs in flight are not reconciled.** The ledger is written at settlement but the wallet changes when the transaction lands, so while a user has a leg in `SUBMITTING`, `SUBMITTED`, `PENDING_CHAIN` or `UNKNOWN`, reconciliation skips every deployment on that leg (from or to), the user's basket cash (every leg touches USDC on Solana) and drift. Nothing is written for them: no new `SHORT`, no repair notice, and the rows simply age. Sync and Buy back on such an asset are refused with 409 `OPERATION_IN_PROGRESS`; reconciliation resumes when the leg is final.
- **Planning is blocked by a shortfall.** A `SHORT` on any deployment or on the cash of a position refuses rebalance and keep-custom with 409 `REPAIR_REQUIRED`; stale balances or prices refuse with 409 `DATA_STALE`.
- **Buy back** is one `repair` operation per short deployment covering every affected basket, never one per basket (it needs an active route for the deployment, not basket investability; its stored version is the oldest affected position's applied version): fee first, then one buy of the total shortfall funded with free USDC on Solana (cost = shortfall x price x (1 + slippage), rounded up). On settlement the received amount (chain evidence) is split by each basket's shortfall, the remainder to the largest, each share capped at its shortfall; excess stays outside baskets and any deficit stays `SHORT`. Cash is never bought back.
- **Sync** records the new reality without a transaction: the user splits the shortfall across the affected baskets (prefilled pro-rata, each at most that basket's recorded quantity, summing exactly). The server reconciles first and compares the submitted split with the fresh figures: a different total or a different set of baskets is 409 `SHORTFALL_CHANGED` with the fresh total and positions (the form always submits exactly what it showed), while a basket listed twice or a quantity above what a basket records is 400 `VALIDATION_FAILED`. Sync is idempotent per key; a different body under the same key is refused.

### 6. States, drift and keep custom (D-081)

Four separate dimensions are derived on every portfolio read: version (`CURRENT`, `OUT_OF_DATE`, `SKIPPED`), backing (`VERIFIED`, `REPAIR_REQUIRED`, `DATA_STALE`), allocation (`ALIGNED`, `WEIGHT_DRIFT`, `CUSTOMIZED`) and execution (`NONE`, `PENDING`, `INCOMPLETE`). One headline is picked by priority: execution pending, repair required, execution incomplete, rebalance available, drifted, customized, aligned; a skipped version does not raise "rebalance available". Drift is `|actual - target| >= driftThresholdBps` (default 500) per weight, computed with fresh prices on each reconciliation (the nightly job and portfolio reads). **Keep custom** snapshots the current weights and silences prompts until a weight moves a threshold away from the snapshot (then it becomes drifted again) or the user reverts or rebalances. A drift notice repeats at most once per 7 days while the position stays drifted.

### 7. Skip, apply, continue and invalidation (D-082)

Skipping records one decision per position and version and changes nothing in the wallet. Apply always plans from current reconciled holdings to the selected target; skipped versions are never replayed. The applied version changes only when the operation completes. A `PARTIAL` or `FAILED` rebalance shows "Execution incomplete" with Continue: a new plan to the same target and a new network fee. Publishing a newer version cancels `PLANNED` rebalances of that basket that target an older version and that nothing was sent for (gas released), keeps those already targeting the new version, and runs on `IN_PROGRESS` ones.

### 8. Notifications and web push (D-083)

Every event is an inbox row first (`notifications`, unique per user and dedupe key), then email (Resend) and web push alongside, gated by the existing preferences (`rebalance`, `portfolioUpdates`, `managerUpdates`). Delivery happens on the `notifications` BullMQ queue (`deliver`, `version-published`, `basket-notice`) after commit, never fails the business transaction, and never states that a trade happened. Investors also get notices for basket paused or resumed, retirement pending or retired, and a changed lead manager. A rebalance or repair that ends `PARTIAL` or `FAILED` notifies "plan incomplete" once per operation; the repair notice has no basket and links to `/portfolio/repair/<asset>`.

Web push uses Firebase Cloud Messaging: `firebase-admin` on the API (`FIREBASE_SERVICE_ACCOUNT`, optional) and the Firebase JS SDK on web (`getToken` with the VAPID key and the `firebase-messaging-sw.js` service worker, `NEXT_PUBLIC_FIREBASE_*`). Both use FCM registration tokens (`sendEachForMulticast` with `tokens`). Firebase marks these token APIs deprecated in favour of Installation IDs (`register` and `onRegistered` on web, `fids` in the admin SDK); they still work, and moving to FIDs is a contained change in `lib/firebase.ts`, `push-toggle.tsx` and the API's `providers/fcm.ts`. Tokens FCM reports as unregistered or invalid are revoked; tokens are never logged. Registering a token already stored for another user moves it to the registering user, so a shared browser stops notifying the previous user. Web sign-out also revokes this browser's token (server revoke, then Firebase `deleteToken`) when push was turned on here, ignoring failures so logout is never blocked. The service worker needs no handlers: messages carry a `notification` payload and a link, which the browser shows and opens.

### 9. Adoption counts for managers (D-084)

For each published version the manager sees, over **open** positions holding that version or older: how many applied, skipped, are in progress (an open rebalance to it) and have not responded. Each cell shows 1 to 4 as the string `"<5"`; there are no identities, wallets or amounts. Access needs basket `read`.

## Alternatives considered

- **Direct sell-to-buy pairing** (one hop per sell/buy pair instead of via USDC): fewer hops and fees on large rebalances, but pairing, partial fills and per-pair failure handling are much harder to make safe and to show. Deferred (`FUTURE-PLANS.md`); the hub keeps every leg independent and verifiable.
- **Per-basket repair** (one plan per affected basket): simpler to explain, but two plans for one shared asset can buy the shortfall twice and pay the network fee twice. Rejected for one plan per short deployment; one plan across all short assets (one fee) is a future plan.
- **Alchemy address-activity webhooks** for instant drift and shortfall detection: more immediate, but they need a public endpoint, signature checks and replay handling; polling (nightly and on portfolio read) is enough for release 1. Deferred.
- **Auto-fixing a shortfall or drift**: rejected; nothing moves without a signature (ADR-013).
- **Mobile push** and mobile rebalance screens: deferred with the mobile investing screens.

## Consequences

### Positive
- A holder always sees why a basket needs attention and which single action resolves it.
- No double-buys of a shared asset; buys never exceed what the sells delivered.
- Notifications are deduplicated, preference-gated and never block a transaction.

### Negative / trade-offs
- The hub costs two hops for a pair that could be matched directly; a rebalance of many small changes can pay more route fees.
- A repair or rebalance still needs signatures per leg and, for several short assets, several repair plans and several network fees.
- Adoption cells are masked independently, so a total shown exactly plus all but one masked cell can be differenced; counts may be redefined or masked together if that matters.
- Reconciliation now does valuation for drift, one price fetch and several queries per open position; batch it if the nightly job gets slow.

### Security, financial and operational impact
- The planner reads reconciled, allocated quantities and fresh prices only; stale data refuses the plan.
- Concurrency: one active operation per user, per-user locks for plan creation and sync, the buy scale fixed once under the operation lock.
- Firebase credentials are env secrets; push tokens are untrusted input validated at the route.

## Migration / rollout

Migration `0012_rebalance.sql` adds the operation kinds `rebalance` and `repair`, cash entries, position decisions, notifications and push tokens, nullable cash rows in reconciliations, allocation status on positions and the buy-scale and repair columns on operations. The runtime role has no DELETE (D-038); cash entries and decisions are insert-only. Before launch: create the Firebase project, web app, VAPID key and service account, and re-check the new legs with real quotes (Spec 8 checklist).

## Validation

- Planner tests (thresholds, removed assets, aligned, stale, short), buy scaling, fee placement, settlement effects, continue after partial, skip then apply, invalidation, repair across two baskets, sync exact sum and `SHORTFALL_CHANGED`, cash shortfall, drift and dedupe, keep custom, notification gating and dedupe, invalid token revocation, adoption masking, authorization negatives.
- Web: review, repair and sync, bell and inbox, push toggle (Firebase mocked), adoption, wizard threshold bounds.

## Open questions

1. Notification copy and sender domain (compliance review, Resend domain).
2. Threshold defaults (50 bps, 5 USDC, 500 bps drift) after real use.
3. ~~Rebalance fee collection~~ — decided in ADR-016 (the manager rebalance fee applies only when applying a newer version; the fee leg carries every fee).
4. Whether adoption cells need joint masking.
5. Moving push to Installation IDs when the token APIs are removed.
