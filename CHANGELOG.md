# Changelog

All notable changes to Goodies Beacon. Format follows conventional commits; releases are GitHub Releases tagged `vX.Y.Z`.

## Unreleased

- Work merges into the `development/0.2.0` integration branch until Phase 1 is complete; `main` receives a single merge at the end. `v0.1.0` is still tagged from the integration branch at the Phase 0 exit.

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
