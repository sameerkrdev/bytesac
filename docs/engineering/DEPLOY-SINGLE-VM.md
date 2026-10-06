# Running Bytesac on one VM (free for a pilot)

> Deploying on Google Cloud with Supabase? Follow the step-by-step runbook in `DEPLOY-GCP.md` (every account, env value
> and command). This page compares hosting options and summarises the kit.

A low-cost way to run the whole platform for a pilot of about two months: one Linux VM runs Caddy (HTTPS), the web
app, the API, the worker and Redis with `deploy/docker-compose.yml`; PostgreSQL is Supabase's free plan (or the
optional self-hosted container). It follows every requirement in `DEPLOYMENT.md` (non-evicting Redis, an always-on
worker, `X-Forwarded-For` overwritten at the edge, `TRUST_PROXY` limited to the internal hops).

> This is a **pilot setup**, not the production architecture (no redundancy, one machine). Free-tier terms change;
> confirm each provider's current limits when you sign up. Checked 2026-10-06.

## 1. Where to host for free

### Recommended: Oracle Cloud Always Free + Supabase Free

| Piece | Service | Free allowance (as of 2026-10) | Watch out for |
|---|---|---|---|
| VM for web, API, worker, Redis, Caddy | **Oracle Cloud Always Free**, Ampere A1 (arm64) | 2 OCPU / 12 GB RAM for free-tier accounts (halved from 4/24 on 2026-06-15), 200 GB block storage, generous egress | Card verification at sign-up; "out of host capacity" for A1 in busy regions (retry, or another home region); Oracle can reclaim **idle** Always Free instances. Upgrading the account to Pay-As-You-Go keeps Always Free resources at $0 and avoids reclamation; set a budget alert. |
| PostgreSQL | **Supabase Free** | 500 MB database, 2 projects; `pg_cron` and `pgvector` are available | Pauses after 7 days without activity (a live pilot keeps it awake); no point-in-time recovery: take `pg_dump` backups yourself. |
| Files | **Cloudflare R2** | Free monthly storage and operations allowance | Needs a Cloudflare account; set the CORS and lifecycle rules (`DEPLOYMENT.md`). |
| DNS and TLS | **DuckDNS** (free subdomains) or a domain (~$10/year); Caddy issues Let's Encrypt certificates | Free | Two names: one for the web app, one for the API (the mobile app calls the API directly). |

Why not the usual free tiers:

- **Vercel Hobby** is for personal, non-commercial use only; Bytesac is commercial.
- **Render Free** spins web services down after 15 minutes and has no background workers; the worker must always run.
- **Upstash Free** (500,000 commands a month) is too small for BullMQ, which polls Redis continuously; Redis runs on
  the VM instead.
- **Fly.io and Railway** no longer offer a standing free tier (trial credit only).

### Alternative: Google Cloud free trial

New Google Cloud accounts get **$300 of credit for 90 days**, which covers two months of a single `e2-standard-2`
(2 vCPU, 8 GB) VM running the same compose file. It is easier to get capacity than Oracle's A1, but it ends after 90
days and needs a card.

### What is not free

- **Gas for the platform wallets:** the Solana fee payer needs SOL and the EVM gas wallet needs native gas on each EVM
  chain (`DEPLOYMENT.md` §13). This is real money; keep the balances small for a pilot.
- **SMS:** Twilio trial accounts only send to verified numbers. Real users need a paid Twilio account (pay per SMS).
- **App stores:** Google Play is a one-time $25 fee and the Apple Developer Program is $99 a year. For a pilot you
  can share Android builds from EAS directly (internal distribution) without the Play Store.
- Free API keys exist for Alchemy, LI.FI, CoinMarketCap, Resend and Gemini, each with rate or volume limits. On the
  Gemini free tier Google may use prompts to improve its products; review that before enabling AI search.

## 2. Prepare the VM

