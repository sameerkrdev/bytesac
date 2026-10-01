# System Architecture

**Status:** Consolidated architecture baseline; unresolved choices are explicitly marked.  
**Product:** Bytesac-style multi-chain basket investing platform.

## 1. Product model

The platform lets users discover manager-created baskets, review a strategy and invest. A verified organization owns/manages baskets; individual users authenticate through wallet-linked platform accounts. Managers define target allocations and publish reviewed versions. Users decide whether to participate in updates and retain control over investment actions.

The platform coordinates execution and monitoring. Actual holdings must be grounded in reconciled chain or issuer state, not merely in the manager's target or a database estimate.

## 2.1 Settlement currency

**Initial platform settlement currency: USDC on Solana.** Investment amounts, basket execution budgets, cash residuals, fee calculations and settlement-facing user flows should use this as the initial settlement denomination where applicable. The design must not hard-code USDC-on-Solana as the only possible settlement currency: future expansion to additional currencies and/or chain-specific settlement assets must be supported through explicit currency and settlement-asset configuration.

Keep these concepts distinct:
- **Display currency:** the currency used to present portfolio values.
- **Settlement currency:** the currency used to fund/settle a platform operation.
- **On-chain settlement asset:** the actual token/asset used on a particular network (initially USDC on Solana).
- **Instrument currency/reference:** the denomination used by a market price or issuer NAV.

A future currency expansion must define conversion source, quote freshness, rounding, fees, settlement network, user consent and accounting treatment. Do not imply that changing display currency changes settlement currency.

## 2. Architectural principles

1. **Separate identity from organization.** A user account, manager application, organization, membership, permission and payout wallet are distinct concepts.
2. **Strategy is not execution.** A basket version expresses a target; each user's operation is separately planned and authorized.
3. **Chain-agnostic portfolio semantics.** Baskets and portfolio concepts use canonical instruments; transaction construction, signing, settlement and finality remain chain-specific.
4. **Instrument ≠ deployment ≠ route.** An economic instrument may have several chain representations and several ways to acquire, transfer, sell or redeem it.
5. **Policy is contextual.** Eligibility depends on user, instrument, provider, route, jurisdiction and action.
6. **Ownership and allocation are different.** Physical wallet balances do not, by themselves, reveal basket-level attribution.
7. **Explicit consent.** Manager updates do not silently move user assets.
8. **Auditable financial state.** Operations, ledger entries, approvals and execution outcomes must be traceable.
9. **Provider independence.** Use adapters around external providers and preserve normalized internal models.
10. **MVP as a modular monolith.** Avoid premature microservices; isolate boundaries in code first.

## 3. System context

```text
Investor Web / Mobile                     Manager Web
        |                                      |
        +---------------- API / BFF ------------+
                         |
              Node.js + TypeScript
                 Modular Monolith
                         |
  +----------------------+-----------------------+
  | Identity & Access    | Manager Applications |
  | Organizations        | Basket & Versions    |
  | Asset Registry       | Eligibility/Policy   |
  | Portfolio Ledger     | Pricing & Valuation  |
  | Transition Planner   | Execution Orchestrator|
  | Activity / Indexing  | Reconciliation       |
  +----------------------+-----------------------+
                         |
                  Adapter interfaces
       +-----------------+---------------------+
       |                 |                     |
    Alchemy             0x             RWA / issuer adapters
  RPC/events       swaps/routes          subscriptions, NAV,
       |                 |                settlement, transfers
       +-----------------+---------------------+
                         |
                  Chain-specific adapters
           EVM / Solana / Bitcoin / others
                         |
                 Chains / venues / issuers

 Durable state: PostgreSQL (Supabase-hosted; backend-only access, schema app)
 Sessions: backend-managed (sessions table)
 Cache/rate limits/queues: Redis; background jobs: BullMQ worker (ADR-006, ADR-012); retention: pg_cron
 AI search: Google Gemini (query text only; optional)
 Files: Cloudflare R2
```

