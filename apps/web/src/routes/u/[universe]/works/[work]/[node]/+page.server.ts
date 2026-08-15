/**
 * `/u/[universe]/works/[work]/[node]`: a scene (or act/chapter/encounter) next to the
 * canon it draws on, decision B5 = A. Saving a node's body auto-syncs `work_node_entity`
 * from whatever `[[Mention]]`s the prose actually contains - the same resolution
 * `normalizeMentions` already uses for entries, so "uses" never drifts from what the text
 * says. The "Uses" list itself (`usesForNode`) is read-only here on purpose: B5's own
 * guardrail callout is explicit that this signal says so and links, never a second place
 * to accept or reject a propagation.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import {
	ancestorsOf,
	createWorkNode,
	moveWorkNode,
	setWorkNodeEntities,
	universeAccessBySlug,
	updateWorkNode,
	usesForNode,
	workBySlug,
	workNodeById,
	type Db
} from '@canonry/db';
import type { WorkNodeKind } from '@canonry/db/schema';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import { normalizeMentions, resolveMentionName, type MentionTarget } from '$lib/markdown';
import type { Actions, PageServerLoad } from './$types';

const WORK_NODE_KINDS: WorkNodeKind[] = ['act', 'chapter', 'scene', 'encounter'];

function isWorkNodeKind(value: FormDataEntryValue | null): value is WorkNodeKind {
	return typeof value === 'string' && (WORK_NODE_KINDS as string[]).includes(value);
}

interface UniverseEntityRow extends MentionTarget {
	id: string;
}

async function mentionTargetsFor(conn: Db, universeId: string): Promise<UniverseEntityRow[]> {
	return conn.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, universeId),
		columns: { id: true, name: true, slug: true, aliases: true }
	});
}

/** Every `[[Name]]` in `body` that resolves against `targets`, as entity ids - the set
 * `setWorkNodeEntities` writes as this node's "Uses". */
function mentionedEntityIds(body: string, targets: UniverseEntityRow[]): string[] {
	const bySlug = new Map(targets.map((target) => [target.slug, target.id]));
	const ids = new Set<string>();
	for (const match of body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
		const name = match[1];
		if (!name) continue;
		const resolved = resolveMentionName(name, targets);
		const id = resolved && bySlug.get(resolved.slug);
		if (id) ids.add(id);
	}
	return [...ids];
}

/**
 * Issue #86: re-checked here for the same reason entry edit's action re-checks it - a POST
 * runs before any layout `load`. Also confirms the node actually belongs to the work named
 * in the URL, in this universe: `workNodeById` takes a bare id with no universe scoping of
 * its own, so a stray id from a different universe's work must not resolve here.
 */
async function loadAccessAndNode(
	locals: App.Locals,
	universeSlug: string,
	workSlug: string,
	nodeId: string
) {
	if (!locals.user) error(404, `No universe named "${universeSlug}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, `No universe named "${universeSlug}"`);

	const work = await workBySlug(conn, access.universe.id, workSlug);
	if (!work) error(404, `No work named "${workSlug}" in ${access.universe.name}`);

	const node = await workNodeById(conn, nodeId);
	if (!node || node.workId !== work.id) error(404, 'No such node');

	return { conn, access, work, node };
}

export const load: PageServerLoad = async ({ parent, params }) => {
	const { current, work } = await parent();
	const conn = db();

	const node = await workNodeById(conn, params.node);
	if (!node || node.workId !== work.id) error(404, 'No such node');

	const [ancestors, uses, mentionTargets] = await Promise.all([
		ancestorsOf(conn, node.id),
		usesForNode(conn, node.id),
		mentionTargetsFor(conn, current.id)
	]);

	return {
		node: {
			id: node.id,
			kind: node.kind,
			title: node.title,
			body: node.body,
			parentId: node.parentId
		},
		ancestors,
		uses,
		mentionTargets
	};
};

export const actions: Actions = {
	save: async ({ request, params, locals }) => {
		const { conn, access, node } = await loadAccessAndNode(
			locals,
			params.universe,
			params.work,
			params.node
		);
		if (access.role === 'viewer') error(403, 'Viewers cannot edit a work');

		const form = await request.formData();
		const title = form.get('title');
		const rawBody = form.get('body');
		if (typeof title !== 'string' || title.trim().length === 0) {
			return fail(400, { message: messages(locals.locale).works.errors.nodeNeedsTitle });
		}
		if (typeof rawBody !== 'string') {
			return fail(400, { message: messages(locals.locale).works.errors.missingBody });
		}

		const targets = await mentionTargetsFor(conn, access.universe.id);
		const body = normalizeMentions(rawBody.replace(/\r\n/g, '\n'), targets);

		await updateWorkNode(conn, node.id, { title: title.trim(), body });
		await setWorkNodeEntities(conn, node.id, mentionedEntityIds(body, targets));

		redirect(303, `/u/${params.universe}/works/${params.work}/${node.id}`);
	},

	addChild: async ({ request, params, locals }) => {
		const { conn, access, node } = await loadAccessAndNode(
			locals,
			params.universe,
			params.work,
			params.node
		);
		if (access.role === 'viewer') error(403, 'Viewers cannot edit a work');

		const form = await request.formData();
		const title = form.get('title');
		const kind = form.get('kind');
		if (typeof title !== 'string' || title.trim().length === 0) {
			return fail(400, { message: messages(locals.locale).works.errors.nodeNeedsTitle });
		}
		if (!isWorkNodeKind(kind)) {
			return fail(400, { message: messages(locals.locale).works.errors.pickNodeKind });
		}

		const child = await createWorkNode(conn, {
			workId: node.workId,
			parentId: node.id,
			kind,
			title: title.trim()
		});

		redirect(303, `/u/${params.universe}/works/${params.work}/${child.id}`);
	},

	moveUp: async ({ params, locals }) => {
		const { conn, access, node } = await loadAccessAndNode(
			locals,
			params.universe,
			params.work,
			params.node
		);
		if (access.role === 'viewer') error(403, 'Viewers cannot edit a work');
		await moveWorkNode(conn, node.id, 'up');
		return { moved: true };
	},

	moveDown: async ({ params, locals }) => {
		const { conn, access, node } = await loadAccessAndNode(
			locals,
			params.universe,
			params.work,
			params.node
		);
		if (access.role === 'viewer') error(403, 'Viewers cannot edit a work');
		await moveWorkNode(conn, node.id, 'down');
		return { moved: true };
	}
};
