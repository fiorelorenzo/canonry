import { describe, expect, it } from 'vitest';
import { semanticDiff, splitIntoSentences } from './diff.js';

describe('splitIntoSentences', () => {
	it('splits a paragraph into sentences and keeps a heading as its own unit', () => {
		const body =
			'Dismissed from the watch, he now answers to the Ledger. He still drinks at the Rat.\n\n## Standing in the city\n\nForty of them still would.';
		expect(splitIntoSentences(body)).toEqual([
			'Dismissed from the watch, he now answers to the Ledger.',
			'He still drinks at the Rat.',
			'## Standing in the city',
			'Forty of them still would.'
		]);
	});

	it('drops blank lines and trims whitespace', () => {
		expect(splitIntoSentences('  One sentence.  \n\n\n  Another one.  ')).toEqual([
			'One sentence.',
			'Another one.'
		]);
	});
});

describe('semanticDiff', () => {
	it('reports no changes when the body is untouched', () => {
		const body = 'Aldric works for the Ledger. He drinks at the Rat.';
		expect(semanticDiff(body, body)).toEqual([]);
	});

	it('reports a pure addition as added, in reading order', () => {
		const oldBody = 'Aldric works for the Ledger.';
		const newBody = 'Aldric works for the Ledger. Iselde is reviewing his appointment.';
		expect(semanticDiff(oldBody, newBody)).toEqual([
			{ kind: 'added', statement: 'Iselde is reviewing his appointment.' }
		]);
	});

	it('reports a pure removal as removed', () => {
		const oldBody = 'Aldric works for the Ledger. He drinks at the Rat.';
		const newBody = 'Aldric works for the Ledger.';
		expect(semanticDiff(oldBody, newBody)).toEqual([
			{ kind: 'removed', statement: 'He drinks at the Rat.' }
		]);
	});

	it('pairs a reworded sentence as changed rather than remove-plus-add', () => {
		const oldBody = 'Aldric was dismissed from the watch in the thaw.';
		const newBody = 'Aldric was dismissed from the watch after the freeze broke.';
		const result = semanticDiff(oldBody, newBody);
		expect(result).toEqual([
			{
				kind: 'changed',
				statement: 'Aldric was dismissed from the watch after the freeze broke.',
				previousStatement: 'Aldric was dismissed from the watch in the thaw.'
			}
		]);
	});

	it('does not pair an unrelated remove and add into a false "changed"', () => {
		const oldBody = 'Aldric drinks at the Gilded Rat.';
		const newBody = 'A merchant caravan arrived from the coast this week.';
		const result = semanticDiff(oldBody, newBody);
		expect(result).toContainEqual({
			kind: 'removed',
			statement: 'Aldric drinks at the Gilded Rat.'
		});
		expect(result).toContainEqual({
			kind: 'added',
			statement: 'A merchant caravan arrived from the coast this week.'
		});
		expect(result.every((c) => c.kind !== 'changed')).toBe(true);
	});

	it('handles a heading addition and an appended paragraph together', () => {
		const oldBody = 'Aldric works for the Ledger.';
		const newBody =
			'Aldric works for the Ledger.\n\n## Standing in the city\n\nForty sworn still trust him.';
		const result = semanticDiff(oldBody, newBody);
		expect(result).toEqual([
			{ kind: 'added', statement: '## Standing in the city' },
			{ kind: 'added', statement: 'Forty sworn still trust him.' }
		]);
	});
});
