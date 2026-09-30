# Spec 5 — Asset Registry (Design)

- **Date:** 2026-09-30
- **Status:** Approved in conversation (2026-09-30); written spec pending user review
- **Series:** Spec 5 — after (1) foundation + auth ✅, (2) manager application ✅, (3) organization onboarding ✅, (4) members/roles ✅
- **Builds on:** Spec 1 (address canonicalization, Alchemy/viem provider, `VERIFIER_UNAVAILABLE`), Spec 2 (`/ops`, platform roles, self-review block), Spec 3/4 (review state machines, events + audit in one transaction, ops UI patterns).
- **Sources:** `docs/source/Assets-Registry.txt`; `docs/domains/ASSET-REGISTRY.md`; ADR-002; D-009, D-010, D-011, D-015, D-025, D-027.

## 1. Intent

Ops keep a reviewed inventory of **instruments** (economic identity) with their chain **deployments**, **execution routes**, **eligibility rules** and **price references**. Only `ACTIVE` records are selectable later (basket spec). Nothing in this release executes, signs, broadcasts or moves assets: routes and eligibility rules are records only, and every RPC call is read-only.

**Success criteria**
1. Ops can draft, submit, review, approve, activate, pause, deprecate and retire instruments; deployments/routes added after launch get their own review.
2. Token deployments on EVM and Solana are checked against on-chain metadata; a decimals mismatch blocks approval; other deployments need a reviewer-confirmed source URL.
3. The person who submitted an instrument cannot approve it; approvals and lifecycle actions are `ops_admin` only.
4. Signed-in users can read `ACTIVE` instruments with public fields and prices; internals never leak.
5. Market prices (CoinMarketCap) and issuer NAV stay distinct, carry their observed time and a stale flag, and degrade to "unavailable" instead of failing.
6. History is never deleted; every change writes an event and an audit row.

## 2. Decisions (this brainstorm)

| Topic | Decision |
|---|---|
| Scope | Crypto and stablecoins fully; RWAs recorded as instrument + issuer + deployments + routes + eligibility rules. The eligibility **engine** (evaluating a user) is deferred to the first-investment spec. |
| Chains | New `ASSET_CHAINS`: `solana`, `ethereum`, `base`, `bnb`, `arbitrum`, `polygon`, `bitcoin`. The auth `chainSchema` is unchanged. Recording a chain does not make it executable. |
| Who | Ops only. `ops_reviewer` drafts/edits/submits; `ops_admin` decides and runs lifecycle actions; the submitter of the current review cannot decide it. Managers cannot propose assets in this release. |
| Verification | EVM ERC-20 `decimals`/`symbol`/`name` via the existing Alchemy/viem provider (ethereum, base, bnb, arbitrum); Solana mint `decimals` via Alchemy Solana JSON-RPC `getTokenSupply`; native assets and Polygon/Bitcoin deployments are manual with a required `source_url`. Decimals mismatch blocks submit/approval. No scheduled re-verification. |
| Pricing | CoinMarketCap on demand, batched, cached in Redis 60 s, `stale` after 5 min. RWA NAV entered by ops with history. No price history table, no scheduled job. |
| Lifecycle | Instrument is the review unit; deployments/routes added to an approved instrument get per-item admin approval; identity fields locked after approval; descriptive fields editable without review (audited). |
| Read access | Session users: read-only API over `ACTIVE` items. No manager screens (the basket wizard builds on the API). |
| Data | No seeded assets; migration seeds only enum types. |

## 3. Out of scope

Eligibility evaluation, execution/routing/quotes, custody, cross-chain transfers, bridges, manager asset proposals, public (unauthenticated) asset pages, price history/valuation snapshots, scheduled jobs, Polygon/Bitcoin RPC verification, mobile screens.

## 4. Data model (`@repo/db`, `schema/assets.ts`, migration `0007_assets.sql`)

