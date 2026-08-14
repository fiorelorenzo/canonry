#!/usr/bin/env bash
# Refuses a tag whose CI run for that exact commit is not a completed
# success (SPEC.md #12). Looks up every run of the named workflow for the
# given commit sha and evaluates the most recent one -- a commit can have
# more than one run if CI was re-triggered, and only the latest attempt
# should count.
#
# Usage:
#   verify-ci.sh --repo OWNER/NAME --sha SHA [--workflow ci.yml]
#
# --stdin reads the `gh api .../runs` JSON from stdin instead of calling gh,
# for offline testing of the evaluation logic against a fixture.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
. ./lib.sh

repo="" sha="" workflow="ci.yml" use_stdin=0

while [ $# -gt 0 ]; do
	case "$1" in
	--repo)
		repo="$2"
		shift 2
		;;
	--sha)
		sha="$2"
		shift 2
		;;
	--workflow)
		workflow="$2"
		shift 2
		;;
	--stdin)
		use_stdin=1
		shift
		;;
	*) die "unknown argument: $1" ;;
	esac
done

require_env sha
require_cmd jq

if [ "$use_stdin" -eq 1 ]; then
	runs_json=$(cat)
else
	require_env repo
	require_cmd gh
	runs_json=$(gh api "repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100")
fi

best=$(printf '%s' "$runs_json" | jq -c '(.workflow_runs // []) | sort_by(.created_at) | last')

if [ "$best" = "null" ] || [ -z "$best" ]; then
	die "no run of $workflow found for commit $sha -- push to main and let CI finish before tagging"
fi

status=$(printf '%s' "$best" | jq -r '.status')
conclusion=$(printf '%s' "$best" | jq -r '.conclusion')
url=$(printf '%s' "$best" | jq -r '.html_url')

if [ "$status" != "completed" ] || [ "$conclusion" != "success" ]; then
	die "most recent $workflow run for $sha is not a completed success (status=$status conclusion=$conclusion): $url"
fi

log "CI run for $sha is a completed success: $url"
