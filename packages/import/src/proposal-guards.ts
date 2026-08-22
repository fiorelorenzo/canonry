/**
 * The deterministic guards that stand between an extraction and a proposal a GM would
 * reject (issue #479, SPEC.md §6.1's "match against what already exists, merge, resolve
 * conflicts - a deterministic engine, this is where damage would happen, so no model
 * decides it", and SPEC.md §14's accept rate).
 *
 * **Why these are engine rules and not playbook prose.** #479's import produced seven
 * proposals, three of which a GM could only reject: a `create` duplicating an entry that
 * already existed, and two `update`s each replacing a written entry with one derived
 * sentence. A prompt can be improved and it stays a request; the next model, the next
 * playbook version, or a note phrased slightly differently re-opens it, and nothing fails
 * when it does. Every function here is pure, free, and testable against a fixture, so the
 * shapes #479 found cannot come back silently. The playbook change is the second half, not
 * the load-bearing one.
 *
 * **What they never do.** No guard writes anything, and no guard turns a rejection into an
 * acceptance: they only ever refuse a proposal or shrink its patch. Guardrail 1 is
 * untouched, and so is guardrail 3 - a proposal that survives still carries exactly the
 * evidence it carried before.
 */
import { normalizeForMatching } from './matching.js';

/** Tokens of a piece of text, normalized as the matcher normalizes a name, shorter than
 * this dropped.
 *
 * Four characters removes the shortest function words in both languages SPEC.md §17 names
 * ("the", "and", "of", "a", "in", "to", "il", "la", "di", "un", "e") without needing a
 * per-language stopword list, which is the thing this file must not grow. It is imprecise
 * in both directions ("con" and "per" go, "della" and "that" stay), and that is tolerable
 * because of how the one caller uses it: `isBareMention` fires only when the
 * count is exactly zero, so a leaked function word makes the guard fire *less* often. The
 * error direction is always "let the proposal through". */
const MIN_CONTENT_TOKEN_CHARS = 4;

function contentTokens(text: string): Set<string> {
	const tokens = normalizeForMatching(text).split(' ');
	return new Set(tokens.filter((token) => token.length >= MIN_CONTENT_TOKEN_CHARS));
}

/** Every `:::name` directive block a body opens. Canonry writes secrets and GM notes as
 * `:::secret` / `:::gmnote` fences (SPEC.md §10), which is content a GM typed deliberately
 * and the one thing in a body that must never be lost to a summary. */
function directiveBlocks(body: string): Set<string> {
	const found = new Set<string>();
	for (const match of body.matchAll(/^:::([a-z][a-z0-9_-]*)/gim)) {
		const name = match[1]?.toLowerCase();
		if (name) found.add(name);
	}
	return found;
}

/** How much of an existing body's content an `update`'s `after` has to carry over before
 * it counts as a rewrite rather than a deletion.
 *
 * Chosen, not measured, and deliberately low. #479's two Ashen Ledger proposals retain
 * about 0.02 of the body they replace, so anything under about 0.9 catches them; the number
 * is set where it is so that a genuine reword of the same prose (SPEC.md §6.4's "changed at
 * the source too" conflict, which must still reach the GM as a proposal) is not mistaken
 * for a deletion. It only ever applies to an `after` that is also *shorter* than what it
 * replaces, so a longer and richer replacement is never refused on this account whatever it
 * retains. A future measurement belongs in `packages/bench`'s matching sweep alongside the
 * thresholds of SPEC.md §6.4, which are measured for the same reason. */
const MIN_BODY_RETENTION = 0.5;

export type BodyWriteVerdict =
	| { loses: false }
	| {
			loses: true;
			reason: 'empties_written_body' | 'drops_directive_block' | 'drops_body_content';
	  };

