/**
 * Issue #279. Every test here scripts the embedder, so the whole file runs with no gateway
 * credential and no network - the numbers a real embedding model produces are measured by
 * `packages/bench`'s `matching-sweep`, not asserted here, because an assertion about a
 * model's cosine is an assertion about the model.
 *
 * What is worth pinning down without a model: that the cosine is a cosine, that a candidate
 * set costs one embedding call rather than one per pair, that a subject is embedded once
 * however many candidates it is scored against, and that a vector of the wrong width is
 * refused rather than scored.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	cosineSimilarity,
	createEmbeddingSimilarity,
	EmbeddingBatchSizeError,
	EmbeddingWidthMismatchError,
	matchTextFor,
	type EmbedTexts
} from './embedding-similarity.js';
import { resolveMatch, type MatchCandidate, type MatchSubject } from './matching.js';

/** A deterministic stand-in for an embedding model: one axis per distinct token, so two
 * texts sharing tokens have a real, computable cosine and two texts sharing none are
 * orthogonal. Not a semantic model and not pretending to be one - it exists so the
 * mechanics (batching, caching, width) are testable at all. */
function tokenAxisEmbedder(vectorSize: number): EmbedTexts {
	return async (texts) =>
		texts.map((text) => {
			const vector = new Array<number>(vectorSize).fill(0);
			for (const token of text
				.toLowerCase()
				.split(/[^a-z0-9]+/i)
				.filter(Boolean)) {
				let hash = 0;
				for (let i = 0; i < token.length; i++) hash = (hash * 31 + token.charCodeAt(i)) | 0;
				const axis = Math.abs(hash) % vectorSize;
				vector[axis] = (vector[axis] ?? 0) + 1;
			}
			return vector;
		});
}

describe('cosineSimilarity', () => {
	it('is 1 for a vector with itself, 0 for orthogonal, -1 for opposed', () => {
		expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
		expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
		expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 12);
	});

	it('ignores magnitude, which is what makes it a direction comparison', () => {
		expect(cosineSimilarity([1, 1], [7, 7])).toBeCloseTo(1, 12);
	});

	it('is 0 against a zero vector, which has no direction to compare', () => {
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
	});
});

