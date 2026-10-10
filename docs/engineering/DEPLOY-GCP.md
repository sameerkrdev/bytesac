# Deploying Bytesac on Google Cloud (step by step)

The complete runbook for the chosen pilot setup: **one Google Cloud VM** runs the web app, API, worker and Redis in
**rootless Docker** (as an ordinary user, no root daemon) from `infra/server/docker-compose.yml`, behind **nginx installed
on the VM** (HTTPS with certbot, configured by hand); **PostgreSQL is Supabase**; files are in **Cloudflare R2**; the
Android app ships as an **APK** built with EAS. Follow the sections in order. Every value you collect goes into one of
four files, shown in §15. After the first manual deploy, GitHub Actions tests and deploys every merge to `main` (§22).

> Never paste secrets into chats, tickets or commits. Keep them in a password manager until you write them into the
> files on the server. Provider dashboards change their wording over time; if a button is named differently, look for
> the same setting nearby. Checked against the code on 2026-10-06.

---

## 0. The setup at a glance

```text
                 Users (browser)                    Users (Android APK)
                       │ https://example.com (waitlist)    │ https://api.example.com
                       │ https://app.example.com (product) │
                       ▼                                    ▼
   ┌──────────── Google Cloud VM (Ubuntu 24.04) ────────────────────────────────────────┐
   │  nginx :443 on the VM (certbot)                                                     │
   │    example.com + app.example.com → :3000     api.example.com → 127.0.0.1:4000       │
   │  ┌──── rootless Docker (your user, no root daemon) ────────────────────────────┐    │
   │  │  web (Next.js :3000) ── /api/* rewrite ──►  api (Express :4000)              │    │
   │  │                          worker (BullMQ) ─┐   │                             │    │
   │  │                          redis (no-evict) ◄┴───┘                             │    │
   │  └──────────────────────────────────────────────────────────────────────────────┘    │
   └───────────────────────────────────────────────┬─────────────────────────────────────┘
                                                   │ IPv4 pooler
                       Supabase PostgreSQL ◄───────┘        Cloudflare R2 (browser uploads with signed URLs)
```

| Runs where | What |
|---|---|
| GCP VM | nginx and certbot (installed on the VM); web, api, worker, redis in rootless Docker (`infra/server/docker-compose.yml`) |
| Supabase | PostgreSQL 17 with `pg_cron` and `pgvector` |
| Cloudflare R2 | Organization documents, basket files, asset logos |
| EAS (Expo) | Android APK builds |
| Providers | Reown (wallets), Alchemy (chain data), LI.FI (routing), Resend (email), Twilio (SMS), CoinMarketCap (prices), Gemini (AI search), Firebase (web push) |

### nginx on the VM, Docker without root

- **nginx** is installed from Ubuntu's packages and configured by hand from the reference file
  `infra/server/nginx/bytesac.conf` (§16.4). **certbot** gets the Let's Encrypt certificates and renews them on a timer.
  The one rule that matters for the API: nginx **sets** `X-Forwarded-For $remote_addr`, never
  `$proxy_add_x_forwarded_for` (that keeps whatever the client sent, so anyone could fake their IP for the per-IP
  rate limits).
- **Docker runs rootless**: the Docker daemon and every container run as your ordinary user, not root. Nobody is added
  to the `docker` group (membership is equivalent to root). `sudo` is needed only once, to install packages and set up
  nginx and certbot; building, deploying and operating the app never use it.
- The containers publish only on `127.0.0.1` (web 3000, API 4000), so only nginx on the VM can reach them.

All infrastructure files live in `infra/` (see `infra/README.md`).

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
| `example.com` | `bytesac.com` | Marketing / waitlist (apex) |
| `app.example.com` | `app.bytesac.com` | The product web app |
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
| A | `@` | VM static IP | DNS only (Cloudflare: grey cloud) |
| A | `www` | VM static IP | DNS only (or CNAME to apex) |
| A | `app` | VM static IP | DNS only |
| A | `api` | VM static IP | DNS only |

Resend adds its own records in §9. Check from your laptop: `nslookup example.com` and `nslookup app.example.com` return the VM IP.

