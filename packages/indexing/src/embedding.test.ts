import { describe, expect, it } from 'vitest';
import { hashingEmbedder } from './embedding.js';

function dot(a: number[], b: number[]): number {
	return a.reduce((sum, v, i) => sum + v * b[i]!, 0);
}

describe('hashingEmbedder', () => {
	it('returns one L2-normalised vector per input text', async () => {
		const vectors = await hashingEmbedder(['a coastal city', 'a mountain fortress']);
		expect(vectors).toHaveLength(2);
		for (const vector of vectors) {
			const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
			expect(norm).toBeCloseTo(1, 5);
		}
	});

	it('is deterministic', async () => {
		const [a] = await hashingEmbedder(['Valdoria Reach is a coastal city']);
		const [b] = await hashingEmbedder(['Valdoria Reach is a coastal city']);
		expect(a).toEqual(b);
	});

	it('gives near-identical texts a higher cosine similarity than unrelated texts', async () => {
		const [a, aAgain, unrelated] = await hashingEmbedder([
			'Valdoria Reach is a coastal trading city',
			'Valdoria Reach is a coastal trading town',
			'quantum chromodynamics describes the strong nuclear force'
		]);
		const simSame = dot(a!, aAgain!);
		const simDifferent = dot(a!, unrelated!);
		expect(simSame).toBeGreaterThan(simDifferent);
	});

	it('returns an empty array for no input', async () => {
		expect(await hashingEmbedder([])).toEqual([]);
	});
});
