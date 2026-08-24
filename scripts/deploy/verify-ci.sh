#!/usr/bin/env bash
# Refuses to deploy a commit whose CI has not verified it (SPEC.md #12).
#
# The question this answers is about the *commit*, not about a run, and that
# distinction is the whole point of this script. It used to sort every run of
# the workflow for the sha by `created_at`, take the last one and judge that,
# which made the verdict depend on the moment it was asked: on 2026-08-24 the
# commit e157a12 had two `push` runs of ci.yml twelve seconds apart, and the
# preview deploy that fired when the first one went green read the second one,
# found it `in_progress`, and refused (issue #712). It was right about that run
# and wrong about the commit. A gate whose answer changes while nothing about
# the tree changes is not a gate.
#
# So the verdict is a property of the whole set of runs for that exact sha, and
# every run is classified into one of four buckets:
#
#   success  completed with conclusion `success`: the whole suite ran green on
#            exactly this tree. This is the only positive evidence there is.
#   failed   `failure`, `timed_out` or `startup_failure`: evidence the tree did
#            not pass.
#   pending  any status other than `completed`: queued, in_progress, waiting.
#            No verdict yet, but there will be one.
#   moot     `cancelled`, `skipped`, `stale`, `neutral`, `action_required`: a
#            run that was stopped or never really ran. It is evidence of
#            nothing and it never decides anything. This bucket is load-bearing
#            rather than pedantic: ci.yml now carries a concurrency group keyed
#            on the sha (also #712), so the normal shape of a duplicated
#            delivery is one cancelled run next to one green one, and a gate
#            that read `cancelled` as failure would refuse every release after
#            one of those.
#
# Two callers want different strictness, and `--require` is where they say so:
#
#   --require any  at least one run for this sha is `success`. Nothing else
#                  matters. This is the preview path, where the trigger already
#                  *is* a completed successful CI run: the commit demonstrably
#                  has a green suite, a second run still going says nothing new,
#                  and refusing would only delay showing `main` on preview.
#   --require all  at least one `success`, no `failed`, and nothing `pending`.
#                  This is the tag path. A release is the one place AGENTS.md
#                  promises the refusal means something, so a tree that both
#                  passed and failed is a flake or an infra fault and gets a
#                  human rather than a guess, and a run still going could still
#                  become that failure.
#
# `--wait SECONDS` is what `all` does about `pending` instead of refusing on the
# spot, and the choice is deliberate. Refusing is simpler and asks a human to
# re-run the deploy in nine minutes; waiting can hang a release on a stuck job.
# Waiting wins because it strictly dominates: a bounded wait can only turn a
# refusal into a success, never the other way round, and when the run it waited
# for does fail the refusal it prints names that failure instead of naming a
# race. The bound is what keeps the bad case bounded -- deploy.yml passes 900s,
# comfortably over the ~9 minutes ci.yml takes today -- and a stuck job then
# costs fifteen minutes and the same refusal it would have printed immediately.
# `any` never waits, because nothing it cares about can change by waiting.
#
# When `all` does refuse for a `failed` run that was a flake, the fix is to
# re-run that run rather than to re-tag: the API reports a run's latest attempt,
# so a green re-run replaces the failure in this set.
#
# Usage:
#   verify-ci.sh --repo OWNER/NAME --sha SHA [--workflow ci.yml]
#                [--require any|all] [--wait SECONDS] [--poll SECONDS]
#
# --stdin reads the `gh api .../runs` JSON from stdin instead of calling gh, so
# the decision can be tested offline against recorded payloads (see
# test-verify-ci.sh). Stdin is read as one compact JSON document per line, one
# per poll, which is how the wait loop gets tested too; the last line is reused
# once they run out.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
. ./lib.sh

repo="" sha="" workflow="ci.yml" require="any" wait_seconds=0 poll_seconds=30 use_stdin=0

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
	--require)
		require="$2"
		shift 2
		;;
	--wait)
		wait_seconds="$2"
		shift 2
		;;
	--poll)
		poll_seconds="$2"
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

case "$require" in
any | all) ;;
*) die "--require takes 'any' or 'all', not '$require'" ;;
esac

