# Running Goodies Beacon

How to install Goodies Beacon on a droplet, and how to look after it once it is there. Nothing
below assumes you have read anything else.

- [Installing on a fresh droplet](#installing-on-a-fresh-droplet)
- [Upgrading and rolling back](#upgrading-and-rolling-back)
- [Backups](#backups) and [restoring](#restoring)
- [The two images](#the-two-images) · [TLS](#tls) · [Process roles](#process-roles) ·
  [Health and logs](#health-and-logs) · [Signing in](#signing-in) · [Email](#email) ·
  [Wanted items](#wanted-items) · [Candidates and verdicts](#candidates-and-verdicts) ·
  [The dashboard](#the-dashboard)

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

Without `nmap` (macOS has none by default), `nc` says the same one port at a time:
`nc -zv -w 3 beacon.example.co.uk 443` succeeds, and the same for 5432 times out.

### 2. Bootstrap it

Over SSH, apply whatever updates the droplet was created with pending, and reboot if it asks —
better now than in the middle of a deploy:

```sh
sudo apt-get update && sudo apt-get upgrade -y
[ -f /var/run/reboot-required ] && sudo reboot
```

Then run the bootstrap:

```sh
curl -fsSL https://raw.githubusercontent.com/Flibbleware/goodies-beacon/main/scripts/bootstrap-droplet.sh | sudo bash
```

> Until the first release is merged to `main`, the files fetched in this guide live only on the
> integration branch: replace `main` with `development/0.2.0` in each URL.

That creates a `deploy` user that can use Docker without sudo, installs Docker Engine and Compose
from Docker's apt repository, adds a 2 GB swap file (with an `/etc/fstab` entry so it survives a
reboot), and creates `/opt/goodies-beacon` owned by `deploy`. It is safe to run again: every step
checks for its own result first, so a second run changes nothing.

It deliberately does **not** touch SSH configuration, the firewall or `authorized_keys`. Those are
decisions rather than mechanics, and the deploy key belongs to the release workflow.

**Lock SSH to keys.** DigitalOcean's image already refuses passwords when the droplet was created
with an SSH key, but root can still log in by key, and there is no reason for it to once your own
user has sudo. Check, then pin all three, keeping this session open and testing a fresh login
before you close it:

```sh
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) '
printf 'PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' \
  | sudo tee /etc/ssh/sshd_config.d/60-goodies-beacon.conf
sudo sshd -t && sudo systemctl reload ssh
```

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
POSTGRES_PASSWORD=...                           # openssl rand -hex 24; letters and digits only, see below
GOODIES_BEACON_VERSION=latest                   # or a specific version tag
```

`chmod 600 .env` — it holds the key that decrypts your SMTP password.

If `nano` answers `Error opening terminal`, your terminal (Ghostty, kitty, and others) has told the
droplet a name it has no entry for: `export TERM=xterm-256color` for the session and try again.

The Postgres password must be letters and digits only: `docker-compose.yml` splices it into
`DATABASE_URL` without encoding, so a `/`, `@`, `?` or `#` in it stops the app from starting with
"DATABASE_URL must be a postgres:// connection URL". Hex from `openssl rand -hex 24` is safe; base64
is not. Postgres reads the password only while its volume is empty, so if you have to change it
after a first start, `docker compose down && docker volume rm goodies-beacon_pgdata` first.

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
# {"status":"ok","version":"v0.1.0","sha":"9f2c1ab","db":"ok"}
```

To see the certificate as a browser will, from another machine:

```sh
echo | openssl s_client -connect beacon.example.co.uk:443 -servername beacon.example.co.uk 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
# issuer=C=US, O=Let's Encrypt, ... · subject=CN=beacon.example.co.uk · ninety days of validity
```

Caddy writes its own log, including the certificate lines, to stderr, and `docker compose logs`
keeps that stream separate — so it is `docker compose logs caddy 2>&1 | grep -i certificate`, with
the `2>&1`, or grep finds nothing.

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

It dumps the database to `backups/` first — the same kind of dump as the nightly, so it restores
the same way — pulls the new image, switches `GOODIES_BEACON_VERSION`, restarts, and polls
`/healthz` for up to two minutes. Nothing is switched until the pull succeeds,
and if the new image does not come up healthy it puts the old version back and restarts it — so a
failed deploy leaves the previous image running rather than a broken one.

`deploy.sh` moves the image and nothing else. `docker-compose.yml`, the `Caddyfile`, `backup.sh`
and `deploy.sh` itself are files in `/opt/goodies-beacon`, so when a release changes one of them
the release notes say so and you fetch it again as in step 4, then `docker compose up -d` to
apply it.

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
| `DEPLOY_HOST_KEY` | The droplet's host keys: the lines starting `\|1\|` from `ssh-keyscan -H <host> 2>/dev/null`. Optional, but without it the workflow trusts whatever answers |

`DEPLOY_USER` is optional and defaults to `deploy`. With the `gh` CLI the three are one line each:

```sh
gh secret set DEPLOY_HOST --body beacon.example.co.uk
gh secret set DEPLOY_KEY < ~/.ssh/goodies-beacon-deploy
ssh-keyscan -H beacon.example.co.uk 2>/dev/null | gh secret set DEPLOY_HOST_KEY
```

> GitHub lists a manually triggered workflow only when its file exists on the repository's
> default branch. Until the first release is merged to `main`, that means either making
> `development/0.2.0` the default branch for the time being or deploying by hand with
> `./deploy.sh <tag>` on the droplet. Releases are unaffected: a release event runs the workflow
> from the tag's own commit.

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

Take one now with `docker compose exec -T backup backup.sh --once`.

**Copy them somewhere else.** A dump on the same droplet as the database it came from survives a
mistake, not a lost droplet. Once a week from your own machine is enough:

```sh
ssh you@beacon.example.co.uk 'sudo tar -C /opt/goodies-beacon -cf - backups' | tar -xf -
```

Every dump is owner-only (mode 600), because it holds the password hash, the encrypted SMTP
password and the session table. The nightly ones belong to root, since the backup container runs
as root, and the pre-deploy ones to `deploy`; that is why copying them off goes through `sudo`
rather than `scp` as `deploy`. Pruning is done by the same root process, so it never needs you.

### What is and is not in a dump

The dump holds the `public` and `drizzle` schemas — your settings, password, wanted items,
candidates and verdicts, and the migration journal. It deliberately leaves out `pgboss`, the job
queue: queued and finished jobs are transient, pg-boss rebuilds its own schema when the app starts,
and the poll schedules are recreated from the wanted items.

Downscaled listing images in the `media` volume are not backed up either — they can be fetched
again. And keep a copy of `.env` somewhere safe: without `GOODIES_BEACON_SECRET_KEY` a restored
dump cannot decrypt the SMTP password or the seller salt.

### Rotating the secret key

`GOODIES_BEACON_SECRET_KEY` encrypts two things: the SMTP password, which you can simply retype,
and the **seller salt** in the `instance_secret` table, which you cannot — it is random, it exists
only there, and every `listings.seller_hash` written so far was computed with it. Losing it does
not lose any listing data, but relist detection (ARCHITECTURE.md §7 step 2) stops recognising
sellers it saw before that point, so old listings start looking like new ones from a new seller.

So a rotation is: stop the app, take a dump, decrypt the salt with the old key and re-encrypt it
with the new one, then start with the new key and re-enter the SMTP password. If you have already
rotated and lost the old key, the recovery is to delete the `instance_secret` row — a fresh salt
is generated on the next poll, and relist detection simply starts again from that day. It is a
degradation, not a corruption; nothing else in the database depends on the old value.

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

Release tags (`v0.1.0`, `latest`) are built for `amd64` and `arm64`. The branch tags — `dev`,
`edge` and `sha-<short sha>` — are `amd64` only, to keep pull requests quick, so an arm64 host (an
Apple Silicon Mac, a Raspberry Pi, an Ampere droplet) can run only a release.

Both packages are public, so the droplet pulls them with no `docker login` — there is no registry
credential to store, rotate or have expire mid-deploy. A fork that keeps its packages private must
log in once on the droplet as `deploy` (`docker login ghcr.io` with a token that has only
`read:packages`) before the first `docker compose up` or `deploy.sh`; the login persists in
`~deploy/.docker/config.json`.

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

One image runs every role, selected by `ROLE`. `docker-compose.yml` pins `all` for its `app`
service, so `.env` only decides it for a container defined elsewhere — a remote worker, say.
`apps/api/dist/main.js` is the entrypoint
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

`review.candidate` is created but nothing consumes it yet — the reviewer arrives in P1-12. That is
deliberate: a poll has to be able to send to it, and jobs waiting in a queue are better than jobs
taken by a placeholder and discarded. Expect it to grow a backlog once items are polling, and for
that backlog to drain the first time a worker with a reviewer starts.

## Polling

Every active wanted item's enabled search plans get a `poll.<source>` schedule at the item's
interval — three times a day unless the item or the instance says otherwise — staggered by a hash
of the plan id so a hundred plans do not all fire in the same second. Four things stop a plan
polling: the item is not `active`, the plan's own `enabled` flag is off, the item's settings have
that marketplace switched off, or no adapter is installed for its source.

Schedules are not written once at startup. A `schedules.reconcile` job runs every minute on the
core worker and brings pg-boss into line with the database, so pausing an item or changing its
interval takes effect within a minute without a restart. A `WORKER_SOURCES` satellite never runs
it: schedules live centrally and a satellite only consumes the jobs they create.

Two settings govern the rest, both in the `polling` section of the settings row:

| Setting | Default | What it does |
|---|---|---|
| `defaultInterval` | `PT8H` | Used by any item whose own interval is null. ISO 8601 |
| `pollCap` | 50 | Most new listings one routine poll will take |
| `backfillCap` | 200 | Most one backfill or "Scan current listings" will take |

A run that stops at the cap does not lose the rest. Marketplaces page newest-first, so it takes the
newest N, advances the watermark and records the window it skipped; the next runs search that
window and walk it backwards until it is empty. A plan's *first* run is the exception — it has no
watermark, so its window is the whole history of the query, and sweeping that is what the backfill
setting is for, not a routine poll.

What each plan is doing is in `search_plan_state`, until P1-14 puts it on the item page:

```sh
docker compose exec db psql -U goodies_beacon -c \
  'select plan_id, source, watermark, last_success_at, last_error, candidates_found
     from search_plan_state order by last_run_at desc nulls last'
```

`last_error` with a `last_success_at` still set is a plan that is failing now and was working
before — pg-boss retries it three times with a widening gap. An empty `last_error` and a recent
`last_success_at` is a healthy plan. A `backlog_until` that is not null means the plan is still
draining a window an earlier capped run skipped, and will keep doing so until it is.

## Liveness

A `heartbeat.<role>` job runs every five minutes and updates `process_heartbeat.last_seen_at` for
that role. A `last_seen_at` older than about ten minutes means no process is answering for that
role — not that a job failed, because each process subscribes only to its own role's queue. The
dashboard surfaces this in P1-16; until then:

```sh
docker compose exec db psql -U goodies_beacon -c 'select * from process_heartbeat'
```

## Health and logs

`/healthz` needs no session and reports what is running:

```json
{ "status": "ok", "version": "v0.1.0", "sha": "9f2c1ab", "db": "ok" }
```

`version` and `sha` are baked into the image at build time as `GOODIES_BEACON_BUILD_VERSION` and
`GOODIES_BEACON_BUILD_SHA`, so they say what is *actually* running rather than what the compose
file asks for. Never put those two names in `.env`: compose loads the whole file into the
container, and a value there overrides the image's. `version` is the image tag as published — a release's
own tag name (`v0.1.0`), or `dev`, `edge` or `sha-<short sha>` for a branch build. A database that cannot be reached — or that accepts the
connection and never answers — makes it `503` with `"db": "unreachable"` within about two seconds,
so the deploy script and any monitor can act on the status code and never hang.

Logs are JSON lines on stdout (`docker compose logs -f app`), one per request plus whatever the
request itself logged, all carrying the same `requestId`. Every response repeats it in
`X-Request-Id`, so a 500 a user reports can be found directly:

```sh
docker compose logs app | grep <request id>
```

`LOG_LEVEL` takes pino's levels: `fatal`, `error`, `warn`, `info` (the default), `debug`, `trace`,
`silent`. Docker keeps five files of 10 MB per service (`x-logging` in `docker-compose.yml`), so
`docker compose logs` reaches back roughly 50 MB per service and a chatty month cannot fill the
disk.

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
and the notification address.

**Which provider.** Do not run your own relay on a droplet: its IP has no reputation and Gmail and
Outlook will refuse or junk what it sends. The app sends a handful of messages a day to one
address, which every transactional provider's free tier covers. Resend, Brevo and Postmark all
work with the form as it is once your domain is verified with them — for Resend that is
`smtp.resend.com`, username `resend`, an API key as the password, and a from address on the
verified domain. A Gmail app password (`smtp.gmail.com`, 587, STARTTLS, your address as username)
is the quickest if you have a Google account and no domain. The password is encrypted with `GOODIES_BEACON_SECRET_KEY` before it
is stored, and the API never sends it back — the page is told only whether one is set, which is why
saving the section without retyping it keeps it.

**Send test email** mails the notification address and nothing else; the endpoint takes no address,
so a session cannot be used to make the instance mail a stranger. On success it says where it went.
On failure it shows what the mail server actually said — `550 5.7.1 Relaying denied` rather than
"sending failed" — which is usually enough to fix it.

**"Connection timeout" on a droplet.** DigitalOcean blocks outbound SMTP on ports 25, 465 and
587 for newer accounts, whatever the cloud firewall allows, so the usual ports never answer. Most
providers listen on an alternative for this reason — Resend on 2587 (STARTTLS) and 2465 (TLS) —
and switching the port is the whole fix; a support ticket to lift the block is the alternative.
Check from the droplet with `nc -zv -w 5 smtp.example.com 587` and again with the alternative port.

Changing `GOODIES_BEACON_SECRET_KEY` makes the stored SMTP password undecryptable. Nothing silently
sends with the wrong credentials: the test send and every notification fail loudly instead. Enter
the password again to recover. The same key also wraps the seller salt — see *Rotating the secret
key* below, which is the one thing a rotation cannot simply re-enter.

In development, mail goes to [Mailpit](https://mailpit.axllent.org) with its inbox at
`localhost:8025`, started by `compose.dev.yml`.

## eBay

Settings → Sources takes a **production** keyset from
[developer.ebay.com](https://developer.ebay.com) → Application Keys: the App ID (Client ID) and
the Cert ID beside it. A production Cert ID starts `PRD-`; one starting `SBX-` is the sandbox
keyset, whose catalogue is empty for anything you would actually want.

A new production keyset arrives **disabled**. eBay requires every application either to subscribe
to Marketplace Account Deletion notifications or to claim the exemption for not persisting eBay
user data. Goodies Beacon stores none — seller identity is reduced to a keyed hash at ingest and
the seller block is dropped before anything is written — so the exemption applies: on the Event
Notification Delivery Method page, turn on *Not persisting eBay data*. The keyset activates
immediately.

**Test** runs the adapter's own health check and reports the remaining daily quota, which is
5,000 Browse calls. Polling uses a tiny fraction of that: a plan polled three times a day costs
three search calls plus one per listing that reaches enrichment.

The **proxy URL** is optional and eBay does not need one. It is there for the scraped sources,
which are judged on where the request comes from; when set it applies to both the HTTP client and
the browser, and the Test button reports the address requests leave from.

## Exchange rates

Prices are compared in GBP, so anything listed in another currency is converted. Rates come from
the European Central Bank via [frankfurter.dev](https://frankfurter.dev), need no key, and are
refreshed by a job that runs twice a day; each listing records which day's rate was used.

The ECB publishes on working days only, so a listing seen on a Sunday is converted at Friday's
rate and says so. If the service is unreachable the newest stored rate keeps being used and a
warning appears in the log — a price at last week's rate is more useful than no price — so a
sustained outage shows up as `using an exchange rate that has not been refreshed recently` rather
than as a failed poll.

## AI

Three roles are configured independently, each as `provider:model` in Settings:

| Role | What it does | Default |
|---|---|---|
| `interviewer` | Builds and amends specs in chat | `anthropic:claude-opus-5` |
| `prefilter` | Reads every new listing, cheaply | `google:gemini-3.5-flash-lite` |
| `reviewer` | Looks at the photos and judges | `openai:gpt-5-mini` |

Providers are Anthropic, OpenAI, Google, OpenRouter and Ollama. A key goes in Settings, where it
is stored encrypted and never sent back to the browser, or in `.env` — Settings wins when both are
set, and a provider with a key in `.env` shows as configured with an empty box. The Test button
beside each makes the smallest real call the provider will take, using the model a role is
actually set to: a key can be valid and still have no access to the model someone typed, and that
is the failure worth catching before the first review rather than during it.

Ollama is a base URL rather than a key. Its OpenAI-compatible endpoint lives under `/v1`, which is
appended if you leave it off. A local model is free, and is recorded as costing nothing rather
than as costing an unknown amount.

### The pre-filter

Every new listing meets the pre-filter before anything expensive happens: a text-only pass on the
cheapest configured model that decides whether the listing could plausibly be the thing at all. It
is meant to discard most of a broad query's results for a few hundredths of a cent each.

It is deliberately reluctant to discard, and it **fails open** — if the model cannot be reached, or
answers something that will not parse, the listing is kept and the log says so:

```sh
docker compose logs app | grep 'keeping the listing for review'
```

A run of those means reviews are costing more than they should and a provider needs looking at; it
does not mean anything has been lost. The reverse — a listing wrongly discarded — is the failure
worth worrying about, because nothing reports it. If you find the pre-filter throwing away things
it should not, the fix is the item's **plausibility note**: a sentence about how sellers actually
title the thing does more than any change to the criteria. The Carmageddon example spec has one.

To check a model before pointing the instance at it:

```sh
pnpm --filter @goodies-beacon/ai prefilter-check
pnpm --filter @goodies-beacon/ai prefilter-check -- --model google:gemini-3.1-flash-lite
pnpm --filter @goodies-beacon/ai prefilter-check -- --rpm 600   # paid key, run it fast
```

That runs the fixture cases against a real model and reports wrong discards and wrong keeps
separately. A full run is roughly 16,000 input tokens: about a tenth of a penny on a
cheapest-tier model, and under 1.5p on anything you would sensibly put in this role. It is paced
at twelve requests a minute so it does not trip a free tier's limit, which takes about a minute
and a half; `--rpm` raises that.

Anything with a **wrong discard** is not fit for this role whatever its total, because that is the
mistake nothing reports — and that is not a hypothetical. Measured over twelve runs on 17 September
2026, **GPT-5 nano discarded a water-damaged but genuine big box in four of them**, always the same
listing, reasoning that a missing manual made it "not the complete big-box set". It is not fit for
this role and is no longer the default. Gemini 3.5 Flash-Lite went eight runs without doing it and
GPT-5 mini two, at 19/19; Gemini 3.1 Flash-Lite scored 19/19 on 15 September 2026.

A single clean run proves very little here. Run any candidate model several times before trusting
it: two of these three looked identical after one run.

**If every case comes back "could not be run", check the output ceiling before the prompt.** A
reasoning model is charged for its hidden reasoning against the same `maxOutputTokens` as its
answer, so a ceiling sized for one short sentence leaves it nothing to answer with, and it returns
an empty response that fails the schema. That is what the pre-filter's 200-token ceiling did to
GPT-5 nano until 17 September 2026 — silently, because the stage fails open and simply kept
everything. It is 2000 now, which is a ceiling rather than a target: a model that does not reason
still emits its one sentence and costs what it always did.

### The reviewer

The listings the pre-filter kept go to the reviewer: the item's spec, its criteria, its reference
photographs and then the listing's own description and photos. It answers pass, fail or unknown
for each criterion with a line of evidence, writes an English summary of the listing, and says
whether it ships to the UK. It does **not** decide — the rules do that from its answers — and every
verdict shows you each criterion, its evidence, and the exact prompt that produced it.

It is written to say **unknown** rather than guess, and that is the behaviour to watch. A reviewer
that reasons from what is normally included ("big box copies usually have the manual") rather than
from what it can see turns every unknown into a quiet pass, and the unknowns are the thing you
actually wanted told about. If verdicts come back confident about parts of a listing that were
never photographed, the model in this role is the problem, not the spec.

Unlike the pre-filter it **fails loudly**. A review that could not be completed — the model
unreachable, or answering something that will not parse twice running — leaves the candidate in a
visible `failed` state with the error rather than being quietly dropped, and is retried with
backoff. There is no cheaper stage behind it to catch what it missed.

A seller's description is treated as data, never as instructions. If a listing contains text
addressed to an AI asking it to mark everything as a match, the reviewer is told to ignore it and
mention the attempt in the summary.

To check a model before pointing the instance at it:

```sh
pnpm --filter @goodies-beacon/ai reviewer-check
pnpm --filter @goodies-beacon/ai reviewer-check -- --model google:gemini-3.1-flash
pnpm --filter @goodies-beacon/ai reviewer-check -- --rpm 600   # paid key, run it fast
```

That runs the fixture cases against a real model and grades each criterion, the shipping flag and
the summary separately, printing what it expected and what it got. A review is several times the
size of a pre-filter call, so a full run costs a few pence rather than a fraction of one.

It is paced at **four** requests a minute, slower than `prefilter-check`'s twelve, because the free
tiers are per model and the reviewer-tier ones are much tighter than the cheap models: Gemini 3.8
Flash allows five a minute, and a run at ten reports three quarters of its cases as failures of the
model rather than of the rate limit. `--rpm` raises it on a paid key.

There is a **daily** cap as well as a per-minute one — twenty requests a day per model on Google's
free tier — so a free key is good for about two full runs a day, and the third reports every case
as a failure. If a whole run comes back as "could not be run", check the quota before the prompt.

GPT-5 mini and Gemini 3.8 Flash both scored 40/40 checks on 17 September 2026, for about 2p and
4p respectively. Gemini 3.6 Flash scored 41/41 on 15 September 2026 for about 5p. It ignored the fixture
listing that instructs the reviewer to mark everything as a match, and reported that listing's
three genuine failures instead.

When a case disagrees with the model, read the criterion before you blame the prompt. Both misses
on the first full run were the fixture's fault: one asked for a `pass` on a criterion the listing
only half addressed, and one asserted an answer to a criterion that genuinely has two readings for
a partial item. A criterion that bundles two tests — "an all-in-one **with the screen built into
the case**" — cannot be answered cleanly when half the machine is missing, and that is worth fixing
in the spec rather than arguing with the reviewer about.

P1-17 proved that the hard way and it is worth repeating. Two providers disagreed on two criteria;
both attempts to settle it by clarifying the prompt fixed one criterion and broke another, because
the trouble was never the prompt. One criterion said the disc "**looks** free of deep scratches" —
a visual test put to listings with no photographs — and dropping the word settled it on both. The
other bundles three tests and the fixture stopped asserting it. **If a criterion asks two things,
split it**; the reviewer answers what it is asked, and a bundled question has no clean answer.

The fixture cases carry their evidence in the seller's text, because there are no listing
photographs in the repository. They will tell you whether a model reports unknowns honestly,
follows the criteria and translates; they will not tell you how well it reads a photograph, which
is the thing you are mostly paying for. Judge that on your own items with the backfill, before
freezing a spec.

### The prompt evaluation in CI

Both check scripts are also a gate. `.github/workflows/prompt-eval.yml` runs the same fixtures
against **two** providers, because §9's promise is that switching provider is a settings change —
a prompt that works on one and not the other quietly breaks that, and only a run against both
finds it.

It is a separate workflow rather than a step of `ci.yml`, and deliberately so: it calls real
models, and an unrelated typo fix should not pay for two providers' worth of API calls. It runs
when something it judges has changed — the prompts, the two role modules, the fixtures, the
example specs, or the evaluation code — and from the Actions tab on demand, where the budget is an
input.

| Flag | What it does |
|---|---|
| `--model provider:model` | Runs against this model instead of the role's configured one, and puts the setting back afterwards |
| `--rpm n` | Requests per minute. The defaults are free-tier safe: twelve for the pre-filter, four for the reviewer |
| `--budget n` | Dollars this run may spend. Checked **before** each call, and reaching it fails the run |

The budget fails rather than passing early on purpose: the cases it never asked about are not
evidence that the prompt is fine.

**A case can be marked borderline**, which means it is graded and reported but cannot fail the
build. That is for listings with two defensible answers — a joblot in which the wanted item is one
of six, or whether a Japanese "unit only" machine is a complete one — where asserting either
answer measures the model's sampling rather than the prompt. It is not a way to silence an
inconvenient failure: a wrong discard is never borderline, because that is the mistake nothing
else reports. Each marking names the criterion that wants splitting in the spec.

**Both classifier roles ask for `temperature: 0`**, so the same listing is judged the same way as
far as the model allows — which matters beyond the eval, because a re-review is meant to be a
second look rather than a second roll of the dice. It is a request, not a guarantee: OpenAI's
reasoning models refuse the setting and the SDK drops it, and Gemini still varies because thinking
is sampled whatever the temperature says. So a run can still be red on one case and green on the
next. The eval is reporting that, not causing it.

**A provider with no key configured skips, with a notice, and exits zero**, so a fork gets a green
build. That is decided from the credential before anything runs, and it has to be: the pre-filter
fails open by design, so a run with no key would report every listing as plausible, find no wrong
discards, and look exactly like a pass.

The job summary carries a table per role with precision, recall, how many cases ran, how many
could not, and what it spent. For the pre-filter, keeping is the positive class, so **recall is
the number that must be 1.0** — a wrong discard is the mistake nothing else reports. For the
reviewer, both the expected criteria and the model's answers are put through the decision rules
and scored on whether the listing would have reached you, which measures the prompt against the
product's own output rather than against a second opinion about what the rules would say.

Add `OPENAI_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` as repository secrets to turn it on. A
run with the default budget costs a few pence per provider.

### Images in a review

Each reference or grading image costs roughly 1,000–1,500 input tokens *per review*, so they are
the biggest lever on what this costs. The item page shows a running count and nudges at six.
Reference images are downscaled on upload and sent with their labels, so the model knows which
variant each one shows.

Every image in a prompt is one this instance has already fetched, checked and stored — never a URL
handed to the provider to fetch, which would send a marketplace address out of the worker with
none of the ingest's protections.

### The review pipeline

A poll drops each new candidate on the `review.candidate` queue and the worker takes it through
§7 in order: the hard filters, the pre-filter, enrichment, the images, the vision review, the
decision rules, the verdict, the email. Where a candidate got to is on the candidate itself:

```sh
docker compose exec db psql -U goodies_beacon -c \
  "select stage, count(*) from candidates group by stage order by count desc"
```

`failed` is the one to watch, and it carries its own reason rather than hiding in a log:

```sh
docker compose exec db psql -U goodies_beacon -c \
  "select id, error, updated_at from candidates where stage = 'failed' order by updated_at desc limit 20"
```

A failure is retried three times with a widening gap. A candidate still `failed` after that has a
real problem — usually a provider key, a marketplace that changed, or an image host that has gone.
Re-queueing it is safe at any time: a candidate that already has a verdict is a no-op, and one
that failed starts again from the top, which costs a pre-filter call and nothing else.

**Nothing is charged twice for the same review.** A review that succeeded has written its verdict
and will not be repeated however often the job is re-delivered. Reaching the monthly budget defers
a review rather than failing it, so a capped month leaves candidates queued rather than
dead-lettered; they run when the month rolls over or when you raise the cap.

### The real-time email

Phase 1 sends one kind of notification: a plain-text email for a `match` or an `uncertain`, on an
item set to **realtime**, for a candidate that came from a **poll**. A rejection sends nothing, a
digest-mode item sends nothing, and a backfill sends nothing — a backfill sweeps everything
already listed, and mailing it one listing at a time is how someone learns to ignore the mail.
Digests and templates are the notifications phase.

An uncertain email names exactly what could not be established, because that is the whole reason
the verdict exists rather than being quietly dropped.

At most one email is ever sent per candidate, enforced by a unique index rather than by care. The
row is claimed before the email goes, so the failure mode is a *missing* email rather than a
duplicate — deliberately, since a missed match is visible in the UI and a duplicate just teaches
you to stop reading them. A row with no `sent_at` is one that was claimed but never delivered:

```sh
docker compose exec db psql -U goodies_beacon -c \
  "select candidate_id, created_at from notifications where sent_at is null order by created_at desc"
```

That list is normally empty. Entries in it mean SMTP was unreachable when a match came in; the
verdicts are all still there, and an instance with no SMTP configured at all logs it once and
records matches in the UI only.

### What a call costs, and the monthly cap

Every call is recorded in `cost_ledger` with its role, model, tokens and cost. Prices come from a
table in the repo (`packages/ai/src/pricing.ts`) carrying the date it was last checked — **check
that date before trusting a figure**, because providers move their rates and nothing here notices.
A model that is not in the table records its cost as unknown rather than zero and logs
`no price for this model` once per model per process; add it to the table to fix that. OpenRouter
is permanently in that state, because it reprices per underlying model — its own dashboard is the
authority for what you spent there.

```sh
docker compose exec db psql -U goodies_beacon -c \
  "select role, model, sum(cost_usd)::numeric(12,4) as usd, count(*)
     from cost_ledger where created_at >= date_trunc('month', now())
     group by role, model order by usd desc"
```

The **monthly budget** in Settings is in pounds and covers the calendar month in UTC. Reaching it
pauses reviews rather than failing them: each review job is deferred to the first of next month,
so nothing is lost and raising the cap releases them. One `budget_exceeded` event is written for
the month however many jobs meet it:

```sh
docker compose exec db psql -U goodies_beacon -c 'select kind, message, created_at from events'
```

A cap with no exchange rate stored is not enforced — the ledger is in dollars and the cap is in
pounds — and reviews continue with a warning rather than stopping, because a rates outage should
not take the product down. Leave the cap empty for no limit.

## The dashboard

The page you land on, and the fastest way to find out whether anything is wrong.

| Panel | What it tells you |
|---|---|
| Today | Verdicts reached since midnight **in the instance's time zone**, by decision, plus what is still waiting |
| Wanted items | How many are active, paused and draft |
| Sources | Per marketplace: how many active plans it has, when it last polled, and the last error if it is failing |
| AI spend | This calendar month's spend against the monthly cap, and whether reviews are paused |
| Processes | When each role last recorded a heartbeat, and whether that is too long ago |

Every figure is a link to the page that explains it, so a number is never something you have to
take on trust: today's uncertains open the audit view filtered to them, a failing source opens the
item whose plan is failing, and the spend opens the AI section of Settings.

**A failing source is on the page, not in the log.** The row turns red and carries the adapter's
own error, the date it was last working — "failing since", because that is the thing worth acting
on — and a link to the item that owns the failing plan. A source with plans but no poll yet reads
"never polled" rather than being absent, and a source stays listed once it has polled even if its
item is later paused: its last error is still the last thing that happened.

**Processes** reads `process_heartbeat`, which each role updates every five minutes; anything more
than ten minutes old is reported as not responding. On a single-container `ROLE=all` install both
roles report; on a split deployment a missing `worker` means the remote worker is down, which is
not something the core can tell you any other way.

## Wanted items

A wanted item is a title, a status and a **spec**: what you are hunting for, the marketplaces and
queries to look on, and the criteria the reviewer judges each listing against. Until the chat
interviewer arrives in Phase 3 the spec is JSON you write yourself, on **Wanted items → New wanted
item**. It is checked against the real schema as you type, so a mistake names the field it is in
(`criteria.0.text`, `settings.priceCeiling.currency`) and the Save button stays disabled until it
parses. Two worked examples to copy from are in the repository, at
`packages/core/src/domain/fixtures/`.

Beneath the errors sit **warnings**, which do not stop a save. There is one so far: a criterion
that is `hard` but not `quantifiable`. `hard` rejects outright, so a criterion the photos cannot
settle definitively rejects a listing on a blurry image as readily as on a real fault, where `soft`
would surface it as uncertain instead. It is legal, just rarely what was meant.

**Only an `active` item is polled.** A new one starts as a draft, which is the safe default: it
keeps its spec and its search plans and does nothing at all until you set it active. `paused`,
`found` and `archived` are all equally quiet. **Start polling** and **Pause polling** on the item
page move it between active and paused; the schedule follows within the minute, because
`schedules.reconcile` reads the status rather than being told. Pausing writes no spec version —
status says whether the instance is looking, not what it is looking for.

**Saving never edits a spec.** Each save writes the next version and points the item at it, so the
version a verdict was judged under is still there to read — that is what makes "why did it reject
this in July" answerable. The version history on the item page lists them with their change notes;
the side-by-side diff between two of them comes with the interviewer.

### The item page

Everything one item is doing. The spec is rendered as a card rather than as JSON — the settings as
the bounded values they are, every criterion in plain English with its hard/soft, quantifiable and
on-unknown flags, and the reference images under the labels the reviewer is shown — with **Edit the
spec** beside it for the JSON editor. Above it are the counts: candidates found for this item, how
many matched, how many are uncertain, how many were rejected, and how many are still waiting to be
judged.

Then the **search plans**, one row per query, which is where "search broad, judge narrow" is
audited:

| Column | What it means |
|---|---|
| Found | New listings this query has turned into candidates |
| Reviewed | How many of those reached the vision model — the stage that costs real money |
| Matched / Uncertain | What the decision rules made of the ones that did |
| Pre-filter | What the cheap stage has cost this query in total, in cents until it reaches a dollar |
| Last run | When the query last polled, whether it succeeded or not |

These are running totals that outlive retention, so they answer "has this query ever earned its
keep" rather than "what is in the database today" — which is what the counts above are for. A row
in red is a plan whose last run failed, with the error and the date it was last working, so a
break reads as "failing since Tuesday" rather than only "failed". A plan you take out of the spec
keeps its stats and is shown as removed, because the candidates it found are still here.

**Scan current listings** is on the page and disabled: the on-demand sweep, its rate limit and its
summary email are Phase 5.

Four settings live in the spec *and* on the item row, because they are one field on screen:
`notificationMode`, `pollEvery`, `gradingScaleId` and `minimumGrade`. The document is what you
edit; saving copies them onto the row, which is what the scheduler and the review pipeline
actually read. Changing them in the database by hand will therefore be undone by the next save.

**Reference images** are uploaded from the same page with a label, downscaled, and appended to the
spec's `referenceImages`. The label is not decoration: the reviewer is shown it beside the
photograph so it knows which variant it is looking at, so "UK big box, front" earns its keep and
"image1" does not. Each image costs roughly 1,000–1,500 input tokens on *every* review of that
item, so a handful is plenty.

## Candidates and verdicts

Every listing a wanted item has been given is a **candidate**, and all of them are on
**Candidates** — matches, uncertains and rejections alike. That is the point rather than an
oversight: the thing worth checking is not what Goodies Beacon emailed you, it is what it threw
away. Filter by verdict and by origin; the filters live in the URL, so a view can be bookmarked,
and the counts on an item page link straight into the one they count.

| Verdict | What it means |
|---|---|
| Match | Every criterion the reviewer could settle, it settled in the listing's favour |
| Uncertain | Something could not be established, or a soft criterion failed — the email says which |
| Rejected | A hard criterion failed, or a filter stopped it before a model was ever called |
| Not yet judged | Found, and still in the queue or part-way through the pipeline |

A rejection made before the reviewer says which filter did it — over the price ceiling, a negative
keyword in the title, or discarded by the pre-filter — and those cost nothing, so the verdict's
model columns are empty rather than pretending a model was consulted.

Opening one shows the photographs, the English summary, the seller's description and the verdict
in full: a pass, fail or unknown for every criterion with a line of evidence for each, and beneath
them the reasons the rules reached the decision they did. **Show prompt** reveals the exact text
the model was sent and the exact images, in order — read back from the verdict, not rebuilt, so it
is what was sent on the day rather than what would be sent today.

**Retain** keeps a candidate for good. Without it, candidates older than the retention period
(thirty days by default) are deleted with their photographs once the nightly sweep exists — that
job arrives in Phase 2, so nothing is being deleted yet and the toggle is what will spare it. The
**Not a match** and **Challenge** buttons are visible and disabled — the re-review-and-fold-back
loop is Phase 5.

Descriptions are stored as **text**, not as the seller's HTML. eBay returns a full HTML document,
and keeping it would put a stranger's markup in the database, in every dump and on the page; it is
reduced to text at ingest, which also stops the reviewer's prompt budget being spent on font tags.
A description stored before that existed is still rendered as text and cannot do anything but be
read.

The candidate page is the one the digest emails will link to, so it is built to be read on a
phone: one column, no tables, and a gallery that scrolls sideways rather than widening the page.

## The web app

The pages are Dashboard, Wanted items (list, item and spec editor), Wish list, Candidates (list
and one candidate), Settings and the login/first-run page; the rest of the left-hand navigation is there
but disabled, labelled with the task that brings it. Settings holds
account (change your password), email (SMTP), sources (the eBay keyset and a proxy), AI (roles,
provider keys and the budget cap) and instance (time zone, digest time) sections. Dark and light
follow the operating system — there is no toggle, and so no stored preference to get out of step
with it.

## What serves what

In production the API container serves both the JSON API and the built web app: anything that is
not `/api/*` or `/healthz` is answered from `apps/web/dist`, falling back to `index.html` so a deep
link like `/settings` survives a refresh. An unknown `/api` path answers a JSON 404 rather than the
page, so a typo in a URL is not mistaken for a working endpoint.

`docs/API.md` lists every endpoint with whether it needs a session and whether it needs a CSRF
token. It is generated from the route table by `pnpm docs:api`, and CI fails if it is out of date.

**Rehearsing against a running instance.** The Playwright smoke test — first run, sign out, sign
in, a deep-link refresh, saving a setting, entering a wanted item — can be pointed at any instance,
which is a quick way to prove a deploy actually works:

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
