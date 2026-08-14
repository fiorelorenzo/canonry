import { error, fail, redirect } from '@sveltejs/kit';
import { type Db, eq, historyFor, universeAccessBySlug } from '@canonry/db';
import { entity, revision } from '@canonry/db/schema';
import { db } from '$lib/server/db';
import { scheduleCanonSaveJob } from '$lib/server/jobs';
import { normalizeMentions } from '$lib/markdown';
import type { Actions, PageServerLoad } from './$types';

/**
 * Issue #86: the layout's `load` already gates page views for this whole subtree
 * (`u/[universe]/+layout.server.ts`), but SvelteKit runs a POST action before any
 * layout load, so this route needs its own membership check too - the same reasoning
 * `requireAdmin`'s doc comment gives for /admin. `locals.user` is guaranteed non-null
 * by that same layout for a page view, but a raw POST to this action's URL is not a
 * page view, so it is re-checked here rather than assumed.
 */
async function loadUniverseAndEntity(locals: App.Locals, universeSlug: string, entitySlug: string) {
	if (!locals.user) error(404, `No universe named "${universeSlug}"`);

	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, `No universe named "${universeSlug}"`);
	const world = access.universe;

	const current = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.universeId, world.id), eq(entity.slug, entitySlug))
	});
	if (!current) error(404, `No entry named "${entitySlug}" in ${world.name}`);

	return { conn, world, current, role: access.role, userId: locals.user.id };
}

async function mentionTargetsFor(conn: Db, universeId: string) {
	return conn.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, universeId),
		columns: { name: true, slug: true, aliases: true }
	});
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { conn, world, current } = await loadUniverseAndEntity(
		locals,
		params.universe,
		params.slug
	);
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
	default: async ({ request, params, locals }) => {
		const { conn, world, current, role, userId } = await loadUniverseAndEntity(
			locals,
			params.universe,
			params.slug
		);
		// A viewer can see this page (the layout already let them in) but may not write
		// to it - a 403, not a 404, since existence is not what is being hidden here.
		if (role === 'viewer') error(403, 'Viewers cannot edit entries');

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
		// Issue #86: attributed to the real signed-in account, not the universe's
		// recorded owner - a member editing someone else's universe now shows up as
		// themselves in history, not as the owner they are not.
		let insertedRevisionId: string | null = null;
		await conn.transaction(async (tx) => {
			const [rev] = await tx
				.insert(revision)
				.values({
					universeId: world.id,
					entityId: current.id,
					parentRevisionId,
					authorKind: 'human',
					authorUserId: userId,
					name: current.name,
					aliases: current.aliases,
					body
				})
				.returning({ id: revision.id });
			insertedRevisionId = rev?.id ?? null;
			await tx.update(entity).set({ body, updatedAt: new Date() }).where(eq(entity.id, current.id));
		});

		// SPEC.md §5.1/§5.2: propagation and audit run "on save, debounced, in the
		// background" - scheduled here, after the transaction above has committed, so the
		// background job only ever reads a body Postgres has already durably written.
		// Fire and forget: the redirect below does not wait on it (`$lib/server/jobs`'s own
		// header comment is the design note for why there is nothing to await here).
		scheduleCanonSaveJob({
			universeId: world.id,
			entityId: current.id,
			entityName: current.name,
			userId,
			oldBody: current.body,
			newBody: body,
			triggerRevisionId: insertedRevisionId
		});

		redirect(303, `/u/${params.universe}/e/${params.slug}`);
	}
};
