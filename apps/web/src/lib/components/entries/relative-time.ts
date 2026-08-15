/**
 * Issue #145 (I7 = C): the browser's "changed 2d ago" column and the overview strip's
 * "what changed" line both need the same bucket-to-word mapping, so it lives once here
 * rather than once per component (`PinnedCards.svelte`'s local `relativeTime` is the
 * precedent this follows, extended with day/week/month buckets - table mode's pinned
 * cards only ever show something warmed this session, so it never needed them).
 */
import type { Messages } from '$lib/i18n';

export type RelativeTimeMessages = Messages['universe']['index']['relativeTime'];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

export function relativeTime(when: Date | string, t: RelativeTimeMessages): string {
	const ms = Date.now() - new Date(when).getTime();
	if (ms < MINUTE_MS) return t.justNow;
	if (ms < HOUR_MS) return t.minutesAgo(Math.round(ms / MINUTE_MS));
	if (ms < DAY_MS) return t.hoursAgo(Math.round(ms / HOUR_MS));
	if (ms < WEEK_MS) return t.daysAgo(Math.round(ms / DAY_MS));
	if (ms < MONTH_MS) return t.weeksAgo(Math.round(ms / WEEK_MS));
	return t.monthsAgo(Math.round(ms / MONTH_MS));
}
