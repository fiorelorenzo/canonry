/**
 * The read behind `/admin/indexing` (#768), and the reason it is its own file rather than a
 * fourth function in `backfill-store.ts`: that file is the mechanism's own storage layer, and
 * this is a surface asking the mechanism how it has been getting on. Nothing here writes, and
 * nothing here is called by a pass, so the two have no reason to share a module beyond both
 * naming the same table.
 *
 * **What the page has to answer, and it is not "what is broken right now".** #765 closed the
 * recovery half: a dead-lettered backfill is offered another go by the sweep on a widening
 * cooldown, so nobody has to press anything for a universe to come back. What is left is
 * whether the GM-facing half of #768 is ever worth building, and that is a question about
 * *frequency*: how often does a catch-up give up, on how many universes, and how often does it
 * then recover on its own. A page that says "two universes are failed" cannot answer it. So
 * every number below is either a count over a window or a per-universe history, and the
 * current state is one band of three rather than the whole page.
 *
 * **One read, aggregated in TypeScript**, the same shape `/admin/metrics` uses for the accept
 * rate: raw rows out of Postgres, and the definitions of "a dead letter" and "a recovery" as
 * plain functions over them, so a test can pin them without a database and the page cannot
 * grow a second definition of either. The read is uncapped on purpose, because the row count
 * is bounded by the mechanism rather than by a limit: a pass that has more to do requeues *its
 * own* row (`resumeIndexBackfill`), so the table holds one row per universe per episode and
 * not one per pass. If that ever stops being true, an uncapped read is how you find out.
 *
 * The two definitions, stated once:
 *
 * - a **dead letter** is a row that reached `failed`, which is `maxAttempts` verification
 *   passes that could not shrink the shortfall. It is a bound on the attempt and never on the
 *   universe (`backfill-store.ts`'s invariant), which is exactly why counting them over a
 *   window is meaningful and counting the ones that are `failed` *today* is not;
 * - a **recovery** is a `retry-after-dead-letter` row that reached `done`: the sweep offered a
 *   dead-lettered universe another go and that go finished. Anything the sweep enqueues for
 *   another reason completing is an ordinary catch-up, not a recovery, so `reason` and not
 *   `status` alone is what makes it one.
 */
import { desc, eq, type Db } from '@canonry/db';
import {
	universe,
	universeIndexBackfill,
	type UniverseIndexBackfillStatus
} from '@canonry/db/schema';
import { RETRY_AFTER_DEAD_LETTER_REASON } from './backfill-store.js';

/** One `universe_index_backfill` row with the name of the universe it belongs to, which is the
 * only thing this join adds: a uuid is not a thing an operator can act on. */
export interface IndexBackfillAttempt {
	id: string;
	universeId: string;
	universeName: string;
	universeSlug: string;
	reason: string;
	status: UniverseIndexBackfillStatus;
	requestedAt: Date;
	startedAt: Date | null;
	finishedAt: Date | null;
	attemptCount: number;
	entitiesTotal: number | null;
	entitiesMissing: number | null;
	entitiesScheduled: number;
	lastError: string | null;
}

/** Every catch-up ever recorded, newest first. See this file's own doc comment for why there
 * is no limit. */
export async function indexBackfillAttempts(db: Db): Promise<IndexBackfillAttempt[]> {
	return db
		.select({
			id: universeIndexBackfill.id,
			universeId: universeIndexBackfill.universeId,
			universeName: universe.name,
			universeSlug: universe.slug,
			reason: universeIndexBackfill.reason,
			status: universeIndexBackfill.status,
			requestedAt: universeIndexBackfill.requestedAt,
			startedAt: universeIndexBackfill.startedAt,
			finishedAt: universeIndexBackfill.finishedAt,
			attemptCount: universeIndexBackfill.attemptCount,
			entitiesTotal: universeIndexBackfill.entitiesTotal,
			entitiesMissing: universeIndexBackfill.entitiesMissing,
			entitiesScheduled: universeIndexBackfill.entitiesScheduled,
			lastError: universeIndexBackfill.lastError
		})
		.from(universeIndexBackfill)
		.innerJoin(universe, eq(universe.id, universeIndexBackfill.universeId))
		.orderBy(desc(universeIndexBackfill.requestedAt));
}

