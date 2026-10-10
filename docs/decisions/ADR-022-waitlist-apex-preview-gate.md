# ADR-022: Apex waitlist, app subdomain, soft-launch preview gate

## Status

APPROVED (2026-10-10)

## Context

Bytesac needs a public waitlist on the marketing apex while the product stays on `app.` for internal testing before a wide launch.

## Decision

- **One Next.js container** on port 3000 serves both hosts; nginx routes `bytesac.com` and `app.bytesac.com` to it. Host-based middleware shows the waitlist on the apex and redirects the app host `/` to `/home`.
- **Waitlist** signups are stored in `app.waitlist_signups` (upsert by email, welcome email only on first insert). Welcome mail uses `WAITLIST_EMAIL_FROM` (Sameer, cofounder voice); transactional mail keeps `EMAIL_FROM`.
- **Preview gate** is optional env (`PREVIEW_GATE_JWT_SECRET` + email + password). When set, the API rejects requests without a valid 7-day `bx_preview` cookie except `/health`, `POST /v1/public/waitlist`, and `POST /v1/preview-gate/login`. Next middleware enforces the same cookie on the app host.

## Consequences

- `ALLOWED_ORIGINS` must list both `https://bytesac.com` and `https://app.bytesac.com`.
- Resend must verify `bytesac.com` (or the chosen From domain) for founder waitlist mail.
- Mobile API clients need the gate disabled or a future bypass until public launch.
