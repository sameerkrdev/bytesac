# Spec 12 — Launch Hardening (Design)

- **Date:** 2026-10-03
- **Status:** Approved in conversation (2026-10-03); written spec pending user review
- **Series:** Spec 12 — after Specs 1–11; roadmap 13–19 follows (CONTINUATION §6)
- **Sources:** `docs/OPEN-ITEMS.md` §6–§7, HANDOFF §5 (Spec 2–11 leftovers and review findings), ADR-014..ADR-018, D-072, D-078, D-079, D-092, D-096.

## 1. Intent

Fix the known must-fix bugs, money and ops correctness issues and small functional bugs before real users and assets. No new product features. Every fix gets a regression test. Code-quality debt goes to Spec 13, CI/deployment to Spec 16, UI gaps to Spec 15, real-key/compliance items stay user actions in OPEN-ITEMS.

**Success criteria**
1. One bad CoinMarketCap entry never hides other prices.
2. `mobile#check-types` passes on `main`.
3. Platform gas reservations always return unspent amounts on every terminal path; no top-up is reserved for a closed operation.
4. No route above 5% real price impact executes, independent of LI.FI honoring `maxPriceImpact`.
5. A user is never blocked indefinitely by an unsent recovery leg or by an asset they only hold.
6. Each listed functional bug has a reproducing test that now passes.

## 2. Decisions (this brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | Scope | Must-fix + money/ops correctness + small functional bugs (A). |
| 2 | Price-impact backstop | Server-side check with route fees removed: impact = 1 − (toUSD + included route fees USD) / fromUSD; > 5% refused; skipped under $10; previews show this figure (A). |
| 3 | Fully sold positions | Auto-close when every holding and the basket cash are exactly 0 after a sell settles, **and** a "Close position" button on dust positions (total value < $1) that behaves like Leave (A + B). |
| 4 | Stuck recovery | Auto-stop after 7 days unsent → operation `PARTIAL`, gas released, user alerted; deeper fix in FUTURE-PLANS (A + future). |
| 5 | Non-investable held asset | Rebalance/drift fix need investability only for bought assets and a working sell route for sold ones; ops alert listing affected baskets when an instrument becomes non-investable; deeper disposition flow in FUTURE-PLANS (C + future). |

## 3. Out of scope

Code-quality debt (import cycle, duplicated messages, review Minors) → Spec 13; Linux CI, worker deployment, CSP report-uri, pgvector index → Spec 16; ops pickers, "Load more", mobile screens → Spec 15; real-key checks, compliance values, wallet funding → user actions (OPEN-ITEMS); deeper fixes for Q4/Q5 → `docs/domains/FUTURE-PLANS.md` ("Execution robustness").

## 4. Must-fix

- **CoinMarketCap batch:** the quotes response is parsed per id; an id whose price is null, missing or non-numeric marks only that instrument `unavailable` (cached as unavailable for the normal TTL); the others are returned and cached normally. Response-shape failure of the whole body still marks the uncached batch unavailable (unchanged).
- **`mobile#check-types`:** pin a single `@wagmi/core` (and `viem` if needed) version for the workspace through `pnpm.overrides` in the root `package.json`, using the exact versions web already resolves; `pnpm install`, then `pnpm --filter mobile check-types`, `pnpm --filter mobile test` and `npx expo export --platform android` pass. No `minimumReleaseAgeExclude`; if the override cannot satisfy Reown RN peers, document the blocker and fall back to a scoped type fix in `apps/mobile/src/lib/appkit.tsx` with a comment.

## 5. Money and ops correctness

