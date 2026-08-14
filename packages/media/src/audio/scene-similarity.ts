/**
 * Same-scene duplicate suppression for ambient packs (#68, SPEC.md §8.2: "same-scene
 * duplicates are suppressed by Jaccard similarity at 0.30"). Reused from ai-game's
 * `scene-similarity.ts` close to verbatim - the stopword list, the four-character
 * floor and the 0.30 threshold are that file's own calibration, not a guess made here:
 * three paraphrased descriptions of the same tavern scene overlap at roughly 0.30
 * Jaccard on content tokens, while a genuine scene transition (tavern to cellar)
 * typically drops below 0.10 because the core nouns change.
 *
 * Pure and dependency-free on purpose: whether the currently active pack for a place is
 * "the same scene" as a new request is a text comparison, nothing here needs a database
 * or a model call to answer it.
 */

const STOPWORDS: Record<string, true> = {
	with: true,
	from: true,
	over: true,
	into: true,
	onto: true,
	upon: true,
	under: true,
	through: true,
	beyond: true,
	against: true,
	beneath: true,
	above: true,
	below: true,
	near: true,
	this: true,
	that: true,
	these: true,
	those: true,
	some: true,
	many: true,
	much: true,
	very: true,
	more: true,
	most: true,
	such: true,
	also: true,
	then: true,
	than: true,
	when: true,
	where: true,
	while: true,
	like: true,
	just: true
};

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/)
			.filter((token) => token.length >= 4 && !STOPWORDS[token])
	);
}

/** Jaccard similarity (|A intersect B| / |A union B|) between the content tokens of two
 * ambient descriptions. Zero when either side has no content tokens at all. */
export function contentJaccard(a: string, b: string): number {
	const tokensA = tokenize(a);
	const tokensB = tokenize(b);
	if (tokensA.size === 0 || tokensB.size === 0) return 0;

	let intersection = 0;
	for (const token of tokensA) {
		if (tokensB.has(token)) intersection++;
	}
	const union = tokensA.size + tokensB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/** SPEC.md §8.2's exact number, calibrated in ai-game against real paraphrase pairs
 * (see this file's header). A new request whose description scores at or above this
 * against the place's currently active pack is treated as the same scene, not a new
 * soundscape to pay for again. */
export const AMBIENT_SAME_SCENE_THRESHOLD = 0.3;
