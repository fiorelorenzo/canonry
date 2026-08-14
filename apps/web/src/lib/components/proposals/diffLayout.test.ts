import { describe, expect, it } from 'vitest';
import { diffLayoutFor } from './diffLayout';
import type { FactChange } from '@canonry/copilot';

describe('diffLayoutFor', () => {
	it('stays in-place for a single clause change, the common case', () => {
		const diff: FactChange[] = [
			{ kind: 'changed', statement: 'new sentence.', previousStatement: 'old sentence.' }
		];
		expect(diffLayoutFor(diff)).toBe('in-place');
	});

	it('stays in-place at exactly the threshold (two sentences changed)', () => {
		const diff: FactChange[] = [
			{ kind: 'changed', statement: 'a', previousStatement: 'a-old' },
			{ kind: 'changed', statement: 'b', previousStatement: 'b-old' }
		];
		expect(diffLayoutFor(diff)).toBe('in-place');
	});

	it('falls back to side-by-side once more than two sentences are replaced or removed', () => {
		const diff: FactChange[] = [
			{ kind: 'changed', statement: 'a', previousStatement: 'a-old' },
			{ kind: 'changed', statement: 'b', previousStatement: 'b-old' },
			{ kind: 'removed', statement: 'c-old' }
		];
		expect(diffLayoutFor(diff)).toBe('side-by-side');
	});

	it('an added sentence alone never triggers side-by-side - nothing to toggle against', () => {
		const diff: FactChange[] = [
			{ kind: 'added', statement: 'a' },
			{ kind: 'added', statement: 'b' },
			{ kind: 'added', statement: 'c' }
		];
		expect(diffLayoutFor(diff)).toBe('in-place');
	});
});
