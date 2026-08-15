/**
 * Lore-chunk payload and queries (SPEC.md §11.3, issues #57/#62). Wraps the generic
 * points layer with the one rule that is not optional here: "queries always filter by
 * universe_id; cross-universe contamination is a bug" - `queryLore` has no way to omit
 * `universeId`, unlike the generic `queryPoints` it sits on.
 *
 * Stored payload keys are snake_case on the wire (matching SPEC.md §11.3's own spelling
 * of `universe_id` / `data_source_id`, and ai-game's Qdrant payload convention this
 * pipeline is "copied in spirit" from); the TypeScript-facing shape stays camelCase and
 * converts at this module's boundary, so nothing outside this file has to remember which
 * convention Qdrant's wire format uses.
 */
import type { QdrantClient } from '@qdrant/js-client-rest';
import {
	upsertPoints,
	queryPoints,
	deletePoints,
	scrollPoints,
	type VectorFilterCondition
} from './points.js';

/** SPEC.md §11.3: "payload carrying text, breadcrumb, page title and url, timestamps,
 * universe_id, data_source_id and the three extracted metadata fields." `pageUpdatedAt`
 * is the wiki's own revision timestamp - packages/indexing's idempotency check (issue
 * #58) compares against this field, not `indexedAt`, which only records when this
 * pipeline last wrote the chunk. */
export interface LoreChunkPayload {
	text: string;
	breadcrumb: string;
	pageTitle: string;
	url: string;
	pageUpdatedAt: string;
	indexedAt: string;
	universeId: string;
	dataSourceId: string;
	sectionSummary: string;
	questionsThisExcerptCanAnswer: string[];
	excerptKeywords: string[];
	/** SPEC.md §17 (issue #125): the chunk's own content language, a BCP-47 primary
	 * subtag ('en', 'it') or `null` when it was not detected (too short, mostly proper
	 * nouns, or genuinely mixed - see `@canonry/lang`'s `detectLanguage`). This is
	 * metadata for a future ranking signal, never a retrieval filter: SPEC.md §17 is
	 * explicit that a query in one language must still find a chunk in the other, so
	 * nothing in this package or `@canonry/indexing`'s retriever may add a
	 * `language`-keyed `must`/`must_not` condition to a lore query. */
	language: string | null;
}

export interface LoreChunk {
	id: string;
	vector: number[];
	payload: LoreChunkPayload;
}

function toWirePayload(payload: LoreChunkPayload): Record<string, unknown> {
	return {
		text: payload.text,
		breadcrumb: payload.breadcrumb,
		page_title: payload.pageTitle,
		url: payload.url,
		page_updated_at: payload.pageUpdatedAt,
		indexed_at: payload.indexedAt,
		universe_id: payload.universeId,
		data_source_id: payload.dataSourceId,
		section_summary: payload.sectionSummary,
		questions_this_excerpt_can_answer: payload.questionsThisExcerptCanAnswer,
		excerpt_keywords: payload.excerptKeywords,
		language: payload.language
	};
}

function fromWirePayload(raw: Record<string, unknown>): LoreChunkPayload {
	return {
		text: raw.text as string,
		breadcrumb: raw.breadcrumb as string,
		pageTitle: raw.page_title as string,
		url: raw.url as string,
		pageUpdatedAt: raw.page_updated_at as string,
		indexedAt: raw.indexed_at as string,
		universeId: raw.universe_id as string,
		dataSourceId: raw.data_source_id as string,
		sectionSummary: raw.section_summary as string,
		questionsThisExcerptCanAnswer: (raw.questions_this_excerpt_can_answer as string[]) ?? [],
		excerptKeywords: (raw.excerpt_keywords as string[]) ?? [],
		language: (raw.language as string | null | undefined) ?? null
	};
}

export async function upsertLoreChunks(
	client: QdrantClient,
	collectionName: string,
	chunks: LoreChunk[]
): Promise<void> {
	await upsertPoints(
		client,
		collectionName,
		chunks.map((chunk) => ({
			id: chunk.id,
			vector: chunk.vector,
			payload: toWirePayload(chunk.payload)
		}))
	);
}

/** Case-insensitive glob match: `*` matches any run of characters, everything else is
 * literal. Enough for issue #62's exclusion patterns ("stop using this wiki" as
 * `https://wiki.example.com/*`, or a single page's exact url) without pulling in a glob
 * library for one operator. */
export function urlMatchesPattern(url: string, pattern: string): boolean {
	const escaped = pattern
		.split('*')
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('.*');
	return new RegExp(`^${escaped}$`, 'i').test(url);
}

export interface LoreQuery {
	vector: number[];
	/** SPEC.md §11.3: mandatory, not optional - the type itself is the enforcement. */
	universeId: string;
	/** issue #62: url patterns to drop from the result, matched against `payload.url`.
	 * Qdrant has no glob match operator, so this is applied client-side after the vector
	 * search rather than pushed into the Qdrant filter. */
	excludedUrlPatterns?: string[];
	limit?: number;
	scoreThreshold?: number;
}

export interface LoreHit {
	id: string;
	score: number;
	payload: LoreChunkPayload;
}

export async function queryLore(
	client: QdrantClient,
	collectionName: string,
	query: LoreQuery
): Promise<LoreHit[]> {
	const must: VectorFilterCondition[] = [{ key: 'universe_id', value: query.universeId }];
	const hits = await queryPoints(client, collectionName, {
		vector: query.vector,
		filter: { must },
		...(query.limit !== undefined ? { limit: query.limit } : {}),
		...(query.scoreThreshold !== undefined ? { scoreThreshold: query.scoreThreshold } : {})
	});
	const parsed = hits.map((hit) => ({ ...hit, payload: fromWirePayload(hit.payload) }));
	if (!query.excludedUrlPatterns?.length) return parsed;
	const patterns = query.excludedUrlPatterns;
	return parsed.filter(
		(hit) => !patterns.some((pattern) => urlMatchesPattern(hit.payload.url, pattern))
	);
}

export async function deleteLorePage(
	client: QdrantClient,
	collectionName: string,
	params: { universeId: string; dataSourceId: string; url: string }
): Promise<void> {
	await deletePoints(client, collectionName, {
		must: [
			{ key: 'universe_id', value: params.universeId },
			{ key: 'data_source_id', value: params.dataSourceId },
			{ key: 'url', value: params.url }
		]
	});
}

/** Reads the stored `pageUpdatedAt` for a page's existing chunks, or `null` if the page
 * has never been indexed - the idempotency check of issue #58: an unchanged page's own
 * `updatedAt` from the wiki compares equal to this, and the pipeline skips it entirely. */
export async function findPageUpdatedAt(
	client: QdrantClient,
	collectionName: string,
	params: { universeId: string; dataSourceId: string; url: string }
): Promise<string | null> {
	const must: VectorFilterCondition[] = [
		{ key: 'universe_id', value: params.universeId },
		{ key: 'data_source_id', value: params.dataSourceId },
		{ key: 'url', value: params.url }
	];
	const records = await scrollPoints(client, collectionName, { filter: { must }, limit: 1 });
	const first = records[0];
	if (!first) return null;
	const updatedAt = first.payload.page_updated_at;
	return typeof updatedAt === 'string' ? updatedAt : null;
}
