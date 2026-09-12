# Running Goodies Beacon

Operational notes for whoever is looking after an instance. Installing on a fresh droplet is
covered in P0-12; until then this file collects what each task adds.

## The two images

| Image | Contains | For |
|---|---|---|
| `ghcr.io/flibbleware/goodies-beacon` | Everything, including Chromium | The default. Needed by the browser-driven adapters (Vinted) |
| `ghcr.io/flibbleware/goodies-beacon/slim` | Everything but Chromium | An API-only container, or a worker that polls no scraped source |

Pick with `GOODIES_BEACON_IMAGE` in `.env`. Both run as an unprivileged user and take the same
configuration; the slim one simply cannot drive a browser, so a Vinted poll on it will fail rather
than silently return nothing.

## Running it

**Production** — `docker compose up -d`. Three services: `db`, `app` (`ROLE=all`) and `caddy`.
Only Caddy publishes ports; Postgres and the app are reachable only on the compose network (§12).
Memory is capped per container — `app` 1.2 GB, `db` 512 MB, `caddy` 128 MB — so nothing can take
the droplet down by itself.

**Development** — `docker compose -f compose.dev.yml up -d` for Postgres and Mailpit, then
`pnpm dev` for the API, workers and web app with hot reload. The app is at `localhost:5173` and
Mailpit's inbox at `localhost:8025`; nothing Mailpit is given ever leaves the machine.

Copy `.env.example` to `.env` first and set at least `GOODIES_BEACON_HOST`, `POSTGRES_PASSWORD`
and `GOODIES_BEACON_SECRET_KEY` (`openssl rand -base64 32`).

## TLS

Caddy gets the certificate, renews it, and redirects HTTP to HTTPS without being asked. For a
public hostname the stock `Caddyfile` is all you need. For a tailnet-only instance set
`GOODIES_BEACON_CADDYFILE=./Caddyfile.tailscale`, which takes the certificate from tailscaled
instead — Let's Encrypt cannot certify a `*.ts.net` name — and mount its socket into the caddy
service. Either way HTTPS is required, not optional: see below.

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

## Health and logs

`/healthz` needs no session and reports what is running:

```json
{ "status": "ok", "version": "0.1.0", "sha": "9f2c1ab", "db": "ok" }
```

`version` and `sha` are baked into the image at build time, so they say what is *actually* running
rather than what the compose file asks for. A database that cannot be reached — or that accepts the
connection and never answers — makes it `503` with `"db": "unreachable"` within about two seconds,
so the deploy script and any monitor can act on the status code and never hang.

Logs are JSON lines on stdout (`docker compose logs -f app`), one per request plus whatever the
request itself logged, all carrying the same `requestId`. Every response repeats it in
`X-Request-Id`, so a 500 a user reports can be found directly:

```sh
docker compose logs app | grep <request id>
```

`LOG_LEVEL` takes pino's levels: `fatal`, `error`, `warn`, `info` (the default), `debug`, `trace`,
`silent`.

## Signing in

The instance has one user (§12). On a fresh database no password is set, and the first person to
reach the site sets it — so **set your password immediately after the first deploy**, before the
DNS name is public. Until then `/api/auth/session` reports `firstRun: true` and anyone who finds the
host can claim it.

Sessions last thirty days, sliding on use, and sign-out ends them. Changing the password ends every
other session, which is how you evict someone who has one.

The session cookie is always `Secure`, with no development exception. That costs nothing locally,
because browsers count localhost as a secure context and keep the cookie over plain HTTP — so
`pnpm dev`, the Playwright run and a local container all work without TLS. Anywhere with a real
hostname, the cookie is dropped over HTTP and nobody can sign in, so an instance reached by name
must be served over HTTPS: that is Caddy's job (P0-11), and it is why there is no "insecure mode"
to fall back on.

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

## Email

SMTP lives in Settings, not in `.env`: host, port, security, username, password, the from address
and the notification address. The password is encrypted with `GOODIES_BEACON_SECRET_KEY` before it
is stored, and the API never sends it back — the page is told only whether one is set, which is why
saving the section without retyping it keeps it.

**Send test email** mails the notification address and nothing else; the endpoint takes no address,
so a session cannot be used to make the instance mail a stranger. On success it says where it went.
On failure it shows what the mail server actually said — `550 5.7.1 Relaying denied` rather than
"sending failed" — which is usually enough to fix it.

Changing `GOODIES_BEACON_SECRET_KEY` makes the stored SMTP password undecryptable. Nothing silently
sends with the wrong credentials: the test send and every notification fail loudly instead. Enter
the password again to recover.

In development, mail goes to [Mailpit](https://mailpit.axllent.org) with its inbox at
`localhost:8025` — P0-11 adds it to `compose.dev.yml`.

## The web app

The pages are Dashboard, Settings and the login/first-run page; the rest of the left-hand
navigation is there but disabled, labelled with the task that brings it. Settings holds account
(change your password), email (SMTP) and instance (time zone, digest time) sections. Dark and light follow the
operating system — there is no toggle, and so no stored preference to get out of step with it.

## What serves what

In production the API container serves both the JSON API and the built web app: anything that is
not `/api/*` or `/healthz` is answered from `apps/web/dist`, falling back to `index.html` so a deep
link like `/settings` survives a refresh. An unknown `/api` path answers a JSON 404 rather than the
page, so a typo in a URL is not mistaken for a working endpoint.

`docs/API.md` lists every endpoint with whether it needs a session and whether it needs a CSRF
token. It is generated from the route table by `pnpm docs:api`, and CI fails if it is out of date.

**Rehearsing against a running instance.** The Playwright smoke test — first run, sign out, sign
in, a deep-link refresh, saving a setting — can be pointed at any instance, which is a quick way to
prove a deploy actually works:

```sh
E2E_BASE_URL=https://beacon.example.co.uk \
E2E_DATABASE_URL=postgres://... \
pnpm e2e
```

It **resets the password and every session** on the database it is given, so only ever point it at
a throwaway instance — never at the one you use.

## Restarts and shutdown

`docker compose restart app`, a deploy, or any `SIGTERM` shuts down in order: stop accepting HTTP
requests, let in-flight jobs finish (up to pg-boss's 30-second grace period), then close the
database pool. The process exits 0 when that completes, or 1 after 45 seconds if something is stuck,
so give containers a `stop_grace_period` of at least 60 seconds. Jobs still running when the grace
period expires are marked failed and retried, so a hard kill costs a retry, not a job.
