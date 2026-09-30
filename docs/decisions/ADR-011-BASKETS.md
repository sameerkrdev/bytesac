# ADR-011: Baskets (versions, review, publication, assignments, disclosures)

- **Status:** APPROVED
- **Date:** 2026-10-01
- **Owners:** Backend / Platform
- **Related:** D-007, D-008, D-028, D-057, D-058, D-059, D-060, D-061; ADR-005, ADR-008, ADR-009, ADR-010; `docs/superpowers/specs/2026-10-01-baskets-design.md`

## Context
Verified organizations need to express investment strategies as reviewed, versioned model portfolios that the public can read, and later versions must stay traceable. Nothing in this release invests, executes, charges or moves assets: fees and minimums are disclosed terms and the public "Invest" button is disabled.

## Decision
| Topic | Decision |
|---|---|
| Basket and version split | A **basket** is the durable identity (slug, status, current version); a **version** is the content. Basket status (`DRAFT`, `ACTIVE`, `PAUSED`, `REASSIGNMENT_REQUIRED`, `RETIREMENT_PENDING`, `RETIRED`, `REJECTED`) and version status (`draft`, `in_review`, `changes_required`, `approved`, `published`, `superseded`, `rejected`) are separate state machines (`BASKET_TRANSITIONS`, `BASKET_VERSION_TRANSITIONS`). One open version per basket (partial unique index). A version is editable only as `draft` or `changes_required`; it freezes at submit. Every transition locks the basket row, writes `basket_events` and an audit row with the request id in one transaction, and an invalid move is 409 `INVALID_TRANSITION`. |
| Publish after approval | Approval leaves the version `approved`; the manager publishes it (immediate, no scheduler). Submit hashes the canonical JSON (sorted keys, assets by instrument id, pinned template ids); approval records `approved_hash`; publish refuses with 409 if the recomputed hash differs, re-pins disclosures if a template changed (event `disclosures_repinned`) and is idempotent on an already published version. Published versions are never edited. A new version is cloned from the published one and needs a rationale. |
| Access flags | Org `baskets.manage` plus per-basket assignments (`lead`, `co_manager`) carrying flags `edit`, `submit`, `publish`, `lifecycle`, `assign`. A lead always holds all five; a co-manager defaults to `edit`, `submit`. OWNER and ADMIN act on every basket; `org.read` reads all org baskets read-only. The assignment's membership must still be `ACTIVE` with `baskets.manage`. Enforced in services (`requireBasketAction`), never only in the UI. Assignment lockdown: nobody changes their own flags or ends their own lead role (ending one's own co-manager assignment, i.e. leaving, stays allowed); only OWNER, ADMIN or the current ACTIVE lead add, replace or end a lead assignment; a co-manager holding `assign` only adds, edits and ends other co-manager assignments. Retired and rejected baskets take no decisions, withdrawals or assignment changes. |
| Manager-leaves policy | When a membership stops being eligible (revoked, removal requested, rejected, role change that drops `baskets.manage`, ownership transfer that demotes) its assignments end automatically with a reason and public history is kept. A published basket left without an `ACTIVE` lead becomes `REASSIGNMENT_REQUIRED` (previous status saved). A new lead is `PENDING_APPROVAL` until an `ops_admin` approves; the current lead stays `ACTIVE` until then (one `ACTIVE` and, separately, one `PENDING_APPROVAL` lead per basket, two partial unique indexes) and the previous lead ends with reason `replaced` on approval. The web shows "Awaiting platform approval" beside the new lead. |
| Fee caps | `entry`, `management` (annual), `rebalance`: percent `0` to `100` bps or a fixed USDC amount; `subscription`: fixed USDC per month or year, or none. Every fixed amount, subscription included, is at most 1% of the minimum investment, compared as integer micro-USDC with `BigInt` (never a JS `number`). `DecimalString` is `^\d{1,12}(\.\d{1,6})?$`. Free is explicit zeros. |
| Disclosures | Platform notices live in `disclosure_templates` (seeded, version 1 placeholder copy flagged for compliance), are chosen by the basket's asset types (`always`, `has_stablecoin`, `has_rwa`), pinned to a version at submit and cannot be removed by a manager. Ops (`ops_admin`) create the next version of a key, which retires the previous active one, or retire a version. |
| Allocation rules | 1 to 20 assets, each an `ACTIVE` instrument with an `ACTIVE` deployment; whole-bps weights of at least 100 that add up to exactly 10000; no duplicates; optional band `min ≤ target ≤ max`; optional manager constraints (per-asset, stablecoin and tokenized-asset caps). Saving reports issues and warnings and never normalizes or blocks; submit and publish return 422 `BASKET_VALIDATION_FAILED` with stable issue codes. Rebalance `reviewFrequency` and drift threshold are disclosures only. |
| Revisioned child rows | Version asset rows and disclosure pins are replaced by **revision** (`revision` with `basket_versions.assets_revision` / `disclosures_revision`), never deleted, because the runtime role has no `DELETE` (D-038, ADR-005). Reads use the current revision; earlier revisions stay as history. |
| Review duties | `ops_reviewer`: changes required, reject, escalate, platform pause. `ops_admin`: approve a version, approve a lead, lift a platform pause, decide a retirement, retire directly, edit templates. A decision stores checklist A to G (`completeness`, `assets`, `allocation`, `communication`, `managers`, `fees`, `operations`; each pass, fail or n/a with a note), section comments, a message to the manager and an internal note that managers never see. Changes required and reject need a message; escalate needs an internal note. An ops user with any membership in the organization gets 403 "You can't review your own organization.". |
| Pause and retire | The manager pauses immediately (reason) and resumes; a platform pause is lifted only by ops. Retirement: manager request moves to `RETIREMENT_PENDING` and an `ops_admin` decides (a decline restores the previous status); ops may retire directly. Drafting is allowed while paused, reassignment-required or retirement-pending, submit and publish are refused. `RETIRED` and `REJECTED` are read-only. |
| Public pages | `/baskets` (cards, cursor) and `/baskets/[slug]` need no session and expose published content only: no drafts, review data, internal notes, user or membership ids, wallets or emails. Listed statuses are `ACTIVE`, `PAUSED`, `REASSIGNMENT_REQUIRED`, `RETIREMENT_PENDING`; `RETIRED` is served but not listed. A renamed version gets a new slug and the old one becomes an alias (308 redirect). Prices come from `getPrices` with stale and unavailable states. A published basket whose instrument later pauses or deprecates shows `hasAssetWarning`; nothing changes automatically. The organization's public profile lists its baskets. All manager and template text is stored and rendered as plain text. |
| No investment | No investing, execution, custody, fee collection or investor notification exists. The public button is disabled ("Investing opens soon"). Emails go to the lead(s) and the organization owner only. |
| Data | Migration `0008_baskets.sql`: `baskets`, `basket_slug_aliases`, `basket_versions`, `basket_version_assets`, `disclosure_templates`, `basket_version_disclosures`, `basket_assignments`, `basket_reviews`, `basket_events`; SELECT, INSERT and UPDATE only, RLS `api_all`. |

