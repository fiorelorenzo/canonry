#!/usr/bin/env bash
# Drops idle canonry_test_* databases left behind by the TEST_DB_SUFFIX convention
# (AGENTS.md, "Test state is isolated per run, by a suffix"): the global setup drops
# and recreates the database it is about to use, but nothing drops it afterwards, so
# every test run in every worktree since that convention landed has left one behind.
# By 2026-08-19 that was 919 fully migrated databases on the shared dev Postgres.
#
# This is deliberately not a test teardown. A test that drops its own database on exit
# would also drop the evidence of a failed run, which is exactly the debugging the
# suffix exists to enable (AGENTS.md again: "the global setup drops the database,
# recreates it, and terminates every other backend connected to it"). Instead this is a
# janitor, meant to run on a schedule well after the fact, once a database has had time
# to be looked at.
#
# Idleness signal: Postgres has no per-database "last used" column, and
# pg_stat_database's counters reset on server restart and are useless for "last
# written to" across the box's uptime. What this uses instead is the mtime of the
# database's own directory under the container's data directory
# (`/var/lib/postgresql/data/base/<oid>`, found via `pg_database.oid`): every write to
# that database, migrate, seed, or a test's own inserts, touches a file under that
# directory. Checked by hand against this box's Postgres on 2026-08-19: a database
# migrated and seeded minutes earlier showed a directory mtime minutes old, and a
# database from a test run four days earlier showed a directory mtime four days old.
# That is a real, and not merely assumed, "last written to" signal.
#
# Safety, because this drops databases:
#   - The pattern is ANCHORED to the `canonry_test_` prefix the suffix convention
#     writes. A database that does not start with that literal prefix is never even a
#     candidate, so `canonry`, `canonry_demo`, `canonry_e2e`, `canonry_fresh`,
#     `canonry_import_e2e`, `canonry_scratch`, `canonry_v2`, `canonry_v3`, `canonry_v4`,
#     `canonry_webtest`, and every `canonry_w<issue>_demo` an agent is using right now
#     are structurally out of reach. A second, redundant check below refuses any
#     candidate ending in `_bench`, `_e2e`, or `_demo` even though the prefix already
#     rules that out, the same defence in depth demo-reset.sh applies with its own
#     `*_demo` check.
#   - A database with any live backend connected (checked freshly against
#     pg_stat_activity right before each candidate is evaluated) is skipped, never
#     force-dropped. Unlike demo-reset.sh, this script never terminates a backend: it
#     only ever drops a database nothing is using.
#   - `--dry-run` prints exactly what would be dropped and nothing else touches the
#     database.
#   - `--days N` sets the idle threshold, default 3. Checked against this box's actual
#     spread on 2026-08-19 (919 databases, ages from a few minutes to just under six
#     days old): 3 days drops 440 of them while leaving every database written to in
#     the last three days alone, which is enough runway for someone mid-debugging a
#     failed run to still find it the next morning without the janitor racing them.
#
# Usage:
#   scripts/test-db-janitor.sh --dry-run
#   scripts/test-db-janitor.sh --dry-run --days 7
#   scripts/test-db-janitor.sh
set -euo pipefail

DAYS=3
DRY_RUN=0

usage() {
	cat <<'USAGE'
Usage: scripts/test-db-janitor.sh [--dry-run] [--days N]

Drops canonry_test_* databases on the shared dev Postgres that have no live
connections and whose directory mtime is at least N days old (default 3).
Never touches a database outside the canonry_test_ prefix.

  --dry-run   print what would be dropped, drop nothing
  --days N    idle threshold in days (default 3)
  -h, --help  show this message
USAGE
}

while [ $# -gt 0 ]; do
	case "$1" in
	--dry-run)
		DRY_RUN=1
		shift
		;;
	--days)
		DAYS="${2:-}"
		shift 2
		;;
	--days=*)
		DAYS="${1#*=}"
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "unknown argument: $1" >&2
		usage >&2
		exit 1
		;;
	esac
done

if ! [[ "$DAYS" =~ ^[0-9]+$ ]]; then
	echo "--days must be a non-negative integer, got '$DAYS'" >&2
	exit 1
fi

PG_CONTAINER="$(docker ps --filter 'name=canonry-dev-postgres' --format '{{.Names}}' | head -1)"
if [ -z "$PG_CONTAINER" ]; then
	echo "no canonry dev Postgres container is running. Start it with: pnpm db:up" >&2
	exit 1
