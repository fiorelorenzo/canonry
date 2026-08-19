/**
 * The product's one budget derivation, for every caller that admits a real import job -
 * `apps/web`'s onboarding flow and `packages/bench`'s end-to-end harness alike (issue
 * #272). Before this file existed, `packages/bench/src/e2e/import.ts` ran its own
 * hardcoded `budgetCredits: 400` rather than this derivation, so every green row in its
 * reports was produced under a budget the product never gives a real job - the harness
 * measured the playbooks, not the product. `AGENTS.md` already states the same principle
 * for prompts ("run the product's own functions, never a copy of their prompts, because a
 * benchmark on invented prompts measures the prompts"); this applies it to money.
 *
 * `estimateAveragesForPlaybook` used to live in `apps/web/src/lib/server/onboarding.ts`,
 * which is why the bench could not import it - that module also imports
 * `$env/dynamic/private`, a SvelteKit virtual alias that only resolves inside a SvelteKit
 * app. Nothing in the actual derivation needs SvelteKit, so it moved here; `onboarding.ts`
 * now re-exports it rather than keeping a second copy.
 */
import { and, desc, eq, type Db } from '@canonry/db';
import { importJob } from '@canonry/db/schema';
import { estimateImportJob, type ImportEstimate } from './job-runner.js';

/**
 * Issue #261/#271/#272's full account: onenote's row was first a flat guess (0.25
 * credits/document), then briefly a corpus-density formula, then a flat constant again
 * once a second real job showed cost tracks the loop's own step budget and its
 * full-transcript resend on every step, not corpus bytes or link count - a 3-page and a
 * 14-page onenote corpus cost within 6% of each other per document (2.7496 vs 2.8826
 * credits, 121,911 vs 129,188 input tokens). That is the only source-independent,
 * source-measured number this deployment has: two real onenote documents, averaging
 * 2.816 credits and one clean wall-clock reading of 20 seconds.
 *
 * The other six rows are inferred, not measured - no real `import_job` row exists yet for
 * any of them on this deployment - from the same finding: if cost tracks steps taken
 * rather than content, and a document tends to run close to its playbook's own
 * `stepBudget` (`playbooks/*.md` frontmatter) when it has cross-document work to do, then
 * a playbook's per-document cost should scale with its `stepBudget` relative to onenote's
 * 60, calibrated by onenote's one real per-step rate (2.816 / 60 ≈ 0.0469 credits/step,
 * 20 / 60 ≈ 0.333 seconds/step). `obsidian` shares onenote's exact `stepBudget: 60` and
 * the same mandatory cross-document behaviour (`SPEC.md` §6.6: "every `[[link]]` is a
 * candidate relation", the same shape as onenote's "follow every in-body link"), so it
 * lands on exactly onenote's number rather than a scaled-down one - this is the "off by
 * roughly the factor onenote's was" #272 named for the obsidian row specifically.
 * `world-anvil` (`stepBudget: 50`) also mandatorily follows inter-article links
 * (`world-anvil.md`: "an inter-article link is a candidate relation"). `kanka`
 * (`stepBudget: 50`) follows a link only when a relation's target is not in the same
 * file - real cross-document work, just conditional rather than guaranteed. `docx`, `pdf`
 * and `generic` (`stepBudget: 40`) read one document with no mandated cross-document
 * following at all, so they get the smallest inferred number, though still meaningfully
 * above their old guesses: even a self-contained document takes several steps (propose
 * entity, propose entity, propose relation, checkpoint, `job_finish`), each one resending
 * the transcript so far, and #271 has not measured a lower bound on that yet either.
 *
 * This is deliberately generous rather than tight: per this file's own directive (#272),
 * the cost of guessing high is a scarier number on an estimate screen, the cost of
 * guessing low is a job that cannot finish, and only onenote's two rows carry a "measured"
 * label because only onenote has two real jobs behind it. Every other row here should be
 * replaced by `estimateAveragesFor`'s own historical-average path (below) the first time
 * this deployment finishes a real job in that playbook - these are cold-start defaults,
 * not a permanent table.
 */
const ONENOTE_CREDITS_PER_STEP = 2.816 / 60;
const ONENOTE_SECONDS_PER_STEP = 20 / 60;

function inferredFromStepBudget(stepBudget: number): {
	avgCreditsPerDocument: number;
	avgSecondsPerDocument: number;
} {
	return {
		avgCreditsPerDocument: ONENOTE_CREDITS_PER_STEP * stepBudget,
		avgSecondsPerDocument: ONENOTE_SECONDS_PER_STEP * stepBudget
	};
}

export const PLAYBOOK_COLD_START_ESTIMATE: Record<
	string,
	{ avgCreditsPerDocument: number; avgSecondsPerDocument: number }
> = {
	// MEASURED: two real jobs, #261/#272's own account above.
	onenote: { avgCreditsPerDocument: 2.816, avgSecondsPerDocument: 20 },
	// INFERRED: stepBudget 60, identical mandatory link-following shape to onenote.
	obsidian: inferredFromStepBudget(60),
	// INFERRED: stepBudget 50, mandatory inter-article link-following.
	'world-anvil': inferredFromStepBudget(50),
	// INFERRED: stepBudget 50, conditional cross-document following.
	kanka: inferredFromStepBudget(50),
	// INFERRED: stepBudget 40, single document, no mandated cross-document reads.
	docx: inferredFromStepBudget(40),
	pdf: inferredFromStepBudget(40),
	generic: inferredFromStepBudget(40)
};

