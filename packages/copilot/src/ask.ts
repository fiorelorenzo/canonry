/**
 * Ask (SPEC.md §5, §7, issues #53/#60): "RAG over the universe... sources listed rather
 * than cited inline, follow-up questions, SSE streaming, five detail levels." Two
 * retrieval layers, both real:
 *
 * 1. **Your canon** - a deterministic Jaccard sentence search directly over this
 *    universe's `entity` bodies, zero cost, no model call. This is guardrail 4's "search
 *    over their own canon" (H1: "reading is free"), and it is the layer that stays up
 *    when generation is switched off: `runAsk` never gates this half on `aiEnabled`.
 * 2. **Indexed / derived corpus** - real retrieval through `@canonry/indexing`'s
 *    `retrieveForUniverse` against a real Qdrant collection (top-k 8, threshold 0.5,
 *    SPEC.md §11.4's own numbers), for a universe's own indexed wiki or, for a `derived`
 *    universe, its base universe's collection (SPEC.md §4.1: "the user's canon always
 *    wins", so this layer is additive, never a replacement for layer 1).
 *
 * A synthesized answer (layer 3) sits on top of both, streamed from a premium model and
 * charged `ask.answer` - the one part of Ask that is generation and needs `aiEnabled`.
 * With generation off, `runAsk` still returns a real answer: the best-matching sentences
 * from layer 1, quoted rather than claimed, so "an Ask answer stays available with AI
 * off" is literally true rather than a UI-level fallback string. Sources are computed
 * before any answer text exists, streamed or not - no answer is ever shown without them.
 *
 * Follow-up questions are derived deterministically from the sources actually returned
 * (SPEC.md §5 requires the feature, not that a model invent them), which also keeps them
 * grounded rather than adding a second billed call on top of the answer.
 */
import { chargeFor, ModelNotConfiguredError, resolveModel } from '@canonry/ai';
import { withQuota } from '@canonry/ai';
import type { Db } from '@canonry/db';
import { eq } from '@canonry/db';
import { entity, universe } from '@canonry/db/schema';
import { getDataSource } from '@canonry/db';
import {
	collectionExists,
	loreCollectionNameForModel,
	type LoreChunkPayload,
	type QdrantClient
} from '@canonry/vector';
import { retrieveForUniverse, type RetrievalHit } from '@canonry/indexing';
import { type Locale } from '@canonry/lang';
import { streamText } from 'ai';
import { jaccard, splitIntoSentences, tokenize } from './diff.js';
import { READING_ONLY_FALLBACK, TELL_ME_MORE, speechInstruction } from './speech.js';
import { routeModel } from './models.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import { requireAiEnabled } from './propagate.js';

/** SPEC.md §5: "five detail levels", shipped as a fixed row of buttons
 * (docs/ux/c8-ask-mode.html), never a settings dialog. */
export type AskDetailLevel = '1_line' | 'short' | 'normal' | 'detailed' | 'full';

export interface OwnCanonSource {
	kind: 'own_canon';
	entityId: string;
	entityName: string;
	entitySlug: string;
	statement: string;
	spanStart: number;
	spanEnd: number;
	score: number;
}

/** SPEC.md §7 / issue #60's minimum bar: "a derived-corpus card (badge, source name,
 * licence, link) that survives being narrow" - `attribution` and `licence` are shown on
 * *every* answer this source appears in, a legal requirement (SPEC.md §7), not a nicety.
 */
export interface IndexedSource {
	kind: 'indexed';
	dataSourceId: string;
	pageTitle: string;
	breadcrumb: string;
	url: string;
	text: string;
	attribution: string;
	licence: string | null;
	licenceUrl: string | null;
	score: number;
}

export type AskSource = OwnCanonSource | IndexedSource;

/** Injected exactly like `@canonry/indexing`'s own embedding seam, because it is that
 * seam - `Embedder` from `@canonry/indexing`. Typed locally to avoid a hard dependency on
 * that package's internal type name leaking through this file's signature unnecessarily.
 */
export type QueryEmbedder = (texts: string[]) => Promise<number[][]>;

const OWN_CANON_LIMIT = 3;
const INDEXED_TOP_K = 8;
const INDEXED_THRESHOLD = 0.5;

/** Layer 1, SPEC.md §5's "search over their own canon": every sentence in every entity's
 * current body, scored against the question by word overlap, best sentence per entity,
 * highest-scoring entities first. Deterministic, free, and never gated on `aiEnabled` -
 * this is what "reading is free" and "AI off still reads" mean in code. */
