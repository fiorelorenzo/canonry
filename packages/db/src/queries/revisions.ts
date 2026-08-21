import { desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { revision } from '../schema/revision.js';
import { user } from '../schema/auth.js';

/** #18 acceptance and guardrail 2's persistence half: newest first, author_kind intact.
 *
 * Issue #453 (U7): left-joined against `user` for the human author's display name -
 * "by whom" for a human-authored revision means the actual GM who wrote it, not only the
 * `human` kind `RevisionBadge` already carries, since a universe can have more than one
 * writer (`universe_member`'s `editor` role). `authorName` is null for an `ai_accepted`
 * revision (no human author, only a later acceptor recorded on the proposal's own
 * `decided_by`) and for a seed-fixture or otherwise orphaned `author_user_id` - the left
 * join simply returns null rather than dropping the row. `proposalId` rides along
 * unchanged (guardrail 2's other half): `HistoryPanel.svelte` links a revision that
 * carries one to `/w/<universe>/review/<proposalId>`. */
export async function historyFor(db: Db, entityId: string) {
	return db
		.select({
			id: revision.id,
			universeId: revision.universeId,
			entityId: revision.entityId,
			parentRevisionId: revision.parentRevisionId,
			authorKind: revision.authorKind,
			authorUserId: revision.authorUserId,
			authorName: user.name,
			proposalId: revision.proposalId,
			name: revision.name,
			aliases: revision.aliases,
			body: revision.body,
			createdAt: revision.createdAt
		})
		.from(revision)
		.leftJoin(user, eq(user.id, revision.authorUserId))
		.where(eq(revision.entityId, entityId))
		.orderBy(desc(revision.createdAt));
}
