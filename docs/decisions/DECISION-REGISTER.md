# Architecture Decision Register

One line per decision. Detail lives in the linked ADR; decisions without an ADR are fully stated here. Superseded decisions are rewritten in place (git history keeps the old text).

**Status:** `APPROVED` = explicit product-owner direction; `IMPLEMENTED` = approved and built; `SELECTED` = stack choice made; `PROPOSED` = current direction, not locked; `OPEN` = needs a decision; `PARTIAL` = decided in part, remainder open.

| ID | Area | Decision | Status | ADR |
|---|---|---|---|---|
| D-001 | Identity | A user account is distinct from wallet addresses and organization identity. | APPROVED | |
| D-002 | Wallet model | One active investment wallet per normal user with chain accounts associated to it; additional independent wallets are a separate, future concept. | APPROVED | ADR-004 |
| D-003 | Auth | Reown AppKit connects wallets; the backend verifies SIWE (EVM) / SIWS (Solana) and issues its own sessions; Supabase is PostgreSQL only. | APPROVED | ADR-003 |
| D-004 | Manager onboarding | Public application with email confirmation, ops screening, then sign-in with the exact submitted wallet grants `create_manager_organization`; a typed address never creates or links a user. | APPROVED | ADR-007 |
| D-005 | Organization | The organization is the durable manager entity (versioned profile, one owned non-rejected organization per creator, exactly one `OWNER`); only `ACTIVE` memberships carry permissions. | APPROVED | ADR-008, ADR-009 |
| D-006 | Payout wallet | A separate Solana payout wallet per organization, `VERIFIED` only by a signature over a payout-specific challenge; replacement needs a new signature plus ops approval; history kept. | APPROVED | ADR-008 |
| D-007 | Basket creation | A basket starts as a `DRAFT` with version 1, is validated server-side, reviewed by ops, then published by the manager. | IMPLEMENTED | ADR-011 |
| D-008 | Basket versioning | Content lives in immutable-once-submitted, hashed versions (one open version; publish refused if the approved hash differs; a change is a new version with a rationale and a computed diff). | IMPLEMENTED | ADR-011 |
| D-009 | Asset scope | Initial scope is crypto, stablecoins and approved RWAs recorded in the registry; asset chains are separate from auth chains and recording a chain does not make it executable. | IMPLEMENTED | ADR-010 |
| D-010 | Asset model | Instrument, chain deployment and execution route are separate records, with rules and price references on the instrument; one non-retired deployment per `(chain, address)`. | IMPLEMENTED | ADR-010 |
| D-011 | Asset approval | Only ops onboard assets (`ops_reviewer` drafts, `ops_admin` decides; the submitter cannot decide); managers select only `ACTIVE` registry entries. | IMPLEMENTED | ADR-010 |
| D-012 | Chain data | Alchemy is the RPC/data provider behind adapters (EVM, Solana, Bitcoin UTXO REST); Bitcoin response shapes are a pre-launch check. | SELECTED | ADR-014 |
| D-013 | Routing | LI.FI is the only route provider, behind a `RouteProvider` abstraction; every quote is validated against the leg and delivers to the user's own address. | APPROVED | ADR-014 |
| D-014 | Native Bitcoin | Native BTC and UTXO behavior sit behind a separate Bitcoin adapter. | IMPLEMENTED | ADR-014 |
| D-015 | Pricing | CoinMarketCap is the crypto price provider (Redis 60 s, stale after 5 min, missing key or failure = `unavailable`) plus one USD snapshot per instrument per UTC day with no backfill. | IMPLEMENTED | ADR-002, ADR-012 |
| D-016 | RWA data | CoinMarketCap plus issuer-specific data initially; RWA.xyz optional if deeper coverage is needed. | PROPOSED | |
| D-017 | Persistence | Supabase PostgreSQL with Drizzle; schema, client and migrations live in `packages/db`. | SELECTED | ADR-006 |
| D-018 | Cache and jobs | Redis for rate limits, cache and BullMQ; background work runs in a separate worker process, retention in `pg_cron`; jobs never move money. | APPROVED | ADR-006, ADR-012 |
| D-019 | Object storage | Cloudflare R2, private bucket, presigned direct upload then server-side confirm, ops-only short-lived downloads, no malware scanner in release 1. | SELECTED | ADR-008 |
| D-020 | Backend shape | Node + Express + TypeScript modular monolith organized as feature modules (route, controller, service), errors as `http-errors` with a stable `code`, winston logging, envalid config, internal packages exporting TypeScript source. | SELECTED | ADR-001, ADR-006 |
| D-021 | Frontend | Next.js App Router with Tailwind v4 and shadcn/ui; Expo for mobile; Turborepo + pnpm monorepo. | SELECTED | |
| D-022 | Custody | Self-custody: assets stay in the user's own wallets, the platform holds no keys or funds, and basket positions are a logical sub-ledger reconciled against chain balances. | APPROVED | ADR-013 |
| D-023 | Shortfalls | A wallet shortfall is allocated pro-rata (`SHORT`) and blocks rebalance until the user resolves it per asset with Buy back or a user-edited Sync. | APPROVED | ADR-013, ADR-015 |
| D-024 | Spend authority | No delegation: every transaction is signed by the user against a reviewed plan of legs; sign-in or publication never authorizes spending. | APPROVED | ADR-013 |
| D-025 | Eligibility | A pure engine evaluates user, instrument, route, jurisdiction, investor status and action; RWAs are denied by default and rule values (legal policy) are still to be entered by ops. | APPROVED; rule values OPEN | ADR-018 |
| D-026 | RWA execution | Release 1 offers only permissionless secondary-market RWA tokens through LI.FI; issuer subscription and redemption are future plans. | APPROVED | ADR-018 |
| D-027 | Pricing hierarchy | Market price and issuer NAV stay distinct entries; source priority between providers, indicative prices and executable quotes remain to be defined. | PARTIAL; hierarchy OPEN | ADR-002, ADR-012 |
| D-028 | Rebalance semantics | Reconciliation, repair, rebalance and customization are distinct; a rebalance is a manager version a holder applies or skips with explicit consent, never replaying skipped versions. | IMPLEMENTED | ADR-011, ADR-015 |
| D-029 | Platform name | Bytesac. | APPROVED | |
| D-030 | Settlement currency | USDC on Solana first, designed for later currency expansion. | APPROVED | |
| D-031 | Sessions | Opaque HMAC-hashed tokens (web httpOnly cookie via same-origin proxy, 12 h idle / 7 d absolute; mobile bearer in secure storage, 7 d / 30 d), rotated on security events only. | APPROVED | ADR-003 |
| D-032 | Auth and linkable chains | Sign-in chains are Solana plus EVM (Ethereum, Base, BNB Chain, Arbitrum); Bitcoin is linkable but never a sign-in method. | APPROVED | ADR-004, ADR-014 |
| D-033 | Chain-account association | The verification method decides scope (EOA proof registers all EVM chains, ERC-1271/6492 only the verified chain, cross-family only via logged-in add-chain, Bitcoin via BIP-322 or BIP-137). | APPROVED | ADR-004, ADR-014 |
| D-034 | OTP providers | Email OTP via Resend and SMS via Twilio Verify, behind provider modules. | APPROVED | |
| D-035 | API contracts | Zod schemas in `@repo/validator`, a typed `@repo/api-client`, shared client logic in `@repo/app-core`, same-origin Next rewrite, no CORS headers. | APPROVED | |
| D-036 | Test runner | Vitest with Supertest (and `jest-expo` for mobile smoke tests). | APPROVED | |
| D-037 | Sign-in challenge | `pending → processing (30 s lease) → consumed / rejected`, no transaction held during RPC, consumption atomic with linking and session creation. | APPROVED | ADR-003 |
| D-038 | Database access | Backend-only access to schema `app` as role `bytesac_api` (DML, no DELETE) with RLS and revoked default privileges; retention by `app.purge_expired()` under pg_cron. | APPROVED | ADR-005, ADR-006 |
| D-039 | Wallet unlink | No user-initiated unlink in release 1; ops-only audited disable/reactivate; recovery via future wallet migration. | APPROVED | |
| D-040 | Data retention | Short retention for challenges, sessions, OTPs and unconfirmed applications (daily pg_cron purge); audit events kept 7 years (proposed). | APPROVED; audit period OPEN | ADR-005, ADR-006 |
| D-041 | Mobile wallet stack | Reown AppKit React Native with the wagmi adapter for EVM and Phantom/Solflare for Solana, session token in `expo-secure-store`; Android device run 2026-10-09: MetaMask (EVM only over WalletConnect) and Trust Wallet (EVM + Solana) connect, sign in and Add chain account verified; Phantom/Solflare and transaction signing still unverified. | APPLIED; device check PARTIAL | ADR-003 |
| D-042 | Ops and platform roles | A minimal `/ops` area; staff hold `ops_reviewer` or `ops_admin` read from the database on every request; every ops action is audited. | APPROVED | ADR-007 |
| D-043 | Applicant communication | Contact happens outside the app; applicants get status emails and a private status page behind a secret HMAC-hashed link. | APPROVED | ADR-007 |
| D-044 | Application abuse protection | Email-code confirmation before the ops queue, rate limits per IP and email, no captcha in release 1. | APPROVED | ADR-007 |
| D-045 | Requirement templates | Required fields and documents per organization type come from a seeded template table (most specific type and jurisdiction wins), with no editor UI. | APPROVED | ADR-008 |
| D-046 | Profile versioning | Organization content is versioned as a whole; approval switches the public version and the public profile never shows pending content. | APPROVED | ADR-008 |
| D-047 | Document safety | PDF/JPEG/PNG up to 10 MB with declared type and size re-checked on confirm, stored `not_scanned`, ops-only attachment downloads, soft-unlinked. | APPROVED | ADR-008 |
| D-048 | Permission matrix | One fixed `ROLE_PERMISSIONS` matrix in `@repo/validator` for the built-in roles, enforced server-side on every organization route; custom roles narrow or extend it within D-114. | APPROVED | ADR-009, ADR-019 |
| D-049 | Member verification | `ADMIN` and `MANAGER` become `ACTIVE` only after ops approve their own verification; `ANALYST` and `VIEWER` need wallet proof and acceptance only. | APPROVED | ADR-009 |
| D-050 | Ownership transfer | Ops-only, to an active member with an approved verification; the old owner becomes `ADMIN`; exactly one active `OWNER` is enforced by an index. | APPROVED | ADR-009 |
| D-051 | Public team | Opt-in public name and title with role and dates on a verified organization's profile; wallets, emails and ids are never shown. | APPROVED | ADR-009 |
| D-052 | Invite linking | An invitation names a wallet and email and activates only when that wallet is proven in a sign-in or add-chain transaction; invites expire after 14 days. | APPROVED | ADR-009 |
| D-053 | Asset chains | `ASSET_CHAINS` (Solana, Ethereum, Base, BNB, Arbitrum, Polygon, Bitcoin) are separate from auth chains; on-chain verification only for EVM ERC-20 chains and Solana SPL. | APPROVED | ADR-010 |
| D-054 | Deployment verification | EVM metadata via Alchemy/viem and Solana decimals via `getTokenSupply`; a mismatch blocks submit and approval, a transport failure is 503 and stores nothing. | APPROVED | ADR-010 |
| D-055 | Asset lifecycle | The instrument is the review unit (`DRAFT → UNDER_REVIEW → APPROVED → ACTIVE ⇄ PAUSED → DEPRECATED → RETIRED`); identity locks once approved and history is never deleted. | APPROVED | ADR-010 |
| D-056 | Asset read API | Signed-in users read only `ACTIVE` entries through an explicit allow-list, never rules, review notes or actor ids. | APPROVED | ADR-010 |
| D-057 | Basket access | Org `baskets.manage` plus per-basket `lead` / `co_manager` assignments with flags `edit`, `submit`, `publish`, `lifecycle`, `assign`, enforced server-side per action with an assignment lockdown. | APPROVED | ADR-011 |
| D-058 | Basket fee caps | Percent fees 0 to 100 bps and fixed fees or subscription at most 1% of the minimum investment, with an optional USDC cap on percent fees; entry and rebalance fees are collected, management and subscription fees are disclosed only. | APPROVED; caps OPEN | ADR-011, ADR-016 |
| D-059 | Disclosure templates | Mandatory platform notices are ops-managed versioned templates pinned to each basket version and never removable by managers. | APPROVED; copy OPEN | ADR-011 |
| D-060 | Manager leaves | An ineligible membership ends its assignments; a published basket without an active lead becomes `REASSIGNMENT_REQUIRED` and a new lead needs ops approval. | APPROVED | ADR-011 |
| D-061 | Public basket pages | `/baskets` and `/baskets/[slug]` need no sign-in and expose published content only, with old slugs redirecting. | APPROVED | ADR-011 |
| D-062 | Discovery search | Filters live in one URL param with a keyset cursor and are served from a derived `basket_search_index` refreshed by queue jobs. | APPROVED | ADR-012 |
| D-063 | AI search | Gemini forced tool-calling over one read-only `search_baskets` tool with semantic then keyword fallbacks; queries are never stored. | APPROVED; Gemini terms to confirm | ADR-012 |
| D-064 | Model performance | Simulated buy-and-hold of each version's weights from daily snapshots, net of fees, always shown with the simulated-performance label. | APPROVED; wording OPEN | ADR-012 |
| D-065 | Manager profiles | One opt-in plain-text profile per user with self-reported fields and a "Verified by Bytesac" badge only while an active verified membership or ownership exists. | APPROVED | ADR-012 |
| D-066 | Sector and tags | One ops-set sector per instrument from a fixed list plus ops-managed filter tags. | APPROVED; sector list OPEN | ADR-012 |
| D-067 | Network fee leg | Gas is recovered through a user-signed USDC transfer on Solana to the gas treasury (estimate x 1.2, minimum 0.01, no refund) that is part of the amount the user enters. | APPROVED; legal review OPEN | ADR-014, ADR-016 |
| D-068 | Platform gas and caps | Platform wallets hold platform funds only; Solana legs are fee-payer co-signed, EVM legs get one gas drop, and per-user and global daily caps are reserved at plan time. | APPROVED; caps and KMS OPEN | ADR-014 |
| D-069 | Investability and eligibility | A basket is investable only when every constituent has an active deployment, route and (for RWAs) market price, and the user has verified contacts, linked chains and no other open operation. | APPROVED | ADR-014, ADR-018 |
| D-070 | Position ledger | Positions are an append-only sub-ledger reconciled nightly and on portfolio read; unknown leg outcomes are re-checked and never resubmitted. | APPROVED | ADR-014 |
| D-071 | Sell fee order and claims | A sell's network fee is first when the wallet holds it in USDC, otherwise last (Solana-only sells), a leg is claimed before anything is sent, and ops can resolve `UNKNOWN` legs from chain evidence. | APPROVED | ADR-014 |
| D-072 | Gas budget lifecycle | Reservations are released exactly once on every terminal path and on Stop, and the fee payer co-signs only byte-identical, fee-and-rent-only transactions. | APPROVED | ADR-014 |
| D-073 | Price-move guard | A fresh leg quote whose minimum is below the plan's minimum is 409 `PRICE_MOVED`. | APPROVED | ADR-014 |
| D-074 | Bitcoin PSBT limits | Quoted PSBTs allow segwit/Taproot inputs only, a bounded miner fee, a required refund output, and the signed PSBT must spend exactly the quoted inputs. | APPROVED | ADR-014 |
| D-075 | Ledger from chain | A leg is ledgered only from chain evidence, never from a provider-reported amount. | APPROVED | ADR-014, ADR-017 |
| D-076 | Rebalance hub | A rebalance sells reduced assets to USDC on Solana then buys increased assets from it, scaling buys to the cash that actually arrived. | APPROVED | ADR-015 |
| D-077 | Trade thresholds | Trades under 50 bps or 5 USDC are skipped (per-version overrides allowed); no trades left means the version is recorded without an operation. | APPROVED | ADR-015 |
| D-078 | Basket cash | Unspent sale proceeds live in an append-only basket cash ledger spent before free USDC and reconciled against wallet USDC. | APPROVED | ADR-015 |
| D-079 | Rebalance fee placement | The fee leg goes first when free USDC covers it, otherwise between sells and buys for Solana-only sells, otherwise the plan is refused. | APPROVED | ADR-015, ADR-016 |
| D-080 | Repair and sync | One repair operation per short deployment covers every affected basket, and sync reconciles first and refuses a stale split. | APPROVED | ADR-015 |
| D-081 | Position states and drift | Version, backing, allocation and execution are separate derived states with one headline; drift defaults to 500 bps and Keep custom silences prompts. | APPROVED | ADR-015 |
| D-082 | Skip, continue, invalidation | A skip is one decision per position and version, Continue plans anew with a new fee, and publishing a newer version cancels untouched planned rebalances. | APPROVED | ADR-015 |
| D-083 | Notifications | Every event is an inbox row then email and FCM web push after commit, gated by preferences and never failing the business transaction; mobile push is deferred. | APPROVED | ADR-015 |
| D-084 | Adoption counts | Managers see per-version applied, skipped, in-progress and not-responded counts with each cell masked "<5" for 1 to 4. | APPROVED; joint masking OPEN | ADR-015 |
| D-085 | Fee recipients | Manager fees go straight to the verified payout wallet and platform fees to a revenue treasury; Bytesac never holds manager money. | APPROVED | ADR-016 |
| D-086 | Fee math | Fees are BigInt micro-USDC computed from the plan's base per operation type; fees under 0.01 USDC or without a price are waived. | APPROVED | ADR-016 |
| D-087 | Platform fee schedules | Versioned default and organization/basket override schedules per operation type, edited only by `ops_admin`, effective for new plans. | APPROVED; rates OPEN | ADR-016 |
| D-088 | Fee terms | Entry and rebalance fees are collected; management fee and subscription are disclosed but not collected in this release. | APPROVED | ADR-016 |
| D-089 | Combined fee leg | One user-signed `network_fee` leg carries the network, manager and platform transfers in one server-built transaction. | APPROVED | ADR-016 |
| D-090 | Fee timing and refunds | Fees are charged first on the planned amount and are not refunded when an operation ends `PARTIAL`, `FAILED` or is stopped. | APPROVED | ADR-016 |
| D-091 | Waived manager fees | A missing verified payout wallet waives the manager fee, never blocks the user, and warns ops and the owner. | APPROVED | ADR-016 |
| D-092 | Earnings and reconciliation | Owner/Admin see earnings and ops see revenue (both with CSV), and a daily job reconciles settled platform fees with treasury inflows. | APPROVED | ADR-016 |
| D-093 | Estimates | `RouteProvider.estimate` plans rebalance buys and LI.FI 1001 cases without a balance and authorizes nothing; gas top-ups happen at quote time within caps. | APPROVED | ADR-017 |
| D-094 | `SOL_REQUIRED` | A Solana wallet without SOL gets 409 `SOL_REQUIRED`; no platform SOL drop in release 1. | APPROVED | ADR-017 |
| D-095 | Mayan and contracts | A contract-code EVM destination denies every bridge whose tool key starts with `mayan`. | APPROVED | ADR-017 |
| D-096 | Recovery leg | A leg that delivered a different token gets one user-signed, chain-sized recovery leg inside the same operation, with refund messaging from LI.FI substatus. | APPROVED | ADR-017 |
| D-097 | Price-impact limit | Every estimate and quote sends `maxPriceImpact = 0.05` and a refusal is 503 `ROUTE_UNAVAILABLE`. | APPROVED | ADR-017 |
| D-098 | Route deny list | `ops_admin` can deny or allow a LI.FI bridge or exchange, audited, applied as deny lists on every estimate and quote. | APPROVED | ADR-017 |
| D-099 | Route fees and ops tools | LI.FI route fees are stored per leg, with a read-only transfer lookup, a token verification badge and a fee-on-transfer flag for ops. | APPROVED | ADR-017 |
| D-100 | Eligibility declarations | Users declare country and investor status with a versioned attestation; rows are append-only and expire after 365 days. | APPROVED; wording OPEN | ADR-018 |
| D-101 | Geo signal | The header named by `GEO_COUNTRY_HEADER` is the IP country, trusted only when set, and a mismatch gives `REVIEW_REQUIRED`. | APPROVED | ADR-018 |
| D-102 | Rule evaluation | The most specific rule tier wins and the strictest outcome wins within a tier; no rule means RWA `RESTRICTED`, and crypto is not enforced. | APPROVED | ADR-018 |
| D-103 | Enforcement and exits | Buys of non-`ALLOWED` RWAs are refused, holdings are never force-sold, and sells leave out RWAs the user may not sell and sell the rest. | APPROVED | ADR-018 |
| D-104 | RWA pricing | An RWA is investable only with an `ACTIVE` CoinMarketCap market price reference; NAV is display only. | APPROVED | ADR-018 |
| D-105 | Permissioned tokens | A `permissioned` deployment is never investable in release 1. | APPROVED | ADR-018 |
| D-106 | Token-2022 RWAs | Token-2022 accounts are read like SPL, transfer-fee extensions are not read (use `feeOnTransfer`), and a real-RPC check is open. | Ruling (controller); real-RPC check OPEN | ADR-018 |
| D-107 | Price-impact backstop | The server checks the real price impact itself and refuses above 5% regardless of LI.FI. | APPROVED | ADR-014, ADR-017 |
| D-108 | Gas reservation lifecycle | Reservations release on every terminal status and Stop, and a refused drop is never retried automatically. | APPROVED | ADR-014 |
| D-109 | Recovery auto-stop | An operation whose recovery leg stays `PLANNED` for 7 days is stopped automatically and the user is notified. | APPROVED | ADR-017 |
| D-110 | Position close | A position auto-closes at zero and can be dust-closed under $1 with no transaction. | APPROVED | ADR-014, ADR-015 |
| D-111 | Non-investable held assets | A rebalance needs investability only for assets it buys, and ops get a daily alert when an instrument becomes non-investable. | APPROVED | ADR-015, ADR-018 |
| D-112 | Revenue bucketing | Revenue reconciliation buckets by chain settlement time. | APPROVED | ADR-016 |
| D-113 | Draft revision lock | Basket drafts carry an integer `revision` and a stale `expectedRevision` is 409 `VERSION_CONFLICT`. | APPROVED | ADR-011 |
| D-114 | Custom roles | Organizations may define roles on a built-in base role: write permissions only from the base, read grants (analytics, earnings) addable, owner-only permissions never; applied only while the base matches; owner defines, members.manage assigns. | IMPLEMENTED | ADR-019 |
| D-115 | Uploaded files | Logos and basket files use presign, server-side byte checks and signed reads; logos (PNG/JPEG/WebP) are set by ops, registry logo first then a vendored CC0 icon pack. | IMPLEMENTED | ADR-019 |
| D-116 | Basket files | PDF files attach to the open basket version, freeze at submit, carry to the next draft, count in the content hash and show on the public page for the published version. | IMPLEMENTED | ADR-019 |
| D-117 | Discovery rails | Featured is ops-ranked (active baskets); Trending is distinct new investors in 30 days, at least 5, counts never shown; Suggested uses the user's held categories. | IMPLEMENTED | ADR-019 |
| D-118 | Mobile push | Mobile push goes through the Expo push service with the inbox title and body, opt-in per device; `push_tokens` gains platform and provider (supersedes "mobile push is deferred" in D-083). | IMPLEMENTED | ADR-020 |

## How to update
When a decision is explicitly locked, set its status and put the detail in an ADR for consequential architecture decisions; keep the register line to one sentence.