## 4. Major modules and responsibilities

### Identity and access
- Wallet connection is a client capability; signature verification and session issuance are backend responsibilities. Sessions are backend-managed (`sessions` table, opaque hashed tokens); Supabase is PostgreSQL only and is not the session issuer (ADR-003).
- Maintain user identity separately from wallet addresses and chain accounts.
- Chain-account association is scoped by verification method: an EOA signature registers all supported EVM chains, ERC-1271/6492 signatures register only the verified chain, and cross-family additions require an explicit logged-in "Add chain account" (ADR-004).
- Release 1 has no user-initiated wallet unlink; compromised addresses are disabled through audited ops commands, and recovery is a future wallet-migration feature.
- Enforce role and resource permissions on the server.
- Support contact verification and notification preferences as separate account concerns.
- Wallet authentication does not imply transaction authority.

### Manager application and organization
- Anyone may apply to become a manager, but application does not grant publication privileges.
- Applications are email-confirmed before they enter the ops queue; the platform team screens them in the web ops area (`/ops`), gated by `platform_roles` (`ops_reviewer`, `ops_admin`), with every action audited (ADR-007).
- The applicant supplies a chain and typed wallet address at application time; it is an identifier only. Wallet control is proven by the normal sign-in signature flow, and a typed address never creates or links a user.
- The narrowly scoped `create_manager_organization` permission is granted when the application is `SCREENING_APPROVED` and the exact address is proven: immediately at approval if a proven user owns it, otherwise inside the sign-in/add-chain transaction (race-safe: the open application is locked by wallet family and address).
- User creates an individual or firm organization (at most one owned organization that is not rejected) and fills template-driven public and private information. Content is versioned as a whole; private documents go to R2 by presigned upload and are readable only by ops. The organization is submitted for platform review in `/ops/organizations` (ADR-008).
- Organization approval, membership verification and basket approval are separate gates.
- Organization is the durable owner/manager context for baskets. Member removal revokes access but preserves history.
- Members: one fixed permission matrix (`ROLE_PERMISSIONS` in `@repo/validator`) is checked server-side on every organization route and only `ACTIVE` memberships grant permissions. Owner/Admin invite by wallet and email; an invite attaches to a user only when the wallet is proven in the sign-in/add-chain transaction (never by a typed address). Admin and Manager members complete their own verification, reviewed by ops in `/ops/members`; exactly one `ACTIVE` `OWNER` is enforced by a partial unique index and ownership moves only through an audited `ops_admin` transfer. Memberships follow one transition table and are never deleted (ADR-009).
- Organization payout wallet is distinct from personal/authentication wallets and requires a Solana signature over a payout-specific challenge; replacement also needs ops approval.
- The public organization profile shows only the current approved version; later edits are change requests reviewed before they replace it.

### Asset registry
Represent:
- **Instrument:** canonical economic identity and asset type.
- **Deployment:** chain-specific token address, mint or other identifier, decimals and status.
- **Route:** provider/venue and permitted action (swap, subscription, secondary market, transfer, redemption), limits and status.
- **Price reference:** source, type, currency, freshness and confidence.
- **Eligibility policy:** applicable user/jurisdiction/route/action rules and effective period.

Implemented in Spec 5 (ADR-010): ops draft, verify, review and activate instruments; signed-in users read `ACTIVE` ones through `/v1/assets`. Managers select only platform-approved instruments. Arbitrary token addresses must not become investable merely by being entered in a basket. The initial scope is crypto, crypto tokens and approved RWAs on supported routes. Future asset categories remain disabled until explicitly approved.

