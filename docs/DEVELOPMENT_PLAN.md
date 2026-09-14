# Goodies Beacon — Development Plan

*Phases 0 and 1. Companion to ARCHITECTURE.md v1.28; section numbers below refer to it.*

Version 1.5 — 15 September 2026. Every *done when* line is a checkbox; tick them in the same commit as the work.

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

Two tracks. Track A is throwaway spike work; Track B is the product. They are independent until P1-18, with one ordering rule: **S1-01 goes first**, before P1-01, because P1-04 depends on it and P1-03's harness wants the fixtures it records. The Vinted spike needs a residential proxy with a sticky GB session (§5); sign up for one in the first week so S1-02 is never waiting on a purchase. The droplet exists now, so the "from the droplet" half of every spike can be run at once.

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
| P1-18 | Phase 1 exit | S | all above, S1-05 |

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
- [ ] Reference image upload from the UI works and shows the running "images per review" count. **Half done, and the remainder belongs to P1-13.** `POST /api/media` accepts an upload with a label, re-encodes it and returns the row, and `GET /api/media/:id` and `/:id/thumb` serve it with an immutable cache and an ETag. There is no page to put the control on: §7's running count lives on the item page, and P1-13's own description carries "reference image upload with labels (P1-05)". Building an unmounted component now would be guessing at what that task needs.

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

- [ ] Fixture tests: obvious misses are rejected and plausible or ambiguous listings pass, on the configured cheap model. **Everything but the model run is built; the run needs a key and has not happened.** Eighteen cases in `packages/ai/fixtures/prefilter-cases.json` cover both example specs in both directions, including four deliberately near the line (a job lot in which the item is named, an iMac G3 against the Power Mac spec), and `pnpm --filter @goodies-beacon/ai prefilter-check` runs them against whichever model the `prefilter` role is set to, reporting wrong discards and wrong keeps apart and failing on the first. Twenty-nine offline tests cover the bounding, the prompt assembly and the fail-open path. This box ticks when the script is run against a real cheap model; P1-17 then turns the same fixtures into a CI gate across two providers.
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

- [ ] Structured output is validated with Zod; a malformed response is retried once and then recorded as a review failure visible in the UI.
- [ ] Fixture tests cover: a clear pass, a clear hard fail (visible damage), an unknown (contents not visible), and a Japanese listing producing an English summary.
- [ ] The exact prompt and image list sent are stored with the verdict so "Show prompt" can display them.

#### P1-11 Decision rules — M

Pure function from `(spec version, reviewer output)` to `{ decision, reasons }` implementing the rules in §7 step 6, including `onUnknown` per criterion and the item default.

Done when: a table-driven unit test covers every rule branch, and the function is the only place a decision is made (the reviewer never outputs a decision).

#### P1-12 Review worker pipeline — L

The `review` job per §7: normalise → hard filters (price ceiling via P1-06, negative keywords) → pre-filter → enrich → media ingest → reviewer → decide → store verdict → notify. Stage recorded on the candidate; each stage idempotent so a retried job doesn't double-spend.

Notify is deliberately minimal here: for a `match` or `uncertain` on a realtime-mode item with `origin = poll`, write the `Notification` row and send one plain-text email through the P0-10 transport — title, price, verdict, the unknowns if uncertain, the listing link and the candidate link. No template, no digest, no batching of backfill results; those are the notifications phase. It is here because the transport already exists and an email is the product's actual output; without it the reviewer's work is only visible to someone refreshing a tab.

Done when:

- [ ] Integration test with the template adapter and a fake AI provider runs a candidate through every stage and asserts the stored verdict and cost rows.
- [ ] A candidate rejected by hard filters has no AI cost.
- [ ] Re-running the job for a completed candidate is a no-op.
- [ ] Failures at any stage leave the candidate in a visible `failed` state with the error, and are retried three times with backoff.
- [ ] A `match` on a realtime item sends one plain email and writes its `Notification` row first, so a retried job cannot send twice; a `reject`, a digest-mode item, and a backfill candidate send nothing.

#### P1-13 Spec editor (manual) — M

