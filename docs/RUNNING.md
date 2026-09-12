# Running Goodies Beacon

Operational notes for whoever is looking after an instance. Installing on a fresh droplet is
covered in P0-12; until then this file collects what each task adds.

## Process roles

One image runs every role, selected by `ROLE` in `.env`. `apps/api/dist/main.js` is the entrypoint
for all of them:

| `ROLE` | What starts | Notes |
|---|---|---|
| `all` | API server and every worker subscriber in one process | The default, and what `docker-compose.yml` runs |
| `api` | API server only | Applies database migrations on start |
| `worker` | Worker subscribers only | Waits for an `api` or `all` container to have migrated |

Only `api` and `all` run migrations, under a Postgres advisory lock, so several containers starting
at once cannot race. A `ROLE=worker` container on a fresh database will fail its first jobs until
something has migrated; start the API first.

`WORKER_SOURCES=vinted,ebay` turns a worker into a **sources-only** worker: it subscribes to
`poll.vinted` and `poll.ebay` and takes no other work. That is how a polling worker runs on a home
connection while the droplet keeps the reviews, notifications and retention jobs. Leave it empty on
the main worker, which must handle everything.

## Queues

Job queues live in the same Postgres database as the application data, in the `pgboss` schema, so a
`pg_dump` of the database captures both. Queue names are stable and carry their subject: `poll.ebay`,
`heartbeat.api`. Renaming one orphans whatever is already queued under the old name.

## Liveness

A `heartbeat:<role>` job runs every five minutes and updates `process_heartbeat.last_seen_at` for
that role. A `last_seen_at` older than about ten minutes means no process is answering for that
role — not that a job failed, because each process subscribes only to its own role's queue. The
dashboard surfaces this in P1-16; until then:

```sh
docker compose exec db psql -U goodies_beacon -c 'select * from process_heartbeat'
```

## Signing in

The instance has one user (§12). On a fresh database no password is set, and the first person to
reach the site sets it — so **set your password immediately after the first deploy**, before the
DNS name is public. Until then `/api/auth/session` reports `firstRun: true` and anyone who finds the
host can claim it.

Sessions last thirty days, sliding on use, and sign-out ends them. Changing the password ends every
other session, which is how you evict someone who has one.

**Locked out by failed attempts.** Five wrong passwords from one address triggers a fifteen-minute
lockout for that address. The counters are held in memory, not the database, so
`docker compose restart app` clears them if you cannot wait. That also means the limit is per API
container: a deployment running two would give each its own allowance.

**Forgotten password.** There is no reset link — a single-user instance has nobody to send one. Set
a new one by deleting the user row and going through first run again, which also invalidates every
session:

```sh
docker compose exec db psql -U goodies_beacon -c 'delete from auth_user'
```

## Restarts and shutdown

`docker compose restart app`, a deploy, or any `SIGTERM` shuts down in order: stop accepting HTTP
requests, let in-flight jobs finish (up to pg-boss's 30-second grace period), then close the
database pool. The process exits 0 when that completes, or 1 after 45 seconds if something is stuck,
so give containers a `stop_grace_period` of at least 60 seconds. Jobs still running when the grace
period expires are marked failed and retried, so a hard kill costs a retry, not a job.
