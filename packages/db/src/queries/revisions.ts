import { desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { revision } from '../schema/revision.js';

/** #18 acceptance and guardrail 2's persistence half: newest first, author_kind intact. */
export async function historyFor(db: Db, entityId: string) {
	return db
		.select()
		.from(revision)
		.where(eq(revision.entityId, entityId))
		.orderBy(desc(revision.createdAt));
}