/**
 * `job-runner.ts`'s `EstimateImportJobInput` doc comment: "historical average, supplied
 * by the caller... never invented here." A cold start (nobody has run this playbook on
 * this deployment yet) falls back to `PLAYBOOK_COLD_START_ESTIMATE` above; once real
 * `import_job` rows exist for a playbook, they replace the cold-start default entirely; a
 * measured row is always better evidence than an inferred one.
 */
export async function estimateAveragesForPlaybook(
	database: Db,
	playbookId: string
): Promise<{ avgCreditsPerDocument: number; avgSecondsPerDocument: number }> {
	const coldStart = PLAYBOOK_COLD_START_ESTIMATE[playbookId] ?? inferredFromStepBudget(40);

	const rows = await database
		.select({
			documentCount: importJob.documentCount,
			spentCredits: importJob.spentCredits,
			startedAt: importJob.startedAt,
			finishedAt: importJob.finishedAt
		})
		.from(importJob)
		.where(and(eq(importJob.playbook, playbookId), eq(importJob.status, 'finished')))
		.orderBy(desc(importJob.createdAt))
		.limit(20);

	const withDocs = rows.filter((r) => r.documentCount > 0);
	if (withDocs.length === 0) return coldStart;

	const totalDocs = withDocs.reduce((sum, r) => sum + r.documentCount, 0);
	const totalCredits = withDocs.reduce((sum, r) => sum + r.spentCredits, 0);
	const totalSeconds = withDocs.reduce((sum, r) => {
		if (!r.startedAt || !r.finishedAt) return sum;
		return sum + (r.finishedAt.getTime() - r.startedAt.getTime()) / 1000;
	}, 0);

	return {
		avgCreditsPerDocument:
			totalCredits > 0 ? totalCredits / totalDocs : coldStart.avgCreditsPerDocument,
		avgSecondsPerDocument:
			totalSeconds > 0 ? totalSeconds / totalDocs : coldStart.avgSecondsPerDocument
	};
}

/**
 * Issue #261 item 3: the estimate shown to the GM and the job's own hard ceiling used to
 * be the same number, so being slightly wrong about the estimate was fatal to the job.
 * The ceiling gets real headroom over the number the GM agreed to instead.
 *
 * The multiplier is 6 because 2 was measured to be too small, and because the thing it
 * has to absorb turned out to be much larger than per-document variance from a small
 * calibration sample. A three-note Obsidian vault, quoted at 9 credits and budgeted at 18,
 * spent 16.8720 on two of its three documents and stopped at the ceiling on the third:
 * 747,111 input tokens against 5,587 output tokens, for 29 proposals. That ratio is the
 * whole story (#271): every step of the loop resends its accumulated transcript, including
 * every proposal it has already made, so a document's cost grows with the square of how
 * much it finds rather than with how much it reads. How much a document will find is not
 * knowable before the job runs, so no estimate can be right in the way this ceiling was
 * asking it to be.
 *
 * That reframes what the ceiling is for. It is not a second opinion about the estimate; it
 * is the stop that catches a loop which has genuinely run away, and a job that costs a few
 * times its estimate has not run away, it was mis-estimated. Six times clears every real
 * job measured so far by a wide margin while still bounding a pathological one, and it
 * costs nothing when the estimate is right, because an accurate estimate never approaches
 * the ceiling. Lower this again once #271 makes cost predictable, not before.
 *
 * What keeps headroom from turning into an overcharge is unchanged: `checkImportQuota`
 * (`packages/db/src/queries/import.ts`) still gates admission on the un-headroomed
 * `estimate.estimatedCredits`, so headroom never admits a job the GM's balance could not
 * cover at the number they saw, and `spendCredits`'s own preflight (`previewCharge`) still
 * refuses any single document's charge the live balance cannot cover, headroom or not. */
export const IMPORT_BUDGET_HEADROOM_MULTIPLIER = 6;

export function budgetCreditsForEstimate(
	estimate: Pick<ImportEstimate, 'estimatedCredits'>,
	headroomMultiplier: number = IMPORT_BUDGET_HEADROOM_MULTIPLIER
): number {
	return Math.ceil(estimate.estimatedCredits * headroomMultiplier);
}

/**
 * Composes the three steps above into the one number every real admission needs -
 * `estimateImportJob`'s own job-level estimate, then the headroomed ceiling - so a caller
 * (the onboarding routes, the bench harness) cannot quietly skip the headroom step the
 * way the bench used to skip the whole derivation. Takes averages rather than a database,
 * so it is trivially unit-testable without a live Postgres connection - `estimate.test.ts`
 * pins its exact arithmetic. */
export function deriveJobBudget(
	averages: { avgCreditsPerDocument: number; avgSecondsPerDocument: number },
	documentCount: number
): { estimate: ImportEstimate; budgetCredits: number } {
	const estimate = estimateImportJob({ documentCount, ...averages });
	return { estimate, budgetCredits: budgetCreditsForEstimate(estimate) };
}
