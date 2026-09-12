# syntax=docker/dockerfile:1
#
# Two images from one file. The default (last) stage is the full one, with the Chromium that the
# browser-driven adapters need; `--target runtime-slim` leaves it out for an API-only or
# non-scraping deployment, which is most of the size.
#
#   docker build -t goodies-beacon .
#   docker build -t goodies-beacon:slim --target runtime-slim .

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

# Only what the entrypoint needs at runtime: apps/api and the workspace packages it pulls in.
# Without the filter this also installs React, TanStack and Vite's runtime deps, which are build
# inputs for apps/web — the image ships its compiled output, not its dependencies.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter '@goodies-beacon/api...'

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
RUN pnpm build

FROM base AS runtime-slim
# Baked in so /healthz reports what is actually running, not what someone believes is running.
ARG GOODIES_BEACON_VERSION=dev
ARG GOODIES_BEACON_SHA=unknown
ENV NODE_ENV=production \
    PORT=3000 \
    GOODIES_BEACON_VERSION=$GOODIES_BEACON_VERSION \
    GOODIES_BEACON_SHA=$GOODIES_BEACON_SHA
COPY --from=prod-deps /app ./
# Every workspace package the entrypoint can reach needs its build output here, not just its
# node_modules link. A missing one fails at import, on start, with ERR_MODULE_NOT_FOUND.
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/email/dist packages/email/dist
# SQL migrations are data, not build output, but the API applies them on start.
COPY --from=build /app/packages/core/drizzle packages/core/drizzle
COPY --from=build /app/apps/api/dist apps/api/dist
# apps/api/dist/main.js is the entrypoint for every ROLE and imports the worker subscribers.
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/web/dist apps/web/dist
# The media volume is a mount point in production, but an unmounted run should still work.
RUN mkdir -p /data/media && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

# The full image: the same thing plus the browser. Chromium goes to a shared path rather than
# root's home, so the unprivileged user the container runs as can actually reach it.
FROM runtime-slim AS runtime-full
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER root
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    node apps/worker/node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    # ffmpeg is only for recording video, which nothing here does.
    && rm -rf /ms-playwright/ffmpeg-* \
    # Documentation nobody reads in an image. Mesa's GL stack looks like another 180 MB of dead
    # weight for a headless shell, but it is not: remove libllvm19 and mesa-libgallium and
    # Chromium will not start at all.
    && rm -rf /usr/share/doc /usr/share/man /usr/share/info /root/.npm /tmp/* \
    && chmod -R a+rX /ms-playwright
USER node
