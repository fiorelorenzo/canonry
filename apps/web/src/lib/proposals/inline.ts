/**
 * Issue #345: the client half of reviewing a proposal where it was born. One module so the
 * entry page, the Ask route and the Loremaster panel all talk to
 * `/w/<universe>/review/<proposalId>` the same way, rather than each growing its own fetch
 * with its own error handling and its own idea of what the endpoint returns.
 *
 * Every call names exactly one proposal, because the endpoint's URL carries exactly one
 * (guardrail 1: see the route's own comment). There is deliberately no `decideMany` here,
 * and adding one would mean adding a route that accepts a list, which is the thing this
 * shape exists to make impossible to reach for.
 */
import { z } from 'zod';
import type { DiffCandidateView } from '$lib/components/proposals/ProposalDiffCard.svelte';

export type InlineDecision = 'accept' | 'reject' | 'reason' | 'undo';

export class InlineReviewError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InlineReviewError';
	}
}

/** SvelteKit's `error()` answers with `{ message }`, which is the only field this layer
 * shows; anything else (a proxy's HTML, a dropped connection) falls back to the status
 * line rather than rendering a blank error. */
const failureSchema = z.object({ message: z.string().min(1) });

/** The candidate itself is not re-validated here: it is the same object
 * `$lib/server/proposals.ts` built for the queue, serialized straight out of this app's
 * own endpoint, and `ProposalDiffCard` is the one place its shape is described. */
const candidateSchema = z.object({ candidate: z.unknown() });

async function failureMessage(response: Response): Promise<string> {
	const parsed = failureSchema.safeParse(await response.json().catch(() => null));
	return parsed.success ? parsed.data.message : `${response.status} ${response.statusText}`;
}

function reviewUrl(universeSlug: string, proposalId: string): string {
	return `/w/${encodeURIComponent(universeSlug)}/review/${encodeURIComponent(proposalId)}`;
}

export async function fetchCandidate(
	universeSlug: string,
	proposalId: string
): Promise<DiffCandidateView> {
	const response = await fetch(reviewUrl(universeSlug, proposalId), {
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new InlineReviewError(await failureMessage(response));
	const { candidate } = candidateSchema.parse(await response.json());
	return candidate as DiffCandidateView;
}

export async function decideProposal(
	universeSlug: string,
	proposalId: string,
	action: InlineDecision,
	reason?: string
): Promise<void> {
	const response = await fetch(reviewUrl(universeSlug, proposalId), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(reason === undefined ? { action } : { action, reason })
	});
	if (!response.ok) throw new InlineReviewError(await failureMessage(response));
}
