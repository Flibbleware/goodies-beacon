# Changelog

All notable changes to Goodies Beacon. Format follows conventional commits; releases are GitHub Releases tagged `vX.Y.Z`.

## Unreleased

- Work merges into the `development/0.2.0` integration branch until Phase 1 is complete; `main` receives a single merge at the end. `v0.1.0` is still tagged from the integration branch at the Phase 0 exit.

- HTTPS is now stated as required rather than recommended (ARCHITECTURE.md §11 and §12). The
  session cookie has been `Secure` since P0-07, which a browser discards over plain HTTP, so the
  "HTTP on the tailnet is acceptable" allowance §12 carried would have left a Tailscale-only
  instance unable to sign in at all, with nothing on screen to say why. `localhost` is the one
  exception, so local development and the Playwright run still need no certificate.
- P0-13 Release workflow and deploy script: publishing a GitHub Release builds and pushes both
  images for amd64 and arm64, writes the release notes from the conventional commits since the last
  tag, and deploys. The *Deploy* workflow puts any built tag on the droplet on demand, defaulting to
  `dev`, which every push to the integration branch now publishes. Both triggers share one job, so
  `scripts/deploy.sh` has a single caller.
- `scripts/deploy.sh` dumps the database, pulls, switches `GOODIES_BEACON_VERSION`, restarts and
  polls `/healthz` for two minutes — putting the previous version back and restarting it if the new
  image never becomes healthy, so a failed deploy leaves the working image running.
- The deploy key is restricted to `deploy.sh` by a forced command in `authorized_keys`, so a stolen
  `DEPLOY_KEY` can deploy a published image and nothing else. The tag arrives in
  `SSH_ORIGINAL_COMMAND` and is refused unless it looks like a tag.
- `GOODIES_BEACON_IMAGE` now holds the whole image reference including the registry, so a fork can
  point it somewhere other than GHCR.
- P0-12 Droplet bootstrap and RUNNING.md: `docs/RUNNING.md` now starts from a fresh Ubuntu 24.04
  droplet and ends at a login page — cloud firewall, bootstrap, DNS, the three files, first start,
  and claiming the instance — followed by upgrade and rollback, backups, and the operational
  reference that was already there. `scripts/bootstrap-droplet.sh` does the mechanical parts: a
  `deploy` user that can use Docker without sudo, Docker Engine and Compose from Docker's apt
  repository, a 2 GB swap file with an fstab entry, and `/opt/goodies-beacon`. It is safe to run
  again; every step checks for its own result first.
- P0-11 Docker images and compose files: two images from one Dockerfile — the default with
  Chromium for the browser-driven adapters, and `:slim` without it. `docker-compose.yml` runs `db`,
  `app` and `caddy` with per-container memory limits and only Caddy published;
  `compose.dev.yml` runs Postgres and Mailpit for `pnpm dev`. Caddy handles TLS and the HTTP
  redirect, with a second Caddyfile for a tailnet name that Let's Encrypt cannot certify.
- The full image's size budget is 1.0 GB rather than 900 MB: §11 estimated Playwright at ~500 MB
  and it costs ~620 MB. The Mesa and LLVM libraries that account for 180 MB of it cannot be
  removed — Chromium will not start without them. The slim image measures 343 MB against its
  unchanged 400 MB budget.
- Fixed: the image was missing `packages/email/dist`, so every container built since P0-10 would
  have died on start with `ERR_MODULE_NOT_FOUND`. CI now starts the built image and calls
  `/healthz`, which is what would have caught it.
- Fixed: `NODE_ENV=development` in `.env.example` would have overridden the image's own setting on
  the droplet, leaving the API refusing to serve the web app. It is gone from `.env.example`, and
  compose pins `NODE_ENV=production` where `env_file` cannot reach it.
- The runtime image no longer installs the web app's dependencies — React, TanStack and Zod are
  build inputs, and the image ships the compiled output.
- P0-10 Settings and SMTP test send: the Settings page gains an account section that changes your
  password and an email section for SMTP. The SMTP password is encrypted with
  `GOODIES_BEACON_SECRET_KEY` before storage and never sent back to the browser, which is answered
  with `passwordSet` instead — so saving without retyping it keeps it. "Send test email" mails the
  configured notification address and nothing else, reporting what the mail server said verbatim
  when it fails.
- The API and the web app now validate settings against one Zod schema, imported from the new
  `@goodies-beacon/core/schemas` entry point. The package root reaches Postgres, pg-boss, pino and
  the native argon2 binding and cannot be bundled for a browser; the new entry point reaches none of
  them, and a test walks its import graph to keep it that way.
- Nodemailer 9 rather than 10: major 10 shipped eight days ago, short of the month the dependency
  policy asks for.
