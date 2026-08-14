import { describe, expect, it } from 'vitest';
import { renderAiMarkedParagraph, type ParagraphSegment } from './aiMarking';

describe('renderAiMarkedParagraph', () => {
	it('marks a proposed run structurally, not only with a colour class', () => {
		const html = renderAiMarkedParagraph([
			{ text: 'Captain of the Valdoria Watch.', proposed: true }
		]);
		expect(html).toContain('data-ai-marked="true"');
	});

	it('gives the proposed run a dashed underline expressed as a shape, not a hue', () => {
		const html = renderAiMarkedParagraph([
			{ text: 'Captain of the Valdoria Watch.', proposed: true }
		]);
		expect(html).toContain('ai-marked-text');
	});

	it('counts one marker per paragraph regardless of how many sentences are proposed', () => {
		const segments: ParagraphSegment[] = [
			{ text: 'Captain of the Valdoria Watch, forty sworn under him.', proposed: true },
			{ text: 'Iselde Wrenn appointed him after the second freeze.', proposed: true },
			{ text: 'He drinks at the Gilded Rat most nights.', proposed: true },
			{ text: "Three hundred and forty sworn take his word over a stranger's.", proposed: true }
		];
		const html = renderAiMarkedParagraph(segments);
		expect(html).toContain('data-ai-marker="4"');
		expect((html.match(/data-ai-marked="true"/g) ?? []).length).toBe(4);
	});

	it('omits the marker entirely when nothing in the paragraph is proposed', () => {
		const html = renderAiMarkedParagraph([{ text: 'Plain canon wording.', proposed: false }]);
		expect(html).not.toContain('data-ai-marker');
	});

	it('still marks the text with colour removed: the structural cues do not depend on any colour value', () => {
		const html = renderAiMarkedParagraph([{ text: 'Dismissed from the watch.', proposed: true }]);
		// Simulate "remove colour": strip every class/style token that names a colour and
		// confirm the shape cue (the dashed-underline class name) and the numbered marker
		// (plain text content) both survive, since neither depends on a `color` value.
		const withoutColourHints = html.replace(/text-\w+|bg-\w+|decoration-\w+/g, '');
		expect(withoutColourHints).toContain('ai-marked-text');
		expect(withoutColourHints).toContain('data-ai-marked="true"');
		expect(withoutColourHints).toContain('>1<');
	});
});