### Basket and versioning
Implemented in Spec 6 (ADR-011); nothing invests, executes or charges yet.
- A basket is a versioned investment strategy owned by a verified organization. The basket (slug, status, current version) and its versions (content) are separate state machines; one open version at a time, editable only as `draft` or `changes_required`.
- New baskets begin as `DRAFT`; drafts are not public. The manager configures identity, thesis, registry instruments with hand-entered target weights, constraints, rebalance disclosures, fees and minimums; platform disclosures come from ops-managed templates pinned per version.
- `validateBasketVersion` (`@repo/validator`) runs in the browser and on the server with stable issue codes; saving reports and never normalizes, submit and publish return 422.
- Submit freezes and content-hashes the version; an `ops_admin` approves (reviewers request changes, reject or escalate); the manager publishes the approved hash. Published versions are immutable; asset rows and disclosure pins are revisioned, never deleted (the runtime role has no DELETE).
- Per-basket assignments (lead, co-manager, flags) gate every action; a departing lead ends assignments and the basket waits in `REASSIGNMENT_REQUIRED` for an ops-approved lead.
- Pause (manager or platform), retirement (manager request, ops decision, or direct) are explicit lifecycle operations. Public `/baskets` pages serve published content only; history, diffs and manager history are kept.

### Portfolio ledger
Maintain separate representations for:
- observed physical wallet/issuer holdings,
- logical allocations to each basket,
- unallocated/manual positions,
- pending/in-flight amounts,
- reserved amounts and applicable liabilities.

If the product selects shared physical holdings with logical basket sub-ledgers, aggregate targets and net changes must be calculated across baskets. Never spend the same physical quantity twice. The custody and attribution model is an open decision and must be locked before implementing final accounting semantics.

### Transition planner
Inputs include current reconciled state, selected basket version, user intent, pricing, eligible routes, balances, reserved amounts, fees, slippage, minimums and pending operations.

The planner:
- calculates target quantities/values from weights and approved valuation;
- compares targets with actual/allocated state;
- nets changes where safe and consistent with the chosen custody model;
- accounts for fees, dust, fractional precision, minimum notionals and cash residuals;
- emits a deterministic plan with explicit steps and assumptions;
- invalidates or recomputes plans when relevant state changes.

Reconciliation, repair, rebalance and customization are different operations. A “Fix” action must make its intended outcome explicit: restore, accept/reallocate, rebalance to a version, or retain customization.

### Execution orchestrator
A user-level operation may contain multiple steps and transactions across chains/providers. Persist the plan, authorization, each step, provider request and transaction separately. Track partial completion. Resume only from verified state; never replay completed steps blindly.

### Activity, indexing and reconciliation
- Ingest provider notifications and chain events.
- Validate, deduplicate and order events where possible.
- Track confirmation/finality and reorg handling per chain.
- Reconcile observed holdings with expected state.
- Update the ledger from verified evidence and retain discrepancies.
- External wallet activity is observation, not proof of user intent to change basket attribution.

### Discovery, performance and AI search
Implemented in Spec 7 (ADR-012). Nothing invests or executes.
- **Worker:** a BullMQ process (`apps/api/src/worker.ts`) runs `price-snapshot` (daily, CoinMarketCap USD per instrument), `basket-performance`, `search-index-refresh`, `embed-basket` and an embedding sweep; services enqueue after commit and swallow queue errors.
- **Index:** `basket_search_index` is a derived, in-place table of listed baskets (exposures, tags, fees, review frequency, manager data, metrics, `tsvector`, `vector(768)`); structured search is one parameterized query over it, with filters carried by one `DiscoveryFilters` schema.
- **Performance:** `computePerformanceDays` (BigInt fixed-point, buy-and-hold per version, fees on net only) writes `basket_performance_days`; `performanceMetrics` derives windows, volatility and drawdown; the public detail shows a downsampled series with the simulated-performance label.
- **AI flow:** query, rate limits, Gemini forced call of `search_baskets` (validated arguments, public index only), then semantic (pgvector) and keyword fallbacks; the response carries the mode and the filters used, never Gemini text.
- **Profiles:** opt-in manager profiles at `/managers/[handle]`; ops can hide; verification badge only from real verifications.

