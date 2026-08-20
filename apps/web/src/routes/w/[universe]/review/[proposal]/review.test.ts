/**
 * Issue #345, run against the real handlers and a real Postgres. The point of this file is
 * not that accept works (it did before, on the plan screen, and `@canonry/db`'s own tests
 * cover the write). It is that moving the decision onto the entry a proposal targets did
 * not quietly widen what one decision can touch.
 *
 * `an accept decides exactly one proposal, on exactly one entry` is the invariant a future
 * refactor is most likely to break, because it is the one nothing in the type system holds
 * up: two entries each carry a pending proposal, one is accepted, and the other entry's
 * body and its proposal's outcome both have to be untouched afterwards. The array-shaped
 * body case is the same invariant from the other side: an extra `proposalIds` field is not
 * a hidden bulk API, because the id the endpoint acts on is the one in the URL and there is
 * nowhere else to put a second one.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, proposal, revision, universe, universeMember, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { reviewableProposalsForEntity } from '$lib/server/proposals';
import { GET, POST } from './+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// Same convention as publish-gate.test.ts and lib/server/players.test.ts: the handler calls
// `$lib/server/db.ts`'s `db()` singleton, which reads `env.DATABASE_URL` with no fallback.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const BEFORE_BODY = 'Factor of the Ashen Ledger. He holds most of the quarter debt.';
const AFTER_BODY = `${BEFORE_BODY} He employs forty people in the counting house.`;

/** Only the fields this file asserts on, parsed rather than cast: the response is JSON off
 * the wire, and `ProposalDiffCard`'s own type is the description of the rest of it. */
const candidateSchema = z.object({
	candidate: z.object({ diff: z.array(z.object({ statement: z.string() })) })
});