describe('matchTextFor', () => {
	it('keeps case and diacritics, because the model reads them and a normalizer would not', () => {
		expect(matchTextFor({ name: 'Séraphine Duval', aliases: [] })).toBe('Séraphine Duval');
		expect(matchTextFor({ name: "SAINT MERROW'S DOCKS", aliases: [] })).toBe(
			"SAINT MERROW'S DOCKS"
		);
	});

	it('appends aliases, so a name/alias swap between exports lands on the same text', () => {
		expect(matchTextFor({ name: 'Old Toby', aliases: ['Tobias Reed'] })).toBe(
			'Old Toby / Tobias Reed'
		);
	});

	it('drops blank aliases rather than embedding a dangling separator', () => {
		expect(matchTextFor({ name: 'Aldric Voss', aliases: ['', '   '] })).toBe('Aldric Voss');
	});

	it('leaves a context-free side byte-identical to what it embedded before issue #310', () => {
		// Load-bearing, not cosmetic: `matching-sweep`'s "names only" column is the baseline the
		// context change is measured against, and a first line that shifted would make that
		// comparison meaningless.
		expect(matchTextFor({ name: 'the Gilded Rat', aliases: ['Gilded Rat Tavern'] })).toBe(
			'the Gilded Rat / Gilded Rat Tavern'
		);
	});

	it('adds one labelled line per piece of context that is present (issue #310)', () => {
		expect(
			matchTextFor({
				name: 'the Gilded Rat',
				aliases: [],
				context: {
					type: 'place',
					summary: 'An inn off the Lantern Quarter.',
					sourceSentence: 'The Gilded Rat stands three doors down the only lit street.'
				}
			})
		).toBe(
			'the Gilded Rat\ntype: place\nsummary: An inn off the Lantern Quarter.\n' +
				'source: The Gilded Rat stands three doors down the only lit street.'
		);
	});

	it('omits an absent field instead of emitting an empty line', () => {
		// A candidate read from committed canon has no source sentence to quote, so this is the
		// shape of every already-imported side of a comparison rather than an edge case.
		expect(
			matchTextFor({
				id: 'inn-gilded-rat',
				name: 'Il Ratto Dorato',
				aliases: [],
				context: { type: 'place', summary: 'Una locanda.', sourceSentence: null }
			})
		).toBe('Il Ratto Dorato\ntype: place\nsummary: Una locanda.');

		expect(
			matchTextFor({
				name: 'Aldric Voss',
				aliases: [],
				context: { type: null, summary: '   ', sourceSentence: null }
			})
		).toBe('Aldric Voss');
	});

	it('clips a context field rather than letting a whole body drown the name', () => {
		const text = matchTextFor({
			name: 'Thornwick College',
			aliases: [],
			context: { type: null, summary: 'x'.repeat(500), sourceSentence: null }
		});

		expect(text.startsWith('Thornwick College\nsummary: ')).toBe(true);
		expect(text.endsWith('...')).toBe(true);
		expect(text.length).toBeLessThan(300);
	});

	it('separates two entities the name alone cannot, which is the whole point', async () => {
		// The father-and-son pair SPEC.md §6.4 calls "two characters collapsed into one". The
		// token-axis embedder is not semantic, so this asserts the mechanism rather than the
		// model: identical names plus differing context produce a lower score than identical
		// names alone, which is the ordering change #310 is about.
		const embed = tokenAxisEmbedder(256);
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 256 });
		const father: MatchSubject = { name: 'Aldric Voss', aliases: [] };
		const son: MatchCandidate = { id: 'char-junior', name: 'Aldric Voss', aliases: [] };

		const onNames = await similarity(father, son);
		const onContext = await similarity(
			{
				...father,
				context: {
					type: 'character',
					summary: 'Dismissed captain of the Valdoria Watch.',
					sourceSentence: null
				}
			},
			{
				...son,
				context: {
					type: 'character',
					summary: 'A harbour clerk of nineteen who has never held a commission.',
					sourceSentence: null
				}
			}
		);

		expect(onNames).toBe(1);
		expect(onContext).toBeLessThan(onNames);
	});
});

