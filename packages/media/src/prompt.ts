/**
 * Prompt composition (#65, #66, SPEC.md §9: "the prompt is built from the entry's content
 * plus the style modifier"). Pure and DB-free: style resolution (which modifier wins)
 * lives in style.ts, markdown/mention cleanup is the caller's job (apps/web already owns
 * a DB-free stripMentionSyntax) - this module only ever concatenates strings, which makes
 * it trivial to unit test and impossible to accidentally query anything from.
 */

const MAX_DESCRIPTION_CHARS = 600;

// #255: how much of the user's regeneration instruction survives into the prompt - same
// budget-by-truncation idea as MAX_DESCRIPTION_CHARS, just smaller, since an instruction
// is meant to be a short correction ("older, and lose the helmet"), not a rewrite.
const MAX_INSTRUCTION_CHARS = 300;

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

export interface ComposeRegeneratePromptInput {
	/** The prior attempt's own stored `media_asset.prompt` (#255). Used verbatim as the
	 * base - already built, already truncated, already carrying whatever style it had -
	 * so a regeneration is a variation on the picture the user is looking at rather than
	 * a fresh roll from the entry text through composePrompt above. */
	priorPrompt: string;
	/** The user's stated fix. Plain appended text: this function has no notion of a
	 * "command", so there is nothing here for an instruction to do beyond lengthen the
	 * string that gets sent to the image model - see generate.ts's header comment for the
	 * full reasoning (SPEC.md §6.5's "treat it as data" pattern, applied to a string
	 * concatenation instead of a tool-calling loop). */
	instruction: string;
}

/** #255: builds the prompt for a regeneration. Truncated on a word boundary the same way
 * composePrompt truncates a description, so a pasted essay cannot blow the prompt budget
 * or the provider's own input limit. */
export function composeRegeneratePrompt(input: ComposeRegeneratePromptInput): string {
	const instruction = truncate(input.instruction, MAX_INSTRUCTION_CHARS);
	return instruction ? `${input.priorPrompt}. ${instruction}` : input.priorPrompt;
}
