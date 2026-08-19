#!/usr/bin/env bash
# Every credential `.env.example` documents has to reach the deployed web container, or the
# feature behind it is dead in a way nothing notices.
#
# This exists because it happened. Issue #247's password reset and #250's account deletion
# both shipped, both green, and neither could ever send a mail on a deployed stack, because
# `compose.deploy.yml` enumerates the web service's environment one variable at a time and
# `RESEND_API_KEY` and `MAIL_FROM` were never added to that list. The reset endpoint answered
# 200 with "If this email exists in our system, check your email for the reset link" while
# the send threw `MissingResendEnvError` into the container log. Nothing in CI could see it:
# the unit tests inject their own environment, and the docker-boot job checks that surfaces
# render rather than that a background job can do its work.
#
# The rule this enforces is deliberately narrow. It compares two lists of names and nothing
# else, so it needs no docker, no secrets and no network, and it cannot tell you whether a
# value is correct. A variable that genuinely does not belong in the container goes in
# NOT_IN_CONTAINER below, with a reason, which is the honest way to say "considered and no".
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
env_example="$repo_root/.env.example"
deploy_compose="$repo_root/docker/deploy/compose.deploy.yml"

# Variables that are documented for a local run and correctly absent from the deployed web
# service. Each one needs a reason, because "it is not there" is not a reason.
#
# There are two honest reasons and no third. Either another service consumes it and the web
# service receives its effect some other way, or the code has a working default and passing
# the variable through unset would hand the app an empty string, which is not the same thing
# as absent: `readLimit` shrugs at an empty concurrency and falls back, but an empty
# `BETTER_AUTH_URL` is a URL, and Better Auth would try to build callbacks from it instead
# of falling back to ORIGIN. So an optional override stays out until somebody actually wants
# to set it on a stack, and then it goes in with a default rather than bare.
declare -A NOT_IN_CONTAINER=(
	# The deploy composes DATABASE_URL and QDRANT_URL from these for the postgres service;
	# the web service gets the composed URLs instead, so passing the parts as well would be
	# two sources of truth for one connection.
	[POSTGRES_USER]='consumed by the postgres service, reaches web inside DATABASE_URL'
	[POSTGRES_PASSWORD]='consumed by the postgres service, reaches web inside DATABASE_URL'
	[POSTGRES_DB]='consumed by the postgres service, reaches web inside DATABASE_URL'
	[BETTER_AUTH_URL]='optional, falls back to ORIGIN; an empty string here would not'
	[AI_GATEWAY_BASE_URL]='optional gateway override, the SDK default applies when unset'
	[MEDIA_CONCURRENCY_REPLICATE]='optional, packages/media defaults it to 4'
	[MEDIA_CONCURRENCY_ELEVENLABS]='optional, packages/media defaults it to 3'
)

fail=0

# `.env.example` marks an optional variable by commenting out its assignment, so
# `# GOOGLE_CLIENT_ID=` is documented just as much as `STAFF_EMAILS=` is. Reading only the
# uncommented lines called four real entries undocumented on the first run of this script.
documented="$(grep -oE '^#? *[A-Z][A-Z0-9_]+=' "$env_example" | tr -d '#=' | tr -d ' ' | sort -u)"
passed="$(grep -oE '^[[:space:]]+[A-Z][A-Z0-9_]+:' "$deploy_compose" | tr -d ' :' | sort -u)"

for name in $documented; do
	if printf '%s\n' "$passed" | grep -qx "$name"; then
		continue
	fi
	if [ -n "${NOT_IN_CONTAINER[$name]+x}" ]; then
		printf 'ok   %s is deliberately absent: %s\n' "$name" "${NOT_IN_CONTAINER[$name]}"
		continue
	fi
	printf 'FAIL %s is documented in .env.example but never passed to the web service in\n' "$name"
	printf '     docker/deploy/compose.deploy.yml, so it is unset on every deployed stack.\n'
	printf '     Add it there, or add it to NOT_IN_CONTAINER in this script with a reason.\n'
	fail=1
done

# The other direction is worth one line too: a variable the deploy passes and nothing
# documents is not a failure, but it is how a credential ends up known only to whoever
# wrote the compose file.
for name in $passed; do
	case "$name" in
	PORT | IMPORT_ROOT | MEDIA_ROOT | WEB_IMAGE | WEB_PORT) continue ;;
	esac
	if ! printf '%s\n' "$documented" | grep -qx "$name"; then
		printf 'warn %s is passed to the container but is not documented in .env.example\n' "$name"
	fi
done

if [ "$fail" -ne 0 ]; then
	printf '\nThe deployed environment does not carry everything .env.example promises.\n' >&2
	exit 1
fi

printf '\nEvery documented variable reaches the web service, or says why it does not.\n'