> Cloudflare proxy (orange cloud) is possible later, but then nginx must restore client IPs with its `real_ip` module
> for Cloudflare's ranges and you must set `GEO_COUNTRY_HEADER=CF-IPCountry`. Keep it grey for the first deployment.

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
       "AllowedOrigins": ["https://app.example.com", "https://example.com"],
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
4. `EMAIL_FROM=Bytesac <no-reply@mail.example.com>`. Verify **bytesac.com** (or your apex) in Resend as well if `WAITLIST_EMAIL_FROM=Sameer <sameer@bytesac.com>`.

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

All live in `infra/server/` on the server and are git-ignored and excluded from Docker builds.

### 15.1 Secrets you generate

On the server: `openssl rand -hex 32` twice → `SESSION_TOKEN_PEPPER` and `OTP_HMAC_SECRET` (different values).
Choose a long random password for the runtime database role: `openssl rand -base64 30 | tr -d '/+=' | cut -c1-32`.

### 15.2 `infra/server/.env` (compose: web domain and public web settings)

```bash
WEB_DOMAIN=app.example.com
MARKETING_DOMAIN=example.com
# Same value as PREVIEW_GATE_JWT_SECRET in api.env when the soft-launch gate is on
PREVIEW_GATE_JWT_SECRET=
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

`NEXT_PUBLIC_*` values are built into the web image: run `docker compose build web` after changing them. The API
domain is configured only in nginx (§16.4).

### 15.3 `infra/server/api.env` (API and worker)

Start from the template: `cp api.env.example api.env` (in `infra/server`). Every line is annotated there. The key values:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Transaction pooler, **runtime user**: `postgresql://bytesac_api.<project-ref>:<runtime-password>@<pooler-host>:6543/postgres` (copy the host from Supabase **Connect**; set the password in §17.3 first) |
| `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET` | §15.1 |
| `AUTH_DOMAIN` | `app.example.com` (no `https://`) |
| `AUTH_URI` | `https://app.example.com` |
| `ALLOWED_ORIGINS` | `https://app.example.com,https://example.com` |
| `WAITLIST_EMAIL_FROM` | `Sameer <sameer@example.com>` (Resend-verified apex domain) |
| `PREVIEW_GATE_*` | Optional soft launch: JWT secret (≥32 chars), team email and password; copy the JWT secret into `infra/server/.env` for the web container |
| `COOKIE_SECURE` | `true` |
| Provider keys | §5–§13 |
| `FIREBASE_SERVICE_ACCOUNT` | One line: `jq -c . service-account.json` (install with `sudo apt-get install -y jq`) |

`REDIS_URL`, `PORT` and `TRUST_PROXY` (`loopback,uniquelocal`: the private hops that nginx and the web container
arrive from) are set by `docker-compose.yml`.

### 15.4 `infra/server/migrate.env` (schema owner, migrations only)

```bash
MIGRATOR_DATABASE_URL=postgresql://postgres.<project-ref>:<database-password>@<pooler-host>:5432/postgres
```

Session pooler, port **5432**, user `postgres.<project-ref>` (§4).

Lock them down: `chmod 600 .env api.env migrate.env` (in `infra/server`).

---

## 16. Server setup

SSH into the VM (§2.8) and run:

### 16.1 Docker Engine in rootless mode (official Ubuntu repository)

The packages need `sudo` once. The root Docker daemon they install is switched off straight away; only the rootless
one, owned by your user, runs.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq uidmap
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras

# Switch off the root daemon: only the rootless one is used
sudo systemctl disable --now docker.service docker.socket containerd.service
sudo rm -f /var/run/docker.sock

# Rootless Docker needs subordinate user/group IDs for your user (normally present already)
grep "^$USER:" /etc/subuid /etc/subgid || sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"

# Keep your user's services (rootless Docker) running after you log out, and start them at boot
sudo loginctl enable-linger "$USER"
```

Then, as yourself (no `sudo` from here on):

```bash
dockerd-rootless-setuptool.sh install
echo "export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock" >> ~/.bashrc
source ~/.bashrc
systemctl --user enable docker

docker run --rm hello-world
docker info --format '{{.SecurityOptions}}'    # must include name=rootless
docker compose version
```

Do **not** add your user to the `docker` group. Ubuntu 24.04 restricts user namespaces with AppArmor; the profile
rootless Docker needs comes with the apt packages above, so nothing else is required. Images, volumes and build cache
live in `~/.local/share/docker`.

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
cd ~/bytesac/infra/server
```

