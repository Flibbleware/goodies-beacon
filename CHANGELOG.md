# Changelog

All notable changes to Goodies Beacon. Format follows conventional commits; releases are GitHub Releases tagged `vX.Y.Z`.

## Unreleased

- P1-05 Media ingest. Listing and reference images are fetched behind an SSRF guard, size-capped
  at 15 MB, re-encoded to webp with a thumbnail, perceptually hashed and stored under `MEDIA_DIR`
  with a row; `POST /api/media` takes an upload and `GET /api/media/:id` serves it with an
  immutable cache header. Re-encoding rather than storing what arrived is what strips EXIF — which
  can carry a seller's GPS coordinates — and means a file that is not really an image never
  reaches the disk.
- The perceptual hash is a difference hash computed with sharp rather than the `blockhash` package
  ARCHITECTURE.md §15 names: the published package is a single release from 2019 with no types,
  and it needs raw pixels, so sharp is in the pipeline either way. The threshold was measured, not
  guessed — a real photograph resized and re-encoded moves 5–7 bits of 64, two different ones
  18–46 — so ten separates them with room either side.

- P1-04 eBay adapter. Search across any eBay marketplace with the plan's region, `newlyListed`
  ordering and the watermark as an `itemStartDate` filter, paging until the watermark or the cap;
  `getItem` for the description, full images and ships-to-UK; a health check reporting the daily
  Browse quota; and an application token cached and refreshed a minute before it expires. Settings
  gains a Sources section for the eBay keyset and an optional per-source proxy, both stored
  encrypted and never sent to the browser, with a Test button that runs the adapter's own health
  check — so what Settings reports is what a poll would hit.
- Fixed before release: the container would not start. `apps/api` gained a dependency on the new
  eBay adapter package for the Settings Test button, and the Dockerfile copies workspace manifests
  and build output package by package, so the image was built without it and died at import with
  `ERR_MODULE_NOT_FOUND`. Caught by CI's "the image starts and answers /healthz" step, which is
  the only thing that would have.
- All three things S1-01 found are handled and pinned by tests: an auction reports `price: null`
  with the figure in `currentBidPrice`, `itemLocationCountry` takes one value and silently ignores
  the `{A|B}` set form, and ships-to-UK is only knowable after enrichment.

- P1-03 Adapter contract, context, template and test harness. `SourceAdapter` and
  `AdapterContext` from ARCHITECTURE.md §5, a rate-limited HTTP client with jittered spacing and
  proxy support, a cookie jar persisted in a new `source_cookies` table so a session survives a
  restart, a Playwright browser factory in the worker that runs one browser at a time and blocks
  images and fonts, a working example adapter in `packages/sources/_template`, and a fixture
  harness that replays recorded responses and validates what an adapter returns. `docs/ADAPTERS.md`
  is the first draft of the contributor guide.
- Fixed before it shipped: the proxy setting would silently never have applied. A `ProxyAgent`
  built from the installed undici is rejected by Node's global `fetch`, which is a different copy
  of the same library; the client now uses undici's own `fetch` for both. Found by running a real
  proxy in the test rather than asserting that the option was passed.

- **Test files are typechecked.** Every package's `tsconfig.json` excludes `*.test.ts` so tests
  never reach `dist/`, with the side effect that `tsc -b` checked none of them — 30 files, a third
  of the TypeScript in the repo, and Vitest does not typecheck either since esbuild strips types
  without reading them. A new `tsconfig.tests.json` checks them with `noEmit`, run by
  `pnpm typecheck` after the build. It found eleven real errors, all pre-existing: three hand-made
  `Logger` stubs missing `child`, two `as Config` casts claiming eleven fields that were not there,
  `Pool` imported from a package `apps/api` does not depend on, two `Hono` variables typed without
  their context, and an unchecked buffer index. One was a live weakness rather than a nuisance: a
  settings test asserted a stored password was `not.toBe('hunter2')`, which `undefined` also
  satisfies, so a write that silently stored nothing would have passed.

- P1-02 Core types and Zod schemas. `SpecSettings`, `Criterion`, `SearchPlan`, `ReferenceImage`,
  `WantedSpec`, the normalised listing and the reviewer's output, shared by the API, the web app,
  the adapters and the AI layer, with the Carmageddon and Power Mac 5500 example specs kept as
  JSON fixtures. Price ceilings, listing types, condition and regions are typed fields with
  bounded values, applied as hard filters before any model is called.
- The criteria linter §4 described is not built, and ARCHITECTURE.md §4 is amended to say so
  (v1.24). It would have matched criteria text against prices, countries and listing types, none
  of which are loose — the only route to a price in a criterion is hand-typing one into the raw
  JSON editor, which Phase 3 closes twice over. One check is kept: a criterion that is `hard` but
  not `quantifiable` is flagged, because `hard` sounds like the careful choice while actually
  meaning a blurry photo rejects the listing outright. It compares two typed fields rather than
  matching English, so it cannot misfire, and it is a warning rather than an error.

