#!/usr/bin/env bash
# Rebuilds the local demo stack's database from nothing, so a rehearsal and the real run
# start from the same state and a rehearsal cannot leave half-accepted proposals behind.
#
# It refuses to touch anything but a database whose name ends in `_demo`, the same posture
# packages/bench takes with `_bench`/`_e2e`: this drops a database, and the shared dev
# Postgres on this box also holds `canonry`, which a running dev server reads.
#
# The demo user is created through the app's real sign-up endpoint rather than by writing
# rows, so the account has a real Better Auth credential and the demo signs in the way a
# person would. That means the dev server has to be up before this runs.
#
# Usage:
#   scripts/demo-reset.sh                      # canonry_demo, http://127.0.0.1:5196
#   DEMO_URL=http://127.0.0.1:5200 scripts/demo-reset.sh
set -euo pipefail

DB_NAME="${DEMO_DB:-canonry_demo}"
DEMO_URL="${DEMO_URL:-http://127.0.0.1:5196}"
DEMO_EMAIL="${DEMO_EMAIL:-lorenzo@canonry.invalid}"
DEMO_PASSWORD="${DEMO_PASSWORD:-canonry-demo-2026}"
DEMO_NAME="${DEMO_NAME:-Lorenzo}"
PG_PORT="${PG_PORT:-55432}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$DB_NAME" in
*_demo) ;;
*)
	echo "refusing to drop '$DB_NAME': this script only ever touches a *_demo database," >&2
	echo "because the same Postgres holds the shared dev database a dev server reads." >&2
	exit 1
	;;
esac

PG_CONTAINER="$(docker ps --filter 'name=canonry-dev-postgres' --format '{{.Names}}' | head -1)"
if [ -z "$PG_CONTAINER" ]; then
	echo "no canonry dev Postgres container is running. Start it with: pnpm db:up" >&2
	exit 1
fi

psql_as_postgres() { docker exec -i "$PG_CONTAINER" psql -U canonry -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_demo() { docker exec -i "$PG_CONTAINER" psql -U canonry -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

echo "==> dropping and recreating $DB_NAME"
# Terminate whatever is connected first: a dev server holding a pool keeps DROP waiting.
psql_as_postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null
psql_as_postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" >/dev/null
psql_as_postgres -c "CREATE DATABASE $DB_NAME;" >/dev/null

echo "==> migrating"
cd "$REPO_ROOT"
# Unset rather than trust the environment: an exported DATABASE_URL from another task
# outranks anything a file says, and this one has to land in the demo database.
unset TEST_DATABASE_URL TEST_DB_SUFFIX
DATABASE_URL="postgres://canonry:canonry@127.0.0.1:${PG_PORT}/${DB_NAME}" \
	pnpm --filter @canonry/db migrate

echo "==> seeding Valdoria Reach"
DATABASE_URL="postgres://canonry:canonry@127.0.0.1:${PG_PORT}/${DB_NAME}" \
	pnpm --filter @canonry/db seed

echo "==> waiting for the app, which the drop above will have taken down with it"
# Dropping the database terminates the app's connection pool, and the app exits rather
# than serving requests it cannot answer. Under a supervisor it comes back by itself;
# started by hand it needs restarting now, in its own window. Either way this waits
# instead of failing, because the account has to be created through the real endpoint.
app_ready=""
for _ in $(seq 1 60); do
	if curl -sf -o /dev/null "$DEMO_URL/healthz"; then
		app_ready=1
		break
	fi
	echo "    still waiting for $DEMO_URL ... (restart the dev server if it is not supervised)"
	sleep 2
done
if [ -z "$app_ready" ]; then
	echo "gave up waiting for $DEMO_URL after two minutes. Start it and re-run:" >&2
	echo "  pnpm --filter web dev --port 5196 --host 127.0.0.1 --strictPort" >&2
	exit 1
fi

echo "==> creating the demo account through the real sign-up endpoint"
signup_status="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$DEMO_URL/api/auth/sign-up/email" \
	-H 'content-type: application/json' \
	--data-binary "$(printf '{"name":%s,"email":%s,"password":%s}' \
		"\"$DEMO_NAME\"" "\"$DEMO_EMAIL\"" "\"$DEMO_PASSWORD\"")")"
if [ "$signup_status" != "200" ]; then
	echo "sign-up returned $signup_status, expected 200" >&2
	exit 1
fi

echo "==> granting the demo account ownership of the seeded universes"
# The seed fixture owns its universes as `fixture-owner`, which has no credential and so
# cannot sign in. The demo signs in as a real account, so it needs membership.
psql_demo -c "INSERT INTO universe_member (universe_id, user_id, role)
  SELECT u.id, (SELECT id FROM \"user\" WHERE email = '$DEMO_EMAIL'), 'owner' FROM universe u
  ON CONFLICT (universe_id, user_id) DO UPDATE SET role = 'owner';" >/dev/null

echo
echo "ready. Sign in at $DEMO_URL/auth/sign-in as $DEMO_EMAIL"
psql_demo -tAc "SELECT '  universe: ' || slug FROM universe ORDER BY slug;"
psql_demo -tAc "SELECT '  entries: ' || count(*) FROM entity;"
psql_demo -tAc "SELECT '  pending proposals: ' || count(*) FROM proposal WHERE outcome = 'pending';"
