#!/usr/bin/env bash
# Builds the runtime image, boots it against a real Postgres, and proves it serves before
# anything is allowed to call this a passing build. Extracted from ci.yml's own docker-boot
# job (issue #115, SPEC.md #12) so the exact same script runs there and under `preflight`:
# two copies of this logic drifting apart is how a check ends up green in one place and
# meaningless in the other.
#
# Needs a reachable, empty Postgres server (schema applied below) on $PGHOST:$PGPORT, and
# docker. Qdrant is deliberately not needed: QDRANT_URL below points nowhere on purpose, see
# the boot step.
#
# Usage: scripts/ci-image-boot.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
cd "$repo_root"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-canonry}"
PGPASSWORD="${PGPASSWORD:-canonry}"
PGDATABASE="${PGDATABASE:-canonry}"
WEB_PORT="${WEB_PORT:-5196}"
CONTAINER_NAME="${CONTAINER_NAME:-canonry-web-boot-check}"

version="0.0.0-ci.$(git rev-parse --short HEAD)"
commit="$(git rev-parse HEAD)"

# The image boots a canon-save worker (issue #115), which queries `canon_save_job` on its
# first poll, so this check needs a migrated database rather than an empty one. That is also
# what a real deployment does: migrations run explicitly, before the new release serves
# traffic, never implicitly from inside the app.
#
# Applied with psql rather than `pnpm --filter @canonry/db migrate` because this needs no node
# toolchain and none is required: what the boot check wants is the schema, and drizzle's own
# runner is already exercised by every integration test in the unit test suite. ON_ERROR_STOP
# is what makes a broken migration fail here instead of surfacing as a confusing 500 from the
# container three steps later.
echo "applying migrations to $PGDATABASE@$PGHOST:$PGPORT"
for f in packages/db/migrations/*.sql; do
	echo "applying $f"
	docker run --rm --network host -v "$repo_root:/repo" -e PGPASSWORD="$PGPASSWORD" postgres:16 \
		psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q -f "/repo/$f"
done

echo "building canonry-web:ci ($version, $commit)"
docker build -f docker/Dockerfile \
	--build-arg APP_VERSION="$version" \
	--build-arg APP_COMMIT="$commit" \
	-t canonry-web:ci .

# --network host: the simplest way for the freshly built container to reach Postgres, which
# GitHub-hosted runners publish to the runner's own loopback interface, not a shared docker
# network, and which a local run reaches on loopback too. QDRANT_URL is left pointing nowhere
# on purpose: /healthz must degrade rather than fail when only Qdrant is unreachable.
# BETTER_AUTH_SECRET is required because the app refuses to boot without one rather than
# falling back to Better Auth's insecure default (issue #86). The value here is throwaway and
# signs nothing that outlives this run: the point is that the image starts and serves the
# version it was built with, not that anybody can sign in. ORIGIN matters for the same reason
# it matters in production: adapter-node only ever sees plain HTTP from a proxy, so a missing
# ORIGIN answers 403 to every form POST while the build stays green. RESEND_API_KEY and
# MAIL_FROM are throwaway values that never send anything (no route exercised below sends a
# mail): they are here so the /healthz check below can see the image report a configured mail
# transport, which is what the prodbox health gate refuses a release for (#277).
docker run -d --name "$CONTAINER_NAME" \
	--network host \
	-e DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$PGDATABASE" \
	-e QDRANT_URL=http://127.0.0.1:1 \
	-e ORIGIN="http://127.0.0.1:$WEB_PORT" \
	-e BETTER_AUTH_SECRET=ci-boot-check-secret-not-used-for-anything \
	-e RESEND_API_KEY=re_ci_boot_check_never_sends \
	-e 'MAIL_FROM=Canonry CI <noreply@canonry.invalid>' \
	-e PORT="$WEB_PORT" \
	canonry-web:ci

cleanup() {
	docker logs "$CONTAINER_NAME" > /tmp/ci-image-boot-container.log 2>&1 || true
	docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# SPEC.md #12: a green curl has served a stale build on this box before. Comparing the served
# version against the version this exact build was tagged with is the check that catches that.
echo "waiting for /healthz on :$WEB_PORT"
body=""
for _ in $(seq 1 30); do
	if body=$(curl -sf "http://127.0.0.1:$WEB_PORT/healthz"); then
		break
	fi
	sleep 1
done
if [ -z "$body" ]; then
	echo "::error::web container never answered /healthz"
	exit 1
fi
echo "$body" | jq .

served_version=$(echo "$body" | jq -r '.version')
served_db=$(echo "$body" | jq -r '.db')
served_mail=$(echo "$body" | jq -r '.mail')

if [ "$served_version" != "$version" ]; then
	echo "::error::served version '$served_version' does not match the built artefact '$version' -- stale image"
	exit 1
fi
if [ "$served_db" != "true" ]; then
	echo "::error::/healthz reports db=false while booted against a healthy Postgres"
	exit 1
fi
if [ "$served_mail" != "true" ]; then
	echo "::error::/healthz reports mail=$served_mail while booted with RESEND_API_KEY and MAIL_FROM set"
	exit 1
fi

# /healthz alone proves the process booted, not that the app can render anything: it touches
# no route module, so a page whose server module crashes on import stays invisible. That is
# not hypothetical. `pdfjs-dist` loads browser globals at module top level, so every route
# that transitively imported the import engine answered 500 in production while this job
# stayed green. One request per surface closes that hole for a couple of seconds of CI.
#
# `/u/new` and `/u/valdoria-reach` sat in this list until #251 and checked nothing: that
# namespace is `/w/` (decision J1), so both were 404 on every run whatever the route modules
# did. The two `/p/` paths are the published players' wiki (#251), the one surface here a
# signed-out stranger is actually meant to read, and this empty database has no world in it,
# so what they prove is that those route modules import and render rather than that the world
# exists.
echo "sweeping real surfaces"
fail=0
for path in / /auth/sign-in /auth/sign-up /privacy /docs /docs/import /onboarding /w/valdoria-reach /p/valdoria-reach /p/valdoria-reach/aldric-vane; do
	code=$(curl -s -o /tmp/ci-image-boot-body.html -w '%{http_code}' "http://127.0.0.1:$WEB_PORT$path")
	printf '%-34s %s\n' "$path" "$code"
	# 2xx, a redirect to sign-in, or an honest 404 for a universe this empty database does
	# not have are all fine. A 5xx never is.
	case "$code" in
	5*)
		echo "::error::$path answered $code"
		head -c 400 /tmp/ci-image-boot-body.html
		fail=1
		;;
	esac
done
if [ "$fail" -ne 0 ]; then
	exit 1
fi

# A route can answer 500 from a caught error, and it can also log an uncaught rejection while
# answering 200 from a fallback. Both matter, so the log is checked separately from the status
# codes above.
if docker logs "$CONTAINER_NAME" 2>&1 | grep -nE 'ReferenceError|TypeError: Cannot|UnhandledPromiseRejection|Cannot find module'; then
	echo "::error::the container logged an unhandled error while serving those routes"
	exit 1
fi

echo "image boots, serves its own version, and every real surface renders"
