#!/usr/bin/env bash
# Tests the supersede gate (issue #228): release.sh must refuse to deploy a
# commit that is an ancestor of the release already live for a stack, stop
# successfully rather than fail, leave current/DEPLOYED.json/releases
# untouched, and stay out of the way of a normal forward deploy, a redeploy
# of the sha already live, and a rollback.
#
# This is the first test in scripts/deploy/. There was no harness here
# before (see docs/deploy.md's "What was verified here" section -- release,
# rollback and pruning were previously exercised by hand, not from a
# committed script), so this is deliberately plain bash rather than a new
# test framework dependency, matching the style of every other script in
# this directory.
#
# Builds a throwaway git repository with a linear three-commit history
# (old -> live -> new) and a throwaway stack directory standing in for
# /opt/apps/canonry/<stack>, then drives the real release.sh and
# rollback.sh against them with docker and curl stubbed out on PATH, so the
# whole thing runs without a real container, a real network call or a real
# stack. Also exercises is_superseded_deploy directly, since that is the
# decision the rest of this proves release.sh actually acts on.
#
# Usage: scripts/deploy/test-release-supersede.sh
set -euo pipefail
real_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

pass() {
	echo "ok - $*"
}

work="$(mktemp -d)"
# release.sh locks each release directory read-only (lock_release in
# lib.sh), so a plain rm -rf cannot unlink files inside it -- chmod them
# writable again first, the same thing prune-releases.sh does per release.
trap 'chmod -R u+w "$work" 2>/dev/null; rm -rf "$work"' EXIT

# --- a throwaway git repo with a linear old -> live -> new history --------
repo="$work/repo"
mkdir -p "$repo"
git -C "$repo" init -q
git -C "$repo" config user.email test@example.com
git -C "$repo" config user.name "release.sh test"

commit() {
	printf '%s\n' "$1" >"$repo/MARKER"
	git -C "$repo" add MARKER
	git -C "$repo" commit -q -m "$1"
	git -C "$repo" rev-parse HEAD
}

sha_old=$(commit old)
sha_live=$(commit live)
sha_new=$(commit new)

# The scripts under test have to physically live inside this repo's working
# tree: release.sh resolves its own directory from $BASH_SOURCE and runs
# `git merge-base` from there, so it is not enough for the commits above to
# exist somewhere else on disk -- they have to be reachable from wherever
# release.sh itself sits.
mkdir -p "$repo/scripts/deploy"
cp "$real_script_dir/lib.sh" "$real_script_dir/release.sh" "$real_script_dir/rollback.sh" \
	"$real_script_dir/prune-releases.sh" "$repo/scripts/deploy/"
chmod +x "$repo/scripts/deploy/"*.sh

# --- fake docker and curl on PATH ------------------------------------------
# docker: records every invocation so the "touches nothing" case below can
# prove compose was never run, and otherwise always succeeds -- no
# container is ever actually started.
# curl: answers /healthz by reading whatever release `current` points at
# right now, so it always matches what release.sh/rollback.sh just flipped
# to without the test having to track expected values per call.
stub_bin="$work/bin"
mkdir -p "$stub_bin"
docker_log="$work/docker.log"

cat >"$stub_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ -n "${FAKE_DOCKER_LOG:-}" ]; then
	printf '%s\n' "$*" >>"$FAKE_DOCKER_LOG"
fi
exit 0
EOF

cat >"$stub_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
env_file="$FAKE_BASE/current/.env"
version=$(grep -m1 '^APP_VERSION=' "$env_file" | cut -d= -f2-)
commit=$(grep -m1 '^APP_COMMIT=' "$env_file" | cut -d= -f2-)
printf '{"status":"up","version":"%s","commit":"%s"}\n' "$version" "$commit"
EOF

chmod +x "$stub_bin/docker" "$stub_bin/curl"
export PATH="$stub_bin:$PATH"
export FAKE_DOCKER_LOG="$docker_log"

# --- a throwaway stack directory and secrets file --------------------------
stack_base="$work/base"
mkdir -p "$stack_base/shared"
export FAKE_BASE="$stack_base"
printf 'DATABASE_URL=postgres://canonry:canonry@localhost:5432/canonry\n' >"$stack_base/shared/secrets.env"

compose_src="$work/compose.yml"
printf 'services: {}\n' >"$compose_src"

release="$repo/scripts/deploy/release.sh"
rollback="$repo/scripts/deploy/rollback.sh"

deploy() {
	sha="$1"
	version="$2"
	"$release" --stack test --base "$stack_base" --sha "$sha" --version "$version" \
		--image "fake/canonry-web:$version" --compose-src "$compose_src" \
		--secrets-file "$stack_base/shared/secrets.env" --port 19999 --timeout 5 \
		--interval 1 --keep 5 --deployed-by test-harness
}

current_target() {
	readlink "$stack_base/current"
}

deployed_field() {
	jq -r ".$1" "$stack_base/DEPLOYED.json"
}

