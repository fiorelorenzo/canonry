import { numberFormat, pluralRules } from './intl.js';
import type { Messages } from './messages.js';

export const en: Messages = {
	shell: {
		skipToContent: 'Skip to content',
		signedInAs: (name) => `Signed in as ${name}`,
		notSignedIn: 'Not signed in',
		signIn: 'Sign in',
		signUp: 'Sign up',
		signOut: 'Sign out',
		signingOut: 'Signing out…'
	},

	settings: {
		backToUniverses: '← Universes',

		appearance: {
			title: 'Appearance',
			description:
				'This is light or dark for the whole product (G1, docs/ux/DECISIONS.md): it changes the palette everywhere, table mode included. It does not change type size, density or anything else.',
			light: 'Light',
			dark: 'Dark',
			system: 'Match system',
			save: 'Save',
			error: 'Pick light, dark or match system.'
		},

		language: {
			title: 'Language',
			description:
				'The language the interface and the Loremaster speak to you in (SPEC.md §17). This is a preference on your account, so it follows you to the phone at the table - it is not the language your canon is written in, which stays whatever each entry was written in.',
			signInPrompt: 'Sign in to save a language preference to your account.',
			signInLink: 'Sign in',
			save: 'Save',
			saved: 'Saved.',
			error: 'Pick a language from the list.'
		},

		billing: {
			title: 'Billing',
			description:
				'Included quota with routing between cheap and premium models. No opaque credits, and no plan here is ever called "unlimited" - every plan states a real ceiling (SPEC.md §15).',
			signInPrompt: 'Sign in to see your plan and balance.',
			signInLink: 'Sign in',
			checkoutCancelled: 'Checkout was cancelled - your plan has not changed.',
			currentPlan: (planName) => `Current plan: ${planName}`,
			renews: (date) => `Renews ${date}`,
			noRenewalDate: 'No renewal date on record yet.',
			includedThisPeriod: 'Included this period',
			purchased: 'Purchased (never expires)',
			warmBudget: 'Warm budget',
			// `maximumFractionDigits: 0`: `subscription_credits` is a NUMERIC(_,4) column
			// (partial credits accrue from metered usage), but nobody reads "160.4672
			// credits" as a quota - the original pre-catalogue code rounded to whole
			// credits too. `useGrouping: 'always'` rather than the locale default ("auto",
			// which under real CLDR data only groups it-IT from 10,000 up): SPEC.md §17's
			// own example ("2.400" vs "2,400") is a 4-digit quota, and a credits panel
			// that groups in English but not in Italian at the same magnitude is the exact
			// bug this issue exists to prevent.
			creditsCount: (count) => {
				const n = numberFormat('en', { maximumFractionDigits: 0, useGrouping: 'always' }).format(
					count
				);
				const form = pluralRules('en').select(Math.round(count));
				return form === 'one' ? `${n} credit` : `${n} credits`;
			},
			plansHeading: 'Plans',
			perMonth: '/month',
			currentPlanBadge: 'Current plan',
			switchTo: (planName) => `Switch to ${planName}`
		}
	},

	auth: {
		signIn: {
			title: 'Sign in',
			subtitle: "Your universes, your account, nobody else's.",
			emailLabel: 'Email',
			passwordLabel: 'Password',
			submit: 'Sign in',
			submitting: 'Signing in…',
			noAccount: 'No account yet?',
			signUpLink: 'Sign up',
			orDivider: 'or',
			continueWith: (provider) => `Continue with ${provider}`
		},
		signUp: {
			title: 'Sign up',
			subtitle: 'One account, your own universes.',
			nameLabel: 'Name',
			emailLabel: 'Email',
			passwordLabel: 'Password',
			submit: 'Sign up',
			submitting: 'Creating account…',
			haveAccount: 'Already have an account?',
			signInLink: 'Sign in',
			orDivider: 'or',
			continueWith: (provider) => `Continue with ${provider}`
		},
		languageSwitcher: {
			label: 'Language'
		}
	},

	players: {
		wikiLabel: "Players' wiki",
		notDiscovered: 'Not yet discovered',
		revealed: 'Revealed',
		indexTitle: 'Everything the table has touched',
		indexSubtitle:
			'If it came up at the table, it is here. A name in grey has been heard but not yet explored.',
		emptyState: 'Nothing has been said aloud yet.',
		gapNoticeBefore: 'You have heard the name. Nobody at the table has learned enough about',
		gapNoticeAfter: (type) => `for this ${type} page to say more; yet.`,
		factsHeading: "What's known",
		relationsHeading: 'Known relations'
	}
};