### Pricing and valuation
Implemented (ADR-002): CoinMarketCap market prices are fetched on demand behind `getPrices`, batched, cached in Redis for 60 s and flagged stale after 5 minutes; a missing key or provider failure yields `unavailable`, never an error. Issuer NAV is entered by ops with history and returned as its own entry. There is no price history yet. Keep market price, indicative price, issuer NAV and executable quote distinct. Source priority, provider fallback and valuation freshness policy are still open (D-027). RWA prices and terms may require issuer-specific sources.

## 5. End-to-end user flows

### Discovery and first investment
1. User may explore public baskets without logging in.
2. User opens basket research, manager and organization information.
3. User connects a wallet and authenticates.
4. Backend checks eligibility for the selected instrument/routes and action.
5. User reviews investment amount, target allocation, expected assets, fees, route, risks and estimated outcomes.
6. User explicitly authorizes the operation under the supported authority model.
7. Planner creates operation steps; orchestrator executes them.
8. Indexing and reconciliation verify settlement and update actual portfolio state.
9. UI reports pending, partial, completed or failed status accurately.

### Manager application and organization onboarding
1. Applicant submits the Become a Fund Manager form (with chain and typed wallet address) and confirms their email with a code; they receive a private status link.
2. Platform reviewers screen the application in `/ops`, contacting the applicant outside the app and recording status, internal notes and messages.
3. On approval, the applicant signs in with the exact submitted wallet, which proves control.
4. Narrowly scoped organization-creation permission is granted at that sign-in (or immediately at approval if a proven user already owns the address).
5. The permission is the only outcome of Spec 2; no pending user is ever created.
6. User signs in and creates an individual or firm organization.
7. Organization submits required information and payout wallet.
8. Platform verifies the organization; Owner/Admin invite members, invitees prove their wallet and accept, and Admin/Manager members are verified by the platform before they become active (ADR-009).
9. Approved organization receives appropriate manager capabilities.
10. Basket creation and publication remain separately gated.

### Basket creation and publication
Version: `draft → in_review → changes_required → in_review → approved → published → superseded` (or `rejected`), basket: `DRAFT → ACTIVE ⇄ PAUSED → RETIRED` with `REASSIGNMENT_REQUIRED` and `RETIREMENT_PENDING` side states (`BASKET_TRANSITIONS`, `BASKET_VERSION_TRANSITIONS`). Every transition locks the basket, writes an event and an audit row in one transaction. A draft or unapproved basket is never public or investable.

### Rebalance, skip, drift and fix
- Manager publishes a reviewed basket version and change reason/summary.
- User is notified and chooses whether to apply or skip.
- Applying creates a user-specific transition plan; it does not simply copy manager weights into holdings.
- Skipped versions remain part of history; catch-up behavior must preserve the user's selected target.
- Drift can arise from price movement, external activity, skipped versions, execution failure or RWA settlement.
- Reconcile before planning a fix.
- Fix/repair requires explicit user choice and authorization.
- Coordinate shared-asset discrepancies to avoid duplicate repair trades.
- Reconcile after execution before declaring alignment.

## 6. Multi-chain and asset routing

A basket references instruments, not arbitrary chain addresses. At execution time:
1. Find active deployments.
2. Find supported routes for the requested action.
3. Evaluate user, asset, provider, route and jurisdiction eligibility.
4. Check settlement asset, liquidity, limits, price freshness and route status.
5. Select route(s) and create explicit execution steps.
6. Apply chain-specific signing, submission, confirmation and finality handling.

Do not force an asset onto the user's default chain. Do not assume a bridge exists or is permitted for an RWA. Native BTC, wrapped BTC and tokenized BTC representations are distinct instruments/deployments and must be disclosed accurately.

## 7. Suggested persistence model

Names are indicative; align final names with existing migrations and implementation conventions.

