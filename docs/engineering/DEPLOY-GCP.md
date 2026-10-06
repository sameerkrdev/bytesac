# Deploying Bytesac on Google Cloud (step by step)

The complete runbook for the chosen pilot setup: **one Google Cloud VM** runs the web app, API, worker, Redis and
Caddy (HTTPS) with `deploy/docker-compose.yml`; **PostgreSQL is Supabase**; files are in **Cloudflare R2**; the
Android app ships as an **APK** built with EAS. Follow the sections in order. Every value you collect goes into one of
four files, shown in §15.

> Never paste secrets into chats, tickets or commits. Keep them in a password manager until you write them into the
> files on the server. Provider dashboards change their wording over time; if a button is named differently, look for
> the same setting nearby. Checked against the code on 2026-10-06.

---

## 0. The setup at a glance

```text
                 Users (browser)                    Users (Android APK)
                       │ https://app.example.com           │ https://api.example.com
                       ▼                                    ▼
   ┌──────────────── Google Cloud VM (Ubuntu 24.04, Docker Compose) ───────────────┐
   │  Caddy :443  ──►  web (Next.js :3000) ── /api/* rewrite ──►  api (Express :4000) │
   │       └──────────────────────────────────────────────────────►  api              │
   │                                         worker (BullMQ) ─┐   │                  │
   │                                         redis (no-evict) ◄┴───┘                  │
   └───────────────────────────────────────────────┬──────────────────────────────────┘
                                                   │ IPv4 pooler
                       Supabase PostgreSQL ◄───────┘        Cloudflare R2 (browser uploads with signed URLs)
```

| Runs where | What |
|---|---|
| GCP VM | Caddy, web, api, worker, redis (all from `deploy/docker-compose.yml`) |
| Supabase | PostgreSQL 17 with `pg_cron` and `pgvector` |
| Cloudflare R2 | Organization documents, basket files, asset logos |
| EAS (Expo) | Android APK builds |
| Providers | Reown (wallets), Alchemy (chain data), LI.FI (routing), Resend (email), Twilio (SMS), CoinMarketCap (prices), Gemini (AI search), Firebase (web push) |

### Why Caddy and not nginx

Both work. This repository ships **Caddy** (`deploy/Caddyfile`) because for this setup it is simpler and safer:

