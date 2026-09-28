# Architecture Decision Register

**Status key:** `APPROVED` = explicit direction in supplied project material; `PROPOSED` = current architecture direction but not fully locked; `OPEN` = requires product/technical decision.

| ID | Topic | Current direction | Status / notes |
|---|---|---|---|
| D-001 | User identity | User account is distinct from wallet addresses and organization identity. | APPROVED in supplied auth/onboarding specs |
| D-002 | Normal user wallet model | One active investment wallet per normal user, with chain accounts/addresses associated to it; additional independent wallets are a separate concept. | APPROVED in supplied auth flow; preserve its exact constraints |
| D-003 | Wallet authentication | Reown/WalletConnect for connection; backend verifies signatures and manages account/session flow. | APPROVED direction; exact SIWE/SIWS implementation details require validation |
| D-004 | Manager onboarding | Application → team contact/screening/verification → request and verify wallet → associate/create user and grant scoped org-creation permission → user creates org → platform verifies org. | APPROVED in supplied onboarding flow |
| D-005 | Organization as durable manager entity | Organization owns/represents basket business context; membership grants user authority. | APPROVED in supplied onboarding flow |
| D-006 | Payout wallet | Separate organization payout resource, not the personal/authentication wallet; ownership verification required. | APPROVED in supplied onboarding flow |
| D-007 | Basket creation | New basket starts as DRAFT, is validated and submitted for platform review; not investable before approval/publication. | APPROVED in supplied basket spec |
| D-008 | Basket versioning | Published strategy updates are versioned; user participation in rebalances is explicit. | APPROVED direction |
| D-009 | Asset scope | Initial scope: crypto, crypto tokens and approved RWAs on supported chains. Future categories remain future scope. | APPROVED scope; exact chain/asset enablement may vary |
| D-010 | Universal asset model | Separate economic instrument, chain deployment and execution route. | APPROVED architectural principle in asset/portfolio specs |
| D-011 | Asset approval | Managers choose from platform-approved registry entries; arbitrary addresses cannot become investable. | APPROVED |
| D-012 | Chain data | Alchemy is the selected provider for supported RPC/event/data needs; adapter boundary is recommended. | PROPOSED/selected stack; verify coverage per chain |
| D-013 | Swap routing | 0x for supported swap and cross-chain routes; support is route-specific. | PROPOSED; verify current provider coverage and terms |
| D-014 | Native Bitcoin | Separate Bitcoin adapter for native BTC and UTXO behavior. | PROPOSED |
| D-015 | Pricing | CoinMarketCap selected as primary crypto market-data provider. | SELECTED by latest user instruction; verify plan/terms |
| D-016 | RWA data | CoinMarketCap plus issuer-specific data initially; RWA.xyz optional if deeper coverage is needed. | PROPOSED |
| D-017 | Persistence | Supabase PostgreSQL with Drizzle ORM/migrations. | SELECTED by user |
| D-018 | Cache/jobs | Redis + BullMQ for transient cache and background processing; PostgreSQL remains durable source of truth. | PROPOSED |
| D-019 | Object storage | Cloudflare R2. | SELECTED in stack discussion |
| D-020 | Backend shape | Node.js + Express + TypeScript, modular monolith initially. | SELECTED/proposed baseline |
| D-021 | Frontend | React, shadcn/ui; Motion and 3D only selectively. Expo for mobile. Turborepo + pnpm monorepo. | SELECTED/proposed baseline |
| D-022 | Physical custody/accounting model | Options include user wallet, delegated authority, per-user vault or shared vault. Shared physical positions require logical sub-ledgers and coordinated netting. | OPEN — lock before execution/accounting implementation |
| D-023 | Shared asset shortage policy | Must explicitly define restore, accept/reallocate, customization and allocation attribution. | OPEN |
| D-024 | Spend authority | Chain-specific authority/delegation design must define assets, limits, duration, revocation and signing model. | OPEN/track in dedicated authority ADR |
| D-025 | Eligibility | Evaluate user + instrument + provider + route + jurisdiction + action; not one global KYC boolean. | APPROVED architectural direction; legal policy values open |
| D-026 | RWA execution | Per-instrument routes may include subscription, secondary market, transfer or redemption; async settlement must be modeled. | OPEN per instrument/provider |
| D-027 | Pricing hierarchy | Define source priority, freshness, fallback and distinctions between market, indicative, NAV and execution quote. | OPEN |
| D-028 | Rebalance and Fix semantics | Distinguish reconciliation, repair, rebalance and customization; no silent asset movement. | APPROVED principle; exact policies open |

| D-029 | Platform name | Bytesac. | APPROVED by user |
| D-030 | Initial settlement currency | USDC on Solana; design for future expansion to additional currencies. | APPROVED by user |

## How to update
When a decision is explicitly locked, update the status and add an ADR for consequential architecture decisions. Retain superseded decisions for traceability.
