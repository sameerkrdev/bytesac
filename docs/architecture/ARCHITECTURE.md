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
 Async/cache: Redis + BullMQ
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
- Platform team contacts and screens applicants, performs verification, then requests wallet information.
- Verify wallet control through a challenge/signature; a typed address is not proof of ownership.
- If needed, create or associate a user and grant narrowly scoped organization-creation permission.
- User creates an organization; organization is submitted for platform review.
- Organization approval, membership verification and basket approval are separate gates.
- Organization is the durable owner/manager context for baskets. Member removal revokes access but preserves history.
- Organization payout wallet is distinct from personal/authentication wallets and requires ownership verification.

### Asset registry
Represent:
- **Instrument:** canonical economic identity and asset type.
- **Deployment:** chain-specific token address, mint or other identifier, decimals and status.
- **Route:** provider/venue and permitted action (swap, subscription, secondary market, transfer, redemption), limits and status.
- **Price reference:** source, type, currency, freshness and confidence.
- **Eligibility policy:** applicable user/jurisdiction/route/action rules and effective period.

Managers select only platform-approved instruments. Arbitrary token addresses must not become investable merely by being entered in a basket. The initial scope is crypto, crypto tokens and approved RWAs on supported routes. Future asset categories remain disabled until explicitly approved.

### Basket and versioning
- A basket is a versioned investment strategy owned by an approved organization.
- New baskets begin as `DRAFT`; drafts are not publicly investable.
- Manager configures identity, thesis, approved assets, weights, constraints, rebalance settings, disclosures and commercial terms.
- Validate before submission; platform review precedes publication.
- Published versions are immutable snapshots. Changes create a new version and pass the applicable review/publication workflow.
- Preserve historical versions, manager attribution, approvals and investor-facing change summaries.
- Pause, retire and archive are explicit lifecycle operations.

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

### Pricing and valuation
Use CoinMarketCap as the selected primary crypto market-data provider, subject to plan coverage and terms. Normalize prices behind a `PricingService`. Keep market price, indicative price, issuer NAV and executable quote distinct. Enforce freshness and fallback policies. RWA prices and terms may require issuer-specific sources.

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
1. Applicant submits the Become a Fund Manager form.
2. Platform team contacts the applicant and performs initial/basic verification.
3. Platform requests a wallet address and verifies control.
4. Existing user is associated, or a user is created through the approved onboarding flow.
5. Grant narrowly scoped organization-creation permission.
6. User signs in and creates an individual or firm organization.
7. Organization submits required information and payout wallet.
8. Platform verifies the organization and relevant members.
9. Approved organization receives appropriate manager capabilities.
10. Basket creation and publication remain separately gated.

### Basket creation and publication
`DRAFT → VALIDATION → SUBMITTED_FOR_REVIEW → CHANGES_REQUESTED / APPROVED → PUBLISHED`
The exact status names should follow the domain specification and be represented as explicit transitions. A draft or unapproved basket must not be investable.

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
- `manager_applications`, `verification_cases`, `verification_evidence`
- `organizations`, `organization_versions`, `organization_memberships`, `organization_permissions`, `organization_payout_wallets`
- `instruments`, `deployments`, `providers`, `execution_routes`, `price_references`, `eligibility_policies`
- `baskets`, `basket_versions`, `basket_version_assets`, `basket_assignments`, `basket_reviews`
- `user_portfolios`, `wallet_asset_balances`, `basket_positions`, `unassigned_positions`
- `investment_operations`, `operation_steps`, `blockchain_transactions`, `provider_requests`
- `portfolio_activity`, `ledger_entries`, `transition_plans`, `transition_plan_legs`
- `drift_cases`, `shared_asset_shortfalls`, `allocation_decisions`, `valuation_snapshots`
- `audit_events`, `outbox_events`, `idempotency_records`

`audit_events` is append-only and carries no foreign keys, so audit history survives any change to referenced rows.

Use foreign keys, unique constraints, check constraints and indexes for invariants that can be enforced in the database. Store quantities and money using exact decimal/numeric representations or integer base units; do not use binary floating point for financial calculations.

## 8. Provider and stack baseline

| Concern | Selected direction |
|---|---|
| Web | Next.js (App Router) + React + TypeScript |
| UI | shadcn/ui + Tailwind; Motion selectively |
| Mobile | Expo SDK 57 + React Native 0.86; `expo-secure-store` for the session token; `jest-expo` for tests |
| Monorepo | Turborepo + pnpm |
| Backend | Node.js + Express + TypeScript |
| Database | Supabase PostgreSQL |
| ORM/migrations | Drizzle + Drizzle Kit |
| Async/cache | Redis + BullMQ |
| Wallet UX | Reown AppKit. Web: AppKit with Wagmi and Solana adapters. Mobile: `@reown/appkit-react-native` 2.0.6 with the wagmi adapter (wagmi 2.19.5; `@wagmi/connectors` pinned to 6.2.0 via a root override) for EVM, and the Solana adapter with Phantom and Solflare connectors. On-device connect/sign is pending user verification (D-041). |
| Sessions | Backend-managed sessions table (not Supabase Auth) |
| Validation | Zod (shared contracts package) |
| Email OTP | Resend |
| SMS OTP | Twilio Verify (`twilio` SDK pinned to 6.1.1 to satisfy the repo's minimum-release-age policy; no release-age exclusions) |
| Tests | Vitest |
| EVM authentication | SIWE |
| Solana authentication | SIWS |
| Blockchain RPC/events | Alchemy, behind adapters |
| Swaps/cross-chain | 0x where the route is supported |
| Native BTC | Dedicated Bitcoin adapter |
| Crypto prices | CoinMarketCap |
| Files | Cloudflare R2 |

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
