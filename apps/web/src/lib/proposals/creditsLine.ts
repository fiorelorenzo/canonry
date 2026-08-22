/**
 * Issue #572: which credits line the plan checklist shows is a fact about the plan's
 * trigger, and this is the one place that says so.
 *
 * The page used to introduce a single figure as "Est. N credits to generate diffs" for
 * every trigger but `save`, which is wrong twice on an audit plan: a flag is fully drafted
 * and charged the moment `runAudit` finds it (`packages/copilot/src/audit.ts`), so there is
 * no diff-generation step ahead of it and nothing left to estimate. #508 made the figure
 * itself honest, what the still-open candidates are worth, moved by every accept, reject
 * and drop; the sentence around it stayed forward-looking. Guardrail 5 and SPEC.md §15's
 * "no opaque credits": a charge labelled as an estimate is what makes a quota feel
 * dishonest.
 *
 * A total record over `proposal_trigger`, the same shape and for the same reason as #508's
 * `PER_CANDIDATE_OPERATION` (`packages/db/src/queries/proposals.ts`): a seventh trigger
 * fails to compile here until somebody says which of the three lines it reads, rather than
 * silently inheriting the wrong sentence the way `audit` did.
 *
 * The three lines:
 *
 * - `perDiff` is `save` alone, the one trigger whose candidates still have a real "generate
 *   diffs" step ahead of them, so its figure genuinely is an estimate. It keeps #489's
 *   reconciling count x price breakdown plus the plan-level ranking charge.
 * - `spent` is every trigger `PER_CANDIDATE_OPERATION` prices per candidate and whose
 *   candidates are written already drafted and already paid for: an audit flag, a
 *   completion, an Ask draft. The figure is money already gone, and it falls as the GM
 *   settles what is open.
 * - `chargedElsewhere` is the two triggers priced per something other than a candidate (a
 *   document for an import, the action itself in table mode), so a plan's stored figure is
 *   zero by construction and no number on this line would be true. One sentence, no
 *   figure - never a bold zero.
 */
import type { ProposalTrigger } from '@canonry/db/schema';
import type { PlanChargedElsewhereTrigger, PlanSpentTrigger } from '$lib/i18n/messages';

export type PlanCreditsLine =
	| { kind: 'perDiff' }
	| { kind: 'spent'; trigger: PlanSpentTrigger }
	| { kind: 'chargedElsewhere'; trigger: PlanChargedElsewhereTrigger };

export const PLAN_CREDITS_LINE: Record<ProposalTrigger, PlanCreditsLine> = {
	save: { kind: 'perDiff' },
	audit: { kind: 'spent', trigger: 'audit' },
	complete: { kind: 'spent', trigger: 'complete' },
	ask: { kind: 'spent', trigger: 'ask' },
	table: { kind: 'chargedElsewhere', trigger: 'table' },
	import: { kind: 'chargedElsewhere', trigger: 'import' }
};