# --- unit test the decision function directly ------------------------------
(
	cd "$repo/scripts/deploy"
	# shellcheck source=./lib.sh
	. ./lib.sh

	is_superseded_deploy "$sha_new" "$sha_live" && rc=0 || rc=$?
	[ "$rc" -eq 1 ] || fail "is_superseded_deploy: a forward sha was reported as superseded"

	is_superseded_deploy "$sha_old" "$sha_new" && rc=0 || rc=$?
	[ "$rc" -eq 0 ] || fail "is_superseded_deploy: an ancestor sha was not reported as superseded"

	is_superseded_deploy "$sha_new" "$sha_new" && rc=0 || rc=$?
	[ "$rc" -eq 1 ] || fail "is_superseded_deploy: a commit was reported as superseded by itself"

	is_superseded_deploy "$sha_new" "" && rc=0 || rc=$?
	[ "$rc" -eq 1 ] || fail "is_superseded_deploy: an empty live commit was treated as superseding"
)
pass "is_superseded_deploy decides forward/ancestor/self/nothing-live correctly"

# --- 1. a forward deploy establishes what is live --------------------------
deploy_log="$work/deploy-1.log"
deploy "$sha_live" v-live >"$deploy_log" 2>&1 || fail "initial deploy of $sha_live failed: $(cat "$deploy_log")"
[ "$(current_target)" = "releases/$sha_live" ] || fail "current does not point at the first release"
[ "$(deployed_field release)" = "$sha_live" ] || fail "DEPLOYED.json.release is not $sha_live"
pass "a forward deploy establishes the first release ($sha_live)"

# --- 2. a genuine forward deploy proceeds -----------------------------------
deploy_log="$work/deploy-2.log"
deploy "$sha_new" v-new >"$deploy_log" 2>&1 || fail "forward deploy of $sha_new failed: $(cat "$deploy_log")"
[ "$(current_target)" = "releases/$sha_new" ] || fail "current does not point at the forward release"
[ "$(deployed_field release)" = "$sha_new" ] || fail "DEPLOYED.json.release is not $sha_new"
[ "$(deployed_field previous_release)" = "$sha_live" ] || fail "DEPLOYED.json.previous_release is not $sha_live"
pass "a normal forward deploy is unaffected by the supersede gate"

# --- 3. an ancestor deploy stops successfully and touches nothing ----------
before_deployed="$(cat "$stack_base/DEPLOYED.json")"
before_current="$(current_target)"
before_releases="$(find "$stack_base/releases" -mindepth 1 -maxdepth 1 | sort)"
before_docker_calls=$(wc -l <"$docker_log" 2>/dev/null || echo 0)

deploy_log="$work/deploy-ancestor.log"
deploy "$sha_old" v-old >"$deploy_log" 2>&1 || fail "an ancestor deploy of $sha_old was expected to exit 0, log: $(cat "$deploy_log")"
grep -q "$sha_old" "$deploy_log" || fail "supersede log line does not name the incoming sha: $(cat "$deploy_log")"
grep -q "$sha_new" "$deploy_log" || fail "supersede log line does not name the live sha: $(cat "$deploy_log")"

after_deployed="$(cat "$stack_base/DEPLOYED.json")"
after_current="$(current_target)"
after_releases="$(find "$stack_base/releases" -mindepth 1 -maxdepth 1 | sort)"
after_docker_calls=$(wc -l <"$docker_log" 2>/dev/null || echo 0)

[ "$before_deployed" = "$after_deployed" ] || fail "DEPLOYED.json changed for a superseded deploy"
[ "$before_current" = "$after_current" ] || fail "current changed for a superseded deploy"
[ "$before_releases" = "$after_releases" ] || fail "the releases directory changed for a superseded deploy"
[ "$before_docker_calls" = "$after_docker_calls" ] || fail "docker compose was invoked for a superseded deploy"
[ ! -e "$stack_base/releases/$sha_old" ] || fail "a release directory was created for a superseded deploy"
pass "an ancestor deploy ($sha_old, behind live $sha_new) stops successfully and touches nothing"

# --- 4. redeploying the sha already live is unaffected by this gate --------
deploy_log="$work/deploy-same-sha.log"
rc=0
deploy "$sha_new" v-new-again >"$deploy_log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "redeploying the already-live sha was expected to fail, as it did before this gate existed"
grep -q "already exists" "$deploy_log" \
	|| fail "redeploying the already-live sha did not hit the pre-existing immutable-release guard: $(cat "$deploy_log")"
pass "redeploying the sha already live still hits the pre-existing immutable-release guard, unchanged by the supersede gate"

# --- 5. a rollback to an older release still works --------------------------
rollback_log="$work/rollback.log"
"$rollback" --stack test --base "$stack_base" --port 19999 --timeout 5 --interval 1 \
	--deployed-by test-harness >"$rollback_log" 2>&1 || fail "rollback failed: $(cat "$rollback_log")"
[ "$(current_target)" = "releases/$sha_live" ] || fail "rollback did not move current back to $sha_live"
[ "$(deployed_field release)" = "$sha_live" ] || fail "DEPLOYED.json.release is not $sha_live after rollback"
pass "a rollback to the older release ($sha_live) still works -- rollback.sh never calls release.sh, so the gate cannot fire there"

echo "all release-supersede tests passed"
