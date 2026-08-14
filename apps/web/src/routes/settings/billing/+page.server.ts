/**
 * `/settings/billing`: plan, period and both balances (issue #91's acceptance
 * criteria). The plan catalogue's stated ceilings live in `@canonry/db`'s
 * `SUBSCRIPTION_PLANS` - SPEC.md §15 forbids "unlimited", so every plan card renders a
 * real number, never a marketing word.
 */
import { fail, redirect } from '@sveltejs/kit';
import { SUBSCRIPTION_PLANS } from '@canonry/db';
import { billingSummaryFor, startCheckout } from '$lib/server/billing/subscription';
import { MissingStripeEnvError } from '$lib/server/billing/provider';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) return { signedIn: false as const, plans: SUBSCRIPTION_PLANS };

	const summary = await billingSummaryFor(locals.user.id);
	return {
		signedIn: true as const,
		plans: SUBSCRIPTION_PLANS,
		balance: summary.balance,
		plan: summary.plan,
		checkout: url.searchParams.get('checkout')
	};
};

export const actions: Actions = {
	checkout: async ({ request, locals, url }) => {
		if (!locals.user) return fail(401, { error: 'Sign in to change plans.' });

		const formData = await request.formData();
		const planId = formData.get('planId');
		if (typeof planId !== 'string' || !SUBSCRIPTION_PLANS.some((plan) => plan.id === planId)) {
			return fail(400, { error: 'Pick a real plan.' });
		}
		if (planId === 'free') {
			return fail(400, {
				error: 'The free plan needs no checkout - cancel your paid plan instead to return to it.'
			});
		}

		try {
			const session = await startCheckout(locals.user.id, planId, url.origin);
			redirect(303, session.url);
		} catch (err) {
			if (err instanceof MissingStripeEnvError) {
				return fail(503, {
					error:
						'Payments are not configured on this deployment yet (issue #91 - no Stripe account on this box). Checkout cannot start until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set.'
				});
			}
			throw err;
		}
	}
};
