#!/usr/bin/env bash
#
# Puts a published image on this droplet. Run by the deploy workflows over SSH, and safe to run
# by hand.
#
#   ./deploy.sh v0.2.0
#   ssh deploy@droplet v0.2.0        # the key's forced command runs this script
#
# The key in authorized_keys is restricted to this script (see docs/RUNNING.md), so whatever the
# client asks for arrives in SSH_ORIGINAL_COMMAND rather than being executed. It is a tag name and
# is treated as one — nothing here interpolates it into a shell.
#
# Ordering is what makes a failure survivable: dump first, pull before switching, and put .env
# back if anything after the switch goes wrong. A failed deploy leaves the previous image running.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/goodies-beacon}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/healthz}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

# Docker tags allow rather more than this, but a release tag or a sha- tag is all this ever needs,
# and a narrow rule is what keeps a hostile SSH_ORIGINAL_COMMAND from being interesting.
TAG_PATTERN='^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$1"; }

# Rewritten rather than edited in place: `sed -i` takes a backup suffix on BSD and not on GNU, and
# a deploy script should not care which sed the host happens to have. .env holds the key that
# decrypts the SMTP password, so the replacement is created private and stays that way.
set_version() {
	local tmp
	tmp="$(mktemp "${APP_DIR}/.env.XXXXXX")"
	chmod 600 "$tmp"
	awk -v value="$1" '
		/^GOODIES_BEACON_VERSION=/ { print "GOODIES_BEACON_VERSION=" value; seen = 1; next }
		{ print }
		END { if (!seen) print "GOODIES_BEACON_VERSION=" value }
	' "${APP_DIR}/.env" > "$tmp" && mv "$tmp" "${APP_DIR}/.env"
}
fail() {
	printf '\n\033[31mDeploy failed:\033[0m %s\n' "$1" >&2
	exit 1
}

# The forced command hands us the client's request here; an interactive run passes it as $1.
requested="${1:-${SSH_ORIGINAL_COMMAND:-}}"
[ -n "$requested" ] || fail "no image tag given."

# One word only: SSH_ORIGINAL_COMMAND is whatever the client typed.
read -r tag _rest <<< "$requested"
[ "$tag" = "$requested" ] || fail "expected an image tag on its own, got: $requested"
[[ "$tag" =~ $TAG_PATTERN ]] || fail "not a usable image tag: $tag"

cd "$APP_DIR" || fail "$APP_DIR does not exist."
[ -f .env ] || fail "$APP_DIR/.env does not exist."
[ -f docker-compose.yml ] || fail "$APP_DIR/docker-compose.yml does not exist."

previous="$(sed -n 's/^GOODIES_BEACON_VERSION=//p' .env | head -1)"
log "deploying $tag (currently ${previous:-unset})"

# ------------------------------------------------------------------ 1. dump, before anything
mkdir -p "$BACKUP_DIR"
dump="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
log "dumping the database to $(basename "$dump")"
if ! docker compose exec -T db pg_dump -U "${POSTGRES_USER:-goodies_beacon}" \
	"${POSTGRES_DB:-goodies_beacon}" | gzip > "$dump"; then
	rm -f "$dump"
	fail "could not dump the database; nothing has changed."
fi
log "dumped $(du -h "$dump" | cut -f1)"

# ------------------------------------------------------------------ 2. pull, before switching
# Pulling by digest-free tag into a temporary variable means a tag that does not exist is found
# out here, while .env still names the image that is running.
log "pulling $tag"
if ! GOODIES_BEACON_VERSION="$tag" docker compose pull --quiet app; then
	fail "could not pull $tag; nothing has changed and the previous image is still running."
fi

# ------------------------------------------------------------------ 3. switch and restart
restore_env() {
	if [ -n "$previous" ]; then
		set_version "$previous"
		log "put GOODIES_BEACON_VERSION back to $previous"
	fi
}

set_version "$tag"
log "switched GOODIES_BEACON_VERSION to $tag"

if ! docker compose up -d app; then
	restore_env
	docker compose up -d app || true
	fail "could not start $tag; rolled back to ${previous:-the previous image}."
fi

# ------------------------------------------------------------------ 4. prove it is alive
log "waiting for $HEALTH_URL (up to ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
	if health="$(docker compose exec -T app node -e "
		fetch('$HEALTH_URL')
			.then(async r => { if (!r.ok) process.exit(1); console.log(await r.text()); })
			.catch(() => process.exit(1))
	" 2>/dev/null)"; then
		log "healthy: $health"
		log "deployed $tag"
		exit 0
	fi
	sleep 3
done

log "not healthy within ${HEALTH_TIMEOUT}s; rolling back"
restore_env
docker compose up -d app || true
fail "$tag did not become healthy; rolled back to ${previous:-the previous image}."
