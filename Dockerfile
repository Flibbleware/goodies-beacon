# syntax=docker/dockerfile:1
#
# Minimal production image: builds the workspace and runs apps/api.
# P0-11 extends this with the Playwright and slim variants and migrations on start.

FROM node:24-trixie-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Manifests only, so a dependency install is not invalidated by a source edit.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/core/package.json packages/core/
COPY packages/email/package.json packages/email/
COPY packages/sources/_template/package.json packages/sources/_template/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
RUN pnpm build

FROM base AS runtime
# Baked in so /healthz reports what is actually running, not what someone believes is running.
ARG GOODIES_BEACON_VERSION=dev
ARG GOODIES_BEACON_SHA=unknown
ENV NODE_ENV=production \
    PORT=3000 \
    GOODIES_BEACON_VERSION=$GOODIES_BEACON_VERSION \
    GOODIES_BEACON_SHA=$GOODIES_BEACON_SHA
COPY --from=prod-deps /app ./
COPY --from=build /app/packages/core/dist packages/core/dist
# SQL migrations are data, not build output, but the API applies them on start.
COPY --from=build /app/packages/core/drizzle packages/core/drizzle
COPY --from=build /app/apps/api/dist apps/api/dist
# apps/api/dist/main.js is the entrypoint for every ROLE and imports the worker subscribers.
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
