# Spec 1 — Foundation + User Authentication (Design)

- **Date:** 2026-09-29
- **Status:** Approved (written spec approved 2026-09-29)
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
3. A logged-in user can add a chain account of the other chain family (or, for a smart-contract EVM wallet, the same address on another EVM chain) through an explicit action.
4. A user can add and verify email (OTP) and phone (OTP), or skip.
5. A user can edit notification preferences, list/revoke sessions, log out, and log out all devices.
6. Session expiry forces wallet re-authentication.
7. All server rules are enforced server-side and covered by tests; docs are updated in place.

## 2. Decisions made in this brainstorm

| Topic | Decision |
|---|---|
| Session issuer | **Backend-managed `sessions` table.** Supabase is used only as PostgreSQL, not as the auth/session issuer. Supersedes "Supabase session" in `docs/source/User-Authentication-Flow.txt` and prior D-003 wording. |
| Session transport | Web: opaque token in `HttpOnly; Secure; SameSite=Lax` cookie via same-origin Next proxy. Mobile: same opaque token as bearer, stored in `expo-secure-store`, sent with header `X-Client: mobile`. Server stores only a hash. |
| Session lifetime | Web: 12 h idle / 7 d absolute. Mobile: 7 d idle / 30 d absolute. Sliding idle renewal; logout revokes; "log out all devices". |
| Release-1 auth chains | Solana (SIWS) + EVM (SIWE) on Ethereum, Base, BNB Chain, Arbitrum. |
| Chain-account association | **Verification method decides scope.** EVM signature that ECDSA-recovers to the address (EOA, including EIP-7702-delegated EOAs) proves the key and registers all 4 supported EVM chains from one proof. ERC-1271 (deployed contract wallet) or ERC-6492 (undeployed/counterfactual) signatures register **only the chain verified**; other EVM chains for the same address need their own per-chain verification via "Add chain account". Solana ed25519 registers `solana`. Cross-family addition only via explicit logged-in "Add chain account" with a fresh signature. Refused if the address belongs to another user, or if the user already has a **different** address in that family (independent wallet — future feature). Logged-out sign-in with an unknown address always creates a new user. Method and evidence (challenge id, verified chain) are stored per address row. |
| Challenge verification | Challenge state machine `pending → processing → consumed / rejected`, with a short processing lease. No DB transaction is held open during RPC verification. Transient verifier failure releases the claim for retry; definitive invalid signature → `rejected`; success consumes the challenge in the same transaction that links the account and creates the session. |
| Session security | No token rotation on sliding renewal (avoids concurrent-request races); token rotation on security events (successful add chain account). DB-time expiry checks on every request, no session caching, so logout/suspension take effect immediately; suspension revokes all sessions. Suspicious-activity policy for release 1: visibility (sessions list), audit, manual revoke; automated detection deferred. |
| CSRF / CORS | API sends **no CORS headers** (web is same-origin via Next proxy; mobile is native), so browsers cannot call the API cross-origin. Cookie-authenticated mutations and `/auth/verify` (login CSRF) require an allowlisted `Origin` (missing Origin rejected) and `X-Requested-With: bytesac`. |
| Wallet unlink & recovery (release 1) | **No user-initiated unlink.** Every user keeps ≥1 verified address. Compromised/inaccessible wallet → platform ops disables the address (`disabled`) and revokes sessions via an audited ops command; recovery/replacement is the future wallet-migration feature. Reactivation only by ops, audited. |
| Database authorization | Backend is the only DB client. Tables in a dedicated `app` schema not exposed through Supabase Data API; `anon`/`authenticated` have no grants; RLS enabled with role-scoped policies as defense-in-depth against accidental exposure. API connects as least-privilege role `bytesac_api` (DML on `app` only); migrations run as the schema-owner role. Authorization is enforced in the application layer; every protected query is scoped by the session's `userId`. |
| Data retention | Expired/consumed/rejected challenges purged after 7 days (except those referenced as address evidence); revoked/expired sessions and contact verifications after 90 days; audit events retained 7 years (OPEN: confirm with compliance per jurisdiction). Purge by a scheduled BullMQ job. |
| OTP providers | Email: Resend, backend-generated OTP (HMAC-hashed). Phone: Twilio Verify. Both behind adapters. |
| Code structure | Express API + `packages/contracts` (Zod) + `packages/api-client` + Next rewrite proxy (Approach 1). |
| Schema library | Zod. |
| Test runner | Vitest (+ Supertest for HTTP; `jest-expo` for mobile smoke tests). |

## 3. Out of scope

Manager application, screening, organizations, payout wallet, members/roles, wallet migration, multiple independent wallets, user-initiated wallet unlink, automated suspicious-session detection, an ops/admin UI (ops actions are audited CLI commands), basket discovery, investing, and eligibility enforcement beyond storing contact verification status.

## 4. Data model (`apps/api`, Drizzle ORM, Supabase PostgreSQL)

Conventions: UUIDv7 primary keys; `timestamptz`; status columns are Postgres enums with transitions enforced in the domain layer; no hard deletes (status changes/timestamps instead).

