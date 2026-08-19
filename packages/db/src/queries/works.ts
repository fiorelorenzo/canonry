/**
 * SPEC.md §4.3, issue #20, decision B5 = A. A work holds an ordered tree of `work_node`
 * (act / chapter / scene / encounter); `work_node_entity` records which entries a node
 * uses, which is what makes "Aldric Vane changed, and scene 3 of chapter 2 uses him" a
 * cheap read rather than a rebuild. B5's own "what this locks in" asks for two things
 * beyond the tree itself: an efficient reverse lookup (`scenesUsingEntity`, which entities'
 * gin-free lookup runs off `work_node_entity_entity_idx`) and a rule for what counts as
 * "changed" - this file takes B5's own assumption, "since last opened", and reads it as
 * "since this node was last saved" (`work_node.updated_at`), the only such timestamp the
 * schema actually carries.
 *
 * Reordering (issue #20's other half) swaps two siblings' `position` through a scratch
 * value of -1, because `work_node_sibling_position_key` is a plain (not deferred) unique
 * index: writing both siblings' final positions in one statement each would collide with
 * whichever one the transaction touches second.
 */
import { and, asc, desc, eq, isNull, notInArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { EntityType, WorkNodeKind, WorkStatus, WorkType } from '../schema/enums.js';
import { entity } from '../schema/entity.js';
import { work, workNode, workNodeEntity } from '../schema/work.js';

export type WorkRow = typeof work.$inferSelect;
export type WorkNodeRow = typeof workNode.$inferSelect;

function slugify(name: string): string {
	const base = name
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base.length > 0 ? base : 'work';
}

/** Every work in a universe, newest first - #20's index page. */
export async function listWorksForUniverse(db: Db, universeId: string): Promise<WorkRow[]> {
	return db
		.select()
		.from(work)
		.where(eq(work.universeId, universeId))
		.orderBy(desc(work.createdAt));
}

export interface CreateWorkInput {
	universeId: string;
	type: WorkType;
	name: string;
	summary?: string;
}

/** Slugs are namespaced under the universe, same as `entity` (`entity_universe_slug_key`),
 * so "Debts of Valdoria" never collides with a same-named work in someone else's world.
 * A bounded suffix loop rather than a bare insert-and-catch, matching how a GM actually
 * hits this: typing the same title twice by accident, not a race between two requests. */
export async function createWork(db: Db, input: CreateWorkInput): Promise<WorkRow> {
	const base = slugify(input.name);
	let slug = base;
	for (let suffix = 2; suffix < 100; suffix += 1) {
		const existing = await db.query.work.findFirst({
			where: (row, { and, eq }) => and(eq(row.universeId, input.universeId), eq(row.slug, slug))
		});
		if (!existing) break;
		slug = `${base}-${suffix}`;
	}

	const [row] = await db
		.insert(work)
		.values({
			universeId: input.universeId,
			type: input.type,
			name: input.name,
			slug,
			summary: input.summary ?? ''
		})
		.returning();
	if (!row) throw new Error('createWork: insert did not return a row');
	return row;
}

export async function workBySlug(
	db: Db,
	universeId: string,
	slug: string
): Promise<WorkRow | null> {
	const row = await db.query.work.findFirst({
		where: (row, { and, eq }) => and(eq(row.universeId, universeId), eq(row.slug, slug))
	});
	return row ?? null;
}

export async function workById(db: Db, workId: string): Promise<WorkRow | null> {
	const row = await db.query.work.findFirst({ where: (row, { eq }) => eq(row.id, workId) });
	return row ?? null;
}

export interface WorkNodeTreeItem {
	id: string;
	parentId: string | null;
	kind: WorkNodeKind;
	title: string;
	position: number;
	/** 0 for a root (act-level) node, incrementing per level down to encounter. */
	depth: number;
}

/** The whole tree, flattened into pre-order (parent immediately followed by its children,
 * each level ordered by `position`) - exactly the order B5's tree pane renders in, so the
 * route hands the array straight to the component with no further sorting. */
export async function workNodeTree(db: Db, workId: string): Promise<WorkNodeTreeItem[]> {
	const rows = await db
		.select({
			id: workNode.id,
			parentId: workNode.parentId,
			kind: workNode.kind,
			title: workNode.title,
			position: workNode.position
		})
		.from(workNode)
		.where(eq(workNode.workId, workId))
		.orderBy(asc(workNode.position));

	const childrenByParent = new Map<string | null, typeof rows>();
	for (const row of rows) {
		const key = row.parentId;
		const list = childrenByParent.get(key);
		if (list) list.push(row);
		else childrenByParent.set(key, [row]);
	}

	const flattened: WorkNodeTreeItem[] = [];
	function visit(parentId: string | null, depth: number): void {
		for (const child of childrenByParent.get(parentId) ?? []) {
			flattened.push({ ...child, depth });
			visit(child.id, depth + 1);
		}
	}
	visit(null, 0);
	return flattened;
}

export interface CreateWorkNodeInput {
	workId: string;
	parentId: string | null;
	kind: WorkNodeKind;
	title: string;
	body?: string;
}

/** Appends as the new last sibling under `parentId` (or at the root when null). Position
 * assignment and the insert happen in one transaction so two nodes added back to back
 * never race onto the same next slot. */
export async function createWorkNode(db: Db, input: CreateWorkNodeInput): Promise<WorkNodeRow> {
	return db.transaction(async (tx) => {
		const siblingFilter =
			input.parentId === null
				? and(eq(workNode.workId, input.workId), isNull(workNode.parentId))
				: and(eq(workNode.workId, input.workId), eq(workNode.parentId, input.parentId));

		const siblings = await tx
			.select({ position: workNode.position })
			.from(workNode)
			.where(siblingFilter)
			.orderBy(desc(workNode.position))
			.limit(1);
		const nextPosition = (siblings[0]?.position ?? -1) + 1;

		const [row] = await tx
			.insert(workNode)
			.values({
				workId: input.workId,
				parentId: input.parentId,
				kind: input.kind,
				title: input.title,
				body: input.body ?? '',
				position: nextPosition
			})
			.returning();
		if (!row) throw new Error('createWorkNode: insert did not return a row');
		return row;
	});
}

export async function workNodeById(db: Db, nodeId: string): Promise<WorkNodeRow | null> {
	const row = await db.query.workNode.findFirst({ where: (row, { eq }) => eq(row.id, nodeId) });
	return row ?? null;
}

/** Ancestors from the tree's root down to (but not including) `nodeId` itself, for the
 * breadcrumb ("Debts of Valdoria / Act 2 / Ch 2 / Scene 3"). Walks `parent_id` one row at a
 * time - the tree is at most four levels deep by design (SPEC.md §4.3), so this is at most
 * three extra round trips, never a recursive CTE's worth of machinery for it. */
export async function ancestorsOf(
	db: Db,
	nodeId: string
): Promise<Array<{ id: string; title: string }>> {
	const chain: Array<{ id: string; title: string }> = [];
	const start = await db.query.workNode.findFirst({
		where: (row, { eq }) => eq(row.id, nodeId),
		columns: { parentId: true }
	});

	let currentId = start?.parentId ?? null;
	const visited = new Set<string>();
	while (currentId && !visited.has(currentId)) {
		visited.add(currentId);
		const row = await db.query.workNode.findFirst({
			where: (row, { eq }) => eq(row.id, currentId as string),
			columns: { id: true, title: true, parentId: true }
		});
		if (!row) break;
		chain.unshift({ id: row.id, title: row.title });
		currentId = row.parentId;
	}
	return chain;
}

export interface UpdateWorkNodeInput {
	title?: string;
	body?: string;
}

export async function updateWorkNode(
	db: Db,
	nodeId: string,
	input: UpdateWorkNodeInput
): Promise<WorkNodeRow> {
	const [row] = await db
		.update(workNode)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(workNode.id, nodeId))
		.returning();
	if (!row) throw new Error(`updateWorkNode: no work_node with id "${nodeId}"`);
	return row;
}

