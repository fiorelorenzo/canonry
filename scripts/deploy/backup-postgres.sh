#!/usr/bin/env bash
# Dumps one Postgres database (issue #98) via `docker exec` into the running
# container -- no postgres client tools needed on the host, since the
# postgres:16 image already carries pg_dump. The container's own
# POSTGRES_PASSWORD is read through `docker exec printenv` rather than
# duplicated into this script's own environment; it is never echoed or
# logged, only held in a shell variable for the docker exec calls that need
# it.
#
# Usage:
#   backup-postgres.sh --container NAME --out-dir DIR \
#     [--db NAME] [--user NAME] [--retain-days 14] [--status-dir DIR]
#
# Exits non-zero and records a failed status on any error, so a systemd
# timer running this shows up in `systemctl --failed` rather than silently
# skipping a night.
set -euo pipefail
# Every file and directory this script creates must be prod-only
# regardless of who invokes it and with what ambient umask: the systemd
# unit also sets UMask=0077, but "take a backup by hand" (docs/deploy.md)
# is a documented, encouraged path too, and relying solely on the caller's
# shell umask left the qdrant sibling script's output at 664/775 on this
# box's default interactive umask (002) the first time it was run by hand.
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
. ./lib.sh

container="" out_dir="" db="" user="" retain_days=14 status_dir=""

while [ $# -gt 0 ]; do
	case "$1" in
	--container)
		container="$2"
		shift 2
		;;
	--out-dir)
		out_dir="$2"
		shift 2
		;;
	--db)
		db="$2"
		shift 2
		;;
	--user)
		user="$2"
		shift 2
		;;
	--retain-days)
		retain_days="$2"
		shift 2
		;;
	--status-dir)
		status_dir="$2"
		shift 2
		;;
	*) die "unknown argument: $1" ;;
	esac
done

require_env container out_dir
require_cmd docker date find

status_dir="${status_dir:-$out_dir/../status}"

fail() {
	record_backup_status "$status_dir" "postgres" false "$1" "null"
	die "$1"
}

docker inspect "$container" >/dev/null 2>&1 || fail "container $container is not running"

[ -n "$db" ] || db=$(docker exec "$container" printenv POSTGRES_DB) || fail "could not read POSTGRES_DB from $container"
[ -n "$user" ] || user=$(docker exec "$container" printenv POSTGRES_USER) || fail "could not read POSTGRES_USER from $container"
pg_password=$(docker exec "$container" printenv POSTGRES_PASSWORD) || fail "could not read POSTGRES_PASSWORD from $container"

mkdir -p "$out_dir"
started_at=$(date +%s)
ts=$(date -u +%Y%m%dT%H%M%SZ)
filename="${db}-${ts}.dump"
container_tmp="/tmp/canonry-pg-backup-${ts}.dump"

log "dumping $db from $container to $filename"
if ! docker exec -e PGPASSWORD="$pg_password" "$container" \
	pg_dump -U "$user" -d "$db" -Fc -f "$container_tmp"; then
	docker exec "$container" rm -f "$container_tmp" >/dev/null 2>&1 || true
	fail "pg_dump failed for $db on $container"
fi

if ! docker cp "$container:$container_tmp" "$out_dir/$filename"; then
	docker exec "$container" rm -f "$container_tmp" >/dev/null 2>&1 || true
	fail "docker cp of the dump out of $container failed"
fi
docker exec "$container" rm -f "$container_tmp" >/dev/null 2>&1 || true
# `docker cp` preserves the source file's mode from inside the container
# (pg_dump's own umask there, typically 644) rather than respecting this
# process's UMask=, so the dump -- a full plaintext copy of the database --
# would otherwise land world-readable regardless of the systemd unit's own
# UMask=0077.
chmod 600 "$out_dir/$filename"

size=$(stat -c%s "$out_dir/$filename" 2>/dev/null || echo 0)
if [ "$size" -lt 1 ]; then
	fail "backup file $out_dir/$filename is empty"
fi

pruned=0
while IFS= read -r -d '' old; do
	rm -f "$old"
	pruned=$((pruned + 1))
done < <(find "$out_dir" -maxdepth 1 -name "${db}-*.dump" -mtime "+${retain_days}" -print0)

duration=$(($(date +%s) - started_at))
log "backup complete: $out_dir/$filename (${size} bytes, ${duration}s), pruned $pruned file(s) older than ${retain_days}d"
record_backup_status "$status_dir" "postgres" true "backed up $db from $container" \
	"$(jq -n --arg path "$out_dir/$filename" --argjson size "$size" --argjson duration "$duration" --argjson pruned "$pruned" \
		'{path: $path, size_bytes: $size, duration_seconds: $duration, pruned: $pruned}')"
