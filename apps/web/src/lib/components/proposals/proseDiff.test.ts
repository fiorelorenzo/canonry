/**
 * Q1 (issue #362) moved the whole of "what a reviewer sees" into one pure function over
 * two strings, so this is where it is kept correct: no database, no component, no browser.
 * What each test defends is a claim the card makes visually and cannot check for itself.
 */
import { describe, expect, it } from 'vitest';
import { proseDiff, wordSpans, type ProseDiffRow } from './proseDiff';

function kinds(rows: readonly ProseDiffRow[]): string[] {
	return rows.map((row) => row.kind);
}

function textOf(rows: readonly ProseDiffRow[], kind: ProseDiffRow['kind']): string[] {
	return rows.filter((row) => row.kind === kind).map((row) => ('text' in row ? row.text : ''));
}

const BODY = [
	'# Aldric Vane',
	'',
	'Aldric Vane was captain of the Harbour Watch for eleven years.',
	'He kept the tide gates and the ledger of arrivals.',
	'The council trusted him with the seal of the inner docks.',
	'',
	'## Service',
	'',
	'He was dismissed from the watch after the flood of the third autumn.',
	'He now keeps a chandlery on the Long Quay.',
	'His daughter Maren reads the ledgers he no longer signs.'
].join('\n');

describe('proseDiff, the shape of what a reviewer reads', () => {
	it('yields nothing at all when the body did not change, rather than a wall of context', () => {
		const diff = proseDiff(BODY, BODY);
		expect(diff.rows).toEqual([]);
		expect(diff.regions).toBe(0);
	});

	it('shows every changed region at once, which is the whole of Q1', () => {
		const after = BODY.replace(
			'The council trusted him with the seal of the inner docks.',
			'The council trusted him with the seal of the inner docks until the winter of the wreck.'
		).replace(
			'He now keeps a chandlery on the Long Quay.',
			'He now keeps a chandlery on Tallow Row.'
		);
		const diff = proseDiff(BODY, after);
		expect(diff.regions).toBe(2);
		// Both regions are present in one pass: two changed rows, no toggle in between.
		expect(kinds(diff.rows).filter((kind) => kind === 'changed')).toHaveLength(2);
	});

	it('keeps one unchanged sentence on each side of a change and counts the rest away', () => {
		const after = BODY.replace(
			'He kept the tide gates and the ledger of arrivals.',
			'He kept the tide gates, the ledger of arrivals and the harbour keys.'
		);
		const diff = proseDiff(BODY, after);
		const changedAt = diff.rows.findIndex((row) => row.kind === 'changed');
		expect(diff.rows[changedAt - 1]).toMatchObject({
			kind: 'kept',
			text: 'Aldric Vane was captain of the Harbour Watch for eleven years.'
		});
		expect(diff.rows[changedAt + 1]).toMatchObject({
			kind: 'kept',
			text: 'The council trusted him with the seal of the inner docks.'
		});
		// Everything past that context is a counted gap, never silently dropped.
		const gaps = diff.rows.filter((row) => row.kind === 'gap');
		expect(gaps.length).toBeGreaterThan(0);
		expect(gaps.every((gap) => gap.kind === 'gap' && gap.units > 0)).toBe(true);
	});

	it('keeps the heading a change sits under, however far above it is', () => {
		const after = BODY.replace(
			'His daughter Maren reads the ledgers he no longer signs.',
			'His daughter Maren keeps the ledgers he no longer signs.'
		);
		const diff = proseDiff(BODY, after);
		const headings = diff.rows.filter((row) => row.kind === 'kept' && row.heading);
		expect(headings).toHaveLength(1);
		expect(headings[0]).toMatchObject({ text: 'Service' });
	});

	it('marks the words inside a reworded sentence rather than the whole sentence', () => {
		const after = BODY.replace(
			'He was dismissed from the watch after the flood of the third autumn.',
			'He was reinstated to the watch after the flood of the third autumn.'
		);
		const diff = proseDiff(BODY, after);
		const changed = diff.rows.find((row) => row.kind === 'changed');
		expect(changed).toBeDefined();
		if (changed?.kind !== 'changed') throw new Error('expected a changed row');
		expect(
			changed.spans.filter((span) => span.kind === 'removed').map((span) => span.text)
		).toEqual(['dismissed from']);
		expect(changed.spans.filter((span) => span.kind === 'added').map((span) => span.text)).toEqual([
			'reinstated to'
		]);
		expect(changed.spans.map((span) => span.text).join(' ')).toContain('after the flood');
	});

	it('treats a sentence that only leaves as a removal, not as a rewording of its neighbour', () => {
		const after = BODY.replace('\nHe kept the tide gates and the ledger of arrivals.', '');
		const diff = proseDiff(BODY, after);
		expect(textOf(diff.rows, 'removed')).toEqual([
			'He kept the tide gates and the ledger of arrivals.'
		]);
		expect(textOf(diff.rows, 'changed')).toEqual([]);
	});

	it('prints what leaves before what arrives inside one region, so order carries it', () => {
		const after = BODY.replace(
			'He kept the tide gates and the ledger of arrivals.',
			'Two of the gates were his own design.'
		);
		const diff = proseDiff(BODY, after);
		const region = kinds(diff.rows).filter((kind) => kind === 'removed' || kind === 'added');
		expect(region).toEqual(['removed', 'added']);
	});

	it('reads a brand new entry as all added, since that is what accepting one is', () => {
		const diff = proseDiff('', 'A farming community of twelve hundred souls. It has one mill.');
		expect(kinds(diff.rows)).toEqual(['added', 'added']);
		expect(diff.regions).toBe(1);
		expect(diff.rows.some((row) => row.kind === 'gap')).toBe(false);
	});

	it('strips the heading markers it renders, and says which rows are headings', () => {
		const diff = proseDiff('# Old title\n\nOne sentence.', '# New title\n\nOne sentence.');
		const heads = diff.rows.filter((row) => row.kind !== 'gap' && row.heading);
		expect(heads.map((row) => ('text' in row ? row.text : ''))).toEqual(['Old title', 'New title']);
	});

	it('never pairs a retitled heading with a rewritten sentence', () => {
		const diff = proseDiff(
			'# The Harbour Watch\n\nThe watch keeps the tide gates.',
			'# The Harbour Watch of Vane\n\nThe watch keeps the tide gates and the ledger.'
		);
		const changed = diff.rows.filter((row) => row.kind === 'changed');
		expect(changed).toHaveLength(2);
		expect(changed.map((row) => row.kind === 'changed' && row.heading)).toEqual([true, false]);
	});
});

describe('wordSpans, the marking inside one sentence', () => {
	it('keeps the words that survive, in the order the sentence reads', () => {
		const spans = wordSpans('He kept the tide gates.', 'He kept the tide gates and the keys.');
		expect(spans).toEqual([
			{ kind: 'kept', text: 'He kept the tide' },
			{ kind: 'removed', text: 'gates.' },
			{ kind: 'added', text: 'gates and the keys.' }
		]);
	});

	it('falls back to a whole-sentence replacement when too little survives to mark', () => {
		const spans = wordSpans(
			'The seal of the inner docks was his.',
			'His was the seal, docks and inner both, of the.'
		);
		expect(spans.map((span) => span.kind)).toEqual(['removed', 'added']);
		expect(spans[0]?.text).toBe('The seal of the inner docks was his.');
	});
});
