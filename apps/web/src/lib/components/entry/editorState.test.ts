import { describe, expect, it } from 'vitest';
import {
	applyMentionSelection,
	findActiveTrigger,
	insertImage,
	insertLink,
	insertMentionTrigger,
	matchTargets,
	mentionMenuKeyAction,
	toggleLinePrefix,
	wrapSelection
} from './editorState';
import type { MentionTarget } from '../../markdown';

const TARGETS: MentionTarget[] = [
	{ name: 'The Ashen Ledger', slug: 'the-ashen-ledger', aliases: [] },
	{
		name: 'The Gilded Rat',
		slug: 'the-gilded-rat',
		aliases: ['Gilded Rat Tavern', 'Il Ratto Dorato']
	},
	{ name: 'Aldric Vane', slug: 'aldric-vane', aliases: ['Captain Vane'] }
];

describe('wrapSelection', () => {
	it('wraps a selection in matching markers', () => {
		const result = wrapSelection('He drinks at the Rat.', 13, 20, '**');
		expect(result.source).toBe('He drinks at **the Rat**.');
	});

	it('leaves the caret between the markers for an empty selection', () => {
		const result = wrapSelection('word ', 5, 5, '**');
		expect(result.source).toBe('word ****');
		expect(result.selectionStart).toBe(7);
		expect(result.selectionEnd).toBe(7);
	});
});

describe('toggleLinePrefix', () => {
	it('adds a heading marker to the touched line', () => {
		const result = toggleLinePrefix('Standing in the city', 0, 5, '## ');
		expect(result.source).toBe('## Standing in the city');
	});

	it('removes the marker on a second press', () => {
		const once = toggleLinePrefix('Standing in the city', 0, 5, '## ');
		const twice = toggleLinePrefix(once.source, once.selectionStart, once.selectionEnd, '## ');
		expect(twice.source).toBe('Standing in the city');
	});

	it('prefixes every line a multi-line selection touches', () => {
		const result = toggleLinePrefix('one\ntwo\nthree', 0, 11, '> ');
		expect(result.source).toBe('> one\n> two\n> three');
	});
});

describe('insertLink', () => {
	it('wraps the selection as link text and leaves the caret inside the url parens', () => {
		const result = insertLink('See the Rat.', 8, 11);
		expect(result.source).toBe('See the [Rat]().');
		expect(result.selectionStart).toBe(result.selectionEnd);
		expect(result.source.slice(0, result.selectionStart)).toBe('See the [Rat](');
	});
});

describe('insertImage', () => {
	it('writes the image markdown with a default alt when the selection is empty', () => {
		const result = insertImage('See the tavern.', 8, 8, '/w/w1/e/rat/media/a1');
		expect(result.source).toBe('See the ![image](/w/w1/e/rat/media/a1)tavern.');
	});

	it('uses a non-empty selection as the alt text', () => {
		const result = insertImage('See the Rat.', 8, 11, '/w/w1/e/rat/media/a1');
		expect(result.source).toBe('See the ![Rat](/w/w1/e/rat/media/a1).');
	});

	it('collapses the caret to just past the inserted markdown', () => {
		const result = insertImage('See the Rat.', 8, 11, '/w/w1/e/rat/media/a1');
		const inserted = '![Rat](/w/w1/e/rat/media/a1)';
		expect(result.selectionStart).toBe(result.selectionEnd);
		expect(result.selectionStart).toBe(8 + inserted.length);
		expect(result.source.slice(0, result.selectionStart)).toBe(`See the ${inserted}`);
	});
});

describe('insertMentionTrigger', () => {
	it('inserts [[ at the caret so trigger detection picks it up', () => {
		const result = insertMentionTrigger('He drinks at ', 13, 13);
		expect(result.source).toBe('He drinks at [[');
		expect(findActiveTrigger(result.source, result.selectionStart)?.kind).toBe('[[');
	});
});