**Enums**
- `asset_type`: `CRYPTO`, `STABLECOIN`, `TOKENIZED_TREASURY`, `TOKENIZED_EQUITY`, `TOKENIZED_FUND`, `TOKENIZED_BOND`, `TOKENIZED_COMMODITY`, `TOKENIZED_PRIVATE_CREDIT`, `TOKENIZED_OTHER` (RWA types = every `TOKENIZED_*`).
- `asset_chain`: `solana`, `ethereum`, `base`, `bnb`, `arbitrum`, `polygon`, `bitcoin`.
- `token_standard`: `native`, `erc20`, `spl`, `spl_token_2022`, `other`.
- `instrument_status`: `DRAFT`, `UNDER_REVIEW`, `CHANGES_REQUIRED`, `APPROVED`, `ACTIVE`, `PAUSED`, `DEPRECATED`, `RETIRED`.
- `asset_item_status` (deployments, routes): `DRAFT`, `APPROVED`, `ACTIVE`, `PAUSED`, `RETIRED`.
- `rule_status`: `DRAFT`, `ACTIVE`, `RETIRED`.
- `deployment_verification`: `onchain`, `manual`.
- `execution_method`: `swap`, `subscription`, `secondary_market`, `platform_inventory`, `redemption`, `cross_chain_transfer`.
- `processing_model`: `sync`, `async`.
- `eligibility_action`: `acquire`, `sell`, `redeem`, `transfer`.
- `eligibility_outcome`: `ALLOWED`, `RESTRICTED`, `KYC_REQUIRED`, `REVIEW_REQUIRED`.
- `price_kind`: `market`, `nav`; `price_provider`: `coinmarketcap`, `issuer`.
- `asset_provider_kind`: `dex_aggregator`, `issuer_platform`, `venue`, `bridge`, `other`.

**Tables**
- `asset_issuers`: `id`, `name` (unique), `legal_name`, `website`, `jurisdiction` (ISO-3166 alpha-2, nullable), `notes`, `created_at`, `updated_at`.
- `asset_providers`: `id`, `name` (unique), `kind`, `website`, `notes`, `created_at`, `updated_at`.
- `instruments`: `id`, `name` (2–120), `symbol` (1–20, uppercase), `asset_type`, `description` (≤2000), `issuer_id` (nullable FK; required at submit for RWA types), `risk_notes` (≤2000), `links` jsonb (`{ label, url }[]`, ≤10, https only), `status`, `created_by_user_id`, `submitted_by_user_id`, `decided_by_user_id`, `created_at`, `updated_at`.
- `instrument_deployments`: `id`, `instrument_id`, `chain`, `token_standard`, `address` (canonical per chain family; null only for `native`), `decimals` (0–36), `verification`, `observed_decimals`, `observed_symbol`, `observed_name`, `observed_at`, `source_url` (https), `status`, `approved_by_user_id`, `created_at`, `updated_at`.
  - Partial unique: one non-`RETIRED` deployment per `(chain, address)` where `address is not null` (registry-wide); one non-`RETIRED` native deployment per `(instrument_id, chain)`.
  - Checks: `address is null` ⇔ `token_standard = 'native'`; `verification = 'manual'` ⇒ `source_url is not null` at submit (service check).
  - Address canonical form: EVM lowercase `0x…` 40-hex; Solana base58 32-byte public key; Bitcoin: native only in this release (`address` null).
- `execution_routes`: `id`, `instrument_id`, `deployment_id` (FK, same instrument), `provider_id` (FK), `venue` (≤120), `method`, `settlement_instrument_id` (FK → `instruments`, nullable), `minimum_amount` (numeric, settlement units, nullable), `processing_model`, `notes` (≤2000), `status`, `approved_by_user_id`, `created_at`, `updated_at`.
- `eligibility_rules`: `id`, `instrument_id`, `route_id` (nullable = all routes of the instrument), `jurisdiction` (alpha-2 or `*`), `action`, `outcome`, `kyc_requirement` (≤500), `transfer_restrictions` (≤1000), `source_text` (≤500), `source_url`, `status`, `created_at`, `updated_at`.
- `price_references`: `id`, `instrument_id`, `kind`, `provider`, `external_id` (CMC numeric id as text; null for `issuer`), `quote_currency` (`USD`), `status` (`ACTIVE` | `RETIRED` via `rule_status`), `created_at`, `updated_at`. Partial unique: one `ACTIVE` per `(instrument_id, kind)`. `market` ⇒ provider `coinmarketcap`; `nav` ⇒ provider `issuer`.
- `nav_observations` (append-only): `id`, `price_reference_id`, `value` (numeric), `currency` (`USD`), `as_of` (date), `source_url`, `entered_by_user_id`, `created_at`.
- `asset_events` (append-only): `id`, `instrument_id`, `entity_type` (`instrument`, `deployment`, `route`, `rule`, `price`), `entity_id`, `kind` (`created`, `updated`, `verified`, `submitted`, `decided`, `approved`, `activated`, `paused`, `resumed`, `deprecated`, `retired`, `nav_recorded`), `from_status`, `to_status`, `actor_user_id`, `message`, `internal_note`, `request_id`, `created_at`.
- Grants/RLS as Spec 3: runtime role SELECT/INSERT/UPDATE, RLS `api_all`, no DELETE.

