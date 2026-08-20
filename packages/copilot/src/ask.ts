/**
 * Ask (SPEC.md §5, §7, issues #53/#60): "RAG over the universe... sources listed rather
 * than cited inline, follow-up questions, SSE streaming, five detail levels." Two
 * retrieval layers, both real:
 *
 * 1. **Your canon** - a deterministic Jaccard sentence search directly over this
 *    universe's `entity` bodies, over content words only (issue #346: sharing the word
 *    `the` used to be enough to be cited), zero cost, no model call. This is guardrail 4's
 *    "search over their own canon" (H1: "reading is free"), and it is the layer that stays
 *    up when generation is switched off: `runAsk` never gates this half on `aiEnabled`.
 * 2. **Indexed / derived corpus** - real retrieval through `@canonry/indexing`'s
 *    `retrieveForUniverse` against a real Qdrant collection. Top-k and threshold are not
 *    restated here as numbers on purpose (see `retriever.ts`'s own `DEFAULT_TOP_K`/
 *    `DEFAULT_THRESHOLD` comment for what is actually shipped and why): this file used to
 *    quote SPEC.md §11.4's original "top-k 8, threshold 0.5" here too, and that copy went
 *    stale the moment issue #168 re-derived the threshold to 0.35 for the current
 *    embedding model - a second place stating the number is a second place that can be
 *    wrong. For a universe's own indexed wiki or, for a `derived` universe, its base
 *    universe's collection (SPEC.md §4.1: "the user's canon always wins", so this layer
 *    is additive, never a replacement for layer 1).
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
import {
	DEFAULT_THRESHOLD,
	DEFAULT_TOP_K,
	retrieveForUniverse,
	type RetrievalHit
} from '@canonry/indexing';
import { functionWords, type Locale } from '@canonry/lang';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { jaccard, splitIntoSentences, tokenize } from './diff.js';
import { READING_ONLY_FALLBACK, TELL_ME_MORE, speechInstruction } from './speech.js';
import { routeModel } from './models.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import { requireAiEnabled } from './propagate.js';
import { entryEditPropose, entryPropose, type ProposeResult } from './ask-propose.js';

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

// Bounds three things at once: what's shown in the UI, what the model is given in the
// prompt, and what entry_propose/entry_edit_propose ground their drafts on (all three
// read the same `ownCanon` array runAsk computes once). The cost of raising it is prompt
// tokens and a taller source list on screen, never correctness - own-canon retrieval is
// free and deterministic. 3 was hiding a real fourth citation (the Aldric Vane demo
// question has four relevant sentences across its sources, and guardrail 3 says every
// proposal shows its evidence, not "shows up to three"). Kept as one number rather than
// split per consumer: the UI list is a plain flex column with no fixed-height clip (it
// scrolls with the page), so there's no rendering reason for the UI to want fewer than
// the model gets, and nothing here has ever measured a token-cost or relevance cliff
// that would justify giving the model and the screen different limits. Since #346 it is
// rarely the binding constraint: on the sample world the content-word gate below leaves
// between 0 and 7 candidates for a real question, where every question used to leave
// enough to fill it.
const OWN_CANON_LIMIT = 6;

/** The tokenized form of a locale's function words, built once per locale from
 * `@canonry/lang`'s list through this package's own `tokenize`, because the comparison has
 * to happen in the tokenizer's alphabet: it drops accents, so Italian `perché` and a canon
 * sentence's `perché` both arrive here as `perch`, and a list compared in its written form
 * would miss both. */
const functionTokensByLocale = new Map<Locale, ReadonlySet<string>>();

function functionTokens(locale: Locale): ReadonlySet<string> {
	const cached = functionTokensByLocale.get(locale);
	if (cached) return cached;
	const tokens = new Set<string>();
	for (const word of functionWords(locale)) for (const token of tokenize(word)) tokens.add(token);
	functionTokensByLocale.set(locale, tokens);
	return tokens;
}

function contentTokens(text: string, functionTokenSet: ReadonlySet<string>): Set<string> {
	const tokens = tokenize(text);
	for (const token of tokens) if (functionTokenSet.has(token)) tokens.delete(token);
	return tokens;
}

