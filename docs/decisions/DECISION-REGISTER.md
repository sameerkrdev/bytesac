# Architecture Decision Register

**Status key:** `APPROVED` = explicit direction in supplied project material; `PROPOSED` = current architecture direction but not fully locked; `OPEN` = requires product/technical decision.

| ID | Topic | Current direction | Status / notes |
|---|---|---|---|
| D-001 | User identity | User account is distinct from wallet addresses and organization identity. | APPROVED in supplied auth/onboarding specs |
| D-002 | Normal user wallet model | One active investment wallet per normal user, with chain accounts/addresses associated to it; additional independent wallets are a separate concept. | APPROVED in supplied auth flow; preserve its exact constraints |
| D-003 | Wallet authentication | Reown AppKit for wallet connection; backend verifies SIWE (EVM) / SIWS (Solana) signatures and issues backend-managed sessions. Supabase is PostgreSQL only, not the session issuer. | APPROVED by user 2026-09-29 (supersedes "Supabase session" in `docs/source/User-Authentication-Flow.txt`); ADR-003 |
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
| D-021 | Frontend | Next.js (App Router) + React, Tailwind v4, shadcn/ui; Motion and 3D only selectively. Expo for mobile. Turborepo + pnpm monorepo. | SELECTED |
| D-022 | Physical custody/accounting model | Options include user wallet, delegated authority, per-user vault or shared vault. Shared physical positions require logical sub-ledgers and coordinated netting. | OPEN — lock before execution/accounting implementation |
| D-023 | Shared asset shortage policy | Must explicitly define restore, accept/reallocate, customization and allocation attribution. | OPEN |
| D-024 | Spend authority | Chain-specific authority/delegation design must define assets, limits, duration, revocation and signing model. | OPEN/track in dedicated authority ADR |
| D-025 | Eligibility | Evaluate user + instrument + provider + route + jurisdiction + action; not one global KYC boolean. | APPROVED architectural direction; legal policy values open |
| D-026 | RWA execution | Per-instrument routes may include subscription, secondary market, transfer or redemption; async settlement must be modeled. | OPEN per instrument/provider |
| D-027 | Pricing hierarchy | Define source priority, freshness, fallback and distinctions between market, indicative, NAV and execution quote. | OPEN |
| D-028 | Rebalance and Fix semantics | Distinguish reconciliation, repair, rebalance and customization; no silent asset movement. | APPROVED principle; exact policies open |

| D-029 | Platform name | Bytesac. | APPROVED by user |
| D-030 | Initial settlement currency | USDC on Solana; design for future expansion to additional currencies. | APPROVED by user |
| D-031 | Sessions | Opaque 32-byte token, HMAC-hashed at rest. Web: httpOnly cookie via same-origin Next proxy, 12 h idle / 7 d absolute. Mobile: bearer in secure storage (sent with header `X-Client: mobile`), 7 d idle / 30 d absolute. No rotation on renewal; rotation on security events (add chain account); a revoked session cannot be rotated. DB-time expiry checks. | APPROVED; ADR-003 |
| D-032 | Release-1 auth chains | Solana (SIWS) + EVM (SIWE) on Ethereum, Base, BNB Chain, Arbitrum. | APPROVED |
| D-033 | Chain-account association | Verification method decides scope: ECDSA-recovered EOA proof registers all supported EVM chains; ERC-1271/6492 register only the verified chain (RPC transport failure is retryable `VERIFIER_UNAVAILABLE`, never an invalid signature); cross-family additions only via explicit logged-in "Add chain account" (serialized per wallet); different same-family address refused. | APPROVED; ADR-004 |
| D-034 | OTP providers | Email via Resend with backend-generated HMAC-hashed OTP; SMS via Twilio Verify. Behind adapters. | APPROVED |
| D-035 | API contracts & topology | Zod schemas in `packages/contracts`; typed `packages/api-client`; web calls the API through a same-origin Next rewrite; API sends no CORS headers. Challenge request body is `{ purpose, chain, address }` (chain family derived from chain). | APPROVED |
| D-036 | Test runner | Vitest (+ Supertest; `jest-expo` for mobile smoke tests). | APPROVED |
| D-037 | Sign-in challenge lifecycle | `pending → processing (30 s lease) → consumed / rejected`; no transaction held during RPC; consumption atomic with account linking and session creation. | APPROVED |
| D-038 | Database access model | Backend-only DB access; schema `app` not exposed via Supabase Data API; roles `bytesac_api` (DML, no DELETE), `bytesac_retention`, migrations by schema owner (Supabase `postgres`; local superuser); RLS enabled with role-scoped permissive policies (no `BYPASSRLS`); default privileges revoked from PUBLIC/anon/authenticated. | APPROVED; ADR-005 |
| D-039 | Wallet unlink & recovery (release 1) | No user-initiated unlink; ops-only audited disable/reactivate; recovery via future wallet migration. | APPROVED |
| D-040 | Data retention | Challenges 7 days after expiry (except those referenced as address evidence); sessions and contact verifications 90 days; audit events 7 years proposed. | APPROVED except audit period: OPEN pending compliance |

## How to update
When a decision is explicitly locked, update the status and add an ADR for consequential architecture decisions. Retain superseded decisions for traceability.