### 4.1 Tables

**`users`**
- `id`, `status` enum(`pending`, `active`, `suspended`), `created_at`, `updated_at`.
- Sign-in creates `active` users. `pending` is reserved for the Spec 2 manager flow.

**`investment_wallets`**
- `id`, `user_id` → users, `wallet_provider` (text; client-reported label, informational only, never identity), `status` enum(`active`, `inactive`), `created_at`.
- Partial unique index: one `active` wallet per `user_id` (database-enforced; concurrent creation tested).
- Transitions: `active → inactive` only through the future wallet-migration feature; no transitions are exposed in this spec. `inactive → active` not allowed (a migration creates a new wallet).

**`wallet_addresses`**
- `id`, `investment_wallet_id` → investment_wallets, `chain_family` enum(`evm`, `solana`), `chain` enum(`ethereum`, `base`, `bnb`, `arbitrum`, `solana`), `address`, `status` enum(`active`, `disabled`), `verification_method` enum(`eoa_ecdsa`, `erc1271`, `erc6492`, `ed25519`), `verified_on_chain` (the chain whose state/signature produced the proof; for `eoa_ecdsa` rows derived from one proof, the chain the user signed on), `verification_challenge_id` → auth_challenges, `verified_at`, `disabled_at`, `disabled_reason`, `created_at`.
- Unique `(chain, address)` globally, including `disabled` rows — an address cannot belong to two users, and a disabled address is not re-linkable to another user.
- Check constraints: `chain` consistent with `chain_family`; `verification_method` consistent with `chain_family`.
- Transitions: `active → disabled` (ops only, audited, reason required); `disabled → active` (ops only, audited). Rows never deleted.
- Address canonicalization: EVM lowercase hex; Solana base58 as-is (validated as a 32-byte public key).

**`auth_challenges`**
- `id`, `nonce` (128-bit random, unique), `purpose` enum(`sign_in`, `add_chain_account`), `chain_family`, `chain`, `address`, `message` (exact text returned to the client), `domain`, `uri`, `chain_id` (EVM numeric / Solana cluster id), `status` enum(`pending`, `processing`, `consumed`, `rejected`), `claim_id` (uuid, set on claim), `lease_expires_at`, `issued_at`, `expires_at` (issued + 5 min), `resolved_at`, `session_id` (nullable; required for `add_chain_account`).
- "Expired" is derived (`expires_at <= now()`), not stored.
- Transitions and recovery: see §5.1. A `consumed` or `rejected` challenge can never return to `pending`.

