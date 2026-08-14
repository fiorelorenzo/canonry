#!/usr/bin/env bash
# Shared helpers for the release/rollback/backup scripts under scripts/deploy/.
# Sourced, never executed directly. Every script that sources this expects
# `set -euo pipefail` to already be in effect in the caller.

# --- logging -----------------------------------------------------------
# Everything goes to stderr so a script's stdout stays reserved for the one
# value (a path, a sha, a JSON blob) a caller might want to capture.

log() {
	printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

die() {
	log "ERROR: $*"
	exit 1
}

require_cmd() {
	for cmd in "$@"; do
		command -v "$cmd" >/dev/null 2>&1 || die "required command not found: $cmd"
	done
}

# require_env NAME - fails if the named variable is unset or empty. Never
# echoes the value, so a secret-bearing variable is still safe to pass here.
require_env() {
	for name in "$@"; do
		if [ -z "${!name:-}" ]; then
			die "required environment variable is not set: $name"
		fi
	done
}

# --- atomic symlink flip ------------------------------------------------
# `ln -sfn` alone is not atomic: with an existing destination GNU coreutils
# unlinks it and then creates the new link as two separate syscalls, leaving
# a window where the link is briefly gone. Writing a symlink under a
# temporary name in the same directory and renaming it over the destination
# is atomic (rename(2) on the same filesystem), which is what SPEC.md #12
# means by "flipped atomically".
atomic_symlink() {
	target="$1"
	link_path="$2"
	tmp_link="${link_path}.tmp.$$"
	ln -sfn "$target" "$tmp_link"
	mv -T "$tmp_link" "$link_path"
}

# --- release directory helpers ------------------------------------------

# release_dir BASE SHA -> path
release_dir() {
	printf '%s/releases/%s' "$1" "$2"
}

# current_release BASE -> sha, or empty if no current symlink exists yet
current_release() {
	base="$1"
	if [ -L "$base/current" ]; then
		basename "$(readlink -f "$base/current")"
	fi
}

# lock_release DIR - make a release directory and its files read-only, so
# nothing (including this script run again by mistake) can mutate a release
# after it has been published. Reversed by unlock_release before deletion.
# Files get 0550 rather than 0440: a release directory also carries a copy
# of scripts/deploy itself (release.sh copies it in alongside compose.yml),
# and those need their execute bit to still run as systemd ExecStart
# targets. The extra x bit on non-script files (compose.yml, .env) is inert.
lock_release() {
	dir="$1"
	find "$dir" -type f -exec chmod 0550 {} +
	find "$dir" -type d -exec chmod 0550 {} +
}

unlock_release() {
	dir="$1"
	find "$dir" -type d -exec chmod u+w {} +
	find "$dir" -type f -exec chmod u+w {} +
}

# --- compose ------------------------------------------------------------
# Every deploy/rollback invocation of compose goes through this one function
# so the project name (hence the postgres/qdrant volume names) stays stable
# across releases, while the compose file and its .env come from whichever
# release directory is passed in.
compose_cmd() {
	stack="$1"
	release="$2"
	shift 2
	docker compose \
		--project-name "canonry-${stack}" \
		--project-directory "$release" \
		-f "$release/compose.yml" \
		"$@"
}

# --- health gate ----------------------------------------------------------
# poll_health URL EXPECTED_VERSION EXPECTED_COMMIT TIMEOUT_SECONDS INTERVAL_SECONDS
# Prints the last observed /healthz body to stdout on success. A 200 alone is
# not enough: SPEC.md #12 exists because a green curl has served a stale
# build on this box before, so the served version is compared against the
# artifact this run actually built.
poll_health() {
	url="$1"
	expected_version="$2"
	expected_commit="$3"
	timeout_s="${4:-60}"
	interval_s="${5:-2}"

	deadline=$(($(date +%s) + timeout_s))
	last_body=""
	last_error=""

	while [ "$(date +%s)" -lt "$deadline" ]; do
		if last_body=$(curl -fsS --max-time 5 "$url" 2>/dev/null); then
			served_version=$(printf '%s' "$last_body" | jq -r '.version // empty')
			served_commit=$(printf '%s' "$last_body" | jq -r '.commit // empty')
			served_status=$(printf '%s' "$last_body" | jq -r '.status // empty')

			if [ "$served_status" = "down" ]; then
				last_error="reports status=down"
			elif [ "$served_version" != "$expected_version" ]; then
				last_error="served version '$served_version' does not match built artifact '$expected_version' -- stale build"
			elif [ "$served_commit" != "$expected_commit" ]; then
				last_error="served commit '$served_commit' does not match built artifact '$expected_commit' -- stale build"
			else
				printf '%s\n' "$last_body"
				return 0
			fi
		else
			last_error="request to $url failed"
		fi
		sleep "$interval_s"
	done

	log "health gate failed after ${timeout_s}s: ${last_error:-no response}"
	[ -n "$last_body" ] && log "last response body: $last_body"
	return 1
}

# --- DEPLOYED.json --------------------------------------------------------
# write_deployed_json PATH STACK RELEASE VERSION COMMIT IMAGE DEPLOYED_BY PREVIOUS STATUS [NOTE]
write_deployed_json() {
	path="$1" stack="$2" release="$3" version="$4" commit="$5"
	image="$6" deployed_by="$7" previous="$8" status="$9" note="${10:-}"

	jq -n \
		--arg stack "$stack" \
		--arg release "$release" \
		--arg version "$version" \
		--arg commit "$commit" \
		--arg image "$image" \
		--arg deployed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
		--arg deployed_by "$deployed_by" \
		--arg previous "$previous" \
		--arg status "$status" \
		--arg note "$note" \
		'{
			stack: $stack,
			release: $release,
			version: $version,
			commit: $commit,
			image: $image,
			deployed_at: $deployed_at,
			deployed_by: $deployed_by,
			previous_release: (if $previous == "" then null else $previous end),
			status: $status,
			note: (if $note == "" then null else $note end)
		}' >"$path.tmp.$$"
	mv -T "$path.tmp.$$" "$path"
}

# --- backup run status ----------------------------------------------------
# record_backup_status DIR NAME SUCCESS MESSAGE [EXTRA_JSON]
# Writes DIR/NAME-last-run.json, overwriting the previous run's record. This
# is the "recorded where a failure is visible" half of the backup jobs
# (SPEC.md #12, #98): it exists independently of systemd's own journal so a
# dashboard or a human `cat`-ing the file sees the outcome without needing
# journalctl access, and it is written on both success and failure -- a
# missing or stale file is itself a signal something stopped running.
record_backup_status() {
	dir="$1" name="$2" success="$3" message="$4" extra="${5:-null}"
	mkdir -p "$dir"
	jq -n \
		--arg name "$name" \
		--argjson success "$success" \
		--arg message "$message" \
		--arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
		--argjson extra "$extra" \
		'{name: $name, success: $success, message: $message, recorded_at: $recorded_at} * ($extra // {})' \
		>"$dir/$name-last-run.json.tmp.$$"
	mv -T "$dir/$name-last-run.json.tmp.$$" "$dir/$name-last-run.json"
}
