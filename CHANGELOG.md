# Changelog

All notable changes to Goodies Beacon. Format follows conventional commits; releases are GitHub Releases tagged `vX.Y.Z`.

## Unreleased

- Work merges into the `development/0.2.0` integration branch until Phase 1 is complete; `main` receives a single merge at the end. `v0.1.0` is still tagged from the integration branch at the Phase 0 exit.

- P0-01 Repository and monorepo scaffold.
- P0-02 Biome, lefthook, editor config.
- P0-03 CI workflow: Lint, Typecheck, Test, Build and Docker image run as separate parallel checks on every pull request, sharing a cached pnpm store through a composite setup action; pushes to `main` publish the image to GHCR as `edge` and `sha-<short sha>`.
- A minimal production `Dockerfile` (multi-stage, non-root, runs the API). Brought forward from P0-11 so CI has an image to build.
- Renovate configured for weekly grouped dependency updates, holding TypeScript on 6.x and Node on 24.
- Baseline pinned to Node 24 (Active LTS), pnpm 11, TypeScript 6.0, Vitest 4.1, Biome 2.5.