if [ "$use_stdin" -eq 1 ]; then
	mapfile -t stdin_polls
	[ "${#stdin_polls[@]}" -gt 0 ] || die "--stdin got no input"
	stdin_next=0
else
	require_env repo
	require_cmd gh
fi

# Sets `runs_json`, and is called plainly rather than in a pipeline or a command
# substitution on purpose: `--stdin` has to advance its position, and a function
# whose state lives in a subshell would hand every poll the same answer, which is
# a wait loop that can only time out.
#
# One page of 100 is every run any commit here has ever had (the record is two),
# and paginating would mean merging JSON documents for a case that does not
# exist. If a sha ever does exceed it, `--require all` would stop seeing the
# oldest runs, so this stays a deliberate ceiling rather than an oversight.
read_runs() {
	if [ "$use_stdin" -eq 1 ]; then
		local i="$stdin_next"
		[ "$i" -lt "${#stdin_polls[@]}" ] || i=$((${#stdin_polls[@]} - 1))
		stdin_next=$((stdin_next + 1))
		runs_json="${stdin_polls[$i]}"
		return
	fi
	runs_json=$(gh api "repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100")
}

# stdin: a `gh api .../runs` response. stdout: eight lines -- the four bucket
# counts, the total, and the newest run in each of the three deciding buckets so
# a refusal can point a human at something.
summarise_runs() {
	jq -r '
		def bucket:
			if .status != "completed" then "pending"
			elif .conclusion == "success" then "success"
			elif (.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "startup_failure") then "failed"
			else "moot"
			end;
		def newest_url($b): ([.[] | select(.bucket == $b)] | sort_by(.created_at) | last | .html_url) // "";
		[(.workflow_runs // [])[] | {status, conclusion, created_at, html_url, bucket: bucket}]
		| [
			length,
			([.[] | select(.bucket == "success")] | length),
			([.[] | select(.bucket == "failed")] | length),
			([.[] | select(.bucket == "pending")] | length),
			([.[] | select(.bucket == "moot")] | length),
			newest_url("success"),
			newest_url("failed"),
			newest_url("pending")
		]
		| .[] | tostring
	'
}

deadline=$(($(date +%s) + wait_seconds))

while :; do
	read_runs
	mapfile -t counts < <(printf '%s' "$runs_json" | summarise_runs)
	[ "${#counts[@]}" -eq 8 ] || die "could not read the run list for $sha"
	n_total=${counts[0]} n_success=${counts[1]} n_failed=${counts[2]} n_pending=${counts[3]}
	n_moot=${counts[4]} url_success=${counts[5]} url_failed=${counts[6]} url_pending=${counts[7]}

	if [ "$n_total" -eq 0 ]; then
		die "no run of $workflow found for commit $sha -- push to main and let CI finish before tagging"
	fi

	# Read in this order on purpose: a failure is a verdict about the tree and
	# waiting cannot improve it, so it outranks anything still running.
	if [ "$require" = all ] && [ "$n_failed" -gt 0 ]; then
		die "a $workflow run for $sha did not pass, so this commit is not releasable" \
			"($n_failed failed, $n_success succeeded): $url_failed"
	fi

	if [ "$n_success" -gt 0 ] && { [ "$require" = any ] || [ "$n_pending" -eq 0 ]; }; then
		log "CI verifies $sha ($n_success success, $n_failed failed, $n_pending pending, $n_moot without a verdict): $url_success"
		exit 0
	fi

	if [ "$n_pending" -gt 0 ] && [ "$(date +%s)" -lt "$deadline" ]; then
		log "waiting for $n_pending $workflow run(s) still going for $sha, up to $((deadline - $(date +%s)))s more: $url_pending"
		sleep "$poll_seconds"
		continue
	fi

	if [ "$n_success" -eq 0 ] && [ "$n_pending" -eq 0 ]; then
		die "no $workflow run for $sha concluded success" \
			"($n_failed failed, $n_moot without a verdict) -- re-run CI for this commit"
	fi

	die "a $workflow run for $sha is still going, so this commit is not releasable yet" \
		"($n_pending pending, $n_success succeeded): $url_pending"
done
