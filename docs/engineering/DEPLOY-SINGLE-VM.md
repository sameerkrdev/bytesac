# Running Bytesac on one VM (free for a pilot)

> This page compares hosting options. The step-by-step runbook (accounts, env values, rootless Docker, nginx, CI/CD)
> is `DEPLOY-GCP.md`; its server steps apply to any Ubuntu 24.04 VM, including Oracle.

A low-cost way to run the whole platform for a pilot of about two months: one Linux VM runs nginx (HTTPS, installed on
the VM) in front of the web app, the API, the worker and Redis, which run in rootless Docker from
`infra/server/docker-compose.yml`; PostgreSQL is Supabase's free plan (or the optional self-hosted container). It follows every requirement in `DEPLOYMENT.md` (non-evicting Redis, an always-on
worker, `X-Forwarded-For` overwritten at the edge, `TRUST_PROXY` limited to the internal hops).

> This is a **pilot setup**, not the production architecture (no redundancy, one machine). Free-tier terms change;
> confirm each provider's current limits when you sign up. Checked 2026-10-06.

## 1. Where to host for free

### Recommended: Oracle Cloud Always Free + Supabase Free

| Piece | Service | Free allowance (as of 2026-10) | Watch out for |
|---|---|---|---|
| VM for web, API, worker, Redis, nginx | **Oracle Cloud Always Free**, Ampere A1 (arm64) | 2 OCPU / 12 GB RAM for free-tier accounts (halved from 4/24 on 2026-06-15), 200 GB block storage, generous egress | Card verification at sign-up; "out of host capacity" for A1 in busy regions (retry, or another home region); Oracle can reclaim **idle** Always Free instances. Upgrading the account to Pay-As-You-Go keeps Always Free resources at $0 and avoids reclamation; set a budget alert. |
| PostgreSQL | **Supabase Free** | 500 MB database, 2 projects; `pg_cron` and `pgvector` are available | Pauses after 7 days without activity (a live pilot keeps it awake); no point-in-time recovery: take `pg_dump` backups yourself. |
| Files | **Cloudflare R2** | Free monthly storage and operations allowance | Needs a Cloudflare account; set the CORS and lifecycle rules (`DEPLOYMENT.md`). |
| DNS and TLS | **DuckDNS** (free subdomains) or a domain (~$10/year); certbot issues Let's Encrypt certificates for nginx | Free | Two names: one for the web app, one for the API (the mobile app calls the API directly). |

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

## 2. Set it up

Follow `DEPLOY-GCP.md` from §3 (DNS) onwards; only §2 (creating the VM) is Google-specific. On Oracle A1:

- Ubuntu 24.04 **arm64**, at least 2 OCPU / 8 GB RAM and 50 GB disk; the images build natively on the VM.
- Open inbound TCP 80 and 443 in the subnet's security list **and** in the instance firewall (Oracle images ship
  restrictive `iptables` rules). Keep SSH limited to your IP.
- The GitHub Actions deploy in `DEPLOY-GCP.md` §22 uses Google's IAP tunnel; on Oracle, run
  `infra/server/deploy.sh <commit>` by hand or adapt the workflow to Oracle's Bastion service.

## 8. Moving on from the pilot

When the pilot ends, move to the production architecture in `DEPLOYMENT.md`: managed hosting with at least two API
instances, a paid Supabase plan with point-in-time recovery, managed non-evicting Redis, platform wallet keys in a KMS,
and CI/CD building these same Dockerfiles.
