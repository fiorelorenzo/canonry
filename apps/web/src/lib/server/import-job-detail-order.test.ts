/**
 * Issue #638: the review screen's own read applies the ordering, against a real Postgres.
 *
 * `vocab-order.test.ts` pins the ordering itself; this pins that `importJobDetailFor` is
 * where it runs, because that is the read behind `/w/[universe]/import/[job]/review` and
 * behind the inbox's import groups. A correct pure function nobody calls would satisfy
 * every other test in this change and leave the queue exactly as it was.
 *
 * Fails on 9a8a4f8, which orders by `created_at` alone: there the question emitted first
 * comes first whatever it unblocks.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { importJob, proposal, proposalPlan, universe, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importJobDetailFor } from './proposals.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe("importJobDetailFor orders an import's vocabulary questions (issue #638)", () => {
	let db: Db;
	let ownerId: string;
	let universeId: string;
	let jobId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('w638-owner');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerKey, name: 'W638 Owner', email: `${ownerKey}@example.test` })
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		ownerId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'W638 Universe',
				slug: unique('w638-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id });
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;

		const [job] = await db
			.insert(importJob)
			.values({
				universeId,
				createdBy: ownerId,
				sourceType: 'onenote',
				playbook: 'onenote',
				playbookVersion: 1,
				artefactPath: '/dev/null',
				artefactSha256: unique('sha'),
				documentCount: 2,
				proposalsEmitted: 4,
				status: 'finished'
			})
			.returning({ id: importJob.id });
		if (!job) throw new Error('import job insert did not return a row');
		jobId = job.id;

		// Emission order on purpose: the one-relation question first, the six-relation one
		// last, with an entity proposal between them. That is the shape the notebook has, at
		// 133 questions instead of three.
		const emitted: Array<{ kind: 'create' | 'relation_type_new'; rank: number; label: string }> = [
			{ kind: 'relation_type_new', rank: 1, label: 'giura a' },
			{ kind: 'create', rank: 0, label: 'Cairnmouth' },
			{ kind: 'relation_type_new', rank: 2, label: 'protegge' },
			{ kind: 'relation_type_new', rank: 6, label: 'situata in' }
		];
		// `created_at` is written rather than slept for: this ordering reads it, so the test
		// has to control it, and a real delay between inserts would be both slower and less
		// exact about what it is asserting.
		const emittedAt = new Date('2026-08-24T09:00:00.000Z').getTime();
		for (const [index, item] of emitted.entries()) {
			const [plan] = await db
				.insert(proposalPlan)
				.values({
					universeId,
					trigger: 'import',
					importJobId: jobId,
					summary: `Import: ${item.label}.`,
					status: 'ready',
					estimatedCredits: 0,
					candidateCap: 1
				})
				.returning({ id: proposalPlan.id });
			if (!plan) throw new Error('plan insert did not return a row');
			await db.insert(proposal).values({
				universeId,
				planId: plan.id,
				trigger: 'import',
				kind: item.kind,
				patch:
					item.kind === 'create'
						? {
								type: 'place',
								name: item.label,
								slug: unique('cairnmouth'),
								aliases: [],
								body: 'A port.'
							}
						: {
								kind: 'relation_type_new',
								dedupKey: item.label,
								label: item.label,
								inverseLabel: `inverse of ${item.label}`,
								cardinality: 'many_to_many',
								allowedFrom: ['character'],
								allowedTo: ['place'],
								relations: Array.from({ length: item.rank }, () => ({
									fromEntityId: null,
									toEntityId: null,
									rationale: 'the page says so',
									evidence: { documentId: 'doc-1' }
								}))
							},
				rationale: item.label,
				evidence: {},
				rank: item.rank,
				outcome: 'pending',
				createdAt: new Date(emittedAt + index * 1000)
			});
		}
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	it('returns the questions heaviest first, with the entity proposal where it was', async () => {
		const detail = await importJobDetailFor(db, universeId, jobId);
		if (!detail) throw new Error('no detail for the job');

		expect(detail.candidates.map((c) => c.proposal.rationale)).toEqual([
			'situata in',
			'Cairnmouth',
			'protegge',
			'giura a'
		]);
		// And the card reads the same number the ordering used, off the patch it renders.
		expect(detail.candidates[0]?.relationVocab?.relations).toHaveLength(6);
	});
});
