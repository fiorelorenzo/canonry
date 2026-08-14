#!/usr/bin/env bash
# Keeps the last N releases under BASE/releases and deletes the rest
# (SPEC.md #12: "keep the last 5 releases"). Whatever BASE/current points at
# is always kept even if it falls outside the N most recently created
# releases, which only happens right after a rollback to an older release --
# deleting a release that is live would be a self-inflicted outage.
#
# Usage: prune-releases.sh --base DIR [--keep N]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
. ./lib.sh

base=""
keep=5

while [ $# -gt 0 ]; do
	case "$1" in
	--base)
		base="$2"
		shift 2
		;;
	--keep)
		keep="$2"
		shift 2
		;;
	*) die "unknown argument: $1" ;;
	esac
done

require_env base
[ -d "$base/releases" ] || die "no releases directory under $base"

current="$(current_release "$base" || true)"

# List release directory names oldest-last (mtime desc), one per line.
mapfile -t ordered < <(find "$base/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -rn | cut -d' ' -f2-)

kept=0
for name in "${ordered[@]}"; do
	if [ "$kept" -lt "$keep" ] || [ "$name" = "$current" ]; then
		kept=$((kept + 1))
		continue
	fi
	log "pruning release $name (kept=$kept, keep=$keep, current=$current)"
	dir="$base/releases/$name"
	unlock_release "$dir"
	rm -rf "$dir"
done

log "prune complete: $kept release(s) retained under $base/releases"