1. Create the instance: Ubuntu 24.04 (arm64 on Oracle A1), at least 2 vCPU and 8 GB RAM, 50 GB disk.
2. Open inbound **TCP 80 and 443** (and UDP 443 for HTTP/3) in the cloud firewall (Oracle: the subnet's security list
   and the instance's `iptables`/`ufw`). Keep SSH limited to your IP.
3. Install Docker Engine and the Compose plugin (`https://docs.docker.com/engine/install/ubuntu/`), then add your
   user to the `docker` group.
4. Point both DNS names (`WEB_DOMAIN`, `API_DOMAIN`) at the VM's public IP.

## 3. Prepare the services

1. **Supabase:** create a project, enable the `pg_cron` and `vector` extensions, and keep the connection strings:
   the `postgres` role for migrations (`MIGRATOR_DATABASE_URL`) and the pooler URL for the runtime role
   (`DATABASE_URL`, set its password after migrating, step 5).
2. **R2:** create the bucket, API token, CORS rule (`PUT` from `https://<WEB_DOMAIN>`) and lifecycle rule.
3. Collect the provider keys listed in `DEPLOYMENT.md` §2.3.

## 4. Configure

On the VM:

```bash
git clone https://github.com/sameerkrdev/bytesac.git && cd bytesac/deploy
cp .env.example .env                       # WEB_DOMAIN, API_DOMAIN, ACME_EMAIL, NEXT_PUBLIC_*
cp ../apps/api/.env.example api.env        # API + worker settings and secrets
echo "MIGRATOR_DATABASE_URL=postgresql://postgres:<password>@<supabase-host>:5432/postgres" > migrate.env
chmod 600 .env api.env migrate.env
```

In `api.env` set at least:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase pooler URL with the `bytesac_api` role |
| `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET` | `openssl rand -hex 32` each |
| `AUTH_DOMAIN` | your web domain, for example `app.example.com` |
| `AUTH_URI` | `https://app.example.com` |
| `ALLOWED_ORIGINS` | `https://app.example.com` |
| `COOKIE_SECURE` | `true` |
| Provider keys | Resend, Twilio, Alchemy, R2 (required); LI.FI, CoinMarketCap, Gemini, Firebase, Expo (optional) |
| Platform wallets | only when you are ready to execute real investments (§1, "What is not free") |

The compose file sets `REDIS_URL` (the local Redis), `PORT` and `TRUST_PROXY` for you; values in `api.env` for
those are overridden.

## 5. Build, migrate, start

```bash
docker compose build                                   # builds bytesac-api, bytesac-web (on the VM: arm64 on Oracle A1)
docker compose --profile tools run --rm migrate        # applies packages/db/migrations to Supabase
```

Then, in the Supabase SQL editor, give the runtime role its password and put it in `DATABASE_URL`:

```sql
ALTER ROLE bytesac_api LOGIN PASSWORD '<a long random password>';
```

Start everything:

```bash
docker compose up -d
docker compose ps                                      # caddy, web, api (healthy), worker, redis
curl -fsS https://<API_DOMAIN>/health                  # {"status":"ok","db":"ok","redis":"ok"}
```

Make yourself an operator (after signing in once on the web app, take your user id from `app.users`):

```bash
docker compose --profile tools run --rm cli ops:grant-role -- --user <uuid> --role ops_admin --operator you@example.com
```

The `cli` service runs the audited ops commands (`ops:*` in `apps/api/package.json`) from the tools image with the
same `api.env`.

## 6. Mobile builds for the pilot

Build with EAS using the public API domain: set `EXPO_PUBLIC_API_URL=https://<API_DOMAIN>`,
`EXPO_PUBLIC_REOWN_PROJECT_ID` and `EXPO_PUBLIC_WEB_URL=https://<WEB_DOMAIN>` (EAS environment variables or a build
profile), then share the Android build through EAS internal distribution. See `apps/mobile/README.md`.

## 7. Operate

| Task | Command |
|---|---|
| Logs | `docker compose logs -f api worker web` |
| Update to a new version | `git pull && docker compose build && docker compose --profile tools run --rm migrate && docker compose up -d` |
| Restart one service | `docker compose restart worker` |
| Back up the database | `pg_dump "$MIGRATOR_DATABASE_URL" -Fc -f bytesac-$(date +%F).dump` (daily, kept off the VM) |
| Disk usage | `docker system df`, prune old images with `docker image prune` |

Release order and rollback follow `DEPLOYMENT.md` §12: migrations are additive, so roll back by redeploying the
previous image, never by reverting a migration.

## 8. Moving on from the pilot

When the pilot ends, move to the production architecture in `DEPLOYMENT.md`: managed hosting with at least two API
instances, a paid Supabase plan with point-in-time recovery, managed non-evicting Redis, platform wallet keys in a KMS,
and CI/CD building these same Dockerfiles.