| Item | Fix |
|---|---|
| Price impact | Compute fee-excluded impact from the estimate/quote USD amounts and `routeFees` with `included: true`; refuse > `MAX_PRICE_IMPACT` (0.05) with 503 `ROUTE_UNAVAILABLE` "Price impact too high for this trade size."; no check when `fromAmountUSD < 10` or USD values are missing; `priceImpact` in leg views is this figure. |
| Top-up after stop/expiry | `reserveLegGas` re-reads the operation under its lock and refuses unless `PLANNED`/`IN_PROGRESS` (409 `VALIDATION_FAILED` "This operation is no longer open."). |
| Stop releases only recovery top-ups | On Stop (`IN_PROGRESS` → `PARTIAL`/`FAILED`) release the unspent reservation of every unsent leg (any kind), using the existing release path. |
| Abandoned `IN_PROGRESS` reservations | When an operation reaches any terminal status (completion refresh, stop, sweep), release its remaining unspent reservation (sent drops stay counted). |
| Refused gas drop | A drop refused definitively by the node (`failed`) returns its amount to the operation's reservation and does not count toward the 5/day drop limit. |
| Retried drop | Before re-attempting, re-read the drop's on-chain status (receipt by stored hash); a confirmed or pending drop is never re-sent. |
| Auto-close | In `settleLeg` (sell settlement) and after Sync/Accept: if the position's ledger sums are all 0 and basket cash is 0 → close it (`CLOSED`, `closed_at`, audit `position.auto_closed`), end active keep-custom, cancel nothing else. |
| Dust close | `POST /v1/positions/:id/close` allowed when the position's total market value < $1 (or no price for remaining dust and quantities below one display unit); behaves as Leave (no transaction; remaining tokens and cash become outside-basket); 409 `VALIDATION_FAILED` otherwise. |
| Recovery auto-stop | The 5-minute sweep finds operations with a recovery leg `PLANNED` and `created_at` older than 7 days → stop them as the user's Stop would (`PARTIAL`, release unsent reservations), audit `operation.auto_stopped`, notify (`execution_incomplete` with data `{ autoStopped: true }`, copy "We stopped your unfinished swap; the tokens that arrived are in your wallet."). |
| Non-investable held asset | Rebalance/drift fix: investability required only for instruments in the plan's buys; each sold deployment needs an `ACTIVE` or `PAUSED` deployment with any route LI.FI can quote (exits already ignore route status — keep that), otherwise 409 `NOT_INVESTABLE` naming the asset. Ops alert: when an instrument, deployment, route or price reference transition makes a previously investable instrument non-investable (paused/retired/permissioned/price retired), notify ops (`ops_admin` inbox notification + `logger.warn`) with the list of baskets whose current version holds it; deduped per instrument per day. |
| Sweep isolation | Each record in `trackStaleClaims`, `expireStalePlans`, the recovery auto-stop and `reconcilePositions` runs in its own try/catch (and transaction where it writes); a failure logs the record id and the loop continues. |
| Revenue bucketing | `operation_fees.settled_chain_at` set from the fee leg's on-chain block time when it settles (Solana block time of the signature); `revenue-reconcile` buckets by `coalesce(settled_chain_at, settled_at)`. |

## 6. Small functional bugs

| Item | Fix |
|---|---|
| Concurrent invite during sign-in → 500 | Run invitation linking in a savepoint; a unique conflict rolls back only the savepoint and leaves the invite for the next sign-in; sign-in succeeds. |
| Rejected invite consumes the budget | Consume the 20/h invite limit only after the invite row is created. |
| Spec 2 "Not approved" | The ops application form hides "Not approved" when the application is proven approved (the server's 409 case). |
| Spec 3 orphan R2 copy | When the DB write after an R2 copy fails, delete the copied final object (best effort, logged). |
| Publish slug collision | Retry slug generation up to 3 times on the unique violation before failing. |
| `VERSION_CONFLICT` ms compare | `basket_versions.revision int not null default 0`, incremented on every draft save; saves send `expectedRevision` instead of `expectedUpdatedAt` (accept both for one release: `expectedUpdatedAt` still works when `expectedRevision` is absent). |
| Double-click contact add → 404 | Web disables the add button while pending; the API returns the existing pending verification for the same normalized value instead of a 404. |
| Portfolio slugs | Portfolio positions return `basketName` (current version name) and the web shows it. |

## 7. Data model (migration `0016_hardening.sql`)

`operation_fees.settled_chain_at timestamptz null`; `basket_versions.revision integer not null default 0`. No DELETE grants.

## 8. API and errors

New: `POST /v1/positions/:id/close`. Changed: draft save accepts `expectedRevision`; portfolio positions gain `basketName`; ops notification kind for non-investable alerts (`instrument_not_investable`). No new error codes.

## 9. Web (no mobile UI)

"Close position" on dust positions; ops application form option fix; contact add button disabled while pending; basket names in the portfolio; wizard sends `expectedRevision`.

## 10. Testing

One regression test per row in §4–§6 (API or web as applicable), including: CMC batch with one null id; mobile check-types in the gate; impact backstop fee-excluded (allowed at 4% real + fees, refused at 6% real, skipped under $10); top-up refused after stop; Stop releases unsent non-recovery reservations; terminal release; refused drop returned and not counted; retried drop re-reads status; auto-close after 100% sell; dust close allowed/refused; recovery auto-stop after 7 days; rebalance with a held non-investable RWA allowed when not bought, refused when sold without a route; ops alert deduped; sweep continues after one bad record; revenue bucketing by chain time; the eight functional bugs. Full gate at `--concurrency=2`, plus `pnpm --filter mobile test` and mobile check-types.

## 11. Execution shape

Five tasks: (1) must-fix + price-impact backstop + gas reservation fixes + sweep isolation + recovery auto-stop; (2) auto-close + dust close + non-investable rule and ops alert + revenue bucketing + migration; (3) functional bugs (API); (4) web; (5) docs (D-107+, ADR-014/015/016/017/018 rewritten in place where behavior changes, OPEN-ITEMS ticks) and the full gate.

## 12. Open items

Whether the wagmi override satisfies Reown RN peers (fallback documented); dust threshold tuning ($1); 7-day recovery auto-stop tuning.
