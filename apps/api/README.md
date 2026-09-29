# Bytesac API

## Overview

Express 5 + TypeScript API for Bytesac (initial settlement currency: USDC on Solana). This foundation covers wallet sign-in (SIWE/SIWS challenge and verify), sessions, linked chain accounts, contact verification (email and SMS OTP), notification preferences, audited ops commands and a retention worker. Postgres (schema `app`, Drizzle) is the system of record; Redis backs rate limits and the job queue.

## Local setup

```bash
pnpm db:up                                  # Postgres + Redis via Docker
cp apps/api/.env.example apps/api/.env      # then fill in secrets
openssl rand -hex 32                        # run twice: SESSION_TOKEN_PEPPER and OTP_HMAC_SECRET
pnpm --filter api db:migrate
pnpm --filter api db:dev-roles              # sets local passwords for bytesac_api / bytesac_retention
pnpm --filter api dev
```

Provider keys (`ALCHEMY_API_KEY`, `RESEND_API_KEY`, `TWILIO_*`) are required by the env schema; placeholders are fine locally unless you exercise those paths.

## Supabase setup

1. Run migrations with the project's `postgres` role as `MIGRATOR_DATABASE_URL` (`pnpm --filter api db:migrate`).
2. As an operator, run `ALTER ROLE bytesac_api LOGIN PASSWORD '<secret>'` and the same for `bytesac_retention`.
3. Use the pooler URL with those roles for `DATABASE_URL` and `RETENTION_DATABASE_URL`.
4. Confirm schema `app` is **not** listed in Dashboard -> API -> Exposed schemas.

## Tests

```bash
pnpm --filter api test    # requires Docker (pnpm db:up)
```

## Worker

```bash
pnpm --filter api worker
```

Schedules a BullMQ job daily at 03:00 UTC that purges expired auth challenges (kept when referenced by a wallet address), old sessions and contact verifications, and writes a `retention.purged` audit event. Requires `RETENTION_DATABASE_URL`.

## Ops commands

An operator identity (`--operator`) and a reason are required; every command is audited.

```bash
pnpm --filter api ops:address-disable -- --chain base --address 0xabc... --reason "fraud report" --operator alice@bytesac.example
pnpm --filter api ops:address-reactivate -- --chain base --address 0xabc... --operator alice@bytesac.example
pnpm --filter api ops:user-suspend -- --user <user-uuid> --reason "compliance hold" --operator alice@bytesac.example
```

## Security notes

- No CORS: browsers are not a supported cross-origin client. Web uses same-site cookies; mobile uses bearer tokens.
- Cookie-authenticated mutating requests require the CSRF client header (see `src/http/security.ts`).
- Session cookie is HttpOnly and `Secure` in production (`COOKIE_SECURE`).
- `TRUST_PROXY` controls how the client IP is derived (rate limits, audit). In production behind a load balancer or CDN, set the hop count (for example `TRUST_PROXY=1`); a wrong value lets clients spoof their IP. Digits are a hop count, `true`/`false` a boolean, anything else an IP/CIDR/keyword list.
- Never log secrets, OTP codes, tokens, or full contact values.
- Wallet sign-in is authentication only; it is not spending authorization.