async function searchOwnCanon(
	db: Db,
	universeId: string,
	question: string
): Promise<OwnCanonSource[]> {
	const rows = await db
		.select({ id: entity.id, name: entity.name, slug: entity.slug, body: entity.body })
		.from(entity)
		.where(eq(entity.universeId, universeId));

	const questionTokens = tokenize(question);
	const scored: OwnCanonSource[] = [];
	for (const row of rows) {
		const sentences = splitIntoSentences(row.body).filter((s) => !s.startsWith('#'));
		let best: { sentence: string; score: number } | null = null;
		for (const sentence of sentences) {
			const score = jaccard(tokenize(sentence), questionTokens);
			if (!best || score > best.score) best = { sentence, score };
		}
		if (best && best.score > 0) {
			const start = row.body.indexOf(best.sentence);
			scored.push({
				kind: 'own_canon',
				entityId: row.id,
				entityName: row.name,
				entitySlug: row.slug,
				statement: best.sentence,
				spanStart: start,
				spanEnd: start + best.sentence.length,
				score: best.score
			});
		}
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, OWN_CANON_LIMIT);
}

/** Layer 2: real retrieval through `@canonry/indexing` against a real Qdrant collection.
 * SPEC.md §4.1: a `derived` universe reads its *base* universe's collection additively -
 * `retrieveForUniverse`'s own `policyUniverseId` keeps exclusions/supersessions scoped to
 * the universe the GM is actually in even though the vectors live under the base
 * universe's id. Returns `[]` (not an error) when the target collection does not exist
 * yet - a homebrew universe with no indexed source of its own is a normal state, not a
 * failure. */
async function searchIndexed(input: {
	db: Db;
	vectorClient: QdrantClient;
	embedder: QueryEmbedder;
	universeId: string;
	baseUniverseId: string | null;
	question: string;
}): Promise<IndexedSource[]> {
	// No `embedding` purpose configured yet is a normal state for a fresh deployment or a
	// universe with nothing indexed - layer 1 (own canon) still has to answer on its own,
	// so this returns no indexed sources rather than failing the whole question.
	let embeddingModel;
	try {
		embeddingModel = await resolveModel(input.db, 'embedding');
	} catch (err) {
		if (err instanceof ModelNotConfiguredError) return [];
		throw err;
	}
	const targetUniverseId = input.baseUniverseId ?? input.universeId;
	const collectionName = loreCollectionNameForModel(embeddingModel, targetUniverseId);
	if (!(await collectionExists(input.vectorClient, collectionName))) return [];

	const [queryVector] = await input.embedder([input.question]);
	if (!queryVector) return [];

	const hits: RetrievalHit[] = await retrieveForUniverse({
		db: input.db,
		vectorClient: input.vectorClient,
		collectionName,
		universeId: targetUniverseId,
		policyUniverseId: input.universeId,
		queryVector,
		queryText: input.question,
		topK: INDEXED_TOP_K,
		threshold: INDEXED_THRESHOLD
	});

	const dataSourceIds = [...new Set(hits.map((h) => h.payload.dataSourceId))];
	const dataSources = await Promise.all(dataSourceIds.map((id) => getDataSource(input.db, id)));
	const byId = new Map(dataSources.filter((d) => d !== null).map((d) => [d.id, d]));

	return hits.map((hit) => {
		const payload: LoreChunkPayload = hit.payload;
		const source = byId.get(payload.dataSourceId);
		return {
			kind: 'indexed',
			dataSourceId: payload.dataSourceId,
			pageTitle: payload.pageTitle,
			breadcrumb: payload.breadcrumb,
			url: payload.url,
			text: payload.text,
			attribution: source?.attribution ?? source?.name ?? 'indexed source',
			licence: source?.licence ?? null,
			licenceUrl: source?.licenceUrl ?? null,
			score: hit.score
		};
	});
}

/** Deterministic follow-ups from what was actually retrieved (never a second billed
 * call): one per distinct entity/page a source names, excluding none of them (the GM
 * asked about one thing; every source is a legitimate "tell me more"), capped at 2. */
function deriveFollowUps(locale: Locale, sources: AskSource[]): string[] {
	const names: string[] = [];
	for (const source of sources) {
		const name = source.kind === 'own_canon' ? source.entityName : source.pageTitle;
		if (!names.includes(name)) names.push(name);
	}
	return names.slice(0, 2).map((name) => TELL_ME_MORE[locale](name));
}

const DETAIL_LEVEL_INSTRUCTION: Record<AskDetailLevel, string> = {
	'1_line': 'Answer in exactly one short sentence.',
	short: 'Answer in two to three short sentences.',
	normal: 'Answer in one short paragraph.',
	detailed: 'Answer in two or three paragraphs with concrete detail.',
	full: 'Answer as fully as the sources support, organised into short paragraphs.'
};

function renderSourcesForPrompt(sources: AskSource[]): string {
	return sources
		.map((s, i) =>
			s.kind === 'own_canon'
				? `[${i + 1}] ${s.entityName} (your canon): "${s.statement}"`
				: `[${i + 1}] ${s.pageTitle} (indexed, ${s.attribution}): "${s.text}"`
		)
		.join('\n');
}