/**
 * Whether accepting `after` as an entity's whole body would destroy canon rather than
 * improve it (issue #479's second defect).
 *
 * `packages/db`'s accept path writes `body: patch.after ?? current.body`, so an `update`
 * patch's `after` is a **replacement of the entire body**, not an addition to it. An
 * import's `after` is `EntityProposalPayload.summary`, one or two sentences derived from a
 * source document, which is exactly right when the entity has no body yet and is a
 * deletion when it has one: #479's The Ashen Ledger had a written line plus a `:::secret`
 * and a `:::gmnote`, and each of the two proposals against it offered a single sentence in
 * their place. The GM does see that diff, so guardrail 1 was holding; what was broken is
 * that the proposal was worth rejecting, and SPEC.md §14 makes accept rate the metric that
 * decides whether the copilot is noise.
 *
 * Three refusals, cheapest first:
 *
 *  - `after` is blank against a written body: a straight deletion;
 *  - the body opens a `:::` directive block that `after` does not: losing a secret is a
 *    guardrail 6 problem and is refused whatever the lengths involved, because a secret is
 *    not prose to be reworded;
 *  - `after` is shorter than the body **and** carries less than `MIN_BODY_RETENTION` of its
 *    content tokens.
 *
 * A blank current body is never a loss, which is the case that keeps a first import
 * working: an entity created empty and filled in from its source is the whole point.
 */
export function bodyWriteVerdict(currentBody: string, after: string): BodyWriteVerdict {
	const current = currentBody.trim();
	if (current.length === 0) return { loses: false };
	const proposed = after.trim();
	if (proposed.length === 0) return { loses: true, reason: 'empties_written_body' };

	const currentDirectives = directiveBlocks(current);
	if (currentDirectives.size > 0) {
		const proposedDirectives = directiveBlocks(proposed);
		for (const name of currentDirectives) {
			if (!proposedDirectives.has(name)) return { loses: true, reason: 'drops_directive_block' };
		}
	}

	if (proposed.length >= current.length) return { loses: false };
	const currentTokens = contentTokens(current);
	if (currentTokens.size === 0) return { loses: false };
	const proposedTokens = contentTokens(proposed);
	let kept = 0;
	for (const token of currentTokens) if (proposedTokens.has(token)) kept += 1;
	return kept / currentTokens.size < MIN_BODY_RETENTION
		? { loses: true, reason: 'drops_body_content' }
		: { loses: false };
}

export interface BareMentionInput {
	/** The proposed entity's name, as `entity_propose` gave it. */
	name: string;
	/** The proposed `summary`, which becomes a create's whole body or an update's `after`. */
	body: string;
	/** The text of the document this payload came from. `undefined` when `source_read`
	 * failed. */
	sourceText: string | undefined;
	/** Every name this document put on the table, this entity's own included. Subtracted
	 * before asking what the body contributes, because a name is not a fact. */
	documentNames: string[];
}

/**
 * Whether a payload is a bare mention written up as canon (issue #479's third defect):
 * the source names the entity and says nothing about it, and the model filled the gap.
 *
 * #479's Cairnmouth was never described anywhere in the vault. It appeared as a
 * `[[Cairnmouth]]` wikilink inside two other notes, and the model, asked to propose a
 * minimal entity for every link target, wrote `"A place mentioned in relation to the marsh
 * road."` - a sentence about the import rather than about the town. Guardrail 3 says every
 * proposal shows its evidence, which entry and which sentence, and there is none here.
 *
 * **Both halves have to hold, and the first one is why.** The obvious rule, "the body
 * shares no content word with the source", is too broad on its own: run against this
 * package's own fixtures it refuses fifteen proposals whose summaries are throwaway
 * phrasings like "X appears in this document" over a document that genuinely is about X.
 * A summary that abstracts rather than quotes is legitimate, so zero word overlap cannot be
 * the whole test. What separates Cairnmouth is that the document never talks about it at
 * all: every occurrence of the name is inside a `[[link]]`, so the note has told us only
 * that something is called that.
 *
 *  1. **Mentioned, and only as a link target.** The name occurs in the document, and with
 *     every `[[...]]` span removed it no longer does. A note's own subject fails this
 *     immediately, because its `# Heading` is prose. So does a name the document never
 *     writes at all: that is a different problem from a bare mention and this guard does
 *     not claim it.
 *  2. **And the body is ungrounded**: after subtracting `documentNames` ("marsh road" is
 *     another entry's title, not a fact about Cairnmouth), not one content token of the
 *     body appears in the source. On #479's document that is zero for Cairnmouth and two
 *     or more for each of the four proposals that were right.
 *
 * A source format with no link syntax never satisfies the first half, so this guard is
 * inert on a PDF or a DOCX rather than guessing there. That is deliberate: "a bare mention"
 * is a claim about how the source refers to something, and only a format with references
 * lets us check it. Absent source text is never a bare mention either, for
 * `readSourceTextsForContext`'s own reason: no context beats the wrong context.
 */
