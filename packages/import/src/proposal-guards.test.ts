/**
 * Issue #479's guards, at the level where they are pure functions. The end-to-end proof
 * that they change the real reproduction's proposal set is `job-runner-guards.test.ts`;
 * this file pins each rule's edges, including the ones the reproduction does not exercise
 * (an empty body, a longer replacement, a legitimate alias) because those are where a
 * guard that over-refuses would do its damage.
 *
 * Every fixture string here is #479's own data, read out of `canonry_r17_demo`'s job
 * `955b60ba-4c53-4987-ba27-c5aea892c0ac`, rather than something invented to make a rule
 * look good.
 */
import { describe, expect, it } from 'vitest';
import {
	bodyWriteVerdict,
	isBareMention,
	pruneForeignAliases,
	updatePatchAddsNothing
} from './proposal-guards.js';
import { EMBEDDING_MATCH_THRESHOLDS, findIdentityCollision, resolveMatch } from './matching.js';
import type { IdentityCandidate } from './matching.js';

/** The seeded Valdoria Reach entry #479's two update proposals targeted: a written line
 * plus a secret and a GM note. */
const ASHEN_LEDGER_BODY = `A merchant bank that lends at knife point and keeps better records than the magistrate.

:::secret
Aldric Vane, the dismissed captain of the Valdoria Watch, is now on its payroll.
:::

:::gmnote
Iselde Wrenn appointed Aldric, then broke him. Play this reveal as her fault circling back, not his.
:::`;

/** #479's two `after` values, in the order they were ranked. */
const ASHEN_LEDGER_AFTERS = [
	'A faction to which The Toll Company pays a tithe. Harrow Blackfen sells his tallies to them.',
	'An organization to which Harrow Blackfen sells tally records.'
];

const HARROW_NOTE = `---
tags: [character, npc]
aliases: [The Fen Warden]
---

# Harrow Blackfen

Warden of the marsh road east of [[Cairnmouth]]. He took the post the winter after the thaw and has not been relieved since.

He keeps a tally of everyone who crosses, and sells it to [[The Ashen Ledger]] when the tally is worth more than the toll.
`;

describe('bodyWriteVerdict (issue #479, defect two)', () => {
	it('refuses both of the Ashen Ledger proposals that would have replaced a written entry with one sentence', () => {
		for (const after of ASHEN_LEDGER_AFTERS) {
			expect(bodyWriteVerdict(ASHEN_LEDGER_BODY, after)).toEqual({
				loses: true,
				reason: 'drops_directive_block'
			});
		}
	});

	it('refuses a shrinking replacement even with no directive block to point at', () => {
		// #479's Cairnmouth patch against the seeded Cairnmouth's body, which carries no
		// `:::` fence: the shrink-plus-retention rule has to stand on its own, or the guard
		// only works on entries that happen to hold a secret.
		const seeded =
			'A fishing town two days up the coast. A third of it starved in [[The Sable Winter]] when [[The Sable Reach]] froze, and the harbour has never carried the same traffic since.';
		expect(bodyWriteVerdict(seeded, 'A place mentioned in relation to the marsh road.')).toEqual({
			loses: true,
			reason: 'drops_body_content'
		});
	});

	it('refuses emptying a written body', () => {
		expect(bodyWriteVerdict(ASHEN_LEDGER_BODY, '   ')).toEqual({
			loses: true,
			reason: 'empties_written_body'
		});
	});

	it('allows a first body, which is the case that makes an import worth running', () => {
		expect(bodyWriteVerdict('', 'A chartered company that collects on The Marsh Road.')).toEqual({
			loses: false
		});
		expect(bodyWriteVerdict('   \n  ', 'Anything at all.')).toEqual({ loses: false });
	});

	it('allows a longer replacement whatever it retains, so SPEC.md §6.4 conflicts still reach the GM', () => {
		// §6.4: "field edited by the user after the last import, and changed at the source
		// too: conflict, raise a proposal with both versions side by side". A source that now
		// says more must not be filtered out by a guard aimed at deletions.
		const current = 'A fishing town.';
		const richer =
			'A cold harbour of shale quays and tar sheds, provisioning the northern fleet through a season nobody else will sail.';
		expect(bodyWriteVerdict(current, richer)).toEqual({ loses: false });
	});

	it('allows a reword that keeps the body, and keeps refusing one that keeps the prose but drops the secret', () => {
		const prose =
			'A merchant bank that lends at knife point and keeps better records than the magistrate.';
		expect(bodyWriteVerdict(prose, 'A merchant bank that lends at knife point.').loses).toBe(false);
		expect(bodyWriteVerdict(ASHEN_LEDGER_BODY, prose)).toEqual({
			loses: true,
			reason: 'drops_directive_block'
		});
	});
});