| | Caddy | nginx |
|---|---|---|
| HTTPS certificates | Automatic (gets and renews Let's Encrypt itself) | Needs certbot, a renewal timer and a reload hook |
| Client IP (`X-Forwarded-For`) | Ignores values sent by clients and sets the real IP by default, which the API's rate limits require | Must be configured by hand: `proxy_set_header X-Forwarded-For $remote_addr;` (the common `$proxy_add_x_forwarded_for` lets clients spoof their IP) |
| Config for this app | 12 lines, already written and validated | About 40 lines plus certbot setup, not in the repository |
| HTTP/3, compression | Built in | Extra modules and config |

Use nginx only if your team already runs it everywhere. In that case keep the two rules above.

---

## 1. Prerequisites

### On your laptop

- A browser and this repository (for reading the docs).
- Node.js 24 and Git, to run `npx eas-cli@latest` for the Android build (§18).
- An SSH client is optional: the Google Cloud console has a browser SSH button.

### Accounts to create

| # | Service | Needed for | Cost for the pilot |
|---|---|---|---|
| 1 | Google Cloud | The server | $300 trial credit (90 days) covers it |
| 2 | Your domain's DNS provider | `app.` and `api.` records | You already have a domain |
| 3 | GitHub access to `sameerkrdev/bytesac` | The server pulls the code | Free (deploy key) |
| 4 | Supabase | Database | Free plan |
| 5 | Cloudflare | R2 file storage | Free allowance |
| 6 | Reown Cloud | Wallet connection (web and mobile) | Free |
| 7 | Alchemy | Blockchain RPC | Free tier |
| 8 | Resend | Email codes and notifications | Free tier |
| 9 | Twilio | SMS codes | Trial credit; real SMS is paid per message |
| 10 | LI.FI | Swap and bridge routes for investing | Free API key |
| 11 | CoinMarketCap | Prices and performance | Free Basic plan |
| 12 | Google AI Studio (Gemini) | AI basket search (optional) | Free tier |
| 13 | Firebase | Web push (optional) | Free |
| 14 | Expo | Android APK builds | Free plan |

Not free: SOL and ETH in the platform wallets (§14) once you enable investing.

### Names used in this guide

Replace them everywhere:

| Placeholder | Example | Meaning |
|---|---|---|
| `app.example.com` | `app.bytesac.com` | The web app |
| `api.example.com` | `api.bytesac.com` | The API (the mobile app calls it directly) |
| `mail.example.com` | `mail.bytesac.com` | Email sending subdomain (Resend) |
| `<project-ref>` | `abcdwxyz` | Your Supabase project reference |

---

## 2. Google Cloud VM

1. Go to **cloud.google.com** → **Get started for free**, sign in, add a card (authorization hold only).
2. Create a project named `bytesac` and select it.
3. **Billing → Budgets & alerts → Create budget**: $50, alerts at 50 / 90 / 100 %.
4. **Compute Engine → VM instances** (click **Enable** for the API the first time).
5. **Create instance**:
   - Name `bytesac`; **Region** close to your users and to the Supabase region you will pick (for example
     `asia-south1` Mumbai, `us-central1` Iowa, `europe-west1` Belgium).
   - Machine: **E2 → e2-standard-2** (2 vCPU, 8 GB).
   - Boot disk: **Ubuntu 24.04 LTS (x86/64)**, Balanced persistent disk, **50 GB**.
   - Firewall: tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
   - **Create**.
6. **VPC network → IP addresses**: on the VM's external address choose **Promote to static IP**, name it
   `bytesac-ip`. Note the IP.
7. Optional, for HTTP/3: **VPC network → Firewall → Create rule** allowing **UDP 443** from `0.0.0.0/0` to the VM.
8. Click **SSH** on the VM and check: `lsb_release -d && nproc && free -h` (Ubuntu 24.04, 2 CPUs, ~8 GB).

Keep SSH open only through the console (it uses Google's identity-aware proxy) or restrict port 22 to your IP.

## 3. DNS

At your domain's DNS provider add:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `app` | VM static IP | DNS only (Cloudflare: grey cloud) |
| A | `api` | VM static IP | DNS only |

Resend adds its own records in §9. Check from your laptop: `nslookup app.example.com` returns the VM IP.

> Cloudflare proxy (orange cloud) is possible later, but then Caddy must trust Cloudflare's IP ranges and you must set
> `GEO_COUNTRY_HEADER=CF-IPCountry`. Keep it grey for the first deployment.

---

## 4. Supabase (PostgreSQL)

1. **supabase.com → New project**: name `bytesac`, a strong **database password** (save it), **region** the same as or
   near the VM, Free plan.
2. **Database → Extensions**: enable **pg_cron** and **vector**. Both are required before migrating.
3. **Project Settings → Data API** (or **API**): make sure schema **`app`** is **not** in the exposed schemas. Bytesac
   never uses the Supabase REST API.
4. Click **Connect** at the top of the project and copy two strings (replace `[YOUR-PASSWORD]`):
   - **Session pooler** (port **5432**, user `postgres.<project-ref>`): for migrations → `MIGRATOR_DATABASE_URL`.
   - **Transaction pooler** (port **6543**): for the app, but with the runtime user instead of `postgres`
     (§15.3, after §17.3).

   Do **not** use the "Direct connection" (`db.<project-ref>.supabase.co`): it is IPv6-only and a GCP VM is IPv4.
5. URL-encode special characters in passwords inside URLs (`@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`).
6. Free plan notes: 500 MB, pauses after 7 days without traffic, no point-in-time recovery (back up with §19).

## 5. Cloudflare R2 (files)

1. **dash.cloudflare.com → R2 Object Storage** (accept the R2 terms; the free allowance needs no plan).
2. **Create bucket** `bytesac-files`, location automatic. Leave **public access off**: no custom domain, no
   `r2.dev` URL.
3. Bucket → **Settings → CORS policy → Add CORS policy**, paste exactly (your web origin):

   ```json
   [
     {
       "AllowedOrigins": ["https://app.example.com"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Browsers upload directly to R2 with a signed `PUT` that carries only `Content-Type`. Downloads are signed links, so
   they need no CORS.
4. Bucket → **Settings → Object lifecycle rules → Add rule**: prefix `incoming/`, **delete objects after 1 day**
   (unconfirmed uploads land there).
5. **R2 → Manage R2 API tokens → Create API token**: permission **Object Read & Write**, scoped to `bytesac-files`.
   Save the **Access Key ID** and **Secret Access Key** (shown once). The **Account ID** is on the R2 overview page.

   → `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=bytesac-files`.

The API refuses to start without all four `R2_*` values.

## 6. Reown (wallet connection)

1. **cloud.reown.com** → sign up → **Create project** (type AppKit), name `Bytesac`.
2. Copy the **Project ID** → `NEXT_PUBLIC_REOWN_PROJECT_ID` (web) and `EXPO_PUBLIC_REOWN_PROJECT_ID` (mobile). One
   project can serve both.
3. Project → **Configuration → Domain** (allowlist): add `app.example.com`.
4. In the same configuration, add the **Android package / bundle ID** `com.bytesac.app` (the iOS bundle ID is the
   same if you build iOS later).
5. Allowlist changes take about **15 minutes** to apply. Without them, wallets warn users or refuse the connection.

## 7. Alchemy (chain data)

1. **alchemy.com** → create an **app** named `bytesac`.
2. Enable mainnet for: **Ethereum, Base, Arbitrum, BNB Smart Chain, Polygon, Solana, Bitcoin**. Bitcoin REST calls
   need Alchemy's UTXO / Bitcoin add-on on the key; enable it if your plan offers it.
3. Copy the **API key** → `ALCHEMY_API_KEY`.

## 8. LI.FI (routing)

1. **portal.li.fi** → sign in → create an **API key** → `LIFI_API_KEY`.
2. Keep `LIFI_INTEGRATOR=bytesac`. Without a key every quote fails with `ROUTE_UNAVAILABLE` (the site works, investing
   does not).

## 9. Resend (email)

1. **resend.com → Domains → Add domain**: `mail.example.com` (a subdomain keeps your main domain's mail separate).
2. Add the DNS records Resend shows (SPF/MX and DKIM `TXT`, optionally DMARC) at your DNS provider; wait until the
   domain shows **Verified**.
3. **API Keys → Create** with **Sending access** for that domain → `RESEND_API_KEY`.
4. `EMAIL_FROM=Bytesac <no-reply@mail.example.com>`.

## 10. Twilio (SMS verification)

1. **twilio.com** → sign up. Trial accounts can only text **verified** numbers; add your test numbers under
   **Verified Caller IDs**. Upgrade before real users sign up.
2. **Verify → Services → Create**: friendly name `Bytesac`, channel SMS → note the **Service SID** (`VA...`).
3. **Verify → Settings → Geo permissions**: enable the countries you allow.
4. **Account info**: **Account SID** (`AC...`) and **Auth Token**.

   → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`,
   `SMS_ALLOWED_COUNTRIES=IN,US,...` (ISO codes, the same countries as the geo permissions).

## 11. CoinMarketCap (prices)

**pro.coinmarketcap.com** → sign up for the free Basic plan → copy the API key → `COINMARKETCAP_API_KEY`. Empty means
prices show as unavailable and simulated performance does not update.

## 12. Gemini (AI search, optional)

**aistudio.google.com → Get API key** → `GEMINI_API_KEY`. Keep `GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL` as in the
template. On the free tier Google may use prompts to improve its products; leave the key empty if that is not
acceptable (keyword and filter search still work).

## 13. Firebase (web push, optional)

1. **console.firebase.google.com → Add project** `bytesac`.
2. **Project settings → General → Your apps → Web app** (`</>`): register `bytesac-web` and copy `apiKey`,
   `projectId`, `messagingSenderId`, `appId` → the four `NEXT_PUBLIC_FIREBASE_*` values.
3. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair** → the public key is
   `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
4. **Project settings → Service accounts → Generate new private key** (downloads a JSON file). On the server, put it on
   one line into `FIREBASE_SERVICE_ACCOUNT` (§15.3). Delete the downloaded file afterwards.

All five public values must be set or the web push toggle stays hidden.

## 14. Platform wallets (later, when you enable investing)

Leave these empty for the first deployment: the platform works, and plans that need them are refused.

| Variable | What to create |
|---|---|
| `SOLANA_FEE_PAYER_SECRET` | A **new, dedicated** Solana wallet (for example a new Phantom account) → *Export private key* (base58, 64-byte key). Fund with a small amount of SOL (warning below 0.5 SOL). |
| `EVM_GAS_WALLET_SECRET` | A **new, dedicated** EVM account → *Export private key* (`0x...`). Fund with small native gas on Ethereum, Base, BNB Chain, Arbitrum and Polygon. |
| `GAS_TREASURY_SOLANA_ADDRESS` | Public address of a Solana wallet that receives network fees (USDC). |
| `REVENUE_TREASURY_SOLANA_ADDRESS` | Public address of a **different** Solana wallet that receives platform fees. |

These keys hold platform money: use them nowhere else, keep balances small, and move them to a key management service
before a public launch. Read `apps/api/README.md` ("First investment and exit") and complete its mainnet checklist
with small amounts first.

---

## 15. The four configuration files

All live in `deploy/` on the server and are git-ignored and excluded from Docker builds.

### 15.1 Secrets you generate

On the server: `openssl rand -hex 32` twice → `SESSION_TOKEN_PEPPER` and `OTP_HMAC_SECRET` (different values).
Choose a long random password for the runtime database role: `openssl rand -base64 30 | tr -d '/+=' | cut -c1-32`.

### 15.2 `deploy/.env` (compose: domains and public web settings)

```bash
WEB_DOMAIN=app.example.com
API_DOMAIN=api.example.com
ACME_EMAIL=you@example.com
NEXT_PUBLIC_REOWN_PROJECT_ID=<reown project id>
# optional web push (all five or none)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=
# optional store links (APK download page, for example); unset shows "Coming soon"
NEXT_PUBLIC_ANDROID_APP_URL=
NEXT_PUBLIC_IOS_APP_URL=
```

`NEXT_PUBLIC_*` values are built into the web image: run `docker compose build web` after changing them.

### 15.3 `deploy/api.env` (API and worker)

Start from the template: `cp deploy/api.env.example deploy/api.env`. Every line is annotated there. The key values:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Transaction pooler, **runtime user**: `postgresql://bytesac_api.<project-ref>:<runtime-password>@<pooler-host>:6543/postgres` (copy the host from Supabase **Connect**; set the password in §17.3 first) |
| `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET` | §15.1 |
| `AUTH_DOMAIN` | `app.example.com` (no `https://`) |
| `AUTH_URI` | `https://app.example.com` |
| `ALLOWED_ORIGINS` | `https://app.example.com` |
| `COOKIE_SECURE` | `true` |
| Provider keys | §5–§13 |
| `FIREBASE_SERVICE_ACCOUNT` | One line: `jq -c . service-account.json` (install with `sudo apt-get install -y jq`) |

`REDIS_URL`, `PORT` and `TRUST_PROXY` are set by `docker-compose.yml`.

### 15.4 `deploy/migrate.env` (schema owner, migrations only)

```bash
MIGRATOR_DATABASE_URL=postgresql://postgres.<project-ref>:<database-password>@<pooler-host>:5432/postgres
```

Session pooler, port **5432**, user `postgres.<project-ref>` (§4).

Lock them down: `chmod 600 deploy/.env deploy/api.env deploy/migrate.env`.

---

## 16. Server setup

SSH into the VM (§2.8) and run:

### 16.1 Docker Engine and Compose (official Ubuntu repository)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in (close and reopen the SSH window), then check: `docker run --rm hello-world` and
`docker compose version`.

### 16.2 Get the code (read-only deploy key)

```bash
ssh-keygen -t ed25519 -C "bytesac-vm" -f ~/.ssh/bytesac_deploy -N ""
cat ~/.ssh/bytesac_deploy.pub
```

GitHub → repository **Settings → Deploy keys → Add deploy key**: paste the public key, leave **write access off**.
Then on the VM:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/bytesac_deploy
  IdentitiesOnly yes
EOF
git clone git@github.com:sameerkrdev/bytesac.git ~/bytesac
cd ~/bytesac/deploy
```

### 16.3 Write the configuration

```bash
cp .env.example .env               && nano .env
cp api.env.example api.env         && nano api.env
cp migrate.env.example migrate.env && nano migrate.env
chmod 600 .env api.env migrate.env
```

Fill them in from §15. Leave `DATABASE_URL`'s password as a placeholder for now; you set it in §17.3.

---

## 17. Build, migrate and start

All commands run in `~/bytesac/deploy`.

### 17.1 Build the images

```bash
docker compose build
docker compose build migrate        # the tools image (migrations and the ops CLI)
```

The first build takes about 10–15 minutes on e2-standard-2.

### 17.2 Run the migrations

```bash
docker compose --profile tools run --rm migrate
```

It should finish without errors. Notices about truncated identifiers are harmless. This also creates the
least-privilege roles and schedules the daily retention job.

### 17.3 Give the runtime role its password

Supabase → **SQL Editor**:

```sql
ALTER ROLE bytesac_api LOGIN PASSWORD '<runtime-password>';
SELECT jobname, schedule FROM cron.job;   -- expect bytesac-retention, 0 3 * * *
```

Put the same password into `DATABASE_URL` in `api.env`.

### 17.4 Start

```bash
docker compose up -d
docker compose ps                     # caddy, web, api (healthy), worker, redis: all running
docker compose logs -f caddy          # wait for "certificate obtained successfully" for both domains (Ctrl+C to leave)
```

### 17.5 Check it works

```bash
curl -fsS https://api.example.com/health          # {"status":"ok","db":"ok","redis":"ok"}
curl -fsS -o /dev/null -w "%{http_code}\n" https://app.example.com/     # 200
docker compose logs --tail 20 worker               # "worker started"
```

Then in a browser: open `https://app.example.com`, connect a wallet, sign in, verify your email and phone.

### 17.6 Make yourself an operator

After your first sign-in, find your user id (Supabase **SQL Editor**: `select id, created_at from app.users order by
created_at;`) and run on the VM:

```bash
docker compose --profile tools run --rm cli ops:grant-role -- --user <your-user-uuid> --role ops_admin --operator you@example.com
```

Reload the web app: the **Ops** console appears. Register assets and platform fees there (do **not** run
`ops:seed-assets` in production; it seeds development data).

---

## 18. Android APK (EAS)

Run on your laptop in `apps/mobile` (Node 24 installed):

1. **expo.dev** → create an account. Then:
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init          # links the project; writes extra.eas.projectId into app.json (commit that change)
   ```
2. Store the build-time variables for the **preview** environment (they are public values, not secrets):
   ```bash
   npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://api.example.com --visibility plaintext
   npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_WEB_URL --value https://app.example.com --visibility plaintext
   npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_REOWN_PROJECT_ID --value <reown project id> --visibility plaintext
   ```
   `EXPO_PUBLIC_WEB_URL` is also the site wallets show when the app connects (it must be on the Reown allowlist, §6).
3. Optional, for push notifications: Firebase → **Project settings → Service accounts → Generate new private key**,
   then `npx eas-cli@latest credentials` → Android → **Google Service Account → FCM V1** and upload it.
4. Build the APK (the `preview` profile in `eas.json` builds an APK with internal distribution):
   ```bash
   npx eas-cli@latest build -p android --profile preview
   ```
   EAS creates and stores the Android signing key the first time; keep it (losing it means users must reinstall).
5. Open the build page link (or its QR code) on an Android phone, download and install. Android asks to allow
   installing from that source once. Put the same link in `NEXT_PUBLIC_ANDROID_APP_URL` if you want the web's download
   button to point at it.

For the Play Store later: `npx eas-cli@latest build -p android --profile production` (an app bundle) and
`npx eas-cli@latest submit -p android`, with the variables created for the `production` environment.

---

## 19. Operating the server

| Task | Command (in `~/bytesac/deploy`) |
|---|---|
| Logs | `docker compose logs -f api worker web` |
| Status | `docker compose ps` |
| Restart one service | `docker compose restart worker` |
| Update to the latest `main` | `cd ~/bytesac && git pull && cd deploy && docker compose build && docker compose build migrate && docker compose --profile tools run --rm migrate && docker compose up -d` |
| Free disk | `docker image prune -f` |
| Database backup | `docker run --rm -e PGURL="$(grep MIGRATOR migrate.env \| cut -d= -f2-)" -v ~/backups:/b postgres:17 sh -c 'pg_dump "$PGURL" -Fc -f /b/bytesac-$(date +%F).dump'` (daily via cron; copy off the VM) |

Rollback: check out the previous commit and rebuild. Migrations are additive and forward-only: never revert one; fix
forward with a new migration.

Monitoring (free): Google Cloud **Monitoring → Uptime checks** on `https://api.example.com/health` and
`https://app.example.com/`, alerting to your email; keep the billing budget alert from §2.

---

## 20. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `docker compose up` fails: `set WEB_DOMAIN in deploy/.env` | `deploy/.env` missing or not filled in |
| API container restarts; logs `failed to start api` | A required variable is missing or invalid in `api.env` (`docker compose logs api`); `Non-base58 character` means a wrong `SOLANA_FEE_PAYER_SECRET` (leave it empty until §14) |
| `/health` returns `"db":"down"` | Wrong `DATABASE_URL`: use the **pooler** host, user `bytesac_api.<project-ref>`, port 6543, URL-encoded password; or §17.3 not done |
| Migration error `ENETUNREACH` / timeout | You used the IPv6 direct connection: use the session pooler (port 5432) |
| `password authentication failed for user "bytesac_api"` | Password not set (§17.3) or differs from `DATABASE_URL` |
| Caddy: certificate errors | DNS not pointing at the VM yet, or ports 80/443 closed (§2.5, §3); Cloudflare proxy must be off |
| Wallet does not open or warns "unverified" | `NEXT_PUBLIC_REOWN_PROJECT_ID` empty, or the domain / package not on the Reown allowlist (wait 15 minutes after adding) |
| Sign-in signature rejected | `AUTH_DOMAIN` / `AUTH_URI` do not match the web domain the user is on |
| Buttons fail with `CSRF_REJECTED` | `ALLOWED_ORIGINS` does not list `https://app.example.com` exactly |
| Document upload fails in the browser (CORS error) | R2 CORS policy missing or origin mismatch (§5.3) |
| SMS code never arrives | Twilio trial and the number is not verified, the country is not in geo permissions, or not in `SMS_ALLOWED_COUNTRIES` |
| Emails not delivered | Resend domain not verified, or `EMAIL_FROM` not on that domain |
| Investing says route unavailable | `LIFI_API_KEY` empty, platform wallets not configured (§14), or the asset has no active route in the registry |
| APK cannot reach the API | `EXPO_PUBLIC_API_URL` not set for the `preview` environment before the build (rebuild after adding it) |

---

## 21. Security checklist before inviting users

- [ ] `deploy/*.env` files are `chmod 600`, never committed, and not copied anywhere else.
- [ ] Supabase schema `app` not exposed; database password and runtime password are different and long.
- [ ] R2 bucket private; the token is scoped to that bucket only.
- [ ] SSH limited (console SSH or your IP only); VM OS updates: `sudo apt-get update && sudo apt-get upgrade -y`
      monthly.
- [ ] Reown allowlist set (domain and `com.bytesac.app`).
- [ ] Platform wallets empty or holding small amounts; mainnet checklist in `apps/api/README.md` done before
      enabling investing.
- [ ] Billing budget alert and uptime checks on.
- [ ] Legal and disclosure copy reviewed (it is placeholder text today).

Related: `DEPLOYMENT.md` (requirements every deployment must meet), `DEPLOY-SINGLE-VM.md` (hosting options),
`apps/api/README.md` (providers, jobs, wallets), `apps/mobile/README.md` (mobile builds and push).