- `users`, `investment_wallets`, `wallet_addresses`, `auth_challenges`, `sessions`, `contacts`, `contact_verifications`, `notification_preferences`
- `manager_applications`, `application_events`, `application_email_codes`, `platform_roles`, `user_permissions`, `verification_cases`, `verification_evidence`
- `organizations`, `organization_versions`, `organization_documents`, `organization_version_documents`, `verification_requirement_templates`, `organization_memberships`, `member_verifications`, `member_verification_documents`, `membership_events`, `organization_payout_wallets`, `organization_events`
- `asset_issuers`, `asset_providers`, `instruments`, `instrument_deployments`, `execution_routes`, `eligibility_rules`, `price_references`, `nav_observations`, `asset_events` (implemented, ADR-010)
- `asset_tags`, `instrument_tags`, `manager_profiles`, `instrument_price_snapshots`, `basket_performance_days`, `basket_search_index` (derived; implemented in Spec 7, ADR-012; `instruments.sector`)
- `baskets`, `basket_slug_aliases`, `basket_versions`, `basket_version_assets` (revisioned), `disclosure_templates`, `basket_version_disclosures` (revisioned), `basket_assignments`, `basket_reviews`, `basket_events` (implemented, ADR-011)
- `user_portfolios`, `wallet_asset_balances`, `basket_positions`, `unassigned_positions`
- `investment_operations`, `operation_steps`, `blockchain_transactions`, `provider_requests`
- `portfolio_activity`, `ledger_entries`, `transition_plans`, `transition_plan_legs`
- `drift_cases`, `shared_asset_shortfalls`, `allocation_decisions`, `valuation_snapshots`
- `audit_events`, `outbox_events`, `idempotency_records`

`audit_events` is append-only and carries no foreign keys, so audit history survives any change to referenced rows.

Unconfirmed (`EMAIL_PENDING`) applications older than 24 h and application email codes resolved more than 90 days ago are purged by the same job. Retention purges run inside Postgres: `app.purge_expired()` is scheduled daily by `pg_cron` and writes a `retention.purged` audit event (ADR-006).

Use foreign keys, unique constraints, check constraints and indexes for invariants that can be enforced in the database. Store quantities and money using exact decimal/numeric representations or integer base units; do not use binary floating point for financial calculations.

## 8. Provider and stack baseline

