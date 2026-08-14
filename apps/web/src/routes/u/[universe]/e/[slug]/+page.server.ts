import { error } from '@sveltejs/kit';
import { historyFor, relationsFor } from '@canonry/db';
import { db } from '$lib/server/db';
import { stripMentionSyntax } from '$lib/markdown';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const conn = db();

	const world = await conn.query.universe.findFirst({
		where: (universe, { eq }) => eq(universe.slug, params.universe)
	});
	if (!world) error(404, `No universe named "${params.universe}"`);

	const current = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.universeId, world.id), eq(entity.slug, params.slug))
	});
	if (!current) error(404, `No entry named "${params.slug}" in ${world.name}`);

	// Mention resolution needs every entity's name and aliases, not just this one - a body
	// full of `[[Other Entity]]` has to resolve against the whole universe (#105/#15).
	const universeEntities = await conn.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, world.id),
		columns: { name: true, slug: true, aliases: true }
	});

	const entityFacts = await conn.query.fact.findMany({
		where: (fact, { eq }) => eq(fact.entityId, current.id),
		orderBy: (fact, { asc }) => asc(fact.spanStart)
	});

	// No `relations()` are declared between `fact` and `revision`, so the relational query
	// API can't join them; fetch the handful of source revisions the facts point at and
	// slice the excerpt in JS instead of asking Postgres for a `substring()`.
	const revisionIds = [...new Set(entityFacts.map((f) => f.sourceRevisionId))];
	const sourceRevisions = revisionIds.length
		? await conn.query.revision.findMany({
				where: (revision, { inArray }) => inArray(revision.id, revisionIds),
				columns: { id: true, body: true }
			})
		: [];
	const bodyByRevisionId = new Map(sourceRevisions.map((r) => [r.id, r.body]));

	const facts = entityFacts.map((f) => ({
		id: f.id,
		statement: f.statement,
		spanStart: f.spanStart,
		spanEnd: f.spanEnd,
		authorKind: f.authorKind,
		// A quoted excerpt is read as prose, not rendered as markdown, so `[[Name]]` reduces
		// to `Name` here; the stored span itself (used for the in-body highlight) is untouched.
		sourceExcerpt: stripMentionSyntax(
			(bodyByRevisionId.get(f.sourceRevisionId) ?? '').slice(f.spanStart, f.spanEnd)
		)
	}));

	const [relations, history] = await Promise.all([
		relationsFor(conn, current.id),
		historyFor(conn, current.id)
	]);

	return {
		universe: { slug: world.slug, name: world.name },
		entity: {
			id: current.id,
			type: current.type,
			name: current.name,
			slug: current.slug,
			aliases: current.aliases,
			body: current.body,
			updatedAt: current.updatedAt
		},
		mentionTargets: universeEntities,
		relations,
		history,
		facts
	};
};
