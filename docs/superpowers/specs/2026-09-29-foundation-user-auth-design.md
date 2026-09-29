# Spec 1 — Foundation + User Authentication (Design)

- **Date:** 2026-09-29
- **Status:** Approved in brainstorming; pending written-spec review
- **Series:** Spec 1 of 4 — (1) Foundation + user auth, (2) Manager application + screening, (3) Organization onboarding, (4) Members/roles (later)
- **Build quality:** Production foundation (real providers, built to keep)

## 1. Intent

Deliver a production-grade foundation for Bytesac and a working wallet-based sign-in on web and mobile:

- A new backend (`apps/api`) with database, sessions, contacts and audit.
- Shared contracts and a typed API client used by both clients.
- The BYTESAC design system wired into web (`apps/web`) and mobile (`apps/mobile`).
- Minimal, fully functional UI: sign in, verify wallet, add contact (skippable), home placeholder, profile/settings.

**Success criteria**

1. A user can connect a Solana or EVM wallet, sign a challenge, and receive a session on web and on mobile.
2. The same address signing in again logs into the same user; a new address signing in while logged out creates a new user.
3. A logged-in user can add a chain account of the other chain family through an explicit action.
4. A user can add and verify email (OTP) and phone (OTP), or skip.
5. A user can edit notification preferences, list/revoke sessions, log out, and log out all devices.
6. Session expiry forces wallet re-authentication.
7. All server rules are enforced server-side and covered by tests; docs are updated in place.

## 2. Decisions made in this brainstorm

| Topic | Decision |
|---|---|
| Session issuer | **Backend-managed `sessions` table.** Supabase is used only as PostgreSQL, not as the auth/session issuer. Supersedes "Supabase session" in `docs/source/User-Authentication-Flow.txt` and prior D-003 wording. |
| Session transport | Web: opaque token in `HttpOnly; Secure; SameSite=Lax` cookie via same-origin Next proxy. Mobile: same opaque token as bearer, stored in `expo-secure-store`. Server stores only a hash. |
| Session lifetime | Web: 12 h idle / 7 d absolute. Mobile: 7 d idle / 30 d absolute. Sliding idle renewal; logout revokes; "log out all devices". |
| Release-1 auth chains | Solana (SIWS) + EVM (SIWE) on Ethereum, Base, BNB Chain, Arbitrum. |
| Chain-account association | Within a chain family, one proof registers all supported chains of that family (one SIWE signature registers 4 EVM chain rows). Cross-family addition only via explicit logged-in "Add chain account" with a fresh signature from the new address. Refused if the address belongs to another user, or if the user already has an address in that family (that would be an independent wallet — future feature). Logged-out sign-in with an unknown address always creates a new user. |
| OTP providers | Email: Resend, backend-generated OTP (HMAC-hashed). Phone: Twilio Verify. Both behind adapters. |
| Code structure | Express API + `packages/contracts` (Zod) + `packages/api-client` + Next rewrite proxy (Approach 1). |
| Schema library | Zod. |
| Test runner | Vitest (+ Supertest for HTTP; `jest-expo` for mobile smoke tests). |

## 3. Out of scope

Manager application, screening, organizations, payout wallet, members/roles, wallet migration, multiple independent wallets, basket discovery, investing, and eligibility enforcement beyond storing contact verification status.

## 4. Data model (`apps/api`, Drizzle ORM, Supabase PostgreSQL)

Conventions: UUIDv7 primary keys; `timestamptz`; status columns are Postgres enums with transitions enforced in the domain layer; no hard deletes (status changes/timestamps instead).

### 4.1 Tables

**`users`**
- `id`, `status` enum(`pending`, `active`, `suspended`), `created_at`, `updated_at`.
- Sign-in creates `active` users. `pending` is reserved for the Spec 2 manager flow.

**`investment_wallets`**
- `id`, `user_id` → users, `wallet_provider` (text; client-reported label, informational only, never identity), `status` enum(`active`, `inactive`), `created_at`.
- Partial unique index: one `active` wallet per `user_id`.

