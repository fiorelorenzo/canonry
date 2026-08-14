import { describe, expect, it } from 'vitest';
import { AMBIENT_SAME_SCENE_THRESHOLD, contentJaccard } from './scene-similarity.js';

describe('contentJaccard (#68, SPEC.md §8.2)', () => {
	it('scores two paraphrases of the same tavern scene at or above the 0.30 threshold', () => {
		const a = 'A crowded tavern at night, fire crackling, patrons laughing over spilled ale.';
		const b =
			'A busy tavern after dark, a fire crackling, laughing patrons and spilled ale on the floor.';
		expect(contentJaccard(a, b)).toBeGreaterThanOrEqual(AMBIENT_SAME_SCENE_THRESHOLD);
	});

	it('scores a genuine scene transition (tavern to cellar) below the threshold', () => {
		const a = 'A crowded tavern at night, fire crackling, patrons laughing over spilled ale.';
		const b = 'A damp stone cellar, dripping water, rats scurrying in the dark.';
		expect(contentJaccard(a, b)).toBeLessThan(AMBIENT_SAME_SCENE_THRESHOLD);
	});

	it('is symmetric', () => {
		const a = 'Rain falling on a cobbled street, distant thunder.';
		const b = 'Thunder in the distance over a rain-soaked cobbled street.';
		expect(contentJaccard(a, b)).toBeCloseTo(contentJaccard(b, a), 10);
	});

	it('is 1 for identical descriptions and 0 when either side has no content tokens', () => {
		expect(contentJaccard('rain on the roof', 'rain on the roof')).toBe(1);
		expect(contentJaccard('a', 'rain falling heavily')).toBe(0);
		expect(contentJaccard('', 'rain falling heavily')).toBe(0);
	});
});