export function isBareMention(input: BareMentionInput): boolean {
	if (!input.sourceText) return false;
	const name = normalizeForMatching(input.name);
	if (name.length === 0) return false;
	if (!normalizeForMatching(input.sourceText).includes(name)) return false;
	const outsideLinks = normalizeForMatching(input.sourceText.replace(/\[\[[^\]]*\]\]/g, ' '));
	if (outsideLinks.includes(name)) return false;

	const bodyTokens = contentTokens(input.body);
	if (bodyTokens.size === 0) return true;
	const nameTokens = contentTokens(input.documentNames.join(' '));
	const sourceTokens = contentTokens(input.sourceText);
	for (const token of bodyTokens) {
		if (nameTokens.has(token)) continue;
		if (sourceTokens.has(token)) return false;
	}
	return true;
}

/**
 * `aliases` with any entry that is really another entity's name removed (issue #479's
 * third defect, second half).
 *
 * #479's Cairnmouth carried `aliases: ["The Marsh Road"]`, which is the name of a
 * different place in the same import. An alias is what *this* entity is also called, and
 * the accept path writes it onto the entity, so a foreign name there makes two entries
 * answer to one title and quietly corrupts every later match that reads aliases - the
 * matcher puts them in the embedded text and in `nameOverlapScore`, so the damage
 * compounds instead of staying local.
 *
 * `foreignNames` is the caller's set of names that belong to somebody else: every other
 * entity this document proposed, plus any existing entity in the universe carrying that
 * name. An alias equal to the entity's **own** name is dropped too, since it is not an
 * additional name for anything.
 */
export function pruneForeignAliases(
	ownName: string,
	aliases: string[],
	foreignNames: string[]
): string[] {
	const own = normalizeForMatching(ownName);
	const foreign = new Set(
		foreignNames.map((name) => normalizeForMatching(name)).filter((name) => name.length > 0)
	);
	const seen = new Set<string>();
	const kept: string[] = [];
	for (const alias of aliases) {
		const normalized = normalizeForMatching(alias);
		if (normalized.length === 0 || normalized === own) continue;
		if (foreign.has(normalized)) continue;
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		kept.push(alias);
	}
	return kept;
}

/**
 * Whether an `update` patch, after the guards above have had their say, still asks for
 * anything the entity does not already say (issue #479).
 *
 * Once a refused body write has taken `after` out, what is left is a name and some
 * aliases. If both already match the entity, the proposal is a row in a review queue that
 * costs a GM a decision and changes nothing - which is the same noise #479 is about, and
 * SPEC.md §6.4's "field edited by the user, unchanged at the source: leave it alone"
 * applied to a whole proposal rather than a field. What the document really contributed in
 * that case is its relations, and those are proposed separately.
 */
export function updatePatchAddsNothing(input: {
	currentName: string;
	currentAliases: string[];
	proposedName: string;
	proposedAliases: string[];
	writesBody: boolean;
}): boolean {
	if (input.writesBody) return false;
	if (normalizeForMatching(input.proposedName) !== normalizeForMatching(input.currentName)) {
		return false;
	}
	const current = new Set(input.currentAliases.map((alias) => normalizeForMatching(alias)));
	return input.proposedAliases.every((alias) => current.has(normalizeForMatching(alias)));
}
