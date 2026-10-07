# infra

Everything needed to build, run and deploy Bytesac outside the app source.

| Path | What it is |
|---|---|
| `docker/api.Dockerfile` | API and worker image; `--target migrate` builds the tools image (migrations, ops CLI). Build from the repository root: `docker build -f infra/docker/api.Dockerfile .` |
| `docker/web.Dockerfile` | Next.js standalone web image (build args: `API_ORIGIN`, `NEXT_PUBLIC_*`) |
| `docker/postgres/` | PostgreSQL 17 with pg_cron and pgvector, plus `init.sql` (local, CI and the optional self-hosted profile) |
| `local/docker-compose.yml` | Local development and CI services: Postgres on 54329, Redis on 63799. Run `pnpm db:up` / `pnpm db:down` from the root |
| `server/docker-compose.yml` | The single-VM stack under **rootless Docker**: web (127.0.0.1:3000), API (127.0.0.1:4000), worker, Redis, plus `migrate` / `cli` tools |
| `server/*.env.example` | Templates for the server's `.env`, `api.env` and `migrate.env` (the real files are git-ignored and never enter a build context) |
| `server/deploy.sh` | Deploys one commit of `origin/main` as the ordinary user: build, migrate, restart, wait for health. Run by GitHub Actions and by hand |
| `server/nginx/bytesac.conf` | Reference site for **nginx on the VM** (HTTPS with certbot), copied and edited by hand |

Nothing here runs as root at deploy time: Docker runs rootless under the user that owns the checkout, and the
containers run as non-root users inside it. Root (`sudo`) is used only once, to install packages and set up nginx and
certbot.

Runbook: [`docs/engineering/DEPLOY-GCP.md`](../docs/engineering/DEPLOY-GCP.md). CI/CD: `.github/workflows/`.