- P1-01 Domain schema. The tables from ARCHITECTURE.md §4 — wanted items, immutable spec versions,
  per-plan search state, listings, `seen`, candidates, verdicts, the cost ledger and media, plus
  stubs for grading scales, feedback and notifications. `listings` carries a `seller_hash` and no
  column that could hold a seller name. The salt behind that hash lives in a new `instance_secret`
  row, encrypted under `GOODIES_BEACON_SECRET_KEY` rather than derived from it, so rotating that
  key re-wraps a single value instead of silently orphaning every hash already written and
  breaking relist detection with nothing to notice. `docs/RUNNING.md` gains a *Rotating the secret
  key* section, since the salt is the one thing a rotation cannot simply re-enter.

- **Goodies Beacon stores no marketplace user data.** `Listing` keeps a `sellerHash` —
  `HMAC-SHA256(seller id, instance salt)` — instead of the seller's id and username, and the
  entire `seller` object is dropped before the raw response is stored, so nothing about a seller
  reaches the database, a backup or a log — not just the username: eBay returns a business
  seller's legal name, street address and email in `seller.sellerLegalInfo`, and one in three
  listings sampled during the spike was a named individual with their home address. Relist detection only ever asks whether two candidates share a seller, which a
  hash answers as well as a name, and no screen or email ever displayed one. Found while running
  the eBay spike: a production keyset is issued **disabled** until the application either hosts an
  account-deletion notification endpoint or claims eBay's exemption for not persisting eBay user
  data, and this makes the exemption true rather than merely asserted. ARCHITECTURE.md §18 had
  predicted no such gate; §2, §4, §7, §12 and §18 are corrected in v1.23 and the evidence is in
  the new `docs/SPIKES.md`.
- `docs/SPIKES.md` records the Track A findings as they are made, one section per source. S1-01
  (eBay) is run and written up: Browse works on a production keyset once the account-deletion gate
  is passed, with a 5,000-call daily quota; `EBAY_GB` returns worldwide sellers by default;
  `itemLocationCountry` takes one value and silently ignores the `{A|B}` set form; an auction's
  `price` is `null` with the value in `currentBidPrice`; and ships-to-UK is only knowable after
  enrichment, since `shipToLocations` comes from `getItem`. Eighteen anonymised fixtures are
  recorded for the adapter tests in P1-04.

- The plan for Phase 1 was revised at the Phase 0 exit (`docs/DEVELOPMENT_PLAN.md`,
  ARCHITECTURE.md §17 v1.22): the eBay spike goes first; P1-13 shrinks to the JSON spec editor
  §17 always described, with the typed form and version diff moved to the interviewer phase;
  P1-12 sends a plain real-time email for a match, since the transport already exists; the eval
  suite runs only when prompts, fixtures or its own code change; and Phases 2 and 3 are swapped
  so notifications and retention come before the interviewer.

- P1-00 Hardening from the Phase 0 review. Sessions: the database now stores the SHA-256 of the
  cookie token rather than the token itself, so a copy of the database or a backup cannot be
  replayed as a signed-in session. **Upgrading signs every browser out once.** Every response now
  carries HSTS, a same-origin Content-Security-Policy, `frame-ancestors 'none'`, `nosniff` and a
  strict referrer policy. Nightly and pre-deploy dumps are written owner-only, since they hold the
  password hash, the encrypted SMTP password and the session table, and RUNNING.md's copy-off
  command changes to suit. Container logs are capped at five files of 10 MB per service.
- RUNNING.md step 2 now locks SSH to keys and disables root login, and the plan carries a
  "later hardening" list so the smaller items from the review are not lost.

## v0.1.0 — 13 September 2026

Phase 0 exit. Published as a GitHub pre-release, since nothing works yet: the release exists to
prove the pipeline, not the product. Everything below the exit record was merged during Phase 0.

**Exit test, as run.** `v0.1.0` was created on GitHub from `development/0.2.0`. The release
workflow built both images for amd64 and arm64, rewrote the release notes from the commits, and
deployed through the shared deploy job over SSH, with the forced-command key, in 28 seconds.
`/healthz` on `https://beacon.flibbleware.app` reports `v0.1.0` and the tag's commit, over a
Let's Encrypt certificate with HTTP redirected. The instance was claimed, the empty dashboard
shown, and a test email sent from Settings through Resend was delivered and authenticated at the
notification address.

**Deviations.**

- The droplet was an existing one rather than fresh, and the stack was first started on the
  `dev` image before the release, so the release deployed as an upgrade over `deploy.sh` rather
  than a first install. The password was set on the `dev` build; the sign-in, dashboard and test
  email were then repeated on the released image.
- P0-12's timed walk-through is left unticked: about fifty minutes on the existing droplet, with
  help beyond the guide, roughly half of it on gaps the guide now closes. A timed re-run on a
  throwaway droplet is what ticks it.
