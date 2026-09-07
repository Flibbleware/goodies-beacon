# Goodies Beacon

**Status: pre-alpha — nothing works yet.** This repository is being built phase by phase from [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

Goodies Beacon is a self-hosted, open-source "wanted list" for collectors. You describe an item to an AI interviewer, which asks questions until the criteria are unambiguous and then freezes an agreed wanted spec (text criteria, search queries, price ceiling, reference images). Goodies Beacon polls marketplaces on a schedule, an AI reviewer inspects every new listing (title, description, photos) against the spec, and you get an email for real matches — immediately, or in an 8am digest. Anything the reviewer cannot decide is surfaced, not hidden. Everything the reviewer rejected is visible in the web UI so you can audit it, challenge it, and have your challenge folded back into the spec.

It is single-user, runs from one `docker compose up`, and every marketplace and AI credential is supplied by whoever runs the instance.

## Documents

- [Architecture](docs/ARCHITECTURE.md) — what is being built and why.
- [Development plan](docs/DEVELOPMENT_PLAN.md) — the task list, with acceptance criteria.

## Layout

```
apps/
  api/        Hono server, interviewer agent, routes; serves the built web app
  web/        React app
  worker/     pg-boss subscribers: poll, review, notify, retention
packages/
  core/       domain types, Zod schemas, database schema, pipeline logic
  ai/         AI roles, prompts, provider factory, cost ledger
  email/      email templates
  sources/    one package per marketplace adapter; _template is the starting point
docs/
```

## Developing

Requires Node 24 (`.nvmrc`) and pnpm 11 (`corepack enable` or `npm i -g pnpm@11`).

```
cp .env.example .env
openssl rand -base64 32          # paste into GOODIES_BEACON_SECRET_KEY
pnpm install
pnpm typecheck   # tsc -b across every package
pnpm lint        # biome ci
pnpm test        # vitest across every package
pnpm build
```

To run one package's tests: `pnpm --filter @goodies-beacon/core test`.

Every process validates its environment at startup and exits naming any variable that is
missing or malformed, so a bad `.env` fails immediately rather than halfway through a run.

A pre-commit hook (lefthook) formats staged files with Biome. Install it once with `pnpm exec lefthook install` (also runs automatically on `pnpm install`).

The production image builds with `docker build -t goodies-beacon .`; CI builds it on every pull request.

## Licence

MIT — see [LICENSE](LICENSE).

## Working with a coding agent

Read `CLAUDE.md` (also provided as `AGENTS.md`). It points the agent at the architecture doc and the development plan and states the working conventions, so a session can start with just "do P0-03".

## Next task

P0-05 (Postgres, Drizzle, migrations) — see docs/DEVELOPMENT_PLAN.md. P0-01 to P0-04 are done.
