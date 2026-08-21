/**
 * Issue #378: the pure function #379's checklist (R4) and the settings page both read,
 * so what "incomplete" means only ever has one answer. Issue #451, decision U2: the
 * Loremaster voice item now reads `narrationStyleId`, the same "is a row pointed at" test
 * `imageStyle` already used, replacing the free-text `loremaster_description` check.
 */
import { describe, expect, it } from 'vitest';
import { universeSetupItems } from './universe-setup.js';

describe('universeSetupItems (issue #378, decision R3/R4; issue #451, decision U2)', () => {
	it('both items are incomplete for a freshly created universe', () => {
		const items = universeSetupItems({ imageStyleId: null, narrationStyleId: null });
		expect(items).toEqual([
			{ id: 'imageStyle', done: false },
			{ id: 'loremasterVoice', done: false }
		]);
	});

	it('imageStyle is done once the universe points at a style row, whatever it is named', () => {
		const items = universeSetupItems({
			imageStyleId: 'a-style-row-id',
			narrationStyleId: null
		});
		expect(items.find((i) => i.id === 'imageStyle')).toEqual({ id: 'imageStyle', done: true });
	});

	it('loremasterVoice is done once the universe points at a narration style row, preset or custom', () => {
		const items = universeSetupItems({
			imageStyleId: null,
			narrationStyleId: 'a-narration-style-row-id'
		});
		expect(items.find((i) => i.id === 'loremasterVoice')).toEqual({
			id: 'loremasterVoice',
			done: true
		});
	});

	it('both items are done once a universe has set both', () => {
		const items = universeSetupItems({
			imageStyleId: 'a-style-row-id',
			narrationStyleId: 'a-narration-style-row-id'
		});
		expect(items.every((i) => i.done)).toBe(true);
	});
});
