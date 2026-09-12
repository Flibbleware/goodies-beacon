# Changelog

All notable changes to Goodies Beacon. Format follows conventional commits; releases are GitHub Releases tagged `vX.Y.Z`.

## Unreleased

- Work merges into the `development/0.2.0` integration branch until Phase 1 is complete; `main` receives a single merge at the end. `v0.1.0` is still tagged from the integration branch at the Phase 0 exit.

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