/** Layer 1's own honest fallback answer when generation is off: the best-matching
 * sentences quoted verbatim, never a synthesized claim - there is no model call here to
 * make one. */
function readingOnlyAnswer(locale: Locale, sources: OwnCanonSource[]): string {
	if (sources.length === 0) return READING_ONLY_FALLBACK[locale];
	return sources
		.slice(0, 2)
		.map((s) => s.statement)
		.join(' ');
}

export interface AskInput {
	db: Db;
	userId: string;
	universeId: string;
	question: string;
	/** SPEC.md §17 rule two (issue #123): the interface locale of whoever asked - the
	 * synthesized answer, the reading-only fallback and the deterministic follow-ups are
	 * all written in this, never in the language of the sources they draw from. */
	locale: Locale;
	detailLevel: AskDetailLevel;
	vectorClient: QdrantClient;
	embedder: QueryEmbedder;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	/** Fired once, with sources and follow-ups, before any answer text exists - streamed
	 * or not. This is what lets a caller guarantee sources are shown beside an answer from
	 * the first frame, never briefly missing while a stream is still arriving. */
	onSources?: (sources: AskSource[], followUps: string[]) => void;
	/** Called with each answer text chunk as it streams (SPEC.md §5's SSE requirement). */
	onToken?: (delta: string) => void;
	requestId?: string;
}

export interface AskResult {
	answer: string;
	sources: AskSource[];
	followUps: string[];
	/** `false` when this is layer 1's reading-only fallback (generation switched off for
	 * this universe) - the answer is real either way, this only says whether a model
	 * wrote it. */
	generated: boolean;
	credits: number;
}

/** SPEC.md §5/§7, issues #53/#60. Retrieval (both layers) always runs, at zero cost,
 * whether or not generation is on - guardrail 4's "what remains is a good wiki" is this
 * function returning a real, sourced answer even with `aiEnabled: false`. The premium
 * streamed synthesis only runs, and only spends `ask.answer` credits, when generation is
 * on. */
export async function runAsk(input: AskInput): Promise<AskResult> {
	const [universeRow] = await input.db
		.select({
			aiEnabled: universe.aiEnabled,
			kind: universe.kind,
			baseUniverseId: universe.baseUniverseId
		})
		.from(universe)
		.where(eq(universe.id, input.universeId))
		.limit(1);
	if (!universeRow) throw new Error(`no universe row for id "${input.universeId}"`);

	const [ownCanon, indexed] = await Promise.all([
		searchOwnCanon(input.db, input.universeId, input.question),
		searchIndexed({
			db: input.db,
			vectorClient: input.vectorClient,
			embedder: input.embedder,
			universeId: input.universeId,
			baseUniverseId: universeRow.kind === 'derived' ? universeRow.baseUniverseId : null,
			question: input.question
		})
	]);
	const sources: AskSource[] = [...ownCanon, ...indexed];
	const followUps = deriveFollowUps(input.locale, sources);
	input.onSources?.(sources, followUps);

	if (!universeRow.aiEnabled) {
		const answer = readingOnlyAnswer(input.locale, ownCanon);
		input.onToken?.(answer);
		return { answer, sources, followUps, generated: false, credits: 0 };
	}

	await requireAiEnabled(input.db, input.universeId);

	const premiumModel = routeModel(
		await resolveModel(input.db, 'premium'),
		input.modelFactory,
		input.gateway
	);
	const [result, price] = await Promise.all([
		withQuota(
			input.db,
			premiumModel.resolved,
			{
				userId: input.userId,
				universeId: input.universeId,
				agent: 'loremaster',
				operation: 'ask.answer',
				...(input.requestId !== undefined
					? { requestId: input.requestId, idempotencyKey: input.requestId }
					: {})
			},
			async () => {
				const stream = streamText({
					model: premiumModel.languageModel,
					system:
						"You are the Loremaster, answering a GM's question about their game world from " +
						'the sources below only. Never invent a fact the sources do not support. Do not ' +
						'cite sources inline with numbers or brackets - they are listed separately. ' +
						DETAIL_LEVEL_INSTRUCTION[input.detailLevel] +
						' ' +
						speechInstruction(input.locale),
					prompt:
						`Sources:\n${renderSourcesForPrompt(sources) || '(none found)'}\n\n` +
						`Question: ${input.question}`
				});
				let text = '';
				for await (const delta of stream.textStream) {
					text += delta;
					input.onToken?.(delta);
				}
				const usage = await stream.usage;
				return { text, usage };
			},
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens ?? 0,
					outputTokens: r.usage.outputTokens ?? 0
				})
			}
		),
		chargeFor(input.db, 'ask.answer')
	]);

	return { answer: result.text, sources, followUps, generated: true, credits: price.credits };
}
