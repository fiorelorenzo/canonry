/**
 * Issue #378: the pure function #379's checklist (R4) and the settings page both read,
 * so what "incomplete" means only ever has one answer.
 */
import { describe, expect, it } from 'vitest';
import { universeSetupItems } from './universe-setup.js';

describe('universeSetupItems (issue #378, decision R3/R4)', () => {
	it('both items are incomplete for a freshly created universe', () => {
		const items = universeSetupItems({ imageStyleId: null, loremasterDescription: '' });
		expect(items).toEqual([
			{ id: 'imageStyle', done: false },
			{ id: 'loremasterVoice', done: false }
		]);
	});

	it('imageStyle is done once the universe points at a style row, whatever it is named', () => {
		const items = universeSetupItems({
			imageStyleId: 'a-style-row-id',
			loremasterDescription: ''
		});
		expect(items.find((i) => i.id === 'imageStyle')).toEqual({ id: 'imageStyle', done: true });
	});

	it('loremasterVoice is done once the description carries real text', () => {
		const items = universeSetupItems({
			imageStyleId: null,
			loremasterDescription: 'Wry, understated, never more than a sentence at a time.'
		});
		expect(items.find((i) => i.id === 'loremasterVoice')).toEqual({
			id: 'loremasterVoice',
			done: true
		});
	});

	it('a description of only whitespace still reads as unset, matching what reaches the prompt', () => {
		const items = universeSetupItems({ imageStyleId: null, loremasterDescription: '   \n\t ' });
		expect(items.find((i) => i.id === 'loremasterVoice')).toEqual({
			id: 'loremasterVoice',
			done: false
		});
	});

	it('both items are done once a universe has set both', () => {
		const items = universeSetupItems({
			imageStyleId: 'a-style-row-id',
			loremasterDescription: 'Formal, archival, third person.'
		});
		expect(items.every((i) => i.done)).toBe(true);
	});
});
