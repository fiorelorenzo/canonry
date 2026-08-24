/**
 * Issue #699, the assertion the issue names: a kept truncated turn still says so after a
 * reload. This is the one that fails without the migration and the wiring, and it fails in
 * the least visible way, by rendering a paragraph that stops mid-sentence with nothing
 * beside it.
 *
 * It goes through the actual exported `POST` from `keep/+server.ts` (same technique as
 * `../../../admin/models/params-merge.test.ts` and `../p/leak.test.ts`) and then reads the
 * conversation back the way the route does, `getKeptConversation` into
 * `toAskConversationView`, because "after a reload" is exactly that round trip and nothing
 * shorter would have caught the shape of this bug: every individual piece can be right
 * while the fact never crosses from the stream to the record.
 *
 * The other half is the guardrail, and it is why the endpoint resolves rather than accepts:
 * a body that claims a turn finished, or claims one was truncated, must change nothing.
 * Runs against the real Postgres, same convention as the files above.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, getKeptConversation, type Db } from '@canonry/db';
import { universe, universeMember, user } from '@canonry/db/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toAskConversationView } from '$lib/ask/history';
import { _clearTurnLosses, recordTurnLoss } from '$lib/server/ask/turn-loss';
import { POST } from './keep/+server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
// `$lib/server/db.ts`'s `db()` singleton, which the handler under test calls, reads
// `env.DATABASE_URL` with no fallback of its own.
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('a kept answer records that its turn was truncated (issue #699)', () => {
	let db: Db;
	let owner: { id: string };
	let slug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 2 });
		const [row] = await db
			.insert(user)
			.values({
				id: unique('keep-trunc-user'),
				name: 'Keep Truncation Owner',
				email: `${unique('kt')}@canonry.invalid`,
				emailVerified: true
			})
			.returning({ id: user.id });
		if (!row) throw new Error('fixture user insert returned no row');
		owner = row;
		slug = unique('keep-trunc-universe');
		const [u] = await db
			.insert(universe)
			.values({ ownerUserId: owner.id, name: 'Keep Truncation', slug, kind: 'homebrew' })
			.returning({ id: universe.id });
		if (!u) throw new Error('fixture universe insert returned no row');
		await db
			.insert(universeMember)
			.values({ universeId: u.id, userId: owner.id, role: 'owner' })
			.onConflictDoNothing();
	});

	beforeEach(() => {
		_clearTurnLosses();
	});

	afterAll(async () => {
		await db.delete(universe).where(eq(universe.slug, slug));
		await db.delete(user).where(eq(user.id, owner.id));
		await closeDb(db);
	});

	function keepEvent(body: Record<string, unknown>) {
		return {
			request: new Request(`http://localhost/w/${slug}/ask/keep`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}),
			params: { universe: slug },
			locals: { user: owner, locale: 'en' }
		} as unknown as Parameters<typeof POST>[0];
	}

	function keepBody(overrides: Record<string, unknown> = {}) {
		return {
			question: 'Tell me everything about the harbour district.',
			answer: 'The Lantern Quarter keeps the ledgers, and the second thing you asked about is',
			detailLevel: 'full',
			askedFromPath: `/w/${slug}`,
			sources: [],
			conversationId: randomUUID(),
			...overrides
		};
	}

	async function conversationView(conversationId: string) {
		const [u] = await db.select({ id: universe.id }).from(universe).where(eq(universe.slug, slug));
		if (!u) throw new Error('fixture universe vanished');
		const conversation = await getKeptConversation(db, {
			conversationId,
			universeId: u.id,
			keptBy: owner.id
		});
		if (!conversation) throw new Error('kept conversation not found');
		return toAskConversationView(conversation);
	}

	it('carries the truncation and the lost proposal into the record, so reopening the conversation still says the answer stops short', async () => {
		const turnId = recordTurnLoss(owner.id, { truncated: true, lostProposals: 1 });
		const conversationId = randomUUID();

		const response = await POST(keepEvent(keepBody({ conversationId, turnId })));
		expect(response.status).toBe(201);

		// The reload. Before this issue the row had nowhere to put either fact, so the view
		// came back with the truncated paragraph and no caveat at all.
		const view = await conversationView(conversationId);
		expect(view.turns).toHaveLength(1);
		expect(view.turns[0]!.loss).toEqual({ truncated: true, lostProposals: 1 });
	});

	it('says nothing for a turn that finished, and nothing for a keep that could not know', async () => {
		// A finished turn: `runAsk` reported `null`, which the ledger records as a claim
		// (false/0) rather than as an absence - and the view collapses it back to null,
		// because there is no line to paint for "nothing was lost" (guardrail 7's
		// over-claiming half).
		const finished = randomUUID();
		await POST(
			keepEvent(keepBody({ conversationId: finished, turnId: recordTurnLoss(owner.id, null) }))
		);
		expect((await conversationView(finished)).turns[0]!.loss).toBeNull();

		// And a keep with no handle at all - a restart between the answer and the keep, an
		// expired entry, a caller that never had one. The record says "we do not know", which
		// reaches the surface as the same silence rather than as a false all-clear.
		const unknown = randomUUID();
		await POST(keepEvent(keepBody({ conversationId: unknown })));
		expect((await conversationView(unknown)).turns[0]!.loss).toBeNull();
	});

	it('ignores a truncation the body claims, because the body is not where that fact comes from', async () => {
		// The laundering case, in both directions. A client that could set these two fields
		// could hide a cut-off answer, and a client that could set them could also stamp a
		// caveat onto an answer that was whole. Neither reaches the row: the schema does not
		// name them, and the endpoint reads the ledger.
		const forged = randomUUID();
		await POST(
			keepEvent(
				keepBody({
					conversationId: forged,
					truncated: true,
					lostProposals: 7,
					loss: { truncated: true, lostProposals: 7 }
				})
			)
		);
		expect((await conversationView(forged)).turns[0]!.loss).toBeNull();

		// And the reverse: a real truncation the body tries to talk down still lands.
		const denied = randomUUID();
		await POST(
			keepEvent(
				keepBody({
					conversationId: denied,
					turnId: recordTurnLoss(owner.id, { truncated: true, lostProposals: 0 }),
					truncated: false,
					loss: null
				})
			)
		);
		expect((await conversationView(denied)).turns[0]!.loss).toEqual({
			truncated: true,
			lostProposals: 0
		});
	});
});