async function statusOf(promise: Response | Promise<Response>): Promise<number> {
	try {
		await promise;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
	throw new Error('expected the request to throw an HTTP error, but it returned a response');
}

describe('/w/[universe]/review/[proposal] (#345)', () => {
	let db: Db;
	let universeSlug: string;
	let universeId: string;
	let ownerId: string;
	let locals: App.Locals;

	/** Every entry in the product is created through a revision, and C6's undo restores the
	 * one before the accept, so a fixture entry without any history cannot be undone to (the
	 * endpoint answers 409 for exactly that, which is right and is not what these cases are
	 * about). The fixture therefore writes the first revision the way a human save would. */
	async function makeEntry(): Promise<{ id: string; slug: string }> {
		const [row] = await db
			.insert(entity)
			.values({
				universeId,
				type: 'character',
				name: unique('Review Subject'),
				slug: unique('review-subject'),
				body: BEFORE_BODY
			})
			.returning();
		if (!row) throw new Error('entity insert returned no row');
		await db.insert(revision).values({
			universeId,
			entityId: row.id,
			authorKind: 'human',
			authorUserId: ownerId,
			name: row.name,
			aliases: row.aliases,
			body: row.body
		});
		return { id: row.id, slug: row.slug };
	}

	async function makeProposal(
		entityId: string,
		overrides: { universeId?: string; patch?: unknown } = {}
	): Promise<string> {
		const [row] = await db
			.insert(proposal)
			.values({
				universeId: overrides.universeId ?? universeId,
				trigger: 'complete',
				kind: 'update',
				targetEntityId: entityId,
				patch: overrides.patch ?? { summary: 'adds the payroll line', after: AFTER_BODY },
				rationale: 'The counting house entry already names the forty.',
				evidence: [],
				provider: 'test',
				modelId: 'test-model',
				credits: 0
			})
			.returning();
		if (!row) throw new Error('proposal insert returned no row');
		return row.id;
	}

	function event(proposalId: string, body?: unknown) {
		return {
			params: { universe: universeSlug, proposal: proposalId },
			locals,
			request: new Request('http://localhost/review', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body ?? { action: 'accept' })
			})
		} as Parameters<typeof POST>[0];
	}

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });
		const email = `${unique('review')}@canonry.invalid`;
		const [owner] = await db
			.insert(user)
			.values({ id: unique('review-user'), name: 'Review Owner', email })
			.returning();
		if (!owner) throw new Error('user insert returned no row');
		ownerId = owner.id;

		const [world] = await db
			.insert(universe)
			.values({
				name: 'Review World',
				slug: unique('review-world'),
				ownerUserId: owner.id,
				kind: 'homebrew'
			})
			.returning();
		if (!world) throw new Error('universe insert returned no row');
		universeId = world.id;
		universeSlug = world.slug;
		await db.insert(universeMember).values({ universeId, userId: ownerId, role: 'owner' });

		locals = { user: { id: ownerId, name: 'Review Owner', email }, locale: 'en' } as App.Locals;
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
		await db.delete(user).where(eq(user.id, ownerId));
		await closeDb(db);
	});

	it('accepts exactly one proposal, on exactly one entry, and leaves the other alone', async () => {
		const first = await makeEntry();
		const second = await makeEntry();
		const acceptedId = await makeProposal(first.id);
		const untouchedId = await makeProposal(second.id);

		const response = await POST(event(acceptedId));
		expect(response.status).toBe(200);

		const [firstRow] = await db.select().from(entity).where(eq(entity.id, first.id));
		const [secondRow] = await db.select().from(entity).where(eq(entity.id, second.id));
		expect(firstRow?.body).toBe(AFTER_BODY);
		expect(secondRow?.body).toBe(BEFORE_BODY);

		const [acceptedRow] = await db.select().from(proposal).where(eq(proposal.id, acceptedId));
		const [untouchedRow] = await db.select().from(proposal).where(eq(proposal.id, untouchedId));
		expect(acceptedRow?.outcome).toBe('accepted');
		expect(acceptedRow?.decidedBy).toBe(ownerId);
		expect(untouchedRow?.outcome).toBe('pending');
	});

	it('ignores a second id smuggled into the body: the URL names the only proposal it decides', async () => {
		const first = await makeEntry();
		const second = await makeEntry();
		const targetId = await makeProposal(first.id);
		const smuggledId = await makeProposal(second.id);

		const response = await POST(
			event(targetId, { action: 'accept', proposalIds: [targetId, smuggledId], all: true })
		);
		expect(response.status).toBe(200);

		const [smuggledRow] = await db.select().from(proposal).where(eq(proposal.id, smuggledId));
		const [secondRow] = await db.select().from(entity).where(eq(entity.id, second.id));
		expect(smuggledRow?.outcome).toBe('pending');
		expect(secondRow?.body).toBe(BEFORE_BODY);
	});

	it('rejects, records a reason for the rejection, and never touches the entry', async () => {
		const target = await makeEntry();
		const proposalId = await makeProposal(target.id);

		expect((await POST(event(proposalId, { action: 'reject' }))).status).toBe(200);
		expect(
			(await POST(event(proposalId, { action: 'reason', reason: 'not canon yet' }))).status
		).toBe(200);

		const [row] = await db.select().from(proposal).where(eq(proposal.id, proposalId));
		const [entityRow] = await db.select().from(entity).where(eq(entity.id, target.id));
		expect(row?.outcome).toBe('rejected');
		expect(row?.rejectReason).toBe('not canon yet');
		expect(entityRow?.body).toBe(BEFORE_BODY);
	});

	it('undoes an accept, putting the entry back and the proposal on the pile', async () => {
		const target = await makeEntry();
		const proposalId = await makeProposal(target.id);

		await POST(event(proposalId));
		expect((await POST(event(proposalId, { action: 'undo' }))).status).toBe(200);

		const [row] = await db.select().from(proposal).where(eq(proposal.id, proposalId));
		const [entityRow] = await db.select().from(entity).where(eq(entity.id, target.id));
		expect(row?.outcome).toBe('pending');
		expect(entityRow?.body).toBe(BEFORE_BODY);
	});

	it('serves the same enriched candidate the queue renders, diff included', async () => {
		const target = await makeEntry();
		const proposalId = await makeProposal(target.id);

		const response = await GET({
			params: { universe: universeSlug, proposal: proposalId },
			locals
		} as Parameters<typeof GET>[0]);
		const body: unknown = await response.json();
		expect(body).toMatchObject({
			candidate: {
				id: proposalId,
				kind: 'update',
				outcome: 'pending',
				rationale: 'The counting house entry already names the forty.'
			}
		});
		// Guardrail 3 and guardrail 1 together: what the GM accepts inline is the diff, so a
		// candidate served with an empty one would be an accept button over nothing.
		const served = candidateSchema.parse(body);
		expect(served.candidate.diff.length).toBeGreaterThan(0);
	});

	it('answers 404 for a proposal in another universe, whoever asks', async () => {
		const [otherWorld] = await db
			.insert(universe)
			.values({
				name: 'Other World',
				slug: unique('other-world'),
				ownerUserId: ownerId,
				kind: 'homebrew'
			})
			.returning();
		if (!otherWorld) throw new Error('universe insert returned no row');
		const [outsider] = await db
			.insert(entity)
			.values({
				universeId: otherWorld.id,
				type: 'character',
				name: unique('Outsider'),
				slug: unique('outsider'),
				body: BEFORE_BODY
			})
			.returning();
		if (!outsider) throw new Error('entity insert returned no row');
		const foreignId = await makeProposal(outsider.id, { universeId: otherWorld.id });

		expect(await statusOf(POST(event(foreignId)))).toBe(404);
		const [row] = await db.select().from(proposal).where(eq(proposal.id, foreignId));
		expect(row?.outcome).toBe('pending');

		await db.delete(universe).where(eq(universe.id, otherWorld.id));
	});

	it('answers 400 for a decision it does not know', async () => {
		const target = await makeEntry();
		const proposalId = await makeProposal(target.id);

		expect(await statusOf(POST(event(proposalId, { action: 'accept-all' })))).toBe(400);
		const [row] = await db.select().from(proposal).where(eq(proposal.id, proposalId));
		expect(row?.outcome).toBe('pending');
	});

	it('refuses a viewer, who may read the entry but not decide its proposals', async () => {
		const target = await makeEntry();
		const proposalId = await makeProposal(target.id);
		const [viewer] = await db
			.insert(user)
			.values({
				id: unique('review-viewer'),
				name: 'Review Viewer',
				email: `${unique('viewer')}@canonry.invalid`
			})
			.returning();
		if (!viewer) throw new Error('user insert returned no row');
		await db.insert(universeMember).values({ universeId, userId: viewer.id, role: 'viewer' });

		const viewerEvent = {
			params: { universe: universeSlug, proposal: proposalId },
			locals: {
				user: { id: viewer.id, name: viewer.name, email: viewer.email },
				locale: 'en'
			} as App.Locals,
			request: new Request('http://localhost/review', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'accept' })
			})
		} as Parameters<typeof POST>[0];

		expect(await statusOf(POST(viewerEvent))).toBe(403);
		const [row] = await db.select().from(proposal).where(eq(proposal.id, proposalId));
		expect(row?.outcome).toBe('pending');
		await db.delete(user).where(eq(user.id, viewer.id));
	});

	// The other half of the same guardrail, one layer down: what the entry page is even
	// allowed to put in front of a GM. A propagation candidate exists before its diff does,
	// and an Accept button over an empty diff is an accept of something nobody could read.
	it('keeps an undrafted candidate out of the region and counts it against the plan instead', async () => {
		const target = await makeEntry();
		const drafted = await makeProposal(target.id);
		const undrafted = await makeProposal(target.id, { patch: {} });

		const review = await reviewableProposalsForEntity(db, universeId, target.id);
		expect(review.reviewable.map((candidate) => candidate.id)).toEqual([drafted]);
		expect(review.awaitingDiff.count).toBe(1);
		expect(undrafted).not.toBe(drafted);
	});
});
