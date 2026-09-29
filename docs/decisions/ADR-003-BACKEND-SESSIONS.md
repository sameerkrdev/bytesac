# ADR-003: Backend-managed sessions

- **Status:** APPROVED
- **Date:** 2026-09-29
- **Owners:** Backend / Identity
- **Related:** D-003, D-031, D-037; `docs/domains/USER-AUTHENTICATION.md`; `docs/superpowers/specs/2026-09-29-foundation-user-auth-design.md` §5.3

## Context
`docs/source/User-Authentication-Flow.txt` describes a Supabase session as the application session. The user chose instead to run Supabase as PostgreSQL only and to have the backend own sessions. Wallet sign-in (SIWE/SIWS) is verified by our API, so the API is the natural session issuer, and we need exact control over revocation, expiry, rotation and suspension.

## Decision
- The backend issues sessions and stores them in the `sessions` table. Supabase Auth, its JWTs and the Supabase Data API are not used.
- Token: opaque, 32 random bytes (base64url). Only a keyed hash (SHA-256 over token plus `SESSION_TOKEN_PEPPER`) is stored.
- Web transport: `HttpOnly; Secure; SameSite=Lax` cookie set through the same-origin Next proxy; 12 h idle / 7 d absolute.
- Mobile transport: the same token as a bearer, kept in `expo-secure-store`, sent with header `X-Client: mobile`; 7 d idle / 30 d absolute.
- Idle expiry is sliding (at most one write per 5 minutes); the token does not change on renewal.
- Rotation happens on security events (currently a successful "Add chain account"): a new session is issued and the old one is revoked with reason `rotated`. A revoked session cannot be rotated.
- Expiry and revocation are checked with database time on every request, with no caching, so logout and suspension apply on the next request. Suspension revokes all sessions.

## Alternatives considered
- Supabase custom JWT — advantages: stateless verification, works with Supabase RLS. Disadvantages: revocation and suspension need short lifetimes or a denylist, tokens carry claims we would have to keep consistent, and it ties authorization to a provider we use only as a database.
- Supabase Web3 sign-in — advantages: less code. Disadvantages: it does not cover our chain-account association rules, ERC-1271/6492 verification or challenge state machine, and it makes Supabase the identity issuer, contrary to the product decision.

## Consequences
### Positive
- Immediate revocation, logout-all, per-session listing and suspension.
- Provider independence: the database can move without touching identity.

### Negative / trade-offs
- We own expiry, revocation and token-hashing correctness and must test them.
- One session lookup per authenticated request.

### Security, financial and operational impact
- A database leak exposes hashes only; the pepper is a server secret.
- Cookie auth requires the CSRF/Origin guard and a same-origin topology; the API sends no CORS headers.
- A session is authentication only; it is never spending authorization.

## Migration / rollout
New tables in the first migration; no existing sessions to migrate. This supersedes the source's Supabase-session wording.

## Validation
Integration tests in `apps/api/test/identity/*`: idle and absolute expiry for both clients, revocation, suspension, concurrent renewal, rotation and old-token rejection, logout-all, cross-user revoke returning 404, CSRF/CORS behavior.

## Open questions
- Automated suspicious-session detection is deferred to a later spec.
