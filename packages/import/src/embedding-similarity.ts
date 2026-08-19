/**
 * The real `SimilarityFn` (issue #279, SPEC.md §6.4): "semantic matching on embeddings for
 * everything else, because most sources have no stable id... and string normalisation is
 * not enough: 'the Gilded Rat', 'Gilded Rat Tavern' and 'Il Ratto Dorato' are the same inn
 * and no regex will say so."
 *
 * `lexical-similarity.ts` said what this file is for in its own doc comment ("the real
 * similarity function, wired once real embedding credentials exist, is `SimilarityFn`
 * backed by `@canonry/ai`'s embedding purpose plus a cosine distance") and until this
 * issue nobody had written it, so every import in every environment scored entity matches
 * with character-trigram Jaccard, which is near-blind to exactly the case §6.4 uses as its
 * example.
 *
 * The same seam split the driver already uses: no database, no credential and no provider
 * string reaches this file. `embed` is injected, structurally identical to
 * `@canonry/indexing`'s `Embedder` but not imported from it (the same reason
 * `model-selector.ts`'s `PurposeResolution` mirrors `@canonry/ai`'s `ResolvedModel`
 * structurally: this package has no dependency on `@canonry/indexing`, and a seam that
 * needs one is the wrong seam). `apps/web/src/lib/server/onboarding.ts`'s
 * `resolveImportSimilarity` is the composition root that supplies a real
 * `createGatewayEmbedder` and the vector width `model_config`'s `embedding` row implies,
 * and falls back to `lexicalTrigramSimilarity` when there is no credential, exactly as
 * `resolveImportDriver` falls back to `DeterministicExtractionDriver`.
 *
 * ### Why this batches and caches rather than embedding per pair
 *
 * `resolveMatch` calls `similarity(subject, candidate)` once per candidate, so the naive
 * implementation embeds the subject again for every candidate: 21 embeddings for one
 * subject against twenty candidates, twenty of them identical. Two things fix that, both
 * scoped to one `SimilarityFn` instance, which is one import job:
 *
 *  1. **A vector cache keyed on the exact text embedded.** A subject is embedded once per
 *     job however many candidates it is scored against, and a candidate that appears in
 *     two different subjects' candidate sets is embedded once too. The cache holds the
 *     in-flight promise rather than the settled vector, so two concurrent requests for one
 *     text share a single call rather than racing to make two.
 *  2. **Microtask coalescing.** `resolveMatch` issues its `similarity` calls in one
 *     synchronous sweep (`Promise.all` over the narrowed candidates), so every text that
 *     sweep needs is queued before the first flush runs: one `embedMany` for a whole
 *     candidate set instead of one call per pair. Batches are capped at
 *     `maxBatchSize` texts, because a provider's own request limit is not this file's to
 *     guess at.
 *
 * A pair whose two texts are byte-identical short-circuits to 1 without an embedding call
 * at all. That is not an approximation: the cosine of a vector with itself is 1, and the
 * identical-name case is the common one on re-import.
 *
 * ### The width check is the point of taking `vectorSize`
 *
 * Cosine needs no dimension known in advance, so the only reason this takes `vectorSize`
 * is to refuse a vector that is not the width `model_config`'s `embedding` row implies.
 * `apps/web/src/lib/server/media.ts` already carries the account of why that number is
 * resolved from the model rather than from an env var: `EMBEDDING_VECTOR_SIZE` defaulted
 * to 1536 there while the live collections were written at 256, so the first real vector
 * would have been rejected by a collection nobody had noticed was the wrong shape. A
 * matching decision has no collection to reject it, which makes the mismatch quieter here
 * and worth failing on loudly.
 */
import type { MatchCandidate, MatchSubject, SimilarityFn } from './matching.js';

/** Structural mirror of `@canonry/indexing`'s `Embedder`: one call, many texts, vectors
 * back in the same order. Injected rather than imported, see this file's header. */
export type EmbedTexts = (texts: string[]) => Promise<number[][]>;

export interface EmbeddingSimilarityDeps {
	embed: EmbedTexts;
	/** The output width `model_config`'s current `embedding` row implies
	 * (`@canonry/indexing`'s `embeddingDimensionsFor`). Every returned vector is checked
	 * against it. */
	vectorSize: number;
	/** Texts per `embed` call. 64 by default: comfortably inside every provider's batch
	 * limit at the gateway, and larger than the 21 texts a default-`preFilterLimit`
	 * candidate set can produce, so the common case is one call. */
	maxBatchSize?: number;
}

const DEFAULT_MAX_BATCH_SIZE = 64;

export class EmbeddingWidthMismatchError extends Error {
	constructor(
		readonly expected: number,
		readonly actual: number,
		readonly text: string
	) {
		super(
			`embedding for ${JSON.stringify(text)} came back at ${actual} dimensions, but ` +
				`model_config's embedding row implies ${expected}. Either the row changed under a ` +
				`running process or EMBEDDING_DIMENSIONS in packages/indexing/src/models.ts is wrong ` +
				`for that model - matching scores computed across two widths are meaningless.`
		);
		this.name = 'EmbeddingWidthMismatchError';
	}
}

