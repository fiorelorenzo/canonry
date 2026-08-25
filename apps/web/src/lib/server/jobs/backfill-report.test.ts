/**
 * #768: the definitions behind `/admin/indexing`, and the read that feeds them.
 *
 * Two halves, and the split is deliberate. The definitions of "a dead letter", "a retry" and
 * "a recovery" are the whole content of this page, and every one of them has a plausible wrong
 * version that would still render a table full of numbers: counting a dead letter where it was
 * *requested* rather than where it ended, counting any `done` row as a recovery rather than
 * only a retry that finished, calling a universe given-up because it has a `failed` row
 * somewhere in its history rather than because its newest row is one. So the first half drives
 * those against fixture arrays, one assertion per wrong version, with no database in the way.
 *
 * The second half is the read, against the real table, and it exists to prove one thing the
 * first half cannot: that `indexBackfillAttempts` returns every row of a universe with its
 * name attached and drops none. It writes rows with the mechanism's own exported `reason`
 * constants and statuses rather than driving a real backfill, which needs Qdrant and a model:
 * what a pass writes is already covered by `canon-save.test.ts`, and what is new here is the
 * join and the shape.
 *
 * **Every database assertion is scoped to the universes this file created**, because the read
 * is deliberately unscoped (an operator wants every universe) and `canon-save.test.ts` writes
 * to the same table in the same run. Per this repo's own rule, the scoped assertions say which
 * rows they found and how many of each, not just a total.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, inArray, type Db } from '@canonry/db';
import { universe, universeIndexBackfill, user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	EMBEDDING_MODEL_CHANGED_REASON,
	NO_EMBEDDING_MODEL_REASON,
	RETRY_AFTER_DEAD_LETTER_REASON
} from './backfill-store.js';
import {
	indexBackfillAttempts,
	summariseIndexBackfillActivity,
	summariseIndexBackfillNow,
	summariseIndexBackfillsByUniverse,
	type IndexBackfillAttempt
} from './backfill-report.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const NOW = new Date('2026-08-25T12:00:00.000Z');

function daysAgo(days: number): Date {
	return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

let sequence = 0;

function attempt(over: Partial<IndexBackfillAttempt> = {}): IndexBackfillAttempt {
	sequence += 1;
	return {
		id: `attempt-${sequence}`,
		universeId: 'universe-a',
		universeName: 'Valdoria Reach',
		universeSlug: 'valdoria-reach',
		reason: NO_EMBEDDING_MODEL_REASON,
		status: 'done',
		requestedAt: daysAgo(1),
		startedAt: daysAgo(1),
		finishedAt: daysAgo(1),
		attemptCount: 1,
		entitiesTotal: 17,
		entitiesMissing: 0,
		entitiesScheduled: 17,
		lastError: null,
		...over
	};
}

describe('what counts as a dead letter, and when (#768)', () => {
	it('counts a dead letter in the window it ended in, not the one it was requested in', () => {
		const long = attempt({
			status: 'failed',
			requestedAt: daysAgo(40),
			finishedAt: daysAgo(2),
			entitiesMissing: 3
		});

		const [week, month] = summariseIndexBackfillActivity([long], NOW, [7, 30]);

		expect(week?.deadLetters).toBe(1);
		expect(month?.deadLetters).toBe(1);
	});

	it('leaves a dead letter out of a window that closed before it ended', () => {
		const old = attempt({ status: 'failed', requestedAt: daysAgo(60), finishedAt: daysAgo(40) });

		const [week, month, ever] = summariseIndexBackfillActivity([old], NOW, [7, 30, null]);

		expect(week?.deadLetters).toBe(0);
		expect(month?.deadLetters).toBe(0);
		expect(ever?.deadLetters).toBe(1);
	});

	it('counts one universe that gave up four times as four dead letters on one universe', () => {
		const rows = [3, 5, 6, 7].map((day) =>
			attempt({ status: 'failed', requestedAt: daysAgo(day), finishedAt: daysAgo(day) })
		);

		const [week] = summariseIndexBackfillActivity(rows, NOW, [7]);

		expect(week?.deadLetters).toBe(4);
		expect(week?.universesDeadLettered).toBe(1);
	});

	it('counts two universes that gave up once each as two universes', () => {
		const rows = [
			attempt({ universeId: 'a', status: 'failed', finishedAt: daysAgo(1) }),
			attempt({ universeId: 'b', status: 'failed', finishedAt: daysAgo(1) })
		];

		const [week] = summariseIndexBackfillActivity(rows, NOW, [7]);

		expect(week?.deadLetters).toBe(2);
		expect(week?.universesDeadLettered).toBe(2);
	});

	it('does not count a catch-up that has not finished as anything that happened', () => {
		const running = attempt({ status: 'claimed', finishedAt: null, entitiesMissing: null });

		const [ever] = summariseIndexBackfillActivity([running], NOW, [null]);

		expect(ever).toEqual({
			windowDays: null,
			deadLetters: 0,
			universesDeadLettered: 0,
			retriesEnqueued: 0,
			recoveries: 0
		});
	});
});

describe('what counts as a recovery, and what does not (#768)', () => {
	it('needs the retry reason as well as done: an ordinary catch-up is not a recovery', () => {
		const ordinary = attempt({ reason: NO_EMBEDDING_MODEL_REASON, status: 'done' });
		const afterSwap = attempt({ reason: EMBEDDING_MODEL_CHANGED_REASON, status: 'done' });
		const real = attempt({ reason: RETRY_AFTER_DEAD_LETTER_REASON, status: 'done' });

		const [ever] = summariseIndexBackfillActivity([ordinary, afterSwap, real], NOW, [null]);

		expect(ever?.recoveries).toBe(1);
	});

	it('does not call a retry that gave up again a recovery, and counts it as a dead letter', () => {
		const again = attempt({
			reason: RETRY_AFTER_DEAD_LETTER_REASON,
			status: 'failed',
			entitiesMissing: 3
		});

		const [ever] = summariseIndexBackfillActivity([again], NOW, [null]);

		expect(ever?.recoveries).toBe(0);
		expect(ever?.deadLetters).toBe(1);
	});

	it('counts a retry where it was offered and its recovery where it ended', () => {
		const slow = attempt({
			reason: RETRY_AFTER_DEAD_LETTER_REASON,
			status: 'done',
			requestedAt: daysAgo(20),
			finishedAt: daysAgo(2)
		});

		const [week, month] = summariseIndexBackfillActivity([slow], NOW, [7, 30]);

		expect(week).toMatchObject({ retriesEnqueued: 0, recoveries: 1 });
		expect(month).toMatchObject({ retriesEnqueued: 1, recoveries: 1 });
	});

	it('counts a retry still in flight as offered and not yet recovered', () => {
		const pending = attempt({
			reason: RETRY_AFTER_DEAD_LETTER_REASON,
			status: 'pending',
			requestedAt: daysAgo(1),
			finishedAt: null,
			entitiesMissing: null,
			entitiesTotal: null,
			entitiesScheduled: 0
		});

		const [week] = summariseIndexBackfillActivity([pending], NOW, [7]);

		expect(week).toMatchObject({ retriesEnqueued: 1, recoveries: 0, deadLetters: 0 });
	});
});

describe('where the mechanism stands right now (#768)', () => {
	it('reads a universe as given up from its newest row, not from its history', () => {
		const gaveUp = attempt({
			universeId: 'a',
			status: 'failed',
			requestedAt: daysAgo(4),
			finishedAt: daysAgo(3),
			entitiesMissing: 3
		});
		const retrying = attempt({
			universeId: 'a',
			reason: RETRY_AFTER_DEAD_LETTER_REASON,
			status: 'pending',
			requestedAt: daysAgo(1),
			finishedAt: null,
			entitiesMissing: null,
			entitiesTotal: null,
			entitiesScheduled: 0
		});

		const now = summariseIndexBackfillNow([retrying, gaveUp]);

		expect(now.universesGivenUp).toBe(0);
		expect(now.entriesMissingNow).toBe(0);
		expect(now.inFlight).toBe(1);
		expect(now.universesEverBackfilled).toBe(1);
	});

	it('sums the shortfall of the universes that are given up now and of no others', () => {
		const givenUp = attempt({
			universeId: 'a',
			status: 'failed',
			finishedAt: daysAgo(1),
			entitiesMissing: 3
		});
		const settledAfterGivingUp = [
			attempt({
				universeId: 'b',
				status: 'failed',
				requestedAt: daysAgo(9),
				finishedAt: daysAgo(8),
				entitiesMissing: 40
			}),
			attempt({
				universeId: 'b',
				reason: RETRY_AFTER_DEAD_LETTER_REASON,
				status: 'done',
				requestedAt: daysAgo(2),
				finishedAt: daysAgo(2),
				entitiesMissing: 0
			})
		];

		const now = summariseIndexBackfillNow([givenUp, ...settledAfterGivingUp]);

		expect(now.universesGivenUp).toBe(1);
		expect(now.entriesMissingNow).toBe(3);
		expect(now.universesEverBackfilled).toBe(2);
	});
});

describe('one universe\u2019s history with the mechanism (#768)', () => {
	it('counts the dead letters since the last completed catch-up, not all of them', () => {
		const rows = [
			attempt({ status: 'failed', requestedAt: daysAgo(30), finishedAt: daysAgo(29) }),
			attempt({
				reason: RETRY_AFTER_DEAD_LETTER_REASON,
				status: 'done',
				requestedAt: daysAgo(20),
				finishedAt: daysAgo(20)
			}),
			attempt({ status: 'failed', requestedAt: daysAgo(10), finishedAt: daysAgo(9) }),
			attempt({
				reason: RETRY_AFTER_DEAD_LETTER_REASON,
				status: 'failed',
				requestedAt: daysAgo(5),
				finishedAt: daysAgo(4)
			})
		];

		const [summary] = summariseIndexBackfillsByUniverse(rows);

		expect(summary).toMatchObject({
			attempts: 4,
			deadLetters: 3,
			deadLettersInEpisode: 2,
			retries: 2,
			recoveries: 1,
			completed: 1
		});
		expect(summary?.latest.requestedAt).toEqual(daysAgo(5));
		expect(summary?.lastDeadLetterAt).toEqual(daysAgo(4));
		expect(summary?.lastCompletedAt).toEqual(daysAgo(20));
	});

	it('counts every dead letter as in the current episode when nothing has ever completed', () => {
		const rows = [
			attempt({ status: 'failed', requestedAt: daysAgo(9), finishedAt: daysAgo(8) }),
			attempt({
				reason: RETRY_AFTER_DEAD_LETTER_REASON,
				status: 'failed',
				requestedAt: daysAgo(3),
				finishedAt: daysAgo(2)
			})
		];

		const [summary] = summariseIndexBackfillsByUniverse(rows);

		expect(summary?.deadLetters).toBe(2);
		expect(summary?.deadLettersInEpisode).toBe(2);
		expect(summary?.lastCompletedAt).toBeNull();
	});

	// The episode boundary is `requested_at` against the newest `done` row's `requested_at`,
	// because that is what `enqueueRetriesForDeadLetteredBackfills` counts and therefore what
	// the cooldown the page describes is a function of. The two candidate definitions only
	// disagree when a completed catch-up was requested before a dead letter and finished after
	// it, which the partial unique index makes unreachable in production: this pins the
	// definition rather than a state, so the page cannot quietly start reporting a number the
	// sweep did not use.
	it('counts an episode the way the sweep does, off requested_at rather than finished_at', () => {
		const rows = [
			attempt({ status: 'failed', requestedAt: daysAgo(10), finishedAt: daysAgo(9) }),
			attempt({ status: 'done', requestedAt: daysAgo(12), finishedAt: daysAgo(8) })
		];

		const [summary] = summariseIndexBackfillsByUniverse(rows);

		expect(summary?.deadLettersInEpisode).toBe(1);
	});

	it('puts a universe that gave up above one with newer, healthier activity', () => {
		const rows = [
			attempt({
				universeId: 'healthy',
				universeName: 'Healthy',
				status: 'done',
				requestedAt: daysAgo(1),
				finishedAt: daysAgo(1)
			}),
			attempt({
				universeId: 'stuck',
				universeName: 'Stuck',
				status: 'failed',
				requestedAt: daysAgo(6),
				finishedAt: daysAgo(5)
			})
		];

		expect(summariseIndexBackfillsByUniverse(rows).map((row) => row.universeName)).toEqual([
			'Stuck',
			'Healthy'
		]);
	});
});

describe('indexBackfillAttempts reads what the mechanism wrote (#768)', () => {
	let db: Db;
	/** Real time, not the fixed `NOW` the fixture arrays above use: these rows are compared
	 * against a live window, so an offset from a hardcoded instant would pass this week and
	 * fail next month. */
	const realNow = new Date();
	const realDaysAgo = (days: number): Date =>
		new Date(realNow.getTime() - days * 24 * 60 * 60 * 1000);

	const worlds: { label: string; id: string; name: string }[] = [];
	const idOf = (label: string): string => {
		const found = worlds.find((world) => world.label === label);
		if (!found) throw new Error(`fixture universe ${label} missing`);
		return found.id;
	};

	beforeAll(async () => {
		db = createDb(DATABASE_URL);

		for (const label of ['gave-up', 'recovered', 'clean']) {
			const [owner] = await db
				.insert(user)
				.values({
					id: unique('user'),
					name: 'Test GM',
					email: `${unique('user')}@canonry.invalid`,
					emailVerified: true
				})
				.returning();
			if (!owner) throw new Error('user insert returned no row');
			const name = unique(`w768-${label}`);
			const [world] = await db
				.insert(universe)
				.values({ ownerUserId: owner.id, name, slug: unique('universe'), kind: 'homebrew' })
				.returning();
			if (!world) throw new Error('universe insert returned no row');
			worlds.push({ label, id: world.id, name });
		}

		await db.insert(universeIndexBackfill).values([
			// Gave up, and has not been offered another go yet.
			{
				universeId: idOf('gave-up'),
				reason: NO_EMBEDDING_MODEL_REASON,
				status: 'failed',
				requestedAt: realDaysAgo(4),
				startedAt: realDaysAgo(4),
				finishedAt: realDaysAgo(3),
				attemptCount: 3,
				entitiesTotal: 12,
				entitiesMissing: 5,
				entitiesScheduled: 7,
				lastError: '3 attempts, 5 entities still missing'
			},
			// Gave up 8 days ago, then the sweep's retry finished 2 days ago: one dead letter
			// inside the month and outside the week, and one recovery inside both.
			{
				universeId: idOf('recovered'),
				reason: NO_EMBEDDING_MODEL_REASON,
				status: 'failed',
				requestedAt: realDaysAgo(9),
				startedAt: realDaysAgo(9),
				finishedAt: realDaysAgo(8),
				attemptCount: 3,
				entitiesTotal: 20,
				entitiesMissing: 4,
				entitiesScheduled: 16,
				lastError: '3 attempts, 4 entities still missing'
			},
			{
				universeId: idOf('recovered'),
				reason: RETRY_AFTER_DEAD_LETTER_REASON,
				status: 'done',
				requestedAt: realDaysAgo(2),
				startedAt: realDaysAgo(2),
				finishedAt: realDaysAgo(2),
				attemptCount: 1,
				entitiesTotal: 20,
				entitiesMissing: 0,
				entitiesScheduled: 4
			},
			// One ordinary catch-up after a model swap, still queued: no outcome to count.
			{
				universeId: idOf('clean'),
				reason: EMBEDDING_MODEL_CHANGED_REASON,
				status: 'pending',
				requestedAt: realDaysAgo(1)
			}
		]);
	}, 60_000);

	afterAll(async () => {
		const ids = worlds.map((world) => world.id);
		await db.delete(universeIndexBackfill).where(inArray(universeIndexBackfill.universeId, ids));
		await db.delete(universe).where(inArray(universe.id, ids));
		await closeDb(db);
	});

	/** Only this file's own universes: the read is deliberately unscoped, and
	 * `canon-save.test.ts` writes to the same table in the same run. */
	async function myAttempts(): Promise<IndexBackfillAttempt[]> {
		const ids = worlds.map((world) => world.id);
		return (await indexBackfillAttempts(db)).filter((row) => ids.includes(row.universeId));
	}

	it('returns one row per catch-up, with the universe name joined on', async () => {
		const mine = await myAttempts();

		// Which rows, and how many of each: a set of ids cannot see a duplicated row and a
		// total cannot say which universe grew one.
		expect(
			worlds.map((world) => ({
				name: world.name,
				rows: mine.filter((row) => row.universeId === world.id).length
			}))
		).toEqual([
			{ name: worlds[0]?.name, rows: 1 },
			{ name: worlds[1]?.name, rows: 2 },
			{ name: worlds[2]?.name, rows: 1 }
		]);
		// The join is the only thing this read adds, so it is asserted rather than assumed.
		expect(
			mine.filter((row) => row.universeId === idOf('recovered')).map((row) => row.universeName)
		).toEqual([worlds[1]?.name, worlds[1]?.name]);
	});

	it('answers the frequency question over the rows it read', async () => {
		const [week, month] = summariseIndexBackfillActivity(await myAttempts(), new Date(), [7, 30]);

		expect(week).toMatchObject({
			deadLetters: 1,
			universesDeadLettered: 1,
			retriesEnqueued: 1,
			recoveries: 1
		});
		expect(month).toMatchObject({
			deadLetters: 2,
			universesDeadLettered: 2,
			retriesEnqueued: 1,
			recoveries: 1
		});
	});

	it('reads the current state and the per-universe history off the same rows', async () => {
		const mine = await myAttempts();

		expect(summariseIndexBackfillNow(mine)).toEqual({
			universesGivenUp: 1,
			entriesMissingNow: 5,
			inFlight: 1,
			universesEverBackfilled: 3
		});

		const summaries = summariseIndexBackfillsByUniverse(mine);

		expect(summaries[0]?.universeId).toBe(idOf('gave-up'));
		expect(summaries.find((row) => row.universeId === idOf('gave-up'))).toMatchObject({
			attempts: 1,
			deadLetters: 1,
			deadLettersInEpisode: 1,
			recoveries: 0
		});
		expect(summaries.find((row) => row.universeId === idOf('recovered'))).toMatchObject({
			attempts: 2,
			deadLetters: 1,
			deadLettersInEpisode: 0,
			recoveries: 1
		});
	});
});
