/**
 * Issue #126, SPEC.md §17: "a document's language survives the import." One real zip
 * archive - built the same way `pdf-docx-archive.test.ts` builds its own, `zipSync`
 * over real files read off disk, never a checked-in binary - holding two real
 * documents in two different languages, the way an actual GM's world folder is never
 * monolingual. Run through the real `ArchiveSourceReader` (issue #25) and the real
 * `GatewayDriver` (issue #23) against a scripted model, this is the end-to-end proof
 * that:
 *
 *   1. each entity a document proposes carries that *document's* detected language
 *      (`EntityProposalPayload.language`), not a language chosen anywhere else - there
 *      is no interface locale in scope at all in this test, on purpose, so a passing
 *      assertion cannot be explained by one leaking into the other;
 *   2. a proper noun that appears inside an otherwise Italian document - "The Gilded
 *      Rat", SPEC.md §17's own example - reaches the proposal exactly as written, never
 *      translated, whether it is the entity's own `name` or just mentioned in another
 *      entity's `summary`.
 *
 * The two fixture documents (`test/fixtures/bilingual/*.md`) are hand-authored prose,
 * generated the same way every other plain-text fixture in this package was: written
 * directly as real Markdown, not templated or scripted, then verified against
 * `@canonry/lang`'s own `guessLanguage` (see the assertions at the top of the single
 * test below, which are that verification, committed rather than thrown away) so the
 * fixture is provably unambiguous input for the heuristic under test, not merely
 * assumed to be.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { guessLanguage } from '@canonry/lang';
import { ArchiveSourceReader } from '../archive.js';
import { loadBuiltinPlaybook } from '../playbook.js';
import { GatewayDriver } from '../gateway-driver.js';
import type { JobEvent } from '../driver.js';
import {
	IDENTITY_GATEWAY,
	buildJob,
	collect,
	findSpan,
	fixedModelSelector,
	scriptedModel,
	toolCallStep
} from './test-support.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../../test/fixtures/bilingual/', import.meta.url));
const EN_PATH = 'handout-en.md';
const IT_PATH = 'racconto-it.md';

/** One archive, two real documents in two different languages - the bilingual export
 * SPEC.md §17 and issue #126 both describe as the normal case, not the edge case. */
async function buildBilingualArchive(): Promise<ArchiveSourceReader> {
	const en = await readFile(`${FIXTURE_ROOT}${EN_PATH}`, 'utf8');
	const it = await readFile(`${FIXTURE_ROOT}${IT_PATH}`, 'utf8');
	const zipBytes = zipSync({
		[EN_PATH]: new TextEncoder().encode(en),
		[IT_PATH]: new TextEncoder().encode(it)
	});
	return ArchiveSourceReader.open(zipBytes);
}

function entityProposals(events: JobEvent[]) {
	return events.filter(
		(e): e is Extract<JobEvent, { type: 'proposal' }> & { proposal: { kind: 'entity' } } =>
			e.type === 'proposal' && e.proposal.kind === 'entity'
	);
}

