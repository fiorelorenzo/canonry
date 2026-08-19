import { describe, expect, it } from 'vitest';
import { composePrompt, composeRegeneratePrompt } from './prompt.js';

describe('composePrompt', () => {
	it('builds the prompt from the entry name, description and style modifier (#65, #66)', () => {
		const prompt = composePrompt({
			name: 'Aldric Vane',
			description: 'Dismissed watch captain, lean and grey-coated, Lantern Quarter backdrop.',
			styleModifier: 'ink and wash, muted, cold light',
			feature: 'portrait'
		});
		expect(prompt).toBe(
			'Aldric Vane. Dismissed watch captain, lean and grey-coated, Lantern Quarter backdrop., ink and wash, muted, cold light'
		);
	});

	it('omits the style clause entirely when there is no style modifier', () => {
		const prompt = composePrompt({
			name: 'The Gilded Rat',
			description: 'A tavern.',
			styleModifier: null,
			feature: 'portrait'
		});
		expect(prompt).toBe('The Gilded Rat. A tavern.');
	});

	it('falls back to just the name when the description is empty', () => {
		const prompt = composePrompt({
			name: 'Aldric Vane',
			description: '',
			styleModifier: null,
			feature: 'portrait'
		});
		expect(prompt).toBe('Aldric Vane');
	});

	it('truncates a long description on a word boundary rather than mid-word', () => {
		const longWord = 'x'.repeat(700);
		const prompt = composePrompt({
			name: 'Entry',
			description: `${longWord} tail`,
			styleModifier: null,
			feature: 'portrait'
		});
		// The 700-character run alone already exceeds the 600-char budget, so the whole
		// description is cut before " tail" is ever reached, and cleanly (no trailing
		// partial word glued onto the truncation boundary).
		expect(prompt.startsWith('Entry. ')).toBe(true);
		expect(prompt).not.toContain('tail');
		expect(prompt.length).toBeLessThan(620);
	});

	it('ignores a blank (whitespace-only) style modifier the same as a missing one', () => {
		const prompt = composePrompt({
			name: 'Entry',
			description: 'Body.',
			styleModifier: '   ',
			feature: 'portrait'
		});
		expect(prompt).toBe('Entry. Body.');
	});

	it('adds nothing for the variant batch, which is a portrait rendered four times', () => {
		const portrait = composePrompt({
			name: 'Aldric Vane',
			description: 'A dismissed captain.',
			styleModifier: null,
			feature: 'portrait'
		});
		const variants = composePrompt({
			name: 'Aldric Vane',
			description: 'A dismissed captain.',
			styleModifier: null,
			feature: 'variants'
		});
		expect(variants).toBe(portrait);
	});

	// #258: the framing clause is the difference between "a picture of this place" and "a
	// picture of whoever this place's prose mentions", and it has to sit between the entry
	// text and the style so the style modifier still reads as the last word on the look.
	it('frames a scene as a wide view of the place, before the style clause (#258)', () => {
		const prompt = composePrompt({
			name: 'The Cistern Quarter',
			description: "Valdoria's second poorest quarter. Sera Voss grew up here.",
			styleModifier: 'ink and wash, muted, cold light',
			feature: 'scene'
		});
		expect(prompt).toBe(
			"The Cistern Quarter. Valdoria's second poorest quarter. Sera Voss grew up here., " +
				'a wide establishing view of the place itself, no posed figure filling the frame, ' +
				'ink and wash, muted, cold light'
		);
	});

	it('frames a scene even with no style modifier, so the clause never depends on one', () => {
		const prompt = composePrompt({
			name: 'The Sable Reach',
			description: 'A strait that froze in 1247.',
			styleModifier: null,
			feature: 'scene'
		});
		expect(prompt).toBe(
			'The Sable Reach. A strait that froze in 1247., ' +
				'a wide establishing view of the place itself, no posed figure filling the frame'
		);
	});
});

describe('composeRegeneratePrompt (#255)', () => {
	it('appends the instruction to the prior prompt, verbatim', () => {
		const prompt = composeRegeneratePrompt({
			priorPrompt: 'Aldric Vane. Lean and grey-coated., ink and wash, muted, cold light',
			instruction: 'older, and lose the helmet'
		});
		expect(prompt).toBe(
			'Aldric Vane. Lean and grey-coated., ink and wash, muted, cold light. older, and lose the helmet'
		);
	});

	it('returns the prior prompt unchanged when the instruction is blank', () => {
		const prompt = composeRegeneratePrompt({ priorPrompt: 'Aldric Vane.', instruction: '   ' });
		expect(prompt).toBe('Aldric Vane.');
	});

	it('truncates a long instruction on a word boundary, the same as a long description', () => {
		const longWord = 'x'.repeat(400);
		const prompt = composeRegeneratePrompt({
			priorPrompt: 'Aldric Vane',
			instruction: `${longWord} tail`
		});
		expect(prompt.startsWith('Aldric Vane. ')).toBe(true);
		expect(prompt).not.toContain('tail');
		expect(prompt.length).toBeLessThan(320);
	});
});
