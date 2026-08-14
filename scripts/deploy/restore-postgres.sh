#!/usr/bin/env bash
# Restores a pg_dump custom-format backup via `docker exec` into the given
# postgres container. Two modes:
#
#   Real restore (disaster recovery):
#     restore-postgres.sh --container NAME --dump PATH --target-db NAME [--user NAME] [--create]
#
#   Rehearsal (SPEC.md #12 / AGENTS.md: "a backup nobody has restored is not
#   a backup"): restores into a throwaway scratch database on the same
#   server and compares every table's row count against a source database,
#   then drops the scratch database.
#     restore-postgres.sh --rehearse --container NAME --dump PATH \
#       --source-db NAME [--user NAME] [--scratch-db NAME] [--keep-scratch]
#
# Never touches the source database in rehearsal mode beyond read-only
# SELECT count(*) queries.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./lib.sh
. ./lib.sh

container="" dump="" user="" target_db="" source_db="" scratch_db=""
rehearse=0 create_target=0 keep_scratch=0

while [ $# -gt 0 ]; do
	case "$1" in
	--container)
		container="$2"
		shift 2
		;;
	--dump)
		dump="$2"
		shift 2
		;;
	--user)
		user="$2"
		shift 2
		;;
	--target-db)
		target_db="$2"
		shift 2
		;;
	--source-db)
		source_db="$2"
		shift 2
		;;
	--scratch-db)
		scratch_db="$2"
		shift 2
		;;
	--rehearse)
		rehearse=1
		shift
		;;
	--create)
		create_target=1
		shift
		;;
	--keep-scratch)
		keep_scratch=1
		shift
		;;
	*) die "unknown argument: $1" ;;
	esac
done

require_env container dump
require_cmd docker date stat
[ -f "$dump" ] || die "dump file not found: $dump"

[ -n "$user" ] || user=$(docker exec "$container" printenv POSTGRES_USER) || die "could not read POSTGRES_USER from $container"
pg_password=$(docker exec "$container" printenv POSTGRES_PASSWORD) || die "could not read POSTGRES_PASSWORD from $container"

container_dump="/tmp/canonry-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker cp "$dump" "$container:$container_dump"
cleanup() { docker exec "$container" rm -f "$container_dump" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql_c() {
	docker exec -e PGPASSWORD="$pg_password" "$container" psql -U "$user" -v ON_ERROR_STOP=1 -qtAX "$@"
}

table_names() {
	# One line per base table in the public schema of $1.
	psql_c -d "$1" -c "select tablename from pg_tables where schemaname = 'public' order by tablename;"
}

row_count() {
	psql_c -d "$1" -c "select count(*) from \"$2\";"
}

if [ "$rehearse" -eq 1 ]; then
	require_env source_db
	scratch_db="${scratch_db:-canonry_restore_rehearsal_$(date -u +%Y%m%d%H%M%S)}"

	log "rehearsal: restoring $dump into scratch database $scratch_db on $container"
	docker exec -e PGPASSWORD="$pg_password" "$container" createdb -U "$user" "$scratch_db"

	restore_ok=1
	if ! docker exec -e PGPASSWORD="$pg_password" "$container" \
		pg_restore -U "$user" -d "$scratch_db" --no-owner --no-privileges "$container_dump"; then
		restore_ok=0
	fi

	all_match=1
	if [ "$restore_ok" -eq 1 ]; then
		mapfile -t tables < <(table_names "$source_db")
		if [ "${#tables[@]}" -eq 0 ]; then
			log "WARNING: source database $source_db has no tables in the public schema, nothing to compare"
		fi
		for t in "${tables[@]}"; do
			src_count=$(row_count "$source_db" "$t")
			dst_count=$(row_count "$scratch_db" "$t")
			if [ "$src_count" = "$dst_count" ]; then
				log "OK    $t: source=$src_count restored=$dst_count"
			else
				log "FAIL  $t: source=$src_count restored=$dst_count"
				all_match=0
			fi
		done
	else
		log "FAIL  pg_restore into $scratch_db did not complete"
		all_match=0
	fi

	if [ "$keep_scratch" -eq 0 ]; then
		docker exec -e PGPASSWORD="$pg_password" "$container" dropdb -U "$user" "$scratch_db" || log "WARNING: could not drop scratch database $scratch_db"
	else
		log "scratch database $scratch_db left in place (--keep-scratch)"
	fi

	if [ "$restore_ok" -eq 1 ] && [ "$all_match" -eq 1 ]; then
		log "rehearsal PASSED: $dump restores cleanly and every table's row count matches $source_db"
		exit 0
	fi
	die "rehearsal FAILED: see the per-table comparison above"
fi

require_env target_db
if [ "$create_target" -eq 1 ]; then
	docker exec -e PGPASSWORD="$pg_password" "$container" createdb -U "$user" "$target_db"
fi
log "restoring $dump into $target_db on $container"
docker exec -e PGPASSWORD="$pg_password" "$container" \
	pg_restore -U "$user" -d "$target_db" --no-owner --no-privileges "$container_dump"
log "restore complete: $target_db"
