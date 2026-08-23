/**
 * Issue #628, run against the real actions and a real Postgres. #191's admission check
 * is right that it has to run at accept time - the endpoints of a `relation` proposal
 * are only ever real entities once the GM has accepted them, so accept time is the
 * first moment the real pair is knowable, and propose time (packages/copilot,
 * packages/import) can only ever guess. What #628 fixes is what happened when that
 * check refused: `accept` used to answer with nothing a GM could act on. This is the
 * regression guard on the two actions that replace that dead end - `accept` returning
 * the refusal as data instead of a bare failure, and `widenAndAccept` turning the GM's
 * consent into the widen plus the write, in one call.
 *
 * The fixture is a universe-scoped relation type whose `allowed_to` does not include
 * the real "to" entity's type, and a pending `relation` proposal between two real
 * entities naming it - the shape `resolveRelationEndpoints`/#191's own check reads,
 * built directly rather than through a real import run, same as
 * `review/[proposal]/awaiting-diff.test.ts` builds its own proposal rows by hand.
 */
import { randomUUID } from 'node:crypto';
import { and, closeDb, createDb, eq, type Db } from '@canonry/db';
import {
	entity,
	importJob,
	proposal,
	proposalPlan,
	relation,
	relationType,
	universe,
	user
} from '@canonry/db/schema';
import { isActionFailure } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actions } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same reason `awaiting-diff.test.ts` does this: the route's own `$lib/server/db.ts`
// singleton reads `$env/dynamic/private` with no fallback, and it has to be set before
// the first action call rather than inside one.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

interface NotAdmittedFailureData {
	error: string;
	notAdmitted: {
		proposalId: string;
		relationTypeId: string;
		typeLabel: string;
		fromType: string;
		toType: string;
		addFrom: string | null;
		addTo: string | null;
		shipped: boolean;
	};
}

/** Same reason `admin/models/aspect-ratio-guard.test.ts`'s own `failureError` reads
 * this way: `actions.accept`'s inferred return type is a union of its success shape
 * and every `fail()` call's own `ActionFailure`, and `isActionFailure` always narrows
 * `.data` to `ActionFailure<undefined>` regardless of what was actually passed to
 * `fail()`, so it is useful as a boolean check but not for reading the payload back.
 * The failure's status and data are read by checking for them at runtime instead. */
function actionFailure(result: unknown): { status: number; data: NotAdmittedFailureData } {
	if (
		result &&
		typeof result === 'object' &&
		'status' in result &&
		typeof result.status === 'number' &&
		'data' in result &&
		result.data &&
		typeof result.data === 'object'
	) {
		return { status: result.status, data: result.data as NotAdmittedFailureData };
	}
	throw new Error('expected an ActionFailure');
}

