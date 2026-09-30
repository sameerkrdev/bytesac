# ADR-010: Asset registry (instruments, deployments, routes, rules, price references)

- **Status:** APPROVED
- **Date:** 2026-09-30
- **Owners:** Backend / Platform
- **Related:** D-009, D-010, D-011, D-015, D-025, D-027, D-053, D-054, D-055, D-056; ADR-002, ADR-005, ADR-007, ADR-008; `docs/superpowers/specs/2026-09-30-asset-registry-design.md`

## Context
Baskets, portfolios and execution all need a platform-approved inventory of investable assets. An economic asset can live on several chains, be reachable through several providers, and carry jurisdiction-specific restrictions; a token address typed by a user must never become investable by being entered. Nothing in this release executes, signs, broadcasts or moves assets.

## Decision
| Topic | Decision |
|---|---|
| Registry model | Five records: **instrument** (economic identity: name, symbol, type, issuer, risk notes, links), **deployment** (chain, token standard, canonical address or null for native, decimals, verification evidence), **execution route** (provider, venue, method, settlement instrument, minimum, processing model), **eligibility rule** (jurisdiction, action, outcome, KYC and transfer text, source) and **price reference** (CoinMarketCap id for market prices; `issuer` reference for NAV). Issuers and providers are shared reference records. A deployment is never interchangeable with another; rules and price references attach to the instrument (a rule may name a route). |
| Asset chains | `ASSET_CHAINS` in `@repo/validator`: `solana`, `ethereum`, `base`, `bnb`, `arbitrum`, `polygon`, `bitcoin`. It is independent of the wallet-auth `CHAINS` (D-032), which is unchanged. Recording a chain does not make it executable. |
| Verification | Ethereum, Base, BNB Chain and Arbitrum ERC-20s: `decimals`, `symbol`, `name` read through the existing Alchemy/viem provider (one multicall). Solana SPL: mint `decimals` from Alchemy Solana JSON-RPC `getTokenSupply`; symbol and name are ops-entered. Native assets and every Polygon or Bitcoin deployment are `manual` and need an https `source_url` confirmed by the reviewer. A non-token (revert, invalid mint) is stored as observed `null` and fails the requirements check. A transport failure is 503 `VERIFIER_UNAVAILABLE` and stores nothing. Decimals that differ from the chain block submit and approval. There is no scheduled re-verification. Verify is allowed only on `DRAFT` on-chain deployments (a manual deployment answers 409) and is limited to 30 per hour per ops user; the rate-limit point is taken before the provider call and is not refunded on a 503. Editing a draft deployment's chain, standard or address re-reads the chain and is refused with 409 if the row changed meanwhile. |
| Uniqueness | One non-retired deployment per `(chain, address)` across the whole registry (canonical address: EVM lowercase, Solana base58 32 bytes), so the same token cannot be registered twice under another instrument or case (409 `DEPLOYMENT_EXISTS`); it can be registered again after the old one is retired. One native deployment per instrument and chain. |
| Lifecycle | Instrument: `DRAFT → UNDER_REVIEW → APPROVED \| CHANGES_REQUIRED`, `APPROVED → ACTIVE ⇄ PAUSED`, `ACTIVE \| PAUSED → DEPRECATED → RETIRED`, abandon to `RETIRED` from `DRAFT`, `CHANGES_REQUIRED` or `APPROVED` (`INSTRUMENT_TRANSITIONS`). Deployments and routes: `DRAFT → APPROVED → ACTIVE ⇄ PAUSED`, any non-retired item to `RETIRED` (`ASSET_ITEM_TRANSITIONS`). Approving an instrument approves its draft items; activating it activates its approved items. An item added to an approved instrument stays `DRAFT` until an admin approves and activates it, while the instrument stays readable. A status applies at its own level; pausing nothing cascades down, but users see an item only when the instrument and the item are both `ACTIVE`. Every transition locks the instrument row and writes an `asset_events` row and an audit row in one transaction; history is never deleted. |
| Submit requirements | At least one non-retired deployment; every on-chain deployment observed decimals equal entered decimals; every manual deployment has a source URL; `CRYPTO` and `STABLECOIN` need an `ACTIVE` market price reference; tokenized types need an issuer, at least one non-retired route and at least one `ACTIVE` rule. Failing is 422 `REQUIREMENTS_INCOMPLETE` with stable `details.missing` keys (`ASSET_REQUIREMENT_KEYS`), checked again at approval. |
| Locked fields | After a deployment leaves `DRAFT`: chain, standard, address and decimals are immutable. After a route leaves `DRAFT`: deployment, method, provider and settlement instrument are immutable. After an instrument is approved: symbol and asset type are immutable. A change is 409 `INVALID_TRANSITION` "Retire this item and add a new one to change it." Descriptive fields stay editable (audited, no review). |
| Read-only states | Every ops edit or addition (details, deployments, routes, rules, price references, NAV, verify) is refused with 409 while the instrument is `UNDER_REVIEW` (the admin decides on what was submitted) or `RETIRED`. Item actions are refused in the same states. Retired deployments, routes and rules are read-only. The ops UI disables these controls. |
| Retirement cascade | Retiring an instrument also retires its non-retired deployments and routes (a retired instrument cannot be edited, so the tokens would otherwise stay registered and block re-registration forever). Rules are not touched. The spec text "nothing cascades down" applies to pausing only. |
| Ops separation of duties | `ops_reviewer` creates, edits and submits. Only `ops_admin` decides and runs instrument and item lifecycle actions. The admin who submitted the current review cannot decide it (403 `FORBIDDEN` "You can't review a submission you made.", checked under the row lock). Item approval has no submitter rule (admin role only). Managers cannot propose assets. |
| Pricing | See ADR-002. Market (CoinMarketCap) and NAV (ops-entered, with history) stay distinct; `minimum_amount` and NAV values are exact decimal strings; a market price is a display-grade decimal string made from the provider float (see ADR-002). |
| Session read API | `GET /v1/assets` and `GET /v1/assets/:id` (session required) expose an explicit allow-list built from explicit column lists: `ACTIVE` instruments with at least one `ACTIVE` deployment in the list, and for detail the name, symbol, type, description, issuer name and website, risk notes, links, `ACTIVE` deployments (chain, standard, address, decimals), routes whose own deployment is also `ACTIVE` (chain, method, provider name, settlement symbol while that instrument is `ACTIVE`, minimum, processing model) and prices. Never rules, review messages, internal notes, observed metadata, actor ids or non-active items. Paused or deprecated instruments answer 404. An `ACTIVE` instrument without an `ACTIVE` deployment answers 200 with empty deployments but is not listed. |
| Data | Nine tables (`asset_issuers`, `asset_providers`, `instruments`, `instrument_deployments`, `execution_routes`, `eligibility_rules`, `price_references`, `nav_observations`, `asset_events`), migration `0007_assets.sql`; runtime role has SELECT, INSERT and UPDATE only, RLS `api_all`, no DELETE (ADR-005). Partial unique indexes enforce the uniqueness rules and one `ACTIVE` price reference per instrument and kind. No assets are seeded. |
| Clients | Web only: `/ops/assets` list, create page and editor. Mobile is unchanged. No manager screens. |