### 16.3 Write the configuration

```bash
cp .env.example .env               && nano .env
cp api.env.example api.env         && nano api.env
cp migrate.env.example migrate.env && nano migrate.env
chmod 600 .env api.env migrate.env
```

Fill them in from §15. Leave `DATABASE_URL`'s password as a placeholder for now; you set it in §17.3.

### 16.4 nginx and HTTPS (by hand)

nginx runs directly on the VM. `infra/server/nginx/bytesac.conf` is a reference to copy and edit: it proxies
`app.example.com` to `127.0.0.1:3000` and `api.example.com` to `127.0.0.1:4000`, and sets the forwarded headers the
API expects.

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp ~/bytesac/infra/server/nginx/bytesac.conf /etc/nginx/sites-available/bytesac
sudo nano /etc/nginx/sites-available/bytesac          # replace app.example.com and api.example.com (once each)
sudo ln -s /etc/nginx/sites-available/bytesac /etc/nginx/sites-enabled/bytesac
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Certificates for both names; certbot adds the 443 listeners and an HTTP → HTTPS redirect to the site file
sudo certbot --nginx -d example.com -d www.example.com -d app.example.com -d api.example.com --redirect -m you@example.com
sudo certbot renew --dry-run                          # renewal works (a systemd timer runs it automatically)
```

Optional: `server_tokens off;` in the `http { }` block of `/etc/nginx/nginx.conf` hides the nginx version. Until §17.4
starts the containers, nginx answers `502 Bad Gateway`; that is expected.

To change the site later: edit `/etc/nginx/sites-available/bytesac`, then `sudo nginx -t && sudo systemctl reload
nginx`. Keep `proxy_set_header X-Forwarded-For $remote_addr;` in every `location` that proxies to the app.

---

## 17. Build, migrate and start

All commands run in `~/bytesac/infra/server`, as your user (no `sudo`).

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
docker compose ps                         # web, api (healthy), worker, redis: all running
curl -fsS http://127.0.0.1:4000/health    # the API directly, before nginx
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
   # Only while the soft-launch preview gate is on: the app shows the team login first
   npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_PREVIEW_GATE --value 1 --visibility plaintext
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

| Task | Command (in `~/bytesac/infra/server`, as your user) |
|---|---|
| Logs | `docker compose logs -f api worker web` |
| Status | `docker compose ps` |
| Restart one service | `docker compose restart worker` |
| Update to the latest `main` | Automatic with GitHub Actions (§22), or by hand: `git -C ~/bytesac fetch origin && ~/bytesac/infra/server/deploy.sh "$(git -C ~/bytesac rev-parse origin/main)"` |
| Free disk | `docker image prune -f` |
| Restart Docker itself | `systemctl --user restart docker` (status: `systemctl --user status docker`) |
| nginx | Logs `sudo tail -f /var/log/nginx/error.log`; after editing the site `sudo nginx -t && sudo systemctl reload nginx` |
| Database backup | `docker run --rm -e PGURL="$(grep MIGRATOR migrate.env \| cut -d= -f2-)" -v ~/backups:/b postgres:17 sh -c 'pg_dump "$PGURL" -Fc -f /b/bytesac-$(date +%F).dump'` (daily via cron; copy off the VM) |

Rollback: run `infra/server/deploy.sh <older commit of main>` (or the Deploy workflow with that commit, §22.4).
Migrations are additive and forward-only: never revert one; fix forward with a new migration.

Monitoring (free): Google Cloud **Monitoring → Uptime checks** on `https://api.example.com/health` and
`https://app.example.com/`, alerting to your email; keep the billing budget alert from §2.

### 19.1 Already on §19 — turn on apex waitlist + app preview gate

If the VM already runs web + api from an earlier deploy:

1. Pull the release that includes waitlist + preview gate, then deploy (`deploy.sh` or GitHub Actions).
2. DNS: apex `@` and `www` A records → VM IP (§3).
3. nginx: copy the updated `infra/server/nginx/bytesac.conf`, set `example.com`, `www.example.com`, `app.example.com`, `api.example.com`, reload nginx, extend certbot with all four names (§16.4).
4. `infra/server/.env`: `MARKETING_DOMAIN=example.com`, `WEB_DOMAIN=app.example.com`, `PREVIEW_GATE_JWT_SECRET` (same as api.env when gate enabled).
5. `infra/server/api.env`: `ALLOWED_ORIGINS=https://app.example.com,https://example.com`, `WAITLIST_EMAIL_FROM`, optional `PREVIEW_GATE_*`.
6. Cloudflare R2 CORS: add `https://example.com` to allowed origins (§5.3).
7. Resend: verify apex domain for `sameer@example.com` (§9).
8. Rebuild web after env changes: `docker compose build web && docker compose up -d`.
9. Smoke test: `https://example.com/` landing in waitlist mode (Join the waitlist → form, welcome email arrives); `https://example.com/how-it-works` stays on the apex; `https://app.example.com/preview-access` then wallet sign-in; on the APK (built with `EXPO_PUBLIC_PREVIEW_GATE=1`) the team login shows before the wallet sign-in.

---

## 20. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `docker compose up` fails: `set WEB_DOMAIN in infra/server/.env` | `infra/server/.env` missing or not filled in |
| `Cannot connect to the Docker daemon` | `DOCKER_HOST` not set in this shell (§16.1), or rootless Docker stopped: `systemctl --user start docker` |
| Containers do not come back after a reboot | `sudo loginctl enable-linger $USER` and `systemctl --user enable docker` (§16.1) |
| nginx `502 Bad Gateway` | The containers are not running or not on `127.0.0.1:3000` / `:4000`: `docker compose ps`, `docker compose logs web api` |
| API container restarts; logs `failed to start api` | A required variable is missing or invalid in `api.env` (`docker compose logs api`); `Non-base58 character` means a wrong `SOLANA_FEE_PAYER_SECRET` (leave it empty until §14) |
| `/health` returns `"db":"down"` | Wrong `DATABASE_URL`: use the **pooler** host, user `bytesac_api.<project-ref>`, port 6543, URL-encoded password; or §17.3 not done |
| Migration error `ENETUNREACH` / timeout | You used the IPv6 direct connection: use the session pooler (port 5432) |
| `password authentication failed for user "bytesac_api"` | Password not set (§17.3) or differs from `DATABASE_URL` |
| certbot fails | DNS not pointing at the VM yet, ports 80/443 closed (§2.5, §3), the site not enabled in nginx, or the Cloudflare proxy is on |
| Every user shares one IP in rate limits | nginx appends instead of setting the header: use `proxy_set_header X-Forwarded-For $remote_addr;` (§16.4) |
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

- [ ] `infra/server/*.env` files are `chmod 600`, never committed, and not copied anywhere else.
- [ ] Docker is rootless (`docker info` shows `name=rootless`), the root daemon is disabled and nobody is in the
      `docker` group; containers publish only on `127.0.0.1`.
- [ ] nginx sets (does not append) `X-Forwarded-For`; `sudo certbot renew --dry-run` passes.
- [ ] Supabase schema `app` not exposed; database password and runtime password are different and long.
- [ ] R2 bucket private; the token is scoped to that bucket only.
- [ ] SSH limited (console SSH or your IP only); VM OS updates: `sudo apt-get update && sudo apt-get upgrade -y`
      monthly.
- [ ] Reown allowlist set (domain and `com.bytesac.app`).
- [ ] Platform wallets empty or holding small amounts; mainnet checklist in `apps/api/README.md` done before
      enabling investing.
- [ ] Billing budget alert and uptime checks on.
- [ ] Deploys only through the `production` environment from `main`; the deploy SSH key can only run `deploy.sh` (§22).
- [ ] Legal and disclosure copy reviewed (it is placeholder text today).

---

## 22. CI/CD with GitHub Actions

Three workflows live in `.github/workflows/`:

| Workflow | Runs when | What it does |
|---|---|---|
| `ci.yml` (**CI**) | Every pull request and every push to `main` | Lint, typecheck and test every package on Linux, with the API tests against the same Postgres and Redis as local development (`docker compose up`). It also builds the API, migrate and web Docker images without pushing them, so a broken Dockerfile fails the PR. |
| `deploy.yml` (**Deploy**) | After **CI** passes on `main`, or by hand | Signs in to Google Cloud, opens a private tunnel to the VM and runs `infra/server/deploy.sh <commit>` there as your user. |
| `mobile-apk.yml` (**Android build**) | By hand | Queues an EAS Android build (APK or Play Store bundle) and prints its link. |