describe('a bilingual archive export (issue #126, SPEC.md §17)', () => {
	it("stamps each document's own detected language onto the entities it proposes, and never touches a proper noun crossing the language boundary", async () => {
		const archive = await buildBilingualArchive();
		const enText = await archive.read(EN_PATH);
		const itText = await archive.read(IT_PATH);

		// The fixture is provably unambiguous input for the heuristic under test, not
		// merely assumed to be: the same guessLanguage this test's real assertions below
		// depend on, run here directly against the two documents' raw text.
		expect(guessLanguage(enText.content)).toMatchObject({ language: 'en' });
		expect(guessLanguage(itText.content)).toMatchObject({ language: 'it' });
		// "The Gilded Rat" inside the Italian document does not itself register as an
		// English signal - SPEC.md §17's own guardrail, proven at the detector level
		// before this test ever asks the import loop to preserve it.
		expect(guessLanguage(itText.content).hits.en).toBe(0);

		const playbook = await loadBuiltinPlaybook('generic');

		const gildedRatSpan = findSpan(
			enText.content,
			'The Gilded Rat is the busiest tavern in Port Verity'
		);
		const mirellaSpan = findSpan(enText.content, 'Innkeeper Mirella Fenn has run the place for');
		const aldricSpan = findSpan(
			itText.content,
			'Il capitano Aldric Voss non risponde a nessuno tranne il capitano del porto'
		);
		const guardianiSpan = findSpan(
			itText.content,
			'La sua guarnigione personale, i Guardiani del Molo, pattuglia i moli dal tramonto'
		);

		const model = scriptedModel([
			// --- doc-en: English sourcebook page ---
			toolCallStep([{ id: 'e1', name: 'source_read', input: { path: EN_PATH } }]),
			toolCallStep([
				{
					id: 'e2',
					name: 'entity_propose',
					input: {
						localId: 'place-1',
						type: 'place',
						name: 'The Gilded Rat',
						aliases: [],
						summary: 'The busiest tavern in Port Verity, run by Mirella Fenn for eleven years.',
						sourceRef: { documentId: 'doc-en' },
						evidenceSpan: gildedRatSpan,
						images: []
					}
				},
				{
					id: 'e3',
					name: 'entity_propose',
					input: {
						localId: 'char-1',
						type: 'character',
						name: 'Mirella Fenn',
						aliases: ['Widow Fenn'],
						summary: 'Innkeeper who has run The Gilded Rat for eleven years and forgets nothing.',
						sourceRef: { documentId: 'doc-en' },
						evidenceSpan: mirellaSpan,
						images: []
					}
				}
			]),
			toolCallStep([
				{
					id: 'e4',
					name: 'relation_propose',
					input: {
						fromLocalId: 'char-1',
						toLocalId: 'place-1',
						label: 'runs',
						inverseLabel: 'run by',
						cardinality: 'one_to_one',
						sourceRef: { documentId: 'doc-en' },
						evidenceSpan: mirellaSpan
					}
				}
			]),
			toolCallStep([{ id: 'e5', name: 'checkpoint', input: { note: 'both npcs done' } }]),
			toolCallStep([
				{ id: 'e6', name: 'job_finish', input: { outcome: 'completed', summary: '' } }
			]),
			// --- doc-it: Italian handout, mentioning the same untranslated inn name ---
			toolCallStep([{ id: 'i1', name: 'source_read', input: { path: IT_PATH } }]),
			toolCallStep([
				{
					id: 'i2',
					name: 'entity_propose',
					input: {
						localId: 'char-2',
						type: 'character',
						name: 'Capitano Aldric Voss',
						aliases: [],
						summary:
							'Non risponde a nessuno tranne il capitano del porto. Ogni sera lo si trova ' +
							'nella locanda conosciuta come The Gilded Rat, dove ascolta le voci dei marinai.',
						sourceRef: { documentId: 'doc-it' },
						evidenceSpan: aldricSpan,
						images: []
					}
				},
				{
					id: 'i3',
					name: 'entity_propose',
					input: {
						localId: 'faction-1',
						type: 'faction',
						name: 'Guardiani del Molo',
						aliases: ['i Guardiani'],
						summary:
							'Pattugliano i moli dal tramonto all\u2019alba e non fanno domande a chi paga bene.',
						sourceRef: { documentId: 'doc-it' },
						evidenceSpan: guardianiSpan,
						images: []
					}
				}
			]),
			toolCallStep([
				{
					id: 'i4',
					name: 'relation_propose',
					input: {
						fromLocalId: 'char-2',
						toLocalId: 'faction-1',
						label: 'comanda',
						inverseLabel: 'risponde a',
						cardinality: 'one_to_many',
						sourceRef: { documentId: 'doc-it' },
						evidenceSpan: guardianiSpan
					}
				}
			]),
			toolCallStep([{ id: 'i5', name: 'checkpoint', input: { note: 'captain and guard' } }]),
			toolCallStep([{ id: 'i6', name: 'job_finish', input: { outcome: 'completed', summary: '' } }])
		]);

		const driver = new GatewayDriver({
			gateway: IDENTITY_GATEWAY,
			models: fixedModelSelector(model)
		});
		const job = buildJob({
			id: 'job-bilingual',
			playbook,
			documents: [
				{ id: 'doc-en', sourcePath: EN_PATH },
				{ id: 'doc-it', sourcePath: IT_PATH }
			],
			sources: archive
		});
		const { events } = await collect(job, driver);

		const proposals = entityProposals(events);
		expect(proposals).toHaveLength(4);

		const byLocalId = new Map(
			proposals.map((e) => [e.proposal.payload.localId, e.proposal.payload])
		);
		const gildedRat = byLocalId.get('place-1');
		const mirella = byLocalId.get('char-1');
		const aldric = byLocalId.get('char-2');
		const guardiani = byLocalId.get('faction-1');
		if (!gildedRat || !mirella || !aldric || !guardiani) {
			throw new Error('expected all four localIds to have proposed');
		}

		// 1. Per-document detection, carried onto the entities: the English document's
		// two entities are 'en', the Italian document's two entities are 'it' - never the
		// other way around, and never null, because both documents are unambiguous.
		expect(gildedRat.language).toBe('en');
		expect(mirella.language).toBe('en');
		expect(aldric.language).toBe('it');
		expect(guardiani.language).toBe('it');

		// 2. Proper nouns cross the language boundary untouched. "The Gilded Rat" is both
		// an entity's own `name` (English document) and a substring of a different
		// entity's Italian `summary` (Italian document) - byte-identical in both places,
		// never rendered as "Il Ratto Dorato" or any other translation.
		expect(gildedRat.name).toBe('The Gilded Rat');
		expect(aldric.summary).toContain('The Gilded Rat');
		expect(aldric.summary).not.toContain('Ratto Dorato');
		// The rest of that same summary is genuinely Italian prose, not a language this
		// system invented around the preserved name.
		expect(guessLanguage(aldric.summary).language).toBe('it');

		// Every other proper noun (a person's name, an alias, a faction name) reaches the
		// proposal exactly as scripted - nothing in the pipeline between the tool call and
		// the JobEvent stream rewrites, cases, or otherwise touches these strings.
		expect(mirella.name).toBe('Mirella Fenn');
		expect(mirella.aliases).toEqual(['Widow Fenn']);
		expect(aldric.name).toBe('Capitano Aldric Voss');
		expect(guardiani.name).toBe('Guardiani del Molo');
		expect(guardiani.aliases).toEqual(['i Guardiani']);

		const finishedEvents = events.filter(
			(e): e is Extract<JobEvent, { type: 'progress' }> =>
				e.type === 'progress' && e.status === 'finished'
		);
		expect(finishedEvents.map((e) => e.documentId).sort()).toEqual(['doc-en', 'doc-it']);
	});
});
