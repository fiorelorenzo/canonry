import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { AuthorKind } from '../schema/enums.js';
import { fact } from '../schema/fact.js';
import { revision } from '../schema/revision.js';

export interface FactWithSource {
	id: string;
	universeId: string;
	entityId: string;
	statement: string;
	sourceRevisionId: string;
	spanStart: number;
	spanEnd: number;
	authorKind: AuthorKind;
	createdAt: Date;
	/** The exact substring of the source revision's body that [spanStart, spanEnd) covers. */
	sourceExcerpt: string;
}

/** #17 acceptance: the span resolves to the exact source sentence. */
export async function factWithSource(db: Db, factId: string): Promise<FactWithSource | undefined> {
	const rows = await db
		.select({
			id: fact.id,
			universeId: fact.universeId,
			entityId: fact.entityId,
			statement: fact.statement,
			sourceRevisionId: fact.sourceRevisionId,
			spanStart: fact.spanStart,
			spanEnd: fact.spanEnd,
			authorKind: fact.authorKind,
			createdAt: fact.createdAt,
			// substring() is 1-indexed, so span_start + 1 aligns with the 0-indexed
			// [span_start, span_end) convention the span columns are written in.
			sourceExcerpt: sql<string>`substring(${revision.body} from ${fact.spanStart} + 1 for ${fact.spanEnd} - ${fact.spanStart})`
		})
		.from(fact)
		.innerJoin(revision, eq(revision.id, fact.sourceRevisionId))
		.where(eq(fact.id, factId))
		.limit(1);
	return rows[0];
}