**`wallet_addresses`**
- `id`, `investment_wallet_id` → investment_wallets, `chain_family` enum(`evm`, `solana`), `chain` enum(`ethereum`, `base`, `bnb`, `arbitrum`, `solana`), `address`, `verified_at`, `created_at`.
- Unique `(chain, address)` globally — an address cannot belong to two users.
- Check constraint: `chain` is consistent with `chain_family`.
- Address canonicalization: EVM lowercase hex; Solana base58 as-is (validated as a 32-byte public key).

**`auth_challenges`**
- `id`, `nonce` (128-bit random, unique), `purpose` enum(`sign_in`, `add_chain_account`), `chain_family`, `chain`, `address`, `domain`, `uri`, `chain_id` (EVM numeric / Solana cluster id), `issued_at`, `expires_at` (issued + 5 min), `consumed_at`, `session_id` (nullable; required for `add_chain_account`).
- Consumed exactly once: `UPDATE … SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING *`.

**`sessions`**
- `id`, `user_id`, `token_hash` (SHA-256 of token + pepper, unique), `client` enum(`web`, `mobile`), `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `revoke_reason` enum(`logout`, `logout_all`, `user_revoked`, `admin`), `user_agent`, `ip_prefix` (/24 IPv4, /48 IPv6).
- Raw token (32 random bytes, base64url) never stored.

**`contacts`**
- `id`, `user_id`, `type` enum(`email`, `phone`), `value` (email lowercased/trimmed; phone E.164), `status` enum(`unverified`, `verified`, `replaced`), `verified_at`, `created_at`.
- Partial unique index: one non-`replaced` contact per `(user_id, type)`.
- Not unique across users (contact is not identity; avoids account-existence leakage).
- Changing a contact sets the old row to `replaced` and inserts a new `unverified` row.

**`contact_verifications`**
- `id`, `contact_id`, `channel` enum(`email`, `sms`), `provider_ref` (Twilio Verify SID; null for email), `code_hash` (HMAC-SHA256 with `OTP_HMAC_SECRET`; email only), `attempts` (int), `expires_at` (created + 10 min), `consumed_at`, `created_at`.
- Max 5 attempts; after that the verification is dead and a new send is required.

**`notification_preferences`**
- `user_id` (PK) → users, booleans: `rebalance` (default true), `portfolio_updates` (true), `manager_updates` (true), `offers` (false), `product_updates` (false), `marketing` (false), `updated_at`.
- Security/account notifications are not configurable and are not stored here.
- Row created at sign-up.

**`audit_events`**
- `id`, `actor_user_id` (nullable), `action` (string literal union in code), `entity_type`, `entity_id`, `metadata` jsonb (no secrets), `created_at`. Append-only.
- Actions in this spec: `user.signed_up`, `user.signed_in`, `wallet.chain_account_added`, `session.revoked`, `session.revoked_all`, `contact.added`, `contact.replaced`, `contact.verified`, `notification_preferences.updated`.

### 4.2 Notes

- "Email and phone verified before investing" (User-Detailed-Features §8–9) is derived from `contacts` by a future eligibility check; no flag is stored now.
- Rate-limit counters live in Redis, not PostgreSQL.

## 5. Authentication flows

**Rule:** the server builds the message to sign. On verify, the server rebuilds it from the stored challenge and verifies the signature against that exact text; it never trusts a client-supplied message.

### 5.1 Sign in (signup or login)

1. Client connects a wallet via Reown AppKit. UI shows "Connected" as a distinct step from "Sign to verify" (connection is not authentication).
2. `POST /v1/auth/challenge { purpose: "sign_in", chainFamily, chain, address }` → server validates chain/address, stores a challenge, returns `{ challengeId, message }`.
   - EVM: EIP-4361 (SIWE) message.
   - Solana: SIWS (CAIP-122 style) message.
   - Both include `domain` (`AUTH_DOMAIN`), `uri` (`AUTH_URI`), nonce, issuedAt, expirationTime (+5 min), chain id, and the statement: *"Sign in to Bytesac. This does not authorize any transaction or spending."*
3. Wallet signs the message.
4. `POST /v1/auth/verify { challengeId, signature, walletProvider, client }`:
   1. In one DB transaction: consume the challenge atomically (§4.1); rebuild the message; check domain/uri/expiry/purpose.
   2. Verify the signature:
      - EVM: `viem` `verifyMessage` using a per-chain public client from the `EvmRpc` adapter (Alchemy). Supports EOA and smart-contract wallets (EIP-1271 / EIP-6492).
      - Solana: ed25519 verify (`@noble/curves`) with the base58-decoded public key.
   3. Look up `(chain, address)`:
      - **Found:** load the user; user must be `active` (else `USER_NOT_ACTIVE`).
      - **Not found:** create user (`active`), investment wallet (`active`), address rows (4 for EVM: ethereum, base, bnb, arbitrum; 1 for Solana), notification preferences; write `user.signed_up`.
   4. Create a session (§5.3); write `user.signed_in`.
   5. Response `{ user, isNewUser }`. Web: `Set-Cookie: bx_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/`. Mobile (`client: "mobile"`): token returned in body.
5. New users are routed to the skippable Add contact step.

### 5.2 Add chain account (authenticated)

- Same challenge → sign → verify flow with `purpose: "add_chain_account"`. The challenge stores the current `session_id`; verify requires the same session.
- Outcomes:
  - Address already on this user → idempotent success.
  - Address owned by another user → `409 ADDRESS_ALREADY_LINKED` (no merge).
  - User already has an address in that chain family → `409 CHAIN_FAMILY_ALREADY_LINKED`.
  - Otherwise → insert address rows for all supported chains of that family into the user's active investment wallet; write `wallet.chain_account_added`.

### 5.3 Sessions

- Create: generate 32 random bytes; store `token_hash`; set `idle_expires_at` and `absolute_expires_at` per client (web 12 h / 7 d; mobile 7 d / 30 d).
- `requireSession` middleware on every protected route: read cookie or `Authorization: Bearer`; hash; load session; reject (`401 SESSION_EXPIRED`) if revoked, idle-expired or absolute-expired; reject (`401 USER_NOT_ACTIVE`) if user not active; set `req.auth = { userId, sessionId }`.
- Sliding renewal: update `last_seen_at` and `idle_expires_at` (capped at `absolute_expires_at`) at most once per 5 minutes per session.
- `POST /v1/auth/logout` revokes the current session; `POST /v1/auth/logout-all` revokes all of the user's sessions; `DELETE /v1/me/sessions/:id` revokes one own session.
- Logout does not change the investment wallet, its addresses, or their relationship to the user.

### 5.4 CSRF (cookie path)

- Cookie is `SameSite=Lax`.
- Mutating requests authenticated by cookie require `Origin` in `ALLOWED_ORIGINS` and header `X-Requested-With: bytesac`; otherwise `403 CSRF_REJECTED`.
- Bearer-authenticated requests are exempt.

### 5.5 Contacts and OTP

- `POST /v1/me/contacts { type, value }`: validate/normalize; replace any existing non-`replaced` contact of that type; create `unverified` contact; send OTP.
  - Email: generate 6-digit code (CSPRNG), store HMAC hash, send via Resend (`EmailSender` adapter).
  - Phone: start Twilio Verify (`SmsOtpProvider` adapter), store `provider_ref`.
- `POST /v1/me/contacts/:id/verify { code }`: check ownership, expiry, attempts; email compares HMAC in constant time; phone calls Twilio Verify check. Success → contact `verified`, verification consumed, audit `contact.verified`.
- `POST /v1/me/contacts/:id/resend`: 60 s cooldown; creates a new verification.
- Contact step is skippable; available later in Settings.

### 5.6 Rate limits (Redis, `RateLimiter` adapter)

- Challenge issuance: per IP and per address.
- Verify: per IP.
- OTP send: 5/hour per user plus per-IP cap; 60 s resend cooldown.
- Exceeded → `429 RATE_LIMITED` with `Retry-After`.

## 6. Code structure

```
apps/api/                     Express 5 + TypeScript (new)
  src/app.ts, src/server.ts   app factory (testable) + listener
  src/config/env.ts           Zod-validated env; fail fast at boot
  src/db/schema/*.ts          Drizzle tables (identity.ts, contacts.ts, audit.ts)
  src/db/migrations/          drizzle-kit generated, reviewed, committed
  src/modules/identity/
    domain/                   message builders, address canonicalization, session expiry rules
    application/              SignInService, AddChainAccountService, SessionService
    infra/                    Drizzle repositories, signature verifiers
    http/                     routes/controllers (thin), requireSession, CSRF guard
  src/modules/contacts/       contacts, OTP, notification preferences (same layering)
  src/adapters/               EvmRpc (Alchemy), SolanaSignatureVerifier, EmailSender (Resend),
                              SmsOtpProvider (Twilio Verify), RateLimiter (Redis)
  src/shared/                 DomainError, error mapper, audit writer, pino logger (redacted)
packages/contracts/           Zod schemas, inferred types, ErrorCode union (no server deps)
packages/api-client/          typed fetch client; transport: cookie (web) | bearer (mobile)
packages/design-tokens/       BYTESAC colors, semantic colors, radii, font names (TS consts)
```

Dependency direction: `http → application → domain`; `infra`/`adapters` implement interfaces defined in `application`/`domain`. Provider SDKs are imported only inside `src/adapters`.

## 7. API surface

All routes under `/v1`; all bodies/params/queries validated with Zod schemas from `packages/contracts`.

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /auth/challenge` | none; session for `add_chain_account` | Issue challenge + message |
| `POST /auth/verify` | none / session | Sign in or add chain account |
| `POST /auth/logout` | session | Revoke current session |
| `POST /auth/logout-all` | session | Revoke all sessions |
| `GET /me` | session | User, investment wallet, addresses, contact statuses |
| `GET /me/sessions` | session | Active sessions |
| `DELETE /me/sessions/:id` | session | Revoke own session (status change, not row deletion) |
| `POST /me/contacts` | session | Add/replace contact, send OTP |
| `POST /me/contacts/:id/verify` | session | Verify OTP |
| `POST /me/contacts/:id/resend` | session | Resend OTP |
| `GET /me/notification-preferences` | session | Read preferences |
| `PATCH /me/notification-preferences` | session | Update preferences |
| `GET /health` | none | Liveness + DB/Redis readiness |

**Error shape:** `{ "error": { "code": ErrorCode, "message": string, "details"?: unknown } }`.

**Error codes:** `VALIDATION_FAILED`, `UNSUPPORTED_CHAIN`, `CHALLENGE_NOT_FOUND`, `CHALLENGE_EXPIRED`, `CHALLENGE_CONSUMED`, `SIGNATURE_INVALID`, `VERIFIER_UNAVAILABLE`, `ADDRESS_ALREADY_LINKED`, `CHAIN_FAMILY_ALREADY_LINKED`, `SESSION_EXPIRED`, `USER_NOT_ACTIVE`, `CSRF_REJECTED`, `NOT_FOUND`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `OTP_COOLDOWN`, `OTP_DELIVERY_FAILED`, `RATE_LIMITED`, `INTERNAL`.

**Authorization:** every `/me/*` query is scoped by `req.auth.userId`, never by a client-supplied user id. Access to another user's session/contact returns `404 NOT_FOUND`.

**Configuration** (documented in `apps/api/.env.example` without values): `DATABASE_URL`, `REDIS_URL`, `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET`, `ALCHEMY_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `AUTH_DOMAIN`, `AUTH_URI`, `ALLOWED_ORIGINS`, `PORT`. Client public config only: `NEXT_PUBLIC_REOWN_PROJECT_ID`, `API_ORIGIN` (Next server-side rewrite target), `EXPO_PUBLIC_REOWN_PROJECT_ID`, `EXPO_PUBLIC_API_URL`.

**Local development:** `docker-compose.yml` with PostgreSQL 17 and Redis. Deployed environments use Supabase PostgreSQL. Turbo tasks for `api`: `dev`, `build`, `test`, `lint`, `check-types`; scripts `db:generate`, `db:migrate`.

## 8. UI

### 8.1 Design-system wiring

- `packages/design-tokens` is the shared TS source of palette, semantic colors, radii and font names, matching `docs/BYTESAC_Design_System.md` exactly.
- Web: replace the create-turbo starter page and styles; Tailwind CSS v4 (CSS-first) + shadcn/ui; `globals.css` per design system §11–12; Manrope + Inter via `next/font/google`; dark only (remove light `prefers-color-scheme` rules).
- Mobile: remove Expo template tabs/demo components; NativeWind theme per design system §13; Manrope + Inter via `@expo-google-fonts/manrope`, `@expo-google-fonts/inter` + `expo-font`; force dark theme.
- Logo: `docs/logo.png` used as supplied (no redraw/recolor); replace with an approved SVG when available.
- Icons: `lucide-react` (web), `lucide-react-native` (mobile). No emoji icons.

### 8.2 Screens (web and mobile)

1. **Welcome / Sign in** — logo, H1 "Welcome to Bytesac", one line of body copy, primary `Connect wallet`. Banner when redirected with `reason=expired`.
2. **Verify wallet** — stepper (✓ Connected → Sign to verify); wallet name, chain badge, shortened address with copy control; explainer card: *"You're signing a message to prove you control this address. It does not authorize any transaction or spending."*; `Sign message`; states: awaiting signature, user rejected (retry), challenge expired (restart), signature invalid, verifier unavailable (retry), rate limited, network error; `Disconnect`.
3. **Add contact** (new users; skippable) — labeled email and phone fields, each with `Send code` → 6-digit OTP input with resend countdown; field-level errors; entered values preserved; helper text "Required later before investing."; `Skip for now`.
4. **Home (placeholder)** — web top nav with Home and Profile only; mobile bottom tabs Home and Profile. Empty state: "You're signed in. Basket discovery arrives soon." No fabricated financial data.
5. **Profile / Settings** —
   - **Wallet:** investment wallet; address rows per chain with chain badges; `Add chain account` (reuses screen 2 with `add_chain_account`); disabled with explanation when both families are linked.
   - **Contacts:** email/phone with Verified/Unverified badges (text + icon); `Change`.
   - **Notifications:** six toggles; note that security notices are always sent.
   - **Sessions:** device/client/last seen; `Revoke`; `Log out all devices` (confirmation dialog).
   - **Log out.**

### 8.3 Routing, guards and wallet layer

- Web: App Router groups `(public)` and `(app)`; `next.config.js` rewrites `/api/:path*` to `API_ORIGIN`; `(app)` layout calls `GET /v1/me` via the proxy; `401` → `/sign-in?reason=expired`. UI guards are UX only; the API enforces authorization.
- Mobile: expo-router groups `(auth)` and `(app)`; auth context loads the token from SecureStore on boot; `401` clears the token and routes to `(auth)`.
- Wallet layer: web uses Reown AppKit with Wagmi (EVM) and Solana adapters; mobile uses Reown AppKit React Native with EVM and Solana. Each app wraps the SDK behind a `WalletConnector` interface (`connect`, `disconnect`, `getAccount`, `signMessage`); screens never import the SDK directly. Exact package versions and Expo SDK 57 compatibility must be verified against current Reown documentation during planning.

### 8.4 Accessibility

44×44 minimum touch targets; 2 px `mint` focus ring; accessible names on icon buttons; reduced motion respected; status never conveyed by color alone; WCAG AA contrast.

## 9. Error handling

- Controllers parse input and call services; services throw typed `DomainError(code)`; one Express error mapper produces the stable error shape and HTTP status. Unknown errors → `500 INTERNAL`; details logged server-side only.
- Logging: pino with redaction. Never log session tokens, signatures, OTP codes, full email/phone, or API keys. Addresses logged shortened.
- Signature verification infra failure (e.g. Alchemy timeout during EIP-1271 check) → `503 VERIFIER_UNAVAILABLE`; the DB transaction rolls back so the challenge is not consumed and the user can retry. A definitively invalid signature consumes the challenge.
- OTP provider failure → `503 OTP_DELIVERY_FAILED`; does not count toward the user's send quota.
- Clients map each `ErrorCode` to fixed copy and a recovery action (retry, restart sign-in, re-authenticate).

## 10. Testing

Vitest throughout; Supertest for HTTP; integration tests use real PostgreSQL and Redis (docker-compose) with fake provider adapters. Test signatures come from throwaway keys (viem `privateKeyToAccount`, generated ed25519 keypairs); never production wallets.

- **Unit (domain):** SIWE/SIWS message build; address canonicalization; session idle/absolute expiry for web and mobile; contact state transitions; invalid transitions rejected.
- **Integration:**
  - Sign-up creates user, active wallet, 4 EVM address rows (1 Solana) and preferences in one transaction; repeat sign-in creates no new user.
  - Reused nonce → `CHALLENGE_CONSUMED`; concurrent double verify → exactly one session.
  - Expired challenge; domain mismatch; signature from a different key; wrong purpose.
  - Verifier outage → `VERIFIER_UNAVAILABLE` and challenge still usable.
  - Add chain account: idempotent same-user; `ADDRESS_ALREADY_LINKED`; `CHAIN_FAMILY_ALREADY_LINKED`; challenge bound to another session rejected.
  - Sessions: expired idle, expired absolute, revoked, suspended user → 401; sliding renewal capped at absolute; logout-all; revoking another user's session → 404.
  - CSRF: missing Origin or header on cookie path → 403; bearer path unaffected.
  - OTP: correct code; wrong code; attempts exceeded; expired; resend cooldown; send rate limit; replace keeps history; delivery failure not counted.
  - Audit events written for every listed action; no secrets in metadata.
- **Contracts / client:** schema tests; api-client tests with mocked fetch for both transports.
- **UI:** web component tests (Vitest + Testing Library) for the verify-wallet stepper states and OTP form; mobile smoke tests with `jest-expo`.
- **Manual end-to-end:** Phantom (Solana) and MetaMask (EVM) on web and mobile against the dev stack before completion.
- **Gates:** format, lint, `check-types`, all tests via turbo.

## 11. Documentation updates (in the same change, rewritten in place)

- `docs/decisions/DECISION-REGISTER.md`: rewrite D-003 (backend-managed sessions; Supabase = PostgreSQL only); rewrite D-021 to name Next.js (App Router) for web; add D-031 session model and lifetimes, D-032 release-1 auth chains, D-033 chain-account association rule, D-034 OTP providers (Resend, Twilio Verify), D-035 Zod shared contracts + Next same-origin proxy, D-036 Vitest.
- New `docs/decisions/ADR-003-BACKEND-SESSIONS.md` and `docs/decisions/ADR-004-CHAIN-ACCOUNT-ASSOCIATION.md`.
- `docs/architecture/ARCHITECTURE.md`: rewrite §3 system context, §4 Identity and access, §7 persistence names (`investment_wallets`, `wallet_addresses`, `auth_challenges`, `sessions`, `contacts`, `contact_verifications`, `notification_preferences`, `audit_events`), §8 stack table (Next.js, Resend, Twilio Verify, Zod, Vitest; session issuer).
- `docs/domains/USER-AUTHENTICATION.md`: rewrite Authentication, Identity model and Sessions sections; state that the backend session decision supersedes the source's Supabase-session wording.
- `docs/engineering/CODING-STANDARDS.md`: schema library = Zod; test runner = Vitest.
- `docs/README.md`: add `docs/superpowers/specs/` to the index.
- `docs/source/*` remain verbatim.
- New `apps/api/README.md`: setup, env, migrations, tests.

## 12. Risks and follow-ups

- Reown AppKit React Native compatibility with Expo SDK 57 / React Native 0.86 is unverified; confirm during planning. Fallback: keep the `WalletConnector` interface and use wallet-specific deep-link SDKs.
- EIP-1271/6492 verification depends on Alchemy RPC availability per chain; outages degrade smart-wallet sign-in only.
- Twilio Verify country coverage and pricing must be confirmed for target jurisdictions.
- Session cookie relies on the Next proxy being same-origin; deployment must preserve this topology.
- Spec 2 will introduce `users.status = pending` activation via wallet proof and the `can_create_manager_organization` grant; this spec's `users.status` enum already includes `pending`.
