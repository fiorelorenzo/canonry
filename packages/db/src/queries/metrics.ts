/**
 * SPEC.md §14 and decision F5 (docs/ux/DECISIONS.md): the DB layer behind the staff-only
 * metrics admin surface. Four functions, one per issue:
 *
 * - #100 accept rate: raw `proposal` rows, so the admin route can hand them to
 *   @canonry/eval's `acceptRate`/`acceptRateByGroup` rather than a second definition of
 *   "accepted over decided" that could drift from the one the harness already scores
 *   prompt and model changes against.
 * - #101 time to first accepted proposal: one row per import job with the delta to that
 *   job's first accepted proposal, or null if it has none yet - a distribution, not a
 *   single averaged number, because SPEC §14 worries about the slow outlier, which an
 *   average would hide.
 * - #102 warm hit rate: consumed over generated `warm_artifact` rows, per universe, which
 *   @canonry/warm's radius governor (radius.ts) reads to decide ring 1 vs ring 2.
 * - #103 canon entropy: entries created while no session was running (prep) versus
 *   entries updated in the window right after a session ended, per universe.
 *
 * Every function here is honest about an empty database: a fresh install returns null
 * rates and empty arrays, never a 0% that would misread as "the copilot failed" when
 * nothing has been proposed at all.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { ProposalKind, ProposalOutcome } from '../schema/enums.js';
import { proposal } from '../schema/proposal.js';
import { importJob } from '../schema/source.js';
import { warmArtifact } from '../schema/table.js';

// ---------------------------------------------------------------------------------------
// #100: accept rate of propagation proposals, by kind and model, over time
// ---------------------------------------------------------------------------------------

export interface ProposalOutcomeMetricRow {
	outcome: ProposalOutcome;
	kind: ProposalKind;
	modelId: string | null;
	createdAt: Date;
}

/** Default window for the accept-rate panel: wide enough that a slow week does not read
 * as "nothing is happening" (the F5 artifact's own mock used 30d; 90d gives three months
 * of weekly buckets to actually show a trend in). Callers that want all-time pass 0. */
export const ACCEPT_RATE_DEFAULT_WINDOW_DAYS = 90;

/**
 * Every proposal in the window, unfiltered by outcome - pending and superseded rows still
 * matter to `acceptRate`'s produced/decided counts (packages/eval/src/propagation/accept-rate.ts),
 * so trimming them here would just move the drift the accept-rate module's own doc comment
 * warns about one layer earlier. `sinceDays: 0` means all time. `universeId` is an escape
 * hatch for a single-universe view (and for test isolation); the admin panel itself leaves
 * it unset, since decision F5 puts this metric on a staff surface with no per-universe
 * scoping requirement in issue #100, unlike #101 and #103.
 */
export async function proposalOutcomesForMetrics(
	db: Db,
	opts?: { sinceDays?: number; universeId?: string }
): Promise<ProposalOutcomeMetricRow[]> {
	const sinceDays = opts?.sinceDays ?? ACCEPT_RATE_DEFAULT_WINDOW_DAYS;
	const cutoff = sinceDays > 0 ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) : null;
	const conditions = [
		...(cutoff ? [gte(proposal.createdAt, cutoff)] : []),
		...(opts?.universeId ? [eq(proposal.universeId, opts.universeId)] : [])
	];
	const rows = await db
		.select({
			outcome: proposal.outcome,
			kind: proposal.kind,
			modelId: proposal.modelId,
			createdAt: proposal.createdAt
		})
		.from(proposal)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(proposal.createdAt);
	return rows;
}

// ---------------------------------------------------------------------------------------
// #101: time from import to first accepted proposal, per universe, as a distribution
// ---------------------------------------------------------------------------------------

export interface ImportFirstAcceptRow {
	importJobId: string;
	universeId: string;
	universeName: string;
	importCreatedAt: Date;
	/** Null when nothing from this import has been accepted yet - the honest "still
	 * waiting" state, never folded into a median as if it were instant. */
	firstAcceptedAt: Date | null;
	secondsToFirstAccept: number | null;
}

/**
 * One row per `import_job`, joined to the earliest `decided_at` among that job's accepted
 * proposals. There is no `import_job_id` column on `proposal` (import candidates land in
 * `proposal_plan`/`proposal` with `trigger = 'import'` and no back-reference - see
 * `packages/import/src/job-runner.ts`'s `materializeDocumentProposals`), so the join is by
 * time window instead: everything with `trigger = 'import'` created between this job's
 * `created_at` and the next import job's `created_at` for the same universe (or now, for
 * the most recent job) is attributed to this run. Two concurrent imports on the same
 * universe would blur into each other under this scheme, but SPEC §6.7's queue already
 * rules that out - one import runs at a time per universe.
 *
 * `seconds_to_first_accept` measures from the job's `created_at` (when the GM started the
 * upload), not `finished_at`, on purpose: the GM's own clock starts the moment they act,
 * and AGENTS.md's "the product loses to Obsidian if first value takes an hour" is about
 * that whole wait, extraction time included.
 */
