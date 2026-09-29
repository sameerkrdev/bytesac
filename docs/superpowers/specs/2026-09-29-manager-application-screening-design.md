# Spec 2 — Fund Manager Application + Platform Screening (Design)

- **Date:** 2026-09-29
- **Status:** Approved (2026-09-30)
- **Series:** Spec 2 of 4 — (1) Foundation + user auth ✅, (2) Manager application + screening, (3) Organization onboarding, (4) Members/roles
- **Builds on:** Spec 1 (wallet sign-in, backend sessions, contacts/OTP, audit, ops CLI) and the approved restructure (`@repo/db`, `@repo/logger`, `@repo/validator`, `@repo/app-core`, API `app.ts`/`server.ts` layout, http-errors, pg_cron).
- **Sources:** `docs/source/Fund-Manager-&-Organisation-Onboarding-Flow.txt` §4–§10, `docs/source/Fund-Manager-Detailed-Features.txt` §2–§3, D-004.

## 1. Intent

Let anyone apply to become a fund manager, let the platform team screen applications in a minimal ops area, and — once screening is approved and the applicant proves control of the submitted wallet — grant the narrowly scoped `create_manager_organization` permission. Organization creation itself is Spec 3.

**Success criteria**
1. A logged-out visitor can submit an application, confirm their email with a 6-digit code, and receive a private status link.
2. Ops reviewers can list/filter applications, read details and history, add internal notes, move status through allowed transitions, and message the applicant.
3. The applicant sees status and any ops message via the status link and can reply once when additional information is requested.
4. After `SCREENING_APPROVED`, signing in (Spec 1 flow) with the exact submitted wallet address grants `create_manager_organization`; if the address already belongs to a user at approval time, the grant happens immediately.
5. Ops access is role-based (`ops_reviewer`, `ops_admin`), managed in the ops UI by admins, bootstrapped by CLI; every ops action is audited.
6. No unproven (typed) wallet address ever creates, activates or links a user.

## 2. Decisions (this brainstorm)

| Topic | Decision |
|---|---|
| Ops surface | Minimal ops area inside the web app (`/ops/*`); ops staff sign in with a wallet (Spec 1) and hold a platform role. |
| Wallet proof timing | Hybrid: public logged-out form records chain + typed address (identifier only). Approval stays pending proof until a proven user with that exact address exists; then the permission is granted. No invite tokens, no pending-user rows. |
| Applicant communication | Contact happens outside the app (email/phone). Ops UI records statuses, internal notes and an optional message to the applicant. Applicant gets status emails (Resend) and a private status page (secret link) with a single reply when additional information is requested. |
| Abuse protection | Rate limits per IP and per email + mandatory email confirmation (6-digit code) before an application enters the ops queue. No captcha in release 1. |
| Clients | Web only (public apply/status pages + ops). Mobile unchanged in Spec 2. |
| Ops access model | `platform_roles` (`ops_reviewer`, `ops_admin`); admins grant/revoke in the ops UI; first admin via CLI; all actions audited with operator user id. |
| Supersedes | D-004's "platform requests and verifies wallet after screening via pending user" is refined to the hybrid rule above (record in decision register/ADR, in place). |

## 3. Out of scope

Organization creation/KYB/KYC documents/payout wallet (Spec 3), members (Spec 4), mobile screens, in-app message threads, captcha, file uploads, public manager profiles.

## 4. Data model (`@repo/db`, schema `app`)

**`manager_applications`**
- `id`, `applicant_type` enum(`individual`,`firm`), `full_name`, `firm_name` (nullable; required when firm), `email` (lowercased/trimmed), `email_confirmed_at`, `phone` (E.164, nullable), `country` (ISO-3166 alpha-2), `website` (nullable), `professional_background`, `investment_experience`, `qualifications` (nullable), `reason`, `intended_baskets`, `wallet_chain` (Chain), `wallet_address` (canonical per Spec 1 rules; **identifier only**), `status` enum (below), `status_token_hash` (HMAC-SHA256 of a 32-byte random token; set on email confirmation), `user_id` (nullable; set on proof), `wallet_proven_at`, `submitted_at`, `decided_at`, `decided_by_user_id`, `created_at`, `updated_at`.
- Text fields have max lengths (validator schemas); `website` must be https URL.
- Partial unique indexes: one **open** application (status not in `SCREENING_REJECTED`) per `email`; one open application per `(wallet_chain family, wallet_address)`.