/** Layer 1, SPEC.md §5's "search over their own canon": every sentence in every entity's
 * current body, scored against the question by word overlap, best sentence per entity,
 * highest-scoring entities first. Deterministic, free, and never gated on `aiEnabled` -
 * this is what "reading is free" and "AI off still reads" mean in code.
 *
 * **Function words are dropped from both sides first, and that is the whole of issue
 * #346's fix to this layer.** The overlap used to be scored over every word, and the only
 * condition for calling a sentence a source was a score above zero, so sharing the word
 * `the` was enough. Measured against the seeded sample world, 17 entries, nine broad
 * questions in both locales: every match all nine produced rested on exactly that, `of`,
 * `is`, `the`, `in`, `this`, `about`, `di`, `i`, `e`, `chi`, `questo`. Scoring content
 * words only takes their candidate counts from 14, 16, 11, 17, 4, 2, 2, 6 and 2 down to 1,
 * 0, 0, 0, 0, 0, 0, 0 and 0. The one survivor is honest: "What kind of world is this?"
 * still matches Mother Sennah on `kind`, in the other sense of the word, which is a
 * coincidence word overlap cannot see through and one chip rather than six.
 *
 * Nothing a targeted question should return is lost. In the same run "Who keeps The Gilded
 * Rat?" goes from 16 candidates to 5 with Mother Sennah still first at 1.0000, "What
 * happened during The Sable Winter?" from 16 to exactly the 5 entries that mention that
 * winter (the sixth was Corvin Ashe on `the`), "Why was Aldric Vane dismissed from the
 * watch?" from 16 to 7, "Who holds the debt of the Lantern Quarter?" from 17 to 6, and the
 * Italian "Chi tiene i registri della Casa dei Mercanti?" from 3 to 2. It also stops the
 * ranking depending on how long the question is: the same Sable Winter question asked in
 * 18 words instead of 6 returns the same five entries in the same order, where the union in
 * the denominator used to move every score.
 *
 * **There is no similarity floor, and the same measurement is why.** A floor was the
 * obvious half of #346 and no number does this job. Before the change a coincidence scored
 * 0.2000 ("Give me an overview of the setting." against Corvin Ashe, shared words `of the`)
 * while a real citation scored 0.1200 ("What happened during The Sable Winter?" against
 * Mother Sennah, shared words `the sable winter`), so any floor that drops the first drops
 * the second. That is not a badly chosen number, it is the wrong shape: Jaccard is a ratio
 * over the union of two token sets, so it moves with how long the question and the sentence
 * happen to be, and it is therefore not comparable between two different questions. A
 * relative floor fails for the same reason, measured: on the Sable Winter question the
 * top entry and the fifth sit at 0.1667 and 0.1200, a narrower spread than the one between
 * a coincidence and a citation across questions. What separates a citation from a
 * coincidence is not how much overlap there is but which words overlap, exactly as issue
 * #270 found for proposal evidence, and this is that finding applied to the layer #270
 * left alone. It is also why nothing here reports a score to a GM: guardrail 3 says
 * evidence is which entry and which sentence and never a bare confidence number, and a
 * number this scale cannot support would be the same lie in smaller print.
 *
 * A question with no content words at all (a pure "Tell me about this world.") returns
 * nothing rather than everything: layer 1 has no lexical handle on the canon, so it says
 * so, and both Ask surfaces carry the sentence that explains it. The embedding layer has
 * no such blind spot and is unchanged, so a world with an indexed corpus still answers a
 * question whose words appear nowhere in it. */
