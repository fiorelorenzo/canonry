#!/usr/bin/env bash
# Tests verify-ci.sh's verdict (issue #712).
#
# The bug this locks down is not a crash, it is an answer that changed with the
# clock: the gate sorted every ci.yml run for a sha by `created_at`, judged the
# newest one, and so refused e157a12 at 16:06:38 because a duplicate run was
# still going, twelve seconds before that run went green too. Nothing local
# reproduces the deploy job, so the only honest way to test the fix is to feed
# the script the API's own answers and assert the verdict.
#
# So `fixtures/verify-ci/` holds recordings, not hand-written JSON: each file is
# a real `gh api /actions/workflows/ci.yml/runs?head_sha=...` response, projected
# to the nine fields this script reads and sorted for a readable diff. One field
# in one fixture is not a recording and is marked where it is used: the incident
# fixture puts run 32748082241 back to `in_progress`, because that is the one
# thing the API can no longer tell me -- it completed successfully fourteen
# seconds after the refusal, and the response as it stands today is the *other*
# fixture next to it. Everything else, including the shapes the API has never
# actually produced here (a cancelled duplicate, a contradicting failure), is
# derived from those recordings below with jq, in the open, so the derivation is
# reviewable rather than typed out as fresh JSON.
#
# What this does not cover, said plainly: the `gh api` call itself, and
# therefore the deploy job end to end. Every case here goes in through --stdin.
#
# Usage: scripts/deploy/test-verify-ci.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixtures="$here/fixtures/verify-ci"
verify="$here/verify-ci.sh"

sha=e157a12efada61c73fa2e8f16adab0f8c1b637f7

failures=0

pass() { echo "ok - $*"; }

fail() {
	echo "FAIL: $*" >&2
	failures=$((failures + 1))
}

# expect PASS|REFUSE "what this case is" -- <verify-ci.sh args...>
# Feeds $polls (one compact JSON document per line) to the script and checks the
# exit status. On an unexpected result the captured output is printed, since that
# output is the whole product of the script.
expect() {
	local want="$1" what="$2"
	shift 3 # drop want, what and the -- separator
	local out status=0
	out=$(printf '%s\n' "$polls" | "$verify" --sha "$sha" --stdin --poll 0 "$@" 2>&1) || status=$?
	case "$want" in
	PASS) [ "$status" -eq 0 ] || {
		fail "$what: expected to pass, exited $status"
		printf '%s\n' "$out" >&2
		return
	} ;;
	REFUSE) [ "$status" -ne 0 ] || {
		fail "$what: expected a refusal, exited 0"
		printf '%s\n' "$out" >&2
		return
	} ;;
	esac
	last_output="$out"
	pass "$what"
}

# says PATTERN -- the message a human reads is the point of a refusal, so the
# refusals that have to be distinguishable from each other are checked for the
# words that distinguish them.
says() {
	if printf '%s' "$last_output" | grep -qF -- "$1"; then
		pass "  and says '$1'"
	else
		fail "  expected the output to say '$1', got: $last_output"
	fi
}

# --- the incident itself ---------------------------------------------------
# One green run and one still going. Preview must deploy: the commit has a green
# suite and the trigger for that path is that very run. A tag must not, because
# the run still going could still fail.
polls=$(jq -c . "$fixtures/e157a12-second-in-progress.json")

expect PASS "the incident: preview takes a green run while a duplicate is still going" -- --require any
expect REFUSE "the incident: a tag refuses while a duplicate is still going" -- --require all
says "still going"

# Same fixture, judged as the old script judged it: this is the case that used
# to fail for preview, so it is the one regression worth naming.
polls=$(jq -c . "$fixtures/e157a12-both-green.json")
expect PASS "both duplicates green: preview" -- --require any
expect PASS "both duplicates green: a tag" -- --require all

# --- the ordinary shape ----------------------------------------------------
polls=$(jq -c . "$fixtures/ad70ed8-one-green.json")
expect PASS "one green run: preview" -- --require any
expect PASS "one green run: a tag" -- --require all

polls=$(jq -c . "$fixtures/no-runs.json")
expect REFUSE "no run at all: preview" -- --require any
says "no run of ci.yml found"
expect REFUSE "no run at all: a tag" -- --require all

# --- the shape ci.yml's concurrency group now produces ---------------------
# A duplicated delivery cancels the first run and the second goes green. A
# cancelled run is evidence of nothing, so both callers must deploy: a gate that
# read it as failure would refuse every release after one of these.
polls=$(jq -c '.workflow_runs |= map(if .id == 32748062187 then .conclusion = "cancelled" else . end)' \
	"$fixtures/e157a12-both-green.json")
expect PASS "a cancelled duplicate next to a green run: preview" -- --require any
expect PASS "a cancelled duplicate next to a green run: a tag" -- --require all
says "1 without a verdict"

# --- one tree, two verdicts ------------------------------------------------
# Preview has a green run for the commit and takes it. A tag will not guess
# which of the two the tree really is.
polls=$(jq -c '.workflow_runs |= map(if .id == 32748082241 then .conclusion = "failure" else . end)' \
	"$fixtures/e157a12-both-green.json")
expect PASS "a green run and a failed run: preview" -- --require any
expect REFUSE "a green run and a failed run: a tag" -- --require all
says "did not pass"

# A timeout and a startup failure are failures too, and neither says "failure".
for conclusion in timed_out startup_failure; do
	polls=$(jq -c --arg c "$conclusion" '.workflow_runs |= map(if .id == 32748082241 then .conclusion = $c else . end)' \
		"$fixtures/e157a12-both-green.json")
	expect REFUSE "a green run and a $conclusion run: a tag" -- --require all
done

# Nothing green at all refuses on both paths, and says something more useful
# than "still going".
polls=$(jq -c '.workflow_runs |= map(.conclusion = "failure")' "$fixtures/e157a12-both-green.json")
expect REFUSE "every run failed: preview" -- --require any
says "concluded success"
expect REFUSE "every run failed: a tag" -- --require all
says "did not pass"

# --- waiting ---------------------------------------------------------------
# A tag pushed within CI's ~9 minutes finds a run still going. With no --wait it
# refuses immediately; with one it polls and takes the answer.
one_pending=$(jq -c . "$fixtures/e157a12-second-in-progress.json")
green=$(jq -c . "$fixtures/e157a12-both-green.json")

polls="$one_pending"
expect REFUSE "a tag with no --wait does not wait" -- --require all
says "still going"

polls=$(printf '%s\n%s\n%s' "$one_pending" "$one_pending" "$green")
expect PASS "a tag with --wait polls until the run finishes" -- --require all --wait 60
says "waiting for 1 ci.yml run(s)"

# The bound is the point: a run that never finishes ends in a refusal rather
# than in a hung release. --stdin reuses its last line once the polls run out,
# so this one is pending forever and the deadline is what stops it.
polls="$one_pending"
expect REFUSE "a run that never finishes refuses at the deadline" -- --require all --wait 1 --poll 1
says "still going"

# `any` has nothing to gain by waiting, so it never does: this would hang for
# 600 seconds if it did.
polls="$one_pending"
expect PASS "preview never waits" -- --require any --wait 600

# --- argument handling -----------------------------------------------------
polls="$green"
expect REFUSE "an unknown --require value is refused rather than defaulted" -- --require most
says "--require takes"

if [ "$failures" -ne 0 ]; then
	printf '\n%d check(s) failed.\n' "$failures" >&2
	exit 1
fi

printf '\nverify-ci.sh gives the same verdict for a sha whenever it is asked.\n'