**`application_events`** (append-only)
- `id`, `application_id`, `actor_type` enum(`applicant`,`ops`,`system`), `actor_user_id` (nullable), `kind` enum(`status_changed`,`note`,`applicant_reply`,`permission_granted`), `from_status`, `to_status`, `internal_note` (ops-only), `message_to_applicant`, `applicant_message`, `request_id`, `created_at`.

**`application_email_codes`**
- `id`, `application_id`, `code_hash` (HMAC bound to row id), `attempts`, `expires_at` (+10 min), `status` enum(`pending`,`verified`,`superseded`,`failed`), `resolved_at`, `created_at`. One pending per application. Purged by `app.purge_expired()` 90 days after resolution.

**`platform_roles`**
- `id`, `user_id`, `role` enum(`ops_reviewer`,`ops_admin`), `granted_by_user_id` (nullable for CLI), `granted_at`, `revoked_at`, `revoked_by_user_id`. Partial unique: one active row per `(user_id, role)`.

**`user_permissions`**
- `id`, `user_id`, `permission` enum(`create_manager_organization`), `source_application_id`, `granted_at`, `revoked_at`. Partial unique: one active row per `(user_id, permission)`.

Grants: runtime role gets SELECT/INSERT/UPDATE (no DELETE) on new tables; RLS enabled with role-scoped policy like Spec 1.

## 5. Status machine

```
EMAIL_PENDING ──confirm──▶ SUBMITTED ──ops──▶ SCREENING ──ops──▶ CONTACTED
                                   ▲              │  ▲               │
                                   │              ▼  │               ▼
                       applicant reply ◀── ADDITIONAL_INFORMATION_REQUIRED
SCREENING | CONTACTED ──ops──▶ SCREENING_APPROVED   (awaiting wallet proof until wallet_proven_at)
SUBMITTED | SCREENING | CONTACTED | ADDITIONAL_INFORMATION_REQUIRED ──ops──▶ SCREENING_REJECTED (terminal)
```
- Allowed transitions are one table in code; invalid → 409 `INVALID_TRANSITION`.
- Applicant reply moves `ADDITIONAL_INFORMATION_REQUIRED → SCREENING` (one reply per request).
- `EMAIL_PENDING` applications older than 24 h are purged by `app.purge_expired()` (never reviewed, no PII retention beyond that).
- Every change writes an `application_events` row and an audit event in the same transaction; `decided_at/decided_by_user_id` set on approve/reject.

## 6. Wallet proof and permission grant

- **At approval:** if a user already owns `(wallet_chain, wallet_address)` (active address, active user) → grant `create_manager_organization`, set `user_id`, `wallet_proven_at`, event `permission_granted`.
- **At sign-in / add-chain finalize (Spec 1 transaction):** after the address rows are confirmed for the user, look up an application with `status = SCREENING_APPROVED`, `wallet_proven_at IS NULL`, matching address (EVM: same address, any EVM chain proven by EOA; ERC-1271/6492: the verified chain must equal the submitted chain; Solana: solana) → grant as above in the same transaction.
- A disabled address or non-active user never receives the grant.
- Grant is idempotent (partial unique index); audit `permission.granted`.

## 7. API (validator schemas in `@repo/validator`)

**Public (no session; CSRF rules as Spec 1 for browser Origin + `X-Requested-With`)**
| Method & path | Purpose |
|---|---|
| `POST /v1/manager-applications` | Create (`EMAIL_PENDING`), send code. Returns `{ applicationId }`. |
| `POST /v1/manager-applications/:id/confirm-email` `{ code }` | Confirm → `SUBMITTED`; returns `{ statusToken }` once and emails the status link. |
| `POST /v1/manager-applications/:id/resend-code` | 60 s cooldown. |
| `GET /v1/manager-applications/status` | Header `X-Application-Token`; returns status, submitted summary (no internal notes), latest message to applicant, `canReply`. |
| `POST /v1/manager-applications/reply` `{ message }` | Header `X-Application-Token`; only in `ADDITIONAL_INFORMATION_REQUIRED`. |