## 5. Lifecycle (`INSTRUMENT_TRANSITIONS`, `ASSET_ITEM_TRANSITIONS` in `@repo/validator`)

```
Instrument
  DRAFT ─submit→ UNDER_REVIEW
  UNDER_REVIEW ─admin decision→ APPROVED | CHANGES_REQUIRED (message required)
  CHANGES_REQUIRED ─resubmit→ UNDER_REVIEW
  APPROVED ─activate→ ACTIVE ⇄ PAUSED (pause / resume)
  ACTIVE | PAUSED ─deprecate→ DEPRECATED ─retire→ RETIRED
  DRAFT | CHANGES_REQUIRED | APPROVED ─retire→ RETIRED (abandon)

Deployment / route
  DRAFT ─approved with the instrument decision, or admin item-approve (instrument APPROVED/ACTIVE/PAUSED)→ APPROVED
  APPROVED ─activate→ ACTIVE ⇄ PAUSED
  any non-RETIRED ─retire→ RETIRED
```

- **Submit requirements** (422 `REQUIREMENTS_INCOMPLETE`, `details.missing: string[]` of stable keys): ≥1 non-retired deployment; each `onchain` deployment has `observed_decimals = decimals`; each `manual` deployment has `source_url`; `CRYPTO`/`STABLECOIN` need an `ACTIVE` market price reference; RWA types need `issuer_id`, ≥1 non-retired route and ≥1 `ACTIVE` eligibility rule. Checked again at approval.
- **Decision** (`ops_admin`, instrument locked `FOR UPDATE`): `approved` → instrument `APPROVED`, its `DRAFT` deployments/routes → `APPROVED`; `changes_required` → `CHANGES_REQUIRED` with message. `decided_by_user_id = submitted_by_user_id` → 403 `FORBIDDEN` "You can't review a submission you made.".
- **Activate** instrument → `ACTIVE` and its `APPROVED` items → `ACTIVE`. Item approve on a live instrument (`ACTIVE`/`PAUSED`) re-checks that item's requirements (deployment verification; route deployment belongs to the instrument), then the item needs an explicit activate.
- **Pause scope:** a status applies at its own level; nothing cascades down. Read visibility requires the instrument **and** the item to be `ACTIVE` (a paused instrument hides everything under it).
- **Deprecated:** readable by ops; excluded from the session read API; existing references remain valid (basket spec blocks new selection).
- **Locked fields:** once a deployment is `APPROVED` or later, `chain`, `token_standard`, `address`, `decimals` are immutable; once a route is `APPROVED` or later, `deployment_id`, `method`, `provider_id`, `settlement_instrument_id` are immutable → 409 `INVALID_TRANSITION` "Retire this item and add a new one to change it.". `instruments.asset_type` and `symbol` lock at `APPROVED`. Descriptive fields (name, description, risk notes, links, venue, notes, minimum amount, rule text) stay editable in any non-retired status, audited without review. Eligibility rules and price references can be added/retired by reviewers at any time (audited); rules for a live instrument take effect only for the future engine.
- Edits to instruments in `UNDER_REVIEW` are refused (409 `INVALID_TRANSITION`) so the admin decides on what was submitted.
- Every transition locks the instrument row, writes `asset_events` + `writeAudit` with request id in the same transaction; invalid → 409 `INVALID_TRANSITION`.

## 6. Deployment verification (`apps/api/src/providers`)