## Consequences
- Investing, portfolios and rebalance execution can build on an immutable, hashed published version; a rebalance is a manager-proposed new version that users must explicitly accept (D-028).
- A history table grows with every save that replaces assets (revisions); a retention policy can prune later through the owner role.
- The hash check makes an approved version un-publishable after any later content change, at the cost of a new review.
- Web preview and live validation run the same `validateBasketVersion` as the API; the server stays authoritative.

## Final-review fixes

- Publish re-runs the submit validation inside the publish transaction (registry, organization and lead state can change after approval; the hash covers content only) and returns 422 `BASKET_VALIDATION_FAILED`.
- Withdrawal eligibility and the escalated/review queues count only reviews of the current submission (`created_at >= submitted_at`).
- Declining a retirement request for a basket that lost its lead moves it to `REASSIGNMENT_REQUIRED` instead of restoring a lead-less status.
- Not done: lead changes in the version diff (spec section 8); the public basket page lists manager history separately. Public baskets of non-verified organizations are still served (spec silent).

## Deviations recorded during implementation
- One `ACTIVE` lead and, separately, one `PENDING_APPROVAL` lead per basket (the spec's single combined index would make a pending replacement impossible).
- A duplicate instrument in one save is refused by the request schema (400); `ALLOCATION_DUPLICATE` remains in the pure validator.
- Email idempotency key is `basket/<eventId>/<contactId>` so every recipient of one event is sent.
- On publish a renamed version (or a first publish) gets a new slug; the old slug is aliased only if the basket was already public.
- Public list order is `published_at desc, id desc`.
- Ops queue `review` is in review without an escalation; `escalated` is in review with an escalated review.
- A platform pause of a manager-paused basket upgrades it to a platform pause.
- Reassignment emails are found by request id after commit; `decideMemberVerification` and `transferOwnership` end assignments but send no email.
- `publicOrganizationSchema.baskets` defaults to `[]` so older payloads still parse.
- Web: the public list pages with a "Load more" link to the next cursor (a server page cannot accumulate). Live validation assumes the organization is verified (the server checks at submit). A draft shows a version's pinned platform notices only after submit: there is no session read API for templates, so would-be notices are not previewed. `@repo/app-core/basket-status` is a subpath export so server pages can read labels without the React-hook barrel.

## Open items
- Final disclosure wording (compliance) and confirmation of the fee caps (percent at most 1%, fixed at most 1% of the minimum).
- Fee base, collection timing, refunds and recipient split (subscriptions and fees spec).
- Investor notifications and the follower model (first-investment spec); events are already recorded.
- Performance methodology, analytics and informational commentary.
- Review SLA communication.
- Search, filters and discovery (phase 3).
- Legal classification of baskets per jurisdiction.
