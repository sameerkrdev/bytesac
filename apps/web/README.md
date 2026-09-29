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

## Deployment

The web app proxies `/api/*` to the API with a Next.js rewrite. That rewrite **neither sets nor sanitizes `X-Forwarded-For`**, so the deployment must guarantee client IP integrity:

- The edge / load balancer in front of Next must **overwrite** `X-Forwarded-For` with the real client IP. Do not append to a client-supplied value.
- The API's `TRUST_PROXY` must trust only the Next server hop (its private CIDR, or loopback when co-located), not the entire chain.
- If either is wrong, the API's per-IP rate limits and the session `ip_prefix` become spoofable, or collapse into a single global bucket.

Security headers (HSTS, Permissions-Policy, a report-only CSP, frame and referrer policy) are set in `next.config.js`. Review CSP reports, then promote `Content-Security-Policy-Report-Only` to an enforcing `Content-Security-Policy`.