describe('isBareMention (issue #479, defect three)', () => {
	const documentNames = [
		'Harrow Blackfen',
		'The Fen Warden',
		'Cairnmouth',
		'The Marsh Road',
		'The Ashen Ledger'
	];

	it('refuses the Cairnmouth stub: named only inside a link, and grounded in nothing', () => {
		expect(
			isBareMention({
				name: 'Cairnmouth',
				body: 'A place mentioned in relation to the marsh road.',
				sourceText: HARROW_NOTE,
				documentNames
			})
		).toBe(true);
	});

	it('lets through every one of the four proposals #479 says were right', () => {
		const grounded: { name: string; body: string; sourceText: string }[] = [
			{
				name: 'Harrow Blackfen',
				body: 'Warden of the marsh road east of Cairnmouth. He took the post the winter after the thaw and has not been relieved since. He keeps a tally of everyone who crosses, and sells it to The Ashen Ledger.',
				sourceText: HARROW_NOTE
			},
			{
				name: 'The Marsh Road',
				body: 'The only land route between Cairnmouth and the inland farms. Impassable for six weeks after the first freeze.',
				sourceText:
					'---\ntags: [place]\n---\n\n# The Marsh Road\n\nThe only land route between [[Cairnmouth]] and the inland farms. Three days in summer, impassable for six weeks after the first freeze.\n\n[[Harrow Blackfen]] wardens it.\n'
			},
			{
				name: 'The Toll Company',
				body: 'A chartered company that collects on The Marsh Road. It answers to nobody in Valdoria and pays a tithe to The Ashen Ledger.',
				sourceText:
					'---\ntags: [faction]\n---\n\n# The Toll Company\n\nA chartered company that collects on [[The Marsh Road]]. It answers to nobody in Valdoria and pays a tithe to [[The Ashen Ledger]].\n'
			},
			{
				name: 'Session 4',
				body: 'The fourth session of the campaign. The party travels the marsh road and encounters Harrow Blackfen.',
				sourceText:
					'---\ntags: [session]\ndate: 2026-03-11\n---\n\n# Session 4\n\nThe party walked the marsh road and met [[Harrow Blackfen]], who wanted a name before he wanted a toll.\n\nThey learned that [[The Toll Company]] has been selling crossings twice.\n'
			}
		];
		for (const payload of grounded) {
			expect(isBareMention({ ...payload, documentNames })).toBe(false);
		}
	});

	it('keeps a throwaway summary when the document really is about the entity', () => {
		// The rule that only reads word overlap refuses this, and it must not: fifteen of
		// this package's own job-runner fixtures are shaped exactly like it, and each one is
		// a document whose subject is the entity being proposed.
		expect(
			isBareMention({
				name: 'Aldric Voss',
				body: 'Aldric Voss appears in this document.',
				sourceText: 'Aldric Voss commands the harbour watch.',
				documentNames: ['Aldric Voss']
			})
		).toBe(false);
	});

	it('keeps a link-target proposal whose summary is grounded in the note it was read from', () => {
		// The Ashen Ledger is a link target in Harrow Blackfen.md with no note of its own, so
		// it passes the first half; the second half saves it, because "sells" and "tally" are
		// the note's own words. That is the escape hatch a legitimate visiting proposal has.
		expect(
			isBareMention({
				name: 'The Ashen Ledger',
				body: 'An organization to which Harrow Blackfen sells tally records.',
				sourceText: HARROW_NOTE,
				documentNames
			})
		).toBe(false);
	});

	it('is inert on a format with no link syntax, rather than guessing', () => {
		expect(
			isBareMention({
				name: 'Cairnmouth',
				body: 'A place mentioned in relation to the marsh road.',
				sourceText: 'A page of prose that names Cairnmouth and nothing else about it.',
				documentNames
			})
		).toBe(false);
	});

	it('never refuses when the source could not be read, because no context beats the wrong context', () => {
		expect(
			isBareMention({
				name: 'Cairnmouth',
				body: 'A place mentioned in relation to the marsh road.',
				sourceText: undefined,
				documentNames
			})
		).toBe(false);
	});

	it('refuses a body that is nothing but the names already on the table', () => {
		expect(
			isBareMention({
				name: 'Cairnmouth',
				body: 'Cairnmouth, The Marsh Road.',
				sourceText: HARROW_NOTE,
				documentNames
			})
		).toBe(true);
	});
});