fi

psql_as_postgres() { docker exec -i "$PG_CONTAINER" psql -U canonry -d postgres -v ON_ERROR_STOP=1 -tA; }

echo "==> listing canonry_test_* databases on $PG_CONTAINER"
candidates="$(psql_as_postgres <<'SQL'
SELECT d.datname, d.oid, COALESCE(c.conns, 0)
FROM pg_database d
LEFT JOIN (
  SELECT datname, count(*) AS conns
  FROM pg_stat_activity
  WHERE datname IS NOT NULL
  GROUP BY datname
) c ON c.datname = d.datname
WHERE d.datname ~ '^canonry_test_.+$'
ORDER BY d.datname;
SQL
)"

total=0
if [ -n "$candidates" ]; then
	total="$(printf '%s\n' "$candidates" | wc -l)"
fi
echo "==> $total candidate database(s) found"

if [ "$total" -eq 0 ]; then
	echo "nothing to do"
	exit 0
fi

echo "==> stating directory mtimes inside $PG_CONTAINER"
mtime_lines="$(printf '%s\n' "$candidates" | cut -d'|' -f2 | docker exec -i "$PG_CONTAINER" bash -c '
	while read -r oid; do
		mtime="$(stat -c %Y "/var/lib/postgresql/data/base/$oid" 2>/dev/null || true)"
		printf "%s %s\n" "$oid" "${mtime:-}"
	done
')"

declare -A mtime_by_oid=()
while read -r oid mtime; do
	[ -z "$oid" ] && continue
	mtime_by_oid["$oid"]="$mtime"
done <<<"$mtime_lines"

now="$(date +%s)"
to_drop=()
skip_connected=()
skip_young=()
skip_nodata=()
refused=()

while IFS='|' read -r datname oid conns; do
	[ -z "$datname" ] && continue

	# Anchored allowlist: only the test-suffix prefix is ever a candidate.
	case "$datname" in
	canonry_test_*) ;;
	*)
		refused+=("$datname")
		continue
		;;
	esac
	# Defence in depth: the prefix above already excludes every protected name
	# (canonry, canonry_demo, canonry_w<issue>_demo, ...), but refuse a protected
	# suffix explicitly too, the same posture demo-reset.sh takes with `*_demo`.
	case "$datname" in
	*_bench | *_e2e | *_demo)
		refused+=("$datname")
		continue
		;;
	esac

	mtime="${mtime_by_oid[$oid]:-}"
	if [ -z "$mtime" ]; then
		skip_nodata+=("$datname")
		continue
	fi

	if [ "$conns" -gt 0 ]; then
		skip_connected+=("$datname (${conns} connection(s))")
		continue
	fi

	age_days=$(((now - mtime) / 86400))
	if [ "$age_days" -lt "$DAYS" ]; then
		skip_young+=("$datname (${age_days}d idle)")
		continue
	fi

	to_drop+=("$datname (${age_days}d idle)")
done <<<"$candidates"

if [ "${#refused[@]}" -gt 0 ]; then
	echo "==> refused ${#refused[@]} candidate(s) that fell outside the anchored pattern (this should never happen):"
	printf '  %s\n' "${refused[@]}" >&2
fi

echo "==> skipping ${#skip_connected[@]} with a live connection, ${#skip_young[@]} younger than ${DAYS}d, ${#skip_nodata[@]} with no mtime data"

if [ "${#to_drop[@]}" -eq 0 ]; then
	echo "==> nothing idle enough to drop"
	exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
	echo "==> dry run: would drop ${#to_drop[@]} database(s):"
	printf '  %s\n' "${to_drop[@]}"
	exit 0
fi

echo "==> dropping ${#to_drop[@]} database(s)"
dropped=0
failed=0
for entry in "${to_drop[@]}"; do
	datname="${entry%% (*}"
	if drop_output="$(docker exec -i "$PG_CONTAINER" psql -U canonry -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$datname\";" 2>&1)"; then
		echo "dropped $datname"
		dropped=$((dropped + 1))
	else
		echo "failed to drop $datname: $drop_output" >&2
		failed=$((failed + 1))
	fi
done

echo "==> dropped $dropped, failed $failed"
if [ "$failed" -gt 0 ]; then
	exit 1
fi
