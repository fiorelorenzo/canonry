/**
 * Issue #75: "the instant lane means an indexed query on names and aliases rather than a
 * vector search, with the fast lane as the fallback when the exact match misses."
 *
 * The instant lane (`searchEntitiesByNameOrAlias`, `@canonry/db`) is the whole answer when
 * it hits: no model, one indexed query, well under the 100 ms budget. The fast lane only
 * runs when the instant lane comes back empty, and it is real, not a stub: it embeds the
 * query through `@canonry/media`'s `GatewayEmbeddingProvider` (a raw HTTP call to the
 * gateway's embedding proxy - the same mechanism the similarity cache already uses, no
 * missing AI SDK provider dependency involved) and queries the universe's own Qdrant lore
 * collection. If nothing has ever been indexed for this universe - true of a fresh universe
 * that has not run an indexing job yet - this says so plainly instead of throwing, which
 * matches E2's "a card that will never warm this session says so plainly" discipline
 * extended to search.
 */
import {
	chargeFor,
	ModelNotConfiguredError,
	resolveModel,
	type GatewayCredentials
} from '@canonry/ai';
import type { Db, EntitySearchHit } from '@canonry/db';
import { searchEntitiesByNameOrAlias } from '@canonry/db';
import { GatewayEmbeddingProvider, type EmbeddingProvider } from '@canonry/media';
import {
	collectionExists,
	loreCollectionNameForModel,
	queryLore,
	type QdrantClient
} from '@canonry/vector';
import { messages, type Locale } from '$lib/i18n';
import { stripMentionSyntax } from '$lib/markdown';
import type { FastLaneHit } from '$lib/components/table/types';

export type SearchResult =
	| { lane: 'instant'; hits: EntitySearchHit[] }
	| { lane: 'fast'; hits: FastLaneHit[] }
	| { lane: 'fast'; hits: []; unavailableReason: string };

const FAST_LANE_TOP_K = 8;
const FAST_LANE_THRESHOLD = 0.5;

/** #75's instant lane, standing alone - the primary path, and the only one most searches
 * ever need. */
export async function instantSearch(
	db: Db,
	universeId: string,
	query: string,
	opts?: { type?: 'character' | 'place' | 'faction' | 'item' | 'event' | 'session' }
): Promise<EntitySearchHit[]> {
	const hits = await searchEntitiesByNameOrAlias(db, universeId, query, {
		type: opts?.type,
		limit: 8
	});
	// `excerpt` quotes raw `entity.body` text as reading prose, not markdown - a "who is
	// this" card read mid-scene should never show `[[double brackets]]` syntax, same
	// discipline `stripMentionSyntax`'s other callers (the Facts panel, image prompts)
	// already apply to a body excerpt.
	return hits.map((hit) => ({ ...hit, excerpt: stripMentionSyntax(hit.excerpt) }));
}

/**
 * "The fast lane as the fallback when the exact match misses." Tries the real embedding
 * call and the real Qdrant query; every failure mode (no embedding model configured, no
 * collection indexed yet, the gateway rejecting the request) returns a hit-free result with
 * a plain-language `unavailableReason` rather than throwing past the caller.
 */
export async function fastLaneSearch(
	deps: {
		db: Db;
		userId: string;
		qdrant: QdrantClient;
		/** Thunks, not resolved values - reading either from the environment can throw
		 * (`MissingGatewayEnvError`, `MissingEmbeddingApiTokenError`), and that has to land
		 * in the same catch as an embedding call failing, not crash the whole search request
		 * before this function's own "nothing indexed yet" / "model not configured" checks
		 * even run. */
		gatewayCredentials: () => GatewayCredentials;
		/** The GM's interface language (SPEC.md §17), for this function's own deterministic
		 * "unavailable" text only - `ModelNotConfiguredError`'s own message (`@canonry/ai`)
		 * passes through untranslated, same as any other package-owned error surfaced here. */
		locale: Locale;
	},
	universeId: string,
	query: string
): Promise<SearchResult> {
	const t = messages(deps.locale).table.server;
	let resolved;
	try {
		resolved = await resolveModel(deps.db, 'embedding');
	} catch (err) {
		if (!(err instanceof ModelNotConfiguredError)) throw err;
		return { lane: 'fast', hits: [], unavailableReason: err.message };
	}

	const collectionName = loreCollectionNameForModel(resolved, universeId);
	if (!(await collectionExists(deps.qdrant, collectionName))) {
		return {
			lane: 'fast',
			hits: [],
			unavailableReason: t.nothingIndexedYet
		};
	}

	let vector: number[];
	try {
		const provider: EmbeddingProvider = new GatewayEmbeddingProvider({
			db: deps.db,
			credentials: deps.gatewayCredentials(),
			userId: deps.userId,
			universeId,
			agent: 'loremaster',
			operation: 'search.semantic'
		});
		vector = await provider.embed(query);
	} catch (err) {
		const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		return { lane: 'fast', hits: [], unavailableReason: t.embeddingFailed(reason) };
	}

	// search.semantic is priced at 0 credits (reading is free, H1) but the call is still
	// recorded in full - resolve the price for the record even though nothing is charged.
	await chargeFor(deps.db, 'search.semantic');

	const hits = await queryLore(deps.qdrant, collectionName, {
		vector,
		universeId,
		limit: FAST_LANE_TOP_K,
		scoreThreshold: FAST_LANE_THRESHOLD
	});

	return {
		lane: 'fast',
		hits: hits.map((hit) => ({
			title: hit.payload.pageTitle,
			url: hit.payload.url,
			breadcrumb: hit.payload.breadcrumb,
			score: hit.score,
			excerpt: hit.payload.text.slice(0, 200)
		}))
	};
}
