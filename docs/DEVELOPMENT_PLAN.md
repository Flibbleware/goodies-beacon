# Goodies Beacon — Development Plan

*Phases 0 and 1. Companion to ARCHITECTURE.md v1.43; section numbers below refer to it.*

Version 1.21 — 26 September 2026. Every *done when* line is a checkbox; tick them in the same commit as the work.

---

## How to work from this document

Each task has an id, a size, what it depends on, and a **done when** list that is the acceptance test. A task is done only when every line of its *done when* is true, CI is green, and any doc it affects is updated in the same pull request. Sizes are rough: **S** is an hour or two, **M** is an evening or two, **L** is a few evenings. Estimates for a solo developer working with AI assistance; treat them as ordering, not commitments.

Working conventions for the repo:

- One branch per task, named after the id (`p0-07-auth`). Squash-merge through a pull request so CI runs on every change, even solo. Until this document is complete the base is the integration branch `development/0.2.0`, not `main`; `main` receives a single merge at the end.
- Conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`), which also feed the release notes.
- Nothing merges with Biome warnings, type errors or failing tests. There is no "fix it later" lane. `pnpm typecheck` covers test files as well as source: they are excluded from each package's build so they stay out of `dist/`, and `tsconfig.tests.json` checks them separately.
- The integration branch is always deployable, and `main` after the final merge. Releases are tags (`v0.1.0`) created through GitHub Releases, cut from the integration branch until then; the release workflow deploys them. Between releases, `deploy.yml` puts any built image on the droplet on demand, so an exit test can be rehearsed without publishing a release.
- Secrets never enter the repo. `.env.example` lists every variable with a comment; real values live in `.env` locally and on the droplet.
- Before a release, deploy the integration branch's `dev` image to the droplet with the *Deploy* workflow and walk the phase's exit test there. Phase 0's exit found nine defects that only a real deployment could show; the release should confirm a rehearsal, not be one.

A pattern in `.gitignore` with no leading slash matches a directory of that name at every depth, not just the root — `media/` swallowed two source directories in P1-05, and because Biome reads the same file they went unlinted as well as uncommitted. Anchor anything root-only; `scripts/check-tracked-sources.sh` runs in CI and pre-commit and will say so if you forget.

Global definition of done, in addition to each task's own list: CI green; Biome clean; new logic has unit tests; anything user-facing has a line in `CHANGELOG.md`; anything operational has a line in `docs/RUNNING.md`.

---

## Phase 0 — Foundation

**Goal.** A tagged release deploys an empty Goodies Beacon to the droplet over HTTPS, you can log in, and every quality gate is already in place so nothing later is built on sand.

**Exit test.** Create release `v0.1.0` on GitHub, tagged from the integration branch → the release workflow builds the image, deploys to the droplet, and reports healthy → open `https://beacon.<your domain>` → set the first-run password → log in → see the empty dashboard → receive a test email sent from Settings.

| Id | Task | Size | Depends on |
|---|---|---|---|
| P0-01 | Repository and monorepo scaffold | M | — |
| P0-02 | Biome, lefthook, editor config | S | P0-01 |
| P0-03 | CI workflow | M | P0-02 |
| P0-04 | Configuration and secrets | S | P0-01 |
| P0-05 | Postgres, Drizzle, migrations | M | P0-04 |
| P0-06 | pg-boss and process roles | M | P0-05 |
| P0-07 | Authentication | M | P0-05 |
| P0-08 | API skeleton | M | P0-04 |
| P0-09 | Web shell | M | P0-08 |
| P0-10 | Settings and SMTP test send | M | P0-07, P0-09 |
| P0-11 | Docker images and compose files | M | P0-06, P0-08 |
| P0-12 | Droplet bootstrap and RUNNING.md | M | P0-11 |
| P0-13 | Release workflow and deploy script | M | P0-03, P0-12 |
| P0-14 | Nightly backup job | S | P0-11 |
| P0-15 | Phase 0 exit | S | all above |

### P0-01 Repository and monorepo scaffold — M

Create the GitHub repository (MIT licence), pnpm workspaces, and the layout from §15: `apps/api`, `apps/web`, `apps/worker`, `packages/core`, `packages/ai`, `packages/sources/_template`, `packages/email`, `docs/`. Node 24 pinned in `.nvmrc` and `package.json#engines`. A shared `tsconfig.base.json` with `strict: true` and project references so `pnpm typecheck` covers every package. Copy `ARCHITECTURE.md` and this file into `docs/`.

Done when:

- [x] `pnpm install && pnpm typecheck && pnpm build` succeed on a clean clone.
- [x] Every package has a `README.md` stating its purpose in two sentences.
- [x] `LICENSE` is MIT with your name; `README.md` has the one-paragraph description from §1 and a "status: pre-alpha" line.

### P0-02 Biome, lefthook, editor config — S

Done when:

- [x] `pnpm lint` runs `biome ci` across the workspace and passes.
- [x] `pnpm format` rewrites files; a deliberately mis-formatted file is fixed by the pre-commit hook on `git commit`.
- [x] `.editorconfig` matches Biome's settings (2-space indent, LF, final newline).

### P0-03 CI workflow — M

`.github/workflows/ci.yml` as described in §16.

Because CI builds an image, the minimal `Dockerfile` is introduced here rather than in P0-11: multi-stage on `node:24-trixie-slim`, install from the lockfile, build the workspace, final stage with production dependencies and built output only, running as a non-root user and starting `apps/api`. No Playwright, no compose files and no migrations on start yet — those stay in P0-11.

Done when:

- [x] On a pull request: install (cached pnpm store) → `biome ci` → `pnpm typecheck` → `pnpm test` → `pnpm build` → `docker build` (no push). Each step is a named job or step so a failure is readable at a glance.
- [x] On push to `main`: the same, plus the image is pushed to GHCR tagged `edge` and `sha-<short sha>`.
- [x] A pull request that introduces a type error or a Biome error fails CI (verified once by opening and closing such a PR). Verified 13 September 2026.
- [x] Renovate (or Dependabot) is configured for weekly grouped updates.

### P0-04 Configuration and secrets — S

A single `config.ts` in `packages/core` that reads the environment through a Zod schema and fails fast with a readable message. Variables: `DATABASE_URL`, `GOODIES_BEACON_SECRET_KEY` (32-byte base64, used to encrypt settings-entered secrets), `GOODIES_BEACON_HOST`, `ROLE` (`api|worker|all`), `WORKER_SOURCES` (optional list), `LOG_LEVEL`, `MEDIA_DIR`, and AI provider keys (all optional at this stage).

Done when:

- [x] Starting any process with a missing or malformed variable prints which one and exits non-zero.
- [x] `.env.example` lists every variable with a one-line comment and a safe example value.
- [x] `GOODIES_BEACON_SECRET_KEY` generation is documented (`openssl rand -base64 32`).

### P0-05 Postgres, Drizzle, migrations — M

