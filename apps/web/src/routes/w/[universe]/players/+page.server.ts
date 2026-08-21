/**
 * Issue R11, round thirteen (docs/ux/DECISIONS.md): the GM's side of the players' wiki -
 * the wiki's own address, what has been revealed and when (`revelationLogForUniverse`,
 * with the session each row was confirmed in), and what is still behind the screen
 * (`listPublicEntities`, the same query `/p/[universe]`'s own index runs, filtered to
 * the entries it renders as a gap page). Guardrail 6: this is GM chrome reading GM data,
 * never a second renderer of `/p/[universe]` - it shows the GM the same facts that route
 * would eventually show a player, not that route's own prose.
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
 */
import { error } from '@sveltejs/kit';
import { listPublicEntities, revelationLogForUniverse, universeAccessBySlug } from '@canonry/db';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

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
	const revealedRef = (ref: { slug: string; name: string }) => ({
		...ref,
		revealed: statusBySlug.get(ref.slug) === 'full'
	});

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		log: log.map((entry) =>
			entry.kind === 'relation'
				? {
						id: entry.id,
						kind: entry.kind,
						confirmedAt: entry.confirmedAt,
						sessionName: entry.sessionName,
						relationLabel: entry.relationLabel,
						from: revealedRef(entry.from),
						to: revealedRef(entry.to)
					}
				: {
						id: entry.id,
						kind: entry.kind,
						confirmedAt: entry.confirmedAt,
						sessionName: entry.sessionName,
						label: entry.label,
						entity: revealedRef(entry.entity)
					}
		),
		hidden: entities
			.filter((entity) => entity.status === 'gap')
			.map((entity) => ({ id: entity.id, name: entity.name, type: entity.type, slug: entity.slug }))
	};
};
