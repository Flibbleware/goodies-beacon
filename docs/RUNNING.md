# Running Goodies Beacon

How to install Goodies Beacon on a droplet, and how to look after it once it is there. Nothing
below assumes you have read anything else.

- [Installing on a fresh droplet](#installing-on-a-fresh-droplet)
- [Upgrading and rolling back](#upgrading-and-rolling-back)
- [Backups](#backups) and [restoring](#restoring)
- [The two images](#the-two-images) · [TLS](#tls) · [Process roles](#process-roles) ·
  [Health and logs](#health-and-logs) · [Signing in](#signing-in) · [Email](#email)

---

## Installing on a fresh droplet

About twenty minutes, most of it waiting. Ubuntu 24.04, 2 vCPU and 2 GB is enough (§11).

### 1. Create the droplet and lock it down

Create an Ubuntu 24.04 droplet with your SSH key. Then, **before** pointing DNS at it, attach a
DigitalOcean cloud firewall allowing only:

| Direction | Protocol | Ports | Why |
|---|---|---|---|
| Inbound | TCP | 22 | SSH |
| Inbound | TCP | 80 | HTTP, which Caddy redirects and uses for certificate challenges |
| Inbound | TCP | 443 | HTTPS |
| Outbound | All | All | Marketplaces, AI providers, SMTP, image pulls |

Nothing else needs to be open. In particular **do not open 5432**: Postgres has no published port
in `docker-compose.yml`, so it is reachable only from the other containers. Use the cloud firewall
rather than only `ufw` — Docker writes its own iptables rules, and a published port can traverse
`ufw` without being asked. Belt and braces is fine; cloud-firewall-only is safer than ufw-only.

Check from another machine once it is up:

```sh
nmap -Pn -p 22,80,443,5432 beacon.example.co.uk
# 22, 80, 443 open · 5432 filtered
```

### 2. Bootstrap it

As root, over SSH:

```sh
curl -fsSL https://raw.githubusercontent.com/Flibbleware/goodies-beacon/main/scripts/bootstrap-droplet.sh | sudo bash
```

That creates a `deploy` user that can use Docker without sudo, installs Docker Engine and Compose
from Docker's apt repository, adds a 2 GB swap file (with an `/etc/fstab` entry so it survives a
reboot), and creates `/opt/goodies-beacon` owned by `deploy`. It is safe to run again: every step
checks for its own result first, so a second run changes nothing.

It deliberately does **not** touch SSH configuration, the firewall or `authorized_keys`. Those are
decisions rather than mechanics, and the deploy key belongs to the release workflow.

### 3. Point DNS at it

An `A` record for the name you intend to use — `beacon.example.co.uk` — at the droplet's IPv4
address. Wait for it to resolve before the next step: Caddy asks Let's Encrypt for a certificate on
first start, and that only works once the name points at the droplet.

```sh
dig +short beacon.example.co.uk
```

### 4. Put the three files in place

In `/opt/goodies-beacon`, as the `deploy` user:

```sh
sudo -iu deploy
cd /opt/goodies-beacon
curl -fsSLO https://raw.githubusercontent.com/Flibbleware/goodies-beacon/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/Flibbleware/goodies-beacon/main/Caddyfile
curl -fsSL  https://raw.githubusercontent.com/Flibbleware/goodies-beacon/main/.env.example -o .env

# The two scripts compose and the deploy workflow reach for.
mkdir -p scripts
curl -fsSL https://raw.githubusercontent.com/Flibbleware/goodies-beacon/main/scripts/backup.sh -o scripts/backup.sh
curl -fsSL https://raw.githubusercontent.com/Flibbleware/goodies-beacon/main/scripts/deploy.sh -o deploy.sh
chmod +x scripts/backup.sh deploy.sh
```

Then edit `.env`. The four that matter on a first install:

```sh
GOODIES_BEACON_HOST=beacon.example.co.uk        # the name you pointed at the droplet
GOODIES_BEACON_SECRET_KEY=...                   # openssl rand -base64 32
POSTGRES_PASSWORD=...                           # anything long; only read while the volume is empty
GOODIES_BEACON_VERSION=latest                   # or a specific version tag
```

`chmod 600 .env` — it holds the key that decrypts your SMTP password.

Tailnet-only instead of a public name? Set `GOODIES_BEACON_CADDYFILE=./Caddyfile.tailscale`,
fetch that file too, and see [TLS](#tls).

### 5. Start it

```sh
docker compose up -d
docker compose logs -f app
```

The first start pulls about a gigabyte, applies the database migrations and asks Let's Encrypt for
a certificate. Wait for `goodies-beacon started`, then:

```sh
curl https://beacon.example.co.uk/healthz
# {"status":"ok","version":"0.1.0","sha":"9f2c1ab","db":"ok"}
```

### 6. Claim it

Open `https://beacon.example.co.uk` and **set your password immediately**. Until you do, anyone who
reaches the host can claim the instance — see [Signing in](#signing-in). Then open Settings and
configure email, and send yourself a test message.

---

## Upgrading and rolling back

What runs is whatever `GOODIES_BEACON_VERSION` in `.env` names, and `scripts/deploy.sh` is what
changes it. Both directions are the same command:

```sh
cd /opt/goodies-beacon
./deploy.sh v0.2.0      # or any published tag: dev, latest, sha-9f2c1ab
```

It dumps the database to `backups/` first, pulls the new image, switches `GOODIES_BEACON_VERSION`,
restarts, and polls `/healthz` for up to two minutes. Nothing is switched until the pull succeeds,
and if the new image does not come up healthy it puts the old version back and restarts it — so a
failed deploy leaves the previous image running rather than a broken one.

Rolling back is deploying the previous tag. Note that a release which migrated the database may
not be reversible by changing the image alone, which is why the dump comes first.

`docker image prune -a` reclaims the old images once you are satisfied.

### Deploying from the Actions tab

Two triggers, one path — both end at the same `deploy.sh` on the droplet.

- **Publish a GitHub Release** tagged `vX.Y.Z`. It builds and pushes the images for both
  architectures, writes the release notes from the commits since the last tag, and deploys.
- **Run the *Deploy* workflow by hand**, giving it an image tag. It defaults to `dev`, which is
  what every push to the integration branch publishes, so there is always something to deploy
  without cutting a release.

Both need three repository secrets. Without them the deploy is skipped with a notice rather than
failing, so a fork stays green:

| Secret | What |
|---|---|
| `DEPLOY_HOST` | The droplet's hostname or IP |
| `DEPLOY_KEY` | The **private** half of a key whose public half is in `deploy`'s `authorized_keys` |
| `DEPLOY_HOST_KEY` | The droplet's host key, from `ssh-keyscan -H <host>`. Optional, but without it the workflow trusts whatever answers |

`DEPLOY_USER` is optional and defaults to `deploy`.

### Restricting the deploy key

The deploy key can run one thing. `deploy.sh` is already in place from step 4; pin the key to it:

```sh
sudo -iu deploy

# The forced command: whatever the client asks to run is ignored, and this runs instead.
cat >> ~/.ssh/authorized_keys <<'KEY'
command="/opt/goodies-beacon/deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 AAAA... deploy@goodies-beacon
KEY
chmod 600 ~/.ssh/authorized_keys
```

With that in place the key cannot open a shell, forward a port or run anything else — a stolen
`DEPLOY_KEY` can deploy a published image and nothing more. The tag the workflow sends arrives in
`SSH_ORIGINAL_COMMAND`, which `deploy.sh` treats as a tag name and refuses unless it looks like
one, so `v1.0.0; rm -rf /` is rejected before anything runs.

Check it from your own machine:

```sh
ssh -i deploy_key deploy@beacon.example.co.uk whoami
# "Deploy failed: could not pull whoami" — deploy.sh ran and took the word as a tag name.
# What you must not see is the output of whoami.

ssh -i deploy_key deploy@beacon.example.co.uk 'v1.0.0; id'
# "Deploy failed: expected an image tag on its own" — refused before anything ran.

ssh -i deploy_key deploy@beacon.example.co.uk
# the same, with no tag: there is no shell to drop into.
```

## Backups

A `backup` service takes a `pg_dump` every night at `BACKUP_AT` (03:30 UTC by default), keeps
`BACKUP_KEEP_DAYS` of them (fourteen), and prunes the rest. `deploy.sh` writes one before every
deploy too. They all land in `/opt/goodies-beacon/backups`, a plain directory rather than a Docker
volume — a dump you cannot reach without `docker` is no use in the hour you need it:

```sh
ls -la /opt/goodies-beacon/backups
# goodies-beacon-20260913T033000Z.sql.gz   the nightly
# pre-deploy-20260913T101500Z.sql.gz       taken by deploy.sh
```

Is it working? The service says so on every run:

```sh
docker compose logs backup
# 2026-09-13T03:30:00Z  dumped goodies-beacon-20260913T033000Z.sql.gz (412K)
# 2026-09-13T03:30:01Z  14 dump(s) kept, 1 pruned (keeping 14 days)
# 2026-09-13T03:30:01Z  next dump in 23h 59m
```

Take one now with `docker compose exec backup backup.sh --once`.

**Copy them somewhere else.** A dump on the same droplet as the database it came from survives a
mistake, not a lost droplet. `scp deploy@beacon.example.co.uk:/opt/goodies-beacon/backups/*.sql.gz .`
on a schedule of your own is enough.

The nightly dumps are written by a root process in the container, so they belong to root and are
world-readable — `scp` and `gzip -dc` work as `deploy`, but removing one by hand wants `sudo`. The
pruning does that for you, so it rarely comes up.

### What is and is not in a dump

The dump holds the `public` and `drizzle` schemas — your settings, password, wanted items,
candidates and verdicts, and the migration journal. It deliberately leaves out `pgboss`, the job
queue: queued and finished jobs are transient, pg-boss rebuilds its own schema when the app starts,
and the poll schedules are recreated from the wanted items.

Downscaled listing images in the `media` volume are not backed up either — they can be fetched
again. And keep a copy of `.env` somewhere safe: without `GOODIES_BEACON_SECRET_KEY` a restored
dump cannot decrypt the SMTP password.

### Restoring

Stop the app first, so nothing writes while the tables are being replaced:

```sh
cd /opt/goodies-beacon
docker compose stop app
gzip -dc backups/goodies-beacon-20260913T033000Z.sql.gz \
  | docker compose exec -T db psql -U goodies_beacon -d goodies_beacon
docker compose start app
```

The dump drops and recreates what it restores, so this works over a live database as well as an
empty one. A clean restore prints no `ERROR` lines. Then check it took:

```sh
curl https://beacon.example.co.uk/healthz
```

and sign in — your password comes from the dump, so it is whatever it was when the dump was taken.

### Rehearsing a restore without touching anything

Restore into a scratch database instead, and look at it there:

```sh
docker compose exec -T db createdb -U goodies_beacon goodies_beacon_restore
gzip -dc backups/goodies-beacon-20260913T033000Z.sql.gz \
  | docker compose exec -T db psql -U goodies_beacon -d goodies_beacon_restore
docker compose exec -T db psql -U goodies_beacon -d goodies_beacon_restore \
  -c "select data->'instance' from settings"
docker compose exec -T db dropdb -U goodies_beacon goodies_beacon_restore
```

Worth doing once when you set the instance up, so the first time you restore is not the day you
need to.

## The two images

| Image | Contains | For |
|---|---|---|
| `ghcr.io/flibbleware/goodies-beacon` | Everything, including Chromium | The default. Needed by the browser-driven adapters (Vinted) |
| `ghcr.io/flibbleware/goodies-beacon/slim` | Everything but Chromium | An API-only container, or a worker that polls no scraped source |

Pick with `GOODIES_BEACON_IMAGE` in `.env`, which holds the whole reference so a fork can point it at another registry. Both run as an unprivileged user and take the same
configuration; the slim one simply cannot drive a browser, so a Vinted poll on it will fail rather
than silently return nothing.

## Development

`docker compose -f compose.dev.yml up -d` for Postgres and Mailpit, then `pnpm dev` for the API,
workers and web app with hot reload. The app is at `localhost:5173` and Mailpit's inbox at
`localhost:8025`; nothing Mailpit is given ever leaves the machine.

## TLS

Caddy gets the certificate, renews it, and redirects HTTP to HTTPS without being asked. For a
public hostname the stock `Caddyfile` is all you need. For a tailnet-only instance set
`GOODIES_BEACON_CADDYFILE=./Caddyfile.tailscale`, which takes the certificate from tailscaled
instead — Let's Encrypt cannot certify a `*.ts.net` name — and mount its socket into the caddy
service:

```yaml
caddy:
  volumes:
    - /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock
```

Either way HTTPS is required, not optional — see [Signing in](#signing-in).

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

Job queues live in the same Postgres database as the application data, in the `pgboss` schema —
which the nightly dump deliberately leaves out, because the jobs in it are transient and pg-boss
rebuilds the schema on start (see [what is and is not in a dump](#what-is-and-is-not-in-a-dump)).
Queue names are stable and carry their subject: `poll.ebay`, `heartbeat.api`. Renaming one orphans
whatever is already queued under the old name.

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
database pool. The process exits 0 when that completes, or 1 after 45 seconds if something is
stuck. `docker-compose.yml` gives the app a `stop_grace_period` of 60 seconds to allow for that.
Jobs still running when the grace period expires are marked failed and retried, so even a hard
kill costs a retry rather than a job.