**`sessions`**
- `id`, `user_id`, `token_hash` (SHA-256 of token + pepper, unique), `client` enum(`web`, `mobile`), `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `revoke_reason` enum(`logout`, `logout_all`, `user_revoked`, `rotated`, `user_suspended`, `admin`), `replaced_by_session_id` (set on rotation), `user_agent`, `ip_prefix` (/24 IPv4, /48 IPv6).
- Raw token (32 random bytes, base64url) never stored.

**`contacts`**
- `id`, `user_id`, `type` enum(`email`, `phone`), `value` (email lowercased/trimmed; phone E.164), `status` enum(`unverified`, `verified`, `replaced`), `verified_at`, `created_at`.
- Partial unique index: one non-`replaced` contact per `(user_id, type)`.
- Not unique across users (contact is not identity; avoids account-existence leakage).
- Changing a contact sets the old row to `replaced` and inserts a new `unverified` row.

**`contact_verifications`**
- `id`, `contact_id`, `destination` (normalized value copied at send time), `channel` enum(`email`, `sms`), `status` enum(`pending`, `verified`, `superseded`, `expired`, `failed`), `provider_ref` (Twilio Verify SID; null for email), `code_hash` (HMAC-SHA256 with `OTP_HMAC_SECRET` over `verification_id ‖ code`; email only), `attempts` (int), `expires_at` (created + 10 min), `resolved_at`, `created_at`.
- **Bound to the exact contact version:** a verification only succeeds if its `contact_id` is the user's current non-`replaced` contact of that type, the contact is `unverified`, and `destination` equals the contact's `value`. Replacing a contact supersedes all its pending verifications; a new send supersedes the previous pending verification for the same contact.
- Max 5 attempts; then `failed` and a new send is required.

**`notification_preferences`**
- `user_id` (PK) → users, booleans: `rebalance` (default true), `portfolio_updates` (true), `manager_updates` (true), `offers` (false), `product_updates` (false), `marketing` (false), `updated_at`.
- Security/account notifications are not configurable and are not stored here.
- Row created at sign-up.

**`audit_events`**
- `id`, `actor_type` enum(`user`, `ops`, `system`), `actor_user_id` (nullable), `actor_ops_id` (text; operator identity for ops commands), `action` (string literal union in code), `entity_type`, `entity_id`, `request_id` (correlation id from `X-Request-Id` or generated per request/job), `session_id` (nullable), `challenge_id` (nullable), `metadata` jsonb, `created_at`. Append-only (no UPDATE/DELETE grant for `bytesac_api`; purge only by the retention job role).
- Metadata never contains tokens, token hashes, signatures, OTP codes, full email/phone or secrets; addresses may appear (they are public), contact values are masked.
- Actions in this spec: `user.signed_up`, `user.signed_in`, `user.suspended`, `wallet.chain_account_added`, `wallet.address_disabled`, `wallet.address_reactivated`, `session.created`, `session.rotated`, `session.revoked`, `session.revoked_all`, `contact.added`, `contact.replaced`, `contact.verified`, `notification_preferences.updated`, `challenge.rejected`.

### 4.2 Database access and authorization

- The backend is the only database client. Supabase Auth, its JWT claims and the Supabase Data API are not used.
- All tables live in schema `app`, which is not in Supabase's exposed Data API schemas; `anon` and `authenticated` roles have no privileges on it.
- RLS is enabled on every `app` table with permissive policies scoped to `bytesac_api` and `bytesac_retention` only, as defense-in-depth: if the schema were ever exposed, Supabase client roles still read nothing. Default privileges on schema `app` are revoked from PUBLIC, `anon` and `authenticated`. RLS is not the primary authorization mechanism.
- Roles: `bytesac_api` (runtime; `SELECT/INSERT/UPDATE` on `app` tables, no `DELETE`, no DDL; access via role-scoped RLS policies (no `BYPASSRLS`)); the schema-owner role (Supabase `postgres`; local superuser) used only by `db:migrate`; `bytesac_retention` (DELETE limited to the purge job's tables).
- Application-layer authorization: every protected query filters by `req.auth.userId` from the session; repository methods take `userId` as a required argument for user-owned data. Negative tests cover cross-user access.

### 4.3 Data retention

| Data | Retention | Mechanism |
|---|---|---|
| `auth_challenges` (consumed, rejected, or expired) | 7 days after `expires_at`, except challenges referenced by `wallet_addresses.verification_challenge_id` (address evidence) | Purge job |
| `sessions` (revoked or expired) | 90 days after revocation/expiry | Purge job |
| `contact_verifications` (resolved) | 90 days after `resolved_at` | Purge job |
| `contacts` (`replaced`) | Retained while the user exists | — |
| `wallet_addresses`, `investment_wallets`, `users` | Retained (identity and audit history) | — |
| `audit_events` | 7 years — **OPEN**, confirm with compliance per jurisdiction | Purge job once confirmed |

Purge runs daily as a BullMQ repeatable job in the API worker process (`apps/api/src/worker.ts`) under `bytesac_retention`; each run writes a `system` audit summary (counts only).

### 4.4 Notes

- "Email and phone verified before investing" (User-Detailed-Features §8–9) is derived from `contacts` by a future eligibility check; no flag is stored now.
- Rate-limit counters live in Redis, not PostgreSQL.

## 5. Authentication flows

**Rule:** the server builds the message to sign and stores the exact text in `auth_challenges.message`. On verify, the signature is checked against that stored text only; the server never trusts a client-supplied message. The stored challenge's `purpose`, `chain`, `address` and (for `add_chain_account`) `session_id` must match the request context.

### 5.1 Sign in (signup or login)

1. Client connects a wallet via Reown AppKit. UI shows "Connected" as a distinct step from "Sign to verify" (connection is not authentication).
2. `POST /v1/auth/challenge { purpose: "sign_in", chain, address }` (chain family is derived from `chain`) → server validates chain/address, stores a `pending` challenge, returns `{ challengeId, message }`.
   - EVM: EIP-4361 (SIWE) message.
   - Solana: SIWS (CAIP-122 style) message.
   - Both include `domain` (`AUTH_DOMAIN`), `uri` (`AUTH_URI`), nonce, issuedAt, expirationTime (+5 min), chain id, and the statement: *"Sign in to Bytesac. This does not authorize any transaction or spending."*
3. Wallet signs the message.
4. `POST /v1/auth/verify { challengeId, signature, walletProvider, client }` runs three phases. No DB transaction is held open across the RPC call.

   **Phase A — claim (short statement, DB time):**
   ```sql
   UPDATE app.auth_challenges
      SET status = 'processing', claim_id = $claim, lease_expires_at = now() + interval '30 seconds'
    WHERE id = $id
      AND expires_at > now()
      AND (status = 'pending' OR (status = 'processing' AND lease_expires_at < now()))
   RETURNING *;
   ```
   - No row → read the challenge to return the precise error: `CHALLENGE_NOT_FOUND`, `CHALLENGE_EXPIRED`, `CHALLENGE_CONSUMED` (consumed/rejected), or `409 CHALLENGE_IN_PROGRESS` (another request holds a live lease).
   - Check `purpose`, and for `add_chain_account` that `session_id` equals the caller's session; mismatch → mark `rejected`, `SIGNATURE_INVALID`.

   **Phase B — verify signature (no transaction):**
   - EVM, in order:
     1. ECDSA recover over the EIP-191 message hash. Recovered address = challenge address → method `eoa_ecdsa`. This also covers EIP-7702-delegated EOAs, whose key still controls the address on every EVM chain.
     2. Otherwise, via the `EvmRpc` adapter (Alchemy) on the **challenge's chain**: if code is deployed → ERC-1271 `isValidSignature` → method `erc1271`; if not deployed and the signature is ERC-6492-wrapped → ERC-6492 validation → method `erc6492`.
     3. Otherwise → invalid.
   - Solana: ed25519 verify (`@noble/curves`) with the base58-decoded public key → method `ed25519`.
   - Outcomes:
     - **Definitively invalid** → `UPDATE … SET status='rejected', resolved_at=now() WHERE id=$id AND claim_id=$claim`; audit `challenge.rejected`; `401 SIGNATURE_INVALID`.
     - **Transient failure** (RPC timeout/5xx, rate limit) → `UPDATE … SET status='pending', claim_id=NULL, lease_expires_at=NULL WHERE id=$id AND claim_id=$claim`; `503 VERIFIER_UNAVAILABLE`; client may retry with the same signature until `expires_at`.
     - **Valid** → Phase C.

   **Phase C — finalize (one DB transaction):**
   1. `UPDATE … SET status='consumed', resolved_at=now() WHERE id=$id AND claim_id=$claim AND status='processing'`. Zero rows (lease was lost to another claimant) → roll back, `409 CHALLENGE_IN_PROGRESS`.
   2. Determine chains to register: `eoa_ecdsa` → all supported chains of the family (ethereum, base, bnb, arbitrum); `erc1271` / `erc6492` → only the challenge's chain; `ed25519` → `solana`.
   3. Look up the `(chain, address)` for the challenge's chain:
      - **Found and `active`:** load the user; user must be `active` (else `USER_NOT_ACTIVE`).
      - **Found and `disabled`:** `403 ADDRESS_DISABLED`.
      - **Not found:** create user (`active`), investment wallet (`active`), address rows for the chains above (with `verification_method`, `verified_on_chain`, `verification_challenge_id`), notification preferences; audit `user.signed_up`.
   4. Create a session (§5.3); audit `session.created`, `user.signed_in`.
   5. Commit.
   - **Unique-constraint race on sign-up** (two concurrent sign-ins for the same new address using different challenges): the losing transaction fails on the `(chain, address)` constraint and rolls back entirely, which leaves its challenge in `processing` with its own `claim_id`. The service catches the violation and re-runs Phase C once in a new transaction; the lookup now finds the address and the request completes as a login. No duplicate user or wallet can be created; the unique constraint is the final safeguard.
   - **Crash safety:** a crash between Phase A and C leaves `processing` with a lease; after 30 s it can be re-claimed until `expires_at`. Because consumption commits atomically with account linking and session creation, a challenge that produced a session is always `consumed` and can never be replayed.
   6. Response `{ user, isNewUser }`. Web: `Set-Cookie: bx_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/`. Mobile (`client: "mobile"`): token returned in body.
5. New users are routed to the skippable Add contact step.

### 5.2 Add chain account (authenticated)

- Same challenge → sign → verify flow with `purpose: "add_chain_account"`. The challenge stores the current `session_id`; verify requires the same session.
- Allowed targets:
  - An address in the **other** chain family, or
  - The **same** EVM address the user already has, on a supported EVM chain not yet registered (needed for `erc1271` / `erc6492` wallets, which are verified per chain).
- Add chain account serializes per wallet (row lock on the investment wallet), so two sessions cannot link two addresses in one family.
- Outcomes (evaluated inside Phase C's transaction; the `(chain, address)` unique constraint is the final safeguard and a violation maps to `409 ADDRESS_ALREADY_LINKED` for this purpose):
  - Address+chain already on this user → idempotent success (no new rows, no rotation).
  - Address owned by another user (any status) → `409 ADDRESS_ALREADY_LINKED` (no merge).
  - User already has a **different** address in that family → `409 CHAIN_FAMILY_ALREADY_LINKED`.
  - Otherwise → insert rows (scope per verification method, as in §5.1) into the user's active investment wallet; audit `wallet.chain_account_added`; **rotate the session** (§5.3).
- All inserts for one link happen in a single transaction; a partial link cannot be committed.

### 5.3 Sessions

- Create: generate 32 random bytes; store `token_hash`; set `idle_expires_at` and `absolute_expires_at` from database `now()` per client (web 12 h / 7 d; mobile 7 d / 30 d).
- `requireSession` middleware on every protected route, in one query evaluated with database time:
  ```sql
  SELECT s.*, u.status FROM app.sessions s JOIN app.users u ON u.id = s.user_id
   WHERE s.token_hash = $hash AND s.revoked_at IS NULL
     AND s.idle_expires_at > now() AND s.absolute_expires_at > now();
  ```
  No row → `401 SESSION_EXPIRED`; user not `active` → `401 USER_NOT_ACTIVE`. Sessions are not cached, so logout and suspension take effect on the next request.
- **Sliding renewal (concurrency-safe):** the token never changes on renewal. At most once per 5 minutes: `UPDATE … SET last_seen_at = now(), idle_expires_at = LEAST(now() + $idle, absolute_expires_at) WHERE id = $id AND last_seen_at < now() - interval '5 minutes'`. Concurrent requests are harmless (the conditional update runs at most once; values are monotonic).
- **Rotation on security events:** after a successful add chain account, issue a new session (same client, fresh expiries), revoke the old one with `revoke_reason='rotated'` and `replaced_by_session_id` (rotation refuses an already-revoked session), return the new token (cookie or body). A request still carrying the old token receives `401 SESSION_EXPIRED`; clients handle this by the normal re-auth path. Future security events (wallet migration, privilege grants in Spec 2) reuse this mechanism.
- **Revocation:** `POST /v1/auth/logout` (current), `POST /v1/auth/logout-all` (all), `DELETE /v1/me/sessions/:id` (one own session). User suspension (ops) sets `users.status='suspended'` and revokes all sessions with `revoke_reason='user_suspended'` in one transaction.
- **Suspicious activity (release 1):** every session records `user_agent` and `ip_prefix`; the sessions list shows device, client, last seen and approximate network; users can revoke any session or all sessions; `session.created` audit events carry request context. Automated anomaly detection and alerts are deferred to a later spec.
- Logout does not change the investment wallet, its addresses, or their relationship to the user.

### 5.4 CSRF and CORS

- **No CORS:** the API sends no `Access-Control-Allow-*` headers and answers preflight `OPTIONS` with 403. Web traffic is same-origin through the Next proxy; mobile is native. Browsers therefore cannot call the API directly from any other origin.
- Cookie is `HttpOnly; Secure; SameSite=Lax`.
- **Origin guard** applies to every cookie-authenticated mutating request (`POST`, `PATCH`, `PUT`, `DELETE`) — explicitly including `/auth/logout`, `/auth/logout-all`, `/me/sessions/:id`, all `/me/contacts*` and `/me/notification-preferences` — and to `POST /auth/challenge` and `POST /auth/verify` when `client` is `web` (prevents login CSRF):
  - `Origin` header must be present and in `ALLOWED_ORIGINS`; missing or untrusted → `403 CSRF_REJECTED`.
  - Header `X-Requested-With: bytesac` must be present → otherwise `403 CSRF_REJECTED`.
- The Next proxy forwards the browser's `Origin` unchanged.
- Mobile/native clients send header `X-Client: mobile` (the api-client's bearer transport sets it); Origin-less mobile sign-in is exempt from the Origin guard on that basis. Bearer-authenticated requests (mobile) are exempt; a request carrying both a cookie and a bearer token is rejected (`400 VALIDATION_FAILED`).

### 5.5 Contacts and OTP

- `POST /v1/me/contacts { type, value }` (one transaction): validate/normalize; mark any existing non-`replaced` contact of that type `replaced` and supersede its pending verifications; create an `unverified` contact; create a `pending` verification with `destination = value`; then send OTP.
  - Email: generate 6-digit code (CSPRNG), store HMAC hash bound to the verification id, send via Resend (`EmailSender` adapter).
  - Phone: start Twilio Verify (`SmsOtpProvider` adapter), store `provider_ref`.
- `POST /v1/me/contacts/:id/verify { code }`: contact must belong to the caller (`404` otherwise), be the current non-`replaced` contact of its type, and be `unverified`; the latest `pending` verification for that contact must match `destination`, be unexpired and under the attempt limit. Increment `attempts` atomically before checking. Email compares HMAC in constant time; phone calls Twilio Verify check with the stored `destination`. Success → verification `verified`, contact `verified`, audit `contact.verified`. An OTP issued for a replaced contact or superseded verification can never verify the new contact.
- `POST /v1/me/contacts/:id/resend`: 60 s cooldown; supersedes the previous pending verification and creates a new one.
- Contact step is skippable; available later in Settings.

### 5.6 Rate limits and abuse protection (Redis, `RateLimiter` adapter)

| Scope | Limit (initial values, configurable) |
|---|---|
| Challenge issuance | 20/min per IP; 10/min per address |
| Verify | 30/min per IP |
| OTP send — per user | 5/hour |
| OTP send — per destination (email or phone, across all users) | 3/hour, 10/day |
| OTP send — per IP | 10/hour |
| OTP send — global circuit breaker | Per channel per minute (e.g. SMS 200/min); tripping blocks new sends with `503 OTP_DELIVERY_FAILED` and logs an alert |
| OTP resend cooldown | 60 s per contact |
| OTP verify attempts | 5 per verification |

- SMS additionally relies on Twilio Verify Fraud Guard and an allowlist of permitted destination countries (`SMS_ALLOWED_COUNTRIES`).
- Exceeded → `429 RATE_LIMITED` with `Retry-After`.

### 5.7 Wallet unlinking and recovery (release 1)

- **No user-initiated unlink or address removal.** The Settings UI does not offer it. This guarantees a user always retains at least one verified way to authenticate.
- **Compromised or inaccessible wallet:** the user contacts support. Platform ops runs an audited ops command (`pnpm --filter api ops:address-disable -- --address … --chain … --reason … --operator …`) that, in one transaction, sets the address rows `disabled` (all chains for that address), revokes all of the user's sessions, and writes `wallet.address_disabled` and `session.revoked_all` audit events. A disabled address cannot sign in (`403 ADDRESS_DISABLED`) and cannot be linked to another user.
- **Reactivation:** only via `ops:address-reactivate`, audited (`wallet.address_reactivated`).
- **Recovery/replacement of the investment wallet** is the future wallet-migration feature (out of scope); until then a user whose only address is disabled cannot sign in.
- Ops commands require an operator identity argument, run only with server credentials, and never accept input from the public API.

## 6. Code structure

```
apps/api/                     Express 5 + TypeScript (new)
  src/app.ts, src/server.ts   app factory (testable) + HTTP listener
  src/worker.ts               BullMQ worker process (retention purge job)
  src/ops/                    audited ops commands (address-disable, address-reactivate, user-suspend)
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
  src/shared/                 DomainError, error mapper, audit writer, request-id middleware,
                              pino logger (redacted)
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

