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
import { and, count, desc, eq, inArray, type Db } from '@canonry/db';
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
 * replaces a cold-start row with the average of up to twenty real jobs, and it fires:
 * #330 watched it three times, and #606 watched a five-document generic upload get quoted 5
 * credits off the previous generic job's real 0.9944 rather than off the cold-start row. So
 * for a playbook whose jobs settle usefully, a wrong constant misprices exactly one job per
 * deployment, and that is the frame this table should be read in. It does not deserve another
 * decimal place, and it does deserve not being a guess.
 *
 * That frame did not hold for a playbook whose jobs keep hitting a ceiling, which is what
 * #610 fixed. The query used to filter `status = 'finished'`, and #606's own obsidian job
 * settled `stopped_at_ceiling` because 2 of its 35 documents reached their step ceiling, so
 * 30.3658 credits of real evidence installed no history at all and the next obsidian import
 * on that deployment would have been quoted off this row again, and the one after that, for
 * as long as its jobs kept running out of steps. The jobs that filter excluded were also the
 * dearest ones, so what history a deployment did learn was biased cheap. `HISTORY_EVIDENCE`
 * below is the status-by-status answer that replaced it.
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
 * Issue #610, and the whole of it: which `import_job` rows say anything about what a
 * document costs. Asked one status at a time rather than looked for a flag to widen,
 * because the answers are not symmetric and two different stops share one status.
 *
 *   status              evidence  why
 *   queued              no        nothing ran; `spent_credits` is 0 by construction.
 *   running             no        mid-flight. The spend so far is a prefix of the job's
 *                                real spend and `finished_at` is null, so pooling it is
 *                                the one shape of this arithmetic guaranteed to read low.
 *   finished            yes       every document reached a terminal outcome and none was
 *                                cut short. The case the query has always taken.
 *   stopped_at_ceiling  yes       over the documents that actually ran, not over
 *                                `document_count`. See below: it is two stops, not one.
 *   cancelled           no        a GM's click or this job's own wall-clock timeout
 *                                aborted it mid-step. The ratio would be a number about
 *                                when somebody clicked.
 *   failed              no        a model call failed and the document stopped where the
 *                                error was. The credits are real, but an error arrives
 *                                early far more often than late (a bad credential, a
 *                                schema the model cannot fill), so the ratio reads low
 *                                for a reason that has nothing to do with cost.
 *
 * **`stopped_at_ceiling` is two stops wearing one status, and they are opposite cases.**
 * A *per-document step ceiling* (`gateway-driver.ts` exhausting `playbook.stepBudget`)
 * leaves every document of the job run: the numerator is honest, the denominator is
 * honest, and the documents that hit the ceiling spent the most steps a document is
 * allowed, so they are the dearest documents the job had rather than truncated cheap
 * ones. Pooling that job can only push the average up. A *job-wide credit ceiling*
 * (`startJob`'s outer loop returning once `budget.exceeded()`) is the opposite: the
 * documents it never started cost nothing and are still counted in `document_count`, so
 * dividing by `document_count` would produce a number about our own budget rather than
 * about a document.
 *
 * **Counting documents rather than jobs is what makes both cases usable**, which is the
 * other half of #610. Issue #27 checkpoints one entry per document that reaches a
 * terminal outcome, so the checkpoint's own entries are exactly the documents a job's
 * spend is attributable to, and their absence is exactly how `job-runner.ts` tells the
 * two ceilings apart in the first place ("detecting that silence... is what tells the two
 * apart from a clean finish"). Dividing by them rather than by `document_count` needs no
 * new column and no `outcome_note` JSON in a `where`, and it is never the optimistic
 * choice: the count it uses is at most `document_count`, so every figure this function
 * returns is at or above the figure a naive widening of the filter would have returned.
 *
 * **What the checkpoint does not record, stated rather than worked around.** It carries
 * each document's *status* and not its *cost*, so there is no way to average over only
 * the documents that completed and leave the truncated ones out; the truncated ones are
 * pooled in, which is safe here only because a document truncated by a step ceiling is
 * the dearest kind. Per-document credits are what would close that, and they would also
 * make this whole function exact rather than careful; `credit_transaction`'s
 * `import-document:<job>:<doc>` rows look like the answer and are not, since they are
 * written only with a `userId` and only when the document proposed something.
 *
 * **A skipped document is no longer one of those cases** (issue #620). It used to be
 * checkpointed `finished` exactly like one that ran, so a partial re-import (a GM changes
 * three pages of forty and imports again) divided its real spend by all forty and read
 * low, which is the direction this file says not to err in. `spentCredits > 0` per row
 * caught only the whole-job version of that, where nothing changed and the job spent
 * nothing. `job-runner.ts` now writes `skipped_unchanged` instead, which this function
 * subtracts from a `finished` job's `document_count` and simply does not count for a
 * ceiling-stopped one. Two honest limits on that. A row written before #620 still says
 * `finished`, so history already on a deployment keeps the old bias until it ages out of
 * the twenty-row window. And the subtraction is per document and not per credit: a job
 * that skipped thirty-seven documents and ran three is now divided by three, which is
 * right, but a document that ran and proposed nothing still counts as a document.
 */
export const HISTORY_EVIDENCE_STATUSES = ['finished', 'stopped_at_ceiling'] as const;

/** Why a job of this playbook was passed over. Reported, never silent: #610's real
 * complaint is that nothing anywhere said a playbook's history was empty because its jobs
 * kept stopping. */
export type PlaybookHistoryExclusion =
	'not_settled' | 'cancelled' | 'failed' | 'no_documents_ran' | 'no_spend';

export interface PlaybookEstimateBasis {
	/** `'history'` when the two figures came from real rows, `'cold_start'` when they came
	 * from `PLAYBOOK_COLD_START_ESTIMATE` above. */
	source: 'history' | 'cold_start';
	/** Jobs pooled, and the documents those jobs actually ran. Both 0 on a cold start. */
	jobsPooled: number;
	documentsPooled: number;
	/** Filled in only on a cold start that is not a first import, so a reader knows the
	 * history is empty because jobs were passed over and knows which reason to go and look
	 * at. Empty on the history path and on a genuine first import. */
	ignored: readonly { reason: PlaybookHistoryExclusion; jobs: number }[];
}

export interface PlaybookAverages {
	avgCreditsPerDocument: number;
	avgSecondsPerDocument: number;
	basis: PlaybookEstimateBasis;
}

export type EstimateBasisSink = (entry: PlaybookEstimateBasis & { playbookId: string }) => void;

/** One line, on the `channel` convention `logging.ts` uses, emitted only when a playbook
 * has run jobs and still has nothing to quote off. Not a metric and not a throw: the
 * estimate is still correct, it is just still a constant, and that is the fact that used
 * to be invisible. */
function warnHistoryEmpty(entry: PlaybookEstimateBasis & { playbookId: string }): void {
	console.warn(
		JSON.stringify({
			channel: 'import_estimate',
			event: 'history_empty_but_jobs_ran',
			playbookId: entry.playbookId,
			ignored: entry.ignored
		})
	);
}

/** The document statuses `job-runner.ts` checkpoints. Its `CheckpointShape` is private to
 * that module and #613 owns it, so this reads the column narrowly rather than importing a
 * shape across a boundary; `estimate-history.test.ts` drives the real runner to a real
 * ceiling and reads the checkpoint it really wrote, so the two cannot drift silently. */
const TERMINAL_DOCUMENT_STATUSES: Record<string, true> = {
	finished: true,
	stopped_at_ceiling: true,
	cancelled: true,
	failed: true
};

/** Counts checkpoint entries by whether they name a terminal document status and whether
 * they name a skipped one. `checkpoint` is a `jsonb` column whose shape this module does
 * not own, so every level is narrowed rather than asserted: a column the runner never
 * wrote, or wrote in a shape this function does not recognise, has to come back as zero
 * documents and exclude the job, never as a confident small number that would read as an
 * expensive document. */
function checkpointedDocuments(checkpoint: unknown): { ran: number; skipped: number } {
	const none = { ran: 0, skipped: 0 };
	if (typeof checkpoint !== 'object' || checkpoint === null || !('documents' in checkpoint)) {
		return none;
	}
	const documents = checkpoint.documents;
	if (typeof documents !== 'object' || documents === null) return none;
	let ran = 0;
	let skipped = 0;
	for (const entry of Object.values(documents)) {
		if (typeof entry !== 'object' || entry === null || !('status' in entry)) continue;
		const status = entry.status;
		if (typeof status !== 'string') continue;
		if (TERMINAL_DOCUMENT_STATUSES[status]) ran += 1;
		// `skipped_unchanged` is terminal for the runner and not evidence here: a document
		// skipped because it was unchanged since the last import (issue #36) never reached a
		// driver and so cost nothing (issue #620). Its deliberate absence from the table
		// above is what makes a ceiling-stopped partial re-import right for free.
		else if (status === 'skipped_unchanged') skipped += 1;
	}
	return { ran, skipped };
}

/** Issue #790: how many of a job's documents the checkpoint already accounts for,
 * settled or skipped, as one number a live progress display can show without decoding
 * checkpoint's shape itself - it stays this package's own, per `checkpointedDocuments`'
 * own doc comment above. */
export function importJobDocumentsSettled(checkpoint: unknown): number {
	const { ran, skipped } = checkpointedDocuments(checkpoint);
	return ran + skipped;
}

/**
 * `job-runner.ts`'s `EstimateImportJobInput` doc comment: "historical average, supplied
 * by the caller... never invented here." A cold start (nobody has run this playbook on
 * this deployment yet) falls back to `PLAYBOOK_COLD_START_ESTIMATE` above; once real
 * settled `import_job` rows exist for a playbook, they replace the cold-start default
 * entirely, because a job in this deployment's own worlds is better evidence than a job in
 * ours.
 *
 * Which rows count and why is `HISTORY_EVIDENCE_STATUSES`' doc comment above. The window
 * is deliberately the last twenty *evidence-eligible* rows rather than the last twenty
 * rows: a burst of cancellations must not push a real measurement out of the window, which
 * is the regression a plain "read every terminal status" query would have introduced. The
 * second query, which counts what was passed over, only runs when the first found nothing
 * usable, so the common path is still one round trip.
 */
export async function estimateAveragesForPlaybook(
	database: Db,
	playbookId: string,
	options: { sink?: EstimateBasisSink } = {}
): Promise<PlaybookAverages> {
	const coldStart = PLAYBOOK_COLD_START_ESTIMATE[playbookId] ?? UNMEASURED_PLAYBOOK_ESTIMATE;

	const rows = await database
		.select({
			status: importJob.status,
			documentCount: importJob.documentCount,
			spentCredits: importJob.spentCredits,
			checkpoint: importJob.checkpoint,
			startedAt: importJob.startedAt,
			finishedAt: importJob.finishedAt
		})
		.from(importJob)
		.where(
			and(
				eq(importJob.playbook, playbookId),
				inArray(importJob.status, [...HISTORY_EVIDENCE_STATUSES])
			)
		)
		.orderBy(desc(importJob.createdAt))
		.limit(20);

	// The two reasons a row inside the window can still be passed over. Counted rather
	// than dropped, because #610's complaint is about silence and not about arithmetic.
	let noDocumentsRan = 0;
	let noSpend = 0;
	let jobsPooled = 0;
	let totalDocs = 0;
	let totalCredits = 0;
	let timedDocs = 0;
	let totalSeconds = 0;
	for (const row of rows) {
		const checkpointed = checkpointedDocuments(row.checkpoint);
		// A `finished` job ran every document it enumerated except the ones it skipped as
		// unchanged, so `document_count` is the denominator minus those (issue #620). A
		// checkpoint this function failed to parse still cannot silently shrink it: an
		// unreadable column subtracts nothing, which is the same denominator #610 used. A
		// ceiling-stopped job counts its terminal entries instead, and `skipped_unchanged`
		// is not one of them, so the same subtraction happens there by omission.
		const ran =
			row.status === 'finished'
				? Math.max(row.documentCount - checkpointed.skipped, 0)
				: Math.min(checkpointed.ran, row.documentCount);
		if (ran <= 0) {
			noDocumentsRan += 1;
			continue;
		}
		// A job that spent nothing over real documents is not evidence that a document is
		// cheap: it is a re-import whose documents were all unchanged (issue #36 skips them
		// before the driver sees them), or a ceiling that refused the very first step. Both
		// used to be pooled, and both drag the average toward zero.
		if (row.spentCredits <= 0) {
			noSpend += 1;
			continue;
		}
		jobsPooled += 1;
		totalDocs += ran;
		totalCredits += row.spentCredits;
		if (row.startedAt && row.finishedAt) {
			timedDocs += ran;
			totalSeconds += (row.finishedAt.getTime() - row.startedAt.getTime()) / 1000;
		}
	}

	if (jobsPooled === 0) {
		return {
			...coldStart,
			basis: await coldStartBasis(database, playbookId, { noDocumentsRan, noSpend }, options)
		};
	}

	return {
		avgCreditsPerDocument: totalCredits / totalDocs,
		// A row with no wall clock recorded contributes no seconds, so it must not
		// contribute documents to this denominator either - it used to, which pulled the
		// figure down, and this file's rule is that wall clock is raised on evidence and
		// never lowered on it.
		avgSecondsPerDocument:
			timedDocs > 0 && totalSeconds > 0
				? totalSeconds / timedDocs
				: coldStart.avgSecondsPerDocument,
		basis: { source: 'history', jobsPooled, documentsPooled: totalDocs, ignored: [] }
	};
}

/** The diagnosis for the case #610 is really about: this playbook is quoting off a
 * constant, and it is not because nobody has run it. Counts the statuses the pooling
 * window never saw (`cancelled`, `failed`, and anything not settled) and merges them with
 * the rows the window saw and passed over, then says so once. */
async function coldStartBasis(
	database: Db,
	playbookId: string,
	inWindow: { noDocumentsRan: number; noSpend: number },
	options: { sink?: EstimateBasisSink }
): Promise<PlaybookEstimateBasis> {
	const byStatus = await database
		.select({ status: importJob.status, jobs: count() })
		.from(importJob)
		.where(eq(importJob.playbook, playbookId))
		.groupBy(importJob.status);

	const merged = new Map<PlaybookHistoryExclusion, number>();
	if (inWindow.noDocumentsRan > 0) merged.set('no_documents_ran', inWindow.noDocumentsRan);
	if (inWindow.noSpend > 0) merged.set('no_spend', inWindow.noSpend);
	for (const row of byStatus) {
		const reason: PlaybookHistoryExclusion | null =
			row.status === 'cancelled'
				? 'cancelled'
				: row.status === 'failed'
					? 'failed'
					: row.status === 'queued' || row.status === 'running'
						? 'not_settled'
						: null;
		if (!reason) continue;
		merged.set(reason, (merged.get(reason) ?? 0) + row.jobs);
	}

	const basis: PlaybookEstimateBasis = {
		source: 'cold_start',
		jobsPooled: 0,
		documentsPooled: 0,
		ignored: [...merged].map(([reason, jobs]) => ({ reason, jobs }))
	};
	if (basis.ignored.length > 0) (options.sink ?? warnHistoryEmpty)({ ...basis, playbookId });
	return basis;
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
