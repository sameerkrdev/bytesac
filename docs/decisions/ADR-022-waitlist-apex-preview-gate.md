# ADR-022: Apex waitlist, app subdomain, soft-launch preview gate

## Status

APPROVED (2026-10-10)

## Context

Bytesac needs a public waitlist on the marketing apex while the product stays on `app.` for internal testing before a wide launch.

## Decision

- **One Next.js container** on port 3000 serves both hosts; nginx routes `bytesac.com` and `app.bytesac.com` to it. `proxy.ts` routes by host: the apex serves `/` (rewritten to `/waitlist`), `/waitlist`, `/how-it-works`, `/self-custody`, `/for-managers` and `/help/*` (`MARKETING_PATHS` in `apps/web/lib/surface.ts`) and redirects everything else to the app host; the app host redirects `/` to `/home`. Public files (any path ending in a file extension, and `/_next/`) and `/api/*` (Next rewrite to the API; required for same-origin waitlist join) are never gated or redirected.
- **Apex page** is the marketing landing in waitlist mode: `proxy.ts` sets the `x-bx-surface: marketing` request header (and strips any client-sent copy), the root layout passes it down as a surface context, and every call to action becomes "Join the waitlist" (form in the closing section, `#join`). Header and footer link only to apex pages. The live basket rail is left out because the API is gated.
- **Waitlist** signups are stored in `app.waitlist_signups` (upsert by email). The welcome email goes out once: on the first join, or on a later join if it never went out; a send failure never fails the join (`emailSent: false` in the response). Welcome mail uses `WAITLIST_EMAIL_FROM` (Sameer, cofounder voice) and is built from `@repo/design-tokens` (light and dark); transactional mail keeps `EMAIL_FROM`.
- **Preview gate** is optional env (`PREVIEW_GATE_JWT_SECRET` + email + password). When set, the API rejects requests without a valid 7-day gate token (401 `PREVIEW_GATE_REQUIRED`) except `/health`, `POST /v1/public/waitlist` and `POST /v1/preview-gate/login` (wrong credentials: 401 `PREVIEW_GATE_DENIED`, compared in constant time). The web carries the token in the httpOnly `bx_preview` cookie, enforced on the app host by `proxy.ts`; server components forward it to the API (`apps/web/lib/server-api.ts`). The mobile app (`X-Client: mobile`) gets the token in the login response body, keeps it in the secure store and sends it as `X-Preview-Token`; builds for the soft launch set `EXPO_PUBLIC_PREVIEW_GATE=1` to show the team login before the wallet sign-in, and an expired token reopens it. `/preview-access` only follows same-site `next` paths.

## Consequences

- `ALLOWED_ORIGINS` must list both `https://bytesac.com` and `https://app.bytesac.com`.
- Resend must verify `bytesac.com` (or the chosen From domain) for founder waitlist mail.
- Soft-launch mobile builds need `EXPO_PUBLIC_PREVIEW_GATE=1`; public builds leave it unset (and the API gate off).