/** Replaces a node's `work_node_entity` rows with exactly `entityIds` - the auto-link half
 * of B5: a scene's body is scanned for `[[Mention]]`s and this is what makes the "Uses"
 * list match what the prose actually names, without asking the GM to maintain a second
 * list by hand. A `note` a GM already wrote for an entity that is still mentioned survives
 * (only additions and removals touch the table); `onConflictDoNothing` is what makes a
 * mention that was already linked a no-op rather than a duplicate-key error. */
export async function setWorkNodeEntities(
	db: Db,
	nodeId: string,
	entityIds: string[]
): Promise<void> {
	const uniqueIds = [...new Set(entityIds)];
	await db.transaction(async (tx) => {
		if (uniqueIds.length > 0) {
			await tx
				.delete(workNodeEntity)
				.where(
					and(eq(workNodeEntity.nodeId, nodeId), notInArray(workNodeEntity.entityId, uniqueIds))
				);
			await tx
				.insert(workNodeEntity)
				.values(uniqueIds.map((entityId) => ({ nodeId, entityId })))
				.onConflictDoNothing();
		} else {
			await tx.delete(workNodeEntity).where(eq(workNodeEntity.nodeId, nodeId));
		}
	});
}

export interface WorkNodeUse {
	entityId: string;
	name: string;
	slug: string;
	type: EntityType;
	/** True when the entity changed (`entity.updated_at`) after this scene was last saved
	 * (`work_node.updated_at`) - decision B5's read-only freshness signal: "says so and
	 * links, and nothing more", never a second accept surface. */
	fresh: boolean;
	changedAt: Date;
}

