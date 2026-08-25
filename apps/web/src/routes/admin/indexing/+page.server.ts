/**
 * /admin/indexing (#768): the staff view of the index catch-up mechanism, across every
 * universe. Same gate, chrome and shape as the three admin pages beside it, and no actions of
 * its own, so `requireAdmin` in `admin/+layout.server.ts` is the whole authorisation story
 * here (that file's doc comment covers why an action would need a second call).
 *
 * **Why this is a staff page and not a row in universe settings.** #761 asked for one of the
 * two and #768 named both; the GM-facing half is deferred, not cancelled. It has to explain
 * itself in a GM's language, on a condition that now repairs itself (#765), and nobody yet
 * knows how often it happens. This page is what answers that last part, which is why its
 * middle band is a frequency table rather than a list of what is broken this minute: the
 * decision it feeds is whether the GM-facing half is worth building at all.
 *
 * **No retry button, and that is a decision rather than a cut.** The sweep already offers a
 * dead-lettered universe another go on a widening cooldown, so a control here would be a
 * second trigger for something that has one, with its own authorisation story and nothing to
 * add to the outcome. The reasoning lives in #768's own text; if one is ever wanted it wants
 * its own issue.
 *
 * Everything the page reads comes from `$lib/server/jobs/backfill-report`, which is a read
 * module and never writes: the mechanism's own storage layer is `backfill-store.ts` and this
 * surface has no business in it.
 */
import { db } from '$lib/server/db';
import {
	EMBEDDING_MODEL_CHANGED_REASON,
	NO_EMBEDDING_MODEL_REASON,
	RETRY_AFTER_DEAD_LETTER_REASON
} from '$lib/server/jobs/backfill-store';
import {
	indexBackfillAttempts,
	summariseIndexBackfillActivity,
	summariseIndexBackfillNow,
	summariseIndexBackfillsByUniverse,
	type IndexBackfillAttempt
} from '$lib/server/jobs/backfill-report';
import type { UniverseIndexBackfillStatus } from '@canonry/db/schema';
import type { PageServerLoad } from './$types';

/** A week, a month, and ever. Two windows rather than one because "four this week" and "four
 * this month" are different findings, and the all-time row is what says whether a quiet window
 * means the problem is rare or the deployment is young. */
const WINDOW_DAYS = [7, 30, null] as const;

/** The attempt log is the evidence behind the summary above it, not an archive: an operator
 * reads the newest handful and the per-universe row carries the counts. */
const ATTEMPT_LOG_LIMIT = 50;

/** `reason` is a text column on purpose (the table's own comment in
 * `packages/db/src/schema/queue.ts`), so the catalogue can only ever know the reasons the
 * product writes today. Mapping through the mechanism's own exported constants rather than
 * through string literals is what keeps this from drifting the day a fourth trigger is added:
 * a new constant shows up here as its raw value, which is honest, rather than as a blank. */
export type BackfillReasonKey =
	'noEmbeddingModel' | 'retryAfterDeadLetter' | 'embeddingModelChanged';

const REASON_KEYS: Record<string, BackfillReasonKey> = {
	[NO_EMBEDDING_MODEL_REASON]: 'noEmbeddingModel',
	[RETRY_AFTER_DEAD_LETTER_REASON]: 'retryAfterDeadLetter',
	[EMBEDDING_MODEL_CHANGED_REASON]: 'embeddingModelChanged'
};

/** One catch-up as the page renders it: the row, plus the catalogue key for its reason where
 * there is one. */
export interface BackfillAttemptView {
	id: string;
	universeId: string;
	universeName: string;
	status: UniverseIndexBackfillStatus;
	reasonKey: BackfillReasonKey | null;
	reason: string;
	requestedAt: Date;
	finishedAt: Date | null;
	attemptCount: number;
	entitiesTotal: number | null;
	entitiesMissing: number | null;
	entitiesScheduled: number;
	lastError: string | null;
}

function toView(attempt: IndexBackfillAttempt): BackfillAttemptView {
	return {
		id: attempt.id,
		universeId: attempt.universeId,
		universeName: attempt.universeName,
		status: attempt.status,
		reasonKey: REASON_KEYS[attempt.reason] ?? null,
		reason: attempt.reason,
		requestedAt: attempt.requestedAt,
		finishedAt: attempt.finishedAt,
		attemptCount: attempt.attemptCount,
		entitiesTotal: attempt.entitiesTotal,
		entitiesMissing: attempt.entitiesMissing,
		entitiesScheduled: attempt.entitiesScheduled,
		lastError: attempt.lastError
	};
}

export const load: PageServerLoad = async () => {
	const attempts = await indexBackfillAttempts(db());

	return {
		now: summariseIndexBackfillNow(attempts),
		windows: summariseIndexBackfillActivity(attempts, new Date(), WINDOW_DAYS),
		universes: summariseIndexBackfillsByUniverse(attempts).map((summary) => ({
			...summary,
			latest: toView(summary.latest)
		})),
		attempts: attempts.slice(0, ATTEMPT_LOG_LIMIT).map(toView),
		attemptsTotal: attempts.length
	};
};
