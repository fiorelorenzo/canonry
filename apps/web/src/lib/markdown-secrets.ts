/**
 * Decision E6 = A (docs/ux/DECISIONS.md): secrets and GM notes are inline fenced blocks,
 * typed in place in the same document the GM already writes in - `:::secret` / `:::gmnote`
 * opening a block, a bare `:::` closing it, both block-level (each marker owns its own
 * line). SPEC.md §10: "hidden content inside public entries, GM notes always private."
 *
 * This module owns exactly one thing guardrail 6 depends on: `stripSecretsForPlayers`, the
 * single filter that decides what a player ever sees of an entry's body. The artifact's own
 * "rejected outright" section is explicit about why there can only be one implementation of
 * that filter - a second one (say, CSS that hides the same spans) can drift from the real
 * players' route and pass its own check while the real endpoint still leaks - so both #83's
 * public entity page and the GM's own "player preview" toggle call this same function.
 *
 * Deliberately its own module rather than an edit to `$lib/markdown.ts` (owned by #105/#106,
 * decision B2): this only ever calls that module's exported renderers, never rewrites them.
 *
 * Fails closed on a malformed document: an unclosed `:::secret`/`:::gmnote` fence swallows
 * everything to the end of the body rather than falling back to visible prose. A stray typo
 * that leaves a fence open is exactly the failure mode the E6 artifact warns about ("a
 * bug in the filter can leak a span the GM never meant to publish"), so the default has to
 * be hide-too-much, never leak-anything.
 *
 * Deferred, not built here: a secret unlocking on its own revelation, independent of the
 * rest of its entry. E6's "what this locks in" names that as #84's eventual shape but the
 * artifact's own sentence describing the schema for it is unfinished, and `revelation_kind`
 * (packages/db/src/schema/enums.ts) has no fourth variant to hang it on. Until that schema
 * exists, every secret and every GM note is stripped unconditionally for players - the safe
 * reading of "hidden content", never a leak, and no reveal action anywhere claims otherwise.
 */

export type SecretBlockKind = 'secret' | 'gmnote';

export interface BodySegment {
	kind: 'body';
	text: string;
	/** Character offsets into the original source this segment's `text` was cut from
	 * (`end` exclusive), so a caller with a fact's `[spanStart, spanEnd)` can find which
	 * segment it falls in and re-render that one segment with a local highlight. */
	start: number;
	end: number;
}

export interface SecretSegment {
	kind: SecretBlockKind;
	text: string;
	start: number;
	end: number;
}

export type SourceSegment = BodySegment | SecretSegment;

const OPEN_FENCE = /^:::(secret|gmnote)\s*$/;
const CLOSE_FENCE = /^:::\s*$/;

/**
 * Parses raw markdown source into an ordered list of body / secret / gmnote segments.
 * Block-level only: a fence marker has to own its whole line, matching how markdown-it's
 * own fenced code blocks and containers work, so a colon typed mid-sentence is never
 * mistaken for a fence.
 */
export function splitSecretBlocks(source: string): SourceSegment[] {
	const lines = source.split('\n');
	const lineStarts = [0];
	for (let i = 0; i < source.length; i++) {
		if (source[i] === '\n') lineStarts.push(i + 1);
	}
	// Exclusive end of `lines[lineIndex]` (just before its trailing '\n', or the end of
	// the source for the last line, which has none).
	const lineEnd = (lineIndex: number): number =>
		lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1]! - 1 : source.length;

	const segments: SourceSegment[] = [];
	let bodyLines: string[] = [];
	let bodyStartLine = 0;
	let i = 0;

	const flushBody = () => {
		if (bodyLines.length > 0) {
			segments.push({
				kind: 'body',
				text: bodyLines.join('\n'),
				start: lineStarts[bodyStartLine]!,
				end: lineEnd(bodyStartLine + bodyLines.length - 1)
			});
			bodyLines = [];
		}
	};

	while (i < lines.length) {
		const line = lines[i] ?? '';
		const open = OPEN_FENCE.exec(line.trim());
		if (!open) {
			if (bodyLines.length === 0) bodyStartLine = i;
			bodyLines.push(line);
			i += 1;
			continue;
		}

		flushBody();
		const kind = open[1] as SecretBlockKind;
		const contentStartLine = i + 1;
		i += 1;
		const blockLines: string[] = [];
		while (i < lines.length && !CLOSE_FENCE.test((lines[i] ?? '').trim())) {
			blockLines.push(lines[i] ?? '');
			i += 1;
		}
		// Either lines[i] is the closing fence (skip it below) or i is past the end of the
		// document - an unclosed block. Both leave blockLines holding everything the block
		// swallowed, which is exactly what a fail-closed default needs: unclosed still hides.
		const start = lineStarts[contentStartLine] ?? source.length;
		segments.push({
			kind,
			text: blockLines.join('\n'),
			start,
			end: blockLines.length > 0 ? lineEnd(contentStartLine + blockLines.length - 1) : start
		});
		i += 1;
	}
	flushBody();
	return segments;
}

/**
 * Guardrail 6's one filter: every secret and every GM note removed, wholesale, always.
 * The only function in this module #83's route and the GM preview toggle are both allowed
 * to call for "what does a player see" - see the module doc for why there cannot be two.
 */
export function stripSecretsForPlayers(source: string): string {
	return splitSecretBlocks(source)
		.filter((segment): segment is BodySegment => segment.kind === 'body')
		.map((segment) => segment.text)
		.join('\n\n')
		.trim();
}
