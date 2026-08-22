/**
 * Issue #354, guardrail 5: on an answer that cites nothing, nothing the GM reads beside it
 * may claim that it cites something or that a model wrote it from their canon.
 *
 * The defect the issue found was a per-answer disclosure card that said, in English,
 * "Keeping this stores the question, the answer and the entries it cites, as your own note.
 * OpenAI wrote the answer from your own canon." (`universe.ask.keep.noteBefore` and
 * `keep.noteProvider`, and their Italian twins "le voci che cita" / "ha scritto la risposta
 * dal tuo canone"). After #346 an answer can honestly cite nothing, and on such an answer
 * both halves were untrue in the same direction, which is the direction a disclosure must
 * never be wrong in.
 *
 * That card is gone: #464 (T10, `docs/ux/DECISIONS.md`) deleted those four keys along with
 * the manual keep control and moved guardrail 5's disclosure to one standing line "where it
 * can be read before anything is asked, rather than after every answer". What actually
 * speaks per answer now is one of two sentences, `universe.ask.sourcesNote` when there are
 * sources and `universe.ask.sourcesEmpty` when there are none. So the copy is right today
 * and this file is what keeps it right, because nothing else tested either half.
 *
 * Two kinds of proof, because either one alone lets the defect back in.
 *
 * The first is on the catalogues: no standing disclosure line on either Ask surface may
 * carry the wording that made the old card wrong, in either locale. That is the half that
 * fails the day somebody writes a citation claim into a line that is read before the
 * question is even asked, which is exactly the shape of the old bug.
 *
 * The second is structural, and it reads the markup on purpose - the same technique
 * `routes/page-header-offset.test.ts` and `routes/auth/credential-forms.test.ts` use, for
 * the same reason: which of the two sentences a surface paints is decided by which branch
 * of a Svelte `{#if}` it sits in, and `pnpm --filter web test` is vitest with a node
 * environment only (`vite.config.ts` declares one project, `server`), so there is no
 * rendered component to assert against. It checks, on both surfaces, that the sentence
 * claiming sources lives only in the sources-present branch and the sentence denying them
 * only in the other one. That is the half that fails on the plausible bug: a citation claim
 * hoisted out of its branch, where it would then be painted over an answer that cited
 * nothing.
 *
 * The dock's own no-sources branch is `{:else if turn.sourcesSeen}` rather than a bare
 * `{:else}`, which is deliberate and not asserted here: mid-stream, before the `sources`
 * event has arrived, the turn does not yet know whether it cited anything, and "nothing to
 * cite" must not be claimed before that is known. `runAsk` calls `onSources` unconditionally
 * (`packages/copilot/src/ask.ts`), empty list included, so a settled turn always has it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it as test } from 'vitest';
import { en } from '$lib/i18n/en.js';
import { it as itMessages } from '$lib/i18n/it.js';
import type { Messages } from '$lib/i18n/messages.js';

/** The two surfaces that paint a turn: the dock's panel and the notebook's row. */
const SURFACES = {
	'QuickAsk.svelte': '../components/copilot/QuickAsk.svelte',
	'AskAnswerRow.svelte': '../components/ask/AskAnswerRow.svelte'
} as const;

/**
 * Splits the `{#if <something>sources.length > 0}` block of a Svelte template into the
 * branch taken when there are sources and the branch taken when there are none, walking
 * block depth rather than matching the next `{:else}` textually: the sources-present branch
 * contains an `{#each}` with its own `{#if}`/`{:else}` inside it, and a textual match would
 * find that one.
 */
function sourceBranches(markup: string): { present: string; absent: string } {
	const tags = [...markup.matchAll(/\{(#if|#each|#key|#snippet|#await|:else[^}]*|\/[a-z]+)\}?/g)];
	const openIndex = tags.findIndex(
		(tag) => tag[1] === '#if' && /^\{#if [^}]*sources\.length > 0\}/.test(markup.slice(tag.index))
	);
	expect(openIndex, 'a branch on whether the turn has any sources').toBeGreaterThanOrEqual(0);

	let depth = 1;
	let elseAt = -1;
	let closeAt = -1;
	for (const tag of tags.slice(openIndex + 1)) {
		const kind = tag[1];
		if (kind.startsWith('#')) depth += 1;
		else if (kind.startsWith('/')) {
			depth -= 1;
			if (depth === 0) {
				closeAt = tag.index;
				break;
			}
		} else if (depth === 1 && elseAt === -1) elseAt = tag.index;
	}
	expect(elseAt, 'an else branch for the no-sources case').toBeGreaterThan(0);
	expect(closeAt, 'a close for the sources branch').toBeGreaterThan(elseAt);

	return {
		present: markup.slice(tags[openIndex].index, elseAt),
		absent: markup.slice(elseAt, closeAt)
	};
}

/** The wording of the card #464 deleted, in both locales, plus the two claims it made. A
 * standing line is read before the question is asked, so it can never honestly carry any of
 * these: at that point nobody knows whether the next answer will cite anything. */
const CITATION_CLAIMS = [
	/the entries it cites/i,
	/cited entries/i,
	/wrote the answer/i,
	/from your own canon/i,
	/le voci che cita/i,
	/voci citate/i,
	/ha scritto la risposta/i,
	/dal tuo canone/i
];

describe('the disclosure beside an answer that cited nothing', () => {
	for (const [locale, catalogue] of [
		['en', en],
		['it', itMessages]
	] as const) {
		const standing: Record<string, string> = {
			'shell.quickAsk.disclosure': catalogue.shell.quickAsk.disclosure,
			'universe.ask.disclosure': catalogue.universe.ask.disclosure,
			'universe.ask.kept.note': catalogue.universe.ask.kept.note,
			'universe.ask.keep.noteLinkBefore': catalogue.universe.ask.keep.noteLinkBefore
		};

		for (const [key, line] of Object.entries(standing)) {
			test(`${locale}: ${key} claims neither a citation nor canon authorship`, () => {
				for (const claim of CITATION_CLAIMS) expect(line).not.toMatch(claim);
			});
		}

		test(`${locale}: the no-sources sentence is its own phrasing, not the sourced one`, () => {
			const ask: Messages['universe']['ask'] = catalogue.universe.ask;
			expect(ask.sourcesEmpty).not.toBe(ask.sourcesNote);
			// The sourced sentence's own claim ("written from these", "scritta da queste"),
			// which is the one thing the no-sources sentence must never borrow.
			expect(ask.sourcesEmpty).not.toMatch(/written from these|scritta da queste/i);
		});
	}

	for (const [name, path] of Object.entries(SURFACES)) {
		test(`${name} claims sources only where it has them`, () => {
			const { present, absent } = sourceBranches(
				readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf-8')
			);

			expect(present).toContain('sourcesNote');
			expect(present).not.toContain('sourcesEmpty');

			expect(absent).toContain('sourcesEmpty');
			expect(absent).not.toContain('sourcesNote');
		});
	}
});