/** The scene's own "Uses" list (B5's aside), each entity marked fresh or not against this
 * node's own `updated_at`. Returns `[]` for an unknown node rather than throwing, so a
 * caller can treat "no uses yet" and "node vanished mid-request" the same way at the UI. */
export async function usesForNode(db: Db, nodeId: string): Promise<WorkNodeUse[]> {
	const node = await db.query.workNode.findFirst({
		where: (row, { eq }) => eq(row.id, nodeId),
		columns: { updatedAt: true }
	});
	if (!node) return [];

	const rows = await db
		.select({
			entityId: entity.id,
			name: entity.name,
			slug: entity.slug,
			type: entity.type,
			changedAt: entity.updatedAt
		})
		.from(workNodeEntity)
		.innerJoin(entity, eq(entity.id, workNodeEntity.entityId))
		.where(eq(workNodeEntity.nodeId, nodeId))
		.orderBy(entity.name);

	return rows.map((row) => ({ ...row, fresh: row.changedAt > node.updatedAt }));
}

export interface SceneUsingEntity {
	nodeId: string;
	nodeTitle: string;
	workId: string;
	workName: string;
	workSlug: string;
}

/** The reverse of `usesForNode`: every scene across every work in the entity's universe
 * that uses it - B5's own "what this locks in" ("an efficient reverse lookup, which scenes
 * reference entity X"), backed by `work_node_entity_entity_idx`. */
export async function scenesUsingEntity(db: Db, entityId: string): Promise<SceneUsingEntity[]> {
	return db
		.select({
			nodeId: workNode.id,
			nodeTitle: workNode.title,
			workId: work.id,
			workName: work.name,
			workSlug: work.slug
		})
		.from(workNodeEntity)
		.innerJoin(workNode, eq(workNode.id, workNodeEntity.nodeId))
		.innerJoin(work, eq(work.id, workNode.workId))
		.where(eq(workNodeEntity.entityId, entityId))
		.orderBy(work.name, workNode.title);
}

export type MoveWorkNodeDirection = 'up' | 'down';

export interface MoveWorkNodeResult {
	moved: boolean;
}

/** Swaps `nodeId` with its previous ('up') or next ('down') sibling, ordered by
 * `position`. A no-op (`moved: false`) at either end of the sibling list - moving the
 * first node up, or the last one down - rather than an error, since "already at the top"
 * is a normal thing for a GM's click to discover. The swap goes through a scratch position
 * of -1 (never a value `createWorkNode` hands out, which always starts at 0) so the two
 * final `UPDATE`s never collide against `work_node_sibling_position_key`, which is not a
 * deferred constraint. */
export async function moveWorkNode(
	db: Db,
	nodeId: string,
	direction: MoveWorkNodeDirection
): Promise<MoveWorkNodeResult> {
	const node = await workNodeById(db, nodeId);
	if (!node) throw new Error(`moveWorkNode: no work_node with id "${nodeId}"`);

	const siblingFilter =
		node.parentId === null
			? and(eq(workNode.workId, node.workId), isNull(workNode.parentId))
			: and(eq(workNode.workId, node.workId), eq(workNode.parentId, node.parentId));

	const siblings = await db
		.select({ id: workNode.id, position: workNode.position })
		.from(workNode)
		.where(siblingFilter)
		.orderBy(asc(workNode.position));

	const index = siblings.findIndex((s) => s.id === nodeId);
	const targetIndex = direction === 'up' ? index - 1 : index + 1;
	if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) {
		return { moved: false };
	}
	const other = siblings[targetIndex];
	if (!other) return { moved: false };

	await db.transaction(async (tx) => {
		await tx
			.update(workNode)
			.set({ position: -1, updatedAt: new Date() })
			.where(eq(workNode.id, node.id));
		await tx
			.update(workNode)
			.set({ position: node.position, updatedAt: new Date() })
			.where(eq(workNode.id, other.id));
		await tx
			.update(workNode)
			.set({ position: other.position, updatedAt: new Date() })
			.where(eq(workNode.id, node.id));
	});

	return { moved: true };
}

export type { WorkNodeKind, WorkStatus, WorkType };
