/**
 * Pure rendering for C1 = B: "unaccepted AI text is a dashed underline plus a numbered
 * margin marker," never hue alone. This module builds the HTML string the component
 * injects via `{@html}`, kept separate and pure so the marking's two cues - the marker
 * text and the underline's shape, not merely its colour - are directly testable without a
 * mounted component or a DOM (this repo's vitest setup has no jsdom/happy-dom project).
 *
 * One marker per paragraph, not per sentence: the artifact's own worst case is a
 * four-sentence rewrite, and it stays exactly as visible as a one-sentence one rather than
 * stacking four badges.
 */

export interface ParagraphSegment {
	text: string;
	/** True for wording a pending AI proposal wrote; false for the GM's own wording. */
	proposed: boolean;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/**
 * Renders one paragraph. A proposed run gets `data-ai-marked="true"` (structural, not a
 * style, so it survives a grayscale filter or a stylesheet failure) and a dashed underline
 * expressed as a border-style rather than a colour; the paragraph as a whole gets a
 * numbered marker equal to how many proposed runs it holds, or nothing if it holds none.
 */
export function renderAiMarkedParagraph(segments: ParagraphSegment[]): string {
	const markerCount = segments.filter((segment) => segment.proposed).length;
	const marker =
		markerCount > 0
			? `<span class="ai-marker" data-ai-marker="${markerCount}" aria-hidden="true">${markerCount}</span>`
			: '';
	const body = segments
		.map((segment) =>
			segment.proposed
				? `<span class="ai-marked-text" data-ai-marked="true">${escapeHtml(segment.text)}</span>`
				: escapeHtml(segment.text)
		)
		.join(' ');
	return `${marker}<p class="ai-paragraph">${body}</p>`;
}