- **EVM** (`evm-rpc.ts`, extended): `readTokenMetadata({ chain, address })` → viem `multicall`/`readContract` of ERC-20 `decimals`, `symbol`, `name` on the existing Alchemy hosts (ethereum, base, bnb, arbitrum). Revert/non-ERC-20 → stored as "not a token" (`observed_* = null`, `observed_at` set) which fails the submit check; transport failure → 503 `VERIFIER_UNAVAILABLE`, nothing stored.
- **Solana** (new `providers/solana-rpc.ts`): one JSON-RPC `fetch` of `getTokenSupply` to `https://solana-mainnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>` (confirm against current Alchemy docs), zod-validated; `decimals` stored; symbol/name are ops-entered (SPL symbol is not on-chain). Invalid mint → "not a token"; transport → `VERIFIER_UNAVAILABLE`.
- **Manual:** `token_standard = native` (any chain), and every Polygon/Bitcoin deployment; require `source_url`; reviewer confirms at decision.
- Runs on deployment create (for `onchain` chains + non-native standards) and on `POST …/deployments/:did/verify` (only while the deployment is `DRAFT`). Rate limit 30/h per ops user.

## 7. Pricing (`services/pricing.ts`, `providers/coinmarketcap.ts`)

- Provider: `GET https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=<ids>&convert=USD`, header `X-CMC_PRO_API_KEY`, 5 s timeout; response zod-validated; implement from the current official CMC API docs. New optional env `COINMARKETCAP_API_KEY` (empty ⇒ market prices `unavailable`).
- `getPrices(instrumentIds: string[]): Promise<PriceView[]>` where `PriceView = { instrumentId, kind: "market" | "nav", status: "ok" | "unavailable", value: string | null (decimal string), currency: "USD", source: "coinmarketcap" | "issuer", observedAt: string | null, stale: boolean }`.
  - Market: one batched CMC call for all uncached ids; Redis key `price:cmc:<id>` holding `{ value, observedAt }` for 60 s; `observedAt` = CMC `last_updated`; `stale` = `now - observedAt > 5 min`. Provider error/timeout ⇒ `status: "unavailable"` (logged, never thrown to the caller).
  - NAV: latest `nav_observations` row by `as_of`, then `created_at`; `observedAt` = `as_of`; `stale` = false (the as-of date is shown).
  - Market and NAV are separate entries; nothing converts one into the other. No executable quote in this release.

## 8. API

**Ops** (session + `ops_reviewer`; ★ `ops_admin`)
| Method & path | Purpose |
|---|---|
| `GET /v1/ops/assets?status=&type=&chain=&q=&cursor=` | List (cursor as Spec 3). |
| `POST /v1/ops/assets` · `GET/PATCH /v1/ops/assets/:id` | Create / detail (all items, rules, price refs, NAV history, events, missing requirements) / edit. |
| `POST /v1/ops/assets/:id/deployments` · `PATCH …/deployments/:did` · `POST …/deployments/:did/verify` | Deployments. |
| `POST /v1/ops/assets/:id/routes` · `PATCH …/routes/:rid` | Routes. |
| `POST /v1/ops/assets/:id/rules` · `PATCH …/rules/:ruleId` | Eligibility rules (incl. retire via `status`). |
| `PUT /v1/ops/assets/:id/price-references/:kind` · `POST /v1/ops/assets/:id/nav` | Price reference (replaces the active one; old → retired) / NAV entry. |
| `GET /v1/ops/assets/:id/prices` | Live prices for review. |
| `POST /v1/ops/assets/:id/submit` | Submit / resubmit. |
| ★ `POST /v1/ops/assets/:id/decision` `{ decision: "approved" \| "changes_required", message?, internalNote? }` | Review decision (message required for changes). |
| ★ `POST /v1/ops/assets/:id/{activate,pause,resume,deprecate,retire}` | Instrument lifecycle. |
| ★ `POST /v1/ops/assets/:id/{deployments,routes}/:itemId/{approve,activate,pause,resume,retire}` | Item lifecycle. |
| `GET/POST /v1/ops/asset-issuers` · `GET/POST /v1/ops/asset-providers` | Reference records (edit via `PATCH …/:id`). |

**Session users (read-only)**
| Method & path | Purpose |
|---|---|
| `GET /v1/assets?q=&type=&chain=&cursor=` | `ACTIVE` instruments with ≥1 `ACTIVE` deployment. |
| `GET /v1/assets/:id` | Public view: name, symbol, type, description, issuer name/website, risk notes, links, `ACTIVE` deployments (chain, standard, address, decimals), `ACTIVE` routes (chain, method, provider name, settlement symbol, minimum, processing model), prices. Never: rules, review messages/notes, observed metadata, actor ids, non-active items. Non-active or unknown → 404. |