async function searchOwnCanon(
	db: Db,
	universeId: string,
	question: string,
	locale: Locale
): Promise<OwnCanonSource[]> {
	const functionTokenSet = functionTokens(locale);
	const questionTokens = contentTokens(question, functionTokenSet);
	if (questionTokens.size === 0) return [];

	const rows = await db
		.select({ id: entity.id, name: entity.name, slug: entity.slug, body: entity.body })
		.from(entity)
		.where(eq(entity.universeId, universeId));

	const scored: OwnCanonSource[] = [];
	for (const row of rows) {
		const sentences = splitIntoSentences(row.body).filter((s) => !s.startsWith('#'));
		let best: { sentence: string; score: number } | null = null;
		for (const sentence of sentences) {
			const score = jaccard(contentTokens(sentence, functionTokenSet), questionTokens);
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
		// One source of truth for both numbers: packages/indexing owns them because that is where
		// they were measured (see `retriever.ts`). A second copy here drifted the moment the
		// embedding model changed under it, which is exactly what happened with 0.5.
		topK: DEFAULT_TOP_K,
		threshold: DEFAULT_THRESHOLD
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
 * asked about one thing; every source is a legitimate "tell me more"). Capped at 4,
 * raised from 2: these cost nothing but vertical space (no model call, no tokens), and
 * `OWN_CANON_LIMIT`'s own rise to 6 means more distinct entities routinely come back for
 * a multi-entity question, so a cap of 2 was throwing away follow-ups the same change
 * just started producing. Left well short of `OWN_CANON_LIMIT` itself - a row of buttons
 * is a different UI element than a source list and nobody has asked for six of them. */
function deriveFollowUps(locale: Locale, sources: AskSource[]): string[] {
	const names: string[] = [];
	for (const source of sources) {
		const name = source.kind === 'own_canon' ? source.entityName : source.pageTitle;
		if (!names.includes(name)) names.push(name);
	}
	return names.slice(0, 4).map((name) => TELL_ME_MORE[locale](name));
}

/** SPEC.md §5 fixes five detail levels but not what distinguishes them, and no
 * `docs/ux/DECISIONS.md` entry (checked C8, G5, the C8 artifact itself) settles it either -
 * C8 decided where Ask lives, not what its levels mean. Read as one length scale, since
 * that is the only reading `1_line` through `detailed` already support and it is the
 * smaller of the two honest fixes in issue #167: each level asks for strictly more than
 * the last, and `full` names `detailed`'s scope explicitly so a model treats it as a
 * superset rather than a differently-shaped answer. */
const DETAIL_LEVEL_INSTRUCTION: Record<AskDetailLevel, string> = {
	'1_line': 'Answer in exactly one short sentence.',
	short: 'Answer in two to three short sentences.',
	normal: 'Answer in one short paragraph.',
	detailed: 'Answer in two or three paragraphs with concrete detail.',
	full: 'Answer in at least four paragraphs: cover everything a "detailed" answer would, then go further with every other relevant detail, caveat and connection the sources support.'
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

/** issue #346: the other half of the empty state, and the half a UI string cannot cover.
 * With `(none found)` in the prompt the model already refuses to invent, which is right,
 * but left to its own words it explains the refusal wrongly: against a real gateway it
 * answered "if you share canon text or world notes, I can identify the most important
 * people", to a GM who has seventeen entries. The refusal has to name the real reason,
 * that this question's words touched none of them, or it reads as the product not being
 * able to see the canon it is looking at. The suggestion is in it for the same reason:
 * naming a person, a place or an event is what actually gets layer 1 to bite, so saying so
 * turns a dead end into the next thing to type. Empty string when there are sources, so
 * the ordinary path carries no instruction about a case it is not in. */
function noSourcesInstruction(sourceCount: number): string {
	if (sourceCount > 0) return '';
	return (
		"Nothing in the GM's canon matched the words of this question, so there are no " +
		'sources at all. Say that in one sentence: their entries were searched, and no ' +
		'wording in them matched this question. Then suggest naming a person, a place or an ' +
		'event from their world. Never suggest they share, paste or provide canon - they have ' +
		'canon, this question simply did not touch any of it - and never answer from general ' +
		'knowledge instead. '
	);
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

export interface AskProposalEvent {
	proposalId: string;
	planId: string | null;
	/** Mirrors `proposal.kind`: `'draft_entity'` for a new entry `entry_propose` (or
	 * `entry_edit_propose`'s guardrail-6 redirect) drafted, `'update'` for an edit
	 * `entry_edit_propose` (or `entry_propose`'s own redirect) drafted. */
	kind: 'draft_entity' | 'update';
	/** True when the tool the GM's turn asked for is not the tool that actually ran -
	 * guardrail 6's "refuse rather than invent": a create redirected to an edit because
	 * the name already existed, or an edit redirected to a create because it did not. */
	redirected: boolean;
	entityName: string;
	entitySlug: string;
	/** The drafting call's own one-line rationale, addressed to the GM - what a client
	 * shows inline, marked as pending AI text (guardrail 2) rather than read as canon. */
	summary: string;
}

/** A tool call the model actually made, whose drafting call failed - a rejected or
 * erroring model call, never a guardrail refusal (a guardrail-6 redirect is a normal
 * `AskProposalEvent`, not this). Reported so the surface can say the attempt failed
 * instead of the model narrating success over a tool result it never got - see this
 * file's own `runAsk` for why this is fired from outside the model's own words. */
export interface AskProposalFailure {
	tool: 'entry_propose' | 'entry_edit_propose';
	message: string;
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
	/** issue #256: fired once per `entry_propose`/`entry_edit_propose` call the model
	 * actually makes, as soon as the proposal is written - independent of the model's
	 * own narration, the same "never briefly missing" guarantee `onSources` already
	 * gives evidence. Generation-off callers never see this: the tools do not exist on
	 * that branch (guardrail 4). */
	onProposal?: (proposal: AskProposalEvent) => void;
	/** issue #256: fired the moment either tool's drafting call throws (a rejected or
	 * malformed provider request, a database error) - before the model gets a chance to
	 * say anything about it. A client renders this as a hard failure regardless of what
	 * the model's own subsequent text claims; see `runAsk`'s own comment on why the
	 * model cannot be trusted alone to report this correctly. */
	onProposalFailure?: (failure: AskProposalFailure) => void;
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
	/** Every proposal `onProposal` fired during this call, in call order - empty on the
	 * generation-off branch and on any turn where the model answered without proposing
	 * anything. */
	proposals: AskProposalEvent[];
	/** Every failure `onProposalFailure` fired during this call, in call order. */
	failures: AskProposalFailure[];
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
		// #346: the locale is the asker's, and it decides which of their words carry no
		// meaning of their own. SPEC.md §17 rule two already fixes the question's language as
		// the interface locale, so this is the same fact read for a second purpose, never a
		// guess about what language the canon is written in.
		searchOwnCanon(input.db, input.universeId, input.question, input.locale),
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
		return {
			answer,
			sources,
			followUps,
			generated: false,
			credits: 0,
			proposals: [],
			failures: []
		};
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
				const proposals: AskProposalEvent[] = [];
				const failures: AskProposalFailure[] = [];
				const toEvent = (outcome: ProposeResult): AskProposalEvent => ({
					proposalId: outcome.proposal.id,
					planId: outcome.proposal.planId,
					kind: outcome.kind,
					redirected: outcome.redirected,
					entityName: outcome.entityName,
					entitySlug: outcome.entitySlug,
					summary: outcome.proposal.rationale
				});
				const recordProposal = (outcome: ProposeResult) => {
					const event = toEvent(outcome);
					proposals.push(event);
					input.onProposal?.(event);
					return {
						ok: true as const,
						kind: event.kind,
						entityName: event.entityName,
						redirected: event.redirected
					};
				};
				// A drafting call's own failure (a rejected or malformed provider request, a
				// database error) must never reach the GM as a completed proposal - the model
				// cannot be trusted to notice a thrown error inside a tool call and narrate it
				// honestly (observed against a real gateway: gpt-5.4 answered "I've proposed a
				// new entry, pending review" after this exact tool's drafting call had thrown
				// and written nothing). So a failure here is never re-thrown into the AI SDK's
				// own tool-error handling, which the model is free to ignore; it is returned as
				// an ordinary, unambiguous `ok: false` tool result the system prompt below
				// requires the model to report verbatim, and `onProposalFailure` fires
				// independently of whatever the model ends up saying, so the client can show a
				// hard failure even if it does not.
				const recordFailure = (toolName: 'entry_propose' | 'entry_edit_propose', err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					failures.push({ tool: toolName, message });
					input.onProposalFailure?.({ tool: toolName, message });
					return {
						ok: false as const,
						error:
							`This proposal was NOT created - the drafting call failed: ${message}. ` +
							'Tell the GM the attempt failed and why. Never say you created or proposed ' +
							'anything for this call.'
					};
				};

				// SPEC.md §5's Ask row, issue #256: the only two tools this loop can call, and
				// both only ever write a `proposal` - guardrail 1 stays acceptProposal's alone,
				// see ask-propose.ts's own header comment on that boundary. Registered here,
				// not on the generation-off branch above, so "with AI off, the tools do not
				// exist" is structural rather than a prompt instruction.
				const stream = streamText({
					model: premiumModel.languageModel,
					system:
						"You are the Loremaster, answering a GM's question about their game world from " +
						'the sources below only. Never invent a fact the sources do not support. Do not ' +
						'cite sources inline with numbers or brackets - they are listed separately. ' +
						DETAIL_LEVEL_INSTRUCTION[input.detailLevel] +
						' Only call entry_propose or entry_edit_propose when the GM explicitly asks you ' +
						'to create, add or change something in canon - most questions want an answer, ' +
						'not a proposal. Neither tool writes canon directly: after calling one, check its ' +
						'result. If it has "ok": true, tell the GM what you proposed and that it is ' +
						'pending review, never that it is already done. If it has "ok": false, the ' +
						'proposal was NOT created - tell the GM the attempt failed and repeat the ' +
						'"error" field verbatim; never say you proposed or created anything for that ' +
						'call. ' +
						noSourcesInstruction(sources.length) +
						speechInstruction(input.locale),
					prompt:
						`Sources:\n${renderSourcesForPrompt(sources) || '(none found)'}\n\n` +
						`Question: ${input.question}`,
					tools: {
						entry_propose: tool({
							description:
								'Propose creating a brand new wiki entry. Writes a pending proposal for ' +
								'the GM to review; never creates the entry directly. If an entry with ' +
								'this name already exists, this proposes an edit to it instead and says so.',
							inputSchema: z
								.object({
									name: z.string().min(1).max(200),
									instruction: z
										.string()
										.min(1)
										.max(2000)
										.describe(
											'What the GM said about this entry - the only content the draft may use.'
										)
								})
								.strict(),
							execute: async (toolInput, { toolCallId }) => {
								try {
									return recordProposal(
										await entryPropose({
											db: input.db,
											userId: input.userId,
											universeId: input.universeId,
											locale: input.locale,
											modelFactory: input.modelFactory,
											gateway: input.gateway,
											sources: ownCanon,
											// issue #270: the GM's own message, not `toolInput.instruction`, which is
											// the model's reading of it - the evidence quotes what the GM actually
											// typed.
											request: input.question,
											name: toolInput.name,
											instruction: toolInput.instruction,
											requestId: toolCallId
										})
									);
								} catch (err) {
									return recordFailure('entry_propose', err);
								}
							}
						}),
						entry_edit_propose: tool({
							description:
								'Propose an edit to an existing wiki entry. Writes a pending proposal ' +
								'for the GM to review; never edits the entry directly. If no entry with ' +
								'this name exists, this proposes creating it instead and says so.',
							inputSchema: z
								.object({
									entityName: z.string().min(1).max(200),
									instruction: z
										.string()
										.min(1)
										.max(2000)
										.describe(
											'What the GM wants added or changed - the only content the draft may use.'
										)
								})
								.strict(),
							execute: async (toolInput, { toolCallId }) => {
								try {
									return recordProposal(
										await entryEditPropose({
											db: input.db,
											userId: input.userId,
											universeId: input.universeId,
											locale: input.locale,
											modelFactory: input.modelFactory,
											gateway: input.gateway,
											sources: ownCanon,
											request: input.question,
											entityName: toolInput.entityName,
											instruction: toolInput.instruction,
											requestId: toolCallId
										})
									);
								} catch (err) {
									return recordFailure('entry_edit_propose', err);
								}
							}
						})
					},
					// A step is one model turn (the AI SDK's own "step (LLM call)"), and the stop
					// condition doesn't require the last step to be a text step - hit the cap on a
					// tool-call step and the loop ends with proposals written but nothing ever told
					// to the GM, silently breaking the system prompt's own "tell the GM what you
					// proposed" instruction above. `recordFailure` never retries on the model's
					// behalf, but nothing stops the model from retrying a failed drafting call itself
					// (see this file's own toolCallThenTextModel-style regression test), and a GM
					// request that legitimately proposes two entries where one needs a retry already
					// spends propose-fail, retry-ok per entry - 2 tool-call steps each - before the
					// closing text step: 2*2+1 = 5, one over the old cap of 4. 6 covers that with one
					// step of headroom (e.g. a second retry) without making this an effectively
					// uncapped loop: the tools only ever write a pending `proposal` (guardrail 1), so
					// a longer loop still can't do more than draft more proposals for review.
					stopWhen: stepCountIs(6)
				});
				let text = '';
				// Full stream, not just `textStream`: draining it is what drives the tool-call
				// steps to completion, and `usage` below only resolves once every step has run.
				for await (const part of stream.fullStream) {
					if (part.type === 'text-delta') {
						text += part.text;
						input.onToken?.(part.text);
					}
				}
				const usage = await stream.usage;
				return { text, usage, proposals, failures };
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

	return {
		answer: result.text,
		sources,
		followUps,
		generated: true,
		credits: price.credits,
		proposals: result.proposals,
		failures: result.failures
	};
}
