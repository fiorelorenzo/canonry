/**
 * Prompt composition (#65, #66, SPEC.md §9: "the prompt is built from the entry's content
 * plus the style modifier"). Pure and DB-free: style resolution (which modifier wins)
 * lives in style.ts, markdown/mention cleanup is the caller's job (apps/web already owns
 * a DB-free stripMentionSyntax) - this module only ever concatenates strings, which makes
 * it trivial to unit test and impossible to accidentally query anything from.
 */

const MAX_DESCRIPTION_CHARS = 600;

export interface ComposePromptInput {
	name: string;
	/** Entry body, already stripped of markdown/mention syntax by the caller. */
	description: string;
	/** The resolved style modifier - the entry's override if it set one, else the
	 * universe's, else null when neither exists. */
	styleModifier: string | null;
}

/** Truncates on a word boundary rather than mid-word, so a cut description still reads
 * like a sentence fragment instead of a broken token. */
function truncate(text: string, maxChars: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) return trimmed;
	const slice = trimmed.slice(0, maxChars);
	const lastSpace = slice.lastIndexOf(' ');
	return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd();
}

export function composePrompt(input: ComposePromptInput): string {
	const description = truncate(input.description, MAX_DESCRIPTION_CHARS);
	const base = description.length > 0 ? `${input.name}. ${description}` : input.name;
	const trimmedStyle = input.styleModifier?.trim();
	return trimmedStyle ? `${base}, ${trimmedStyle}` : base;
}
