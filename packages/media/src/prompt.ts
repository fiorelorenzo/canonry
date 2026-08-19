/**
 * Prompt composition (#65, #66, SPEC.md §9: "the prompt is built from the entry's content
 * plus the style modifier"). Pure and DB-free: style resolution (which modifier wins)
 * lives in style.ts, markdown/mention cleanup is the caller's job (apps/web already owns
 * a DB-free stripMentionSyntax) - this module only ever concatenates strings, which makes
 * it trivial to unit test and impossible to accidentally query anything from.
 *
 * #258: the feature decides the framing clause, because a scene is not a portrait of a
 * place. What that clause is actually worth was measured rather than assumed, and it is
 * smaller than it looks: asking Replicate for a 16:9 canvas is already enough to stop a
 * model painting a face, on every candidate tried. What the clause buys is how much of the
 * entry the picture shows (adherence 0.625 to 0.708 on the same model, and one case that
 * both judges refused outright without it). docs/models.md's `scene` section is the table.
 */
import type { ImageFeature } from '@canonry/db/schema';

const MAX_DESCRIPTION_CHARS = 600;

// #255: how much of the user's regeneration instruction survives into the prompt - same
// budget-by-truncation idea as MAX_DESCRIPTION_CHARS, just smaller, since an instruction
// is meant to be a short correction ("older, and lose the helmet"), not a rewrite.
const MAX_INSTRUCTION_CHARS = 300;

/**
 * What a scene prompt says that a portrait prompt does not (#258). Three clauses: "wide
 * establishing view" moves the camera back, "the place itself" names the subject as a
 * location instead of whoever the entry text mentions, and "no posed figure" is what stops a
 * model reading "Aldric Vane drinks here" as an instruction to paint Aldric Vane. Every
 * candidate in the bench ran with this exact string, so the table in docs/models.md ranks
 * models and not prompts, and the control arm ran without it so the clause's own
 * contribution is a number there too.
 */
const SCENE_FRAMING =
	'a wide establishing view of the place itself, no posed figure filling the frame';

/** Only 'scene' adds a clause. Portrait and its variant batch keep the prompt they have
 * always had, so nothing about either changes shape because this exists. */
const FRAMING_BY_FEATURE: Partial<Record<ImageFeature, string>> = { scene: SCENE_FRAMING };

export interface ComposePromptInput {
	name: string;
	/** Entry body, already stripped of markdown/mention syntax by the caller. */
	description: string;
	/** The resolved style modifier - the entry's override if it set one, else the
	 * universe's, else null when neither exists. */
	styleModifier: string | null;
	/** Which image this prompt is for (#258). Required rather than defaulted: a caller
	 * that forgets to say silently gets portrait framing for a scene, which is the exact
	 * defect the in-body path had before this. */
	feature: ImageFeature;
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
	const clauses = [description.length > 0 ? `${input.name}. ${description}` : input.name];
	const framing = FRAMING_BY_FEATURE[input.feature];
	if (framing) clauses.push(framing);
	const trimmedStyle = input.styleModifier?.trim();
	if (trimmedStyle) clauses.push(trimmedStyle);
	return clauses.join(', ');
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
