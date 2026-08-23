/**
 * /admin/metrics (issues #100, #101, #102, #103; decision F5 = B, `docs/ux/DECISIONS.md`):
 * staff-only, reusing the app's own auth and chrome rather than a second internal tool.
 * Deliberately never shown to the GM - "a GM optimising their own accept rate is a strange
 * incentive", per the F5 artifact's rejected-outright section.
 *
 * Five panels:
 * - Accept rate (#100), by proposal kind and model, over time. Computed with
 *   @canonry/eval's `acceptRate`/`acceptRateByGroup` - the same functions the propagation
 *   corpus scores prompt and model changes against - rather than a second definition here
 *   that could drift from it.
 * - Accept rate by interface locale (#128, SPEC.md §17 "instrumented per locale"): the
 *   same `acceptRate` function again, filtered by `proposal.locale`, next to the panel
 *   above rather than a second definition of the rate.
 * - Time to first accepted proposal (#101), per universe, as a distribution: every import
 *   job's own delta, not a single averaged number, so one slow outlier stays visible.
 * - Warm radius (#102): the current radius and the hit rate that chose it, per universe.
 *   @canonry/warm's `currentWarmRadius` is the same read `warmOnConsumption` uses to decide
 *   how far to reach, so this panel can never show a radius the trigger did not actually use.
 * - Canon entropy (#103): entries updated after a session versus created in prep, per
 *   universe.
 * - Audit flags by position (#278): dismissals over flags produced, broken out by the
 *   flag's position in its own audit run. This is the instrumentation `AUDIT_PAIR_CAP` was
 *   set without, and it is empty until the audit has been used at volume, which the panel
 *   says in as many words rather than drawing a flat line through no data.
 *
 * Every panel is null/empty rather than a fabricated zero for a universe or window with no
 * data yet - see each section's template for the empty-state copy.
 */
import {
	auditFlagOutcomes,
	importsToFirstAcceptedProposal,
	proposalOutcomesForMetrics,
	sessionEntropyMetrics,
	ACCEPT_RATE_DEFAULT_WINDOW_DAYS,
	type AuditFlagOutcomeRow,
	type ImportFirstAcceptRow,
	type ProposalOutcomeMetricRow
} from '@canonry/db';
import { AUDIT_PAIR_CAP } from '@canonry/copilot';
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
import { LOCALES, type Locale } from '$lib/i18n';
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

export interface LocaleAcceptRateRow extends AcceptRateResult {
	locale: Locale;
}

/** Issue #128, SPEC.md §17's "instrumented per locale": accept rate broken out by the
 * interface locale `proposal.locale` records (issue #124's `createProposalPlan`),
 * computed with the exact same `acceptRate` the panel above and the eval harness's
 * corpus both call - never a second definition of "accepted over decided" that could
 * quietly disagree with it. Every locale in `LOCALES` gets a row, even one with zero
 * proposals: `acceptRate` on an empty array reports `produced: 0, acceptRate: null`,
 * which the template renders as "no data" - a locale nobody has used yet must never read
 * as a fabricated 0%, which would look like a broken copilot rather than an empty
 * column. Proposals with no recorded locale (written before issue #124) are excluded
 * rather than folded into either locale's count. */
function acceptRateByInterfaceLocale(rows: ProposalOutcomeMetricRow[]): LocaleAcceptRateRow[] {
	return LOCALES.map((locale) => ({
		locale,
		...acceptRate(
			rows.filter((row) => row.locale === locale).map((row) => ({ outcome: row.outcome }))
		)
	}));
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

export interface AuditFlagPositionRow {
	/** One-based, because a GM counts flags from one and `proposal.rank` counts from zero. */
	position: number;
	produced: number;
	dismissed: number;
	stillOpen: number;
	/** Dismissed over produced, or `null` when nothing has been produced at that position. */
	dismissalRate: number | null;
}

/**
 * Issue #278: dismissal rate by a flag's position in its own audit run, which is the
 * evidence `AUDIT_PAIR_CAP = 5` was set without. If dismissals climb with position, the cap
 * is already too generous; if they are flat, five is not the number costing anybody
 * anything and the constant can stay where the spec's wording put it.
 *
 * Computed with `acceptRateByGroup`, the same function the two panels above use, but read
 * through its `rejected` and `produced` counts rather than its `acceptRate`: a flag has no
 * accept path at all (`acceptProposal` refuses `kind: 'flag'` outright), so "accepted over
 * decided" is structurally zero here and would read as a GM rejecting everything. Dismissed
 * over produced is the honest rate, and a position nobody has reached yet reports null
 * rather than a fabricated zero.
 */
function dismissalRateByFlagPosition(rows: AuditFlagOutcomeRow[]): AuditFlagPositionRow[] {
	const byPosition = acceptRateByGroup(
		rows.map((row) => ({ outcome: row.outcome, group: String(row.position) }))
	);
	return Array.from(byPosition.entries())
		.map(([group, summary]) => ({
			position: Number(group) + 1,
			produced: summary.produced,
			dismissed: summary.rejected,
			stillOpen: summary.pending,
			dismissalRate: summary.produced === 0 ? null : summary.rejected / summary.produced
		}))
		.sort((a, b) => a.position - b.position);
}

export const load: PageServerLoad = async () => {
	const database = db();

	const [proposalRows, importRows, entropyRows, flagRows] = await Promise.all([
		proposalOutcomesForMetrics(database, { sinceDays: ACCEPT_RATE_DEFAULT_WINDOW_DAYS }),
		importsToFirstAcceptedProposal(database),
		sessionEntropyMetrics(database),
		auditFlagOutcomes(database, { sinceDays: 0 })
	]);

	const overallAcceptRate = acceptRate(proposalRows.map((row) => ({ outcome: row.outcome })));
	const weeklyAcceptRate = weeklyAcceptRateByKindAndModel(proposalRows);
	const acceptRateByLocale = acceptRateByInterfaceLocale(proposalRows);

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
		acceptRateByLocale,
		importsByUniverse,
		warmRadiusByUniverse,
		warmRadiusThresholdPercent: Math.round(WARM_RADIUS_HIT_RATE_THRESHOLD * 100),
		entropyByUniverse: entropyRows,
		auditFlagPositions: dismissalRateByFlagPosition(flagRows),
		auditPairCap: AUDIT_PAIR_CAP
	};
};
