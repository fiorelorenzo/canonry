#!/usr/bin/env bash
# Standalone CLI around lib.sh's poll_health, so the version gate (SPEC.md
# #12: "health gate comparing the served version against the built
# artifact") can be exercised on its own against any /healthz endpoint --
# used by release.sh internally, and directly for local verification against
# a container started by hand on a non-5196 port.
#
# Usage:
#   health-gate.sh --url http://127.0.0.1:PORT/healthz \
#     --version VERSION --commit SHA [--timeout SECONDS] [--interval SECONDS]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
. ./lib.sh

url="" version="" commit="" timeout=60 interval=2

while [ $# -gt 0 ]; do
	case "$1" in
	--url)
		url="$2"
		shift 2
		;;
	--version)
		version="$2"
		shift 2
		;;
	--commit)
		commit="$2"
		shift 2
		;;
	--timeout)
		timeout="$2"
		shift 2
		;;
	--interval)
		interval="$2"
		shift 2
		;;
	*) die "unknown argument: $1" ;;
	esac
done

require_env url version commit
require_cmd curl jq

if poll_health "$url" "$version" "$commit" "$timeout" "$interval"; then
	log "health gate passed: $url serves version=$version commit=$commit"
	exit 0
fi

log "health gate FAILED: $url did not serve version=$version commit=$commit within ${timeout}s"
exit 1
