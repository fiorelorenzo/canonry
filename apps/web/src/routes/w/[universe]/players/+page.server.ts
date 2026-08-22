/**
 * Issue R11 (round thirteen), reshaped by issue #530 (round eighteen, W2 = A): the GM's
 * side of the players' wiki now reads the same shape the public wiki does - by session,
 * newest first - instead of two flat lists ordered only by time. `revelationLogForUniverse`
 * still returns one flat list (newest first, unchanged - w530 owns that query), and
 * `groupBySession` below folds it into session groups in this loader rather than in the
 * query: this route is the only reader that needs the grouping, and the query's own flat
 * shape is still exactly what its other caller (a future universe-wide feed) would want.
 * `listPublicEntities` still answers what is still behind the screen
 * (`/p/[universe]`'s own index query, filtered to the entries it renders as a gap page).
 * #537: that query now excludes `'session'` entities outright, so a night at the table
 * never shows up in this list beside a genuine gap - a session is not a thing the party
 * discovers by name, it is when they discovered things.
 * Guardrail 6: this is GM chrome reading GM data, never a second renderer of
 * `/p/[universe]` - it shows the GM the same facts that route would eventually show a
 * player, not that route's own prose.
 *
 * No write action exists on this page: a reveal happens in Table mode (decision E5 = C,
 * "session log confirmed after the table breaks"), never here, so every member sees an
 * identical, read-only page regardless of role - "a viewer sees them read-only" holds
 * trivially, since there is nothing on this page to write.
 *
 * Issue #492: every entry name in the log links somewhere, and `statusBySlug` below is
 * how a row decides whether to also offer the player's own view of that entry - `entities`
 * is `listPublicEntities`'s full, unfiltered result (the same call the "still behind the
 * screen" list already filters down to `status === 'gap'`), so a name is only ever offered
 * a `/p/**` link when that specific entity's own status there is `'full'`.
 *
 * Issue #530's second half: "still behind the screen" now orders what is connected to what
 * the party already knows first. `pinnedNeighbors` (packages/db/src/queries/warm.ts) is
 * exactly this shape of query already - a one-hop (with `hops: 1`) walk of `relation` from
 * one entity - so this loader calls it once per revealed entity (there are at most a
 * handful per universe; see the E5/E7 fixtures) and unions the neighbor ids, rather than
 * a new aggregate query nobody has written. No new column, no new query: reused exactly as
 * it stands for the instant lane.
 */
import { error } from '@sveltejs/kit';
import {
	listPublicEntities,
	pinnedNeighbors,
	revelationLogForUniverse,
	universeAccessBySlug
} from '@canonry/db';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

type RevealedRef = { slug: string; name: string; revealed: boolean };
type LogItem =
	| {
			id: string;
			kind: 'entity' | 'fact';
			confirmedAt: Date;
			label: string;
			entity: RevealedRef;
	  }
	| {
			id: string;
			kind: 'relation';
			confirmedAt: Date;
			relationLabel: string;
			from: RevealedRef;
			to: RevealedRef;
	  };

interface SessionGroup {
	key: string;
	sessionName: string | null;
	latestAt: Date;
	items: LogItem[];
}

/** Folds the flat, newest-first log into session groups, newest session first. Grouped by
 * `sessionId` now (#537), not by `sessionName`: two sessions sharing a name - a GM naming
 * things "Session 1" in two arcs - used to merge into one group under the display string,
 * because `revelationLogForUniverse` (w530's own query) carried only the name. The id was
 * always sitting in `revelation.session_entity_id`; #537 has the query select it alongside
 * the name it already joins for, in `packages/db`, since that is where the foreign key
 * lives and where every other id/name pair in this file's rows comes from. The grouping
 * itself stays here rather than moving into the query: #536 already reasoned that this
 * route is the only reader that needs groups, and #537 changes only which column it groups
 * on, not who owns the grouping. Every row with no session (`sessionEntityId` null - a live
 * tap whose session entity was later deleted, or none was ever declared) still collects
 * into one "untracked" group instead of scattering across as many one-row groups: null
 * carries no identity to split on either. */
function groupBySession(
	items: Array<LogItem & { sessionId: string | null; sessionName: string | null }>
): SessionGroup[] {
	const groups = new Map<string, SessionGroup>();
	for (const { sessionId, sessionName, ...item } of items) {
		const key = sessionId ?? '';
		let group = groups.get(key);
		if (!group) {
			group = { key, sessionName, latestAt: item.confirmedAt, items: [] };
			groups.set(key, group);
		}
		if (item.confirmedAt > group.latestAt) group.latestAt = item.confirmedAt;
		group.items.push(item);
	}
	return [...groups.values()].sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `No universe named "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `No universe named "${params.universe}"`);

	const [entities, log] = await Promise.all([
		listPublicEntities(conn, access.universe.id),
		revelationLogForUniverse(conn, access.universe.id, { locale: locals.locale })
	]);

	const statusBySlug = new Map(entities.map((item) => [item.slug, item.status]));
	const revealedRef = (ref: { slug: string; name: string }): RevealedRef => ({
		...ref,
		revealed: statusBySlug.get(ref.slug) === 'full'
	});

	const mappedLog = log.map(
		(entry): LogItem & { sessionId: string | null; sessionName: string | null } =>
			entry.kind === 'relation'
				? {
						id: entry.id,
						kind: entry.kind,
						confirmedAt: entry.confirmedAt,
						sessionId: entry.sessionId,
						sessionName: entry.sessionName,
						relationLabel: entry.relationLabel,
						from: revealedRef(entry.from),
						to: revealedRef(entry.to)
					}
				: {
						id: entry.id,
						kind: entry.kind,
						confirmedAt: entry.confirmedAt,
						sessionId: entry.sessionId,
						sessionName: entry.sessionName,
						label: entry.label,
						entity: revealedRef(entry.entity)
					}
	);

	const hiddenEntities = entities.filter((entity) => entity.status === 'gap');
	const revealedEntities = entities.filter((entity) => entity.status === 'full');

	// #530: one hop from anything already revealed, reusing `pinnedNeighbors` exactly as
	// the instant lane already does (see this file's own header comment) - one call per
	// revealed entity rather than a new aggregate query.
	const neighborRings = await Promise.all(
		revealedEntities.map((entity) => pinnedNeighbors(conn, entity.id, { hops: 1 }))
	);
	const connectedIds = new Set(
		neighborRings.flatMap((ring) => ring.map((neighbor) => neighbor.entity.id))
	);

	const hidden = [
		...hiddenEntities.filter((entity) => connectedIds.has(entity.id)),
		...hiddenEntities.filter((entity) => !connectedIds.has(entity.id))
	].map((entity) => ({
		id: entity.id,
		name: entity.name,
		type: entity.type,
		slug: entity.slug,
		connected: connectedIds.has(entity.id)
	}));

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		log: groupBySession(mappedLog),
		hidden
	};
};