Item creation and editing without the interviewer, at the size §17 gives Phase 1: "a manually-written spec (JSON in the UI, no interviewer yet)". A page with a title field, a JSON editor for the spec validated live against the P1-02 schemas with errors shown at the offending path, the P1-02 linter's warnings listed beneath, reference image upload with labels (P1-05), and a change note. Saving creates a new immutable spec version. The typed form — toggles and dropdowns for `SpecSettings`, the criteria and search-plan tables — and the side-by-side version diff are the interviewer phase's direct-editing work per §17, not this task's; the version history here is a plain list.

Done when:

- [ ] The two example specs (Carmageddon, Power Mac 5500) can be entered end to end by pasting or typing their JSON.
- [ ] A spec that fails the schema cannot be saved, and the error names the path; linter warnings from P1-02 appear beneath the editor.
- [ ] Each save creates a version, listed with its date and change note; the current version is what polling uses.

#### P1-14 Wanted items UI — M

List page (status, mode, last poll, counts) and item page (current spec card, version history, per-plan stats with candidates found / reviewed / matched / uncertain and pre-filter cost, pause/resume, and the "Scan current listings" button disabled with a "Phase 5" tooltip).

Done when: the list and item pages render from real data, and per-plan stats update after a poll.

#### P1-15 Candidates and verdicts UI — L

Candidate list per item, filterable by verdict and origin, with thumbnail, English title, price in GBP and original, source, location, ships-to-UK flag, and decision chip. Candidate page: photo gallery, English summary, sanitised description, verdict with per-criterion evidence, "Show prompt", Retain toggle, link to the listing. Feedback buttons present but disabled until Phase 5.

Done when:

- [ ] Rejected candidates are as easy to browse as matches (this is the audit view from requirement 6).
- [ ] "Show prompt" displays the stored prompt text and the exact images sent.
- [ ] The page is usable on a phone (the digest emails will link here).

#### P1-16 Dashboard — M

Today's matches and uncertains, active items, source health (last poll, last success, last error per adapter), AI spend this month against the cap, worker heartbeat.

Done when: every figure links to the page that explains it, and an adapter failure from the last poll is visible without opening logs.

#### P1-17 Prompt eval suite in CI — M

A fixture set of about twenty listings (real, anonymised, from the spikes and your own eBay tabs) with expected pre-filter and reviewer outcomes for the two example specs. Runs in CI against two providers using repository secrets, with a small budget, and reports precision and recall in the job summary. It spends real money, so it runs only when something it judges has changed — a path filter on `packages/ai/src/prompts/**`, the fixtures and the eval code — plus a `workflow_dispatch` trigger for running it by hand; an unrelated pull request does not pay for it.

Done when:

- [ ] The suite passes on both configured providers.
- [ ] A deliberate prompt regression (e.g. removing the quantifiable/soft instruction) fails the suite.
- [ ] The suite is skipped with a notice when provider secrets are absent, so forks still get green CI.
- [ ] A pull request that touches neither prompts, fixtures nor the eval code does not run it.

#### P1-18 Phase 1 exit — S

Run the Phase 1 exit test on the droplet. Record the outcome, the month's real AI spend so far, and the spike recommendations in `CHANGELOG.md` under `v0.2.0`. Update ARCHITECTURE.md §2 with anything the spikes changed. When `development/0.2.0` is merged to `main`, make `main` the default branch again — it was switched to the integration branch during Phase 0 so manually triggered workflows and Renovate could see their files — and remove the "replace `main` with `development/0.2.0`" note from RUNNING.md.

---

## What comes next

Phase 2 and Phase 3 will be planned once Phase 1's spikes are in, because the Vinted findings decide how much of Phase 4 exists as designed and the eBay findings decide the default marketplaces. The shape will be the same as this document: tasks with sizes, dependencies and done-when lists.

Their order was swapped at the Phase 0 exit (ARCHITECTURE.md §17 v1.22): **Phase 2 is notifications** — the 08:00 digest, `Notification` idempotency for every channel, the backfill and scan summary email, English summaries in email, the proper templates, and the retention job from §13, which otherwise waits until Phase 5 while candidates and media accumulate from the first poll; **Phase 3 is the interviewer and spec editing** — the chat, `propose_spec`, backfill-before-agree, and the typed spec form and side-by-side version diff that P1-13 deliberately leaves out. Notifications come first because the SMTP transport has existed since P0-10, the manual editor gives a way to create specs, and §8 calls the interviewer a convenience rather than a gatekeeper; an email for a real match is the product's output, and it should not wait behind a chat UI.

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