describe('createEmbeddingSimilarity', () => {
	it('scores a pair as the clamped cosine of the two embedded texts', async () => {
		const embed = vi.fn(tokenAxisEmbedder(64));
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 64 });

		const score = await similarity(
			{ name: 'Gilded Rat Tavern', aliases: [] },
			{ id: 'inn', name: 'Gilded Rat', aliases: [] }
		);
		// Two of three token axes shared against two of two: 2 / sqrt(3 * 2).
		expect(score).toBeCloseTo(2 / Math.sqrt(6), 12);
	});

	it('never returns a negative score, because MatchThresholds are stated on [0, 1]', async () => {
		const embed: EmbedTexts = async (texts) =>
			texts.map((text) => (text === 'a' ? [1, 0] : [-1, 0]));
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 2 });
		expect(await similarity({ name: 'a', aliases: [] }, { id: 'b', name: 'b', aliases: [] })).toBe(
			0
		);
	});

	it('returns 1 for two byte-identical texts without calling the embedder at all', async () => {
		const embed = vi.fn(tokenAxisEmbedder(64));
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 64 });

		const score = await similarity(
			{ name: 'the Warden of Thornwick', aliases: [] },
			{ id: 'char-new-warden', name: 'the Warden of Thornwick', aliases: [] }
		);
		expect(score).toBe(1);
		expect(embed).not.toHaveBeenCalled();
	});

	it('scores 0 for an empty subject or candidate without calling the embedder', async () => {
		const embed = vi.fn(tokenAxisEmbedder(8));
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 8 });
		expect(await similarity({ name: '  ', aliases: [] }, { id: 'x', name: 'X', aliases: [] })).toBe(
			0
		);
		expect(embed).not.toHaveBeenCalled();
	});

	it('embeds a whole candidate set in one call, and the subject once rather than once per candidate', async () => {
		const embed = vi.fn(tokenAxisEmbedder(64));
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 64 });
		const candidates: MatchCandidate[] = [
			{ id: 'a', name: 'Aldric the Ironhand', aliases: [] },
			{ id: 'b', name: 'Captain Mira Sable', aliases: [] },
			{ id: 'c', name: 'Thornwyck College', aliases: [] },
			{ id: 'd', name: 'Brackwater', aliases: [] }
		];

		await resolveMatch({
			subject: { name: 'Aldric Voss', aliases: [] },
			exactSourceRefMatch: null,
			candidates,
			similarity,
			thresholds: { matchAbove: 0.85, newBelow: 0.5 }
		});

		expect(embed).toHaveBeenCalledTimes(1);
		const texts = embed.mock.calls[0]?.[0] as string[];
		expect(texts).toHaveLength(5);
		expect(texts.filter((text) => text === 'Aldric Voss')).toHaveLength(1);
	});

	it('reuses a cached vector across candidate sets, so a repeated name is embedded once per job', async () => {
		const embed = vi.fn(tokenAxisEmbedder(64));
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 64 });
		const candidate: MatchCandidate = { id: 'a', name: 'Il Ratto Dorato', aliases: [] };

		await similarity({ name: 'the Gilded Rat', aliases: [] }, candidate);
		await similarity({ name: 'the Gilded Rat', aliases: [] }, candidate);
		await similarity({ name: 'the Gilded Rat', aliases: [] }, candidate);

		expect(embed).toHaveBeenCalledTimes(1);
	});

	it('splits a queue larger than maxBatchSize into successive calls', async () => {
		const embed = vi.fn(tokenAxisEmbedder(16));
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 16, maxBatchSize: 2 });
		const subject = { name: 'subject zero', aliases: [] };

		await Promise.all(
			[1, 2, 3, 4].map((n) =>
				similarity(subject, { id: `c${n}`, name: `candidate ${n}`, aliases: [] })
			)
		);

		// Five distinct texts (one subject, four candidates) at two per call.
		expect(embed).toHaveBeenCalledTimes(3);
		expect(embed.mock.calls.flatMap((call) => call[0] as string[])).toHaveLength(5);
	});

	it('refuses a vector that is not the width model_config implies', async () => {
		const embed: EmbedTexts = async (texts) => texts.map(() => [1, 0, 0]);
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 2560 });
		await expect(
			similarity({ name: 'a', aliases: [] }, { id: 'b', name: 'b', aliases: [] })
		).rejects.toThrow(EmbeddingWidthMismatchError);
	});

	it('refuses an embedder that returns the wrong number of vectors', async () => {
		const embed: EmbedTexts = async () => [[1, 0]];
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 2 });
		await expect(
			similarity({ name: 'a', aliases: [] }, { id: 'b', name: 'b', aliases: [] })
		).rejects.toThrow(EmbeddingBatchSizeError);
	});

	it('does not cache a failure: a transient gateway error leaves the next pair scoreable', async () => {
		let calls = 0;
		const embed: EmbedTexts = async (texts) => {
			calls += 1;
			if (calls === 1) throw new Error('gateway 503');
			return tokenAxisEmbedder(16)(texts);
		};
		const similarity = createEmbeddingSimilarity({ embed, vectorSize: 16 });
		const subject: MatchSubject = { name: 'Brackwater Mire', aliases: [] };
		const candidate: MatchCandidate = { id: 'p', name: 'Brackwater', aliases: [] };

		await expect(similarity(subject, candidate)).rejects.toThrow('gateway 503');
		await expect(similarity(subject, candidate)).resolves.toBeGreaterThan(0);
	});
});