/** The three definitions this page rests on, in one place each rather than spelled at every
 * call site: a dead letter is the `failed` terminus, a retry is a row the sweep offered after
 * one, and a recovery is such a row that then finished. `finished_at` is the instant any of
 * them counts as having happened, and a row without one has not happened yet. */
export function isDeadLetter(attempt: IndexBackfillAttempt): boolean {
	return attempt.status === 'failed';
}

export function isRetry(attempt: IndexBackfillAttempt): boolean {
	return attempt.reason === RETRY_AFTER_DEAD_LETTER_REASON;
}

export function isRecovery(attempt: IndexBackfillAttempt): boolean {
	return attempt.status === 'done' && attempt.reason === RETRY_AFTER_DEAD_LETTER_REASON;
}

/** One row of the frequency table. `windowDays` null is the all-time row, which is kept beside
 * the two windows rather than replacing them: a rate needs a denominator in time, and "ever"
 * is what says whether the windows are quiet because the problem is rare or because the
 * deployment is young. */
export interface IndexBackfillWindow {
	windowDays: number | null;
	deadLetters: number;
	/** Distinct universes a dead letter in this window landed on, so one universe giving up
	 * four times does not read as four universes in trouble. */
	universesDeadLettered: number;
	retriesEnqueued: number;
	recoveries: number;
}

export function summariseIndexBackfillActivity(
	attempts: readonly IndexBackfillAttempt[],
	now: Date,
	windowDays: readonly (number | null)[]
): IndexBackfillWindow[] {
	return windowDays.map((days) => {
		const cutoff = days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
		const inWindow = (at: Date | null): boolean =>
			at !== null && (cutoff === null || at.getTime() >= cutoff.getTime());

		const deadLetters = attempts.filter((a) => isDeadLetter(a) && inWindow(a.finishedAt));
		return {
			windowDays: days,
			deadLetters: deadLetters.length,
			universesDeadLettered: new Set(deadLetters.map((a) => a.universeId)).size,
			// A retry is counted where it was *offered*, not where it ended, because the
			// question it answers is how often the sweep had to step in.
			retriesEnqueued: attempts.filter((a) => isRetry(a) && inWindow(a.requestedAt)).length,
			recoveries: attempts.filter((a) => isRecovery(a) && inWindow(a.finishedAt)).length
		};
	});
}

/** Where the mechanism stands this instant, which is the smallest of the three bands on the
 * page and deliberately so. `entriesMissingNow` sums the shortfall each currently-given-up
 * universe recorded at the moment it gave up: it is the last honest observation of that
 * universe rather than a live count, which is a distinction the page has to make in words. */
export interface IndexBackfillNow {
	universesGivenUp: number;
	entriesMissingNow: number;
	inFlight: number;
	universesEverBackfilled: number;
}

export function summariseIndexBackfillNow(
	attempts: readonly IndexBackfillAttempt[]
): IndexBackfillNow {
	const latest = latestPerUniverse(attempts);
	const givenUp = latest.filter(isDeadLetter);
	return {
		universesGivenUp: givenUp.length,
		entriesMissingNow: givenUp.reduce((sum, a) => sum + (a.entitiesMissing ?? 0), 0),
		inFlight: attempts.filter((a) => a.status === 'pending' || a.status === 'claimed').length,
		universesEverBackfilled: new Set(attempts.map((a) => a.universeId)).size
	};
}

/** The newest row of each universe, by `requested_at`. Ties break on the row already seen
 * first, which the caller's `order by requested_at desc` makes the newer insert in practice;
 * two rows of one universe cannot both be active anyway (`universe_index_backfill_active_key`),
 * so a tie is only ever between a settled row and a live one. */