## Consequences
- The basket spec can select only `ACTIVE` instruments and deployments through the read API; it still has to block new selection of deprecated assets and keep references to retired ones readable.
- A route or rule is a record: nothing evaluates eligibility or executes through a route yet.
- Verification is point-in-time at entry or re-verify; a token whose on-chain metadata changes later is not detected.
- Reviewers can add rules and price references to a live instrument, which are audited but not separately approved.

## Deviations recorded during implementation
- `minimum_amount` and NAV `value` are unconstrained `numeric`, so the entered text round-trips unchanged.
- `createDeploymentRequestSchema` also rejects `erc20` on non-EVM chains and `spl*` off Solana.
- Rules are created `ACTIVE`; `RETIRED` is terminal. Issuers and providers have no instrument, so their changes write an audit row only; a duplicate name is 400 `VALIDATION_FAILED`.
- A market price converts to a decimal string without an exponent (up to 18 fraction digits).
- The ops editor has no edit form for deployments and routes (add, re-verify, approve, activate, pause, resume, retire only): a wrong draft is retired and re-added. Route settlement choices list the first page of instruments.

## Open items
- CoinMarketCap plan, rate limits, attribution and terms; the response shape and the Alchemy Solana endpoint must be checked with real keys before launch.
- Polygon on-chain verification and a Bitcoin data provider.
- RWA issuer terms and legal eligibility values per jurisdiction (compliance).
- Eligibility engine (first-investment spec); executable quotes and routing (execution specs).
- Price history and valuation snapshots (needs a job queue).
- Cross-chain route pairs and bridge policy.
- First assets for ops to onboard: SOL, USDC (Solana, Ethereum, Base), ETH, BTC.
