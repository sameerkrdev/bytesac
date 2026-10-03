# Bytesac web

Next.js 16 client for Bytesac (wallet sign-in, profile, contacts, sessions).

## Development

```bash
pnpm --filter web dev      # http://localhost:3000
pnpm --filter web lint
pnpm --filter web check-types
pnpm --filter web test
pnpm --filter web build
```

`API_ORIGIN` (default `http://localhost:4000`) is the API the `/api/*` rewrite proxies to.

### Web push (optional)

Browser push for notifications uses Firebase Cloud Messaging. The toggle in Profile, notifications section, is hidden unless every variable below is set (public web-app identifiers, not secrets) and the browser supports push:

| Variable | Value (Firebase console) |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Project settings, your web app, `apiKey` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Cloud Messaging, Web Push certificates, key pair (public key) |

`public/firebase-messaging-sw.js` loads the Firebase compat scripts from `gstatic.com` at the same version as the `firebase` dependency (12.19.0); change both together. The page passes its public config to the service worker in the registration URL, so no secret or env is baked into the file. The CSP allows `https://www.gstatic.com` scripts and the FCM and Installations APIs. The API side needs `FIREBASE_SERVICE_ACCOUNT` (see `apps/api/README.md`).

## App shell and page states (Spec 15)

`components/layout/app-shell.tsx` is the single shell (header, mobile menu, bottom padding at 360 px); `nav.ts` builds role-aware navigation from `/me`: Investor (Discover, Portfolio, Notifications, Profile), Manager (organization pages, shown with an organization membership) and Ops (platform roles). Navigation is a UI guard only; the API enforces permissions. `page-layout.tsx` gives every page a title and width, and `states.tsx` holds the shared loading, empty, error and stale states. Money-flow logic (leg signer, fee lines, portfolio actions) comes from `@repo/app-core`; the web only supplies its `Signer`.

## Fees and earnings (Spec 10)

Previews in the invest wizard, rebalance review, repair and sell dialogs render `operation.fees[]` with `components/invest/fee-lines.tsx` (one line per fee, a waived fee with its reason, the total and the no-refund note); `lib/fees.ts` holds the shared rate text ("1% up to $50") and operation labels. Routes: `/ops/fees` (default schedule, history and overrides; `ops_admin` edits, reviewers read), `/ops/revenue`, `/organization/earnings` (needs `earnings.read`, linked from the organization page) and the public `/fees`. CSV exports are plain links to `/api/v1/.../earnings` and `/api/v1/ops/revenue` with `format=csv` (cookie auth through the rewrite). The basket wizard has an optional "Maximum (USDC, optional)" next to a percent fee. Management and subscription fees show "Disclosed — not collected in this release". Hiding a page or button is a UI guard only; the API enforces every permission.

## Deployment

The web app proxies `/api/*` to the API with a Next.js rewrite. That rewrite **neither sets nor sanitizes `X-Forwarded-For`**, so the deployment must guarantee client IP integrity:

- The edge / load balancer in front of Next must **overwrite** `X-Forwarded-For` with the real client IP. Do not append to a client-supplied value.
- The API's `TRUST_PROXY` must trust only the Next server hop (its private CIDR, or loopback when co-located), not the entire chain.
- If either is wrong, the API's per-IP rate limits and the session `ip_prefix` become spoofable, or collapse into a single global bucket.

Security headers (HSTS, Permissions-Policy, a report-only CSP with `object-src 'none'`, `base-uri 'self'` and `form-action 'self'`, frame and referrer policy) are set in `next.config.js`. There is no report endpoint yet (violations reach only the browser console): add collection, then promote `Content-Security-Policy-Report-Only` to an enforcing `Content-Security-Policy`.