- The exit test found nine defects or gaps, all fixed before the tag and each listed below: the
  release tag mismatch, the unrestorable pre-deploy dump, `.env` overriding the baked version and
  commit, the Postgres password character set, the branch download URLs, DigitalOcean's outbound
  SMTP block, amd64-only branch images, the backup container ignoring SIGTERM, and a race in the
  smoke test.
- The Playwright run was not pointed at the droplet, by design: it resets the instance's password.
- Two follow-ups are written into the plan as carried-forward tasks: a first-run setup token, and
  a bootstrap script that writes the instance's files and secrets itself.

- Fixed: the Playwright smoke test could fail on a slow CI runner by reloading the page while a
  settings save was still in flight; it now waits for the section's "Saved." status. Retries are
  off, because the database is reset once per run and a retry would start at first run against an
  instance whose password is already set.

- The window between first start and the owner setting a password, during which anyone reaching
  the instance can claim it, is now stated in ARCHITECTURE.md §12 and a first-run setup token is
  planned for Phase 6 (`docs/DEVELOPMENT_PLAN.md`, carried forward from the Phase 0 exit test).

- Fixed: `/healthz` on the droplet reported `sha: unknown`, and would have reported `version:
  latest`, because `.env.example` listed `GOODIES_BEACON_SHA` and `GOODIES_BEACON_VERSION` and
  compose loads `.env` into the container over the values the image was built with. The baked
  values now live under `GOODIES_BEACON_BUILD_VERSION` and `GOODIES_BEACON_BUILD_SHA`, which are
  not operator settings and are kept out of `.env.example` by a test; `GOODIES_BEACON_VERSION` in
  `.env` is now only the tag compose pulls. Found by the Phase 0 exit test.
- The Postgres password must be letters and digits only, because `docker-compose.yml` splices it
  into `DATABASE_URL` unencoded; `.env.example` and RUNNING.md now say so and suggest
  `openssl rand -hex 24`, and the configuration error names the cause. Found by the exit test.

- Fixed: a published release would have failed to deploy. The release workflow tagged images
  with the version number alone (`0.1.0`) while handing the deploy job the release's tag name
  (`v0.1.0`), so the pull on the droplet found nothing. Images are now tagged with the tag name
  as it is, which is also what `/healthz` reports and what `deploy.sh` takes.
- Fixed: the dump `deploy.sh` takes before a deploy now uses the same flags as the nightly one,
  so it can be restored by the procedure in `docs/RUNNING.md` — over a live database, and without
  the pgboss errors a plain dump prints. It also reads the database role from the container rather
  than assuming the default, so a custom `POSTGRES_USER` no longer aborts every deploy at the dump.
- Fixed: the `backup` service stops as soon as it is asked. It is PID 1 in its container and had no
  signal handler, so every `docker compose stop` or deploy waited out the ten-second timeout before
  killing it. A dump in progress still finishes before it exits.
- Sessions that expired without being presented again are now swept whenever a new session is
  minted, so the table no longer keeps a row per sign-in for ever.
- A settings save that submits an SMTP password which happens to look like a stored envelope is
  now encrypted like any other, rather than stored as sent and left undecryptable.
- Docs brought back in step with the code: README no longer says the compose files are still to
  come or that P0-06 is next; RUNNING.md names the heartbeat queue with the period pg-boss requires
  and says where `ROLE` is actually decided; ARCHITECTURE.md §11 and §16 describe the `./backups`
  directory the backup service and `deploy.sh` really write to; CLAUDE.md states the integration
  branch and the branch naming in use; and the Costs page in the navigation is labelled Phase 5,
  which is when §17 schedules it.

- Work merges into the `development/0.2.0` integration branch until Phase 1 is complete; `main` receives a single merge at the end. `v0.1.0` is still tagged from the integration branch at the Phase 0 exit.

- HTTPS is now stated as required rather than recommended (ARCHITECTURE.md §11 and §12). The
  session cookie has been `Secure` since P0-07, which a browser discards over plain HTTP, so the
  "HTTP on the tailnet is acceptable" allowance §12 carried would have left a Tailscale-only
  instance unable to sign in at all, with nothing on screen to say why. `localhost` is the one
  exception, so local development and the Playwright run still need no certificate.
- P0-14 Nightly backup job: a `backup` service takes a `pg_dump` every night at `BACKUP_AT`
  (03:30 UTC by default), keeps `BACKUP_KEEP_DAYS` of them (fourteen), prunes the rest, and reports
  each run on stdout. Dumps go to `backups/` beside the compose file rather than into a Docker
  volume, where `deploy.sh` already writes its pre-deploy dumps and where they can be copied off
  with `scp`. `docs/RUNNING.md` documents restoring, and rehearsing a restore against a scratch
  database without touching the live one.
- The dump covers the `public` and `drizzle` schemas and deliberately not `pgboss`: its jobs are
  transient, pg-boss rebuilds its schema on start, and including it made a restore print errors
  about inherited constraints on its partitioned tables that an operator could not tell apart from
  a real failure.
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
