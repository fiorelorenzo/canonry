/**
 * Issue #453 (U7): the read half of this route. `+server.ts` beside this file answers
 * `Accept: application/json` (`$lib/proposals/inline.ts`'s `fetchCandidate`, used by the
 * entry page, Ask and the Loremaster panel to review a proposal in place); a plain
 * browser navigation - `Accept: text/html`, what a click on a link produces - is
 * content-negotiated to this page instead, the same split `ask/+server.ts` already
 * relies on for its own POST stream versus a page navigation.
 *
 * The reason this page exists at all: `HistoryPanel.svelte` now links every revision
 * that came from an accepted proposal back to it (`revision.proposal_id`), and until this
 * issue nothing rendered that id as a page - guardrail 3 says a proposal shows its
 * evidence, and a settled one that nobody can open again shows nothing. This is the
 * smallest thing that shows it: the same enriched candidate the inbox queue renders,
 * read-only, reachable at the URL the id already pointed at.
 *
 * `reviewableProposalById` carries no outcome filter despite its name (see its own
 * comment in `$lib/server/proposals.ts`) - accepted, rejected and still-pending proposals
 * all resolve the same way, so a settled proposal needs no second query here.
 *
 * Issue #468: a candidate can also be `awaitingDiff` - `patch = {}`, C3's checklist gate,
 * before the GM has paid to generate it. `+page.svelte` needs the real per-diff price to
 * say so honestly, the same number the plan page's own `estimatedCredits` is built from
 * (`propagate.diff` in `operation_price`) - never `estimatedCredits` divided by candidate
 * count, which `planPropagation` never computed that way to begin with.
 */
import { error } from '@sveltejs/kit';
import { priceOf, universeAccessBySlug } from '@canonry/db';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import { reviewableProposalById } from '$lib/server/proposals';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const t = messages(locals.locale);
	if (!locals.user) error(404, t.entry.errors.universeNotFound(params.universe));
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, t.entry.errors.universeNotFound(params.universe));

	const candidate = await reviewableProposalById(conn, access.universe.id, params.proposal);
	if (!candidate) error(404, t.proposals.errors.proposalNotFound);

	const diffPriceCredits = candidate.awaitingDiff
		? (await priceOf(conn, 'propagate.diff')).credits
		: null;

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		candidate,
		diffPriceCredits,
		locale: locals.locale
	};
};