Drizzle schema and migration tooling. Phase 0 tables only: `settings` (single row, JSONB, with encrypted fields stored as `enc:v1:<ciphertext>`), `auth_user` (one row: Argon2id hash, created/updated), `auth_session`, `migrations` (Drizzle's own). Domain tables arrive in P1-01.

Done when:

- [x] `pnpm db:migrate` applies migrations idempotently; `pnpm db:generate` produces a new migration from a schema change.
- [x] Migrations run automatically on container start for `ROLE=api|all`, guarded by a Postgres advisory lock so two containers cannot race.
- [x] An encrypt/decrypt helper for settings secrets has unit tests including a wrong-key case.

### P0-06 pg-boss and process roles — M

Wire pg-boss to the same database. A single entrypoint reads `ROLE` and starts the API server, the worker subscribers, or both. Graceful shutdown on SIGTERM (finish in-flight jobs, close pool). A `heartbeat` job runs every five minutes and records `last_seen` per role, which the dashboard will show later.

Done when:

- [x] `ROLE=all` starts API and workers in one process; `ROLE=api` and `ROLE=worker` start them separately and both connect.
- [x] `WORKER_SOURCES=ebay` makes the worker subscribe only to `poll.ebay` (the queue exists even though no adapter does yet). The separator is a period, not the colon §6 wrote: pg-boss rejects a colon in a queue name.
- [x] Sending SIGTERM during a running job lets the job finish and exits 0 within the pg-boss grace period.
- [x] A unit test proves job handlers are registered once per queue name.

### P0-07 Authentication — M

Single user, per §12. First run: no user exists → the UI shows a "create your password" page; the password is hashed with Argon2id. Sessions in `auth_session` with a random 256-bit id in an `HttpOnly; Secure; SameSite=Lax` cookie, rotated on login, 30-day expiry sliding on use. Login rate-limited (5 attempts per 15 minutes per IP, then a 15-minute lockout) and logged. CSRF: double-submit token on state-changing routes.

Done when:

- [x] Login, logout and password change work in the UI; a wrong password shows a clear message without revealing timing differences (constant-time compare via Argon2 verify). API in P0-07, login and logout in P0-09, password change in P0-10; the Playwright run covers all three. Argon2 verify is flat at ~8.7 ms whether the password is right, wrong or one character long.
- [x] A request to any `/api/*` route other than auth and `/healthz` without a valid session returns 401 — including paths with no route, so the API is not enumerable before sign-in.
- [x] Rate limiting and lockout are covered by tests.
- [x] Cookie flags are verified in a test using a real HTTP request against the Hono app.

### P0-08 API skeleton — M

Hono on Node with: `/healthz` (checks database connectivity and returns version + git SHA), `/api/auth/*`, `/api/settings`, structured error responses (`{ error: { code, message } }`), pino logging with request ids, and static serving of the built web app in production with a SPA fallback.

Done when:

- [x] `/healthz` returns 200 with `{ status: 'ok', version, sha, db: 'ok' }` and 503 when the database is unreachable — bounded by its own timer, so a database that accepts the connection and never answers gives 503 in about two seconds rather than hanging the caller.
- [x] Unhandled errors are logged with the request id and returned as a generic 500 without a stack trace.
- [x] The OpenAPI-ish route list is generated by a script into `docs/API.md` (Hono's route table is enough; no full spec yet). `pnpm docs:api --check` fails in CI if it has drifted.

### P0-09 Web shell — M

Vite + React 19, TanStack Router and Query, Tailwind. Pages: login / first-run, dashboard (empty state), settings. Layout with left navigation reserved for the pages in §14. Dark and light themes following the system.

Done when:

- [x] `pnpm dev` runs the web app with hot reload against the local API, which it reaches through Vite's proxy so cookies and CSRF behave as they will in production.
- [x] The production build is served by the API container at `/` and deep links (`/settings`) work on refresh.
- [x] Unauthenticated visits redirect to login; authenticated visits to `/login` redirect to the dashboard.
- [x] A Playwright smoke test logs in and reaches the dashboard, and runs in CI against the built app. It also covers sign-out, a wrong password, a deep-link refresh and saving a setting, and can be pointed at a running instance with `E2E_BASE_URL`.

### P0-10 Settings and SMTP test send — M

Settings page backed by `/api/settings`, which P0-08 mounted with the instance section only (timezone, digest time, host read-only) — this task adds the account and email sections on top (Nodemailer for SMTP, on whichever major has been out for a month per the dependency policy). Sections now: account (password change), email (SMTP host, port, security, username, password, from address, notification address; a "Send test email" button), instance (`GOODIES_BEACON_HOST` shown read-only, timezone default `Europe/London`, digest time default 08:00). Later sections are added by their own tasks.

Done when:

- [x] SMTP password is stored encrypted and rendered masked; saving without changing it keeps the old value. The browser is never sent it at all — only `passwordSet` — so "unchanged" is enforced by the field being absent rather than by comparing against a mask.
- [x] "Send test email" delivers to Mailpit in development and to your real inbox on the droplet, and reports success or the SMTP error verbatim. Verified against a real Mailpit at three levels: the transport, the endpoint, and the button in the Playwright run. The droplet half was proven on 13 September 2026 during the Phase 0 exit test: Resend over STARTTLS from `beacon.flibbleware.app`, delivered to a Proton inbox and passing authentication. Two findings on the way there, both now in RUNNING.md: DigitalOcean blocks outbound 25, 465 and 587, so the provider's alternative port (2587) is needed, and the first attempt on 587 surfaced as a verbatim "Connection timeout" in the UI, which is the reporting this box asks for.
- [x] Settings changes are validated with the same Zod schema on client and server, shared through `@goodies-beacon/core/schemas`.

### P0-11 Docker images and compose files — M

Extend the `Dockerfile` from P0-03 so it produces `goodies-beacon` (with Playwright's Chromium) and `goodies-beacon:slim` (without), and runs migrations on start for `ROLE=api|all`. `docker-compose.yml` for production: `db` (postgres:18 with a named volume), `app` (`ROLE=all`, `media` volume), `caddy` (ports 80/443, `Caddyfile` templated from `GOODIES_BEACON_HOST`). TLS is not optional (§12), and a `*.ts.net` host cannot use Let's Encrypt, so the Caddyfile needs Caddy's Tailscale certificate source for that route rather than only the ACME default. `compose.dev.yml`: `db` and `mailpit` only. Images run as a non-root user.

Done when:

- [x] `docker compose -f compose.dev.yml up -d && pnpm dev` gives a working local instance with Mailpit's inbox at `localhost:8025`. Verified end to end: first run, saving SMTP settings, and a test email arriving in Mailpit.
- [x] `docker compose up -d` on a machine with a DNS name pointing at it serves the app over HTTPS with a valid certificate and redirects HTTP. Proven on the droplet on 13 September 2026: first `docker compose up -d` with `beacon.flibbleware.app` pointing at it, `curl -I http://…` answered 308 to `https://`, and `openssl s_client` showed a Let's Encrypt certificate (issuer `C=US, O=Let's Encrypt, CN=YE2`) for the name, valid for ninety days. `/healthz` answered over TLS with `db: ok`.
- [x] The full image is under 1.0 GB and the slim image under 400 MB (checked in CI and printed in the job summary). The full budget was 900 MB; §11 had estimated Playwright at ~500 MB and it costs ~620 MB, which put the full image at 960 MB on arm64. Mesa and LLVM look like 180 MB of dead weight for a headless shell but are not — remove them and Chromium will not start. Slim measured 343 MB.
- [x] Container memory limits are set in compose (`app` 1.2 GB, `db` 512 MB, and `caddy` 128 MB) so a runaway process cannot take the droplet down.

### P0-12 Droplet bootstrap and RUNNING.md — M

`docs/RUNNING.md` covering, for a fresh Ubuntu 24.04 droplet: create a `deploy` user with sudo-less Docker access; install Docker Engine and Compose from Docker's apt repository; add a 2 GB swap file; DigitalOcean cloud firewall allowing 22, 80, 443; point the DNS record at the droplet; clone or copy `docker-compose.yml`, `Caddyfile` and `.env`; first `docker compose up -d`; where backups live; how to upgrade and roll back (`GOODIES_BEACON_VERSION` in `.env`); how to run a manual deploy from the Actions tab. A `scripts/bootstrap-droplet.sh` that does the mechanical parts.

Done when:

- [ ] Following RUNNING.md from a fresh droplet to a running login page takes under thirty minutes without consulting anything else. **Run once on 13 September 2026 and not ticked**: bootstrap at 14:54 UTC, certificate at 15:40, `/healthz` at 15:44 — about fifty minutes, on an existing droplet, with an agent's help rather than the guide alone. Roughly half went on gaps the guide now closes: a base64 Postgres password that broke `DATABASE_URL`, download URLs pointing at a `main` that has nothing on it yet, pending apt updates, and DigitalOcean's outbound SMTP block. A timed re-run on a throwaway droplet, following the guide alone, is what ticks this. Written and rehearsed as far as it can be without a droplet: the bootstrap script runs clean on a fresh Ubuntu 24.04, the `deploy` user reaches Docker without sudo, and every command the guide quotes was run — `pg_dump` produces a real dump of all four tables plus the `pgboss` and `drizzle` schemas, and the `sed` line was checked under GNU sed rather than the BSD sed on the author's Mac. **The walk-through itself is unproven** until there is a droplet, which is P0-15's exit test.
- [x] The bootstrap script is idempotent (running it twice is harmless). Run three times on a fresh Ubuntu 24.04 container: exit 0 each time, no duplicate `/etc/fstab` entry, one line in `docker.list`, and user, permissions and `~/.ssh` byte-identical afterwards.
- [x] The Postgres port is not reachable from the internet (verified with a port scan from outside). Scanned the host with the production stack up: 80 and 443 open, 5432 and 3000 closed, while Postgres still answers inside the compose network. The scan is of the host rather than from the internet, but it is the host binding a remote scan would find, and there is none. The guide also says to use the cloud firewall rather than only `ufw`, because Docker writes its own iptables rules.

### P0-13 Release workflow and deploy script — M

`.github/workflows/release.yml` per §16: on a published release, build multi-arch images, push with the version tag and `latest`, then SSH to the droplet as `deploy` and run `scripts/deploy.sh`, which dumps the database to the backup volume, updates `GOODIES_BEACON_VERSION` in `.env`, pulls, restarts, and polls `/healthz` for up to two minutes.

Also `.github/workflows/deploy.yml`: a `workflow_dispatch` trigger taking an image tag (default `dev`) that runs the same shared deploy job, so a build can be put on the droplet as if it were a release without creating a tag or a GitHub Release. CI gains the integration-branch image push this depends on: on `development/**`, publish `dev` and `sha-<short sha>` to GHCR.

Done when:

- [x] The SSH step is skipped, with a visible notice, when `DEPLOY_HOST` / `DEPLOY_KEY` secrets are absent (so forks work). The guard reads them from `env` rather than interpolating them into the script, and its logic was run locally for all three cases: neither set, one set, both set.
- [x] A failed health check fails the workflow and leaves the previous image running (the script only switches `GOODIES_BEACON_VERSION` after a successful pull, and restores it on failure). Proven against a local registry: a tag that does not exist fails at the pull with `.env` untouched, and an image that starts but never answers `/healthz` is rolled back — after which the previous version was serving again and healthy.
- [x] The deploy user's key is restricted in `authorized_keys` to running `deploy.sh` (forced command). Proven against a real sshd: `ssh … whoami` runs `deploy.sh` rather than `whoami`, `ssh … 'v1.0.0; id'` is refused as not a tag, there is no shell to drop into, and data will not flow through a `-L` forward.
- [x] Release notes are generated from conventional commits since the previous tag, by `scripts/release-notes.sh`, grouped into breaking, added and changed, fixed, and documentation, with `chore` and `test` left out. Run against this repository's own history.
- [x] `deploy.yml` deploys a chosen image tag on demand and shares its deploy job with `release.yml`, so `deploy.sh` has exactly one caller path in CI — `workflow_dispatch` and `workflow_call` on the same job. **Unrun**: neither workflow can be exercised without pushing to GitHub, so the YAML is checked by `actionlint` (clean) and every script it calls was run locally.
- [x] Pushes to `development/**` publish `dev` and `sha-<short sha>` images, so there is always something for a manual deploy to pull. Proven on 13 September 2026: both packages on GHCR carry `dev` and a `sha-` tag per integration-branch merge, and both list their tags to an anonymous request, so the droplet pulls without a login.

### P0-14 Nightly backup job — S

A `backup` service in compose (or a pg-boss job in the app) that runs `pg_dump` nightly to the backup volume, keeps fourteen days, and logs success or failure. A restore procedure is documented in RUNNING.md.

Done when:

- [x] A dump appears each night and old ones are pruned. Verified against the running stack: the service computes the next run correctly, a dump on demand covers all four tables and the migration journal, and pruning with fourteen days kept removed 30- and 15-day-old dumps while keeping 14, 13, 7 and 1 — plus a `.partial` left by an interrupted dump, which nothing else would clean up.
- [x] The restore procedure has been rehearsed once against a scratch database, and then for real: the live database was deliberately damaged (settings changed, the user deleted) and the dump brought it back — no `ERROR` lines, the pre-restore password still signed in, and pg-boss rebuilt its seven queues from nothing. **Not yet on the droplet**, which does not exist; that belongs to P0-15's exit test.

### P0-15 Phase 0 exit — S

Run the exit test at the top of this phase. Record the date and any deviations in `CHANGELOG.md` under `v0.1.0`.

Run on 13 September 2026; the record and deviations are in `CHANGELOG.md` under `v0.1.0`.

---

## Phase 1 — eBay end to end, and the source spikes

**Goal.** Your Carmageddon search runs three times a day against eBay on the droplet, every new listing is judged by the pipeline, and you can read each verdict with its evidence in the web UI. In parallel, the scraped sources are proven or disproven from both your Mac and the droplet before any adapter is written for them.

**Exit test.** With a manually entered spec for "Carmageddon big box, Macintosh preferred, PC acceptable" and search plans "carmageddon" on `EBAY_GB` and `EBAY_US`: a poll runs on schedule; a newly listed jewel-case Carmageddon is rejected at the pre-filter or the reviewer with a readable reason; a boxed Mac copy is matched; a listing whose photos don't show the box contents is uncertain with "contents not visible" as the unknown; the match and the uncertain each arrive as a plain email; the spend for the day is visible on the dashboard; `docs/SPIKES.md` states, for each of Vinted, Yahoo Auctions and Mercari, whether it works from the droplet, from home, and through the proxy.

Two tracks. Track A is throwaway spike work; Track B is the product. They are independent until the Phase 1 exit (P1-XX), with one ordering rule: **S1-01 goes first**, before P1-01, because P1-04 depends on it and P1-03's harness wants the fixtures it records. The Vinted spike needs a residential proxy with a sticky GB session (§5); sign up for one in the first week so S1-02 is never waiting on a purchase. The droplet exists now, so the "from the droplet" half of every spike can be run at once.

### Track A — spikes

Spikes live in `spikes/` (excluded from CI), are written to be deleted, and produce two things: findings in `docs/SPIKES.md`, and recorded HTTP fixtures in `packages/sources/<name>/fixtures/` for the adapters that follow. Each spike is run from your Mac and from the droplet; Vinted additionally through the residential proxy.

| Id | Task | Size | Depends on |
|---|---|---|---|
| S1-01 | eBay Browse API spike | M | — |
| S1-02 | Vinted spike | L | — |
| S1-03 | Yahoo! Auctions JP spike | M | — |
| S1-04 | Mercari JP spike | M | — |
| S1-05 | Findings written up | S | S1-01..04 |

#### S1-01 eBay Browse API spike — M

Create the eBay developer account and production keyset. Obtain an application token (client credentials). Call `item_summary/search` on `EBAY_GB` and `EBAY_US` with `q=carmageddon`, `sort=newlyListed`, `filter=itemStartDate:[<yesterday>..]`, then `buyingOptions`, `itemLocationCountry` and `price` filters, then `getItem` for one result.

Done when:

- [x] Confirmed whether Browse works on a standard production keyset without further approval, and what the daily quota is for your app. **It does not, until the Marketplace Account Deletion gate is passed** — the keyset is issued disabled, which ARCHITECTURE.md §18 had not predicted; the exemption is taken and §4 changed so it is truthful (see the decision below). Past that gate no further approval is needed: `buy.browse` is **5,000 calls a day**, resetting 07:00 UTC, plus 5,000 for `buy.browse.item.bulk`.
- [x] Confirmed which fields the search response carries (`image`, `additionalImages`, `itemCreationDate`, `itemLocation`, `shippingOptions`) versus what needs `getItem` (description HTML, `shipToLocations`). Measured over 162 summaries: `itemCreationDate` and `itemLocation` always; `image` 160/162, `additionalImages` 131/162, `shippingOptions` 128/162 — **two listings had no image at all**. `description`, `shortDescription`, `shipToLocations`, `conditionDescription` and `returnTerms` are `getItem`-only, so **`shipsToUk` cannot be known before enrichment**.
- [x] Confirmed how "worldwide" behaves on `EBAY_GB` without a location filter and whether `itemLocationCountry` accepts one value or several. `EBAY_GB` returns the world by default (GB 24, US 19, JP 6, CA 1 of 50), which vindicates leaving the filter off per §5. `itemLocationCountry` takes **one value only**: `GB` and `US` each filtered correctly, while `{GB|US}` returned 200, the unfiltered total, and a Canadian listing — **accepted and silently ignored**.
- [x] Ten anonymised search responses and three `getItem` responses saved as fixtures. Eighteen files in `packages/sources/ebay/fixtures/`: fifteen searches and three items.

#### S1-02 Vinted spike — L

From your Mac first: fetch `vinted.co.uk`, capture the session cookie, call the catalog JSON endpoint for `carmageddon` ordered newest first, page twice. Then the same from the droplet, then from the droplet through a residential proxy with a sticky GB session. Then `vinted.fr` from wherever worked. Also check whether `vinted.co.uk` results already include EU sellers.

Done when:

- [ ] A table in SPIKES.md: origin (Mac / droplet / droplet+proxy) × outcome (JSON works / needs browser / blocked), with the DataDome response observed.
- [ ] Whether a persisted cookie survives between runs a day apart, and for how long.
- [ ] What a safe request pattern looks like (spacing, pages per poll) based on what was observed.
- [ ] Whether EU domains are needed for EU coverage.
- [ ] Fixtures: three catalog pages and two item detail responses (with personal data stripped).

#### S1-03 Yahoo! Auctions JP spike — M

Fetch the search page for `カーマゲドン` and `macintosh` sorted newest first, parse cards (title, price, image, end time, id, seller), fetch one item page for the description and gallery.

Done when:

- [ ] Works from the droplet without a proxy, or the failure mode is documented.
- [ ] Parsing is stable across auction and fixed-price ("即決") listings.
- [ ] Fixtures: two search pages and two item pages.

#### S1-04 Mercari JP spike — M

Generate the DPoP token, call the search API for `カーマゲドン`, fetch one item's detail.

Done when:

- [ ] Works from the droplet, or the failure mode is documented.
- [ ] The token generation is captured as a small standalone function with a test.
- [ ] Fixtures: two search responses and two item responses.

#### S1-05 Findings written up — S

Done when `docs/SPIKES.md` has a one-page summary per source with a recommendation (build as designed / build with changes / defer) and the Phase 4 entry in ARCHITECTURE.md is updated to match.

### Track B — product

| Id | Task | Size | Depends on |
|---|---|---|---|
| P1-00 | Hardening from the Phase 0 review | S | P0-15 |
| P1-01 | Domain schema | M | P0-05 |
| P1-02 | Core types and Zod schemas | M | P1-01 |
| P1-03 | Adapter contract, context, template, test harness | L | P1-02, P0-06 |
| P1-04 | eBay adapter | L | P1-03, S1-01 |
| P1-05 | Media ingest | M | P1-01 |
| P1-06 | Currency conversion | S | P1-01 |
| P1-07 | Poll scheduler and candidate ingestion | L | P1-04, P1-05 |
| P1-08 | AI layer: roles, providers, cost ledger, budget cap | L | P1-02 |
| P1-09 | Pre-filter | M | P1-08 |
| P1-10 | Reviewer | L | P1-08, P1-05 |
| P1-11 | Decision rules | M | P1-02 |
| P1-12 | Review worker pipeline | L | P1-07, P1-09, P1-10, P1-11 |
| P1-13 | Spec editor (manual) | M | P1-02, P0-09 |
| P1-14 | Wanted items UI | M | P1-13 |
| P1-15 | Candidates and verdicts UI | L | P1-12, P1-14 |
| P1-16 | Dashboard | M | P1-12 |
| P1-17 | Prompt eval suite in CI | M | P1-09, P1-10, P1-11 |
| P1-18 | Typed spec form (pulled forward from Phase 2) | L | P1-13, P1-14 |
| P1-19 | Wish list | M | P1-14 |
| P1-20 | Categories for wanted items | S | P1-19 |
| P1-21 | Tags for wishes | S | P1-19 |
| P1-22 | Custom categories | M | P1-20 |
| P1-23 | Settings pages and navigation icons | S | P1-22 |
| P1-24 | Item page sections and their editors | M | P1-18, P1-23 |
| P1-25 | Wanted item cards and display images | M | P1-24 |
| P1-26 | Creating an item from a dialog | M | P1-25 |
| P1-XX | Phase 1 exit | S | all above, S1-05 |

**Phase 1 stays open until the MVP is where the owner wants it**, rather than closing when the tasks first listed here are done (decided 22 September 2026). Tasks are added to this table as they are identified, numbered on from P1-18, and the exit keeps the id P1-XX so that it is always the last row and "all above" always means everything Phase 1 has taken on.

#### P1-00 Hardening from the Phase 0 review — S

Six small items from the security pass at the end of Phase 0, taken before anything is built on
top. Sessions: the table stores the SHA-256 of the cookie token rather than the token, so a
database copy or a backup cannot be replayed (existing sessions are signed out once by the
upgrade). Dumps: `backup.sh` and `deploy.sh` write owner-only files. Headers: HSTS, a same-origin
CSP, `frame-ancestors 'none'`, `nosniff` and a strict referrer policy on every response, set in
the API and tested there. Logs: rotated in compose. Plus two things only the operator can do,
documented in RUNNING.md.

Done when:

- [x] `auth_session.id` is a hash; the cookie value looked up as if it were a stored id resolves nothing, and every existing session test still passes.
- [x] A fresh nightly dump and a fresh pre-deploy dump are mode 600.
- [x] Every response, the served page included, carries the headers above; a test asserts each, and the Playwright run passes under the CSP.
- [x] `docker-compose.yml` caps each service's log at five files of 10 MB.
- [ ] Dependabot alerts and secret scanning are enabled on the repository, and Renovate is reading the committed config (the default branch is `development/0.2.0` until the final merge).
- [ ] `sshd -T` on the droplet answers `permitrootlogin no`, `passwordauthentication no` and `kbdinteractiveauthentication no`, per RUNNING.md step 2.

#### Decision — no marketplace user data is persisted (from S1-01, 13 September 2026)

S1-01 found that an eBay production keyset arrives **disabled** behind the Marketplace Account
Deletion gate: every call fails until the app either hosts a challenge/notification endpoint or
claims the exemption for not persisting eBay user data. ARCHITECTURE.md §18 had predicted no such
gate; §2, §4, §7, §12 and §18 are corrected in v1.23 and `docs/SPIKES.md` records the evidence.

The exemption is taken, and it is made truthful rather than asserted: `Listing` stores
`sellerHash` — `HMAC-SHA256(seller id, instance salt)` — instead of `sellerId`/`sellerName`, and
ingest strips the seller block from the stored `raw` response. Relist detection (§7 step 2) tests
only "same seller as before", which is equality, so a hash serves it unchanged; nothing in the UI
or in an email ever displayed a seller. Hosting the endpoint was rejected: it would put an
unauthenticated public route into an API whose contract (P0-07) is that everything but `/healthz`
and auth returns 401, and would hand every self-hoster a standing erasure obligation.

This lands in **P1-01** (the column) and **P1-04** (the eBay adapter computes the hash and strips
`raw`), and there is no migration to write because no domain table exists yet.

#### P1-01 Domain schema — M

Tables from §4: `wanted_items`, `spec_versions` (with `settings`, `criteria`, `search_plans`, `reference_images` as JSONB validated at the boundary), `search_plan_state` (per plan id: watermark, last run, counters), `grading_scales` (stub), `listings`, `seen`, `candidates`, `verdicts`, `feedback` (stub), `notifications` (stub), `cost_ledger`, `media`.

Done when:

- [x] Migrations apply on a fresh database and on top of Phase 0's. Both run: `0002` applied to the dev database carrying Phase 0's four tables, and to an empty `gb_fresh`, giving the same seventeen tables and twenty-four check constraints; running it twice more is a no-op.
- [x] Unique constraints: `seen (source, external_id)`, `listings (source, external_id)`, `candidates (wanted_item_id, listing_id)`, `notifications (candidate_id, channel)`. All four present in the database, verified by query rather than by reading the migration.
- [x] Indexes for the queries the UI will make: candidates by item and verdict; listings by first seen. `candidates (wanted_item_id, created_at)` and `(wanted_item_id, stage)`, `verdicts (candidate_id, created_at)` and `(decision)`, `listings (first_seen_at)`. The verdict filter is served through the join rather than by denormalising a decision onto `candidates`; if P1-15 finds that slow, that is the moment to denormalise, not before.
- [x] `listings` has `seller_hash` and no column that could hold a seller name, per the decision above; the hash helper is unit-tested, including that two instances with different secrets hash one seller id differently. Fourteen tests, eight of them against a real Postgres. The salt is a row encrypted under the master key rather than derived from it, so rotating that key re-wraps one value instead of silently orphaning every hash — there is a test that rotates it and asserts the hashes still match.

#### P1-02 Core types and Zod schemas — M

`SpecSettings`, `Criterion`, `SearchPlan`, `ReferenceImage`, `WantedSpec`, `Listing`, `Verdict` and its per-criterion results, all as Zod schemas with inferred types, shared by API, UI, adapters and the AI layer.

**The criteria linter §4 asked for is not built, and §4 is amended to match (v1.24).** It would have matched criteria text against prices, countries and listing types — but none of those are loose: `priceCeiling` is `{ amount, currency: 'GBP' }`, `listingTypes` and the rest are enums, a region is a field on the search plan, and each is a hard filter running before any model is called. The only route to a price in a criterion is hand-typing one into P1-13's raw JSON editor, which Phase 3 closes twice over — the typed form gives the ceiling a number field, and `propose_spec` is typed so the agent cannot emit it. What is kept is the one check that compares typed fields rather than matching English, so it cannot misfire.

Done when:

- [x] Schemas round-trip the example specs for Carmageddon and the Power Mac 5500 (kept as fixtures). JSON in `packages/core/src/domain/fixtures/`, so P1-13's editor can seed itself from the same files it will be tested against. The round trip is parse → JSON → parse, because a spec lives in JSONB and is read back on every poll; anything the schema silently dropped would be lost between versions.
- [x] The linter has tests for each pattern it catches and for a clean spec. Amended: there are no patterns, by the decision above. The surviving check is tested for the case it catches, for the three field combinations it must leave alone, for a clean spec, and — deliberately — for *not* flagging a criterion that merely mentions a price or a place, so the regexes are not reinstated by reflex.
- [x] A spec with a hard, non-quantifiable criterion is accepted but flagged in validation output (it is legal, just unusual). It parses, and `lintSpec` returns `hard_non_quantifiable` explaining that such a criterion rejects on a blurry photo as readily as on a real fault, and that `soft` is usually what was meant. The Power Mac example carries one deliberately (`model-family`), so the fixtures cover the case rather than only the unit tests.

#### P1-03 Adapter contract, context, template, test harness — L

`SourceAdapter` and `AdapterContext` from §5. The context provides: an HTTP client (undici) with per-source concurrency, jittered delay, proxy support (HTTP and SOCKS5), a persisted cookie jar keyed by source and domain; a Playwright browser factory that enforces one browser at a time and blocks images and fonts; a logger; credentials from settings. `packages/sources/_template` is a compilable adapter that returns fixture data. A test harness replays recorded fixtures through an adapter and asserts on normalised output.

Two structural decisions worth recording. **The browser factory lives in `apps/worker`, not in core**: core declares `BrowserFactory` and a narrow `BrowserPage` that Playwright's own `Page` satisfies structurally, so `packages/core` — and the slim image, and an API-only deployment — never depend on a browser. And **`SOURCE_IDS` is split**: `MARKETPLACE_SOURCE_IDS` is what gets a `poll.<id>` queue, a Settings section and a place in `WORKER_SOURCES`, while `SOURCE_IDS` is the wider set of values a `source` column accepts and includes `_template`. Without that split the template adapter's listings fail the `listings_source` check constraint, which P1-07's ingestion tests need to write.

Done when:

- [x] The template adapter passes the harness and is the documented starting point in `docs/ADAPTERS.md` (first draft). Thirteen tests. It is a working adapter rather than a stub, and demonstrates the three things S1-01 showed are easy to get wrong: normalising an auction price the source reports under another name, hashing the seller and dropping the rest, and stopping at the watermark instead of filtering afterwards. The harness validates every returned listing against `rawListingSchema`, so an adapter that parses a page but produces something the pipeline cannot store fails in its own tests; two tests cover the harness itself, including that an unrecorded request throws rather than quietly returning nothing.
- [x] The HTTP client's spacing and concurrency are tested with a fake clock. Nine tests. The first attempt faked `sleep` with a shared counter, which makes two concurrent waits sum rather than overlap and made a correct client look broken; it uses Vitest's fake timers instead, which model concurrency properly and exercise the real sleeping path.
- [x] Cookie jar persistence survives a process restart (integration test against the dev database). Ten tests against a real Postgres, plus nine on the `set-cookie` parser. A "restart" is a second jar over the same database with no shared memory, which is what a redeployed worker is. Expired cookies are dropped on read as well as on write, because a worker that stored one and then slept must not send a stale one when it wakes; a session cookie with no expiry survives, which is what Vinted needs.
- [x] The proxy setting is honoured by both the HTTP client and Playwright (tested against a local proxy in CI). Both halves run a real forward proxy in-process and assert the request arrived there rather than at the origin. This caught a defect that would have shipped silently: a `ProxyAgent` from the installed undici is rejected by Node's *global* `fetch` (`invalid onRequestStart method`), so the proxy would never have applied — the client now uses undici's own `fetch`. CI installs Chromium for the unit-test job so the browser half runs rather than skipping.

#### P1-04 eBay adapter — L

Per §5, informed by S1-01. Token caching with refresh before expiry. `search` runs one request per marketplace in the plan, with `sort=newlyListed`, `itemStartDate` from the watermark, and the plan's filters; pages until the watermark or the cap. `enrich` calls `getItem`. `healthCheck` performs a one-result search. Settings section for eBay credentials with a Test button.

Done when:

- [x] Harness tests cover: new listings since watermark, empty result, pagination stop, `shipsToUk` derived as yes/no/unknown, price and currency captured, auction versus fixed detected. Forty-nine tests over the eighteen recorded fixtures, plus eleven on the ships-to-UK derivation alone — including the `WORLDWIDE` and `WORLD_REGION` shapes S1-01's three sampled items did not contain, which are therefore handled from eBay's schema rather than from evidence and fall back to `unknown` rather than guessing.
- [x] No seller identity survives ingest: a test asserts the stored `raw` has no `seller` block at all and that `seller_hash` is the HMAC, so the account-deletion exemption stays truthful. Asserted on search results and on enriched ones, and confirmed against live data by the check below: `raw has seller block: false`.
- [x] An auction's `price` is `null` and its value is in `currentBidPrice` (S1-01); the adapter normalises the two, and a fixture test covers an auction so the price-ceiling filter cannot be handed a null. The `gb-auction-only` fixture is the one recorded for it.
- [x] `itemLocationCountry` is sent as a single value only; the `{A|B}` set form is never generated, because S1-01 found eBay accepts it and silently ignores it. `buildFilter` has a test for the single value and one proving an array handed to it is dropped rather than turned into a set; `describeSearchOptions` says so in the field's own description, so the UI explains it too.
- [x] A live run against your keyset from the dev environment returns real Carmageddon listings. `pnpm --filter @goodies-beacon/source-ebay live-check`, run 13 September 2026: health `ok` with 4,920 of 5,000 Browse calls left, five real listings on `EBAY_GB`, and an enrich returning a 2,135-character description, ships-to-UK `yes`, and no seller block in `raw`. It is a script rather than a test because it spends quota and needs credentials.
- [x] Rate: never more than one request in flight per marketplace; quota usage is recorded in the health status. The health check reports remaining calls and turns `degraded` past 90% spent; it still reports `ok` when the quota endpoint says nothing, as sandbox does. Concurrency holds by construction — each page is awaited before the next — which is exactly the kind of property a later refactor breaks silently, so a test wraps the client and asserts the peak is one.

#### P1-05 Media ingest — M

Fetch listing and reference images through the adapter HTTP client with an SSRF guard (deny private and link-local ranges, follow at most two redirects, cap at 15 MB), verify content type, re-encode with sharp, produce a stored copy (longest edge 1024 for listing photos, 800 for reference images) and a thumbnail, compute a perceptual hash, and store under `MEDIA_DIR` with a `media` row. Serve through `/api/media/:id` with caching headers.

Done when:

- [x] Tests cover the SSRF guard, the size cap, a non-image response, and a corrupt image. Sixty-one tests. The guard blocks on the resolved *address*, not the hostname, because `evil.example.com` can resolve to 127.0.0.1 as easily as `localhost` can; it refuses when **any** answer is private rather than picking the public one, which is what a DNS rebinding attempt wants; it sees through IPv4-mapped IPv6 (`::ffff:127.0.0.1` reaches loopback just as well); and it re-checks at every redirect hop, since the trick is a public host answering 302 to `169.254.169.254`. The size cap is checked twice — once against `content-length` to save the download, once against the bytes actually read, because `content-length` is a claim.
- [x] Two identical images uploaded twice produce one stored file (hash-based dedupe). Keyed on a SHA-256 of the *original* bytes, so the second arrival is recognised before any re-encoding is done. Four concurrent ingests of one photo settle on one row: the unique index decides and the losers read back what the winner wrote, rather than failing the poll.
- [x] Reference image upload from the UI works and shows the running "images per review" count. **Finished by P1-18**: the editor's reference-image panel uploads, shows each image as a labelled thumbnail, counts the images sent with every review and nudges at six, as the item page's spec card already did. What follows is how it stood before that. **Half done, and the remainder belongs to P1-13.** `POST /api/media` accepts an upload with a label, re-encodes it and returns the row, and `GET /api/media/:id` and `/:id/thumb` serve it with an immutable cache and an ETag. There is no page to put the control on: §7's running count lives on the item page, and P1-13's own description carries "reference image upload with labels (P1-05)". Building an unmounted component now would be guessing at what that task needs.

#### P1-06 Currency conversion — S

Daily ECB rates (frankfurter.app or equivalent) cached in the database; `toGbp(amount, currency)` with the rate date recorded on the listing.

Done when:

- [x] Rates refresh daily. A `rates.refresh` cron job runs twice — just after the ECB's usual publication time in London, and again in the evening in case the first attempt met a network that was down — and the second is a no-op once the day's rates are stored. A worker narrowed by `WORKER_SOURCES` does not take the job: a satellite polls, and the core keeps the shared work.
- [x] A missing rate falls back to the last known one with a warning. A price converted at Friday's rate is far more useful than no price, so the newest stored rate is used however old it is, and the warning fires once per currency per process rather than once per listing. A currency that has never had a rate converts to null, which §7's hard filter must read as "price unknown" rather than "free".
- [x] Conversion is unit-tested. Twenty-nine tests, fifteen of them pure. Rates are stored as units per GBP, one row per currency per **publication** date — the ECB publishes on working days only, so "latest" on a Monday is Friday's, and old rows are kept rather than overwritten so a verdict from July stays explainable. Verified against the live service: $40 → £29.61 and ¥15,000 → £72.09 at the rates published 2026-09-11.
- [x] A zero, negative or non-numeric rate is dropped at the boundary, and an answer in a base other than GBP is refused — both would divide wrongly rather than fail, producing a confidently wrong price.

#### P1-07 Poll scheduler and candidate ingestion — L

Per §6. For every active item and enabled plan, a pg-boss cron schedule at the item's interval (default three times a day), staggered by a hash of the plan id. The poll job: load plan and watermark → adapter `search` → for each result, insert `listing`, `seen` and `candidate (origin=poll)`, and enqueue `review` for each candidate that was actually new to this item → advance the watermark to the newest processed listing → record per-plan counters and adapter health. Per-poll cap that stops paging without advancing the watermark past what was processed.

Two lines of that were amended while it was built, and both are in the decision below: **the skip test is per item, not a `seen` lookup**, and **the cap is 50 for a routine poll and 200 for a backfill**, which is what §6 says once its two numbers are read as the two different runs they describe.

Done when:

- [x] Integration test with the template adapter: two consecutive polls with overlapping results create each candidate once and advance the watermark correctly. Twenty-three tests in `apps/worker`, eleven of them against a real Postgres — it lives there rather than in core because core cannot depend on a source package without a cycle. It also covers the correction below: two wanted items each get their own candidate for one listing, where §6 as written would have given it to whichever polled first.
- [x] A poll that hits the cap resumes exactly where it stopped on the next run. **Not achievable as §6 was written, and §6 is corrected in v1.26.** Sources page newest-first, so a capped run takes the newest N and leaves a gap behind it that a `since`-only watermark cannot name; the next run would fetch the same newest N for ever. `SearchRequest` now carries an optional `until`, and `search_plan_state` records the window still owed — a capped run advances the watermark and records the gap, and the next runs walk it backwards until it is empty. The test proves it over twenty-five listings and a cap of ten: three runs, every listing reached exactly once, the backlog closed. eBay's `itemStartDate` takes a range, so the adapter cost one field. A plan's *first* run is deliberately exempt: its window is the whole history of the query and sweeping that is what `settings.backfill` is for.
- [x] Adapter failures are recorded as health events and retried with backoff, not silently dropped. The error and the run time land on the plan, with `last_success_at` left standing so the dashboard can say "failing since" rather than only "failed", and pg-boss retries three times with a widening gap. Two cases are tested: a failing marketplace records and rethrows, and a later success clears the error. The ingest records what it finished even when a listing throws half way, so a batch with one bad listing makes progress instead of repeating from the start for ever.
- [x] Changing an item's interval or pausing it updates the schedule without a restart. A `schedules.reconcile` job runs every minute on the core worker and diffs the desired schedules against pg-boss's, keyed by plan id; both cases are tested against a real database, and the whole path was run against a real pg-boss on 14 September 2026 — a `ROLE=all` process picked up an item seeded while it was running and installed `poll.ebay`/`smoke-plan` as `13 1/2 * * *` (the item's PT2H, staggered), and pausing the item removed it within the minute, neither needing a restart. The same run proved `review.candidate` is created without being consumed. Intervals are snapped up to a period cron can express — a step runs within its field, so `*/7` on the hour fires at 0, 7, 14, 21 and then 0 again — and clamped to the adapter's `recommendedMinInterval`, whatever the item asks for.

#### Decision — the candidate gate is per item, and the cap leaves a backlog (from P1-07, 14 September 2026)

Two things in §6 did not survive contact with the code, and ARCHITECTURE.md v1.26 corrects both.

**"New `(source, externalId)` pairs not in `Seen` become Listings and Candidates."** `Seen` is
keyed on `(source, externalId)` and is therefore global, while a Candidate is per wanted item. Two
items searching the same marketplace meet the same listing, so gating on `Seen` gives it to
whichever polled first and starves the other with nothing to notice. The per-item test is the
`candidates (wantedItemId, listingId)` unique index, which the poll inserts against rather than
checking first. `Seen` keeps its other jobs: what is genuinely new to the instance, relist
detection, and the one case the index cannot cover — retention deletes a candidate and the listing
behind it, so a "Scan current listings" sweep can meet a listing whose candidate was pruned.
Closing that completely means a wanted item id on `Seen` and a migration; it was judged not worth
one for a case bounded to a button the owner presses, whose results §6 already routes to a summary
email rather than a real-time one.

**The per-poll cap.** §6 gave two numbers — 50 for a routine poll's new candidates, 200 for a
backfill — and P1-07's own description said 200 for both. Both of §6's numbers are kept and are
settings fields: a poll that runs three times a day is capped at 50, a deliberate one-off sweep at
200.



#### P1-08 AI layer: roles, providers, cost ledger, budget cap — L

`packages/ai` per §9: three roles configured as `provider:model`; provider factory over the Vercel AI SDK for Anthropic, OpenAI, Google, OpenRouter and Ollama (the last two through one OpenAI-compatible client, since both speak that wire format); `generateObject` wrapper that records input/output tokens and computed cost to `cost_ledger` with role, item and candidate; a monthly budget cap that pauses review jobs and records a `budget_exceeded` event; image handling with the `separate` packing strategy (contact sheet deferred to Phase 5) and the cached-prefix ordering; provider keys in Settings with a Test button per provider.

Done when:

- [ ] Swapping the reviewer between two providers is a Settings change and the eval suite (P1-17) passes on both. **First half done, second half belongs to P1-17.** A caller names a *role* and a Zod schema and never a provider, and a test writes two different `provider:model` values into Settings and asserts that a byte-identical call reaches each in turn and is priced correctly against both. There is no eval suite to run yet; this box ticks when P1-17 runs its suite against two providers, which is a change to that task rather than to this code.
- [x] Cost is computed from a price table in the repo with the date it was last checked, and unknown models log a warning rather than zero. `packages/ai/src/pricing.ts`, checked 14 September 2026 against each provider's own pricing page. An unpriced model records `costKnown: false` and warns once per model per process rather than once per listing — a zero would read as "this was free" on the costs page and let the budget cap run past its limit. OpenRouter is permanently in that state by design, since it reprices per underlying model; Ollama's zero is a fact rather than a gap, and does not warn.
- [x] The budget cap is tested: with a £1 cap and a fake ledger at £1.01, review jobs are deferred and one notification event is written. Exactly that, against a real Postgres, plus forty-nine more jobs arriving in the same month to prove the "one event" half — the unique index on (kind, dedupe_key) is what enforces it rather than a convention. Twelve tests in all, covering the month boundary, the year rollover, a second event for a second month, and the case where no dollar rate is stored: reviews continue, because the cap is a guardrail rather than a credit limit and stopping every review over a rates outage is the worse failure.

#### Decision — cached tokens are counted apart, and prompt images are never URLs (from P1-08, 14 September 2026)

Two things surfaced while building it, both now in ARCHITECTURE.md v1.27.

**Cached input is its own column.** The AI SDK reports `usage.inputTokens` as the *total* input
including everything read from or written to the cache, while the three are charged at three
different rates. Recording the total as `inputTokens` and the cache figures beside it bills the
same tokens twice — a cached review would look several times dearer than it was and the monthly
cap would fire early. `cost_ledger` gains `cache_read_tokens`, `cache_write_tokens` and
`cost_known`, and `splitUsage` has the tests that pin the arithmetic.

**A prompt image is bytes, never a remote URL.** The SDK resolves a URL by fetching it itself,
which would send a marketplace-supplied address out of the worker with none of §12's protections —
no private-address block list, no size cap, no content-type check — while P1-05 was built to do
that fetch under guard. Found by a test that passed `https://example.invalid/…` and watched the
SDK try to resolve the hostname. The prompt builder now refuses an `http(s)` URL rather than
trusting its caller, because the failure is silent and the input is attacker-controlled.

#### P1-09 Pre-filter — M

Prompt and structured output `{ plausible, reason }` per §7 step 3, including the per-item plausibility note. Token-bounded input (title, first 1,500 characters of description, spec summary, criteria titles).

Done when:

- [x] Fixture tests: obvious misses are rejected and plausible or ambiguous listings pass, on the configured cheap model. Nineteen cases in `packages/ai/fixtures/prefilter-cases.json` across both example specs in both directions, several deliberately near the line — a job lot in which the item is one of six, a machine described as "spares or repair" when the spec says "working or repairable", a Japanese Performa listing. Run 15 September 2026 on `google:gemini-3.1-flash-lite`: **19/19, no wrong discards, no wrong keeps, $0.0047**. Twenty-nine offline tests cover the bounding, the prompt assembly and the fail-open path. P1-17 turns the same fixtures into a CI gate across two providers.

  Running it against a *second* provider found the thing that mattered most: **structured output did not work on OpenAI at all.** A Zod `.default()` makes a field optional, an optional field is left out of the JSON Schema's `required` list, and OpenAI refuses the schema — so `openai:gpt-5-nano`, the shipped default for this role, could not answer a single call, while Gemini accepted the same schema without comment. Three of the reviewer's four fields carried defaults too, so P1-10 would have hit it harder. Fixed in `packages/core/src/domain/verdict.ts` by expressing optionality as `nullable`, and pinned by `model-schemas.test.ts`, which walks every model-facing schema at every level. ARCHITECTURE.md §9's "switching providers is a settings change" now states the condition that makes it true.

  Two more things the first run found, neither of them the prompt. The script loaded `.env` but never passed the keys into the AI layer, so every case took the fail-open path and reported as "could not run" — which is why the check fails rather than passes when a case cannot be run, and why `GenerateDeps.env` now says in its own docblock what omitting it costs. And it fired all nineteen requests flat out, tripping the free tier's fifteen-a-minute limit; it is paced at twelve a minute now, with `--rpm` to raise it on a paid key.

  One fixture was wrong and was corrected rather than the prompt: an iMac G3 named outright in the title, against a spec naming the 5500, 5400 and Performa 5xxx, was written as `plausible` on the reasoning that the reviewer reads the model from the photographs. That reasoning belongs to a listing whose model is *unstated* — which is a separate case, `powermac-vintage-apple`, and is kept. Where the title names a different model line there is nothing for the photographs to settle, and rejecting it is right.
- [x] The prompt is a versioned file in `packages/ai/prompts/` with a changelog header. In `packages/ai/src/prompts/` rather than `packages/ai/prompts/`, and a `.ts` module rather than Markdown — see the decision below. P1-17's path filter is therefore `packages/ai/src/prompts/**`.

#### Decision — a prompt is a module under `src/` (from P1-09, 15 September 2026)

The obvious shape for a prompt is a Markdown file read at runtime. It is the wrong one here:
`tsc` emits only what is under `src`, so a Markdown prompt — or a `.ts` one at the package root —
needs its own line in the Dockerfile's hand-maintained copy list, and forgetting a line in that
list has already broken the image twice (P1-04, P1-08). A prompt that is a module under `src` is
built and shipped by the same mechanism as the code that uses it, cannot drift from it, and is
type-checked. The cost is that the text is a template literal rather than prose in a file, which
is small: the file is still nothing but the prompt and its changelog.

#### P1-10 Reviewer — L

Prompt and structured output per §7 step 5: per-criterion `{ criterionId, result: pass|fail|unknown, evidence }`, `englishSummary`, `shipsToUk`, optional `grade` (null until Phase 5). Inputs ordered for prompt caching: spec, criteria, reference images with labels, then the listing. The quantifiable/soft instruction wording from §7 is in the prompt.

Done when:

- [x] Structured output is validated with Zod; a malformed response is retried once and then recorded as a review failure visible in the UI. Held to `reviewerOutputSchema`, then reconciled against the criteria that were actually asked — see the decision below. `runReviewer` throws `ReviewFailedError` carrying the prompt; P1-12 turns that into the `failed` stage the UI shows, which is why the box is ticked here for everything but the rendering.

  **The retry did not exist.** P1-08 set the SDK's `maxRetries` to 1 and documented it as the malformed-output retry, but `maxRetries` covers *retryable API errors* — a 429, a 5xx, a dropped connection — and a response that parsed but did not match the schema is not one of them, so `generateObject` threw on the first attempt however high it was set. Nothing noticed because no test counted the calls. `generateForRole` now retries `NoObjectGeneratedError` itself, exactly once, and two tests in `generate.integration.test.ts` count the attempts: one that the second failure gives up, one that an answer arriving on the retry is accepted. The pre-filter gets the same fix for free.
- [x] Fixture tests cover: a clear pass, a clear hard fail (visible damage), an unknown (contents not visible), and a Japanese listing producing an English summary. Eight cases in `packages/ai/fixtures/reviewer-cases.json` across both example specs, including the four named above, a prompt-injection attempt and a hard fail on a criterion whose `onUnknown` is `reject`. `pnpm --filter @goodies-beacon/ai reviewer-check` runs them against the configured model and grades each criterion, `shipsToUk` and the summary separately. It is paced at four requests a minute, not the pre-filter check's twelve: the reviewer-tier free tiers are much tighter than the cheap models' — Gemini 3.8 Flash allows five a minute and twenty a *day* — so a run at ten reports three quarters of its cases as failures of the model rather than of the rate limit, and a free key is good for about two full runs a day per model. Thirty offline tests cover the prompt assembly, the bounding, the reconciliation and the fixture set's own well-formedness.

  Run 15 September 2026 on `google:gemini-3.6-flash`: **41/41 checks, all eight cases, $0.066**. The prompt-injection case passed on every run of the day — the model reported the jewel-case sequel as failing three criteria and ignored the instruction to mark everything as a match.

  Getting there took two fixture corrections and no prompt changes, which is the ratio P1-09 saw too. The Japanese listing's `crt-condition` was written expecting `pass`; the seller denies burn-in only, while the criterion also asks about cracks and discolouration that nothing settles, so `unknown` is the honest answer and the model was right. And `performa-parts-only` no longer asserts `all-in-one` at all: for a shell with the CRT removed the criterion admits two readings — it is the all-in-one form factor rather than a tower, but it has no screen built into it either — and a fixture that encodes an arbitrary choice between them produces a red run that teaches nothing. The case still asserts the hard `complete-machine` fail it exists for.

  That second one is worth carrying into P1-13 and the interviewer: **a criterion that bundles a form-factor test with a component-presence test cannot be answered cleanly for a partial item.** It is the spec author's problem, not the reviewer's, and it is the kind of thing P1-02's linter could learn to warn about.

  **Every fixture carries its evidence in the seller's text, because the repository holds no listing photographs to commit.** That is a real limit of this set and it is recorded in the fixture file rather than papered over: these cases prove the reviewer reads evidence, reports unknowns honestly and translates, but none of them proves it can read a photograph. The `images` field exists for when photographs are added; the vision path itself — ordering, labelling, and the refusal to accept a remote URL — is pinned offline by `images.test.ts` and by the reviewer's own integration tests.
- [x] The exact prompt and image list sent are stored with the verdict so "Show prompt" can display them. `ReviewResult` carries `promptText` and `promptImages` for P1-12 to write to the `verdicts.prompt_text` and `prompt_images` columns P1-01 created. Images are named, never embedded — base64 bytes per verdict would dwarf every other row in the database and the nightly dump with it — so `promptImages` is `{ mediaId, label, kind }` in the order the images were sent, and the labels appear in the text where the pictures were. A `ReviewFailedError` carries both as well, because the first question after a failed review is always what was actually sent.

#### Decision — the reviewer's answers are reconciled against the criteria (from P1-10, 15 September 2026)

Zod proves the *shape* of a response, not that it answered the question. A model can return four
well-formed results for five criteria, or invent a `criterionId`, and both parse. A criterion with
no answer is therefore filled in as `unknown` rather than dropped: §7 step 6 surfaces an unknown to
the collector or rejects on it, where a dropped criterion would let a silent omission read as a
pass and email them something the rules were never given the chance to stop. An unrecognised id is
dropped instead — there is no criterion for the rules to apply it to — and both cases log.

#### Decision — the reviewer fails loudly where the pre-filter fails open (from P1-10, 15 September 2026)

The two stages sit either side of the same asymmetry and land opposite ways up. The pre-filter
keeps a listing it could not judge, because a wrongly discarded listing is never reviewed and
nobody finds out. The reviewer cannot do that: there is no later stage to catch what it missed, and
a review that silently produced nothing is a listing the collector is never told about. So it
throws, P1-12 records a visible `failed` candidate with the error, and it is retried with backoff.

#### P1-11 Decision rules — M

Pure function from `(spec version, reviewer output)` to `{ decision, reasons }` implementing the rules in §7 step 6, including `onUnknown` per criterion and the item default.

Done when: a table-driven unit test covers every rule branch, and the function is the only place a decision is made (the reviewer never outputs a decision).

- [x] `decideVerdict` in `packages/core/src/domain/decide.ts`, pure: no database, no clock, no model. Thirty-three tests in `decide.test.ts`, the first eight of them the rule table itself — one row per line of §7 step 6, in the direction that fires it and the direction that does not — then the grade rules, the ways results can fail to line up with the criteria, and both example specs.
- [x] The reviewer cannot express a decision: two tests in `model-schemas.test.ts` assert that neither `reviewerOutputSchema` nor its per-criterion entry has a `decision`, `reasons` or `verdict` property, so a model's opinion has no route to the verdict.

**§7's rules are listed in reading order, not severity order, and evaluating them in order and stopping at the first hit is wrong.** Rule 2 (soft fail) yields uncertain and rule 4 (unknown set to reject) yields reject, so a listing with both would be emailed as uncertain when the rules meant to reject it. Every rule is evaluated, the reasons accumulate in §7's order because that is the order a person reads them in, and the worst outcome wins.

Anything that stops the grade being compared — no grade reported, no scale attached, a label that is not on the scale, a minimum that is not on the scale — surfaces as uncertain rather than passing. A minimum the instance cannot actually check is a configuration fault, and silently matching would hide a broken scale behind a stream of apparently fine verdicts.

#### Two things P1-11 found that belong to later tasks

**`verdicts` has nowhere to put `reasons`, and will not get one.** The table has a singular `reason`, which is the `REJECTION_REASONS` enum for hard-filter rejections (`over_budget`, `negative_keyword`, `prefilter`) and is null when the reviewer decided. `verdictSchema` in `verdict.ts` separately declared `reasons: string[]` and its docblock called itself "the stored row", which it is not — there is no such column and no migration adds one.

  Resolved in favour of **deriving them**, and the docblock is corrected to say so. `decideVerdict` is a pure function of the spec version and the per-criterion results, both of which are already stored and the spec version immutably, so re-running it reproduces the reasons exactly, for ever, for nothing. A column would be a second copy of something already implied, free to drift from the rules that wrote it the first time a reason's wording changes. P1-12 therefore stores `decision` and `criteria_results` and nothing else new; P1-15 calls `decideVerdict` when it renders.

  **The condition this rests on is that every input stays recoverable from the row**, which it is today and which Phase 5 could quietly break: a verdict must reference a grading scale *version* rather than a scale, or editing a scale rewrites the explanation of every verdict judged under the old one. §4 already versions scales "so a verdict can name the grade images it saw" — this is the same requirement arriving from the other direction, and it is recorded on `verdictSchema.reasons` where whoever adds grading will be looking.

**`SpecSettings.defaultOnUnknown` is currently unreachable.** The plan asks P1-11 to honour "`onUnknown` per criterion *and* the item default", but `criterionSchema` hard-defaults `onUnknown` to `surface`, so every parsed criterion carries an explicit value and the item default never applies. For the fallback to mean anything a criterion needs a way to say "no opinion", which is a nullable field and therefore a P1-02 schema change owned by the spec editor (P1-13). `decideVerdict` implements the fallback already — `resolveOnUnknown` takes the criterion's setting when it has one and the item default otherwise — so the rules will not need changing when it arrives, and the behaviour is tested from both directions today.

#### P1-12 Review worker pipeline — L

The `review` job per §7: normalise → hard filters (price ceiling via P1-06, negative keywords) → pre-filter → enrich → media ingest → reviewer → decide → store verdict → notify. Stage recorded on the candidate; each stage idempotent so a retried job doesn't double-spend.

Notify is deliberately minimal here: for a `match` or `uncertain` on a realtime-mode item with `origin = poll`, write the `Notification` row and send one plain-text email through the P0-10 transport — title, price, verdict, the unknowns if uncertain, the listing link and the candidate link. No template, no digest, no batching of backfill results; those are the notifications phase. It is here because the transport already exists and an email is the product's actual output; without it the reviewer's work is only visible to someone refreshing a tab.

Done when:

- [x] Integration test with the template adapter and a fake AI provider runs a candidate through every stage and asserts the stored verdict and cost rows. Eighteen cases in `apps/worker/src/review.integration.test.ts`, against a real Postgres. The fake is injected at the *port* — the same seam the worker uses to wire the real AI — rather than at the provider, because what is under test is which stages run, what stops the pipeline early, what is stored and what is sent; whether the prompts judge well is what the two check scripts measure against real models.
- [x] A candidate rejected by hard filters has no AI cost. Asserted for both filters: the price ceiling and a negative keyword each leave `cost_ledger` empty, the pre-filter and reviewer ports uncalled, and a verdict whose model columns are null so nothing pretends a model was consulted.
- [x] Re-running the job for a completed candidate is a no-op. Also covered: a re-delivered job resumes at the stage the candidate reached, so a worker that died after enrichment does not pay for the pre-filter again.
- [x] Failures at any stage leave the candidate in a visible `failed` state with the error, and are retried three times with backoff. The error is written to `candidates.error` and re-thrown so pg-boss retries; `retryLimit: 3, retryBackoff: true` on the queue, asserted in `registrations.test.ts`.
- [x] A `match` on a realtime item sends one plain email and writes its `Notification` row first, so a retried job cannot send twice; a `reject`, a digest-mode item, and a backfill candidate send nothing. All five cases tested, plus an uncertain email naming its unknowns per §10 and a second delivery finding the row already claimed.

**A failed candidate starts again from the top, and that is a decision rather than an oversight.** `stage` holds one value and §4 makes `failed` a terminal state of its own, so it necessarily overwrites how far the candidate got; remembering that would take a second column. What restarting costs is a pre-filter call — a fraction of a penny — and an enrichment fetch whose images dedupe on their content hash. What it must never cost is a second *review*, and it cannot: a review that succeeded has already written its verdict and moved the candidate to `reviewed`, which is a no-op for ever after. The first draft of the test asserted the opposite and was wrong about the schema, not about the code.

**The verdict is written before the notification, and the notification row is claimed before the email is sent.** The first ordering means a mail server being down can never cause a re-review. The second is §10's at-most-once guarantee: the unique index on `(candidate_id, channel)` only holds if claiming the row is what decides whether to send, where recording it afterwards would let a job that crashed between sending and recording send again on its retry. The cost is that a crash between the claim and the send loses that one email, which is the right way round — a missed email is visible in the UI, where a duplicate teaches its owner to ignore them. A send that fails outright does **not** fail the candidate either: the review succeeded, the verdict is stored, and the row is left with `sent_at` null as the durable record of "claimed but never delivered".

#### Two things P1-12 found

**Relist detection is not implemented, and it is not simply deferred work.** §7 step 2 lists it beside the price ceiling and the negative keywords, and P1-12's own scope names only those two — but the ordering does not work as written either. Step 2 matches on image hashes while the images are not ingested until step 4, so a new candidate has no hashes to match on when the rule is supposed to run; only the title and the seller hash are available that early. Either the rule moves after the media ingest, or it is defined as title-and-seller only. Worth settling before it is built.

**Verdict token counts had no way to be filled in.** §4 puts `inputTokens`, `outputTokens` and `costUsd` on a Verdict, but `generateForRole` returned only the cost — the usage went to the ledger and no further. The AI layer's results now carry `usage` and `modelRef` alongside the cost, which is what lets a verdict say what judging *that* listing cost. The two answer different questions and must not be collapsed: the ledger is "what has this month cost" and is pruned by retention, the verdict is "what did this one cost" and is kept with it.

#### P1-13 Spec editor (manual) — M

Item creation and editing without the interviewer, at the size §17 gives Phase 1: "a manually-written spec (JSON in the UI, no interviewer yet)". A page with a title field, a JSON editor for the spec validated live against the P1-02 schemas with errors shown at the offending path, the P1-02 linter's warnings listed beneath, reference image upload with labels (P1-05), and a change note. Saving creates a new immutable spec version. The typed form — toggles and dropdowns for `SpecSettings`, the criteria and search-plan tables — and the side-by-side version diff are the interviewer phase's direct-editing work per §17, not this task's; the version history here is a plain list.

Done when:

- [x] The two example specs (Carmageddon, Power Mac 5500) can be entered end to end by pasting or typing their JSON. Both go in through the page in the Playwright smoke test, and through `/api/items` in `apps/api/src/items/routes.integration.test.ts`, which asserts that what comes back out is what went in.
- [x] A spec that fails the schema cannot be saved, and the error names the path; linter warnings from P1-02 appear beneath the editor. The same `wantedSpecSchema` runs in the browser as on the server, so the editor says what a save would say rather than an approximation; every failing path is listed, not just the first, and `lintSpec`'s warnings sit beneath them without blocking the Save button.
- [x] Each save creates a version, listed with its date and change note; the current version is what polling uses. `saveItem` inserts version N+1 and repoints `wanted_items.current_spec_version_id` in one transaction, which is the row `activePlans` joins on.

#### What P1-13 found

**Four settings live in two places, and only one of them was being read.** §4 puts
`notificationMode`, `pollEvery`, `gradingScaleId` and `minimumGrade` on the WantedItem *and* in
`SpecSettings`, and says of `pollEvery` that "the two are one field in the UI". Nothing had yet
written both: the scheduler reads `wanted_items.poll_every` (§6) and the review pipeline reads
`wanted_items.notification_mode` (§10), while `decideVerdict` reads `settings.minimumGrade` out of
the spec. An editor that wrote only the document would have produced an item whose spec said
`realtime` and whose column still said `digest` — agreeing with itself on screen and emailing
nobody. So the rule is now written down rather than implied: **the document is what is edited and
the columns are a projection of it, rewritten on every save.** ARCHITECTURE.md §4 says so.

**A `gradingScaleId` naming no scale was a 500 about a foreign key.** Phase 5 owns grading scales
and the table is a stub, so the only way to reach one now is to type a uuid into the JSON. It is
checked before the insert and answered as a 400 against `spec.settings.gradingScaleId`, because a
constraint violation tells the owner nothing about which field they got wrong.

#### P1-14 Wanted items UI — M

List page (status, mode, last poll, counts) and item page (current spec card, version history, per-plan stats with candidates found / reviewed / matched / uncertain and pre-filter cost, pause/resume, and the "Scan current listings" button disabled with a "Phase 5" tooltip).

Done when:

- [x] The list and item pages render from real data. Both are driven by `/api/items`, asserted in `apps/api/src/items/routes.integration.test.ts` and walked in the Playwright smoke test, which reads the spec card, the plan table and the counts off a real item.
- [x] Per-plan stats update after a poll. The poll's half was already there; the review worker's half was not, and is now — see below.
- [x] Pause and resume without writing a spec version, and "Scan current listings" disabled with a Phase 5 tooltip.

#### What P1-14 found

**Three of the five per-plan stats were never written.** `search_plan_state` has carried
`candidates_reviewed`, `candidates_matched`, `candidates_uncertain` and `prefilter_cost_usd` since
P1-07 created the table, and nothing has ever incremented them: the poll writes
`candidates_found`, and everything after it can only be known once the review pipeline has run.
The column that would have made this obvious is the one the item page exists to show, so it
surfaced the moment there was a page. The review worker now records its half — a candidate that
reached the vision review, what the rules made of it, and what the pre-filter charged.

**The pre-filter is charged for every call, not only for its discards.** The cost was previously
recorded on the verdict of a candidate the stage rejected, and nowhere at all for one it kept. Per
plan that is exactly backwards: a query whose listings are all plausible would show a pre-filter
cost of zero while paying for one call each, which is the opposite of what "is this query earning
its keep" is asking.

**"Reviewed" means §4's "reached vision review", not "has a verdict".** A candidate stopped by the
price ceiling or discarded by the pre-filter also ends with a verdict, so counting those would
bury the number that matters — how many of a query's listings were expensive enough to look at.

**Last poll is computed twice, and the two are asserted to agree.** The list aggregates
`search_plan_state` in SQL across every item; the item page derives the same three figures from
the plan rows it already holds, rather than making a second round trip for numbers it has. One
rule, two implementations, so `stats.integration.test.ts` runs both over the same data and
compares them.

#### P1-15 Candidates and verdicts UI — L

Candidate list per item, filterable by verdict and origin, with thumbnail, English title, price in GBP and original, source, location, ships-to-UK flag, and decision chip. Candidate page: photo gallery, English summary, sanitised description, verdict with per-criterion evidence, "Show prompt", Retain toggle, link to the listing. Feedback buttons present but disabled until Phase 5.

Done when:

- [x] Rejected candidates are as easy to browse as matches (this is the audit view from requirement 6). The same query, the same row, one filter value apart; `store.integration.test.ts` asserts a rejection and a match come back with the same fields, so neither can quietly grow a path the other lacks.
- [x] "Show prompt" displays the stored prompt text and the exact images sent, in the order they were sent, read from `verdicts.prompt_text` and `verdicts.prompt_images` rather than rebuilt.
- [x] The page is usable on a phone (the digest emails will link here). Driven at 390×844 in the smoke test, which fails if anything makes the document wider than the viewport.

#### What P1-15 found

**A seller's description was stored exactly as the marketplace sent it.** §12 requires it
sanitised before storage and nothing did it — eBay's `getItem` returns a full HTML document, so
what sat in the `listings` table, in every nightly dump and in the reviewer's prompt was a
stranger's markup. §7 step 1's "text cleaned" had not been implemented either, and the two are
the same omission. Descriptions are now reduced to text at ingest, at both write sites — the poll
and the enrichment — and §12 is rewritten to say what is actually done.

**Text rather than sanitised HTML, which §12 allowed either of.** DOMPurify server-side means
jsdom, ten megabytes of dependency in an image §11 budgets at 400 MB slim, to keep a seller's
table layout. Text needs no dependency and is safe because nothing is ever inserted as markup —
there is no filter to bypass. It also recovers prompt budget that was being spent on font tags.

**The rules' reasons are re-derived for the page, not stored.** `verdict.ts` argues that a column
would be a second copy free to drift from the rules that wrote it, and this is the first caller
to need them: `decideVerdict` is pure, the spec version is immutable and the results are on the
row, so re-running it reproduces exactly what it said the first time.

#### P1-16 Dashboard — M

Today's matches and uncertains, active items, source health (last poll, last success, last error per adapter), AI spend this month against the cap, worker heartbeat.

Done when:

- [x] Every figure links to the page that explains it. Today's counts open the audit view filtered to that verdict, the item counts open the list, a failing source opens the item whose plan is failing, and the spend opens the AI section of Settings. The smoke test follows three of them and asserts where each lands.
- [x] An adapter failure from the last poll is visible without opening logs: the row carries the adapter's own error text, the date it was last working, and a link to the item that owns the plan.
- [x] One request for the whole page, so the panels are consistent with each other rather than each arriving from its own instant.

#### What P1-16 found

**"Today" has to be the owner's day, not UTC's.** Europe/London is UTC+1 for seven months of the
year, so a verdict reached at 00:30 on a June morning is 23:30 the previous day in UTC — and
anything that truncated the stored timestamp would file it under yesterday, every summer morning,
with nothing to notice. `startOfDayIn` resolves the zone offset twice, because on the morning the
clocks go forward the offset at midnight is not the offset now. §10's digest needs exactly the
same function when it lands in Phase 2.

**Playwright kills the server it starts, so a heartbeat's five-minute tick never fires.** The
Processes panel was therefore saying something different on every local run and something else
again on a fresh CI database. `process_heartbeat` is instance state like the settings row, so the
e2e clears it and seeds the two cases it means to show — one process answering and one that
stopped an hour ago — rather than depending on how long the run happened to take.

**The spend is fetched by the API route rather than by the summary.** The budget cap lives in
`@goodies-beacon/ai` because it needs the price table, and core cannot depend on ai without a
cycle; the route joins the two. It is also the one panel allowed to fail on its own, because the
others answer "is anything broken", which is exactly what is being asked when something is.

#### P1-17 Prompt eval suite in CI — M

A fixture set of about twenty listings (real, anonymised, from the spikes and your own eBay tabs) with expected pre-filter and reviewer outcomes for the two example specs. Runs in CI against two providers using repository secrets, with a small budget, and reports precision and recall in the job summary. It spends real money, so it runs only when something it judges has changed — a path filter on `packages/ai/src/prompts/**`, the fixtures and the eval code — plus a `workflow_dispatch` trigger for running it by hand; an unrelated pull request does not pay for it.

Done when:

- [x] The suite passes on both configured providers. Pre-filter 19/19 on `openai:gpt-5-mini` and `google:gemini-3.5-flash-lite`; reviewer 40/40 on `openai:gpt-5-mini` and `google:gemini-3.8-flash`. Getting there took two red CI runs and three real defects, which is the section below and the argument for the task.
- [x] A deliberate prompt regression fails the suite. Removing §7 step 3's reluctance-to-reject instructions from `PREFILTER_SYSTEM` took the pre-filter from 19/19 to 18/19 on the same model, recall from 100% to 88.9%, and failed the run — on exactly the case the instruction exists for: a water-damaged but genuine Carmageddon big box, discarded for a completeness judgement that belongs to the reviewer.
- [x] The suite is skipped with a notice when provider secrets are absent, so forks still get green CI. Both scripts exit 0 with a `::notice::` and make no call, decided from the credential *before* the run — the pre-filter fails open, so a keyless run would otherwise report every listing as plausible and look exactly like a pass.
- [x] A pull request that touches neither prompts, fixtures nor the eval code does not run it. `.github/workflows/prompt-eval.yml` is path-filtered to the prompts, the two role modules, `src/eval`, `scripts`, both fixture directories and the workflow itself, plus `workflow_dispatch`.

#### What P1-17 found

It found two real defects on its first run, which is the argument for the task.

**The pre-filter could not work at all on the model it ships configured to use, and failed
silently.** `MAX_OUTPUT_TOKENS` was 200, on the reasoning that "a reason is one short sentence".
That is true of the visible answer and false of a reasoning model, where hidden reasoning tokens
are charged against the same ceiling: `openai:gpt-5-nano` — then the default for this role — spent
the whole 200 reasoning, emitted nothing, and failed the schema on **every** call. Measured, it
needs about 600 and fails at 800; the ceiling is now 2000. Because the pre-filter fails open, none
of this surfaced as an error — an instance would have kept every listing and paid mid-tier prices
to review all of them, which is §7 step 3's cost control not merely absent but inverted. It had
only ever been checked against Gemini, which does not reason and answered inside 200.

**The reviewer's ceiling was the same problem one size down.** It took `generate.ts`'s 4096
default, and `google:gemini-3.8-flash` — a thinking model — failed a case outright with the same
schema error. Measured on the case that failed, its reasoning ranges from about 1,300 tokens to
over 4,000 for the same input: three attempts gave 3,127, a failure, and 1,331. That is a reviewer
that dead-letters a candidate now and then for no reason visible from outside. The ceiling is 8,000
now, roughly twice the largest run measured, and a failed call is billed anyway while producing
nothing — so raising it cannot be the more expensive choice.

**Two criteria disagreed between providers, and both were the spec's fault rather than the
prompt's.** `disc-readable` read "The disc **looks** free of deep scratches" — a visual test, put
to a fixture set that has no photographs — so OpenAI accepted the seller's statement and Gemini
said `unknown`. Dropping the one word settles it: a statement is squarely on point for "the disc
is free of scratches", and both providers now pass. `crt-condition` bundles three tests — burned
in, cracked, badly discoloured — where the Japanese seller answers only the first; gpt-5-mini gave
`pass` twice and `unknown` twice across four runs. That case exists to test the translation, so it
no longer asserts that criterion at all: the assertion was measuring a model's temperament on an
ambiguous criterion rather than anything about the prompt. **The criterion itself is still worth
splitting in the example spec**, which is a change to what a shipped worked example teaches and so
is a task of its own.

**Two attempts to fix those in the prompt were made and reverted, which is the lesson.** Telling
the reviewer that an explicit statement is evidence fixed `disc-readable` on Gemini and broke
`contents-complete` on OpenAI; a second clarification fixed that and broke `complete-machine`.
RUNNING.md had already written the rule down — "a criterion that bundles two tests cannot be
answered cleanly, and that is worth fixing in the spec rather than arguing with the reviewer
about" — and every one of these was a bundled or mis-worded criterion. The prompt is unchanged.

**Three fixtures claimed photographs that do not exist.** The reviewer fixture set is text-only by
design, and three descriptions said things were "pictured together" or "photographed from the
front". For two cases that expected `unknown` it made no difference; for `carmageddon-clear-pass`
it was load-bearing, and a model that noticed the listing contradicting itself was right to. The
claims are gone.

**The English-summary check was a coin toss.** One run of `performa-japanese` quoted a Japanese
phrase inside an otherwise-English summary and failed; the next did not. Any CJK at all was the
wrong test: an untranslated summary is essentially all Japanese, while one that is English apart
from the seller's own word for the condition is doing its job, arguably better than one that
paraphrases the quote away. `summaryIsEnglish` now allows up to a tenth of the characters, which
separates the two cleanly and is unit-tested for nothing — and it names the offending characters
rather than reporting `expected: English, got: "Seller is offering an Apple..."`.

**`scripts/` was typechecked by nothing.** Each package's tsconfig includes only `src`, so the API
doc generator and this evaluation — a gate that spends money — were outside `tsc -b` entirely.
They are in `pnpm typecheck` now, which immediately found a latent type error in the generator.

**A ceiling set from one measurement is a ceiling set too low, twice over.** The pre-filter's was
raised from 200 to 2,000 on a single observation of 614 tokens, and CI then lost a case to it
anyway. Measured properly — thirty-eight calls — the spread is 361 to 1,249, so it is 4,000 now.
More usefully, the retry no longer repeats the failed call unchanged: `NoObjectGeneratedError` has
two causes wanting opposite treatment, and for the common one — a reasoning model that spent its
whole allowance thinking — an identical retry is billed and doomed. The second attempt now gets
double the room, so the next model whose appetite nobody has measured heals itself instead of
needing this section written again.

#### What the gate is telling us

CI ran it and both providers went red — on *different* cases from the ones that failed locally.
That is the important result, and it is worth separating into three things, because only one of
them is a fault in the evaluation itself.

**Nothing pinned the sampling temperature, anywhere, and pinning it did not fix the flakiness.**
`generateObject` was called without one, so every pre-filter and every review ran at the
provider's default of 1 — full sampling variance on what are classification tasks. Both classifier
roles now ask for 0, which is right on its own terms: §4 makes the newest verdict authoritative
and Phase 5 re-reviews on demand, so a re-review at full temperature is partly a dice roll rather
than a second look.

**It buys less than it looks like it should, and the measurement says so.** OpenAI's reasoning
models refuse the setting outright — the SDK warns "temperature is not supported for reasoning
models" and drops it — and `google:gemini-3.5-flash-lite` at 0 still gave two *different* answers
across two consecutive runs of the same nineteen fixtures. Both default models think before they
answer, and thinking is sampled whatever the temperature says. So this is a correctness fix for
re-reviews, not a cure for a flaky gate, and it is written down that way so nobody re-derives the
hope later.

**Two fixtures assert an answer to a question with two defensible answers.** `carmageddon-in-bundle`
is a joblot naming the wanted game among five others; its own note already said "deliberately near
the line". `performa-japanese / complete-machine` turns on whether 本体のみ — "unit only", no
keyboard or mouse — makes a working all-in-one incomplete. Both now carry a `borderline` marking:
graded, counted in precision and recall, reported in the summary, and **not fatal**. It earns its
keep immediately: of the two Gemini pre-filter runs made after the change, one disagreed on the
joblot and exited 0, where before it would have been a third red build. A gate that
fails at random on a workflow that spends money is a gate that gets switched off. The marking is a
to-do list rather than a shrug: each one names the criterion that wants splitting.

**The default pre-filter model made the one mistake that must never happen, in a third of runs.**
`openai:gpt-5-nano` discarded `carmageddon-damaged` — a water-damaged but genuine big box —
reasoning that "the manual is missing, so it's not the complete big-box set". That is a
completeness judgement, which §7 step 3 tells this stage in as many words not to make, and a wrong
discard is the outcome §1 exists to prevent: never reviewed, never emailed, never noticed.

**How much evidence it took is the point.** The first sighting was a single red run, and a single
red run was not enough to change a shipped default on — three more runs were made and all three
were clean, so nothing was changed. Two further reds later, the run was done properly: twelve runs
of `gpt-5-nano` against eight of `gemini-3.5-flash-lite`, on the same nineteen fixtures.

| model | runs | failed | what failed |
|---|---|---|---|
| `openai:gpt-5-nano` | 12 | 4 | `carmageddon-damaged`, every time |
| `google:gemini-3.5-flash-lite` | 8 | 0 | — |
| `openai:gpt-5-mini` | 2 | 0 | — |

It is always the same listing, and the two models cost the same per call. So
`DEFAULT_AI_ROLES.prefilter` is now `google:gemini-3.5-flash-lite`, and the evaluation's OpenAI arm
runs `gpt-5-mini` — testing `gpt-5-nano` would measure a model nobody should use for this role
rather than measuring the prompt. The default now names three providers, which is a real cost and
is written down beside the setting; every role is independently configurable, and a default that
loses a third of the listings a collector might have wanted is not a default worth keeping for
tidiness.

It is **not** marked borderline and must not be: a gate that stayed green through a wrong discard
would be worthless. The instruction the model ignored is already in the prompt in as many words,
so sharpening it further would have been the same mistake as the two reverted prompt edits above.
Judge a replacement model on this suite before switching to it — that is what it is for.

#### P1-18 Typed spec form — L

**Pulled forward into Phase 1 on 22 September 2026, and required before the Phase 1 exit.** It
was raised during Phase 1 as P2-01 and first scheduled for Phase 2 (below, and ARCHITECTURE.md §17
v1.35); the branch it was built on, `feat/P2-01-typed-spec-form`, still carries the old id. The
Phase 1 exit test enters the Carmageddon spec by hand, and that should not mean writing JSON.

§8's "nothing is a black box" has two halves and Phase 1 built only the reading one: P1-14's spec
card renders every field of a spec in plain English, while P1-13's editor is the raw JSON textarea
§17 asked for. Give the settings the toggles, dropdowns and number fields they are; the criteria
and search plans their tables, with rows added, edited and removed; and the reference images a
panel that shows them. Saving still writes version N+1 through the same `saveItem` path, and the
same `wantedSpecSchema` still validates — this is a second surface onto the document, not a second
model of it. The JSON editor stays, behind a toggle: it is the escape hatch for a paste, a
wholesale rewrite, or a field a form has not caught up with, and P1-13's live validation and
linter warnings are what it already needs to be.

Build the form and the spec card as one component with a `readOnly` mode rather than two that
drift, because Phase 3's chat shows the same card beside the conversation and would otherwise make
a third.

**The reference-image panel is the part with known defects**, found while looking at a real item on
18 September 2026. Today the panel uploads a file, stores it immediately, appends a
`{ id, path, label, addedAt }` entry to the bottom of the JSON, and shows the owner nothing: no
thumbnail, no filename, only an alert that is easily off-screen, with the entry itself below the
fold of a twenty-eight-row textarea. It reads as though the upload was swallowed. Worse, the entry
lives only in the browser's text state until the spec is saved, so leaving the page orphans the
stored file with nothing pointing at it, and §13's retention job — Phase 2 — does not sweep
unreferenced media. Removing an image is hand-editing JSON. And `withReferenceImage`
re-serialises the whole document to append, silently reformatting whatever the owner typed.

Depends on P1-13, P1-14.

Done when:

- [x] Every field in `SpecSettings` is set from the form — sources, listing types, price ceiling, shipping, condition, grading, negative keywords, notification mode, poll interval, relists, unknown handling and backfill — with no JSON typed, and the document it produces parses to the same spec the JSON surface would. *Byte-identical* is what this box asked for and is the wrong test: both surfaces write `JSON.stringify(document, null, 2)`, so the bytes match each other but not necessarily what someone hand-formatted, and normalising their formatting on an edit is the existing behaviour of `withReferenceImage`, not a regression.
- [x] Criteria and search plans are rows: added, edited and removed, with `kind`, `quantifiable` and `onUnknown` as controls rather than free text, and a criterion keeping its id across an edit so feedback history stays attached (§4). Ids are generated once on add and nothing in the form rewrites them. They are random rather than counted: a counter only avoids the ids on screen, so a criterion deleted in one version and a new one added in the next would share an id and the newcomer would inherit the old one's feedback. A plan's is a whole uuid, for the reason in the section below. Changing a plan's *source* is the one edit that gives it a new id, because its watermark and stats describe the old marketplace.
- [x] An uploaded reference image appears as a labelled thumbnail in the editor the moment it is stored, and can be removed there.
- [x] Leaving the editor with an uploaded image that has not been saved warns before it is lost. `useBlocker` covers in-app navigation with a dialog naming the count, and `enableBeforeUnload` covers a reload or a closed tab; the panel says "not saved yet" under each thumbnail meanwhile.
- [x] An image uploaded and then abandoned is not lost without warning; sweeping one abandoned anyway belongs to Phase 2's retention job. **Amended when the task was pulled into Phase 1**, because as first written this box could not be ticked before the exit: §13's orphaned-media sweep is part of the retention job, which is Phase 2 work and does not exist yet. The requirement is not dropped — it is carried to that job in *What comes next* below. Until then the warning above is what stops the file being stranded, the dialog says plainly that *Leave anyway* leaves it on the server, and an owner who clicks it strands one.
- [x] The JSON editor is still reachable in one click, still validates as you type, and still shows the linter's warnings; a spec typed in one surface and then opened in the other is the same spec. The Playwright run edits three settings in the form, reads them back out of the JSON, and puts the document back.
- [x] Whether the spec card and the form become one component is decided in Phase 3, when the chat needs a card beside the conversation. **Amended when the task was pulled into Phase 1**; as first written the box asked for one component with a `readOnly` mode, and that was reconsidered while building it and deliberately not done. ARCHITECTURE.md §17's Phase 3 entry now carries the decision. The two say different things about the same values — the card carries the lint warnings, the "sent with every review" count and the reference thumbnails as evidence, while the form carries controls, hints about what each field costs, and row add/remove — so one component would be every control wrapped in a `readOnly` branch to serve two pages that do not want the same page. The drift this box was guarding against is real but was overstated as a refactor; **Phase 3 should decide it properly** when the chat needs a spec card beside the conversation, because that is the third renderer the box was worried about and the first time the shape of the answer is actually known.

#### What P1-18 found

**Adding a criterion made the spec invalid, and the form vanished.** A new row starts with empty
text, which `criterionSchema` rightly refuses, so the strict parse failed and the editor fell back
to raw JSON mid-edit — fields unmounted, caret lost. Clearing a field to retype it did the same, and
so, found in review, did *typing* into four settings: `P` and `PT` are the first two keystrokes of
`PT8H` and neither is a duration, a grading scale id is not a uuid until it is finished, `0` is not
a price, and unticking both listing types left no way to tick one back. The form now draws from a
draft parse (`draftSpecSchema`) that relaxes every one of those rules to its bare type, while the
Save button stays on `wantedSpecSchema` and its objections are shown beside the field each one
names. The relaxation is one `.extend` beside the strict schema rather than a weakening of it,
because everything else — the API, the interviewer's `propose_spec`, the reviewer — depends on the
strict rule. `parse.test.ts` walks each of those values; the Playwright run types `PT8H` one key at
a time.

**A price with pence could not be saved from the form.** The price input was `type="number"
min={1}` with the default step of 1 and the page's `<form>` validates natively, so `149.99` was
refused by the browser with its own tooltip before any of this code ran. It takes any step now,
and the schema's "more than zero" is what judges it.

**`search_plan_state` is keyed on the plan id alone, across every item, and nothing checks that a
plan id is unique across items.** The form's first draft numbered new plans `plan-1`, `plan-2`, so
every item created through it would have shared watermarks and stats with every other; it uses a
uuid now. The JSON surface still accepts any id, and entering the Carmageddon example twice gives
two items the same `ebay-gb-carmageddon`. That predates this task and is not fixed here: the right
place is `saveItem`, refusing a plan id another item owns with a 400 against the path, as P1-13 did
for a `gradingScaleId` naming no scale.

#### P1-19 Wish list — M

Somewhere to note a thing you would like without writing a spec for it. A wanted item is a
commitment — a spec, search plans, polls three times a day and a model's attention on every
listing — and much of what a collector would pick up if it turned up is not worth that yet. A wish
is a label and a category (Game, DVD, VHS, Toy, Figurine, Book, or Other), with an optional search link of the
owner's own: a saved eBay search, a shop page. Nothing polls, reviews or emails about a wish; the
list's *Search* button opens the link in a new tab, and that is the whole of its searching.
**Promote** turns a wish into a draft wanted item when it is worth having Goodies Beacon look.

The page is one list, filterable by category, with each wish edited in its own row rather than
on a page of its own, and every row's Search button visible without opening anything. The
categories have icons, drawn inline — seven shapes do not earn an icon package.

Decided with the owner before it was built: promotion *moves* the wish (the draft item is created
and the wish deleted in one transaction, so a thing is a wish or wanted and never both); the
categories are the four named plus *Other*, so nothing is refused a place (Book and then Figurine were
added at the owner's request while the task was still open, each as its own migration so a
database that had already applied the earlier ones is widened rather than left behind); and the link is a fixed
URL rather than a template with the label substituted in.

Depends on P1-14.

Done when:

- [x] A wish is added with a label, a category and optionally a search link — in a modal opened from the page header — and edited or removed where it is listed, without a page of its own. `wish_items` is a plain table with no history — a wish has no spec to version — and `/api/wishes` is its list, create, update and delete.
- [x] The list filters by category, each shown with its icon and a count, and the filter is a link, so it survives a reload and can be bookmarked (the candidate list's pattern, P1-15). A sort toggle beside it orders the list A–Z (the default: case-insensitive, with numbers compared as numbers) or newest first, and is a link in the same way, each keeping the other's choice.
- [x] A wish with a search link shows a Search button in its row that opens the link in a new tab; one without shows none. Only `http` and `https` links are accepted, by the same `wishSaveSchema` in the browser and the API, because the link is rendered as an `href` the owner clicks and `javascript:` there would run in the app's own origin.
- [x] Promote turns a wish into a draft wanted item titled with its label and opens it in the spec editor, and the wish leaves the list. Asked twice at once, exactly one wanted item results: the wish is deleted with `RETURNING` inside the transaction that writes the item, so the second caller finds nothing to promote.
- [x] A wish touches no marketplace and no model: nothing in the poll or review pipeline reads `wish_items`, and the table has no foreign key into or out of the domain tables.

#### What P1-19 found

**A spec has nowhere to put a wish's category or search link**, and promotion should not simply
drop them. They are written into version 1's change note — *"Promoted from the wish list (VHS);
searched by hand at …"* — which is the one free-text field whose job is saying where a version
came from, and they stay in the item's history for good. (P1-20 then gave the category a home
on the wanted item itself, so the note now carries only the link.)

**`createItem` could not share a transaction.** It opened its own, so promotion could not write
the item and delete the wish atomically. The insert is now `insertItem`, taking a transaction the
caller holds; `createItem` is that plus the grading-scale check, unchanged for every other caller.

**The Playwright run failed now and then, and it was P1-16's heartbeat seed, not this task.**
P1-16 reasoned that Playwright kills its server before the heartbeat's five-minute tick fires. The
tick is a cron on the clock (`*/5 * * * *`), though, not five minutes after start, so any run that
crossed :00, :05, :10… had a real `api` row written just before the dashboard step inserted its
own, and the insert failed on the primary key. It failed twice while this task was being built,
once at 20:05:45. The seed now upserts, and calling it twice in a row is proven to leave the
intended state.

**A form in a modal must be mounted when it opens, not reset when it opens.** The add form first
lived in the modal permanently and was cleared by an effect on opening. That clear lands a render
after the modal appears, and a keystroke in the gap — Playwright's, every time — set the form from
the previous wish's values, so the second wish added in a row inherited the first one's search link.
The form now exists only while the modal is open, so each opening starts from fresh state with no
gap. `components/modal.tsx` is the app's first modal, and the next one should do the same.

**The wanted item routes answer a malformed id with a 500.** `/api/items/not-a-uuid` reaches
Postgres, which refuses it as a type error. The wish routes check for a uuid first and answer 404;
the item routes are left as they were, since changing them is outside this task.

#### P1-20 Categories for wanted items — S

The wish list's categories and icons, on the wanted items too, so the two lists sort a collection
the same way. A wanted item gets the same seven categories — Game, DVD, VHS, Toy, Figurine, Book,
Other — chosen in the editor beside its title and status; the list shows each item's category tile
and filters by category with the wish list's chips; and promoting a wish carries its category
across rather than writing it into the change note.

The category is on the item, not in the spec. It is a fact about the owner's collection, like the
title, and nothing searches, pre-filters or judges by it, so putting it in `SpecSettings` would
hand the reviewer a field with nothing to do and make every recategorisation look like a change to
what is being looked for. It is still saved through the editor like the title is, so changing it
writes a version as any save does.

Depends on P1-19.

Done when:

- [x] A wanted item has a category, set from the editor and returned by the list and item routes. `wanted_items.category` is `NOT NULL DEFAULT 'other'` with a check constraint from the same `ITEM_CATEGORIES` tuple the wish list uses, so existing items become Other and a client that sends none still saves.
- [x] The list shows each item's category tile and filters by category, with the filter in the URL so it survives a reload. The chips are one shared component with the wish list's, which supplies its own links.
- [x] Promoting a wish gives the new item the wish's category; the change note now carries only the search link.

#### P1-21 Tags for wishes — S

A wish's category says what kind of thing it is; tags say whatever else the owner wants to find it
by — *big box*, *90s*, *Spielberg*, *birthday*. They are free text, typed into the add and edit
form as one comma-separated field, and shown as pills after the wish's label in the order they were
typed. A *Filter by tag* box on the wish list narrows it to the wishes with a tag containing what is
typed, ignoring case, alongside the category chips and the sort rather than instead of them; a pill
is a shortcut that fills the box with its tag.

Tags are the wish's own column rather than a table of their own, because nothing yet needs a tag to
be a thing with an id — no rename across wishes, no list of every tag in use — and a `text[]` is the
boring answer until something does. The schema and the matching live in `packages/core`'s domain
rather than beside the wish list, because wanted items may take tags later; that is not part of this
task. Until then a wanted item has nowhere to keep them, so promotion writes a wish's tags into
version 1's change note beside its search link, as P1-19 did for the link.

Editing a wish moves into the modal adding one already uses, at the owner's request while the task
was open. P1-19 edited a wish by expanding its row into the form, which made adding and editing two
different surfaces for the same four fields; now both are one form in one modal, opened empty from
the header or filled in from a row's Edit button.

Depends on P1-19.

Done when:

- [x] A wish has tags, set in the add and edit form and returned by the list, create and update routes. `wish_items.tags` is `text[] NOT NULL DEFAULT '{}'`, so existing wishes have none and a client that sends none still saves. `tagsSchema`, shared by the browser and the API, trims each tag, drops empties and any repeat that differs only in case (the first spelling wins), and refuses a tag over forty characters, more than twenty tags, and a tag containing a comma — the form edits them as one comma-separated field, so a tag holding one would come back as two.
- [x] Each wish's tags are shown as pills beside its label, in the order entered.
- [x] A text box filters the list to wishes with a tag containing the text, ignoring case, and combines with the category filter and the sort. The filter is in the URL (`?tag=`) like the other two, so it survives a reload, and the category chips' counts are of the wishes the box lets through. Clicking a pill filters by that tag.
- [x] Promoting a tagged wish writes its tags into version 1's change note: *"Promoted from the wish list; tagged big box, 90s; searched by hand at …"*.
- [x] Edit opens the add modal filled in with the wish, titled *Edit* and its label, and saves in place; Cancel, Esc or the backdrop leave the wish as it was. The row no longer expands into a form.

#### P1-22 Custom categories — M

The seven categories P1-19 built in and P1-20 shared with the wanted items were the developer's
guess at a collection; the owner's is different, and a fixed list with *Other* at the end is where
that shows. Categories become the owner's own: made in Settings with a name, an icon and a colour,
renamed and recoloured at any time, and deleted when no longer wanted. Nothing in the code names a
category any more.

Decided with the owner before it was built: a category looks as it does today — a line-drawn icon
on a tinted tile — chosen from a fixed set of seventeen shapes and twelve hues rather than an emoji
or a letter, because each is drawn in code and the lists should keep one look; and deleting a
category that is in use leaves those wishes and items uncategorised rather than refusing, with the
confirmation saying how many.

A category is a row in `categories`, and `wish_items` and `wanted_items` point at it with a
nullable `category_id` whose foreign key sets null on delete. There is no *Other*: that only ever
meant "none of these", which a null says without a row. The icon and colour stay typed — tuples with
check constraints, as every bounded set in the schema is — and are keyed by what is drawn
(`cassette`, `disc`) rather than what it was for, so a disc can be a CD.

Depends on P1-20.

Done when:

- [x] Settings has a Categories section that adds, edits and deletes categories — name, icon and colour, with a live preview tile — listed A–Z, each saying how many wishes and wanted items use it. `/api/categories` is its list, create, update and delete; a name is unique ignoring case (a unique index on `lower(name)`, with a 409 naming the clash rather than a 500 about the index), and an icon or colour outside the set is a 400.
- [x] The wish list and the wanted items choose from those categories, or none, in their forms, and show and filter by them as before; the filter gains an *Uncategorised* chip when anything is, and links to Settings when no categories exist yet. A category id that names no category is a 400 against `categoryId`, not a foreign-key 500. Promoting a wish keeps its category.
- [x] Deleting a category in use asks first, naming what it would uncategorise, and leaves those wishes and items in place without one.
- [x] Nothing is recreated by hand. The migration makes a category for each of the seven built-ins in use, named, drawn and coloured as it was, and points its wishes and items at it; nothing becomes *Other*, which is uncategorised instead. It is two migrations — add the table and the new columns and convert, then drop the old columns — so drizzle-kit never has to guess whether a column was renamed. `categories-migration.integration.test.ts` builds a database at P1-21 with rows in every case, runs the rest, and checks each row landed where it should.

The app's favicon — the beacon light, at 32 and 192 pixels and as a 180-pixel home-screen icon on
a white ground, because iOS draws transparency as black — rides along on this branch at the owner's
request; it is in `apps/web/public`, which Vite copies to the root of the build.

#### What P1-22 found

**Drizzle writes a column inside a `sql` fragment without its table.** The usage counts are
subqueries, and `${wishItems.categoryId} = ${categories.id}` rendered as `"category_id" = "id"`,
where the bare `"id"` resolved to the wish's own — so every count was zero, and the test that
seeded a wish before counting is what caught it. The columns are qualified by hand there now; any
correlated subquery written the same way elsewhere has the same trap.

**Grading scales have a `category` too, and it is not this.** §4's GradingScale carries a free-text
`category` ("Big box PC game") describing what a scale grades. Nothing uses it yet; Phase 5, which
builds grading scales, should decide whether it becomes a reference to these categories or stays
text, rather than inheriting the name by accident.

#### P1-23 Settings pages and navigation icons — S

Settings has grown to six sections on one page — account, email, sources, AI, instance and
categories — and the one an owner visits most, categories, is at the bottom of it. Each becomes a
page of its own at `/settings/<name>`, and the sidebar lists them as children of Settings, which is
a group heading rather than a link. The main navigation items get icons; the settings children do
not, and are indented to line up with the text beside them.

Decided with the owner before it was built: the group is always expanded rather than a toggle, so
nothing is hidden behind a click; the pages run Categories, Sources, Models, Email, Instance, Account —
most used first, the account last as most apps place it, with the AI section renamed Models since
choosing them is what it is for; `/settings` itself redirects to the first
of them, so a bookmark or a link written before this still lands somewhere; and the icons are drawn
inline in the style the category and button icons already use, rather than from a package.

The links into Settings go to the page they mean: the dashboard's spend to AI, and the category
filter's "Add categories in Settings" to Categories.

Depends on P1-22.

Done when:

- [x] Each of the six sections is its own page at `/settings/categories`, `/settings/sources`, `/settings/models`, `/settings/email`, `/settings/instance` and `/settings/account`, headed with its own name, and survives a refresh. Each page is still a region named after its section, so the Playwright run's `section('Email')` locators kept working unchanged; it now reaches each page by its own link or URL, and refreshes `/settings/instance`.
- [x] The sidebar lists them in that order under a Settings heading that is not a link, always visible, with the current page marked. The children are a list labelled by the heading, and the Playwright run asserts their order, that no link is named Settings, and `aria-current` on the page it is on.
- [x] `/settings` redirects to `/settings/categories`, replacing the history entry so Back does not bounce through it.
- [x] Every main navigation item — the disabled ones included — has an icon, and the settings children have none. The children are set lighter than the items above them. The sidebar is a rem wider, because an icon beside *Grading scales* and its Phase 5 badge wrapped the label onto two lines.
- [x] The dashboard's AI spend opens `/settings/models`, and the category filter's link opens `/settings/categories`. Both are followed in the Playwright run.

Two changes to the candidate list ride along on this branch at the owner's request. It opens on
the matches, and the *Everything* verdict is gone: each other verdict, rejections included, is one
chip away, which is what requirement 6 asks of it. The item page's total *Candidates* figure linked
to that view, so it is now a figure and not a link; the four beside it add up to it and each still
links. And the *Verdict* and *Origin* labels are set apart from the choices beside them — small
capitals in a column of their own, with the choices in a bordered group — where before a label
read as one more option. With the label plainly a label, the origins drop their "From a" and read
Any, Poll, Backfill and Scan, which also keeps them on one line on a phone. Origin sits above Verdict.

#### P1-24 Item page sections and their editors — M

The item page shows the spec in one card and edits it on another page entirely, so changing one
criterion means opening the full editor, finding the row among the settings and plans, and saving
the lot. The page becomes a column of sections — *Details* (the summary and how sellers list it),
*Settings*, *Criteria*, *Reference Images* and *Search Plans*
— each folding away under its heading, and each part of the spec with a pencil beside its heading
that opens an editor for that section alone, in a modal. The version history leaves the page for a modal behind a clock button beside *JSON*.
Only *Details* starts open, since it
says what the item is; the rest is detail a click away.

Decided with the owner while it was built: the item page no longer links to the full editor. The
title, category and status are edited in the Details modal beside the summary, and a *JSON* button
in the header opens the whole document in a modal — the escape hatch for a paste or a wholesale
rewrite, and the only way to repair a spec the schema no longer reads, which the typed sections
cannot draw. The editor page is kept, unlinked from here, for creating an item (a new item and a
promoted wish both land on it) until that flow is reworked. The description, criteria and
reference images leave the spec card for sections of their own, which leaves it holding the
settings and named for them; and the counts above the
sections gain the verdict colours the candidate list already uses, with the total moved last and
called *Total*.

A section editor is the typed form cut down to one part (`SpecForm`'s `parts`), over its own copy of
the document. Saving sends the whole spec through `saveItem` like any save, so it is version N+1
and nothing about versioning changes; left empty, the change note names the section rather than
repeating the previous version's note, which is what the document otherwise carries forward.

Depends on P1-18, P1-23.

Done when:

- [x] A *JSON* button, bordered in the style of the count tiles, sits beside the title where *Edit the spec* was, and opens the whole spec as JSON in a modal, validated as it is typed with the schema's problems and the linter's warnings listed; a document that does not parse cannot be saved. When the stored spec no longer matches the schema, the page points to it rather than to the editor.
- [x] The counts read Matched, Uncertain, Rejected, Waiting, Total. Matched is green, Uncertain amber and Rejected stone — the candidate list's chip colours — Waiting is the app's blue, and Total is plain. Total is a figure, not a link, as *Candidates* was. The dashboard's *Today* tiles take the same colours, from the one `DECISION_TILES` map beside the chip colours in `candidates/bits.tsx`.
- [x] Details, Settings, Criteria, Reference Images and Search Plans are sections of their own, headed in title case,, each folding under a heading button that says whether it is open. Details starts open and the rest start folded; once the owner opens or folds one, that is remembered per section in the browser (`localStorage`, so it survives a reload and never reaches the server), and the page works when storage refuses.
- [x] The five spec sections have a pencil beside the heading opening a modal that edits that section alone — the title, category and status with the summary and how sellers list it, the settings, the criteria, the reference images (upload, label, remove), the search plans — and saving writes one new version. A spec the schema no longer reads offers no section editors, only the full one.
- [x] The version history is a modal opened by a clock button beside *JSON*, rather than a section, listing every version newest first with its date and change note.
- [x] Esc, the backdrop, Cancel or Back with an unsaved edit in a modal asks before discarding it, and says when an uploaded image would be left on the server with nothing pointing at it; a reload warns through the browser.
- [x] The Playwright run finds only Details open on arrival, folds a section and finds it folded after a reload, edits the criteria through their pencil — checking the modal holds only the criteria, that Esc asks first, and that the save is version 3 with the note *Edited the criteria.* — and finds the description, settings, criteria and reference image each in its own section. It opens the JSON, breaks it, finds Save refused and discards it without a version being written, and renames the item from Details. Every version count it checks on the item page is read from the history modal.

#### P1-25 Wanted item cards and display images — M

The wanted items list is a divided column of rows with a category tile at the left, which is the
wish list's shape — and the two pages sat side by side in the sidebar looking like one page twice.
A wanted item is the bigger commitment and the thing a collector is actually hunting, so its list
becomes a grid of cards, each headed by a picture of the thing: its **display image**, or, without
one, its category's icon grown to fill the space on its tint. Below the picture are the title, the
status, the category and mode, the matched and uncertain counts in the verdict colours P1-24 gave
the item page, and the last poll.

A display image is chosen in the item page's Reference Images section: one of the reference images,
or an upload used for nothing else. **No model ever sees it**, and that is structural rather than a
filter: it is a column on the wanted item, not an entry in the spec, and the pipeline reads only the
spec. A reference image that is also the display image is still sent with every review, because it
is a reference image — the picker says so.

Decided with the owner before it was built: the display image lives on the item rather than as a
flagged entry in `referenceImages`, which would have needed the prompt builder, the pipeline and the
"images per review" count each to remember to skip it; the list is a grid with the picture on top
(three columns on a desk, one on a phone) rather than rows with a larger thumbnail; and changing it
writes no version. That last one raised a question — **why does renaming an item write a version?**
— and the answer was that nothing meant it to. `saveItem` always inserts a version, and the title,
category and status rode along on it because the Details editor saved through it; a spec version
does not even store the title, so a rename wrote a copy of the previous version with a new note.
They are now changed through the same `PATCH` as pause and resume, and a version is written only
when the spec changes. ARCHITECTURE.md §4 says so (v1.42).

Depends on P1-24.

Done when:

- [x] `wanted_items.display_image_id` references `media` with `on delete set null`, and the list and item routes return it. `PATCH /api/items/:id` sets or clears it, and answers an id naming no stored image with a 400 `unknown_image` rather than a foreign-key 500, and a malformed one with a 400 before it reaches Postgres.
- [x] The wanted items list is a grid of cards — one column on a phone, two from 30rem, three from `sm` — each headed by its display image or, without one, its category's icon on its tint (a plain grey panel when uncategorised). Every picture sits in the same 4:3 frame, whole and uncropped, over a blurred and enlarged copy of itself that fills the frame, so a portrait box and a landscape photo give cards of one height with nothing cut off. The title is the link and stretches over the card, so the whole card is a target while the link's name stays the title; it is clamped to two lines and always takes two, so the status row lines up across a row of cards whatever the titles' lengths. The category is a frosted badge over the top-left corner of the picture, sized to its name so it covers little of it; the status and the notification mode are pills, as on the item page, and one `Pill` component draws both. The last poll reads *Last polled*, *Failing since* or *Never polled* with the date behind a clock beside it, shown on hover or focus and toggled by a tap — iOS Safari does not focus a button it is tapped on — and the item page's header uses the same `LastPoll`. The category filter and the empty states are as they were.
- [x] The Reference Images section on the item page shows the display image with Choose or Change and Remove; Change opens a picker offering the item's reference images and an upload for the card only, and a choice saves at once without a version.
- [x] The display image never reaches the reviewer: `review.integration.test.ts` gives an item a reference image and a different display image, both real files, and asserts the reviewer port is sent exactly the reference.
- [x] Renaming, recategorising or changing the status of an item writes no version. `PATCH /api/items/:id` takes any of title, status, category and display image, leaves the fields it is not given alone, and refuses an empty patch or one carrying a spec. The Details editor sends a change that leaves the spec alone as a `PATCH` — its button reads *Save* and it asks for no change note — and one that touches the summary as a save, which is version N+1 with the rename in it.
- [x] The Playwright run finds the card headed by its category before an image is chosen, renames the item from Details and finds three versions still, chooses the reference image as the display image and then uploads another for the card only, checking the history each time, and finds the card in the list headed by it and still one reference image sent with every review.

Three changes to the rest of the app ride along on this branch at the owner's request. The
sidebar is sticky on a desktop, so it stays put while a long page scrolls, and scrolls itself only
in a window too short for it; before, it had the height of the window but moved with the page, and
its border ended a screen down. Candidates moves above Wish list. And the buttons that add a wanted
item and a wish both read *Create*, with the heading beside each saying what is created and the
accessible name saying it too (*Create a wanted item*, *Create a wish*); the dashboard's empty-state
button keeps *New Wanted Item*, where there is no heading to say it.

A fourth, also asked for while the task was open: the candidate list gains a **From** filter,
*Today* or *All*, and opens on today, and the verdict for a candidate still in the pipeline is
called *Queued* rather than *Not yet judged*. Today is dated exactly as P1-16's dashboard dates it —
by the newest verdict, or by when a still-queued candidate was found, in the instance's time zone —
because the dashboard's *Today* tiles link here, and a tile saying three that opened a list of five
would be worse than no filter. The API's default stays `all`, so a link written before the filter
means what it meant; the page asks for `today` unless the URL says `from=all`. An item page's counts
are all-time, so its links, and the candidate page's link back to its item's list, carry
`from=all`. `listCandidates` refuses `today` without the day's start rather than quietly listing
everything, because the time zone is a setting and core does not read settings. Tested in the store
(a candidate found yesterday and judged today is today's; one queued since yesterday is not), in the
route, and in the Playwright run. The three filters then sit on one line in the order From,
Verdict, Origin — each label beside its choices rather than in a column of its own, which P1-23 set
up for groups stacked one above another — and wrap onto further lines on a phone. On the wish list, the *Filter by tag* box moves below the
sort and the category chips rather than above them. And the Settings pages in the sidebar hang
off a thin guide line drawn down from under the Settings icon, in smaller and dimmer text, with the
current page lighting its stretch of the line rather than taking the filled row the main items use
— they had read as more main items. Their text still lines up with *Settings*, as P1-23 asked.

#### What P1-25 found

**The item routes' own comment said there was no `PATCH`**, while P1-14 had added one for pause and
resume beside it. It now says what `PATCH` is for.

**The full editor page still writes a version on a rename.** It is kept for creating an item and is
no longer linked from the item page (P1-24), but `/items/:id/edit` still loads and saves an existing
item through `saveItem`. It is left alone here; reworking item creation is where it goes.

**An `aspect-ratio` box is a minimum, not a size.** The first cards had the frame at 4:3 and the
picture filling it, and a tall photograph still made its card taller than its neighbours: a box
whose height comes from `aspect-ratio` grows to fit its content unless its overflow is hidden. The
frame hides its overflow and the pictures are positioned inside it, which is what holds the ratio.

**Media rows are deduplicated by their bytes, so a media kind is only a record of the first upload.**
An image uploaded for the card only is stored as `reference`, like any upload through
`POST /api/media`: a `display` kind would need a migration of its check constraint to say something
the dedupe cannot keep true, since the same bytes uploaded later as a reference would come back as
the display row. What an image is *for* is where it is referenced from, which is also what §13's
sweep asks — and the sweep now counts a display image as a reference, carried below.

#### P1-26 Creating an item from a dialog — M

Since P1-24 an item has been edited section by section on its own page, but it was still *created*
on the full editor page — every setting, criterion and plan on one long form, with the JSON behind a
tab — which P1-24 kept only for that. Creating becomes the Details editor in a dialog: *Create* on
the list opens it, titled *Create a Wanted Item*, with the title, category, summary and how sellers
list it, and the status shown but locked to a draft. *Create* writes version 1 and opens the new
item's page, and the rest of the spec is filled in there through the section editors the page
already has.

A new draft cannot poll usefully until two sections are filled in, and the page says so: a red mark
beside **Criteria** until there is one, and beside **Search Plans** until one is enabled on a
marketplace the settings switch on. *Start Polling* is disabled meanwhile, with the missing parts
listed beneath it, and the store refuses to make an item active while any remain — so the JSON
editor, a Details save or a hand-made request cannot start it either. Nothing else is asked for:
Details is complete from the moment the dialog creates the item, the settings all have defaults,
and reference images are optional.

Decided with the owner before it was built: the dialog is the Details editor rather than a smaller
form of its own, and it requires the summary, which is why Details never carries a mark; the
criteria are required alongside the search plans, since with no criterion the rules have nothing to
fail and every listing the pre-filter keeps would be emailed as a match; activation is refused by
the server as well as the page; and the old editor page is removed here rather than later, since
nothing links to it once *Create* is a dialog and promoting a wish opens the item's page.

Depends on P1-25.

Done when:

- [x] *Create* on the wanted items list opens *Create a Wanted Item*: the Details fields, the status shown as *Draft* and disabled, and *Create* disabled until there is a title and a summary. The dialog is in the URL (`/items?create=true`), so the dashboard's empty-state button opens it too. Esc, the backdrop or Cancel with something typed asks before discarding it.
- [x] *Create* writes version 1, noted *Created.*, and replaces the dialog's URL with the new item's page, so Back does not reopen the dialog.
- [x] `readinessGaps` in `packages/core` says what a spec lacks — no criterion; no enabled search plan; enabled plans only on marketplaces switched off — in words the page and the server share. Unit-tested against both worked examples and each gap.
- [x] The item page marks each gap with a red *!* beside its section heading, and *Start Polling* is disabled with the gaps listed beneath it. The Details editor offers *Active* only when there are none.
- [x] The store refuses a create, save or patch that would make a not-yet-active item active while a gap remains, and the API answers it with a 400 `not_ready` naming what is missing. An item already active is not stopped by an edit. Tested in the store and through the route.
- [x] `/items/new` and `/items/:id/edit` are gone, with the component and the pieces only it used; promoting a wish opens the new item's page.
- [x] The Playwright run creates both worked examples through the dialog, finds the two marks and *Start Polling* disabled on the new draft, puts the spec in through the JSON editor — which still refuses a broken spec by path and allows the lint warning — finds the marks gone, and starts it polling. It uploads the reference image through its section editor, where Esc asks and says the file would be left on the server.

The item page's sections are reordered at the owner's request while the task was open: Details,
Search Plans, Criteria, Settings, Reference Images. The two a new draft has to fill in now come
straight after the details it was created with, ahead of the settings, which have defaults.

The settings editor is cleaned up in the same way, also at the owner's request. Only eBay is
offered as a marketplace, in the settings and in a search plan's source, since the other three have
no adapter until Phase 4 and ticking one would search nothing; a spec that already names one still
shows it, so nothing is switched on out of sight. The poll interval is typed in whole hours rather
than as ISO 8601, stored as the duration it always was, with a hint giving the period the scheduler
will really use — `durationToMinutes` and `snapToExpressible` moved from `poll/interval.ts` into
`domain/duration.ts` so the browser can share them, since `interval.ts` imports `node:crypto`. The
grading fields are hidden until Phase 5 builds grading scales. Every stored value is shown in
words — *Newest 200*, *Fixed price*, *For parts or not working* — from one `labels.ts` the editor
and the item page's settings card both use. And Condition and Poll every, and Negative keywords and
Shipping to the UK, swap places.

#### What P1-26 found

**A promoted wish is the one way to reach an item without a summary.** Promotion writes a draft from
the wish's label, category, tags and link, and a wish has no summary to bring; the page shows *No
summary was written* under Details, with no mark, because the summary is not what a poll needs.
Promoting through the dialog — prefilled from the wish, and deleting it on *Create* — would close
it, but promotion is one transaction today so that a thing is never a wish and wanted at once, and
changing that is a task of its own.

**One Playwright check had nothing left to run against.** P1-18's run typed into the settings form
and read the result back out of the JSON on the same page; a section editor has no JSON beside it,
so the run now types the same awkward values into the settings editor — a duration a key at a time,
a price with pence — and checks that Discard writes nothing. That the form writes what the JSON
then holds is still covered by `parse.test.ts`, which tests the functions both go through.

**The removed page took three things with it**: `VersionHistory` (the editor's plain heading over
the list the item page shows in a modal), and the image panel's `canInsert` and `framed`, which
only ever differed on that page.

**`spec-form.tsx` holds a literal NUL byte**, as the separator in a string join (line 486), so
`grep` and `file` treat the file as binary and quietly skip it. It works; `'\0'` would say the
same thing in a form tools can read. Left for the next task that touches the form.

#### P1-XX Phase 1 exit — S

Run the Phase 1 exit test on the droplet. Record the outcome, the month's real AI spend so far, and the spike recommendations in `CHANGELOG.md` under `v0.2.0`. Update ARCHITECTURE.md §2 with anything the spikes changed. When `development/0.2.0` is merged to `main`, make `main` the default branch again — it was switched to the integration branch during Phase 0 so manually triggered workflows and Renovate could see their files — and remove the "replace `main` with `development/0.2.0`" note from RUNNING.md.

---

## What comes next

Phase 2 and Phase 3 will be planned once Phase 1's spikes are in, because the Vinted findings decide how much of Phase 4 exists as designed and the eBay findings decide the default marketplaces. The shape will be the same as this document: tasks with sizes, dependencies and done-when lists.

Their order was swapped at the Phase 0 exit (ARCHITECTURE.md §17 v1.22): **Phase 2 is notifications** — the 08:00 digest, `Notification` idempotency for every channel, the backfill and scan summary email, English summaries in email, the proper templates, and the retention job from §13, which otherwise waits until Phase 5 while candidates and media accumulate from the first poll; **Phase 3 is the interviewer** — the chat, `propose_spec`, backfill-before-agree, the Agree and amendment flows, and the side-by-side version diff. Notifications come first because the SMTP transport has existed since P0-10 and an email for a real match is the product's output, which should not wait behind a chat UI.

**Phase 2's retention job also owns §13's orphaned-media sweep**, carried from P1-18: a reference image uploaded in the spec editor and never saved into a version, more than a day old and referenced by no spec version, grading scale, candidate or wanted item's display image, is deleted. Done when an abandoned upload is gone after the next nightly run and one saved into a version is not, and an image that is only an item's display image (P1-25) is not.

**The typed spec form is Phase 1 work** (ARCHITECTURE.md §17 v1.35), which is a correction to that swap rather than part of it. The swap's second reason was that "the manual editor gives a way to create specs", and P1-13's editor — a raw JSON textarea, which is what §17 asked for — is that only for someone who knows the schema. Deferring the form with the chat therefore left hand-written JSON as the sole way to create or amend an item across two phases instead of one. The form needs nothing from the interviewer: it is a typed editor over P1-02 schemas, and the spec card in P1-14 already renders every one of those fields read-only. It was first scheduled at the head of Phase 2 and then brought forward, so that the Phase 1 exit does not leave JSON as the only way in; P1-18, in Track B above, is that task.

### Carried forward from the Phase 0 exit test

Found while running the exit test, sized and written up here so they are scheduled rather than forgotten. They belong to Phase 6 unless a later phase needs them sooner.

#### P6-xx Bootstrap writes the instance, not just the host — S

The exit test showed that steps 4 and 5 of RUNNING.md — download five files, generate two
secrets, edit `.env` by hand — are where the time and the mistakes went (a base64 password that
broke `DATABASE_URL`, a placeholder left in `authorized_keys`, an editor that could not open).
Extend `scripts/bootstrap-droplet.sh` so that, given `GOODIES_BEACON_HOST`, it also fetches
`docker-compose.yml`, `Caddyfile`, `backup.sh` and `deploy.sh` into `/opt/goodies-beacon`, writes a
`.env` with the host, `GOODIES_BEACON_VERSION`, and freshly generated `GOODIES_BEACON_SECRET_KEY`
and hex `POSTGRES_PASSWORD`, at mode 600; given `DEPLOY_PUBKEY`, writes `deploy`'s
`authorized_keys` with the forced command and prints the fingerprint; and applies pending apt
updates, saying whether a reboot is needed. Still idempotent: an existing `.env` or key line is
left alone and reported — but `docker-compose.yml`, `Caddyfile`, `backup.sh` and `deploy.sh` are
refreshed on every run, because they live outside the image and a deploy never updates them; today
that is a by-hand `curl` step after any merge that touches them. Depends on P0-12.

Done when:

- [ ] `GOODIES_BEACON_HOST=… curl … | sudo bash` on a fresh Ubuntu 24.04 leaves `/opt/goodies-beacon` ready for `docker compose up -d` with nothing to edit, and the same script pasted as DigitalOcean *User data* does the same before first login.
- [ ] A second run changes nothing and says so for every step, including the two secrets.
- [ ] `DEPLOY_PUBKEY` produces an `authorized_keys` line whose fingerprint `ssh-keygen -lf` prints, and the three `ssh` checks in RUNNING.md pass against it.
- [ ] RUNNING.md's install section shrinks to: firewall, DNS, one bootstrap command, `docker compose up -d`, claim it — and the timed walk-through in P0-12 is re-run against it.

#### Later hardening, not blocking — S each

From the same review, worth doing but not before Phase 1. Each is small; take them when a task
touches the area, or together as one chore.

- [ ] `__Host-` prefix on the session cookie, so a browser refuses one set by a subdomain or over HTTP. Renames the cookie in `docs/API.md`, RUNNING.md and the tests.
- [ ] An absolute session lifetime (ninety days) alongside the sliding thirty, so a stolen cookie that is used regularly still dies.
- [ ] Cap and sanitise an inbound `X-Request-Id` before it reaches the log — length and character set.
- [ ] Off-site copies of the dumps: RUNNING.md gives the `tar` over `ssh` one-liner; a scheduled version, or DigitalOcean Spaces, once there is data worth keeping.
- [ ] Chromium sandboxing for the browser-driven adapters, when the Vinted adapter lands in Phase 4.
- [ ] TOTP as an optional second factor (§12's "small later addition").

#### P1-xx Deploy carries the on-droplet files — S

`deploy.sh` moves the image and nothing else, so `docker-compose.yml`, the two Caddyfiles,
`backup.sh` and `deploy.sh` itself are refreshed by hand after any merge that touches them, and
the release workflow cannot do it: its key can only run `deploy.sh`. Ship the five files inside
the image (a `/app/deploy` directory in the Dockerfile; `.dockerignore` currently excludes them)
and have `deploy.sh`, after the pull, copy them out of the image it just pulled — writing its own
replacement to a temporary name and moving it into place — then `docker compose up -d` for every
service rather than `app` alone, so a compose change is applied. The files are then versioned
with the tag they belong to, and `dev` and `sha-` tags work the same way. Take it before
`v0.2.0`, since Phase 1 will change the compose file. Depends on P0-13.

Done when:

- [ ] Deploying a tag whose compose file differs from the droplet's applies the change; deploying one whose files are identical changes nothing and says so.
- [ ] `deploy.sh` replacing itself mid-run is proven safe: the running copy finishes, and the next run is the new one.
- [ ] RUNNING.md's install step fetches only `.env.example`, `docker-compose.yml` and `deploy.sh` to bootstrap, and its upgrade section no longer has a by-hand refresh.

#### P6-xx First-run setup token — S

Between `docker compose up` and the owner setting a password, the instance belongs to whoever reaches it first (§12). Today that is mitigated by RUNNING.md saying to claim it immediately, which is fine for the developer and weak for a stranger who deploys and comes back tomorrow. On first start with no user, generate a random token, print it in the container log as a clearly marked line, and require it in the first-run form alongside the password. Depends on P0-07.

Done when:

- [ ] `POST /api/auth/first-run` refuses a request without the token, or with a wrong one, and the refusal is rate-limited like login.
- [ ] The token is printed once on start when no user exists, is never printed once a user exists, and does not appear in the log at any other level.
- [ ] The first-run page explains where to find the token (`docker compose logs app`), and the Playwright run reads it from the API process's output.
- [ ] RUNNING.md's "Claim it" step describes the token instead of the race.