**Error codes:** `VALIDATION_FAILED`, `UNSUPPORTED_CHAIN`, `CHALLENGE_NOT_FOUND`, `CHALLENGE_EXPIRED`, `CHALLENGE_CONSUMED`, `CHALLENGE_IN_PROGRESS`, `SIGNATURE_INVALID`, `VERIFIER_UNAVAILABLE`, `ADDRESS_DISABLED`, `ADDRESS_ALREADY_LINKED`, `CHAIN_FAMILY_ALREADY_LINKED`, `SESSION_EXPIRED`, `USER_NOT_ACTIVE`, `CSRF_REJECTED`, `NOT_FOUND`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `OTP_COOLDOWN`, `OTP_DELIVERY_FAILED`, `RATE_LIMITED`, `INTERNAL`.

**Authorization:** every `/me/*` query is scoped by `req.auth.userId`, never by a client-supplied user id. Access to another user's session/contact returns `404 NOT_FOUND`.

**Request correlation:** every request gets an `X-Request-Id` (accepted from the Next proxy if well-formed, else generated), echoed in responses and written to logs and audit events.

**Configuration** (documented in `apps/api/.env.example` without values): `DATABASE_URL` (runtime role `bytesac_api`), `MIGRATOR_DATABASE_URL` (schema-owner role, migrations only), `RETENTION_DATABASE_URL` (`bytesac_retention`, worker only), `REDIS_URL`, `SMS_ALLOWED_COUNTRIES`, `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET`, `ALCHEMY_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `AUTH_DOMAIN`, `AUTH_URI`, `ALLOWED_ORIGINS`, `PORT`. Client public config only: `NEXT_PUBLIC_REOWN_PROJECT_ID`, `API_ORIGIN` (Next server-side rewrite target), `EXPO_PUBLIC_REOWN_PROJECT_ID`, `EXPO_PUBLIC_API_URL`.

**Local development:** `docker-compose.yml` with PostgreSQL 17 and Redis. Deployed environments use Supabase PostgreSQL. Turbo tasks for `api`: `dev`, `build`, `test`, `lint`, `check-types`; scripts `db:generate`, `db:migrate`, `worker`, `ops:*`. The first migration creates schema `app`, the runtime and retention roles and their grants; local docker-compose mirrors the same roles.

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
   - **Wallet:** investment wallet; address rows per chain with chain badges, status (Active/Disabled, text + icon) and verification method label (e.g. "Key signature", "Smart wallet"); `Add chain account` (reuses screen 2 with `add_chain_account`), hidden when nothing more can be added; no remove/unlink control; help text: "Lost access to a wallet? Contact support."
   - **Contacts:** email/phone with Verified/Unverified badges (text + icon); `Change`.
   - **Notifications:** six toggles; note that security notices are always sent.
   - **Sessions:** device/client/last seen; `Revoke`; `Log out all devices` (confirmation dialog).
   - **Log out.**

### 8.3 Routing, guards and wallet layer

- Web: App Router groups `(public)` and `(app)`; `next.config.js` rewrites `/api/:path*` to `API_ORIGIN`; `(app)` layout calls `GET /v1/me` via the proxy; `401` → `/sign-in?reason=expired`. UI guards are UX only; the API enforces authorization.
- Mobile: expo-router groups `(auth)` and `(app)`; auth context loads the token from SecureStore on boot; `401` clears the token and routes to `(auth)`.
- Wallet layer: each app wraps the SDK behind a `WalletConnector` interface (`connect`, `disconnect`, `getAccount`, `signMessage`); screens never import the SDK directly.
  - **Web:** Reown AppKit with the Wagmi adapter (EVM) and the Solana adapter.
  - **Mobile** (per [Reown AppKit React Native installation](https://docs.reown.com/appkit/react-native/core/installation)):
    - Core: `npx expo install @reown/appkit-react-native @react-native-async-storage/async-storage react-native-get-random-values react-native-svg @react-native-community/netinfo @walletconnect/react-native-compat react-native-safe-area-context expo-application`.
    - EVM: `@reown/appkit-wagmi-react-native` + `wagmi` + `viem@2.x` + `@tanstack/react-query` (Wagmi chosen for parity with web and the API's use of viem).
    - Solana: `@reown/appkit-solana-react-native` + `text-encoding` polyfill; `SolanaAdapter`; `extraConnectors: [new PhantomConnector({ cluster: 'mainnet-beta' }), new SolflareConnector({ cluster: 'mainnet-beta' })]`; network `solana` from `@reown/appkit-react-native`.
    - `import '@walletconnect/react-native-compat'` first in the AppKit config module; `createAppKit({ projectId, networks: [mainnet, base, bsc, arbitrum, solana], adapters, metadata: { …, redirect: { native: 'bytesac://' } }, storage })` with an AsyncStorage-backed `Storage` implementation (AppKit connection state only; the session token stays in `expo-secure-store`).
    - `<SafeAreaProvider><AppKitProvider instance={appKit}>…<AppKit /></AppKitProvider></SafeAreaProvider>` in the root layout.
    - `babel.config.js` with `babel-preset-expo` `{ unstable_transformImportMeta: true }` (required for valtio on Expo SDK 53+).
    - Wallet detection: iOS `LSApplicationQueriesSchemes` (`metamask`, `trust`, `safe`, `rainbow`, `uniswap`, `phantom`, `solflare`) in `app.json`; Android `<queries>` via a local config plugin (`queries.js`).
    - App scheme `bytesac` for wallet redirect deep links. Use an Expo development build (not Expo Go) as the standard dev target so deep links and native modules behave as in production.
  - The Solana message-signing call on mobile (provider API) is not documented on the installation page; confirm it in the Reown hooks/Solana docs during planning.

### 8.4 Accessibility

44×44 minimum touch targets; 2 px `mint` focus ring; accessible names on icon buttons; reduced motion respected; status never conveyed by color alone; WCAG AA contrast.

## 9. Error handling

- Controllers parse input and call services; services throw typed `DomainError(code)`; one Express error mapper produces the stable error shape and HTTP status. Unknown errors → `500 INTERNAL`; details logged server-side only.
- Logging: pino with redaction. Never log session tokens, signatures, OTP codes, full email/phone, or API keys. Addresses logged shortened.
- Signature verification infra failure (e.g. Alchemy timeout or RPC transport failure during an ERC-1271 check; fail-closed, never treated as an invalid signature) → `503 VERIFIER_UNAVAILABLE`; the claim is released to `pending` (§5.1 Phase B) so the user can retry until expiry. A definitively invalid signature moves the challenge to `rejected`.
- Session rotation response lost in transit: the old token returns `401 SESSION_EXPIRED` and the client re-authenticates; no inconsistent state results.
- OTP provider failure → `503 OTP_DELIVERY_FAILED`; does not count toward the user's send quota. For Twilio Verify, codes 404, 20404 and 60202 count as a rejected code; every other failure is `OTP_DELIVERY_FAILED`.
- Clients map each `ErrorCode` to fixed copy and a recovery action (retry, restart sign-in, re-authenticate).

## 10. Testing

Vitest throughout; Supertest for HTTP; integration tests use real PostgreSQL and Redis (docker-compose) with fake provider adapters. Test signatures come from throwaway keys (viem `privateKeyToAccount`, generated ed25519 keypairs); never production wallets.

- **Unit (domain):** SIWE/SIWS message build; address canonicalization; session idle/absolute expiry for web and mobile; contact state transitions; invalid transitions rejected.
- **Integration:**
  - Sign-up creates user, active wallet, 4 EVM address rows (EOA) or 1 row (Solana) and preferences in one transaction; repeat sign-in creates no new user.
  - EVM verification methods: EOA ECDSA → 4 chains, `eoa_ecdsa`; ERC-1271 (fake `EvmRpc` returning deployed code + magic value) → only the verified chain, `erc1271`; ERC-6492 wrapped signature for undeployed wallet → only the verified chain, `erc6492`; method, `verified_on_chain` and `verification_challenge_id` stored.
  - Challenge state machine: reused challenge → `CHALLENGE_CONSUMED`; two concurrent verifies of one challenge → exactly one session, other gets `CHALLENGE_IN_PROGRESS` or `CHALLENGE_CONSUMED`; invalid signature → `rejected` and not retryable; transient verifier failure → released to `pending` and a retry succeeds; simulated crash after claim → re-claimable after lease expiry, never replayable after consumption; no DB transaction open during the (fake, delayed) RPC call.
  - Expired challenge; domain mismatch; signature from a different key; wrong purpose; `add_chain_account` challenge used from another session.
  - Concurrent sign-up of the same new address with two challenges → one user, both requests end logged in to it.
  - Concurrent creation of a second active investment wallet for one user fails at the database.
  - Add chain account: idempotent same-user; `ADDRESS_ALREADY_LINKED` (incl. concurrent link race from two users → exactly one wins, other 409); `CHAIN_FAMILY_ALREADY_LINKED` for a different same-family address; same smart-wallet address on another EVM chain allowed; session rotated and old token rejected.
  - Disabled address: sign-in → `ADDRESS_DISABLED`; cannot be linked by another user; ops disable revokes all sessions; reactivation restores sign-in; all audited.
  - Sessions: expired idle, expired absolute, revoked, suspended user → 401; expiry evaluated with DB time; concurrent requests during renewal keep the token valid and idle expiry monotonic and capped; logout-all; suspension revokes all; revoking another user's session → 404.
  - CSRF/CORS: no CORS headers on any response; preflight → 403; cookie mutations (including logout and contacts) and web `/auth/verify` with missing or foreign Origin or missing header → 403; bearer path unaffected; cookie + bearer together → 400.
  - OTP: correct code; wrong code; attempts exceeded; expired; resend cooldown; supersede on resend; OTP from a replaced contact cannot verify the new contact; destination mismatch rejected; per-user, per-destination, per-IP and global limits; delivery failure not counted.
  - DB authorization: runtime role cannot `DELETE` or run DDL; `anon`/`authenticated` cannot read `app` tables; cross-user reads/writes via the API return 404.
  - Retention job purges only eligible rows per §4.3 and writes a count-only audit summary.
  - Audit events carry `request_id` and session/challenge references where applicable; no secrets or unmasked contact values in metadata.
- **Contracts / client:** schema tests; api-client tests with mocked fetch for both transports.
- **UI:** web component tests (Vitest + Testing Library) for the verify-wallet stepper states and OTP form; mobile smoke tests with `jest-expo`.
- **Manual end-to-end:** Phantom (Solana) and MetaMask (EVM) on web and mobile against the dev stack before completion.
- **Gates:** format, lint, `check-types`, all tests via turbo.

## 11. Documentation updates (in the same change, rewritten in place)

- `docs/decisions/DECISION-REGISTER.md`: rewrite D-003 (backend-managed sessions; Supabase = PostgreSQL only); rewrite D-021 to name Next.js (App Router) for web; add D-031 session model, lifetimes and rotation, D-032 release-1 auth chains, D-033 chain-account association rule (verification-method scoped), D-034 OTP providers (Resend, Twilio Verify), D-035 Zod shared contracts + Next same-origin proxy + no CORS, D-036 Vitest, D-037 challenge state machine, D-038 database access model (backend-only, `app` schema, least-privilege roles, RLS deny-all defense-in-depth), D-039 no user-initiated wallet unlink in release 1 + ops disable/reactivate, D-040 data retention (audit retention OPEN pending compliance).
- New `docs/decisions/ADR-003-BACKEND-SESSIONS.md`, `docs/decisions/ADR-004-CHAIN-ACCOUNT-ASSOCIATION.md` (including EOA vs ERC-1271/6492 scope), `docs/decisions/ADR-005-DATABASE-ACCESS-MODEL.md`.
- `docs/domains/USER-AUTHENTICATION.md` also gains wallet unlink/recovery policy and the chain-association rule.
- `docs/architecture/ARCHITECTURE.md`: rewrite §3 system context, §4 Identity and access, §7 persistence names (`investment_wallets`, `wallet_addresses`, `auth_challenges`, `sessions`, `contacts`, `contact_verifications`, `notification_preferences`, `audit_events`), §8 stack table (Next.js, Resend, Twilio Verify, Zod, Vitest; session issuer).
- `docs/domains/USER-AUTHENTICATION.md`: rewrite Authentication, Identity model and Sessions sections; state that the backend session decision supersedes the source's Supabase-session wording.
- `docs/engineering/CODING-STANDARDS.md`: schema library = Zod; test runner = Vitest.
- `docs/README.md`: add `docs/superpowers/specs/` to the index.
- `docs/source/*` remain verbatim.
- New `apps/api/README.md`: setup, env, migrations, tests.

## 12. Risks and follow-ups

- Reown AppKit React Native on Expo 57 / RN 0.86: observed status: the mobile app (AppKit RN 2.0.6, wagmi adapter, Solana adapter with Phantom/Solflare) bundles and type-checks (`expo export --platform android` succeeds; jest-expo tests pass). On-device wallet connect and sign are unverified, pending the user's device checklist. Fallback if the device check fails: keep the `WalletConnector` interface and use wallet-specific deep-link SDKs.
- ERC-1271/6492 verification depends on Alchemy RPC availability per chain; outages degrade smart-wallet sign-in only (EOA verification is offline).
- Resolved: role-scoped RLS policies, no `BYPASSRLS` (ADR-005).
- Audit-event retention period (7 years proposed) is OPEN pending compliance review.
- Users whose only address is disabled cannot sign in until the wallet-migration feature exists; support must handle these cases manually.
- Twilio Verify country coverage and pricing must be confirmed for target jurisdictions.
- Session cookie relies on the Next proxy being same-origin; deployment must preserve this topology.
- Spec 2 will introduce `users.status = pending` activation via wallet proof and the `can_create_manager_organization` grant; this spec's `users.status` enum already includes `pending`.