describe('pruneForeignAliases (issue #479, defect three)', () => {
	it("drops an alias that is another entry's title", () => {
		expect(pruneForeignAliases('Cairnmouth', ['The Marsh Road'], ['The Marsh Road'])).toEqual([]);
	});

	it('keeps a real alias, which is what the frontmatter of the same vault actually declares', () => {
		expect(
			pruneForeignAliases('Harrow Blackfen', ['The Fen Warden'], ['Cairnmouth', 'The Ashen Ledger'])
		).toEqual(['The Fen Warden']);
	});

	it("drops an alias that only repeats the entity's own name, and de-duplicates", () => {
		expect(
			pruneForeignAliases('Cairnmouth', ['cairnmouth', 'Old Cairn', 'OLD  CAIRN'], [])
		).toEqual(['Old Cairn']);
	});
});

describe('updatePatchAddsNothing (issue #479, defect two)', () => {
	it('drops an update that, once its body write is refused, repeats what the entity already says', () => {
		expect(
			updatePatchAddsNothing({
				currentName: 'The Ashen Ledger',
				currentAliases: [],
				proposedName: 'The Ashen Ledger',
				proposedAliases: [],
				writesBody: false
			})
		).toBe(true);
	});

	it('keeps an update that still writes a body', () => {
		expect(
			updatePatchAddsNothing({
				currentName: 'The Ashen Ledger',
				currentAliases: [],
				proposedName: 'The Ashen Ledger',
				proposedAliases: [],
				writesBody: true
			})
		).toBe(false);
	});

	it('keeps an update that brings a new alias or a renamed entry', () => {
		expect(
			updatePatchAddsNothing({
				currentName: 'The Ashen Ledger',
				currentAliases: [],
				proposedName: 'The Ashen Ledger',
				proposedAliases: ['The Ledger'],
				writesBody: false
			})
		).toBe(false);
		expect(
			updatePatchAddsNothing({
				currentName: 'Cairnmouth',
				currentAliases: [],
				proposedName: 'Cairn Mouth',
				proposedAliases: [],
				writesBody: false
			})
		).toBe(false);
	});
});

