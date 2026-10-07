# syntax=docker/dockerfile:1.7
#
# Bytesac API and worker: one image, two processes.
#
#   docker build -f infra/docker/api.Dockerfile -t bytesac-api .                    # from the repository root
#   docker run --env-file apps/api/.env.production -p 4000:4000 bytesac-api                  # API (default)
#   docker run --env-file apps/api/.env.production bytesac-api node dist/worker.js           # BullMQ worker
#   docker build -f infra/docker/api.Dockerfile --target migrate -t bytesac-migrate .
#   docker run -e MIGRATOR_DATABASE_URL=... bytesac-migrate                                  # run migrations once
#
# Stages: prune (turbo prune api) → deps (frozen install) → build (tsup) → prod-deps (flat production install)
# → runtime (non-root, tini, healthcheck). tsup bundles the @repo/* workspace packages; their npm dependencies stay
# external, so production dependencies are installed with pnpm's hoisted linker to keep every one resolvable from
# dist/. Native addon builds stay disabled exactly as in pnpm-workspace.yaml (allowBuilds).

ARG NODE_VERSION=24

# ---------------------------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
# Same pnpm version as the "packageManager" field in package.json (bump both together). A global npm install lives
# in /usr/local, so the non-root tools image (migrate, ops CLI) can run it too.
RUN npm install -g pnpm@11.25.0 && npm cache clean --force
WORKDIR /repo

# ---------------------------------------------------------------------------------------------------------------------
FROM base AS prune
COPY . .
# A partial monorepo with only what "api" needs and a pruned lockfile (out/json: manifests, out/full: sources).
RUN pnpm dlx turbo@2.11.5 prune api --docker

# ---------------------------------------------------------------------------------------------------------------------
FROM base AS deps
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------------------------------------------------
FROM deps AS build
COPY --from=prune /repo/out/full/ .
RUN pnpm --filter api build

# ---------------------------------------------------------------------------------------------------------------------
# Tools image: drizzle-kit migrations (default command, run as the schema owner once per release, before the new API
# starts) and the audited ops CLI (pnpm --filter api ops:*). It holds dev dependencies: never serve traffic from it.
FROM build AS migrate
WORKDIR /repo/packages/db
USER node
CMD ["pnpm", "db:migrate"]

# ---------------------------------------------------------------------------------------------------------------------
FROM base AS prod-deps
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --config.node-linker=hoisted --filter api...

# ---------------------------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG NODE_VERSION
LABEL org.opencontainers.image.title="bytesac-api" \
      org.opencontainers.image.description="Bytesac API (default) and BullMQ worker (node dist/worker.js)" \
      org.opencontainers.image.source="https://github.com/sameerkrdev/bytesac"
# tini forwards SIGTERM so the graceful shutdown in server.ts / worker.ts runs; CA certificates for provider TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./package.json
USER node
EXPOSE 4000
# /health checks PostgreSQL and Redis (200 / 503). The worker has no HTTP server: disable this healthcheck for it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
