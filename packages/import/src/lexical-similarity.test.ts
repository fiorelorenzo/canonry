/**
 * Issue #310 gave both sides of a matching comparison a `MatchContext` and it fixed the
 * embedding scorer's ordering. These tests pin the two things that follow for the *lexical*
 * scorer, which is what a box with no gateway credentials resolves to and therefore what CI
 * runs: that the shipped scorer ignores the context entirely, and that the context-reading
 * instance the sweep measures against it really does read it.
 *
 * The claim that the context makes the trigram scorer worse is a measurement and lives where
 * measurements live (`packages/bench`'s `matching-sweep`, and the numbers in
 * `lexicalTrigramSimilarity`'s own doc comment). What is asserted here is the property that
 * makes that measurement safe to act on: the fallback did not change.
 */
import { describe, expect, it } from 'vitest';
import { createLexicalTrigramSimilarity, lexicalTrigramSimilarity } from './lexical-similarity.js';
import type { MatchCandidate, MatchContext, MatchSubject } from './matching.js';

const SUBJECT_CONTEXT: MatchContext = {
	type: 'place',
	summary: 'An inn off the Lantern Quarter, kept by Mother Sennah.',
	sourceSentence: 'The Gilded Rat stands three doors down the only lit street.'
};

const CANDIDATE_CONTEXT: MatchContext = {
	type: 'place',
	summary: 'A drinking house in the poorest of the six quarters.',
	sourceSentence: null
};

const subject: MatchSubject = { name: 'the Gilded Rat', aliases: [] };
const candidate: MatchCandidate = {
	id: 'inn-gilded-rat',
	name: 'Gilded Rat Tavern',
	aliases: []
};

describe('lexicalTrigramSimilarity (issue #310)', () => {
	it('scores a pair identically whether or not the sides carry context', async () => {
		// The guarantee CI depends on: adding context to the seam did not move the fallback
		// scorer's numbers, so `MATCH_THRESHOLDS` is still the band measured for it and the
		// credentials-free path behaves exactly as it did.
		const withoutContext = await lexicalTrigramSimilarity(subject, candidate);
		const withContext = await lexicalTrigramSimilarity(
			{ ...subject, context: SUBJECT_CONTEXT },
			{ ...candidate, context: CANDIDATE_CONTEXT }
		);

		expect(withContext).toBe(withoutContext);
	});

	it('is the no-context instance of the factory, not a second implementation', async () => {
		const explicit = createLexicalTrigramSimilarity({ includeContext: false });

		expect(await explicit(subject, candidate)).toBe(
			await lexicalTrigramSimilarity(subject, candidate)
		);
	});
});

describe('createLexicalTrigramSimilarity({ includeContext: true })', () => {
	it('reads the context, which is what makes it a different measurement', async () => {
		const contextual = createLexicalTrigramSimilarity({ includeContext: true });

		const scored = await contextual(
			{ ...subject, context: SUBJECT_CONTEXT },
			{ ...candidate, context: CANDIDATE_CONTEXT }
		);

		expect(scored).not.toBe(await contextual(subject, candidate));
	});

	it('falls back to names when a side carries no context at all', async () => {
		const contextual = createLexicalTrigramSimilarity({ includeContext: true });

		expect(await contextual(subject, candidate)).toBe(
			await lexicalTrigramSimilarity(subject, candidate)
		);
	});
});
