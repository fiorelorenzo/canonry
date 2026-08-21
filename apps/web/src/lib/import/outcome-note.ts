/**
 * issue #263: `import_job.outcome_note` (`job-runner.ts`'s `buildOutcomeNote`) is a
 * stable `{ v: 1, kind, ... }` JSON payload now, not an English sentence - it is
 * settled once, then read back later by whichever reader opens the job, possibly in a
 * different locale than the one that ran it. This is the one place that turns the
 * payload back into a sentence, in the *reader's* locale, at display time - both the
 * onboarding job status page and the review surface's status banner call this rather
 * than rendering `job.outcomeNote` directly.
 *
 * A note written before this issue shipped is not valid `v: 1` JSON - `parseOutcomeNote`
 * comes back with `{ kind: 'legacy', text }`, and this renders that text verbatim rather
 * than crashing or going blank. The empty-string column default parses to `null`, which
 * this also returns as `null` so callers keep their existing `{#if outcomeNote}` guard.
 */
import { parseOutcomeNote, type OutcomeNoteOffenderReason } from '@canonry/import/outcome-note';
import { messages, type Locale, type Messages } from '$lib/i18n';

type OffenderReasonCatalogue = Messages['import']['outcomeNote']['offenderReason'];

function offenderReasonText(
	catalogue: OffenderReasonCatalogue,
	offender: {
		reason: OutcomeNoteOffenderReason;
		errorName?: string;
		toolName?: string;
		loopCount?: number;
		text?: string;
	}
): string {
	switch (offender.reason) {
		case 'model_call_failed':
			return catalogue.model_call_failed(offender.errorName ?? '');
		case 'loop_guard':
			return catalogue.loop_guard(offender.toolName ?? '', offender.loopCount ?? 0);
		case 'other':
			return catalogue.other(offender.text ?? '');
		default:
			return catalogue[offender.reason];
	}
}

export function renderOutcomeNote(locale: Locale, raw: string): string | null {
	const parsed = parseOutcomeNote(raw);
	if (parsed === null) return null;
	if (parsed.kind === 'legacy') return parsed.text || null;

	const t = messages(locale).import.outcomeNote;
	let base: string;
	switch (parsed.kind) {
		case 'finished':
			base = t.finished(parsed.documents, parsed.proposals);
			break;
		case 'no_documents':
			return t.noDocuments;
		case 'unchanged':
			return t.unchanged(parsed.documents);
		case 'stopped_no_offender':
			base = t.stoppedNoOffender(parsed.documents, parsed.proposals);
			break;
		case 'offender': {
			const reasonText = offenderReasonText(t.offenderReason, parsed.offender);
			const offenderLine = t.offender(parsed.offender.path, reasonText);
			base =
				parsed.offender.othersCount > 0
					? t.offenderWithOthers(offenderLine, parsed.offender.othersCount)
					: offenderLine;
			break;
		}
	}

	if (!parsed.lossy) return base;
	const lossyLine = t.lossy(parsed.lossy.path, parsed.lossy.count);
	const lossyText =
		parsed.lossy.othersCount > 0
			? t.lossyWithOthers(lossyLine, parsed.lossy.othersCount)
			: lossyLine;
	return `${base}; ${lossyText}`;
}
