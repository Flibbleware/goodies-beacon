# Goodies Beacon — instructions for coding agents

Goodies Beacon is a self-hosted, open-source "wanted list" for collectors: it polls marketplaces on a schedule, an AI reviewer judges every new listing against a wanted spec, and the owner is emailed about real matches. Single user, TypeScript monorepo, one `docker compose up`.

## Read these first

1. `docs/ARCHITECTURE.md` — the design and the source of truth. Read it before designing or changing anything. Task descriptions cite its sections (§5, §7…).
2. `docs/DEVELOPMENT_PLAN.md` — the task list. Work is picked from here: the first task whose dependencies are all complete and whose *done when* boxes are not all ticked.

If a task conflicts with the architecture doc, or the code you find on disk conflicts with either document, stop and say so rather than choosing silently. Update the document in the same pull request when a decision changes.

## How work is done

- One task per branch, named after the task id (`p0-07-auth`). Squash-merge to `main` via pull request.
- A task's *done when* list is its acceptance test. Every line must be true before the task is complete; tick the boxes in `docs/DEVELOPMENT_PLAN.md` in the same commit as the work.
- Conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Nothing merges with Biome errors, type errors or failing tests. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before declaring a task done.
- Anything user-facing gets a line in `CHANGELOG.md` under *Unreleased*; anything operational gets a line in `docs/RUNNING.md`.
- Secrets never enter the repository. Every environment variable is documented in `.env.example`.
- Pin exact dependency versions. When adding or upgrading a dependency, choose the newest major line that has been generally available for at least a month; never a pre-release (alpha, beta, rc, canary) and never a `.0` release younger than a month when the previous line is still maintained. Check `npm view <pkg> time` rather than assuming.
- TypeScript is pinned to the 6.0 line (the bridge release to 7: same defaults, deprecations as warnings). Move to 7.x only once 7.1 ships with its stable programmatic API and editor integration is routine — that is its own task, not a Renovate merge.
- Prefer small, boring solutions. The architecture already made the interesting decisions.

## Commands

```
pnpm install      # also installs the lefthook pre-commit hook
pnpm dev          # api, worker and web with hot reload
pnpm typecheck    # tsc -b across every package
pnpm lint         # biome ci
pnpm format       # biome check --write
pnpm test         # vitest across every package
pnpm build
```

## Layout

`apps/api` (Hono server, interviewer agent), `apps/web` (React), `apps/worker` (pg-boss jobs), `packages/core` (domain types, schemas, pipeline logic), `packages/ai` (roles, prompts, provider factory, cost ledger), `packages/email`, `packages/sources/<id>` (one marketplace adapter per package; `_template` is the starting point). See `docs/ARCHITECTURE.md` §15.
