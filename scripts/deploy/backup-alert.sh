#!/usr/bin/env bash
# OnFailure= handler for the backup services (docker/deploy/systemd). Takes
# the failed unit's name (systemd passes it as the templated instance, %i,
# already escaped) and makes the failure visible two ways: an err-priority
# journal entry, so `journalctl -p err` or any journal-watching monitor
# catches it even if nobody is looking right after it happens, and an
# optional webhook POST if ALERT_WEBHOOK_URL is set in the environment. The
# webhook URL itself is read from the environment and never echoed.
#
# Deliberately self-contained (no `. ./lib.sh`): every other script under
# scripts/deploy/ ships and runs from inside a stack's release directory,
# alongside lib.sh, but this one is installed once, globally, to
# /usr/local/bin (docs/deploy.md) precisely so one alert path survives any
# single stack's release lifecycle -- sourcing a sibling lib.sh it is never
# actually deployed with was a bug, not a convenience.
#
# Usage: backup-alert.sh UNIT_NAME
set -euo pipefail

log() {
	printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

unit="${1:-unknown-unit}"
message="canonry backup unit failed: $unit (host $(hostname -f 2>/dev/null || hostname))"

if command -v systemd-cat >/dev/null 2>&1; then
	printf '%s\n' "$message" | systemd-cat -p err -t canonry-backup-alert
else
	log "$message"
fi

if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
	curl -fsS --max-time 10 -X POST "$ALERT_WEBHOOK_URL" \
		-H 'Content-Type: application/json' \
		-d "$(jq -n --arg text "$message" '{text: $text}')" \
		>/dev/null || log "alert webhook POST failed (unit still recorded in the journal)"
fi
