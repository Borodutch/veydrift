# Every Veydrift service on Tugport builds from this file at the repo root, each with
# its own target (backend, mission-report-generator, frontend, stats,
# chicken-burn-listener). The layer order is chosen for caching; read
# docs/deployment.md#docker-builds before changing it.

FROM oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e AS bun

# Node.js 22.23.4 (Oct 2026 security release), Bun 1.4.4, and fontconfig with the
# DejaVu fonts for the OG-card renderer (sharp). Cached until this block changes.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx
ENV NODE_ENV=production PATH=/app/node_modules/.bin:$PATH
WORKDIR /app

# Dependencies, keyed only on the lockfile and the workspace manifests, so a code
# change reuses this layer (and the image layer it exports) as is.
FROM base AS deps
COPY --parents package.json bun.lockb apps/*/package.json packages/*/package.json ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  NODE_ENV=development bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages

# Bun runs the TypeScript sources directly; type checks run in CI, not here.
FROM deps AS backend
COPY apps/backend apps/backend
# Tugport passes the deployed commit as GIT_SHA; declared last so only this step reruns.
ARG GIT_SHA
RUN sh apps/backend/scripts/write-build-sha.sh
WORKDIR /app/apps/backend
CMD ["bun", "run", "start"]

FROM backend AS mission-report-generator
CMD ["bun", "run", "mission-report:generator"]

FROM deps AS chicken-burn-listener
COPY apps/chicken-burn-listener apps/chicken-burn-listener
WORKDIR /app/apps/chicken-burn-listener
CMD ["bun", "run", "start"]

# stats and stats-api run the same image with different environments.
FROM deps AS stats
COPY apps/backend apps/backend
COPY apps/stats apps/stats
RUN cd apps/stats && bun run build
WORKDIR /app/apps/stats
CMD ["bun", "run", "start"]

# The frontend's prebuild step (image variants) depends only on public/, so it runs
# in its own stage and stays cached across code changes.
FROM deps AS frontend-public
COPY apps/frontend/scripts/generate-image-variants.mjs apps/frontend/scripts/
COPY apps/frontend/public apps/frontend/public
RUN cd apps/frontend && node scripts/generate-image-variants.mjs

FROM deps AS frontend-build
COPY --from=frontend-public /app/apps/frontend/public apps/frontend/public
COPY apps/backend apps/backend
COPY --exclude=public apps/frontend apps/frontend
# Vite bakes these into the bundle; Tugport passes the service's values as build args.
ARG VITE_REOWN_PROJECT_ID
ARG VITE_VEYDRIFT_API_URL
ARG VITE_VEYDRIFT_CHAIN
ARG VITE_VEYDRIFT_MIGRATION_CONTRACT_ADDRESS
ARG VITE_VEYDRIFT_PAID_ALLIANCE_INVITE_ADDRESS
ARG VITE_VEYDRIFT_REFERRAL_SYSTEM_ADDRESS
ARG VITE_VEYDRIFT_SETTLEMENT_ADDRESS
ARG VITE_VEYDRIFT_SURFACE
# `bun run build` without its prebuild step, which frontend-public already ran.
RUN cd apps/frontend && vite build

# The large, rarely changing game art (public/ and its copy in dist/assets/game)
# goes in first, so a code change only adds the code layers after it.
FROM deps AS frontend
COPY --from=frontend-public /app/apps/frontend/public apps/frontend/public
COPY --from=frontend-build /app/apps/frontend/dist/assets/game apps/frontend/dist/assets/game
COPY apps/backend apps/backend
COPY --exclude=public apps/frontend apps/frontend
COPY --from=frontend-build --exclude=assets/game /app/apps/frontend/dist apps/frontend/dist
WORKDIR /app/apps/frontend
CMD ["bun", "run", "serve"]
