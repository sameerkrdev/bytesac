# syntax=docker/dockerfile:1.7
#
# Bytesac web (Next.js 16, standalone output).
#
#   docker build -f infra/docker/web.Dockerfile -t bytesac-web \
#     --build-arg API_ORIGIN=http://api:4000 \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
#     --build-arg NEXT_PUBLIC_REOWN_PROJECT_ID=<id> .
#   docker run -p 3000:3000 bytesac-web
#
# API_ORIGIN (the private API URL behind the /api/* rewrite) and every NEXT_PUBLIC_* value are inlined at build time,
# so build one image per environment. None of them is a secret.

ARG NODE_VERSION=24

# ---------------------------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/usr/local/share/corepack \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
# pnpm comes from the "packageManager" field (pnpm@11.25.0) through corepack.
RUN corepack enable && corepack install --global pnpm@11.25.0
WORKDIR /repo

# ---------------------------------------------------------------------------------------------------------------------
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.5 prune web --docker

# ---------------------------------------------------------------------------------------------------------------------
FROM base AS deps
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------------------------------------------------
FROM deps AS build
COPY --from=prune /repo/out/full/ .
ARG API_ORIGIN=http://api:4000
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_REOWN_PROJECT_ID=
ARG NEXT_PUBLIC_FIREBASE_API_KEY=
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID=
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
ARG NEXT_PUBLIC_FIREBASE_APP_ID=
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY=
ARG NEXT_PUBLIC_IOS_APP_URL=
ARG NEXT_PUBLIC_ANDROID_APP_URL=
ENV API_ORIGIN=$API_ORIGIN \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_REOWN_PROJECT_ID=$NEXT_PUBLIC_REOWN_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_FIREBASE_VAPID_KEY=$NEXT_PUBLIC_FIREBASE_VAPID_KEY \
    NEXT_PUBLIC_IOS_APP_URL=$NEXT_PUBLIC_IOS_APP_URL \
    NEXT_PUBLIC_ANDROID_APP_URL=$NEXT_PUBLIC_ANDROID_APP_URL \
    NEXT_OUTPUT=standalone
RUN pnpm --filter web build

# ---------------------------------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="bytesac-web" \
      org.opencontainers.image.description="Bytesac web app (Next.js standalone server)" \
      org.opencontainers.image.source="https://github.com/sameerkrdev/bytesac"
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
# Server components also read API_ORIGIN at request time (home, baskets, fees, profiles, the signed-in user), so the runtime
# needs the same value the /api/* rewrite was built with.
ARG API_ORIGIN=http://api:4000
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    API_ORIGIN=$API_ORIGIN
WORKDIR /app
# The standalone folder mirrors the monorepo layout (traced from the repository root).
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