| Concern | Selected direction |
|---|---|
| Web | Next.js (App Router) + React + TypeScript |
| UI | shadcn/ui + Tailwind; Motion selectively |
| Mobile | Expo SDK 57 + React Native 0.86; `expo-secure-store` for the session token; `jest-expo` for tests |
| Monorepo | Turborepo + pnpm. Internal packages export TypeScript source (`@repo/db`, `@repo/validator`, `@repo/logger`, `@repo/api-client`, `@repo/app-core`, `@repo/design-tokens`); no package build step |
| Backend | Node.js + Express + TypeScript; flat `app.ts`/`server.ts`/`env.ts` with `middleware/`, `routes/`, `services/`, `providers/`; bundled with tsup |
| Database | Supabase PostgreSQL |
| ORM/migrations | Drizzle + Drizzle Kit, in `@repo/db` |
| Cache/rate limits/jobs | Redis with `rate-limiter-flexible` for rate limits; BullMQ (pinned) worker for Spec 7 jobs (price snapshots, performance, search index, embeddings); `pg_cron` for retention |
| AI search | Google Gemini via `@google/genai` (pinned): forced function calling with one read-only tool, and text embeddings (768 dimensions) stored with pgvector; optional key, keyword search without it |
| Wallet UX | Reown AppKit. Web: AppKit with Wagmi and Solana adapters. Mobile: `@reown/appkit-react-native` 2.0.6 with the wagmi adapter (wagmi 2.19.5; `@wagmi/connectors` pinned to 6.2.0 via a root override) for EVM, and the Solana adapter with Phantom and Solflare connectors. On-device connect/sign is pending user verification (D-041). |
| Sessions | Backend-managed sessions table (not Supabase Auth) |
| Validation | Zod (shared `@repo/validator` package) |
| Errors | `http-errors` with a stable `code`; one Express error handler |
| Logging | winston via `@repo/logger` (secrets redacted), morgan request logs |
| Environment | envalid, validated at startup |
| Email OTP | Resend |
| SMS OTP | Twilio Verify (`twilio` SDK pinned to 6.1.1 to satisfy the repo's minimum-release-age policy; no release-age exclusions) |
| Tests | Vitest |
| EVM authentication | SIWE |
| Solana authentication | SIWS |
| Blockchain RPC/events | Alchemy, behind adapters |
| Swaps/cross-chain | 0x where the route is supported |
| Native BTC | Dedicated Bitcoin adapter |
| Crypto prices | CoinMarketCap |
| Files | Cloudflare R2 (private bucket, S3 API via `@aws-sdk/client-s3` behind `providers/r2.ts`; presigned direct upload to `incoming/`, verified copy to `documents/`, ops-only presigned download) |

Current provider capabilities, supported chains, plan limits and commercial terms must be verified against official provider documentation before implementation or release.

## 9. Security, reliability and operational requirements

- Backend authorization is mandatory; never rely on hidden UI controls.
- Verify wallet signatures and consume nonces once.
- Keep secrets and signing material out of frontend/mobile bundles.
- Separate authentication, permission grants and spend authority.
- Require user authorization for every investment, rebalance, repair or withdrawal action as applicable.
- Use idempotency keys for user operations and event handlers.
- Serialize or reserve shared assets before execution.
- Track operation, step, provider request and transaction states separately.
- Handle unknown outcomes, timeouts, partial fills, asynchronous RWA settlement and chain reorgs.
- Use an outbox pattern for reliable publication of internal events.
- Reconcile after execution and periodically.
- Maintain audit history for approvals, membership changes, basket versions and financial operations.
- Client IP integrity: the web tier proxies `/api/*` to the API through a Next.js rewrite that neither sets nor sanitizes `X-Forwarded-For`. The edge/load balancer must overwrite (not append) `X-Forwarded-For` with the real client IP, and the API's `TRUST_PROXY` must trust only the Next server hop (private CIDR, or loopback when co-located). Otherwise per-IP rate limits and session `ip_prefix` are spoofable or global.
- Mobile wallet connectors: Reown's Phantom and Solflare connectors persist their dapp keypair and session in AsyncStorage. This is not the Bytesac session token (which lives in the OS secure store), and every signature still requires explicit approval in the wallet app. Wallet-return deep links are consumed by the wallet SDK and must not drive app navigation.
- Discovery needs the `vector` (pgvector) extension and a running worker with non-evicting Redis; Gemini terms and defaults must be verified before launch (ADR-012).
- Retention depends on the `pg_cron` extension: enable it on Supabase (Dashboard, Database, Extensions) and monitor `cron.job_run_details`.
- Apply least privilege, input validation, rate limits, monitoring, backups and restore drills.
- Obtain jurisdiction-specific legal/compliance review for investment, custody, RWA distribution and fee models.

## 10. Open decisions that must not be silently assumed

1. Custody/execution model: user signs each action, limited delegation, per-user vault, or shared vault.
2. If shared holdings are used, basket allocation and shortage attribution policy.
3. Exact cross-chain routes and whether bridging is permitted for each instrument.
4. RWA acquisition, transfer, redemption and settlement method per issuer/instrument.
5. Price-source hierarchy, freshness limits and fallback behavior.
6. Rebalance thresholds, tolerances, dust handling and residual-cash policy.
7. Fix semantics and whether customization can be retained.
8. Supported chains and asset types for each release.
9. Legal eligibility and KYC requirements by jurisdiction, instrument and action.

Record each decision in `docs/decisions/DECISION-REGISTER.md` and create an ADR for material choices.
