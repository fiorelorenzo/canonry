import { error, fail, redirect } from '@sveltejs/kit';
import { eq, historyFor } from '@canonry/db';
import { entity, revision } from '@canonry/db/schema';
import { db } from '$lib/server/db';
import { normalizeMentions } from '$lib/markdown';
import type { Actions, PageServerLoad } from './$types';

async function loadUniverseAndEntity(universeSlug: string, entitySlug: string) {
	const conn = db();
	const world = await conn.query.universe.findFirst({
		where: (universe, { eq }) => eq(universe.slug, universeSlug)
	});
	if (!world) error(404, `No universe named "${universeSlug}"`);

	const current = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.universeId, world.id), eq(entity.slug, entitySlug))
	});
	if (!current) error(404, `No entry named "${entitySlug}" in ${world.name}`);

	return { conn, world, current };
}

async function mentionTargetsFor(conn: ReturnType<typeof db>, universeId: string) {
	return conn.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, universeId),
		columns: { name: true, slug: true, aliases: true }
	});
}

export const load: PageServerLoad = async ({ params }) => {
	const { conn, world, current } = await loadUniverseAndEntity(params.universe, params.slug);
	const universeEntities = await mentionTargetsFor(conn, world.id);

	return {
		universe: { slug: world.slug, name: world.name },
		entity: {
			id: current.id,
			type: current.type,
			name: current.name,
			slug: current.slug,
			aliases: current.aliases,
			body: current.body
		},
		mentionTargets: universeEntities
	};
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const { conn, world, current } = await loadUniverseAndEntity(params.universe, params.slug);

		const form = await request.formData();
		const rawBody = form.get('body');
		if (typeof rawBody !== 'string') {
			return fail(400, { message: 'Missing body' });
		}

		// Browsers normalise a form field's newlines to CRLF on submission (the HTML spec's
		// own "constructing the form data set" step), so `\r\n` here is form plumbing, not
		// something the GM typed - collapse it back to the plain `\n` every other body in
		// this database already uses. Never trust the client's own mention resolution
		// either: normalise against the entities that exist right now, loaded fresh in this
		// request (#105 acceptance).
		const universeEntities = await mentionTargetsFor(conn, world.id);
		const body = normalizeMentions(rawBody.replace(/\r\n/g, '\n'), universeEntities);

		const history = await historyFor(conn, current.id);
		const parentRevisionId = history[0]?.id;

		// One transaction: the revision row and the entity's own body move together, so
		// history is never out of step with what the entry currently shows (guardrail 2).
		// No auth yet (#86): a human save is attributed to the universe's own recorded
		// owner, already on record, rather than a fabricated session.
		await conn.transaction(async (tx) => {
			await tx.insert(revision).values({
				universeId: world.id,
				entityId: current.id,
				parentRevisionId,
				authorKind: 'human',
				authorUserId: world.ownerUserId,
				name: current.name,
				aliases: current.aliases,
				body
			});
			await tx.update(entity).set({ body, updatedAt: new Date() }).where(eq(entity.id, current.id));
		});

		redirect(303, `/u/${params.universe}/e/${params.slug}`);
	}
};