describe('findActiveTrigger', () => {
	it('finds an open [[ trigger with its query', () => {
		const source = 'He answers to [[Ashen';
		const trigger = findActiveTrigger(source, source.length);
		expect(trigger).toEqual({ kind: '[[', start: 14, query: 'Ashen' });
	});

	it('finds an open @ trigger with its query', () => {
		const source = 'He answers to @Ashen';
		const trigger = findActiveTrigger(source, source.length);
		expect(trigger).toEqual({ kind: '@', start: 14, query: 'Ashen' });
	});

	it('returns null once the [[ mention is already closed', () => {
		const source = 'He answers to [[The Ashen Ledger]] now';
		expect(findActiveTrigger(source, source.length)).toBeNull();
	});

	it('returns null once an @ trigger hits whitespace', () => {
		const source = 'He answers to @Ashen Ledger now';
		expect(findActiveTrigger(source, source.length)).toBeNull();
	});

	it('returns null with no trigger in the text', () => {
		expect(findActiveTrigger('Plain prose only.', 10)).toBeNull();
	});
});

describe('matchTargets', () => {
	it('ranks a name that starts with the query above one that merely contains it', () => {
		const results = matchTargets(TARGETS, 'ash');
		expect(results[0]?.name).toBe('The Ashen Ledger');
	});

	it('matches on alias as well as canonical name', () => {
		const results = matchTargets(TARGETS, 'dorato');
		expect(results.map((t) => t.slug)).toEqual(['the-gilded-rat']);
	});

	it('returns every target for an empty query', () => {
		expect(matchTargets(TARGETS, '')).toHaveLength(TARGETS.length);
	});
});

describe('applyMentionSelection', () => {
	it('replaces the trigger and query with the canonical [[Name]] form', () => {
		const source = 'He answers to [[Ashen now';
		const trigger = findActiveTrigger(source, 21);
		expect(trigger).not.toBeNull();
		const target = TARGETS[0];
		const result = applyMentionSelection(source, trigger!, 21, target);
		expect(result.source).toBe('He answers to [[The Ashen Ledger]] now');
	});

	it('normalises an @ trigger to the bracketed canonical form too', () => {
		const source = 'He drinks at @Dorato';
		const trigger = findActiveTrigger(source, source.length);
		expect(trigger).not.toBeNull();
		const target = TARGETS[1];
		const result = applyMentionSelection(source, trigger!, source.length, target);
		expect(result.source).toBe('He drinks at [[The Gilded Rat]]');
	});
});

describe('mentionMenuKeyAction', () => {
	it('ArrowDown moves the highlight forward', () => {
		expect(mentionMenuKeyAction('ArrowDown', 0, 3)).toEqual({ type: 'move', index: 1 });
	});

	it('ArrowDown wraps from the last row back to the first', () => {
		expect(mentionMenuKeyAction('ArrowDown', 2, 3)).toEqual({ type: 'move', index: 0 });
	});

	it('ArrowUp moves the highlight backward', () => {
		expect(mentionMenuKeyAction('ArrowUp', 2, 3)).toEqual({ type: 'move', index: 1 });
	});

	it('ArrowUp wraps from the first row back to the last', () => {
		expect(mentionMenuKeyAction('ArrowUp', 0, 3)).toEqual({ type: 'move', index: 2 });
	});

	it('Enter accepts the highlighted row', () => {
		expect(mentionMenuKeyAction('Enter', 1, 3)).toEqual({ type: 'accept', index: 1 });
	});

	it('Tab accepts the highlighted row, same as Enter', () => {
		expect(mentionMenuKeyAction('Tab', 1, 3)).toEqual({ type: 'accept', index: 1 });
	});

	it('Escape closes the menu regardless of how many rows it holds', () => {
		expect(mentionMenuKeyAction('Escape', 1, 3)).toEqual({ type: 'close' });
		expect(mentionMenuKeyAction('Escape', 0, 0)).toEqual({ type: 'close' });
	});

	it('ignores navigation and accept keys when there is nothing to act on', () => {
		expect(mentionMenuKeyAction('ArrowDown', 0, 0)).toEqual({ type: 'ignore' });
		expect(mentionMenuKeyAction('Enter', 0, 0)).toEqual({ type: 'ignore' });
	});
});