function latestPerUniverse(attempts: readonly IndexBackfillAttempt[]): IndexBackfillAttempt[] {
	const byUniverse = new Map<string, IndexBackfillAttempt>();
	for (const attempt of attempts) {
		const seen = byUniverse.get(attempt.universeId);
		if (!seen || seen.requestedAt.getTime() < attempt.requestedAt.getTime()) {
			byUniverse.set(attempt.universeId, attempt);
		}
	}
	return [...byUniverse.values()];
}

/** One universe's whole history with the mechanism, which is what a row of the main table is.
 * `deadLettersInEpisode` is the count since the last completed catch-up, and it is the number
 * the cooldown is a function of: the sweep doubles the interval per dead letter in an episode,
 * so 1 means "another go in an hour" and 5 means "another go in a week", which is the
 * difference between a universe that is being retried and one that is nearly abandoned. It is
 * therefore computed the way `enqueueRetriesForDeadLetteredBackfills` computes it, off
 * `requested_at` against the newest `done` row's `requested_at`, rather than a second
 * reasonable-looking definition of the same word: a page whose number disagrees with the
 * interval the sweep actually chose would be worse than no number. */
export interface IndexBackfillUniverseSummary {
	universeId: string;
	universeName: string;
	universeSlug: string;
	latest: IndexBackfillAttempt;
	attempts: number;
	deadLetters: number;
	deadLettersInEpisode: number;
	retries: number;
	recoveries: number;
	completed: number;
	lastDeadLetterAt: Date | null;
	lastCompletedAt: Date | null;
}

/** Given-up universes first, then by most recent activity: the page's job is that an operator
 * sees the universes that gave up without reading past anything. */
export function summariseIndexBackfillsByUniverse(
	attempts: readonly IndexBackfillAttempt[]
): IndexBackfillUniverseSummary[] {
	const grouped = new Map<string, IndexBackfillAttempt[]>();
	for (const attempt of attempts) {
		const rows = grouped.get(attempt.universeId);
		if (rows) rows.push(attempt);
		else grouped.set(attempt.universeId, [attempt]);
	}

	const summaries: IndexBackfillUniverseSummary[] = [];
	for (const rows of grouped.values()) {
		const latest = latestPerUniverse(rows)[0];
		if (!latest) continue;
		// The episode boundary, in the sweep's own terms.
		const completedRequestedAt = rows
			.filter((a) => a.status === 'done')
			.map((a) => a.requestedAt)
			.sort((a, b) => b.getTime() - a.getTime())[0];
		const completedAt = rows
			.filter((a) => a.status === 'done')
			.map((a) => a.finishedAt)
			.filter((at): at is Date => at !== null)
			.sort((a, b) => b.getTime() - a.getTime())[0];
		const deadLetterTimes = rows
			.filter(isDeadLetter)
			.map((a) => a.finishedAt)
			.filter((at): at is Date => at !== null)
			.sort((a, b) => b.getTime() - a.getTime());
		summaries.push({
			universeId: latest.universeId,
			universeName: latest.universeName,
			universeSlug: latest.universeSlug,
			latest,
			attempts: rows.length,
			deadLetters: rows.filter(isDeadLetter).length,
			deadLettersInEpisode: rows.filter(
				(a) =>
					isDeadLetter(a) &&
					(completedRequestedAt === undefined ||
						a.requestedAt.getTime() > completedRequestedAt.getTime())
			).length,
			retries: rows.filter(isRetry).length,
			recoveries: rows.filter(isRecovery).length,
			completed: rows.filter((a) => a.status === 'done').length,
			lastDeadLetterAt: deadLetterTimes[0] ?? null,
			lastCompletedAt: completedAt ?? null
		});
	}

	return summaries.sort((a, b) => {
		const aGivenUp = isDeadLetter(a.latest) ? 1 : 0;
		const bGivenUp = isDeadLetter(b.latest) ? 1 : 0;
		if (aGivenUp !== bGivenUp) return bGivenUp - aGivenUp;
		return b.latest.requestedAt.getTime() - a.latest.requestedAt.getTime();
	});
}
