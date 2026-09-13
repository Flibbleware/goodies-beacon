#!/usr/bin/env bash
#
# Nightly `pg_dump` for the `backup` service in docker-compose.yml. Runs a dump at BACKUP_AT every
# day, keeps BACKUP_KEEP_DAYS of them, and says on stdout what it did — so `docker compose logs
# backup` answers "is this working?" without looking at the filesystem.
#
# A container of its own rather than a job inside the app: pg_dump has to match the server's major
# version, which the postgres image gives for free, and a backup that only happens while the
# application is healthy is not much of a backup.
#
#   BACKUP_AT=03:30 BACKUP_KEEP_DAYS=14 ./backup.sh          # the loop the service runs
#   ./backup.sh --once                                        # one dump, then exit

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_AT="${BACKUP_AT:-03:30}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
PGHOST="${PGHOST:-db}"
PGUSER="${PGUSER:-goodies_beacon}"
PGDATABASE="${PGDATABASE:-goodies_beacon}"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"; }

# Every dump is named for the moment it was taken, in UTC, so they sort chronologically and the
# pruning below can read the age off the name if it ever needs to.
dump_once() {
	local file
	file="$BACKUP_DIR/goodies-beacon-$(date -u '+%Y%m%dT%H%M%SZ').sql.gz"

	mkdir -p "$BACKUP_DIR"

	# `public` and `drizzle` only. The pgboss schema is deliberately left out: it holds queued and
	# finished jobs, which are transient — pg-boss rebuilds its own schema on start and the poll
	# schedules are recreated from the wanted items. Including it also made a restore unreadable,
	# because `--clean` cannot drop the inherited constraints on pg-boss's partitioned tables and
	# printed errors an operator could not tell apart from a real failure.
	#
	# Written to a .partial and renamed, so an interrupted dump never looks like a good one — the
	# pruning and any restore only ever see complete files.
	if pg_dump --clean --if-exists --schema=public --schema=drizzle \
		-h "$PGHOST" -U "$PGUSER" "$PGDATABASE" | gzip > "$file.partial"; then
		mv "$file.partial" "$file"
		log "dumped $(basename "$file") ($(du -h "$file" | cut -f1))"
	else
		rm -f "$file.partial"
		log "FAILED to dump $PGDATABASE from $PGHOST"
		return 1
	fi
}

prune() {
	local removed=0
	while IFS= read -r -d '' old; do
		rm -f "$old"
		log "pruned $(basename "$old")"
		removed=$((removed + 1))
	done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'goodies-beacon-*.sql.gz' \
		-mtime "+$BACKUP_KEEP_DAYS" -print0 2>/dev/null)

	# Leftovers from a dump that died mid-write, which nothing else will ever clean up.
	find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz.partial' -mtime +1 -delete 2>/dev/null || true

	local kept
	kept="$(find "$BACKUP_DIR" -maxdepth 1 -name 'goodies-beacon-*.sql.gz' 2>/dev/null | wc -l | tr -d ' ')"
	log "$kept dump(s) kept, $removed pruned (keeping ${BACKUP_KEEP_DAYS} days)"
}

# Seconds from now until the next BACKUP_AT, in UTC. Tomorrow's if today's has passed.
seconds_until_next() {
	local now target
	now="$(date -u +%s)"
	target="$(date -u -d "today $BACKUP_AT" +%s 2>/dev/null || date -u -j -f '%Y-%m-%d %H:%M' "$(date -u +%F) $BACKUP_AT" +%s)"
	[ "$target" -gt "$now" ] || target=$((target + 86400))
	echo $((target - now))
}

if [ "${1:-}" = '--once' ]; then
	dump_once
	prune
	exit 0
fi

[[ "$BACKUP_AT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || {
	log "BACKUP_AT must be a 24-hour time such as 03:30, got: $BACKUP_AT"
	exit 1
}

log "nightly dump of $PGDATABASE at $BACKUP_AT UTC, keeping $BACKUP_KEEP_DAYS days in $BACKUP_DIR"

while true; do
	wait_for="$(seconds_until_next)"
	log "next dump in $((wait_for / 3600))h $(((wait_for % 3600) / 60))m"
	sleep "$wait_for"

	# A failed dump must not stop the loop: tomorrow's attempt may well work, and the log is
	# what carries the failure to whoever is looking.
	dump_once || true
	prune
done
