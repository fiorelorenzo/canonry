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

# validate_database_url SECRETS_FILE - refuses loudly, naming the variable, if that
# file's DATABASE_URL does not parse as an unambiguous postgres:// DSN (scheme, host,
# port and database all present). Exists because `openssl rand -base64 32` -- the
# obvious way to generate POSTGRES_PASSWORD -- can produce `+`, `/` or `=`, none of
# which are valid unescaped inside a URL's userinfo; a password like `ab/cd` silently
# shifts everything after that `/` out of the host:port and into the path, so the
# container connects to the wrong place (or nothing) instead of failing to parse. Left
# unchecked, that surfaces 90 seconds later as an unexplained health-gate timeout,
# not as a five-second, readable error naming the actual variable at fault. See
# docker/deploy/secrets.env.example for how to generate a URL-safe secret instead.
validate_database_url() {
	secrets_file="$1"
	url=$(grep -m1 '^DATABASE_URL=' "$secrets_file" | cut -d= -f2-)
	[ -n "$url" ] || die "DATABASE_URL is not set in $secrets_file"
	python3 - "$url" <<-'PY' || die "DATABASE_URL in $secrets_file does not parse as a valid postgres:// URL (bad scheme, host, port or database) -- if the password came from base64, regenerate it URL-safe, see docker/deploy/secrets.env.example"
	import sys
	from urllib.parse import urlsplit
	try:
	    u = urlsplit(sys.argv[1])
	    ok = u.scheme in ("postgres", "postgresql") and bool(u.hostname) and u.port is not None and bool((u.path or "").lstrip("/"))
	except ValueError:
	    ok = False
	sys.exit(0 if ok else 1)
	PY
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

# --- supersede gate ------------------------------------------------------
# is_superseded_deploy SHA LIVE_COMMIT -> exit 0 if SHA is a strict, proper
# ancestor of LIVE_COMMIT (the commit currently live for this stack) -- a
# deploy that arrived after a newer one already went out, most often a CI
# run for an older commit that got requeued and finished last (issue #228).
# Exit 1 otherwise: a normal forward deploy, an unrelated commit, nothing
# live yet (LIVE_COMMIT empty), or SHA itself already being live. That last
# case is deliberate: git considers a commit its own ancestor, but
# redeploying what is already live is not a backwards deploy, it is how a
# stack gets recreated after someone changes a container by hand, and
# release.sh already has its own guard for that ("release already exists"),
# so this function stays out of its way instead of turning it into a silent
# no-op skip. `git merge-base --is-ancestor` exiting anything other than 0
# or 1 means it could not answer the question at all -- most likely a
# checkout too shallow to hold LIVE_COMMIT's history -- and that is treated
# as a hard failure rather than a reason to guess.
is_superseded_deploy() {
	sha="$1"
	live_commit="$2"

	[ -z "$live_commit" ] && return 1
	[ "$sha" = "$live_commit" ] && return 1

	git merge-base --is-ancestor "$sha" "$live_commit" && status=0 || status=$?
	case "$status" in
	0) return 0 ;;
	1) return 1 ;;
	*) die "could not determine whether $sha is an ancestor of $live_commit (git merge-base --is-ancestor exited $status) -- checkout may be missing history" ;;
	esac
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

# --- dead man's switch ----------------------------------------------------
# healthchecks_ping
# Pings this unit's healthchecks.io check to say the run succeeded (issue
# #118). The `OnFailure=` handler owns the failure ping, so this function only
# ever reports success: one owner per outcome, rather than two places racing to
# describe the same run.
#
# Why a ping at all, when record_backup_status already writes the outcome to
# disk and a failure already reaches the journal: neither of those catches the
# case that actually worries me, which is the timer never firing. A file that
# stopped being updated and a journal with nothing in it look exactly like a
# quiet week. An external check that expects to hear from us every day is the
# only thing that notices silence.
#
# Both values come from the environment rather than from arguments, because the
# unit file is where the mapping from stack to check belongs (`%i` writes it)
# and the key is a secret that has no business in an ExecStart line visible to
# `ps` and to `systemctl cat`. HEALTHCHECKS_PING_KEY comes from
# /etc/canonry/backup-alert.env, HEALTHCHECKS_SLUG from the unit's own
# Environment=.
#
# Absent key means no ping and no noise: a box that has not been wired up yet
# is a normal state, and the units predate this. Absent slug with a key present
# is a misconfiguration and says so, because that is the shape that would make
# a check sit there going green on nothing.
healthchecks_ping() {
	if [ -z "${HEALTHCHECKS_PING_KEY:-}" ]; then
		return 0
	fi
	if [ -z "${HEALTHCHECKS_SLUG:-}" ]; then
		log "HEALTHCHECKS_PING_KEY is set but HEALTHCHECKS_SLUG is not: no success ping sent"
		return 0
	fi
	# --retry, because a backup that worked must not be reported as missing over
	# one lost packet, and --max-time so a hung endpoint cannot hold the unit
	# open. A failed ping is logged and never fatal: the backup already
	# succeeded, and turning a monitoring hiccup into a failed unit would page
	# somebody about the wrong thing.
	if ! curl -fsS --retry 3 --retry-connrefused --max-time 15 \
		"https://hc-ping.com/${HEALTHCHECKS_PING_KEY}/${HEALTHCHECKS_SLUG}" >/dev/null 2>&1; then
		log "healthchecks ping failed for ${HEALTHCHECKS_SLUG} (the backup itself succeeded)"
	fi
}