- P0-09 Web shell: React 19 with TanStack Router and Query and Tailwind 4. A login page that
  doubles as first run, an empty dashboard, and a settings page that saves the instance section.
  Left-hand navigation carries the pages from §14, with the ones that have no route yet disabled and
  labelled with the task that brings them. Dark and light follow the operating system. An
  unauthenticated visit lands on login; visiting login while signed in goes to the dashboard.
- A Playwright smoke test walks first run, sign out, a wrong password, sign in, a deep-link refresh
  and saving a setting against the built API serving the built web app, and runs in CI against a
  Postgres service. Point `E2E_BASE_URL` at a running instance to rehearse a deploy the same way.
- P0-08 API skeleton: `/healthz` reports `{ status, version, sha, db }` and answers 503 when the
  database is unreachable — including when it accepts the connection and never replies, which would
  otherwise hang the caller. The version and commit are baked into the image at build time. pino
  logging with a request id on every line and in every response's `X-Request-Id`; an unhandled error
  logs its stack against that id and answers a generic 500 without one. `/api/settings` reads and
  writes the instance section (timezone, digest time), merging a partial save rather than resetting
  what it was not sent. In production the API also serves the built web app with a fallback to
  `index.html`, so deep links survive a refresh.
- `docs/API.md` is generated from the route table by `pnpm docs:api`; CI fails if it is out of date.
- P0-07 Authentication: single user, password set on first run and hashed with Argon2id at OWASP's
  floor (19 MiB, two passes, one lane). `POST /api/auth/first-run`, `/login`, `/logout` and
  `/password`, plus `GET /api/auth/session` for the web app to ask where it stands. Sessions are a
  256-bit id in an `HttpOnly; Secure; SameSite=Lax` cookie, expiring after thirty days and sliding
  on use, rotated on login and on a password change — which also ends every other session. Login is
  limited to five failures per fifteen minutes per client address, then a lockout of the same
  length, and every attempt is logged. State-changing `/api` requests need a double-submit CSRF
  token. Every other `/api` path answers 401 without a session, including paths with no route.
- The API entrypoint needs the database to build the app, so `createApp` now takes `{ db, logger }`.
- Vitest no longer runs test files in parallel: the integration tests share one `TEST_DATABASE_URL`
  and each clears the tables it uses, so two files at once pulled rows out from under each other.
- P0-06 pg-boss and process roles: one entrypoint for every `ROLE`, so `all` runs the API and the
  workers in a single process while `api` and `worker` split across containers. Queues live in the
  `pgboss` schema of the same database; `WORKER_SOURCES` narrows a worker to `poll.<source>` queues
  and nothing else. A `heartbeat.<role>` job every five minutes records `last_seen_at` per role in
  the new `process_heartbeat` table. SIGTERM stops the HTTP server, lets in-flight jobs finish, then
  closes the pool, exiting 0.
- `pnpm dev` now runs the API (which carries the workers under `ROLE=all`) and the web app; the
  worker is no longer a separate dev process.
- Queue names use a period rather than the colon ARCHITECTURE.md §6 wrote — `poll.vinted`, not
  `poll:vinted` — because pg-boss validates queue names against `/^[\w.\-/]+$/` and rejects a
  colon outright. §6 and the plan are corrected.
- CI's Tests job now runs a `postgres:18` service and sets `TEST_DATABASE_URL`, so the migration and
  pg-boss integration tests run on every pull request instead of skipping.
- P0-01 Repository and monorepo scaffold.
- P0-02 Biome, lefthook, editor config.
- P0-05 Postgres, Drizzle and migrations: `settings`, `auth_user` and `auth_session` tables, `pnpm
  db:generate` / `pnpm db:migrate`, and migrations applied on start for `ROLE=api|all` under a
  Postgres advisory lock so concurrent containers cannot race. Settings secrets encrypt to
  `enc:v1:<ciphertext>` with AES-256-GCM, which refuses a wrong key rather than returning rubbish.
- `pnpm --filter <pkg> test` now runs that package's tests; previously every package's `test` script
  failed with "No projects were found" because the root Vitest `projects` globs resolved against the
  package directory rather than the workspace root.
- P0-04 Configuration and secrets: every process validates its environment through a Zod schema at
  startup and exits non-zero naming the variable that is wrong, listing all problems at once. A config
  object redacts the secret key, the database password and AI keys when logged.
- P0-03 CI workflow: Lint, Typecheck, Test, Build and Docker image run as separate parallel checks on every pull request, sharing a cached pnpm store through a composite setup action; pushes to `main` publish the image to GHCR as `edge` and `sha-<short sha>`.
- A minimal production `Dockerfile` (multi-stage, non-root, runs the API). Brought forward from P0-11 so CI has an image to build.
- Renovate configured for weekly grouped dependency updates, holding TypeScript on 6.x and Node on 24.
- Baseline pinned to Node 24 (Active LTS), pnpm 11, TypeScript 6.0, Vitest 4.1, Biome 2.5.