export class EmbeddingBatchSizeError extends Error {
	constructor(requested: number, returned: number) {
		super(
			`embedder returned ${returned} vectors for ${requested} texts. The contract is ` +
				`one vector per text, in order.`
		);
		this.name = 'EmbeddingBatchSizeError';
	}
}

/**
 * The text one side of a pair is embedded as: the name, then any aliases, joined by ` / `.
 *
 * Deliberately the raw strings rather than `normalizeForMatching`'s output. Normalisation
 * exists to make a *lexical* comparison work and throws away case and diacritics doing it;
 * an embedding model reads "Séraphine Duval" and "Seraphine Duval" as the same person on
 * its own, and reads "SAINT MERROW'S DOCKS" without needing the shouting removed. Aliases
 * are included because SPEC.md §6.4 keeps them "in the loop", and because the corpus's
 * hardest true positives are the ones where the name and the alias swap places between
 * exports.
 */
export function matchTextFor(entity: MatchSubject | MatchCandidate): string {
	return [entity.name, ...entity.aliases]
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join(' / ');
}

/** Cosine of two equal-length vectors, in [-1, 1]. Zero for a zero vector, which has no
 * direction to compare. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		normA += x * x;
		normB += y * y;
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / Math.sqrt(normA * normB);
}

/** `MatchThresholds` and `runMatchingBenchmark`'s sweep are both stated on [0, 1], and a
 * negative cosine means "further apart than two unrelated texts", which for the match
 * decision is the same answer as 0. Clamping rather than rescaling keeps a reported score
 * comparable to the raw cosine everywhere it is above zero, which is everywhere it
 * matters. */
function clampToUnit(value: number): number {
	if (value <= 0) return 0;
	return value >= 1 ? 1 : value;
}

interface Waiter {
	text: string;
	resolve: (vector: number[]) => void;
	reject: (error: unknown) => void;
}

/** Cache plus microtask-coalescing queue in front of one `EmbedTexts`, scoped to one
 * `SimilarityFn` instance. See this file's header for why both exist. */
class BatchingVectorSource {
	private readonly cache = new Map<string, Promise<number[]>>();
	private queue: Waiter[] = [];
	private flushScheduled = false;

	constructor(
		private readonly embed: EmbedTexts,
		private readonly vectorSize: number,
		private readonly maxBatchSize: number
	) {}

	vectorFor(text: string): Promise<number[]> {
		const cached = this.cache.get(text);
		if (cached) return cached;

		const pending = new Promise<number[]>((resolve, reject) => {
			this.queue.push({ text, resolve, reject });
		});
		this.cache.set(text, pending);
		if (!this.flushScheduled) {
			this.flushScheduled = true;
			queueMicrotask(() => void this.flush());
		}
		return pending;
	}

	private async flush(): Promise<void> {
		this.flushScheduled = false;
		const waiting = this.queue;
		this.queue = [];

		for (let start = 0; start < waiting.length; start += this.maxBatchSize) {
			const batch = waiting.slice(start, start + this.maxBatchSize);
			try {
				const vectors = await this.embed(batch.map((waiter) => waiter.text));
				if (vectors.length !== batch.length) {
					throw new EmbeddingBatchSizeError(batch.length, vectors.length);
				}
				// Validated before anything is resolved, so a batch either settles every
				// waiter with a usable vector or fails all of them with the same error.
				batch.forEach((waiter, index) => {
					const vector = vectors[index] as number[];
					if (vector.length !== this.vectorSize) {
						throw new EmbeddingWidthMismatchError(this.vectorSize, vector.length, waiter.text);
					}
				});
				batch.forEach((waiter, index) => waiter.resolve(vectors[index] as number[]));
			} catch (error) {
				// Drop the failed texts from the cache: a transient gateway error should not
				// poison every later pair in the job with a cached rejection.
				for (const waiter of batch) {
					this.cache.delete(waiter.text);
					waiter.reject(error);
				}
			}
		}
	}
}

/**
 * Builds the embedding-backed `SimilarityFn` `resolveMatch` scores candidates with when a
 * real embedding credential exists. Returns cosine similarity of the two sides' embedded
 * name-and-aliases text, clamped to [0, 1].
 */
export function createEmbeddingSimilarity(deps: EmbeddingSimilarityDeps): SimilarityFn {
	const vectors = new BatchingVectorSource(
		deps.embed,
		deps.vectorSize,
		deps.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE
	);

	return async (subject, candidate) => {
		const subjectText = matchTextFor(subject);
		const candidateText = matchTextFor(candidate);
		if (subjectText.length === 0 || candidateText.length === 0) return 0;
		if (subjectText === candidateText) return 1;

		const [subjectVector, candidateVector] = await Promise.all([
			vectors.vectorFor(subjectText),
			vectors.vectorFor(candidateText)
		]);
		return clampToUnit(cosineSimilarity(subjectVector, candidateVector));
	};
}
