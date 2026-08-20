/**
 * #348: what the world home's masthead says, and which of its three states it is in.
 *
 * The masthead used to open on the entry count, the pending-review count and the credits
 * spent, all three of which are already on screen: the first two on the sidebar's own rows
 * and the third in the shell's quota meter (F2 = A). This replaces them with the one thing
 * no other surface answers, which is how the world has been moving: `weeklyChangeCounts`
 * over the last twelve rolling weeks, counting an entry created or rewritten, two entries
 * connected, and a scene touched.
 *
 * Three states rather than one, because a masthead that draws twelve empty bars on a world
 * nobody has written yet is worse than no masthead at all:
 *
 * - `unwritten`: no entries and nothing dated. The band renders nothing; the Continue
 *   section's own cold empty state already carries the one action there is to take, and a
 *   second invitation two inches above it would just be a louder version of the same
 *   sentence.
 * - `quiet`: entries exist, nothing changed inside the window. A sentence, no bars: twelve
 *   zeroes is a wall, "nothing has changed in twelve weeks" is an answer.
 * - `moving`: the sentence plus the bars, oldest week first.
 *
 * No threshold decides a word here: nothing in this file labels a world "growing" or
 * "stalled". The shape is drawn, the two figures are stated, and the reader concludes -
 * which is also the only reading of guardrail 7 that survives a masthead making claims
 * about a canon it cannot verify.
 */
import type { WeeklyChangeCount } from '@canonry/db';

/** Twelve rolling weeks: long enough that a month of silence is visible as silence, short
 * enough that one busy evening does not flatten the rest of the strip. */
export const PULSE_WEEKS = 12;

export type WorldPulse =
	| { kind: 'unwritten' }
	| { kind: 'quiet'; lastChangeAt: Date | null }
	| {
			kind: 'moving';
			/** One count per week, oldest first, always `weeks` long. */
			weeks: number[];
			total: number;
			/** The newest bucket: the last seven days, not "since Monday". */
			latest: number;
			/** The busiest week in the window, which is what the bars are scaled against. */
			peak: number;
	  };

export function worldPulse(input: {
	entryCount: number;
	counts: WeeklyChangeCount[];
	/** The newest dated event the page already loaded for its activity feed, so the quiet
	 * state can say when the world was last touched without a query of its own. */
	lastChangeAt?: Date | string | null;
	weeks?: number;
}): WorldPulse {
	const weeks = input.weeks ?? PULSE_WEEKS;
	const buckets = new Array<number>(weeks).fill(0);

	for (const row of input.counts) {
		// A bucket outside the window can only come from a clock skew between the query's
		// `now()` and its own arithmetic; dropping it is right, and cheaper than a cast.
		if (row.weeksAgo < 0 || row.weeksAgo >= weeks) continue;
		buckets[weeks - 1 - row.weeksAgo] = row.count;
	}

	const total = buckets.reduce((sum, count) => sum + count, 0);
	const lastChangeAt = input.lastChangeAt ? new Date(input.lastChangeAt) : null;

	if (total === 0) {
		if (input.entryCount === 0 && !lastChangeAt) return { kind: 'unwritten' };
		return { kind: 'quiet', lastChangeAt };
	}

	return {
		kind: 'moving',
		weeks: buckets,
		total,
		latest: buckets[buckets.length - 1] ?? 0,
		peak: Math.max(...buckets)
	};
}