```text
pull request ──► CI ──► review ──► merge to main ──► CI on main ──► Deploy (production environment)
                                                                       │ Workload Identity Federation (no Google key stored)
                                                                       ▼
                                                     IAP tunnel ──► VM :22 ──► infra/server/deploy.sh <commit>
                                                                       git checkout · build · migrate · up · wait for health
```

How the deploy stays safe:

- **No Google password or key in GitHub.** GitHub proves its identity to Google with a short-lived token (Workload
  Identity Federation). Google accepts it only for this repository and only for jobs in the `production` environment.
- **Port 22 is not opened to the internet.** The runner reaches SSH through Google's Identity-Aware Proxy (IAP).
- **The deploy key can do one thing.** Its line in `authorized_keys` forces `infra/server/deploy.sh`; the only input is the
  commit hash, and the script accepts only full hashes that are already on `origin/main`.
- **The server builds the images.** Secrets stay in `infra/server/*.env` on the VM; GitHub never sees them.
- **One deploy at a time**, in order (a lock on the VM and a concurrency group in the workflow).

Building on the VM takes a few minutes per deploy, and the containers restart at the end (a few seconds of downtime).
That is fine for the pilot; DEPLOYMENT.md §17 describes building images in CI and pulling them instead.

**CI works as soon as the workflows are on `main`.** The Deploy workflow is skipped until you finish the setup below.

### 22.1 Google Cloud: tunnel, service account and GitHub sign-in

Open **Cloud Shell** (the `>_` icon at the top right of the Google Cloud console) and run, changing the first three
lines:

```bash
REPO=sameerkrdev/bytesac          # GitHub owner/repository, exact spelling
VM=bytesac                        # VM name (§2)
ZONE=asia-south1-a                # VM zone (Compute Engine → VM instances, "Zone" column)

PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="github-deploy@$PROJECT_ID.iam.gserviceaccount.com"

gcloud services enable iap.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

# Let IAP (Google's tunnel range) reach SSH on the VM
gcloud compute firewall-rules create allow-ssh-from-iap --network default --direction INGRESS \
  --action allow --rules tcp:22 --source-ranges 35.235.240.0/20

# A service account that may only look up the VM and open IAP tunnels
gcloud iam service-accounts create github-deploy --display-name "GitHub Actions deploy"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" \
  --role roles/iap.tunnelResourceAccessor --condition None
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA" \
  --role roles/compute.viewer --condition None

# Trust GitHub's tokens, but only from this repository's production environment
gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc bytesac --location global --workload-identity-pool github \
  --display-name "bytesac repository" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment" \
  --attribute-condition "assertion.repository == '$REPO' && assertion.environment == 'production'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

# Values for GitHub (§22.3)
echo "GCP_PROJECT_ID=$PROJECT_ID"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/bytesac"
echo "GCP_DEPLOY_SERVICE_ACCOUNT=$SA"
echo "GCP_VM_NAME=$VM"
echo "GCP_VM_ZONE=$ZONE"
```

Nothing printed here is a secret. The firewall rule only admits Google's tunnel; the VM's existing SSH rule is
unchanged (see §21 if you want to tighten it).

### 22.2 The VM: a deploy key that can only run `deploy.sh`

`infra/server/deploy.sh` must be on the VM first, so merge this change and update the checkout once:
`cd ~/bytesac && git pull`. Then, in the VM's SSH window (the user who owns `~/bytesac`):

```bash
ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f ~/gh-deploy
echo "command=\"$HOME/bytesac/infra/server/deploy.sh\",restrict $(cat ~/gh-deploy.pub)" >> ~/.ssh/authorized_keys

whoami                                                             # → GCP_VM_USER
echo "bytesac-vm $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"   # → secret VM_SSH_KNOWN_HOSTS
cat ~/gh-deploy                                                    # → secret VM_DEPLOY_SSH_KEY (whole block)
```

Copy the last two outputs straight into GitHub (§22.3), then delete the key files from the VM:
`rm ~/gh-deploy ~/gh-deploy.pub`. Never paste the private key into a chat or a commit.

