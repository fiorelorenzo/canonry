#!/usr/bin/env bash
# Backs up every Qdrant collection (issue #98) via the HTTP snapshot API:
# for each collection, POST a snapshot, download the resulting file, then
# DELETE the in-container copy so Qdrant's own disk does not grow unbounded
# -- the downloaded file on the backup volume is the retained copy. Each run
# is one directory of the form OUT_DIR/<timestamp>/, holding one .snapshot
# file per collection plus a manifest.json recording each collection's
# points_count at backup time, which restore-qdrant.sh's rehearsal compares
# against after restoring.
#
# Usage:
#   backup-qdrant.sh --out-dir DIR [--retain-days 14] [--status-dir DIR] \
#     (--url http://127.0.0.1:6333 | --container NAME)
#
# --container resolves the published port itself via `docker port`, so the
# systemd unit needs no secrets file at all to find this stack's Qdrant.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
. ./lib.sh

url="" container="" out_dir="" retain_days=14 status_dir=""

while [ $# -gt 0 ]; do
	case "$1" in
	--url)
		url="$2"
		shift 2
		;;
	--container)
		container="$2"
		shift 2
		;;
	--out-dir)
		out_dir="$2"
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

if [ -z "$url" ]; then
	[ -n "$container" ] || die "pass either --url or --container"
	require_cmd docker
	published=$(docker port "$container" 6333/tcp | head -n1) || die "docker port could not find a published 6333/tcp for container $container"
	url="http://${published}"
fi
require_env url out_dir
require_cmd curl jq date find
url="${url%/}"
status_dir="${status_dir:-$out_dir/../status}"

fail() {
	record_backup_status "$status_dir" "qdrant" false "$1" "null"
	die "$1"
}

started_at=$(date +%s)
collections_json=$(curl -fsS "$url/collections") || fail "could not reach $url/collections"
mapfile -t collections < <(printf '%s' "$collections_json" | jq -r '.result.collections[].name')

ts=$(date -u +%Y%m%dT%H%M%SZ)
run_dir="$out_dir/$ts"
mkdir -p "$run_dir"

manifest="{}"
for name in "${collections[@]}"; do
	log "snapshotting collection $name"
	snap_json=$(curl -fsS -X POST "$url/collections/$name/snapshots") || {
		rm -rf "$run_dir"
		fail "snapshot request failed for collection $name"
	}
	snap_name=$(printf '%s' "$snap_json" | jq -r '.result.name')
	snap_size=$(printf '%s' "$snap_json" | jq -r '.result.size')
	snap_checksum=$(printf '%s' "$snap_json" | jq -r '.result.checksum')
	if [ -z "$snap_name" ] || [ "$snap_name" = "null" ]; then
		rm -rf "$run_dir"
		fail "snapshot response for $name had no name: $snap_json"
	fi

	dest="$run_dir/$name.snapshot"
	if ! curl -fsS -o "$dest" "$url/collections/$name/snapshots/$snap_name"; then
		rm -rf "$run_dir"
		fail "download failed for collection $name snapshot $snap_name"
	fi

	local_size=$(stat -c%s "$dest" 2>/dev/null || echo 0)
	if [ "$local_size" != "$snap_size" ]; then
		rm -rf "$run_dir"
		fail "downloaded snapshot for $name is ${local_size} bytes, server reported ${snap_size}"
	fi

	# The server-side copy is no longer needed once it is safely on the
	# backup volume; leaving it would grow qdrant's own storage forever.
	curl -fsS -X DELETE "$url/collections/$name/snapshots/$snap_name" >/dev/null || log "WARNING: could not delete server-side snapshot $snap_name for $name"

	points_count=$(curl -fsS "$url/collections/$name" | jq -r '.result.points_count // 0')

	manifest=$(printf '%s' "$manifest" | jq \
		--arg name "$name" \
		--arg snapshot "$name.snapshot" \
		--argjson points_count "$points_count" \
		--argjson size_bytes "$local_size" \
		--arg checksum "$snap_checksum" \
		'.[$name] = {snapshot: $snapshot, points_count: $points_count, size_bytes: $size_bytes, checksum: $checksum}')
done

jq -n --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson collections "$manifest" \
	'{created_at: $created_at, collections: $collections}' >"$run_dir/manifest.json"

pruned=0
while IFS= read -r -d '' old; do
	rm -rf "$old"
	pruned=$((pruned + 1))
done < <(find "$out_dir" -mindepth 1 -maxdepth 1 -type d -mtime "+${retain_days}" -print0)

duration=$(($(date +%s) - started_at))
log "backup complete: $run_dir (${#collections[@]} collection(s), ${duration}s), pruned $pruned old run(s)"
record_backup_status "$status_dir" "qdrant" true "backed up ${#collections[@]} collection(s)" \
	"$(jq -n --arg path "$run_dir" --argjson count "${#collections[@]}" --argjson duration "$duration" --argjson pruned "$pruned" \
		'{path: $path, collections: $count, duration_seconds: $duration, pruned: $pruned}')"
