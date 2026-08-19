/**
 * Issue #279. `bandedSimilarity` is the only place that knows which threshold band goes with
 * which scorer, so it is the only place that can get it wrong, and these are the assertions
 * every other caller's guard leans on: `apps/web`'s `import-similarity.test.ts` and
 * `packages/bench`'s `import.test.ts` both check identity against the same two constants.
 *
 * Identity rather than deep equality, everywhere, for the reason the bench guard states: a
 * re-inlined `{ matchAbove: 0.96, newBelow: 0.7 }` satisfies `toEqual` today and keeps the old
 * numbers the day the measurement changes, which is the drift being watched for.
 */
import { describe, expect, it } from 'vitest';
import { bandedSimilarity } from './similarity.js';
import { lexicalTrigramSimilarity } from './lexical-similarity.js';
import { EMBEDDING_MATCH_THRESHOLDS, MATCH_THRESHOLDS } from './matching.js';
import type { EmbedTexts } from './embedding-similarity.js';

const NEVER_CALLED: EmbedTexts = async () => {
	throw new Error('bandedSimilarity must not embed anything while it is being constructed');
};

describe('bandedSimilarity (issue #279)', () => {
	it('pairs the lexical scorer with the band measured for the lexical scorer', () => {
		const banded = bandedSimilarity(null);

		expect(banded.similarity).toBe(lexicalTrigramSimilarity);
		expect(banded.thresholds).toBe(MATCH_THRESHOLDS);
		expect(banded.isLexical).toBe(true);
	});

	it('pairs the embedding scorer with the band measured for the embedding scorer', () => {
		const banded = bandedSimilarity({ embed: NEVER_CALLED, vectorSize: 2560 });

		expect(banded.similarity).not.toBe(lexicalTrigramSimilarity);
		expect(banded.thresholds).toBe(EMBEDDING_MATCH_THRESHOLDS);
		expect(banded.isLexical).toBe(false);
	});

	it('never hands a cosine scorer a band whose newBelow the cosine floor cannot reach', () => {
		// The specific mistake this whole pairing exists to make impossible, and the one that
		// was live for a day: the labelled corpus's lowest cosine is 0.642, so the lexical
		// band's newBelow of 0.5 makes the "new" outcome unreachable for the embedding scorer
		// and turns every unmatched entity into a question (matching.ts carries the numbers).
		const embedding = bandedSimilarity({ embed: NEVER_CALLED, vectorSize: 2560 });
		const lexical = bandedSimilarity(null);

		expect(embedding.thresholds.newBelow).toBeGreaterThan(lexical.thresholds.newBelow);
		expect(embedding.thresholds.matchAbove).toBeGreaterThan(lexical.thresholds.matchAbove);
	});

	it('builds a working scorer, not just a pair of numbers', async () => {
		// Two byte-identical texts short-circuit without an embedding call, which is the one
		// thing the embedding branch can prove with `NEVER_CALLED` in place: if the returned
		// `similarity` were not really `createEmbeddingSimilarity`'s, this would throw.
		const banded = bandedSimilarity({ embed: NEVER_CALLED, vectorSize: 2560 });

		expect(
			await banded.similarity(
				{ name: 'the Gilded Rat', aliases: [] },
				{ id: 'inn-gilded-rat', name: 'the Gilded Rat', aliases: [] }
			)
		).toBe(1);
	});
});
