/** issue #263: `outcome_note` is read back later, possibly by a reader whose locale is
 * not the one the job ran under, so this writes a stable machine-readable payload
 * instead of an English sentence - the reader's own `messages()` catalogue renders it
 * (`apps/web/src/lib/import/outcome-note.ts`). `v: 1` so a future reshape can tell a row
 * it does not understand from one it does. `parseOutcomeNote` below is this payload's
 * only reader; a row written before this change is not valid JSON (or is the column's
 * `''` default) and comes back as `{ kind: 'legacy', text }` - the reader falls back to
 * showing that English text verbatim rather than crashing or going blank.
 *
 * issue #467: this module is a leaf on purpose. `job-runner.ts` (and everything it pulls
 * in - `archive.ts`, `pdf.ts`, `docx.ts`, `media-store.ts`) uses Node's `Buffer`, and
 * `@canonry/import`'s only export used to be its barrel, so a browser component that
 * wanted only `parseOutcomeNote` still bundled all of that and crashed on hydration with
 * `ReferenceError: Buffer is not defined`. This file must never import anything, so a
 * client component can reach it via the package's `./outcome-note` subpath export
 * without pulling in a single line of server-only code. */
export type OutcomeNoteOffenderReason =
	| 'step_ceiling'
	| 'cancelled_before_step'
	| 'cancelled_mid_step'
	| 'tool_calls_unparseable'
	| 'step_worst_case_exceeds_budget'
	| 'job_budget_exhausted'
	| 'never_started'
	| 'model_call_failed'
	| 'loop_guard'
	| 'other';

export interface OutcomeNoteOffender {
	path: string;
	reason: OutcomeNoteOffenderReason;
	othersCount: number;
	/** `model_call_failed` only. */
	errorName?: string;
	/** `loop_guard` only. */
	toolName?: string;
	loopCount?: number;
	/** `other` only - `classifyOffenderDetail`'s fallback, the raw (English)
	 * `DocumentOutcome.detail` for a reason this catalogue does not name yet. */
	text?: string;
}

export interface OutcomeNoteLossy {
	path: string;
	count: number;
	othersCount: number;
}

/** issue #623: an import that could not keep a picture says so. `path` and `format` name
 * the first one, the way `OutcomeNoteLossy` names the first document rather than listing
 * every one; `count` is the job-wide total, so one skip and nine read the same way
 * without an unbounded sentence on a review screen. */
export interface OutcomeNoteSkippedImages {
	path: string;
	format: string;
	count: number;
}

export type OutcomeNotePayload = (
	| { kind: 'finished'; documents: number; proposals: number }
	| { kind: 'no_documents' }
	| { kind: 'unchanged'; documents: number }
	| { kind: 'stopped_no_offender'; documents: number; proposals: number }
	| { kind: 'offender'; offender: OutcomeNoteOffender }
) & {
	v: 1;
	/** Absent on `no_documents` and `unchanged` in practice, since neither ran a step
	 * that could skip an image, but carried on the shared shape rather than repeated per
	 * kind: #212's `lossy` was added to one branch at a time and the branch its author
	 * was not thinking about stayed silent. */
	lossy?: OutcomeNoteLossy;
	skippedImages?: OutcomeNoteSkippedImages;
};

export type ParsedOutcomeNote = OutcomeNotePayload | { kind: 'legacy'; text: string } | null;

/** `raw` is `import_job.outcome_note` - `''` (the column default, an unsettled or
 * no-note job) parses to `null`, valid `v: 1` JSON parses to its payload, anything else
 * (a note written before this issue) comes back as `legacy` carrying the original text. */
export function parseOutcomeNote(raw: string): ParsedOutcomeNote {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			parsed !== null &&
			typeof parsed === 'object' &&
			(parsed as { v?: unknown }).v === 1 &&
			typeof (parsed as { kind?: unknown }).kind === 'string'
		) {
			return parsed as OutcomeNotePayload;
		}
	} catch {
		// Not JSON at all - a pre-#263 note. Falls through to the legacy return below.
	}
	return { kind: 'legacy', text: raw };
}
