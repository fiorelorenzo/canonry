#!/usr/bin/env bash
# Restores every collection recorded in a backup-qdrant.sh run directory into
# the given Qdrant instance via the snapshot upload API, then compares each
# restored collection's points_count against the manifest captured at backup
# time. Used both for real disaster recovery (--url pointing at the live
# stack after data loss) and for the restore rehearsal SPEC.md #12 and
# AGENTS.md require ("a backup nobody has restored is not a backup"): point
# --url at a scratch Qdrant container started on some other port and nothing
# on the real stack is touched.
#
# Usage:
#   restore-qdrant.sh --url http://127.0.0.1:PORT --backup-dir RUN_DIR [--collections a,b]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
. ./lib.sh

url="" backup_dir="" only=""

while [ $# -gt 0 ]; do
	case "$1" in
	--url)
		url="$2"
		shift 2
		;;
	--backup-dir)
		backup_dir="$2"
		shift 2
		;;
	--collections)
		only="$2"
		shift 2
		;;
	*) die "unknown argument: $1" ;;
	esac
done

require_env url backup_dir
require_cmd curl jq
url="${url%/}"
manifest="$backup_dir/manifest.json"
[ -f "$manifest" ] || die "no manifest.json under $backup_dir -- not a backup-qdrant.sh run directory"

mapfile -t names < <(jq -r '.collections | keys[]' "$manifest")
if [ -n "$only" ]; then
	IFS=',' read -r -a names <<<"$only"
fi

[ "${#names[@]}" -gt 0 ] || die "no collections to restore"

all_ok=1
for name in "${names[@]}"; do
	snapshot=$(jq -r --arg n "$name" '.collections[$n].snapshot // empty' "$manifest")
	expected_points=$(jq -r --arg n "$name" '.collections[$n].points_count // empty' "$manifest")
	[ -n "$snapshot" ] || die "manifest has no entry for collection $name"
	snapshot_path="$backup_dir/$snapshot"
	[ -f "$snapshot_path" ] || die "snapshot file missing: $snapshot_path"

	log "restoring $name from $snapshot_path into $url"
	if ! curl -fsS -X POST "$url/collections/$name/snapshots/upload?priority=snapshot" \
		-H "Content-Type: multipart/form-data" -F "snapshot=@${snapshot_path}" | jq -e '.result == true' >/dev/null; then
		log "FAIL  $name: restore request did not report success"
		all_ok=0
		continue
	fi

	actual_points=$(curl -fsS "$url/collections/$name" | jq -r '.result.points_count // 0')
	if [ "$actual_points" = "$expected_points" ]; then
		log "OK    $name: points_count=$actual_points matches manifest"
	else
		log "FAIL  $name: points_count=$actual_points, manifest recorded $expected_points"
		all_ok=0
	fi
done

if [ "$all_ok" -eq 1 ]; then
	log "restore verification PASSED for ${#names[@]} collection(s)"
	exit 0
fi
die "restore verification FAILED, see per-collection results above"