describe('findIdentityCollision and resolveMatch (issue #479, defect one)', () => {
	const seededCairnmouth: IdentityCandidate = {
		id: 'entity-cairnmouth',
		name: 'Cairnmouth',
		slug: 'cairnmouth',
		type: 'place'
	};

	it('finds the collision by slug', () => {
		expect(
			findIdentityCollision({ name: 'Cairnmouth', slug: 'cairnmouth' }, [seededCairnmouth])
		).toEqual({ candidate: seededCairnmouth, via: 'slug' });
	});

	it('finds it by name when the stored slug was hand-edited away from it', () => {
		const renamedSlug: IdentityCandidate = { ...seededCairnmouth, slug: 'cairnmouth-town' };
		expect(
			findIdentityCollision({ name: 'CAIRNMOUTH', slug: 'cairnmouth' }, [renamedSlug])
		).toEqual({
			candidate: renamedSlug,
			via: 'name'
		});
	});

	it('finds it across entity types, which is the case both candidate pools are blind to', () => {
		const asFaction: IdentityCandidate = { ...seededCairnmouth, type: 'faction' };
		expect(
			findIdentityCollision({ name: 'Cairnmouth', slug: 'cairnmouth' }, [asFaction])?.via
		).toBe('slug');
	});

	it('finds nothing for a genuinely new name, so a create is still reachable', () => {
		expect(
			findIdentityCollision({ name: 'The Marsh Road', slug: 'the-marsh-road' }, [seededCairnmouth])
		).toBeNull();
	});

	it('resolves #479 to an identity match at the cosine the recorded job actually scored', async () => {
		// 0.5446 is the measured cosine between the two sides' `matchTextFor` texts on
		// `alibaba/qwen3-embedding-4b`, the `embedding` row job
		// 955b60ba-4c53-4987-ba27-c5aea892c0ac ran with. It is under
		// EMBEDDING_MATCH_THRESHOLDS.newBelow (0.60), which is why the scorer answered `new`
		// and the import proposed a duplicate: the identity step has to decide this before
		// the scorer is consulted at all.
		expect(0.5446).toBeLessThan(EMBEDDING_MATCH_THRESHOLDS.newBelow);
		const decision = await resolveMatch({
			subject: { name: 'Cairnmouth', aliases: ['The Marsh Road'] },
			exactSourceRefMatch: null,
			identity: {
				subject: { name: 'Cairnmouth', slug: 'cairnmouth' },
				candidates: [seededCairnmouth]
			},
			candidates: [{ id: seededCairnmouth.id, name: 'Cairnmouth', aliases: [] }],
			similarity: () => 0.5446,
			thresholds: EMBEDDING_MATCH_THRESHOLDS
		});
		expect(decision).toEqual({
			outcome: 'identity',
			candidateId: 'entity-cairnmouth',
			via: 'slug'
		});
	});

	it('never consults the scorer once an identity collision is found', async () => {
		let calls = 0;
		const decision = await resolveMatch({
			subject: { name: 'Cairnmouth', aliases: [] },
			exactSourceRefMatch: null,
			identity: {
				subject: { name: 'Cairnmouth', slug: 'cairnmouth' },
				candidates: [seededCairnmouth]
			},
			candidates: [{ id: seededCairnmouth.id, name: 'Cairnmouth', aliases: [] }],
			similarity: () => {
				calls += 1;
				return 1;
			},
			thresholds: EMBEDDING_MATCH_THRESHOLDS
		});
		expect(decision.outcome).toBe('identity');
		expect(calls).toBe(0);
	});

	it('leaves an external-id match alone, since SPEC.md §6.4 calls that step one', async () => {
		const decision = await resolveMatch({
			subject: { name: 'Cairnmouth', aliases: [] },
			exactSourceRefMatch: { id: 'by-source-ref', name: 'Cairnmouth', aliases: [] },
			identity: {
				subject: { name: 'Cairnmouth', slug: 'cairnmouth' },
				candidates: [seededCairnmouth]
			},
			candidates: [],
			similarity: () => 0,
			thresholds: EMBEDDING_MATCH_THRESHOLDS
		});
		expect(decision).toEqual({ outcome: 'exact', candidateId: 'by-source-ref' });
	});

	it('is inert for a caller with no identity pool, so the matching benchmark is unchanged', async () => {
		const decision = await resolveMatch({
			subject: { name: 'Cairnmouth', aliases: ['The Marsh Road'] },
			exactSourceRefMatch: null,
			candidates: [{ id: seededCairnmouth.id, name: 'Cairnmouth', aliases: [] }],
			similarity: () => 0.5446,
			thresholds: EMBEDDING_MATCH_THRESHOLDS
		});
		expect(decision).toEqual({ outcome: 'new' });
	});
});
