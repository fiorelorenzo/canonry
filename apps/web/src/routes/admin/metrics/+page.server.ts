/**
 * /admin/metrics (issues #100, #101, #102, #103; decision F5 = B, docs/ux/f5-metrics-dashboard.html):
 * staff-only, reusing the app's own auth and chrome rather than a second internal tool.
 * Deliberately never shown to the GM - "a GM optimising their own accept rate is a strange
 * incentive", per the F5 artifact's rejected-outright section.
 *
 * Four panels:
 * - Accept rate (#100), by proposal kind and model, over time. Computed with
 *   @canonry/eval's `acceptRate`/`acceptRateByGroup` - the same functions the propagation
 *   corpus scores prompt and model changes against - rather than a second definition here
 *   that could drift from it.
 * - Time to first accepted proposal (#101), per universe, as a distribution: every import
 *   job's own delta, not a single averaged number, so one slow outlier stays visible.
 * - Warm radius (#102): the current radius and the hit rate that chose it, per universe.
 *   @canonry/warm's `currentWarmRadius` is the same read `warmOnConsumption` uses to decide
 *   how far to reach, so this panel can never show a radius the trigger did not actually use.
 * - Canon entropy (#103): entries updated after a session versus created in prep, per
 *   universe.
 *
 * Every panel is null/empty rather than a fabricated zero for a universe or window with no
 * data yet - see each section's template for the empty-state copy.
 */
import {
	importsToFirstAcceptedProposal,
	proposalOutcomesForMetrics,
	sessionEntropyMetrics,
	ACCEPT_RATE_DEFAULT_WINDOW_DAYS,
	type ImportFirstAcceptRow,
	type ProposalOutcomeMetricRow
} from '@canonry/db';
import {
	acceptRate,
	acceptRateByGroup,
	type AcceptRateResult,
	type ProposalOutcomeRecord
} from '@canonry/eval';
import {
	currentWarmRadius,
	WARM_RADIUS_HIT_RATE_THRESHOLD,
	type WarmRadiusDecision
} from '@canonry/warm';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/** Monday-anchored week start, in UTC, formatted as an ISO date. A week is identified by
 * its start rather than an ISO week number so the table sorts and reads as a plain date. */
function weekStartKey(date: Date): string {
	const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const day = utc.getUTCDay();
	const mondayOffset = day === 0 ? -6 : 1 - day;
	utc.setUTCDate(utc.getUTCDate() + mondayOffset);
	return utc.toISOString().slice(0, 10);
}

export interface WeeklyAcceptRateRow extends AcceptRateResult {
	weekStart: string;
	kind: string;
	modelId: string | null;
}

/** Buckets proposals by week, then within each week by (kind, model), and runs every
 * bucket through @canonry/eval's `acceptRateByGroup` - issue #100's "by proposal kind and
 * model... over time" is exactly this cross product, computed with the shared definition
 * rather than a bespoke one. Rows with nothing produced that week are dropped: an empty
 * combination is not a data point. */
function weeklyAcceptRateByKindAndModel(rows: ProposalOutcomeMetricRow[]): WeeklyAcceptRateRow[] {
	const byWeek = new Map<string, ProposalOutcomeMetricRow[]>();
	for (const row of rows) {
		const week = weekStartKey(row.createdAt);
		const bucket = byWeek.get(week);
		if (bucket) bucket.push(row);
		else byWeek.set(week, [row]);
	}

	const result: WeeklyAcceptRateRow[] = [];
	for (const [week, weekRows] of byWeek) {
		const records: ProposalOutcomeRecord[] = weekRows.map((row) => ({
			outcome: row.outcome,
			group: `${row.kind}::${row.modelId ?? 'none'}`
		}));
		for (const [group, summary] of acceptRateByGroup(records)) {
			const separatorIndex = group.indexOf('::');
			const kind = group.slice(0, separatorIndex);
			const modelId = group.slice(separatorIndex + 2);
			result.push({
				weekStart: week,
				kind,
				modelId: modelId === 'none' ? null : modelId,
				...summary
			});
		}
	}

	return result.sort((a, b) => {
		if (a.weekStart !== b.weekStart) return b.weekStart.localeCompare(a.weekStart);
		if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
		return (a.modelId ?? '').localeCompare(b.modelId ?? '');
	});
}

export interface ImportAcceptDistributionRow {
	universeId: string;
	universeName: string;
	imports: ImportFirstAcceptRow[];
	importsWithAccept: number;
	medianSeconds: number | null;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Groups the flat per-import rows by universe (#101's "per universe"), keeping every
 * import's own delta alongside the group's median - the distribution stays on screen next
 * to the summary rather than being replaced by it. */
function groupImportsByUniverse(rows: ImportFirstAcceptRow[]): ImportAcceptDistributionRow[] {
	const byUniverse = new Map<string, ImportFirstAcceptRow[]>();
	for (const row of rows) {
		const bucket = byUniverse.get(row.universeId);
		if (bucket) bucket.push(row);
		else byUniverse.set(row.universeId, [row]);
	}

	return Array.from(byUniverse.values())
		.map((imports) => {
			const withAccept = imports.filter((row) => row.secondsToFirstAccept !== null);
			return {
				universeId: imports[0]!.universeId,
				universeName: imports[0]!.universeName,
				imports,
				importsWithAccept: withAccept.length,
				medianSeconds: median(withAccept.map((row) => row.secondsToFirstAccept!))
			};
		})
		.sort((a, b) => a.universeName.localeCompare(b.universeName));
}

export interface WarmRadiusRow extends WarmRadiusDecision {
	universeId: string;
	universeName: string;
}

export const load: PageServerLoad = async () => {
	const database = db();

	const [proposalRows, importRows, entropyRows] = await Promise.all([
		proposalOutcomesForMetrics(database, { sinceDays: ACCEPT_RATE_DEFAULT_WINDOW_DAYS }),
		importsToFirstAcceptedProposal(database),
		sessionEntropyMetrics(database)
	]);

	const overallAcceptRate = acceptRate(proposalRows.map((row) => ({ outcome: row.outcome })));
	const weeklyAcceptRate = weeklyAcceptRateByKindAndModel(proposalRows);

	const importsByUniverse = groupImportsByUniverse(importRows);

	// #103's query already lists every universe; reuse that list rather than a second
	// "all universes" read, so #102's per-universe radius panel covers exactly the same set.
	const warmRadiusByUniverse: WarmRadiusRow[] = await Promise.all(
		entropyRows.map(async (row) => ({
			universeId: row.universeId,
			universeName: row.universeName,
			...(await currentWarmRadius(database, row.universeId))
		}))
	);

	return {
		acceptRateWindowDays: ACCEPT_RATE_DEFAULT_WINDOW_DAYS,
		overallAcceptRate,
		weeklyAcceptRate,
		importsByUniverse,
		warmRadiusByUniverse,
		warmRadiusThresholdPercent: Math.round(WARM_RADIUS_HIT_RATE_THRESHOLD * 100),
		entropyByUniverse: entropyRows
	};
};
