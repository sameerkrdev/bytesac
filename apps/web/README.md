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

## Deployment

The web app proxies `/api/*` to the API with a Next.js rewrite. That rewrite **neither sets nor sanitizes `X-Forwarded-For`**, so the deployment must guarantee client IP integrity:

- The edge / load balancer in front of Next must **overwrite** `X-Forwarded-For` with the real client IP. Do not append to a client-supplied value.
- The API's `TRUST_PROXY` must trust only the Next server hop (its private CIDR, or loopback when co-located), not the entire chain.
- If either is wrong, the API's per-IP rate limits and the session `ip_prefix` become spoofable, or collapse into a single global bucket.

Security headers (HSTS, Permissions-Policy, a report-only CSP, frame and referrer policy) are set in `next.config.js`. Review CSP reports, then promote `Content-Security-Policy-Report-Only` to an enforcing `Content-Security-Policy`.