**Ops (session + role; audited)**
| Method & path | Role | Purpose |
|---|---|---|
| `GET /v1/ops/applications?status=&q=&cursor=` | reviewer | Paginated list (cursor by `submitted_at,id`). |
| `GET /v1/ops/applications/:id` | reviewer | Detail + events (incl. internal notes). |
| `POST /v1/ops/applications/:id/transition` `{ to, internalNote?, messageToApplicant? }` | reviewer | Status change (+ optional email). |
| `POST /v1/ops/applications/:id/notes` `{ internalNote }` | reviewer | Note only. |
| `GET /v1/ops/roles`, `POST /v1/ops/roles` `{ userId, role }`, `DELETE /v1/ops/roles/:id` | admin | Manage roles (revoke = status change). Admin cannot revoke their own last admin role. |

**Existing:** `GET /v1/me` adds `permissions: string[]`, `platformRoles: string[]`.
**CLI:** `ops:grant-role --user <id> --role ops_admin --operator <name>` for bootstrap.

**Errors (new codes):** `INVALID_TRANSITION`, `APPLICATION_EXISTS`, `APPLICATION_TOKEN_INVALID`, `REPLY_NOT_ALLOWED`, `FORBIDDEN` (missing role). Reuse `OTP_*`, `RATE_LIMITED`, `VALIDATION_FAILED`.

**Rate limits:** create 5/h per IP and 3/day per email; confirm attempts 5 per code; resend 60 s cooldown + 5/h per email; status/reply 30/min per IP; ops routes 120/min per user.

## 8. Emails (Resend, idempotency key per send)

- Confirmation code (10-min expiry).
- Status link after confirmation: `https://<app>/managers/status#<token>` (token in URL fragment → never sent to servers/logs).
- Status change emails for `CONTACTED`, `ADDITIONAL_INFORMATION_REQUIRED` (includes ops message), `SCREENING_APPROVED` ("sign in with wallet `<short address>` on `<chain>` to finish"), `SCREENING_REJECTED`. Email failures are logged and retried by the next status action; they never roll back the status change.

## 9. Web (Next.js)

- `/managers/apply` — single form (type toggle individual/firm, fields above, wallet chain + address with format validation, consent note that the address is not verified yet) → code step → "Check your email".
- `/managers/status` — reads token from `location.hash`, calls status API with header; shows status timeline label, ops message, reply box when allowed; clear expired/invalid-token state.
- `/ops` group (server guard: session + `platformRoles`; UI guard only):
  - `/ops/applications` — table with status filter/search, cursor pagination, mobile card list.
  - `/ops/applications/[id]` — details, events timeline (internal notes visually distinct), transition form with allowed targets only, note form.
  - `/ops/roles` — admin: list/grant/revoke.
- Home: when `permissions` includes `create_manager_organization`, show "You're approved to create a manager organization — coming soon" card.
- Design system as Spec 1 (dark, tokens, 44 px, status text+icon). Shared pure logic (status labels, allowed transitions for UI) in `@repo/app-core`/`@repo/validator`.

## 10. Security & privacy

- Status token: 32 random bytes, only HMAC hash stored; constant-time compare; rotating token not needed (single applicant, revocable by ops rejecting).
- Application PII readable only via ops roles; never logged (logger redaction covers email/phone/free text fields in request bodies).
- Typed wallet address never creates/links users; proof only via Spec 1 signature flow.
- Ops endpoints: session + role checked server-side on every request; role revocation effective next request.
- All ops actions and grants audited with request id.

## 11. Testing

- Unit: transition table (valid/invalid), token hashing, address matching rules (EOA vs smart wallet vs Solana).
- Integration (API, real Postgres/Redis, fake Resend): public create → confirm → status → reply; rate limits; duplicate open application; ops list/detail/transition/notes with reviewer vs admin vs no role (403); role management incl. last-admin guard; grant at approval (existing user) and at later sign-in (EVM EOA any chain, smart wallet chain match, Solana); disabled address/suspended user never granted; `app.purge_expired()` removes stale `EMAIL_PENDING` and old codes.
- Web: component tests for apply form validation, code step, status page states, ops transition form (only allowed targets), roles page.

## 12. Execution shape (for the plan)

Four large tasks, one review at the end: (1) DB + validator + API public flow; (2) ops API + roles + wallet-proof grant hook + emails + CLI; (3) web public pages + Home card; (4) web ops pages + docs (decision register/ADR/architecture/domain docs rewritten in place).

## 13. Open items

- Email copy/branding and the sender domain for Resend.
- Whether rejected applicants may re-apply after a cooldown (currently: may re-apply immediately since the unique index excludes rejected).
