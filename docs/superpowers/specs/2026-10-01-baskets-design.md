# Spec 6 — Baskets: Creation, Review, Publication (Design)

- **Date:** 2026-10-01
- **Status:** Approved in conversation (2026-10-01); written spec pending user review
- **Series:** Spec 6 — after (1) auth ✅, (2) manager application ✅, (3) organization onboarding ✅, (4) members/roles ✅, (5) asset registry ✅
- **Builds on:** Spec 3 (whole-version review pattern, public organization profile), Spec 4 (`ROLE_PERMISSIONS`, `baskets.manage`, membership lifecycle, public team names, ops self-review block), Spec 5 (`ACTIVE` instruments/deployments, `getPrices`, asset types).
- **Sources:** `docs/source/Basket-Creation.txt`; `docs/source/Fund-Manager-&-Organisation-Onboarding-Flow.txt` §31–§38; `docs/domains/BASKET-CREATION.md`; D-007, D-008, D-028.

## 1. Intent

Members of a `VERIFIED` organization build **versioned model portfolios** from `ACTIVE` registry instruments. Submitting freezes a snapshot; ops review it; the manager publishes an approved version; the public sees published baskets. Later changes are new versions with a diff and a rationale. Manager assignments keep public history; a basket whose lead leaves needs an ops-approved new lead. **Nothing is invested, executed, charged or moved** — fees and minimums are disclosed terms, and the "Invest" button is disabled.

**Success criteria**
1. Only `baskets.manage` members of `VERIFIED` organizations create baskets; per-basket assignment flags gate every basket action server-side (OWNER/ADMIN act on all).
2. A submitted version is frozen and hashed; only an `ops_admin` approves; only the approved hash can be published; published versions are never edited.
3. Allocation, constraints, fees and minimums are validated server-side with stable issue codes; nothing is normalized silently.
4. Mandatory disclosures come from ops-managed templates, cannot be removed, and are pinned to each version.
5. Lead departure ends assignments, moves published baskets to `REASSIGNMENT_REQUIRED`, and a new lead needs ops approval.
6. Public pages show only published content; drafts, reviews and internal notes never leak. History is never deleted.

## 2. Decisions (this brainstorm)

| Topic | Decision |
|---|---|
| Scope | Full manager + ops lifecycle, public basket page and public "All baskets" list. Deferred: investor notifications (events recorded now), informational commentary, analytics/performance, search/filters. |
| States | Basket state and version state are separate (§4). Approval leaves the version `approved`; the manager clicks Publish (immediate; no scheduler). |
| Access | Org `baskets.manage` + per-basket assignments (`lead`, `co_manager`) carrying permission flags `edit`, `submit`, `publish`, `lifecycle`, `assign`. OWNER/ADMIN act on every basket. `org.read` reads all org baskets read-only. |
| Manager leaves | Assignments end automatically; a published basket without an active lead → `REASSIGNMENT_REQUIRED`; a new lead is `PENDING_APPROVAL` until an `ops_admin` approves. |
| Fees | `entry`, `management` (annual), `rebalance`: each `{ percent, bps 0–100 }` or `{ fixed, amountUsdc }`; `subscription`: fixed USDC per month/year or none. Every fixed amount (incl. subscription per period) ≤ 1% of `minimumInvestmentUsdc`. Free = explicit zeros. |
| Rebalance | Manager-proposed only (a rebalance = new reviewed version with required rationale). `reviewFrequency` and `driftThresholdBps` are disclosures only. User consent is always explicit (platform notice). |
| Disclosures | `disclosure_templates` table, seeded, with an ops editor (new version / retire); auto-selected by asset types; pinned per version. |
| Allocation | Platform rules + optional manager constraints (§6); warnings on save, blocking on submit. |
| Review | `ops_reviewer`: changes required / reject / escalate; `ops_admin`: approve. Checklist A–G stored per decision; section comments; internal notes hidden from managers; ops with any membership in the org → 403. |
| Pause / retire | Manager pause immediate (reason), manager resume; platform pause only lifted by ops. Retirement: manager request → `RETIREMENT_PENDING` → `ops_admin` decides; ops may retire directly. |
| Public | `/baskets` list and `/baskets/[slug]`, no sign-in; org public profile lists baskets. |

