/**
 * The one shape `en.ts` and `it.ts` both have to satisfy, written down explicitly rather
 * than inferred from either of them. That is what makes a missing key a typecheck
 * failure: `export const it: Messages = {...}` is checked against *this* interface, so
 * `it.ts` forgetting a key `en.ts` has does not compile, and neither does adding one
 * neither locale's copy has yet.
 *
 * A leaf is either a plain string or a function. A function leaf is how interpolation
 * stays typed instead of a runtime string-template lookup: `signedInAs(name: string)`
 * cannot be called with a number, and `creditsCount(count: number)` cannot be called
 * with a string - both fail at the call site, at compile time, in whichever locale
 * wrote the wrong signature.
 *
 * One namespace per surface this issue owns (SPEC.md §17, issue #120): `shell` (chrome
 * rendered on every page), `settings`, `auth`, `players` (the compact "Players' wiki"
 * chrome issue #127 asked for - see hub log). The rest of the app is issue #121's sweep,
 * not this file's job to anticipate.
 */
export interface Messages {
	shell: {
		/** The visually-hidden "skip to content" link every page starts with. */
		skipToContent: string;
		signedInAs: (name: string) => string;
		notSignedIn: string;
		signIn: string;
		signUp: string;
		signOut: string;
		signingOut: string;
	};

	settings: {
		backToUniverses: string;

		appearance: {
			title: string;
			description: string;
			light: string;
			dark: string;
			system: string;
			save: string;
			error: string;
		};

		language: {
			title: string;
			description: string;
			signInPrompt: string;
			signInLink: string;
			save: string;
			saved: string;
			error: string;
		};

		billing: {
			title: string;
			description: string;
			signInPrompt: string;
			signInLink: string;
			checkoutCancelled: string;
			currentPlan: (planName: string) => string;
			renews: (date: string) => string;
			noRenewalDate: string;
			includedThisPeriod: string;
			purchased: string;
			warmBudget: string;
			/** SPEC.md §17's own example: Italian wants a decimal comma and this is where a
			 * bare noun would also mispluralise ("1 crediti") if it were not routed through
			 * `Intl.PluralRules`. */
			creditsCount: (count: number) => string;
			plansHeading: string;
			perMonth: string;
			currentPlanBadge: string;
			switchTo: (planName: string) => string;
		};
	};

	auth: {
		signIn: {
			title: string;
			subtitle: string;
			emailLabel: string;
			passwordLabel: string;
			submit: string;
			submitting: string;
			noAccount: string;
			signUpLink: string;
			orDivider: string;
			continueWith: (provider: string) => string;
		};
		signUp: {
			title: string;
			subtitle: string;
			nameLabel: string;
			emailLabel: string;
			passwordLabel: string;
			submit: string;
			submitting: string;
			haveAccount: string;
			signInLink: string;
			orDivider: string;
			continueWith: (provider: string) => string;
		};
		/** The compact switcher on the sign-in/sign-up pages (there is no account yet to
		 * hold a preference, so it sets the cookie instead - SPEC.md §17). */
		languageSwitcher: {
			label: string;
		};
	};

	/** Issue #127's players' wiki chrome. Kept minimal on purpose: PublicLanguages owns
	 * `routes/p/**` itself and asks for a key here as its own copy grows, rather than this
	 * file guessing the whole surface. */
	players: {
		wikiLabel: string;
		notDiscovered: string;
		revealed: string;
		indexTitle: string;
		indexSubtitle: string;
		emptyState: string;
		gapNoticeBefore: string;
		gapNoticeAfter: (entityType: string) => string;
		factsHeading: string;
		relationsHeading: string;
	};
}