**Errors:** reuse `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `REQUIREMENTS_INCOMPLETE`, `VERIFIER_UNAVAILABLE`; new `DEPLOYMENT_EXISTS` (409) "This token is already registered." for a duplicate `(chain, address)`.

**Rate limits:** ops mutations as Spec 2; verify 30/h per ops user; session reads use existing limits (none new).

## 9. Web (ops only; `apps/web`)

- Ops nav gains **Assets**.
- `/ops/assets`: table/cards (name, symbol, type, chains, status, updated) with status/type/chain filters and search; "New asset".
- `/ops/assets/new`: name, symbol, type, issuer (select or inline create), description.
- `/ops/assets/[id]`: sections — Details (editable fields, lock indicators); Deployments (add form with chain/standard/address/decimals/source URL; verification result showing entered vs observed values with status text + icon; Re-verify; item lifecycle buttons for admins); Routes (provider select or inline create, settlement asset select among instruments, minimum, processing model); Eligibility rules (table + add/retire); Pricing (CMC id, live price with stale badge; NAV entry form + history); Review panel (missing-requirements checklist, Submit, admin decision form with required message for changes, lifecycle buttons with confirm dialogs, self-review notice); Events timeline (internal notes labelled).
- Dark design system, 44 px targets, status text + icon, lucide only; access-lost state on 403; admin-only controls hidden for reviewers (server authoritative). No mobile changes.

## 10. Security & safety

- Server-side ops-only writes; `ops_admin` for decisions and lifecycle; submitter ≠ decider.
- Addresses are identifiers only; no signing, broadcasting or state-changing RPC; RPC and CMC responses are untrusted and zod-validated; prices are informational, never proof of ownership, eligibility or redemption.
- Session read API exposes public fields only; no internal notes or rule details.
- History never deleted; audit with request id on every change.

## 11. Testing

- **Unit:** instrument/item transition maps (valid + invalid); `ASSET_CHAINS` independent of auth chains; submit requirements per asset type; CMC response parsing + stale flag; address canonicalization per family.
- **Integration:** full cycle (draft → submit → changes required → resubmit → approve → activate); submitter-as-admin 403; reviewer 403 on every ★ route; locked fields 409 (deployment, route, instrument type/symbol); edit while `UNDER_REVIEW` 409; duplicate `(chain, address)` → 409 `DEPLOYMENT_EXISTS`, allowed again after retire; EVM verify with mocked viem (match; decimals mismatch blocks submit; non-token; transport → 503, nothing stored); Solana verify with mocked fetch; manual Polygon/Bitcoin/native require `source_url`; item added to an `ACTIVE` instrument needs approve + activate while the instrument stays visible; pause item vs pause instrument visibility in `/v1/assets`; deprecated hidden from session API; session API never returns internals (explicit field allow-list assertion); pricing: cache miss → one batched call, cache hit → no call, key missing → `unavailable`, provider error → `unavailable`, NAV separate from market; grants contain no DELETE on new tables.
- **Web:** list + filters; create; deployment verification display (match / mismatch / unavailable); submit checklist; decision form requires message; admin-only controls hidden for reviewer; lifecycle confirm dialogs; 403 access-lost state.

## 12. Execution shape

Four tasks, one review at the end: (1) DB + migration + validator (enums, transitions, schemas) + ops CRUD for instruments/issuers/providers/deployments/routes/rules/price references + EVM/Solana verification; (2) review + instrument/item lifecycle + pricing (CMC, NAV, Redis) + session read API + events/audit + api-client; (3) web ops assets list/create/editor; (4) web tests + docs (ADR-010 registry model and verification; ADR-002 rewritten in place with the implemented pricing; decision register D-009/D-010/D-011/D-015/D-027 and new rows for `ASSET_CHAINS` and ops separation of duties; `ASSET-REGISTRY.md`; `ARCHITECTURE.md`; `apps/api/README.md` `COINMARKETCAP_API_KEY`; HANDOFF).

## 13. Open items

- CoinMarketCap plan, rate limits, attribution and terms (user).
- Polygon on-chain verification (Alchemy `polygon-mainnet` host once confirmed) and a Bitcoin data provider.
- RWA issuer terms and legal eligibility values per jurisdiction (compliance).
- Eligibility engine (first-investment spec); executable quotes and routing (execution specs).
- Price history / valuation snapshots (needs a job queue).
- Cross-chain route pairs and bridge policy.
- First assets for ops to onboard: SOL, USDC (Solana, Ethereum, Base), ETH, BTC.
