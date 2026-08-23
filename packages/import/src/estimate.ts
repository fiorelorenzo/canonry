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
 * Issue #330 replaced the number this table is calibrated on. The history is worth keeping,
 * because the shape of the mistake repeats: onenote's row was first a flat guess (0.25
 * credits/document), then briefly a corpus-density formula, then a flat constant again once
 * a second real job showed cost tracks the loop's own step budget and its full-transcript
 * resend on every step, not corpus bytes or link count (#261/#271/#272). That constant was
 * 2.816, the average of two real jobs' `spent_credits / document_count` (2.7496 and 2.8826).
 * Then #313 gave `computeCost` a cached-input rate, and those two jobs had been billing
 * roughly half of every input token at the full input rate, so the number they produced
 * stopped meaning what it said. `docs/loop-cost.md` bounded the honest figure at 1.15 to
 * 1.77 by repricing their recorded token counts and deliberately did not hardcode either
 * end, because a repricing of an old job is not a measurement of a new one.
 *
 * So this is a measurement of new ones. Three real `.mht` imports of a real 70-page OneNote
 * notebook through the product's own upload path (#590's corpus, #599's reader), on
 * `google/gemini-3.1-flash-lite` with `pricePerCachedInputMTok` present, read off
 * `import_job` rather than off a report:
 *
 *   scope     docs  spent_credits  per document  input tokens  seconds
 *   page         1         0.5261        0.5261        33,193      9.3
 *   section     23        31.0004        1.3478     3,064,433    479.2
 *   notebook    70        75.8718        1.0839     6,295,130    952.9
 *
 * The row is **1.1492**, the document-weighted pool of the two multi-page runs: 106.8722
 * credits over 93 documents. Two reasons for that scope rather than another. A one-page
 * import is the flattering case and it is not the case that matters, and this run proves the
 * cost of using it rather than arguing about it: the notebook job ran while the page job was
 * the only history, so the estimate screen quoted 37 credits for work that then billed
 * 75.8718. And pooling by document is the same arithmetic `estimateAveragesForPlaybook`
 * below performs on real rows, so the cold start and the path that replaces it agree on what
 * an average means. The notebook alone would have said 1.0839 and the page alone 0.5261.
 *
 * Two cross-checks, because one number from one afternoon deserves them. Repricing these
 * same two jobs' recorded tokens the way `computeCost` did before #313 (every input token
 * fresh) gives 2.3063 credits/document, so 2.816 was 22% above what this corpus would have
 * shown even under the old arithmetic, and the drop to 1.1492 is 50% pricing and the rest
 * corpus. And 1.1492 lands at the bottom edge of #313's 1.15 to 1.77 band rather than
 * outside it.
 *
 * `avgSecondsPerDocument` stays 20. The measured figures are 13.6 (notebook) and 20.8
 * (section), pooling to 15.4, so 20 sits inside the measured range; and this box ran the
 * job 20 documents wide with other agents on it, which is the reason `docs/loop-cost.md`
 * keeps wall clock out of its tables at all. Moving a latency constant on a reading that
 * measures the box is not an improvement.
 *
 * The other six rows are still inferred, not measured - no real `import_job` row exists for
 * any of them on this deployment - from the same finding: if cost tracks steps taken rather
 * than content, and a document tends to run close to its playbook's own `stepBudget`
 * (`playbooks/*.md` frontmatter) when it has cross-document work to do, then a playbook's
 * per-document cost should scale with its `stepBudget` relative to onenote's 60, calibrated
 * by onenote's own per-step rate (1.1492 / 60 ≈ 0.01915 credits/step, 20 / 60 ≈ 0.333
 * seconds/step). `obsidian` shares onenote's exact `stepBudget: 60` and the same mandatory
 * cross-document behaviour (`SPEC.md` §6.6: "every `[[link]]` is a candidate relation", the
 * same shape as onenote's "follow every in-body link"), so it lands on exactly onenote's
 * number rather than a scaled-down one - this is the "off by roughly the factor onenote's
 * was" #272 named for the obsidian row specifically. `world-anvil` (`stepBudget: 50`) also
 * mandatorily follows inter-article links (`world-anvil.md`: "an inter-article link is a
 * candidate relation"). `kanka` (`stepBudget: 50`) follows a link only when a relation's
 * target is not in the same file - real cross-document work, just conditional rather than
 * guaranteed. `docx`, `pdf` and `generic` (`stepBudget: 40`) read one document with no
 * mandated cross-document following at all, so they get the smallest inferred number.
 *
 * **Moving onenote moved all seven, and two of the six are now tighter than a document this
 * repo has actually measured.** That is stated rather than papered over, because #272's
 * directive here is that guessing high costs a scarier estimate screen and guessing low
 * costs a job that cannot finish. Repricing `docs/loop-cost.md`'s own sweep at the cached
 * rate puts `campaign-brief.docx` at roughly 1.0 to 1.4 credits against `docx`'s new 0.7661,
 * and `kanka/characters.json` at roughly 2.8 to 3.8 against `kanka`'s new 0.9577. No margin
 * was added to hide that, for three reasons. The row a playbook needs is a real job in that
 * playbook, which `estimateAveragesForPlaybook` installs the first time one finishes. What
 * protects a job from a low estimate is not the estimate, it is
 * `IMPORT_BUDGET_HEADROOM_MULTIPLIER`, and the notebook run above is the evidence: quoted
 * 37, budgeted 222, spent 75.8718, finished. And a per-document average over a whole job is
 * not the cost of that job's most expensive document, which is what those two figures are.
 * What a low estimate does cost is a consent screen that understates, so the honest fix is
 * measuring the other six the way this one was measured, not widening a guess.
 */
const ONENOTE_STEP_BUDGET = 60;
const ONENOTE_CREDITS_PER_DOCUMENT = 1.1492;
const ONENOTE_SECONDS_PER_DOCUMENT = 20;
const ONENOTE_CREDITS_PER_STEP = ONENOTE_CREDITS_PER_DOCUMENT / ONENOTE_STEP_BUDGET;
const ONENOTE_SECONDS_PER_STEP = ONENOTE_SECONDS_PER_DOCUMENT / ONENOTE_STEP_BUDGET;

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
	// MEASURED: two real 23- and 70-document `.mht` jobs, #330's own account above.
	onenote: {
		avgCreditsPerDocument: ONENOTE_CREDITS_PER_DOCUMENT,
		avgSecondsPerDocument: ONENOTE_SECONDS_PER_DOCUMENT
	},
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
