/**
 * Issue #149 (A3 = C's "what I would take"): "ship the question-classifier row with a
 * generous trigger (anything with a question mark, or over five words, or starting
 * with what/why/how/who) rather than a precise one, and watch the false-negative case."
 * A generous trigger is the point - a typed name is short and rarely carries a `?`, so
 * leaning toward classifying something as a question costs little: the matching entity
 * still renders underneath the Ask row regardless (C's whole mock: "a near-miss on a
 * name and a genuine question can both show up").
 */
const QUESTION_STARTERS: Record<string, true> = { what: true, why: true, how: true, who: true };

export function looksLikeQuestion(query: string): boolean {
	const trimmed = query.trim();
	if (trimmed.length === 0) return false;
	if (trimmed.includes('?')) return true;

	const words = trimmed.split(/\s+/);
	if (words.length > 5) return true;

	const first = words[0].toLowerCase().replace(/[^a-z]/g, '');
	return QUESTION_STARTERS[first] === true;
}