## 3. Out of scope

Investment, execution, custody, fee collection, investor notifications, commentary posts, analytics/performance, search/filters/discovery, scheduled activation, automatic rebalance rules, per-organization permission overrides, mobile screens.

## 4. States

```
Basket (basket_status)
  DRAFT ─first publish→ ACTIVE ⇄ PAUSED
  ACTIVE | PAUSED ─no active lead→ REASSIGNMENT_REQUIRED ─ops approves new lead→ previous_status
  ACTIVE | PAUSED ─manager requests retirement→ RETIREMENT_PENDING ─ops_admin approves→ RETIRED ; declines→ previous_status
  ACTIVE | PAUSED | REASSIGNMENT_REQUIRED | RETIREMENT_PENDING ─ops retires→ RETIRED
  DRAFT ─version 1 rejected→ REJECTED

Version (basket_version_status)
  draft ─submit→ in_review
  in_review ─withdraw (no decision yet)→ draft
  in_review ─changes_required→ changes_required ─resubmit→ in_review
  in_review ─escalated→ in_review (flag only)
  in_review ─ops_admin approves→ approved ─manager publishes→ published ─next version published→ superseded
  in_review ─reject→ rejected
```

- One open version per basket (`draft`, `in_review`, `changes_required`, `approved`) — partial unique index.
- A version is editable only in `draft` and `changes_required`; frozen from submit on.
- **Content hash:** at submit, `sha256` of the canonical JSON (sorted keys) of the version content, allocation (sorted by instrument id) and pinned disclosure template ids; approval records the hash it approved; publish refuses (409 `INVALID_TRANSITION`) if the recomputed hash differs.
- **Publish:** version `approved → published`; previous published → `superseded`; `baskets.current_version_id` switched; basket `DRAFT → ACTIVE` on first publish (other statuses unchanged); disclosures re-pinned to the current active templates if any changed since submit (event records it). Publishing an already-published version returns 200 without changes (idempotent).
- **Paused / reassignment / retirement pending:** drafting allowed; submit and publish refused (409). `RETIRED`/`REJECTED`: everything read-only.
- **Reject:** v1 → basket `REJECTED` (start a new basket); vN → basket keeps its current published version.
- **Pause/resume:** `pause_kind` `manager` | `platform`; a manager cannot resume a platform pause (403).
- Every transition locks the basket row `FOR UPDATE`, writes `basket_events` + `writeAudit` with request id in one transaction; invalid → 409 `INVALID_TRANSITION`.

## 5. Data model (`@repo/db`, `schema/baskets.ts`, migration `0008_baskets.sql`)

**Enums:** `basket_status` (`DRAFT`, `ACTIVE`, `PAUSED`, `REASSIGNMENT_REQUIRED`, `RETIREMENT_PENDING`, `RETIRED`, `REJECTED`); `basket_version_status` (`draft`, `in_review`, `changes_required`, `approved`, `published`, `superseded`, `rejected`); `basket_category` (`index`, `thematic`, `sector`, `yield`, `stablecoin`, `rwa`, `multi_asset`); `basket_pause_kind` (`manager`, `platform`); `basket_assignment_role` (`lead`, `co_manager`); `basket_assignment_status` (`PENDING_APPROVAL`, `ACTIVE`, `ENDED`, `REJECTED`); `basket_review_decision` (`changes_required`, `rejected`, `approved`, `escalated`); `disclosure_condition` (`always`, `has_stablecoin`, `has_rwa`); `disclosure_template_status` (`active`, `retired`).