describe('/w/[universe]/import/[job]/review actions (#628): the accept-time admission refusal has a route forward', () => {
	let db: Db;
	let ownerId: string;
	let universeId: string;
	let universeSlug: string;
	let jobId: string;
	let fromEntityId: string;
	let toEntityId: string;
	let notAdmittedTypeId: string;
	let notAdmittedTypeLabel: string;
	let notAdmittedProposalId: string;
	let widenTypeId: string;
	let widenProposalId: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('w628-owner');
		const [owner] = await db
			.insert(user)
			.values({ id: ownerKey, name: 'W628 Owner', email: `${ownerKey}@example.test` })
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		ownerId = owner.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'W628 Universe',
				slug: unique('w628-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id, slug: universe.slug });
		if (!uni) throw new Error('universe insert did not return a row');
		universeId = uni.id;
		universeSlug = uni.slug;

		const [fromEntity] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: 'Mirenna',
				slug: unique('mirenna'),
				body: 'Mirenna leads the caravan.'
			})
			.returning({ id: entity.id });
		if (!fromEntity) throw new Error('entity insert did not return a row');
		fromEntityId = fromEntity.id;

		const [toEntity] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'item',
				name: 'The Ashen Ledger',
				slug: unique('ashen-ledger'),
				body: 'A ledger of debts.'
			})
			.returning({ id: entity.id });
		if (!toEntity) throw new Error('entity insert did not return a row');
		toEntityId = toEntity.id;

		const [job] = await db
			.insert(importJob)
			.values({
				universeId,
				createdBy: ownerId,
				sourceType: 'kanka',
				playbook: 'kanka',
				playbookVersion: 1,
				artefactPath: '/dev/null',
				artefactSha256: 'deadbeef',
				documentCount: 1,
				proposalsEmitted: 2,
				status: 'finished'
			})
			.returning({ id: importJob.id });
		if (!job) throw new Error('import job insert did not return a row');
		jobId = job.id;

		const [plan] = await db
			.insert(proposalPlan)
			.values({
				universeId,
				trigger: 'import',
				importJobId: jobId,
				summary: 'Imported 1 document.',
				status: 'ready',
				estimatedCredits: 0,
				candidateCap: 25
			})
			.returning({ id: proposalPlan.id });
		if (!plan) throw new Error('plan insert did not return a row');
		const planId = plan.id;

		// A universe-scoped relation type whose allowed_to does not include the real "to"
		// entity's type ('item'): the #628 fixture. Neither packages/copilot nor
		// packages/import ever sees this mismatch at propose time, because both size a
		// relation type off the endpoint types the model itself proposed - only #191's
		// own check, at accept time against the real entities, catches it.
		const [notAdmittedType] = await db
			.insert(relationType)
			.values({
				universeId,
				label: unique('capo di'),
				inverseLabel: unique('sotto il comando di'),
				cardinality: 'many_to_many',
				allowedFrom: ['character'],
				allowedTo: ['place']
			})
			.returning({ id: relationType.id, label: relationType.label });
		if (!notAdmittedType) throw new Error('relation type insert did not return a row');
		notAdmittedTypeId = notAdmittedType.id;
		notAdmittedTypeLabel = notAdmittedType.label;

		const [notAdmittedProposal] = await db
			.insert(proposal)
			.values({
				universeId,
				planId,
				trigger: 'import',
				kind: 'relation',
				targetEntityId: fromEntityId,
				relationTypeId: notAdmittedTypeId,
				relatedEntityId: toEntityId,
				patch: {},
				rationale: 'Mirenna carries the ledger.',
				evidence: {},
				rank: 0,
				outcome: 'pending'
			})
			.returning({ id: proposal.id });
		if (!notAdmittedProposal) throw new Error('proposal insert did not return a row');
		notAdmittedProposalId = notAdmittedProposal.id;

		// A second, independent type/proposal pair for widenAndAccept, so accepting
		// through one test never changes what the other observes.
		const [widenType] = await db
			.insert(relationType)
			.values({
				universeId,
				label: unique('porta di'),
				inverseLabel: unique('portato da'),
				cardinality: 'many_to_many',
				allowedFrom: ['character'],
				allowedTo: ['place']
			})
			.returning({ id: relationType.id });
		if (!widenType) throw new Error('relation type insert did not return a row');
		widenTypeId = widenType.id;

		const [widenProposal] = await db
			.insert(proposal)
			.values({
				universeId,
				planId,
				trigger: 'import',
				kind: 'relation',
				targetEntityId: fromEntityId,
				relationTypeId: widenTypeId,
				relatedEntityId: toEntityId,
				patch: {},
				rationale: 'Mirenna carries the ledger.',
				evidence: {},
				rank: 1,
				outcome: 'pending'
			})
			.returning({ id: proposal.id });
		if (!widenProposal) throw new Error('proposal insert did not return a row');
		widenProposalId = widenProposal.id;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	function postEvent(fields: Record<string, string>) {
		const formData = new FormData();
		for (const [key, value] of Object.entries(fields)) formData.set(key, value);
		return {
			request: new Request(`http://localhost/w/${universeSlug}/import/${jobId}/review`, {
				method: 'POST',
				body: formData
			}),
			params: { universe: universeSlug, job: jobId },
			locals: { user: { id: ownerId }, locale: 'en' }
		};
	}

	it('refuses an accept the real endpoint pair is not admitted for, 409 with the widen it would take', async () => {
		const result = await actions.accept(
			postEvent({ proposalId: notAdmittedProposalId }) as Parameters<typeof actions.accept>[0]
		);

		expect(isActionFailure(result)).toBe(true);
		const failure = actionFailure(result);
		expect(failure.status).toBe(409);
		expect(failure.data).toMatchObject({
			notAdmitted: {
				proposalId: notAdmittedProposalId,
				relationTypeId: notAdmittedTypeId,
				typeLabel: notAdmittedTypeLabel,
				fromType: 'character',
				toType: 'item',
				addFrom: null,
				addTo: 'item',
				shipped: false
			}
		});
		expect(typeof failure.data.error).toBe('string');
		expect(failure.data.error).toContain(notAdmittedTypeLabel);

		// The refused accept's own transaction rolled back: the proposal is exactly as
		// undecided as it was before the click.
		const [row] = await db
			.select({ outcome: proposal.outcome })
			.from(proposal)
			.where(eq(proposal.id, notAdmittedProposalId));
		expect(row?.outcome).toBe('pending');
	});

	it("widenAndAccept widens the type's allowed_to and then writes the relation, in one call", async () => {
		// Only the proposal id is posted. Which widening this takes is the server's own
		// business, read back off the admission check, so there is nothing here to name it.
		const result = await actions.widenAndAccept(
			postEvent({ proposalId: widenProposalId }) as Parameters<typeof actions.widenAndAccept>[0]
		);

		expect(isActionFailure(result)).toBe(false);
		expect(result).toEqual({ id: widenProposalId });

		const [widened] = await db
			.select({ allowedFrom: relationType.allowedFrom, allowedTo: relationType.allowedTo })
			.from(relationType)
			.where(eq(relationType.id, widenTypeId));
		expect(widened?.allowedTo).toContain('item');
		// Grew by exactly the end the refusal named, and not by the other one.
		expect(widened?.allowedFrom).toEqual(['character']);

		const [decided] = await db
			.select({ outcome: proposal.outcome })
			.from(proposal)
			.where(eq(proposal.id, widenProposalId));
		expect(decided?.outcome).toBe('accepted');

		const written = await db
			.select()
			.from(relation)
			.where(
				and(
					eq(relation.relationTypeId, widenTypeId),
					eq(relation.fromEntityId, fromEntityId),
					eq(relation.toEntityId, toEntityId)
				)
			);
		expect(written).toHaveLength(1);
	});

	it('ignores a widening the request names, because the GM only ever consented to the one shown', async () => {
		// Guardrail 1 read strictly: the consent is to a specific widening, so the specific
		// widening cannot be the caller's to name. A hand-built post asking for `session` on
		// both ends must not get it, even though the click that legitimately follows this
		// refusal does widen the type.
		const result = await actions.widenAndAccept(
			postEvent({
				proposalId: notAdmittedProposalId,
				relationTypeId: notAdmittedTypeId,
				addFrom: 'session',
				addTo: 'session'
			}) as Parameters<typeof actions.widenAndAccept>[0]
		);

		expect(isActionFailure(result)).toBe(false);
		const [widened] = await db
			.select({ allowedFrom: relationType.allowedFrom, allowedTo: relationType.allowedTo })
			.from(relationType)
			.where(eq(relationType.id, notAdmittedTypeId));
		expect(widened?.allowedFrom).not.toContain('session');
		expect(widened?.allowedTo).not.toContain('session');
		// What it did grow by is what the check asked for: the real `to` type.
		expect(widened?.allowedTo).toContain('item');
	});
});
