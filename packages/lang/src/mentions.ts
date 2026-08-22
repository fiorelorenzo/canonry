/**
 * `[[Name]]` mention syntax (#105): the display-time counterpart to this package's fence
 * definition (`secret-blocks.ts`). Strips a `[[Name]]` mention down to its bare name for a
 * context that quotes stored body text as prose rather than rendering it as markdown - a
 * source chip, a Facts panel excerpt, an Ask answer composed by reading canon directly
 * rather than a model - which is meant to read like the sentence it quotes, brackets never
 * being markdown syntax the GM wrote to be read aloud. The stored span itself is untouched;
 * this only shapes what a caller shows next to it.
 *
 * Lived in `apps/web/src/lib/markdown.ts` until #545: `packages/copilot`'s Ask needed the
 * identical strip for its AI-off answer (`runAsk`'s reading-only branch reads canon
 * directly, with no model and therefore no component standing between the stored sentence
 * and the reader), and that package cannot import from `apps/web` any more than
 * `@canonry/db` could import `stripSecretsForPlayers` from there before #306 moved it into
 * this package for the same reason. `apps/web/src/lib/markdown.ts` re-exports this rather
 * than moving its many existing callers.
 */
export function stripMentionSyntax(text: string): string {
	return text.replace(/\[\[([^\]\n]+)\]\]/g, '$1');
}