export async function importsToFirstAcceptedProposal(
	db: Db,
	opts?: { universeId?: string }
): Promise<ImportFirstAcceptRow[]> {
	const rows = await db.execute<{
		import_job_id: string;
		universe_id: string;
		universe_name: string;
		import_created_at: string;
		first_accepted_at: string | null;
		seconds_to_first_accept: string | null;
	}>(sql`
		with job_windows as (
			select
				id as import_job_id,
				universe_id,
				created_at as import_created_at,
				lead(created_at) over (partition by universe_id order by created_at) as next_import_created_at
			from ${importJob}
			${opts?.universeId ? sql`where universe_id = ${opts.universeId}::uuid` : sql``}
		)
		select
			jw.import_job_id,
			jw.universe_id,
			u.name as universe_name,
			jw.import_created_at,
			min(p.decided_at) as first_accepted_at,
			extract(epoch from (min(p.decided_at) - jw.import_created_at)) as seconds_to_first_accept
		from job_windows jw
		join universe u on u.id = jw.universe_id
		left join ${proposal} p
			on p.universe_id = jw.universe_id
			and p.trigger = 'import'
			and p.outcome = 'accepted'
			and p.created_at >= jw.import_created_at
			and (jw.next_import_created_at is null or p.created_at < jw.next_import_created_at)
		group by jw.import_job_id, jw.universe_id, u.name, jw.import_created_at
		order by jw.import_created_at desc
	`);

	return rows.map((row) => ({
		importJobId: row.import_job_id,
		universeId: row.universe_id,
		universeName: row.universe_name,
		importCreatedAt: new Date(row.import_created_at),
		firstAcceptedAt: row.first_accepted_at ? new Date(row.first_accepted_at) : null,
		secondsToFirstAccept:
			row.seconds_to_first_accept === null ? null : Number(row.seconds_to_first_accept)
	}));
}

// ---------------------------------------------------------------------------------------
// #102: warm hit rate (consumed over generated), which governs the warm radius
// ---------------------------------------------------------------------------------------

export interface WarmHitRateRow {
	consumed: number;
	generated: number;
	/** Null when nothing has been generated yet for this universe - no hit rate exists,
	 * rather than a 0% that would read as "warming never gets used". */
	hitRate: number | null;
}

/** SPEC §14 point 3: "warm hit rate: consumed artifacts over generated ones." `generated`
 * is the row count of `warm_artifact` (one row per generation, per its own schema comment
 * in packages/db/src/schema/table.ts); `consumed` sums `consumed_count`, the per-row
 * counter `recordConsumption` increments each time a GM actually uses a warmed artifact
 * at the table. Consumed can exceed generated (the same brief read twice both count), so
 * the rate is not capped at 1 - a healthy universe can run above 100%. */
export async function warmHitRate(db: Db, universeId: string): Promise<WarmHitRateRow> {
	const [row] = await db
		.select({
			consumed: sql<number>`coalesce(sum(${warmArtifact.consumedCount}), 0)::int`,
			generated: sql<number>`count(*)::int`
		})
		.from(warmArtifact)
		.where(eq(warmArtifact.universeId, universeId));

	const consumed = row?.consumed ?? 0;
	const generated = row?.generated ?? 0;
	return { consumed, generated, hitRate: generated === 0 ? null : consumed / generated };
}

// ---------------------------------------------------------------------------------------
// #103: entries updated after a session versus entries created in prep, per universe
// ---------------------------------------------------------------------------------------

export interface SessionEntropyRow {
	universeId: string;
	universeName: string;
	entriesCreatedInPrep: number;
	entriesUpdatedAfterSession: number;
}

/** How long after a session ends an entry update still counts as a reaction to that
 * session, rather than ordinary prep for whatever comes next. A week comfortably covers
 * "wrote up the session the next morning" without stretching into unrelated later work. */
export const DEBRIEF_WINDOW_HOURS = 7 * 24;

/**
 * The entropy metric SPEC §14 point 4 calls out: "the one that says whether canon entropy
 * was actually solved or whether we just built another place to write things down."
 *
 * `entries_created_in_prep`: entities whose `created_at` falls outside every
 * `session_context` window for the universe (a window is `[started_at, coalesce(ended_at,
 * now())]`) - created while nobody was at the table, which is prep by elimination.
 *
 * `entries_updated_after_session`: entities with at least one revision carrying a
 * `parent_revision_id` (an edit of existing content, not the entity's first-ever revision
 * - every creation path in this codebase, `acceptProposal`'s create/draft_entity branch
 * and the manual edit route alike, leaves the first revision's parent null) whose
 * `created_at` falls inside `DEBRIEF_WINDOW_HOURS` after some session's `ended_at`.
 * `count(distinct entity_id)` so an entity edited three times in the debrief window still
 * counts once, matching "entries updated", not "edits made".
 */
export async function sessionEntropyMetrics(db: Db): Promise<SessionEntropyRow[]> {
	const rows = await db.execute<{
		universe_id: string;
		universe_name: string;
		entries_created_in_prep: string;
		entries_updated_after_session: string;
	}>(sql`
		select
			u.id as universe_id,
			u.name as universe_name,
			(
				select count(*)
				from entity e
				where e.universe_id = u.id
				and not exists (
					select 1 from session_context sc
					where sc.universe_id = u.id
					and e.created_at >= sc.started_at
					and e.created_at <= coalesce(sc.ended_at, now())
				)
			) as entries_created_in_prep,
			(
				select count(distinct r.entity_id)
				from revision r
				where r.universe_id = u.id
				and r.parent_revision_id is not null
				and exists (
					select 1 from session_context sc
					where sc.universe_id = u.id
					and sc.ended_at is not null
					and r.created_at > sc.ended_at
					and r.created_at <= sc.ended_at + (${DEBRIEF_WINDOW_HOURS} || ' hours')::interval
				)
			) as entries_updated_after_session
		from universe u
		order by u.name asc
	`);

	return rows.map((row) => ({
		universeId: row.universe_id,
		universeName: row.universe_name,
		entriesCreatedInPrep: Number(row.entries_created_in_prep),
		entriesUpdatedAfterSession: Number(row.entries_updated_after_session)
	}));
}