`restrict` turns off terminals, port forwarding and agent forwarding for this key, and `command=` makes it run only
the deploy script, whatever the client asks for.

### 22.3 GitHub: environment, variables and secrets

Repository → **Settings**:

1. **Environments → New environment** `production`:
   - **Deployment branches and tags → Selected branches and tags** → add `main`.
   - Optional: **Required reviewers** → yourself. Every deploy then waits for your click in the Actions tab.
   - **Environment secrets → Add secret**:
     - `VM_DEPLOY_SSH_KEY`: the private key from §22.2 (including the `-----BEGIN` and `-----END` lines).
     - `VM_SSH_KNOWN_HOSTS`: the `bytesac-vm ssh-ed25519 AAAA…` line from §22.2.
2. **Secrets and variables → Actions → Variables → New repository variable**, from §22.1 and §22.2:
   `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_VM_NAME`, `GCP_VM_ZONE`,
   `GCP_VM_USER`, and optional `PUBLIC_API_URL` = `https://api.example.com` (checked after each deploy).
3. **Branches → Add branch ruleset** (or classic branch protection) for `main`: require a pull request and the
   status checks **Lint, types, tests** and **Docker images**. Pick them after CI has run once.
4. **Actions → General → Workflow permissions**: keep **Read repository contents** (the workflows ask for nothing
   more, apart from Deploy's sign-in token).

### 22.4 Deploying, rolling back, checking

- **Normal flow:** merge a pull request into `main`. CI runs; when it passes, Deploy starts (and waits for your
  approval if you added a reviewer). Watch it under **Actions → Deploy**.
- **Deploy again or roll back:** **Actions → Deploy → Run workflow**, branch `main`, and paste a full commit hash
  (empty deploys the latest `main`). Migrations stay applied on rollback: they are forward-only.
- **By hand on the VM** (same script): `git -C ~/bytesac fetch origin && ~/bytesac/infra/server/deploy.sh <commit>`.
- After a deploy: `docker compose ps` on the VM, or the `PUBLIC_API_URL` health check in the run's last step.

### 22.5 Android builds from GitHub (optional)

1. Do §18 steps 1–2 once on your laptop (`eas init`, commit the `app.json` change, create the `preview` variables).
2. **expo.dev → Account settings → Access tokens → Create token** (name `github-actions`).
3. GitHub → **Settings → Secrets and variables → Actions → New repository secret** `EXPO_TOKEN`.
4. **Actions → Android build → Run workflow**, profile `preview` (APK) or `production` (Play Store bundle). The run
   ends once the build is queued; the build page link in its log has the install link and QR code.

### 22.6 When a workflow fails

| Symptom | Cause and fix |
|---|---|
| Deploy shows as **skipped** | `GCP_WORKLOAD_IDENTITY_PROVIDER` variable not set, or CI failed on that commit |
| `Permission 'iam.serviceAccounts.getAccessToken' denied` / `unauthorized_client` | The provider's condition does not match: check the `REPO` spelling in §22.1 and that the job runs in the `production` environment |
| IAP tunnel step fails (`failed to connect to backend`, `4033`) | Missing firewall rule for `35.235.240.0/20`, wrong `GCP_VM_ZONE` / `GCP_VM_NAME`, or the VM is stopped |
| `Host key verification failed` | `VM_SSH_KNOWN_HOSTS` must start with `bytesac-vm` and contain the VM's `ssh_host_ed25519_key.pub` |
| `Permission denied (publickey)` | Wrong `GCP_VM_USER`, or the `authorized_keys` line from §22.2 is missing |
| `refusing: … is not on origin/main` | You dispatched a commit from another branch: merge it first |
| `another deploy is running` | Wait for it to finish, then run Deploy again |
| `the API did not become healthy` | Read the API log printed by the run, fix forward, or roll back with the hash it prints |
| CI: API tests fail to connect to Postgres | The `docker compose up -d --wait` step failed: read its log (the image build needs network access to Debian mirrors) |

Related: `DEPLOYMENT.md` (requirements every deployment must meet), `DEPLOY-SINGLE-VM.md` (hosting options),
`apps/api/README.md` (providers, jobs, wallets), `apps/mobile/README.md` (mobile builds and push).
