# ADR-007: Manager application, platform screening and wallet-proof permission grant

- **Status:** APPROVED
- **Date:** 2026-09-30
- **Owners:** Backend / Platform
- **Related:** D-004, D-033, D-038, D-040, D-042, D-043, D-044; ADR-003, ADR-004, ADR-006; `docs/superpowers/specs/2026-09-29-manager-application-screening-design.md`

## Context
The supplied onboarding flow has the platform request and verify a wallet after screening, then associate or create a user. Creating a user from an unproven address would break the rule that a typed address is never proof, and the platform had no surface or role model for screening staff.

## Decision
- **Hybrid wallet proof (refines D-004).** The public application records a chain and typed address as an identifier only. Approval waits for proof: when the applicant signs in (or adds a chain account) with the exact address, `create_manager_organization` is granted inside the same transaction; if a proven, active user already owns the address at approval, it is granted immediately. No invite tokens and no pending-user rows. Disabled addresses and non-active users never receive it. EVM: an EOA signature on any EVM chain, or ERC-1271/6492 only when the verified chain equals the submitted chain; Solana: ed25519.
- **Race-safe grant.** The grant hook locks the open application by `(wallet_family, wallet_address)` without a status filter and checks status, `wallet_proven_at` and chain under the lock. Filtering on `SCREENING_APPROVED` in the query would let a concurrent approve and first sign-in each miss the other's uncommitted row and grant nothing. The grant is idempotent (partial unique index on active `(user_id, permission)`).
- **Ops surface.** `/ops` in the web app, guarded server-side on every API call by `requireRole` (`ops_reviewer`; `ops_admin` satisfies it). Roles live in `platform_roles`, are read from the database per request, are granted and revoked by admins in the UI (the last admin cannot be revoked) and are bootstrapped by the `ops:grant-role` CLI. Every ops action is audited with operator user id and request id. `GET /v1/me` exposes `permissions` and `platformRoles` for UI guards only.
- **Applicant communication.** Contact happens outside the app. Ops records status, internal notes and an optional message. Applicants get Resend emails for the code, the status link, contacted, information required, approved and rejected (failures are logged, never roll back a status change). The status link is `/managers/status#<token>`: a 32-byte random token, only its HMAC stored, sent as an `X-Application-Token` header so it never appears in URLs sent to servers or in logs. One reply is allowed while `ADDITIONAL_INFORMATION_REQUIRED`.
- **Abuse protection.** Mandatory email confirmation with a 6-digit code (10 min, 5 attempts, 60 s resend cooldown) before the application enters the queue; create 5/h per IP and 3/day per email, resend 5/h per email, status and reply 30/min per IP, ops 120/min per user. No captcha in release 1. If the code email fails on submit, the API responds 503 `OTP_DELIVERY_FAILED` with `details.applicationId` so the applicant can resend instead of being blocked by the open-application unique index.
- **Retention.** `app.purge_expired()` also removes `EMAIL_PENDING` applications older than 24 h together with their codes and events, and application email codes resolved more than 90 days ago.
- **No self-approval.** Reviewers cannot act on an application whose wallet they own (403 `FORBIDDEN`), and `grantIfProven` skips the grant when the signing-in user is the application's `decided_by_user_id`, writing an application note and a `permission.grant_skipped_self_approval` audit entry. That application stays unproven; another reviewer rejects it and the applicant re-applies.
- **Statuses** are a single transition table (`APPLICATION_TRANSITIONS` in `@repo/validator`) shared by API and UI; an unrecognized move is `INVALID_TRANSITION` (409). One open application per email and per wallet family and address; rejected applications may re-apply.

## Alternatives considered
- Pending user created from the typed address: rejected, an unproven address must not create or link a user.
- Invite token sent to the applicant: extra secret and flow; the normal sign-in already proves the address.
- Ops through CLI only or a separate admin app: too slow for reviewers or a second deployable for a small queue.
- Captcha: deferred; email confirmation plus limits is enough for release 1.

## Consequences
### Positive
- No unproven identity is ever created; the permission follows the existing signature flow.
- One small role model and one screening surface; all actions audited.

### Negative / trade-offs
- An applicant who signs in with a different wallet is not granted; ops must fix the address by rejecting and re-applying.
- An approved-but-unproven application can be rejected (`SCREENING_APPROVED → SCREENING_REJECTED`) so a mistaken approval can be undone; once the wallet is proven it is final.
- Ops may return `ADDITIONAL_INFORMATION_REQUIRED` to `SCREENING` without an applicant reply.
- Status emails have no retry queue: a failed status email is logged and not retried by later status actions (the spec text assumed a retry).
- Applicant rate-limit points are not refunded on duplicate or failed sends.

### Security, financial and operational impact
- Application PII is readable only by ops roles and redacted from logs by key; no financial movement is involved.
- The status token is a bearer secret held by the applicant; rejecting the application ends its usefulness.

## Migration / rollout
Migrations `0003_manager_applications` (five tables, enums, grants, RLS) and `0004_purge_applications`. Bootstrap the first admin with `pnpm --filter api ops:grant-role`. Mobile is unchanged.

## Validation
API integration tests cover the public flow, rate limits, duplicates, ops role checks, last-admin guard, grant at approval and at sign-in (EOA, smart wallet, Solana), disabled address and suspended user, approve and sign-in overlapping in both lock orders, self-approval, and the purge. Web tests cover the apply form, status page, ops transition form, access-lost state and role management.

## Open questions
- Email copy and the Resend sender domain.
- Whether rejected applicants should wait a cooldown before re-applying.
