/**
 * `/settings/billing/webhook`: the Stripe delivery target (issue #91). No page sibling on
 * purpose - this is a machine endpoint, not a screen a signed-in account visits, so it
 * gets no `+page.svelte` for SvelteKit to have to disambiguate against (the same reason
 * `/settings/export/[universe]` has none).
 *
 * `error()`/`json()` status codes follow Stripe's own retry contract
 * (docs.stripe.com/webhooks): 2xx acknowledges (including "verified but not an event type
 * we act on"), 4xx tells Stripe not to bother retrying (a signature that will never
 * verify), 5xx asks for a retry (something on this end needs fixing, and the delivery
 * might still succeed next time).
 */
import { error, json } from '@sveltejs/kit';
import { InvalidWebhookSignatureError } from '$lib/server/billing/provider';
import { MalformedStripeEventError } from '$lib/server/billing/stripe-events';
import { receiveWebhook } from '$lib/server/billing/subscription';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const rawBody = await request.text();
	const signature = request.headers.get('stripe-signature');

	try {
		const outcome = await receiveWebhook(rawBody, signature);
		return json({ received: true, handled: outcome.handled });
	} catch (err) {
		if (err instanceof InvalidWebhookSignatureError) {
			// Stripe should not retry a signature that will never verify.
			error(400, err.message);
		}
		if (err instanceof MalformedStripeEventError) {
			// A real bug on this end (a field this deployment expected is missing) - ask
			// Stripe to retry while it gets fixed, rather than silently dropping a payment's
			// credit grant.
			error(500, err.message);
		}
		throw err;
	}
};