**Tables**
- `baskets`: `id`, `organization_id`, `slug` (unique, `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤90), `status`, `previous_status` (nullable), `pause_kind`, `pause_reason`, `current_version_id` (nullable FK), `created_by_user_id`, `created_at`, `updated_at`.
- `basket_slug_aliases`: `slug` (PK), `basket_id`, `created_at`. Slug = name slugified + short suffix on collision; on publish of a renamed version the new slug is set and the old one becomes an alias.
- `basket_versions`: `id`, `basket_id`, `version_number` (unique per basket), `status`, `name` (3–80), `short_description` (1–160), `long_description` (≤5000), `category`, `tags` text[] (≤5, each `^[a-z0-9-]{1,24}$`), `objective` (≤2000), `thesis` (≤5000), `methodology` (≤5000), `intended_investor` (≤1000), `horizon` (≤200), `key_assumptions` (≤2000), `known_limitations` (≤2000), `strategy_risks` (≤5000, required at submit), `liquidity_notes` (≤2000), `conflicts_of_interest` (≤2000), `constraints` jsonb, `rebalance` jsonb, `fees` jsonb, `minimum_investment_usdc` numeric, `minimum_increment_usdc` numeric (nullable), `rationale` (≤2000; required at submit for version ≥ 2), `content_hash`, `approved_hash`, `created_by_user_id`, `submitted_by_user_id`, `submitted_at`, `approved_by_user_id`, `approved_at`, `published_by_user_id`, `published_at`, `created_at`, `updated_at`.
- `basket_version_assets`: `id`, `version_id`, `instrument_id` (FK `instruments`), `target_weight_bps` int, `min_weight_bps` int (nullable), `max_weight_bps` int (nullable), `rationale` (≤500); unique `(version_id, instrument_id)`.
- `disclosure_templates`: `id`, `key` (`^[a-z_]{3,60}$`), `version` int, `title` (≤120), `body` (≤5000, plain text), `condition`, `status`, `created_by_user_id`, `created_at`, `retired_at`; unique `(key, version)`; partial unique one `active` per `key`. Seeded (version 1, placeholder copy marked for compliance): `no_guarantee`, `self_custody_wallet`, `fees_and_costs`, `user_consent_rebalance`, `platform_fee` (all `always`), `stablecoin_depeg` (`has_stablecoin`), `rwa_issuer_transfer_redemption` (`has_rwa`).
- `basket_version_disclosures`: `version_id`, `template_id`; PK both.
- `basket_assignments`: `id`, `basket_id`, `organization_id`, `membership_id`, `user_id`, `role`, `permissions` text[] (subset of `edit`, `submit`, `publish`, `lifecycle`, `assign`), `status`, `assigned_by_user_id`, `decided_by_user_id`, `started_at` (when it became `ACTIVE`), `ended_at`, `end_reason` (≤500), `created_at`, `updated_at`. Partial uniques: one `ACTIVE`/`PENDING_APPROVAL` assignment per `(basket_id, user_id)`; one `ACTIVE`/`PENDING_APPROVAL` `lead` per basket. Lead permissions are always all five (check). Co-manager default `edit`, `submit`.
- `basket_reviews`: `id`, `version_id`, `basket_id`, `reviewer_user_id`, `decision`, `checklist` jsonb (`{ completeness, assets, allocation, communication, managers, fees, operations }` each `{ result: pass|fail|na, note? }`), `section_comments` jsonb (`{ section, comment }[]`, ≤30), `message_to_manager` (≤2000), `internal_note` (≤2000), `reviewed_hash`, `created_at`.
- `basket_events` (append-only): `id`, `basket_id`, `version_id`, `assignment_id`, `kind` (`created`, `draft_saved`, `submitted`, `withdrawn`, `reviewed`, `approved`, `rejected`, `published`, `paused`, `resumed`, `retirement_requested`, `retirement_decided`, `retired`, `assignment_added`, `assignment_changed`, `assignment_ended`, `lead_decided`, `reassignment_required`, `disclosures_repinned`), `from_status`, `to_status`, `actor_type` (`member`, `ops`, `system`), `actor_user_id`, `reason`, `request_id`, `created_at`.
- Grants/RLS as before: SELECT/INSERT/UPDATE only, RLS `api_all`, no DELETE.

**JSON shapes (zod in `@repo/validator`)**
- `constraints`: `{ maxWeightPerAssetBps?: 100–10000, maxStablecoinBps?: 0–10000, maxRwaBps?: 0–10000 }`.
- `rebalance`: `{ reviewFrequency: "none" | "monthly" | "quarterly", driftThresholdBps?: 50–5000 }`.
- `fees`: `{ entry: Fee, management: Fee, rebalance: Fee, subscription: { amountUsdc: DecimalString, period: "monthly" | "yearly" } | null }`, `Fee = { type: "percent", bps: 0–100 } | { type: "fixed", amountUsdc: DecimalString }`.
- `DecimalString` = `^\d{1,12}(\.\d{1,6})?$` (USDC has 6 decimals). Fee cap comparisons use exact integer micro-USDC (`BigInt` of the scaled string), never JS `number`.

## 6. Validation (`validateBasketVersion` in `@repo/validator`)

Pure function `validateBasketVersion(input: { version, assets: { instrumentId, targetWeightBps, minWeightBps?, maxWeightBps?, instrument: { status, assetType, hasActiveDeployment } }[], versionNumber, hasActiveLead, orgVerified }): { issues: Issue[]; warnings: Issue[] }` with `Issue = { code, section, field?, message }`. The API loads the inputs; the web mirrors it for live feedback.

**Blocking codes** (submit/publish → 422 `BASKET_VALIDATION_FAILED`, `details.issues`):
- `ORG_NOT_ELIGIBLE` — organization not `VERIFIED`.
- `BASKET_NAME_REQUIRED` — name/short description missing.
- `DISCLOSURE_MISSING` — `strategy_risks` empty.
- `ASSET_UNSUPPORTED` — instrument not `ACTIVE` or no `ACTIVE` deployment.
- `ASSET_COUNT_INVALID` — not 1–20 assets.
- `ALLOCATION_DUPLICATE` — same instrument twice.
- `ALLOCATION_WEIGHT_INVALID` — weight < 100 bps, not an integer, or outside its own min/max band (band must satisfy min ≤ target ≤ max).
- `ALLOCATION_TOTAL_INVALID` — sum ≠ 10000.
- `CONSTRAINT_VIOLATION` — any weight > `maxWeightPerAssetBps`, stablecoin sum > `maxStablecoinBps`, RWA (`TOKENIZED_*`) sum > `maxRwaBps`.
- `FEE_CONFIGURATION_INVALID` — percent outside 0–100 bps; fixed or subscription amount > 1% of minimum investment.
- `MINIMUM_INVESTMENT_INVALID` — minimum missing or ≤ 0; increment ≤ 0 or > minimum.
- `MANAGER_ASSIGNMENT_REQUIRED` — no `ACTIVE` lead.
- `REBALANCE_RATIONALE_REQUIRED` — version ≥ 2 without rationale.

**Warnings:** single asset > 5000 bps; instrument `PAUSED`/`DEPRECATED`; empty `thesis`/`methodology`. Saving returns issues + warnings and never blocks. Published baskets whose instruments later pause/deprecate get `hasAssetWarning: true` in manager, ops and public views (computed on read; nothing changes automatically).

## 7. Access

- **Create:** `requirePermission(orgId, "baskets.manage")` (Spec 4) and org `VERIFIED` (else 409 `INVALID_TRANSITION` "Your organization must be verified to create baskets."; `ORG_NOT_ELIGIBLE` is the validation issue code at submit). Creator gets an `ACTIVE` `lead` assignment in the same transaction.
- **Basket actions:** allowed if the user's membership role is OWNER/ADMIN (`ACTIVE`), or the user has an `ACTIVE` assignment on the basket whose `permissions` include the action flag: `edit` (PATCH draft, create new version), `submit` (submit, withdraw, resubmit), `publish`, `lifecycle` (pause, resume manager pause, request retirement), `assign` (add/edit/end assignments). The assignment's membership must also still be `ACTIVE` with `baskets.manage`. Otherwise 403 `FORBIDDEN`.
- **Read:** any `ACTIVE` member with `org.read` reads all org baskets (drafts, reviews' manager-visible parts), never `internal_note`.
- **Assign:** assignee must be an `ACTIVE` member of the same org holding `baskets.manage`; lead flags fixed to all five; changing the lead on a published basket creates a `PENDING_APPROVAL` lead (the current lead, if any, stays `ACTIVE` until approval; on approval the previous lead's assignment ends with reason `replaced`). Co-managers need no review. OWNER/ADMIN or `assign` holders only.
- **Manager-leaves hook** (inside the Spec 4 transactions in `services/members.ts` / `services/member-verifications.ts`: membership → `REVOKED`/`REMOVAL_REQUESTED`/`REJECTED`, role change that removes `baskets.manage`, ownership transfer that demotes): end that membership's `ACTIVE`/`PENDING_APPROVAL` assignments (`ENDED`, `end_reason`), event `assignment_ended`; for each affected basket in `ACTIVE`/`PAUSED` with no remaining `ACTIVE` lead → `REASSIGNMENT_REQUIRED` (`previous_status` saved), event `reassignment_required`; emails after commit.
- **Ops:** `ops_reviewer` for queues, review, changes required, reject, escalate, platform pause; `ops_admin` for version approval, lead approval, platform resume, retirement decision, direct retire, disclosure templates. Any ops user with a membership (any status) in the basket's organization → 403 "You can't review your own organization." on basket decisions.

## 8. API

**Manager** (session; permission per §7)
| Method & path | Purpose |
|---|---|
| `POST /v1/organizations/:id/baskets` `{ name, category }` · `GET /v1/organizations/:id/baskets?status=` | Create (draft v1 + lead) / list. |
| `GET /v1/baskets/:bid` | Private view: basket, open version, current published version, assignments, manager-visible reviews, events, validation. |
| `PATCH /v1/baskets/:bid/draft` `{ …fields, assets?, expectedUpdatedAt }` | Save open version (`draft`/`changes_required`); stale `expectedUpdatedAt` → 409 `VERSION_CONFLICT`. Returns validation. |
| `POST /v1/baskets/:bid/validate` · `GET /v1/baskets/:bid/preview` | Validation / public-shaped preview of the open version (labelled preview). |
| `POST /v1/baskets/:bid/submit` · `/withdraw` · `/publish` | Lifecycle. |
| `POST /v1/baskets/:bid/versions` · `GET /v1/baskets/:bid/versions` · `GET /v1/baskets/:bid/versions/:vid/diff` | New draft cloned from published / history / diff vs previous published. |
| `POST /v1/baskets/:bid/pause` `{ reason }` · `/resume` · `/retirement-request` `{ reason }` | Pause/resume/retire request. |
| `POST /v1/baskets/:bid/assignments` `{ membershipId, role, permissions? }` · `PATCH …/assignments/:aid` `{ permissions }` · `POST …/assignments/:aid/end` `{ reason }` | Assignments. |

**Ops** (session + roles per §7)
| Method & path | Purpose |
|---|---|
| `GET /v1/ops/baskets?queue=review\|escalated\|leads\|retirements&cursor=` · `GET /v1/ops/baskets/:bid` | Queues / detail (snapshot, diff, org + manager context, reviews incl. internal notes, events, validation). |
| `POST /v1/ops/baskets/:bid/versions/:vid/decision` `{ decision, checklist, sectionComments?, messageToManager?, internalNote? }` | Review decision (`changes_required`/`rejected` need `messageToManager`; `escalated` needs `internalNote`; `approved` admin only). |
| `POST /v1/ops/baskets/:bid/assignments/:aid/decision` `{ decision: approved\|rejected, reason? }` | Lead approval (admin). |
| `POST /v1/ops/baskets/:bid/pause` `{ reason }` · `/resume` (admin) · `/retire` `{ reason }` (admin) · `/retirement/decision` `{ decision, reason? }` (admin) | Platform lifecycle. |
| `GET /v1/ops/disclosure-templates` · `POST /v1/ops/disclosure-templates` `{ key, title, body, condition }` · `POST …/:id/retire` | Templates (admin); POST creates the next version of `key` and retires the previous active one. |

**Public** (no session; `limits.publicBasketIp` 60/min per IP)
| Method & path | Purpose |
|---|---|
| `GET /v1/public/baskets?cursor=` | Baskets with a published version and status in `ACTIVE`, `PAUSED`, `REASSIGNMENT_REQUIRED`, `RETIREMENT_PENDING`; cards: slug, name, short description, organization public name, category, asset count, minimum, status, published date. |
| `GET /v1/public/baskets/:slug` | Current published version only: content, allocation (instrument name, symbol, type, `ACTIVE` chains, weight, band, price via `getPrices`), constraints, rebalance disclosures, fees, minimums, pinned disclosures, version history (number, published date, rationale, diff), manager history (from assignments: public display name or "Team member", role, from/to; current vs former), organization public name/link, status notice, `hasAssetWarning`. `RETIRED` served (not listed). Alias → `{ redirectTo: slug }`. Draft-only/`REJECTED`/unknown → 404. |
| Spec 3 public organization endpoint | Adds `baskets: { slug, name, status }[]` (listed statuses only). |

**Diff** (computed on read): added/removed instruments, weight changes (bps), band changes, constraint/rebalance/fee/minimum changes, lead changes between the two versions' publication times.

**Errors:** reuse `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `RATE_LIMITED`; new `BASKET_VALIDATION_FAILED` (422) and `VERSION_CONFLICT` (409).

**Rate limits:** basket mutations 60/min per user (`limits.basketMutationUser`); public reads 60/min per IP; ops as before.

## 9. Emails (Resend, idempotency key per event; to the basket's active lead(s) and the org OWNER with verified email contacts; failures logged, never roll back)

Submitted, changes required, approved, rejected, published, platform paused/resumed, retirement decided, retired by platform, reassignment required, lead approved/rejected. Factual plain text; never claims assets moved. Investor emails deferred (events kept).

## 10. Web

- **Manager** — `/organization` gains **Baskets** (visible with `org.read`): status tabs (Drafts, In review, Changes required, Active, Paused, Retired), rows with name, status, current version, updated, actions; "Create basket" with `baskets.manage` and verified org.
- `/organization/baskets/[bid]`: nine sections — Basics, Thesis, Assets & allocation (registry search via `GET /v1/assets`; per row weight % and bps, optional band, rationale, remove; live total, remaining, asset count, largest weight; no auto-normalize), Constraints, Rebalance (frequency, drift, consent notice), Managers (assignments, flags, add/end, pending lead state), Fees & minimum (percent/fixed toggle per fee with cap hint showing 1% of the minimum), Risks & disclosures (manager text + pinned platform notices read-only), Review & preview (validation panel, preview labelled "Preview — not public"). Explicit Save with conflict banner ("This draft changed since you opened it. Reload to continue."), reviewer section comments beside sections, Submit / Withdraw / Publish, New version (diff + rationale), Pause / Resume / Request retirement, version history. Controls hidden/disabled per flags and state (server authoritative).
- **Ops** — nav **Baskets**: `/ops/baskets` queues; `/ops/baskets/[bid]` snapshot + diff + context + checklist A–G + section comments + decision form (approve only for admin); lead approval; platform pause/resume/retire; retirement decision. Nav **Disclosures**: `/ops/disclosures` list by key with versions, create next version, retire (admin).
- **Public** — `/baskets` cards with status badges; `/baskets/[slug]` full page, disabled "Investing opens soon" button, status notices ("Paused", "Manager change in progress", "Retirement pending", "Retired"); org public profile lists baskets.
- Dark design system, 44 px, status text + icon, lucide only; plain-text rendering (no HTML) for manager and template text. No mobile changes.

## 11. Security & safety

- Server-side authorization on every route; flags and states enforced in services; client-supplied status/hash/version fields never trusted.
- Publication never moves assets or charges fees; money as decimal strings / bps integers; fee caps checked exactly.
- Manager and template text stored and rendered as plain text.
- Public endpoints expose published content only; no `internal_note`, drafts, review data, user ids, wallets or emails.
- History never deleted; audit with request id on every change.

## 12. Testing

- **Unit:** `validateBasketVersion` — one case per blocking code and warning; fee caps (percent 100 ok / 101 fail; fixed exactly 1% ok, 1% + 0.000001 fail; subscription cap); state maps; content hash stable under key order and asset order; diff (add/remove/weight/fee changes).
- **Integration:** full lifecycle draft → submit (422 with issues when invalid) → changes required → resubmit → reviewer approve 403 → admin approve → publish → basket `ACTIVE`, v1 `published`; publish when stored hash differs → 409; withdraw before decision; v1 reject → `REJECTED`; new version: clone, diff, rationale required, publish supersedes previous; `VERSION_CONFLICT`; table-driven permission test (OWNER, ADMIN, lead, co-manager default flags, co-manager without `publish`, member with no assignment, VIEWER) × every manager route; lead membership removed → assignments `ENDED` → `REASSIGNMENT_REQUIRED` → new lead `PENDING_APPROVAL` → ops approve → previous status restored, previous lead ended; manager pause/resume; platform pause blocks manager resume; submit/publish while paused → 409; retirement request → decline restores, approve → `RETIRED`; ops member of org → 403; disclosures auto-selected by asset types and re-pinned at publish when a template changed; public list/detail never include drafts, rejected, `internal_note`, reviews, ids, emails; alias redirect; `RETIRED` reachable not listed; grants no DELETE.
- **Web:** wizard save + conflict + validation panel; allocation editor totals/remaining; fee toggle caps; section comments; flag-gated controls; ops decision form rules (message/internal note requirements, admin-only approve); lead approval; disclosure editor; public list and page notices.

## 13. Execution shape

Four tasks, one review at the end: (1) DB + migration (incl. template seed) + validator (enums, states, JSON schemas, `validateBasketVersion`, fee caps, hash, diff) + manager basket/version/assignment API (create, read, PATCH, validate, preview, versions, assignments) + manager-leaves hook; (2) submit/withdraw/review/publish + pause/resume/retirement + lead approval + disclosure templates + public API + emails + api-client; (3) web manager workspace + wizard + public pages; (4) web ops pages + web tests + docs (ADR-011; D-007/D-008/D-028 rewritten in place; new decision rows for basket access flags, fee caps, disclosures, manager-leaves policy, public basket pages; `BASKET-CREATION.md`; `FUND-MANAGER-FEATURES.md`; `ARCHITECTURE.md`; HANDOFF).

## 14. Open items

- Final disclosure wording (compliance) and confirmation of fee caps (percent ≤ 1%, fixed ≤ 1% of minimum).
- Fee base, collection timing, refunds, recipient split (subscriptions & fees spec).
- Investor notifications and follower model (first-investment spec).
- Performance methodology, analytics, informational commentary.
- Review SLA communication.
- Search/filters/discovery (phase 3).
- Legal classification of baskets per jurisdiction.
