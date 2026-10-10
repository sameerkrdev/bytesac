# Spec 20 — Waitlist, apex domain, soft-launch preview gate

## Intent

Public waitlist on `bytesac.com`; product on `app.bytesac.com` with an optional team email/password gate before wallet sign-in.

## Decisions (brainstorm 2026-10-10)

| Topic | Decision |
|---|---|
| Hosting | One Next.js on :3000, host-based middleware |
| Gate | Whole `app.` host + API (except health, waitlist, gate login) |
| Duplicate email | Upsert, no second welcome email |
| Gate creds | Env email + password + JWT secret, 7-day cookie |
| Waitlist From | `WAITLIST_EMAIL_FROM` = Sameer @ bytesac.com |
| App `/` | Redirect to `/home` (marketing on apex only) |

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/v1/public/waitlist` | Public, rate-limited, CSRF Origin |
| POST | `/v1/preview-gate/login` | Public when gate enabled |
| POST | `/v1/preview-gate/logout` | Public |

## Data

`app.waitlist_signups` — unique email (case-insensitive), name, optional phone/country, `welcome_email_sent_at`.

## Out of scope

SMS confirmation, public open app, mobile waitlist UI, CMS.

## ADR

ADR-022, D-122.
