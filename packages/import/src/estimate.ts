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
 * Issue #606 measured the six rows this table used to infer. The history is worth keeping,
 * because the shape of the mistake repeats: onenote's row was first a flat guess (0.25
 * credits/document), then briefly a corpus-density formula, then a flat constant again once
 * a second real job showed cost tracks the loop's own step budget and its full-transcript
 * resend on every step, not corpus bytes or link count (#261/#271/#272). That constant was
 * 2.816, the average of two real jobs billed before #313 priced cached input, so it stopped
 * meaning what it said. #330 replaced it with **1.1492**, the document-weighted pool of two
 * real `.mht` imports of a real 70-page OneNote notebook (93 documents, 106.8722 credits,
 * read off `import_job`). `docs/loop-cost.md` holds that account in full, and onenote stays
 * the only row here measured against somebody's real world.
 *
 * The other six were then that number times their own playbook's `stepBudget` over onenote's
 * 60, which moved all seven whenever one moved and left two of them below a document this
 * repo had already measured. #606 measured them instead: real imports through the product's
 * own upload path (`upload` -> `confirm` -> `start` on `/onboarding/import`, so detection,
 * enumeration, the estimate, admission and `startImportRun` all ran the way a GM's click runs
 * them), one fresh empty universe per job, `google/gemini-3.1-flash-lite` on `cheap` with
 * `pricePerCachedInputMTok` present, the same model #330 used. Every figure read off
 * `import_job` rather than off a runner's report:
 *
 *   playbook      jobs  docs  credits  per document  was (inferred)
 *   obsidian         1    35   30.3658        0.8676          1.1492
 *   world-anvil      1    32   23.8399        0.7450          0.9577
 *   kanka            1     7    6.7393        0.9628          0.9577
 *   docx             4     4    3.0197        0.7549          0.7661
 *   pdf              2     2    1.9397        0.9699          0.7661
 *   generic          3    12    9.6364        0.8030          0.7661
 *
 * **The input is our own corpus and not a GM's export, which is the one thing these six do
 * not share with onenote's row.** `packages/bench`'s `corpus` renders one sample world
 * (`corpus/valdoria-reach.ts`) into every format, so these are six readings of one world
 * rather than six worlds, and a real export with ten times the entries and a decade of
 * cross-references may well cost more per document. A measured figure from our own fixtures
 * is far better evidence than a figure scaled off a different playbook, which is what it
 * replaces, but it is not the same thing and this comment does not pretend it is.
 * `docs/loop-cost.md` names the archive behind every row.
 *
 * **Scaling linearly in `stepBudget` is not supported, which is the second thing #606 asked.**
 * Group the seven measured rows by the budget they share: 60 gives onenote 1.1492 and obsidian
 * 0.8676, 50 gives world-anvil 0.7450 and kanka 0.9628, 40 gives docx 0.7549, pdf 0.9699 and
 * generic 0.8030. Two playbooks sharing a step budget differ by up to 1.29x while the class
 * means differ by 1.20x, so the variable the old formula divided by explains less than the
 * variation it was meant to remove. On one corpus it explains nothing: drop onenote, whose
 * world is a different one, and the three class means are 0.8676, 0.8539 and 0.8426, flat to
 * within 3 per cent across step budgets 60, 50 and 40. The mechanism is visible in the jobs.
 * A step budget is a ceiling, and one job of the twelve reached one at all (obsidian, on 2 of
 * its 35 documents), so for the other 90 documents the budget bound nothing. What a document
 * costs is what it finds, and how much it will find is not something the ceiling knows. So
 * there is no formula here any more: every row is its own measurement.
 *
 * **No measured row carries a margin, and the one unmeasured case takes the highest measured
 * row.** That is the first thing #606 asked. Three reasons a measured row gets none. A
 * per-document average is what a consent screen is for, and padding it overstates what the GM
 * will actually be charged, which is its own harm under SPEC.md §15's "no opaque credits".
 * What protects a job from a low estimate is `IMPORT_BUDGET_HEADROOM_MULTIPLIER`, now measured
 * working twice: #330's notebook was quoted 37, budgeted 222 and spent 75.8718, and #606's
 * obsidian job was quoted 41, budgeted 246 and spent 30.3658. And the row a playbook really
 * needs is a real job in that playbook, which `estimateAveragesForPlaybook` installs the first
 * time one finishes. `UNMEASURED_PLAYBOOK_ESTIMATE` below is the opposite case, a playbook id
 * with no measurement at all: it used to fall back to the cheapest inferred row and now takes
 * the dearest measured one, because for a playbook nobody has ever run there is no evidence it
 * is cheaper than the dearest thing we have run, and #272's rule is that guessing high costs a
 * scarier estimate screen while guessing low costs a job that cannot finish.
 *
 * **`avgSecondsPerDocument` is raised where the measurement is above the number it replaces,
 * and never lowered.** These twelve jobs ran 20 documents wide on a box with other agents on
 * it, which is why `docs/loop-cost.md` keeps wall clock out of its tables, so a reading here
 * is an upper bound rather than a figure. An upper bound is evidence for raising a timeout
 * constant and not for lowering one, and raising one is nearly free: a slow job spends nothing
 * extra by being slow, and `IMPORT_TIMEOUT_HEADROOM_MULTIPLIER` triples it anyway. So
 * obsidian (23.3 measured), pdf (25.3), kanka (17.6) and generic (15.5) take their readings
 * rounded up, and onenote, world-anvil and docx keep the number they had, rounded up to whole
 * seconds.
 *
 * **How much precision is worth buying here, honestly.** `estimateAveragesForPlaybook`
 * replaces a cold-start row with the average of up to twenty real finished jobs, and it fires:
 * #330 watched it three times, and #606 watched a five-document generic upload get quoted 5
 * credits off the previous generic job's real 0.9944 rather than off the cold-start row. So
 * for a playbook whose jobs finish, a wrong constant misprices exactly one job per deployment,
 * and that is the frame this table should be read in. It does not deserve another decimal
 * place, and it does deserve not being a guess. The exception is worth knowing because #606
 * hit it: that query filters `status = 'finished'`, and #606's obsidian job settled
 * `stopped_at_ceiling` (2 of its 35 documents reached their step ceiling, the other 33
 * finished), so it installs no history at all. A playbook whose jobs keep stopping at a
 * ceiling keeps quoting off the constant here however many jobs it has run, which is the one
 * case where this row decides more than one job. Issue #610 carries that.
 */

/** The row a playbook id with no measured row of its own gets: the highest measured figures in
 * the table below, for the reason in the doc comment. Reached only through
 * `estimateAveragesForPlaybook`'s `??`, since `apps/web` validates an id against
 * `KNOWN_PLAYBOOK_IDS` before it gets here, so this is the defensive case rather than a
 * playbook we ship. */
export const UNMEASURED_PLAYBOOK_ESTIMATE = {
	avgCreditsPerDocument: 1.1492,
	avgSecondsPerDocument: 26
};

export const PLAYBOOK_COLD_START_ESTIMATE: Record<
	string,
	{ avgCreditsPerDocument: number; avgSecondsPerDocument: number }
> = {
	// #330: two real `.mht` jobs of a real 70-page notebook, 93 documents for 106.8722 credits.
	// Seconds measured at 15.4 and left at 20, #330's own call.
	onenote: { avgCreditsPerDocument: 1.1492, avgSecondsPerDocument: 20 },
	// #606, corpus `obsidian/v1.zip`: 35 documents for 30.3658, settled `stopped_at_ceiling`
	// because 2 documents reached their step ceiling. Every document still ran, and a document
	// that spends its whole step budget is the dearest a document can be, not a truncated one.
	obsidian: { avgCreditsPerDocument: 0.8676, avgSecondsPerDocument: 24 },
	// #606, corpus `world-anvil/v1.zip`: 32 documents for 23.8399.
	'world-anvil': { avgCreditsPerDocument: 0.745, avgSecondsPerDocument: 17 },
	// #606, corpus `kanka/v1.zip`: 7 documents for 6.7393.
	kanka: { avgCreditsPerDocument: 0.9628, avgSecondsPerDocument: 18 },
	// #606, four single-file uploads of the corpus's own `.docx` (both files of v1 and of v2,
	// one document each): 4 documents for 3.0197. Single-file is the only shape a `docx` job
	// has, because a zip holding several `.docx` detects as `generic` (`detectSource` sniffs a
	// sole entry and nothing else), so four jobs is what four documents costs here.
	docx: { avgCreditsPerDocument: 0.7549, avgSecondsPerDocument: 14 },
	// #606, two single-file uploads of the corpus's own `players-handout.pdf` (v1 and v2):
	// 2 documents for 1.9397. The row the old formula put furthest out, at 0.7661.
	pdf: { avgCreditsPerDocument: 0.9699, avgSecondsPerDocument: 26 },
	// #606, `generic/v1.zip` and `generic/v2.zip` (5 documents each) plus the zip of two
	// `.docx` that detection routes here (2 documents): 12 documents for 9.6364.
	generic: { avgCreditsPerDocument: 0.803, avgSecondsPerDocument: 16 }
};

/**
 * `job-runner.ts`'s `EstimateImportJobInput` doc comment: "historical average, supplied
 * by the caller... never invented here." A cold start (nobody has run this playbook on
 * this deployment yet) falls back to `PLAYBOOK_COLD_START_ESTIMATE` above; once real
 * finished `import_job` rows exist for a playbook, they replace the cold-start default
 * entirely, because a job in this deployment's own worlds is better evidence than a job in
 * ours. `status = 'finished'` is doing more than it looks like here: a job that settled
 * `stopped_at_ceiling` spent real credits on real documents and is still not history, so a
 * playbook whose jobs keep stopping at a ceiling never leaves its cold-start row (#610).
 */
export async function estimateAveragesForPlaybook(
	database: Db,
	playbookId: string
): Promise<{ avgCreditsPerDocument: number; avgSecondsPerDocument: number }> {
	const coldStart = PLAYBOOK_COLD_START_ESTIMATE[playbookId] ?? UNMEASURED_PLAYBOOK_ESTIMATE;

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
 * The job's wall-clock timeout, derived from the same estimate rather than fixed.
 *
 * It used to be a flat five minutes in `apps/web/src/lib/server/onboarding.ts`, which is
 * the third time in this file's history that a hard limit sat below what the product's own
 * estimate said the work needed. A fourteen-document OneNote job was quoted at "about four
 * minutes" on the estimate screen and then cancelled at exactly 300 seconds, mid-step, with
 * 71 proposals already emitted and 44.20 of its 240-credit budget spent. Nobody pressed
 * cancel: the job killed itself one minute after its own prediction, so no import of more
 * than about ten documents could ever finish, whatever the budget said.
 *
 * So the timeout is the estimate plus headroom, with a floor for tiny jobs. The floor is
 * five minutes because that is what small jobs already had and it is comfortably more than
 * any measured three-document run (44 seconds for OneNote, 125 for Obsidian). The
 * multiplier is three rather than the budget's six: overrunning a time estimate is less
 * dangerous than overrunning a cost estimate, since a slow job spends nothing extra by
 * being slow, and its real ceiling is the budget it cannot exceed either way.
 *
 * A job that hits this is still cancelled the way it always was, with its proposals intact
 * and the document it was working on named, because that ending is good and a genuinely
 * stuck job still needs it. */
export const IMPORT_TIMEOUT_HEADROOM_MULTIPLIER = 3;
export const IMPORT_TIMEOUT_FLOOR_MS = 5 * 60_000;

export function timeoutMsForEstimate(
	estimate: Pick<ImportEstimate, 'estimatedMinutes'>,
	headroomMultiplier: number = IMPORT_TIMEOUT_HEADROOM_MULTIPLIER
): number {
	const fromEstimate = estimate.estimatedMinutes * 60_000 * headroomMultiplier;
	return Math.max(IMPORT_TIMEOUT_FLOOR_MS, Math.ceil(fromEstimate));
}

/**
 * Composes the steps above into the limits every real admission needs: `estimateImportJob`'s
 * own job-level estimate, then the headroomed credit ceiling, then the headroomed wall-clock
 * timeout. All three come from here so a caller (the onboarding routes, the bench harness)
 * cannot quietly skip one, the way the bench used to skip the whole derivation and the way
 * the onboarding route used to hardcode a five-minute timeout beside a correctly derived
 * budget. Takes averages rather than a database, so it is trivially unit-testable without a
 * live Postgres connection - `estimate.test.ts` pins its exact arithmetic. */
export function deriveJobBudget(
	averages: { avgCreditsPerDocument: number; avgSecondsPerDocument: number },
	documentCount: number
): { estimate: ImportEstimate; budgetCredits: number; timeoutMs: number } {
	const estimate = estimateImportJob({ documentCount, ...averages });
	return {
		estimate,
		budgetCredits: budgetCreditsForEstimate(estimate),
		timeoutMs: timeoutMsForEstimate(estimate)
	};
}
