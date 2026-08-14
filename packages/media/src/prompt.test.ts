import { describe, expect, it } from 'vitest';
import { composePrompt } from './prompt.js';

describe('composePrompt', () => {
	it('builds the prompt from the entry name, description and style modifier (#65, #66)', () => {
		const prompt = composePrompt({
			name: 'Aldric Vane',
			description: 'Dismissed watch captain, lean and grey-coated, Lantern Quarter backdrop.',
			styleModifier: 'ink and wash, muted, cold light'
		});
		expect(prompt).toBe(
			'Aldric Vane. Dismissed watch captain, lean and grey-coated, Lantern Quarter backdrop., ink and wash, muted, cold light'
		);
	});

	it('omits the style clause entirely when there is no style modifier', () => {
		const prompt = composePrompt({
			name: 'The Gilded Rat',
			description: 'A tavern.',
			styleModifier: null
		});
		expect(prompt).toBe('The Gilded Rat. A tavern.');
	});

	it('falls back to just the name when the description is empty', () => {
		const prompt = composePrompt({ name: 'Aldric Vane', description: '', styleModifier: null });
		expect(prompt).toBe('Aldric Vane');
	});

	it('truncates a long description on a word boundary rather than mid-word', () => {
		const longWord = 'x'.repeat(700);
		const prompt = composePrompt({
			name: 'Entry',
			description: `${longWord} tail`,
			styleModifier: null
		});
		// The 700-character run alone already exceeds the 600-char budget, so the whole
		// description is cut before " tail" is ever reached, and cleanly (no trailing
		// partial word glued onto the truncation boundary).
		expect(prompt.startsWith('Entry. ')).toBe(true);
		expect(prompt).not.toContain('tail');
		expect(prompt.length).toBeLessThan(620);
	});

	it('ignores a blank (whitespace-only) style modifier the same as a missing one', () => {
		const prompt = composePrompt({ name: 'Entry', description: 'Body.', styleModifier: '   ' });
		expect(prompt).toBe('Entry. Body.');
	});
});
