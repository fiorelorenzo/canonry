import type { OutcomeNoteOffenderReason } from '@canonry/import';

/** `detectSource`'s (`$lib/server/onboarding.ts`) per-request detection detail, issue
 * #263: composed server-side but never stored, so it travels as data rather than as an
 * already-English sentence and is rendered in the reader's locale here, exactly like
 * every other string on the upload/confirm screen. One variant per `detectSource`
 * branch. */
export type DetectedDetail =
	| { kind: 'obsidian'; notes: number }
	| { kind: 'obsidian-unsure'; markdownFiles: number }
	| { kind: 'kanka'; jsonFiles: number }
	| { kind: 'world-anvil' }
	| { kind: 'onenote'; pages: number }
	| { kind: 'pdf' }
	| { kind: 'docx' }
	| { kind: 'generic'; files: number };

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
 * chrome issue #127 asked for - see hub log), `docsLanguages` (issue #131's "what we
 * translate" doc). The rest of the app is issue #121's sweep, not this file's job to
 * anticipate.
 */
export interface Messages {
	/** #196 (decision L1): the ten shipped relation types' catalogue strings, keyed on
	 * `relation_type.key` (#195) rather than the stored label, with both directions -
	 * a relation reads as its label from one end and its inverse from the other, exactly
	 * like `diffCard.entityTypeLabel` is keyed on a fixed enum. One shared definition
	 * rather than one copy per section (unlike `entityTypeLabel`'s existing duplication):
	 * every display site - the entry panel, the players' wiki, the settings catalogue and
	 * its dialogs, the proposal diff card - resolves through this same function, so the
	 * forty strings are written once. Returns `undefined` for a universe's own type,
	 * which has no catalogue entry: SPEC.md §17 rule 3 keeps canon in its own language,
	 * and guardrail 1 forbids a model rewriting a GM's words, so the caller falls back to
	 * the stored label instead of translating it. Issue #198 is where a GM's own type
	 * gets a per-locale label of its own to look up here; nothing in this shape
	 * anticipates that yet. */
	relationTypeLabel: (key: string) => { label: string; inverseLabel: string } | undefined;
	/** Issue #286 (decision O4 = B): the handful of strings the control layer itself
	 * needs, shared by every combobox in the product rather than restated once per call
	 * site. A field whose own wording is more specific than these keeps its own string
	 * (see `table.declareContext.placePlaceholder`); these are the words that would
	 * otherwise be written eight times identically. */
	controls: {
		/** Placeholder inside a combobox's search box. */
		search: string;
		/** Shown in a combobox when the query matches nothing. */
		noMatch: string;
		/** The submit button a form only shows when scripting is off, because with
		 * scripting on the choice submits itself. */
		apply: string;
		/** Issue #345: what a running model says while a generator waits on one. The label
		 * beside these comes from the caller (each generator names its own work); these two
		 * are the parts every one of them shares. */
		modelRunning: {
			/** The elapsed-seconds counter, e.g. "14s" - never an estimate of what is left. */
			elapsed: (seconds: number) => string;
			/** Added once the wait runs long, so a slow draft reads as slow rather than stuck. */
			slow: string;
		};
	};
	shell: {
		/** The visually-hidden "skip to content" link every page starts with. */
		skipToContent: string;
		signedInAs: (name: string) => string;
		notSignedIn: string;
		signIn: string;
		signUp: string;
		signOut: string;
		signingOut: string;
		/** The spec's own TL;DR sentence (SPEC.md §1) - the root layout's meta
		 * description and the door page's (#138) own visible sentence read the same
		 * catalogue entry, so there is exactly one copy to keep guardrail 7 honest. */
		tagline: string;
		/** Issue #141 (I3 = B): the sidebar's account-mode shape, with no universe
		 * selected - three places (Universes, Settings, Docs) instead of a universe's
		 * seven, looked up the same way `universe.nav` is. */
		sidebar: {
			accountNavAriaLabel: string;
			accountNav: {
				universes: string;
				settings: string;
				docs: string;
			};
			/** Issue #379, decision R4 (DECISIONS.md "Round thirteen"): the quiet row
			 * under the universe nav (Sidebar.svelte), shown only while
			 * `universeSetupItems()` (apps/web/src/lib/server/universe-setup.ts) still
			 * has something unset - never dismissible, since a dismissed warning about
			 * an unset setting would lie the moment it was dismissed. A third setting
			 * joins the count by joining that function's list, not by growing a second
			 * string here. */
			setupWarning: (count: number) => string;
		};
		/** Issue #150 (F2 = A, H1's spend rule): the shell footer's quota meter
		 * (QuotaMeter.svelte). Two lines, not one - included quota and warm budget
		 * are counted separately (SPEC.md §15) and never merge into one number.
		 * `ratio` formats "remaining / total" once for both lines (G2: tabular
		 * figures, per-locale grouping) rather than each line writing its own
		 * template. Guardrail 7 / SPEC.md §15: both totals passed to `ratio` are
		 * always a real, finite number - this namespace holds no "unlimited"
		 * string to reach for.
		 *
		 * Issue #201: each line is a button (`includedExplainLabel`/`warmExplainLabel`
		 * is its accessible name) that opens a popover explaining what that budget
		 * pays for, in product terms - the popover title reuses `includedHeading`/
		 * `warmHeading` rather than a third copy of the same word. `warmHeading`'s
		 * value is "Table prep" in English from this issue on: the label only, every
		 * `warm_*` identifier in schema and code is untouched (same split #119 settled
		 * for entry types). `renews`/`noRenewalDate` read `ShellQuota.periodEnd`, the
		 * same `balance.periodEnd` `/settings/billing` already renders - nothing here
		 * recomputes it. The popover's own link to that page reuses
		 * `shell.accountMenu.planAndCredits` rather than a fourth string naming the
		 * same destination. */
		quota: {
			includedHeading: string;
			warmHeading: string;
			ratio: (remaining: number, total: number) => string;
			includedExplainLabel: string;
			includedPopoverBody: string;
			warmExplainLabel: string;
			warmPopoverBody: string;
			renews: (date: string) => string;
			noRenewalDate: string;
		};
		/** Issue #138 (I1 = B): the signed-out door at `/`. The three outbound links
		 * reuse `auth.footer` (the same bar shape on the auth pages, #139) rather than
		 * a second copy; `signIn` reuses this namespace's own `signIn` above. */
		door: {
			createAccount: string;
			/** G10's export sentence, one line under the door's two actions. */
			exportNote: string;
		};
		/** Issue #148 (I10 = B): the phone top bar and bottom tabs PhoneNav.svelte
		 * renders below `md` - the drawer trigger (hamburger + current universe or
		 * "Canonry"), the palette icon and the account avatar link, plus the
		 * generalised E4 tab bar for universe mode. Entries/Proposals reuse
		 * `universe.nav`'s own labels rather than a second copy; `ask` and `more`
		 * have no existing short label elsewhere to reuse. */
		phoneNav: {
			openNavLabel: string;
			openNavDescription: string;
			closeNavLabel: string;
			paletteTriggerLabel: string;
			accountLabel: string;
			tabsAriaLabel: string;
			/** #285 (O3): the third tab is the Loremaster launcher rather than a link to the
			 * route, so it reads its label from `shell.quickAsk.name`. */
			more: string;
		};
		/** Issue #143 (I6 = B): the account menu that replaces the plain link wave one
		 * left as a placeholder. `docs`/`privacy` reuse `auth.footer`'s own copy and
		 * `signOut`/`signingOut` reuse this namespace's own two fields above, so each of
		 * those four words still has exactly one catalogue entry. `modelKeys` and
		 * `planAndCredits` are the menu's own wording, distinct from the pane titles
		 * (`settings.keys.title` is "API keys", `settings.billing.title` is "Billing") -
		 * the issue body names the menu rows separately from the settings sub-nav. */
		accountMenu: {
			account: string;
			language: string;
			appearance: string;
			modelKeys: string;
			planAndCredits: string;
			export: string;
		};
		/** Issue #149 (A3 = C, G3 = B): the command palette, `CommandPalette.svelte`.
		 * `dialogTitle`/`dialogDescription` are the sr-only `Dialog.Title`/
		 * `Dialog.Description` text `command-dialog.svelte` requires with no English
		 * default. `askAction`/`askHint` label the routing row A3 = C adds when a typed
		 * query classifies as a question (`question.ts`) - it never answers inline (C8,
		 * G5), only opens Ask with the question carried over. `accountSettingsAction` is
		 * the palette's own label for the account pane's action-list entry, kept out of
		 * `settings.account.title` on purpose so this namespace does not depend on I6's
		 * in-flight settings restructure. */
		palette: {
			dialogTitle: string;
			dialogDescription: string;
			closeLabel: string;
			placeholder: string;
			/** #285: the same input, docked in the Loremaster panel, where the box is the
			 * copilot's own composer rather than a router. */
			askPlaceholder: string;
			/** #416, S11: the docked composer's own send control, next to the input
			 * rather than a row below it - the accessible name on the icon-only button,
			 * and its tooltip. */
			sendLabel: string;
			/** #416, S11: dialog placement only now - the docked composer's Enter and
			 * send control do this job without a row to click. */
			askHeading: string;
			askAction: (question: string) => string;
			askHint: string;
			entriesHeading: string;
			noEntryMatches: (query: string) => string;
			loadingMessage: string;
			akaHint: (alias: string) => string;
			universesHeading: string;
			noUniverseMatches: (query: string) => string;
			actionsHeading: string;
			emptyMessage: string;
			accountSettingsAction: string;
			footerMove: string;
			footerOpen: string;
			footerClose: string;
		};

		/** Issue #285 (decision O3), amended by decisions R5 and R6 (round thirteen, #381):
		 * the launcher and the panel it expands into. The chrome wears the theme's own
		 * colours, so the name and the glyph are what say "copilot" here; these strings
		 * carry that weight. */
		quickAsk: {
			name: string;
			openLabel: string;
			closeLabel: string;
			/** R6: the sentence on the wide launcher naming what it can be asked, so the
			 * front door says what the feature is for instead of a bare pill. */
			launcherHint: string;
			context: (pageName: string) => string;
			streaming: string;
			openInAsk: string;
			/** R6: three deterministic chips picked by `quick-ask-suggestions.ts` from the
			 * route and the entity type, never from a model. They fill the composer and
			 * disappear once the conversation has a turn. */
			suggestions: {
				entry: {
					summary: (entityName: string) => string;
					/** Reads the six-value entity type, the same "one shape per type" pattern
					 * `entityTypeLabel` uses elsewhere, rather than a key per type. */
					connects: (entityType: string, entityName: string) => string;
					gaps: (entityName: string) => string;
				};
				world: {
					shape: string;
					recent: string;
					gaps: string;
				};
				proposals: {
					pending: string;
					oldest: string;
					conflicts: string;
				};
			};
		};
	};

	settings: {
		/** Issue #143 (I6 = B): the two-pane settings page's own sub-nav. */
		subNavAriaLabel: string;

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
			/** Links to `/docs/languages` (issue #131), the sentence right before the link
			 * text - the link itself reuses `docsLanguages.title` rather than a second key
			 * that would just have to say the same thing. */
			learnMorePrompt: string;
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

		/** Issue #121's sweep: the account's export page (`/settings/export`) - the two
		 * explanatory paragraphs each split around one literal, untranslated markdown
		 * token (`[[Name]]`, `visibility`) that has to render in `<code>`, matching the
		 * `players.gapNotice*` split-around-markup convention rather than storing raw
		 * HTML in a catalogue string. */
		export: {
			title: string;
			para1Before: string;
			para1After: string;
			para2Before: string;
			para2After: string;
			emptyState: string;
			downloadButton: string;
		};

		/** Issue #121's sweep: the per-provider API keys page (`/settings/keys`, decision
		 * F3 = C/B). Provider names themselves (OpenAI, Anthropic, Google, Groq, Mistral)
		 * are proper nouns and stay out of the catalogue - `labelFor()` in the component
		 * still owns that lookup. The three `infoPara*` fields are the F3 contextual
		 * sentence, each split around its own `<strong>` run the same way `export` above
		 * splits around `<code>`. */
		keys: {
			title: string;
			infoPara1Before: string;
			infoPara1Bold: string;
			infoPara1After: string;
			infoPara2Bold: string;
			infoPara2After: string;
			infoPara3Bold: string;
			infoPara3After: string;
			infoPara3Link: string;
			signInLink: string;
			signInPrompt: string;
			activeBadge: string;
			offBadge: string;
			keyEndingIn: (lastFour: string) => string;
			addedOn: (date: string) => string;
			lastUsedOn: (date: string) => string;
			neverUsedYet: string;
			turnOff: string;
			turnOn: string;
			forgetKey: string;
			replaceKeyLabel: string;
			addKeyLabel: string;
			apiKeyPlaceholder: (providerLabel: string) => string;
			replaceButton: string;
			saveButton: string;
			savedConfirmation: (lastFour: string) => string;
			addSignInRequired: string;
			addPickProvider: string;
			addPasteKey: string;
			addSaveFailedFallback: string;
			toggleSignInRequired: string;
			removeSignInRequired: string;
			unknownProvider: string;
		};

		/** Issue #143 (I6 = B): the Account pane, the settings leaf that did not exist
		 * before this issue. Name and password go through Better Auth's own client API
		 * (`authClient.updateUser`/`authClient.changePassword`) rather than a form
		 * action, so their failure text comes back from Better Auth at request time -
		 * only labels, confirmations and fallbacks live here. Issue #154: deletion is a
		 * server action instead (`?/requestDeletion`), because only the server can tell
		 * "the confirmation mail failed to send" apart from "it sent", the same
		 * distinction `auth/forgot-password`'s own action exists for - so its errors
		 * are catalogued here too, never Better Auth's own request-time text. */
		account: {
			title: string;
			description: string;
			signInPrompt: string;
			signInLink: string;
			nameLabel: string;
			nameSave: string;
			nameSaving: string;
			nameSaved: string;
			nameSaveFailedFallback: string;
			/** #262: the form action's own check, now that this control is a POST rather than a
			 * client call that could just return early on an empty field. */
			nameRequired: string;
			emailLabel: string;
			emailNote: string;
			passwordHeading: string;
			currentPasswordLabel: string;
			newPasswordLabel: string;
			passwordSave: string;
			passwordSaving: string;
			passwordSaved: string;
			passwordSaveFailedFallback: string;
			/** #262: same, on the password control. */
			passwordRequired: string;
			sessionsHeading: string;
			sessionsDescription: string;
			signOutEverywhereButton: string;
			signOutEverywhereInProgress: string;
			signOutEverywhereFailedFallback: string;
			deleteHeading: string;
			/** One-time framing above the count, before the numbers. */
			deleteIntro: string;
			/** Issue #154 acceptance: counted, not a generic warning - every table
			 * `universe.owner_user_id`'s `ON DELETE CASCADE` takes with it
			 * (`accountDeletionImpact`, `@canonry/db`). */
			deleteImpact: (impact: {
				universes: number;
				entities: number;
				revisions: number;
				proposals: number;
				images: number;
			}) => string;
			deleteExportPrompt: string;
			deleteExportLink: string;
			deletePasswordLabel: string;
			deleteButton: string;
			deleteSending: string;
			deletePasswordRequired: string;
			deleteWrongPassword: string;
			deleteSendFailed: string;
			deleteRequested: string;
		};
	};

	auth: {
		signIn: {
			title: string;
			subtitle: string;
			emailLabel: string;
			passwordLabel: string;
			/** #262: both fields empty or missing, which the browser's own `required` catches
			 * client-side and the form action has to catch again server-side. */
			credentialsRequired: string;
			/** #262: the fallback when Better Auth rejected the sign-in without a message of
			 * its own. Better Auth's message is request-time text from a library and is shown
			 * as-is when there is one. */
			signInFailed: string;
			submit: string;
			submitting: string;
			noAccount: string;
			signUpLink: string;
			orDivider: string;
			continueWith: (provider: string) => string;
			forgotPasswordLink: string;
		};
		signUp: {
			title: string;
			subtitle: string;
			nameLabel: string;
			emailLabel: string;
			passwordLabel: string;
			/** #262: same pair as `signIn`'s, on the form that creates the account. */
			fieldsRequired: string;
			signUpFailed: string;
			submit: string;
			submitting: string;
			haveAccount: string;
			signInLink: string;
			orDivider: string;
			continueWith: (provider: string) => string;
		};
		/** #151: the request-a-reset screen linked from `signIn.forgotPasswordLink`, and the
		 * screen the mail's link lands on. Both follow the same reading room shell as
		 * sign-in/sign-up (I2, #139) rather than inventing a second visual language for two
		 * screens that exist only because a password was forgotten. */
		forgotPassword: {
			title: string;
			subtitle: string;
			emailLabel: string;
			emailRequired: string;
			submit: string;
			submitting: string;
			success: string;
			sendFailed: string;
			backToSignIn: string;
		};
		resetPassword: {
			title: string;
			subtitle: string;
			newPasswordLabel: string;
			confirmPasswordLabel: string;
			/** #262: the form action's own check, for a POST that arrived with an empty field
			 * whatever the browser thought. */
			passwordRequired: string;
			submit: string;
			submitting: string;
			passwordMismatch: string;
			invalidToken: string;
			requestNewLink: string;
			success: string;
			signInLink: string;
		};
		/** Issue #154: where Better Auth's `/delete-user/callback` redirects after the
		 * emailed link actually deletes the account - the account no longer exists by
		 * the time this page renders, so it carries no form and no session check. */
		accountDeleted: {
			title: string;
			subtitle: string;
			body: string;
			homeLink: string;
		};
		/** The compact switcher on the sign-in/sign-up pages (there is no account yet to
		 * hold a preference, so it sets the cookie instead - SPEC.md §17). Lives in the
		 * footer rule on both pages (I2, #139), not the top right. */
		languageSwitcher: {
			label: string;
		};
		/** The auth pages' own footer rule (I2, #139): everything secondary that used to
		 * compete with the wordmark - the language switcher plus these three links. */
		footer: {
			whatCanonryIs: string;
			docs: string;
			privacy: string;
		};
		/** Sign-up's right pane (I2 = B, #139): the product's one trick drawn static on the
		 * sample world (docs/ux/SAMPLE-WORLD.md) - a changed sentence and the proposal it
		 * produced, marked as waiting. No accept control, guardrail 1 and 7 both apply to
		 * every word here since it is marketing copy that happens to live inside the app. */
		argument: {
			intro: string;
			aldricSentence: string;
			watchLeadPrefix: string;
			watchBefore: string;
			watchAfter: string;
			waitingBadge: string;
			evidence: string;
			disclaimer: string;
		};
	};

	/** #151: the one caller of `$lib/server/mail`'s `MailTransport.send` today - the
	 * transport itself is generic (it will carry a shared-universe invitation and an
	 * import-finished notice later), but the interface never gets a method per use, so
	 * the strings for each mail live here, one namespace per use, added as each one
	 * actually gets wired up rather than stubbed ahead of a caller. `deleteAccount` is
	 * #154's second caller, the account-deletion confirmation Better Auth's
	 * `deleteUser.sendDeleteAccountVerification` sends. */
	mail: {
		passwordReset: {
			subject: string;
			heading: string;
			body: string;
			button: string;
			linkFallback: string;
			expiryNotice: string;
			ignoreNotice: string;
		};
		deleteAccount: {
			subject: string;
			heading: string;
			body: string;
			button: string;
			linkFallback: string;
			expiryNotice: string;
			ignoreNotice: string;
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
		/** Issue #254: the published-image gallery on a revealed entity's page - only
		 * ever fed `PublicImageRow[]` already filtered to published, gm_only-excluded,
		 * revelation-confirmed images (`publicEntityBySlug`'s own `images` field), so
		 * this component carries no visibility logic of its own. */
		media: {
			heading: string;
		};
	};

	/** Issue #364: the card a mention opens on hover or on focus. Two strings, and they are
	 * two rather than one because the states they name are different: a page the table has
	 * heard of but never discovered, and a page somebody has made but not written yet. The
	 * name, the type and the opening of the body all come from the entry itself, so nothing
	 * about them belongs here. */
	mentionPreview: {
		gap: string;
		empty: string;
	};

	/** Issue #131's "what we translate" doc at `/docs/languages`, linked from
	 * `settings.language.learnMorePrompt` (SPEC.md §17). Six sections: the three rules
	 * the product keeps as a promise (interface+copilot follow you, canon keeps its own
	 * per-entry language, retrieval crosses the gap), "nothing rewrites what you wrote",
	 * and the honest limits - a GM about to trust this with years of notes reads the
	 * limits as the part that earns the trust, not the part that undercuts the pitch. */
	docsLanguages: {
		title: string;
		intro: string;
		interfaceHeading: string;
		interfaceBody: string;
		canonHeading: string;
		canonBody: string;
		namesBody: string;
		retrievalHeading: string;
		retrievalBody: string;
		noRewriteHeading: string;
		noRewriteBody: string;
		limitsHeading: string;
		limitsIntro: string;
		limitLocales: string;
		limitNoBulkTranslation: string;
		limitQuotations: string;
		limitCopilotDirection: string;
	};

	/** Issue #121's sweep: the entry page and its editor - relations, facts, media,
	 * audit flags, revision history, the mention menu, the formatting toolbar. */
	entry: {
		page: {
			editLink: string;
			aliasesLabel: (aliases: string) => string;
		};
		/** `EntryProseWithSecrets.svelte` (`lib/components/players/**`, but only ever
		 * rendered on this GM-facing entry page, never on `/p/**` - the public wiki's own
		 * chrome lives entirely under the `players` namespace above): the secret/GM-note
		 * block tags. The GM-view/player-preview control beside them is `prose` below -
		 * issue #383 split the two apart because only one of them is "the view strings"
		 * the control owns. */
		secrets: {
			hiddenBlock: string;
			gmNoteBlock: string;
		};
		/** `EntryProseWithSecrets.svelte`'s GM/player view control (#383, R8, round thirteen;
		 * #409, S4, round fourteen, replaces the Switch with a two-option `Segmented`: the old
		 * label swapped between a short and a ~4.5x longer string, which wrapped and pushed the
		 * article down every time a GM used it). `gmView`/`playersView` are the segmented
		 * control's own two option labels, both fixed length so the control's box never resizes.
		 * `viewAriaLabel` names the control for assistive tech (the options' own visible labels
		 * are not otherwise announced as a group). `gmViewDescription`/`playerPreviewActive` are
		 * the one-line sentence under the control - present, and the same single line, in both
		 * states, saying which view is showing, so nothing reflows when it changes. */
		prose: {
			gmView: string;
			playersView: string;
			viewAriaLabel: string;
			gmViewDescription: string;
			playerPreviewActive: string;
		};
		language: {
			label: string;
			autoDetect: string;
			unsure: string;
			detectedPrefix: (name: string) => string;
			detectedUnknown: string;
		};
		/**
		 * Round eleven P6 (#347) put an empty cover slot in front of a writer, and round
		 * twelve's Q5 (#366) made it ask the question instead of pointing at the Images
		 * panel: `EntryCoverPlaceholder.svelte` and the dialog it opens. A reader never
		 * receives any of these.
		 *
		 * The two paths are worded as the different acts they are. An upload is a person
		 * handing over a file and becomes the cover as soon as it is chosen; a generated
		 * image is a model's work and becomes the cover only when somebody presses "use as
		 * cover", which is the accept O2 named. The copy says so rather than making the two
		 * look like one button with two sources.
		 */
		cover: {
			placeholderAction: string;
			placeholderHint: string;
			dialogTitle: (entityName: string) => string;
			dialogHint: string;
			uploadAction: string;
			uploadHint: string;
			uploading: string;
			generateAction: string;
			/** What one cover costs, stated before the click that spends it (G11). */
			generateHint: (credits: number) => string;
			/** The sentence beside `ModelRunning`'s spinner (#345): generation is synchronous,
			 * so this wait happens inside the click that started it. */
			generateRunning: string;
			/** Above the candidate, saying in one line why there is still a button to press. */
			generatedHint: string;
			notConfigured: string;
			aiOff: string;
			cancel: string;
		};
		complete: {
			button: string;
			/** Issue #345: the sentence beside the spinner while the model drafts, in the
			 * reading flow where the proposal itself will land. It names what is being
			 * written, never how long it will take. */
			running: string;
			empty: string;
			genericFailure: string;
			aiOff: string;
		};
		/** O2 (#284): the entry aside, five collapsible sections rather than the tab strip
		 * whose fifth label used to hang off a 256px column in Italian. `sectionsAriaLabel`
		 * went with the tablist that no longer exists; native `<details>` needs no ARIA
		 * beyond the aside's own label. */
		sections: {
			ariaLabel: string;
			relations: string;
			facts: string;
			images: string;
			history: string;
			audit: string;
			/** Issue #148 (I10 = B): below `md`, B1's aside can't sit beside the document,
			 * so it moves behind this trigger into a bottom sheet instead of stacking
			 * under the prose uninvited - "reachable rather than cropped", not a second
			 * copy of the panel. It carries the same five sections with the same labels. */
			mobile: {
				trigger: string;
				closeLabel: string;
				description: string;
			};
		};
		relations: {
			empty: string;
			explanation: string;
		};
		facts: {
			empty: string;
			explanation: string;
		};
		history: {
			empty: string;
			explanation: string;
			revisionHuman: string;
			revisionAiAccepted: string;
		};
		audit: {
			empty: string;
			disclaimer: string;
			dismiss: string;
			dismissing: string;
			openBoth: string;
			toCheck: (count: number) => string;
		};
		media: {
			aiOffBanner: string;
			empty: string;
			explanation: string;
			generatedBadge: string;
			generateButton: string;
			/** Issue #408, decision S3: pickStyle() (packages/media/src/style.ts) falls through
			 * to null when the universe has no image_style row, and generation used to run
			 * anyway with nothing to inherit. Every generate/refine control shows this sentence
			 * plus a link to the settings page's image style section in the control's own
			 * place instead - never a disabled button with a tooltip. */
			noStyle: {
				notice: string;
				link: string;
			};
			candidatesSummary: (reusedFromCache: boolean, multiple: boolean) => string;
			insert: string;
			inserting: string;
			discard: string;
			styleOverrideLabel: string;
			save: string;
			cancel: string;
			genericGenerationFailedWithStatus: (status: number) => string;
			genericGenerationFailed: string;
			genericInsertFailedWithStatus: (status: number) => string;
			genericInsertFailed: string;
			styleSaveFailedWithStatus: (status: number) => string;
			genericStyleSaveFailed: string;
			dialogTitle: (entityName: string) => string;
			howManyAriaLabel: string;
			styleLabel: (modifier: string | null) => string;
			editStyle: string;
			fourOptions: string;
			oneImage: string;
			notConfigured: string;
			suggestedForCharacter: string;
			creditsLabel: (count: number) => string;
			privateHint: string;
			generateAction: string;
			generating: string;
			upload: {
				button: string;
				uploading: string;
				uploadedBadge: string;
				noFile: string;
				tooLarge: (maxMegabytes: number) => string;
				unsupportedType: string;
				typeMismatch: string;
				genericUploadFailedWithStatus: (status: number) => string;
				genericUploadFailed: string;
			};
			/** Issue #253, extended by #385: the toolbar's image button, and the pick-one
			 * mode it opens on the shared gallery (`MediaGallery.svelte`, decision R10) -
			 * the same surface full mode uses, trimmed down to picking a width and an
			 * image. Reuses several leaf strings from this same `media` object
			 * (generating, cancel, discard, generatedBadge) rather than duplicating them
			 * under this namespace. */
			inBody: {
				toolbarLabel: string;
				toolbarTitle: string;
				dialogTitle: string;
				existingHeading: string;
				emptyExisting: string;
				/** #366: this dialog could not upload at all, which left the editor's image
				 * button offering a model and an archive but not the GM's own file. The button
				 * itself reuses `entry.media.upload.button` and its errors. */
				uploadHeading: string;
				generateHeading: string;
				/** #258: this dialog always asks for `scene`, so there is no feature to pick
				 * and one price to state. It states it because the Images tab prices
				 * `portrait` and `variants` only, which leaves this the sole surface where a
				 * GM can see what an in-body image costs before spending. */
				sceneCost: (credits: number) => string;
				sceneNotConfigured: string;
				generateButton: string;
				insertThisImage: string;
				useThisOne: string;
				generateFailedWithStatus: (status: number) => string;
				generateFailed: string;
				attachFailedWithStatus: (status: number) => string;
				attachFailed: string;
				/** R9, round thirteen (#384): the three widths offered when an image is
				 * inserted - a third, two thirds, full - never a pixel value. */
				width: {
					heading: string;
					ariaLabel: string;
					third: string;
					twoThirds: string;
					full: string;
				};
			};
			/** Issue #255: refine a candidate with an instruction instead of a fresh roll -
			 * the "Refine with instruction" control, opening GenerateDialog in its
			 * regenerate mode. Issue #385 widens where it shows: not only a just-generated
			 * candidate in the accept row, but any already-attached generated asset in the
			 * gallery - refining a picture from a previous session had nowhere to happen
			 * before this. */
			regenerate: {
				trigger: string;
				dialogTitle: (entityName: string) => string;
				hint: string;
				instructionLabel: string;
				instructionPlaceholder: string;
				action: string;
				regenerating: string;
				instructionMustBeString: string;
				fromAssetIdMustBeString: string;
				sourceHasNoPrompt: string;
			};
			/** Issue #382/#385, decision R7/R10: an image's audience follows its entry,
			 * and attaching one is the accept - so this is down to the one exception a GM
			 * can still set, `gm_only`, shown as a single Solo GM switch on each card in
			 * the gallery (O4/R8's "turning one lens on", not a two-option segmented
			 * control choosing between "visible" and "gm only") plus the summary sentence
			 * below the grid explaining the default for the whole entry at once. */
			publish: {
				gmOnlyBadge: string;
				label: string;
				ariaLabel: string;
				explanation: string;
				gmOnlyMustBeBoolean: string;
				genericUpdateFailedWithStatus: (status: number) => string;
				genericUpdateFailed: string;
			};
			/** O2 (#284): the gallery's "use as cover" action, which is that image's
			 * accept - a generated picture becomes the entry's face because a person
			 * pressed this, never as a side effect of generating it. */
			cover: {
				badge: string;
				useLabel: string;
				removeLabel: string;
				saving: string;
				explanation: string;
				mediaAssetIdMustBeStringOrNull: string;
				mustBeAnImage: string;
				genericCoverFailedWithStatus: (status: number) => string;
				genericCoverFailed: string;
			};
			/** Issue #385, decision R10: the gallery's own delete, which none of the three
			 * surfaces it replaces had a place for. A two-click confirm (`label` then
			 * `confirmLabel`) rather than a native `confirm()`, so it stays in the same
			 * translated, themed control set as everything else here. `refusedCover` and
			 * `refusedInBody` are the DELETE route's two refusals, verbatim: a body
			 * pointing at a missing image is worse than a cover somebody has to remove
			 * first. */
			delete: {
				label: string;
				confirmLabel: string;
				deleting: string;
				refusedCover: string;
				refusedInBody: string;
				genericDeleteFailedWithStatus: (status: number) => string;
				genericDeleteFailed: string;
			};
			/** Issue #385, decision R10: one media surface per entry instead of three that
			 * disagree - the gallery all three entry points open. `EntryMediaPanel.svelte`
			 * keeps only `count` and an `openLabel` button for its own compact preview;
			 * everything else here belongs to `MediaGallery.svelte` itself. */
			gallery: {
				dialogTitle: (entityName: string) => string;
				closeLabel: string;
				openLabel: string;
				count: (n: number) => string;
			};
		};
		editor: {
			breadcrumbEdit: string;
			heading: (entityName: string) => string;
			save: string;
			bodyAriaLabel: string;
			/** Round twelve, Q4: the write/preview switch over the editor box, plus what
			 * the preview side of it is called and what it says with nothing written. */
			view: {
				ariaLabel: string;
				write: string;
				preview: string;
				previewAriaLabel: string;
				previewEmpty: string;
			};
			/** R9, round thirteen (#384): hovering or focusing an image in the preview
			 * offers the same three widths `inBody.width` does, and rewrites the token in
			 * place. Same three labels, a separate copy: this namespace and `media.inBody`
			 * are two different agents' i18n scope, and the words happen to coincide. */
			imageWidth: {
				ariaLabel: string;
				third: string;
				twoThirds: string;
				full: string;
			};
		};
		/** Round twelve, Q4: every string below is now one icon's tooltip *and* its
		 * `aria-label`, one value doing both jobs, so a translation cannot end up
		 * labelling the eye and the screen reader differently. `mentionLabel` is gone
		 * with the visible `@ Mention` text it used to carry. */
		toolbar: {
			ariaLabel: string;
			bold: string;
			italic: string;
			heading: string;
			list: string;
			quote: string;
			link: string;
			mention: string;
		};
		mentionMenu: {
			ariaLabel: string;
			matching: (query: string) => string;
			noExactMatch: string;
			noMatchBefore: (query: string) => string;
			noMatchAfter: string;
			aliasLabel: (aliases: string) => string;
		};
		errors: {
			universeNotFound: (slug: string) => string;
			entryNotFound: (slug: string, universeName: string) => string;
			viewerCannotEdit: string;
			viewerCannotChangeLanguage: string;
			viewerCannotGenerateMedia: string;
			missingBody: string;
			missingProposalId: string;
			missingLanguageChoice: string;
			unknownLanguage: (choice: string) => string;
			completeCannotRun: (message: string) => string;
			modifierMustBeString: string;
			featureInvalid: string;
			generationOff: string;
			notEnoughCredits: string;
			mediaAssetIdMustBeString: string;
			noSuchGeneratedImage: string;
			alreadyAttached: string;
			noSuchImage: string;
		};
	};

	/** Issue #121's sweep: the proposal inbox and the accept/reject queue - keyboard
	 * hints, reject-reason chips, the evidence popover, the propagation plan checklist. */
	proposals: {
		/** "Proposals": the inbox's own heading/title, and the plan page's breadcrumb link
		 * back to it. */
		title: string;
		inbox: {
			empty: string;
			/** "From: {provenance}", the inbox's own frame around the shared phrase below. */
			from: (provenance: string) => string;
			entriesLabel: (total: number) => string;
			pendingLabel: (count: number) => string;
			importFrom: (playbook: string) => string;
			importSummary: (total: number, pending: number) => string;
			openImportReview: string;
		};
		/** Where a plan came from, as one phrase both the inbox and the plan header frame
		 * (issue #270). `trigger` is the raw `proposal_trigger` enum value
		 * ('save'/'complete'/'audit'/'import'/'table'/'ask'); `entityName` is the plan's
		 * `trigger_entity`, null when it has none. One function rather than one per surface,
		 * because two renderers guessing separately is how the same Ask proposal came to read
		 * "table mode" in the inbox and "from propagation" on the plan. */
		provenance: (trigger: string, entityName: string | null) => string;
		plan: {
			crumbCurrent: string;
			/** "Plan · from {provenance}". */
			heading: (provenance: string) => string;
		};
		checklist: {
			/** Text after the bold "kept" count: " of {total} kept · cap {cap}", or "· no
			 * cap" when the GM turned the limit off - never "cap null". */
			keptSuffix: (total: number, cap: number | null) => string;
			/** Wraps the bold, pre-formatted credits figure: "Est. **1.00** credits...". */
			estimatedCredits: (credits: number) => { prefix: string; suffix: string };
			drop: string;
			empty: string;
			generating: string;
			generateDiffs: (count: number) => string;
			/** The per-row credits cost abbreviation, e.g. "1.20 cr". */
			creditsUnit: string;
		};
		queue: {
			empty: string;
			/** Wraps the bold position number: "Proposal **3** of 12". */
			position: (total: number) => { prefix: string; suffix: string };
			filterShown: (typeLabel: string) => string;
			/** Text after the bold accepted/rejected counts. */
			acceptedSuffix: (count: number) => string;
			rejectedSuffix: (count: number) => string;
			acceptedToast: (entityName: string | null) => string;
			undoFailedToast: string;
			undo: string;
			keyboardMove: string;
			keyboardAccept: string;
			keyboardReject: string;
			keyboardUndo: string;
		};
		diffCard: {
			newEntry: string;
			accepted: string;
			rejected: string;
			accept: string;
			reject: string;
			undo: string;
			/** Q1 (#362): "2 changed passages", shown only when there is more than one, so a
			 * reader knows how many regions the card holds before scrolling it. */
			changedRegions: (count: number) => string;
			/** The unchanged sentences between two regions, counted rather than drawn:
			 * prose has no line numbers, so this is the honest form of a hunk header. */
			unchangedUnits: (count: number) => string;
			/** Q1 (#362): the diff says removal and addition in lightness and in shape,
			 * never in hue (P3), so these three carry the same distinction for a screen
			 * reader, which sees neither. */
			removedLabel: string;
			addedLabel: string;
			changedLabel: string;
			/** Raw `proposal_kind` enum value ('create'/'update'/'relation'/'draft_entity'/'flag'). */
			kindLabel: (kind: string) => string;
			/** Raw entity type ('character'/'place'/...) or 'relation'. */
			entityTypeLabel: (type: string) => string;
			/** Redisplays a rejected candidate's stored reason: one of `rejectChips`' five
			 * stable English tokens, mapped back to its label, or free text passed through
			 * unchanged (the GM's own words, already in their language). */
			rejectReasonLabel: (value: string) => string;
		};
		filterBuckets: {
			all: string;
			character: string;
			place: string;
			faction: string;
			item: string;
			event: string;
			session: string;
			relation: string;
			/** Decision K1, issue #190: reuse-proposed/widen-proposed/new-proposed all
			 * share this one chip, distinct from a plain 'relation' proposal - "the type
			 * filter chips need to be able to show and hide them" as their own kind
			 * inside the queue, not three separate chips for three outcomes of one
			 * question. */
			relation_type: string;
		};
		/** Decision K1, issue #190: the three non-'existing' outcomes of
		 * `resolveRelationType` - reuse-proposed, widen-proposed, new-proposed - shown
		 * inside the same D4 queue `ProposalDiffCard` renders everything else in.
		 * `why` is always the resolver's own prose (guardrail 3: never a bare score),
		 * read straight off `rationale`/diffCard already carries no separate string for
		 * it here. */
		relationVocab: {
			reuseHeading: string;
			widenHeading: string;
			newHeading: string;
			/** The catalogue's one-sentence question this proposal asks, per kind - shown
			 * above the type block so "one question about vocabulary" (issue #190, D6)
			 * reads as a sentence before the GM sees the mechanics. */
			askReuse: string;
			askWiden: string;
			askNew: string;
			/** "Reuses your existing type "employs" / "employed by"". */
			reuseType: (label: string, inverseLabel: string) => string;
			/** "Currently admits character -> character, place -> character.". Wraps the
			 * whole sentence rather than interpolating raw entity-type tokens into a
			 * pre-built one, since `entityTypeLabel` still has to localize each side. */
			admitsCurrently: (pairs: string) => string;
			/** "Widens it to also admit place -> faction.". */
			widensTo: (fromLabel: string, toLabel: string) => string;
			/** "Creates "fears" / "feared by", one_to_many, admitting character -> character.". */
			newType: (label: string, inverseLabel: string, cardinality: string) => string;
			/** "Would admit character -> character, place -> character." -
			 * `relation_type_new`'s own admits sentence, worded as a future state since
			 * the type does not exist until this proposal is accepted. */
			newAdmits: (pairs: string) => string;
			waitingCount: (count: number) => string;
			cardinalityLabel: (cardinality: string) => string;
		};
		bulkReject: {
			rejecting: string;
			rejectShown: (count: number) => string;
			rejectedCount: (count: number) => string;
		};
		evidence: {
			button: string;
			embeddingOnly: string;
			/** The forced-open header for an Ask-originated draft: its strongest link is the
			 * GM's own request, not anything in canon (issue #270). */
			instructionOnly: string;
			close: string;
			reasonRelation: (path: string, hops: number) => string;
			reasonMention: (direction: 'forward' | 'reverse', matchedText: string) => string;
			reasonEmbedding: string;
			reasonInstruction: string;
			reasonImportAmbiguous: (path: string | null, count: number) => string;
			reasonImportMatched: (path: string | null) => string;
			reasonImportExtracted: (path: string | null) => string;
		};
		/** C7's five fixed chips plus free text. `value` (not `label`) is the stable
		 * English token persisted to the database - only the label is translated. */
		rejectChips: {
			prompt: string;
			wrong: string;
			alreadyTrue: string;
			notCanonYet: string;
			tooMuch: string;
			prose: string;
			other: string;
			otherPlaceholder: string;
			save: string;
		};
		/** Issue #345: C6's queue rendered in place, on the entry a proposal targets and on
		 * Ask's drafted card. The card's own words stay in `diffCard` - these are only the
		 * region's frame around it. */
		inline: {
			/** The region's accessible name, since it is a focusable landmark carrying
			 * keystrokes rather than decoration. */
			regionLabel: string;
			heading: (pending: number) => string;
			/** Once every proposal in the region has been decided. */
			headingSettled: string;
			/** "2 of 3", shown only when the region holds more than one. */
			position: (index: number, total: number) => string;
			/** Names the five keys the region listens for, beside the keys themselves. */
			keys: string;
			/** Confirms an accept landed in canon, where the reader is already looking. */
			acceptedNote: string;
			failed: (message: string) => string;
			/** Pending on this entry with no drafted text yet, so C3's checklist on the plan
			 * is where the decision to spend on a diff still belongs. */
			awaitingDiff: (count: number) => string;
			awaitingDiffLink: string;
		};
		errors: {
			noDiffsToGenerate: string;
			/** `/w/[universe]/review/[proposal]`, issue #345. */
			proposalNotFound: string;
			unknownAction: string;
			viewerCannotDecide: string;
			missingRejectReason: string;
			notRejected: string;
		};
	};

	/** Issue #121's sweep: the import review queue and the first-run onboarding import
	 * flow (upload, live proposal feed, job status). */
	import: {
		review: {
			headTitle: (universeName: string) => string;
			breadcrumbProposals: string;
			breadcrumbCurrent: string;
			heading: (playbook: string) => string;
			stillImporting: (count: number) => string;
			refresh: string;
			statusNote: {
				stoppedAtCeiling: (note: string | null) => string;
				cancelled: (note: string | null) => string;
				failed: (note: string | null) => string;
			};
			emptyRunning: string;
			emptyRunningExplanation: string;
			emptyDone: string;
			filtering: string;
			/** Issue #163, SPEC.md §6.4: the entities this job's merge engine found missing
			 * from the source. A statement of fact, never a proposal - no accept/reject verbs
			 * belong in this copy. */
			missing: {
				heading: (count: number) => string;
				explanation: string;
			};
			errors: {
				universeNotFound: (slug: string) => string;
				jobNotFound: (jobId: string, universeName: string) => string;
				missingProposalId: string;
				proposalNotFound: (proposalId: string) => string;
				missingProposalOrReason: string;
				proposalNotRejected: string;
				missingFilterType: string;
			};
		};
		/** issue #263: `import_job.outcome_note` renders as a stable machine-readable
		 * payload (`parseOutcomeNote`, `@canonry/import`) at display time rather than as
		 * an English sentence written at settle time - `$lib/import/outcome-note.ts`'s
		 * `renderOutcomeNote` is the one place that walks the payload and calls into
		 * this. `offenderReason` covers `DocumentOutcome.detail`'s closed set;
		 * `legacy` never appears here because a legacy note's raw English text is
		 * shown as-is, with no catalogue lookup, as the honest fallback for a row
		 * written before this issue. */
		outcomeNote: {
			finished: (documents: number, proposals: number) => string;
			noDocuments: string;
			unchanged: (documents: number) => string;
			stoppedNoOffender: (documents: number, proposals: number) => string;
			offenderReason: Record<
				Exclude<OutcomeNoteOffenderReason, 'model_call_failed' | 'loop_guard' | 'other'>,
				string
			> & {
				model_call_failed: (errorName: string) => string;
				loop_guard: (toolName: string, count: number) => string;
				other: (text: string) => string;
			};
			offender: (path: string, reasonText: string) => string;
			offenderWithOthers: (base: string, othersCount: number) => string;
			lossy: (path: string, count: number) => string;
			lossyWithOthers: (base: string, othersCount: number) => string;
		};
		start: {
			headTitle: string;
			heading: string;
			description: string;
			nameLabel: string;
			namePlaceholder: string;
			importCard: { heading: string; description: string; cta: string };
			emptyCard: { heading: string; description: string; cta: string };
			preindexedCard: {
				heading: (baseName: string) => string;
				genericHeading: string;
				description: string;
				cta: (baseName: string) => string;
				notConfigured: string;
			};
			errors: { nameRequired: string };
		};
		upload: {
			headTitle: (universeName: string) => string;
			heading: string;
			description: string;
			noLiveModelNotice: string;
			uploadButton: string;
			confirm: {
				uploadedSummary: (fileName: string, kilobytes: string) => string;
				detected: (label: string) => string;
				notDetected: (label: string) => string;
				/** Renders `DetectedDetail` above - the confirm screen's secondary line under
				 * "Detected: <playbook>". */
				detail: (detail: DetectedDetail) => string;
				playbookLabel: string;
				continueButton: string;
			};
			estimate: {
				heading: string;
				summary: (fileName: string, playbookLabel: string) => string;
				sizeLabel: string;
				documentCount: (count: number) => string;
				timeLabel: string;
				estimatedMinutes: (minutes: number) => string;
				costLabel: string;
				estimatedCredits: (credits: number) => string;
				startButton: string;
			};
			errors: {
				noUniverseGiven: string;
				universeNotFound: (slug: string) => string;
				chooseFile: string;
				unreadableFile: (fileName: string, message: string) => string;
				lostUpload: string;
				needsLiveModel: (playbookLabel: string) => string;
				noDocumentsFound: string;
				refused: {
					jobsQuota: string;
					documentsQuota: string;
					insufficientCredits: string;
				};
			};
		};
		job: {
			headTitle: (universeName: string) => string;
			firstAcceptHeading: string;
			firstAcceptMessage: (seconds: number) => string;
			headingRunning: string;
			headingTerminal: {
				finished: string;
				stoppedAtCeiling: string;
				cancelled: string;
				failed: string;
			};
			statusWord: Record<
				'queued' | 'running' | 'finished' | 'stopped_at_ceiling' | 'cancelled' | 'failed',
				string
			>;
			statusLine: (proposalsEmitted: number, documentCount: number, statusWord: string) => string;
			reviewNow: (count: number) => string;
			goToUniverse: (universeName: string) => string;
			errors: {
				jobNotFound: string;
				signInRequired: string;
				proposalGone: string;
			};
		};
		liveFeed: {
			empty: string;
			explanation: string;
			badge: Record<
				| 'create'
				| 'update'
				| 'relation'
				| 'draft_entity'
				| 'flag'
				| 'relation_type_reuse'
				| 'relation_type_widen'
				| 'relation_type_new',
				string
			>;
			untitledProposal: string;
			accept: string;
			accepted: string;
			outcome: { rejected: string; superseded: string };
		};
		/** Issue R11 (round thirteen, DECISIONS.md): the door for a world that already
		 * exists, at `/w/[universe]/import` - the same D1/D2 upload flow above (`upload`),
		 * reused verbatim rather than duplicated, plus the jobs this universe has already
		 * run. `review` (this same namespace, above) is where each one is actually read;
		 * this is only the index. */
		existing: {
			/** #386's own axe run: `input[type=file]` needs a real accessible name, which
			 * onboarding's identical upload form (`import.upload`) never gave it either -
			 * fixed here rather than there, since touching that shared namespace is outside
			 * this issue's own scope. `sr-only`, matching admin/models's same pattern. */
			fileInputLabel: string;
			jobsHeading: string;
			jobsEmpty: string;
			jobsEmptyAction: string;
			proposals: (count: number) => string;
			reviewLink: string;
			viewerNotice: string;
		};
	};

	/** Issue #121's sweep: table mode - the context strip, pinned cards, quick actions,
	 * quick notes, instant search, the phone tab bar, the ambient audio player. */
	table: {
		/** `+layout.svelte`'s browser-tab title and `ContextStrip`'s persistent "mode is
		 * on" chip - the same word in both, so the tab and the strip never disagree about
		 * what mode this is. */
		title: string;

		contextStrip: {
			modeOn: string;
			noPlaceDeclared: (universeName: string) => string;
			pinnedIn: (ms: number) => string;
			change: string;
			exit: string;
		};

		declareContext: {
			formLabel: string;
			whereArePlayers: string;
			placePlaceholder: string;
			placeCandidatesLabel: string;
			placeTag: string;
			noPlaceMatch: (query: string) => string;
			sessionLabel: string;
			noSessionOption: string;
			cancel: string;
			declare: string;
		};

		pinnedCards: {
			empty: string;
			listLabel: string;
			declaredPlace: string;
			hopsFromPlace: (hops: number) => string;
			warmBriefAt: (relativeTime: string) => string;
			staleSince: (relativeTime: string) => string;
			notWarmedThisSession: string;
			justNow: string;
			minutesAgo: (minutes: number) => string;
			hoursAgo: (hours: number) => string;
		};

		phoneTabBar: {
			navLabel: string;
			here: string;
			actions: string;
			ask: string;
			queue: string;
		};

		/** Issue #74's "+ NPC here" / "+ create a child location" labels, reused verbatim
		 * as the "via" attribution on the toast and the session's own live proposal list
		 * (`table.home`) - one translated phrase per action, never a second one drifting
		 * out of sync with the dock's own button. */
		actionLabels: {
			npcHere: string;
			createChildLocation: string;
			quickNote: string;
		};

		quickActionDock: {
			markAsRevealed: string;
			markAsRevealedDisabledTitle: string;
			drafting: string;
			more: string;
			nameChildLocation: string;
			locationPlaceholder: string;
			create: string;
			jotNote: string;
		};

		quickNoteForm: {
			formLabel: string;
			disclaimer: string;
			about: string;
			note: string;
			notePlaceholder: string;
			cancel: string;
			saveAsProposal: string;
		};

		instantSearch: {
			whoIsThis: string;
			placeholder: string;
			searching: string;
			instantLane: string;
			fastLane: string;
			laneStatus: (laneName: string, ms: number) => string;
			noMatch: (query: string) => string;
			aka: (alias: string) => string;
		};

		ambientPlayer: {
			heading: string;
			showAudioGraph: string;
			hideAudioGraph: string;
			noPackYet: string;
			layerSummary: (count: number, stale: boolean) => string;
			play: string;
			starting: string;
			audioPausedByBrowser: string;
			enableAudio: string;
			layersFailedToLoad: (count: number) => string;
			master: string;
			crossfade: string;
			muteLayer: (prompt: string) => string;
			unmuteLayer: (prompt: string) => string;
			couldNotLoadPack: (status: number) => string;
			couldNotStart: string;
			crossfadeFailed: string;
			layersAriaLabel: string;
		};

		/** `+page.svelte`'s own chrome: the table-mode home screen around the components
		 * above - section headings, the empty-context prompt, toasts, and the session's
		 * own live proposal feed (issue #79). */
		home: {
			noContextDeclared: string;
			pinnedHeading: string;
			quickActionsHeading: string;
			askHeading: string;
			askNotBuilt: string;
			askOpensFromPalette: (shortcut: string) => string;
			proposalsHeading: string;
			proposalsEmpty: string;
			proposalLabel: string;
			from: (source: string) => string;
			aiDraftedTooltip: string;
			aiDraftedBadge: string;
			scaffoldBadge: string;
			scaffoldTooltipDefault: string;
			aiUnavailable: (reason: string) => string;
			streamStatus: (count: number, lastId: number | null) => string;
			draftingNpc: string;
			actionFailed: (action: string, reason: string) => string;
			unknownReason: string;
			savedAsProposal: (via: string) => string;
			savedAsProposalScaffold: (via: string) => string;
			markedRevealed: (name: string) => string;
			noteSaveFailed: string;
			sessionEnded: (proposalCount: number) => string;
		};

		/** Server-side text for the `/table` request handlers and their `_server/*`
		 * helpers (guard.ts's access check, the three quick actions, the quick-note
		 * proposal, the fast-lane search fallback) - read with `messages(locals.locale)`
		 * or a `Locale` threaded onto the request context, never client-side.
		 * Deterministic proposal rationale only: a model-drafted NPC's own prose already
		 * speaks the *place's* language (SPEC.md §17's third rule), never this one. */
		server: {
			notFound: string;
			declareBeforeAction: string;
			nameLocationBeforeCreating: string;
			unknownActionKind: (kind: string) => string;
			noSessionDeclared: string;
			noteEmpty: string;
			pickNoteTarget: string;
			entryNotFound: string;
			noteProposalFailed: string;
			nothingIndexedYet: string;
			embeddingFailed: (reason: string) => string;
			quickNoteRationale: (hadPlaceDeclared: boolean) => string;
			npcDraftedRationale: (placeName: string) => string;
			npcScaffoldRationale: (placeName: string, unavailableReason: string) => string;
			createLocationRationale: (placeName: string) => string;
			warmBudgetUnavailable: string;
			warmStatusNoProposal: (status: string) => string;
		};
	};

	/** Issue #121's sweep: works and their node tree/editor. `types`/`statuses`/`kinds`
	 * are the enum-keyed lookup tables that used to be hardcoded `Record<string, string>`
	 * literals inline in the index, work and node pages (`WORK_TYPE_LABELS`/`KIND_LABELS`);
	 * `errors` is the handful of `fail()` validation messages the create-work,
	 * create-node and add-child-node actions share verbatim. */
	works: {
		types: {
			oneshot: string;
			module: string;
			campaign: string;
			story: string;
			novel: string;
		};
		statuses: {
			planning: string;
			running: string;
			finished: string;
			abandoned: string;
		};
		kinds: {
			act: string;
			chapter: string;
			scene: string;
			encounter: string;
		};
		errors: {
			workNeedsName: string;
			pickWorkType: string;
			nodeNeedsTitle: string;
			pickNodeKind: string;
			missingBody: string;
		};
		index: {
			title: string;
			description: string;
			empty: string;
			emptyAction: string;
			createHeading: string;
			nameLabel: string;
			typeLabel: string;
			summaryLabel: string;
			summaryOptional: string;
			createButton: string;
		};
		tree: {
			ariaLabel: string;
			emptyHeading: (workName: string) => string;
			emptyHint: string;
			pickNodeHint: string;
			titleLabel: string;
			kindLabel: string;
			addNodeButton: string;
		};
		node: {
			moveUp: string;
			moveDown: string;
			titleSrLabel: string;
			save: string;
			addChildSummary: (nodeTitle: string) => string;
			titleLabel: string;
			kindLabel: string;
			addNodeButton: string;
			usesHeading: string;
			noUses: string;
			changedAt: (when: string) => string;
			usesHint: string;
		};
	};

	/** Issue #121's sweep: the universe index, the sidebar's universe switcher, creating
	 * a universe, Ask mode, and a universe's own settings page. */
	universe: {
		/** Sidebar.svelte's `NAV_ITEMS` lookup - real translated label per `item.id`,
		 * `nav.ts`'s own `label` field stays an English id-like fallback/discriminant. */
		nav: {
			entries: string;
			works: string;
			proposals: string;
			table: string;
			players: string;
			import: string;
			settings: string;
		};
		sidebar: {
			navAriaLabel: string;
			primaryNavAriaLabel: string;
			/** Issue #349 (round eleven P5): the kept-answers link used to live here, above
			 * `nav.ts`'s `NAV_ITEMS`. It is a row in `ShellUserRow.svelte`'s account menu
			 * now, still reusing this same `universe.ask.keep.historyLink` string for its
			 * label; this namespace carries no field of its own for it. */
			recentHeading: string;
		};
		switcher: {
			switchAriaLabel: string;
			derivedBadge: string;
			derivedFrom: (baseUniverseName: string) => string;
			entryCount: (count: number) => string;
			/** Issue #141 (I3 = B): account mode's two extra switcher rows, below the
			 * universe list - universe mode never renders these. */
			allUniverses: string;
			newUniverse: string;
		};
		/** O1 = C (#283): two surfaces, honestly split. `home` is the world home at
		 * `/w/<slug>` (masthead, Continue, Waiting for you, Recent activity) and `entries`
		 * is the browser at `/w/<slug>/entries` (the dense table). Everything below them -
		 * `filters`, `searchPlaceholder`, the empty states, `relativeTime`,
		 * `newEntryDialog` - is shared by both or belongs to the table, which is why this
		 * bag was not split in two.
		 *
		 * I7 = C's `strip` block is gone with `OverviewStrip.svelte`: its four cells became
		 * the home's own sections, so there is nothing left to collapse and no collapse
		 * state to name. */
		index: {
			homebrewEyebrow: string;
			derivedEyebrow: string;
			derivedNoticeBefore: string;
			derivedNoticeAfter: string;
			newEntryAction: string;
			home: {
				/** #348: the masthead's own line. The three figures that used to sit here
				 * (entries, waiting review, credits spent) were a third copy of the
				 * sidebar's two counts and of F2's meter, so they are gone rather than
				 * restyled. What replaces them is the world's own movement over twelve
				 * rolling weeks, which nothing else in the product says. `weeks` is
				 * interpolated rather than spelled out, so the copy stays honest if
				 * `PULSE_WEEKS` ever changes. */
				pulseMoving: (total: number, latest: number, weeks: number) => string;
				/** `lastChange` is already formatted for the locale, or null when the world
				 * carries no dated event at all. Guardrail 7: it reports silence, it never
				 * calls the canon settled. */
				pulseQuiet: (weeks: number, lastChange: string | null) => string;
				/** The hover title on one bar. `weeksAgo` 0 is the last seven days. */
				pulseWeekTitle: (count: number, weeksAgo: number) => string;
				continueHeading: string;
				continueEmpty: string;
				waitingHeading: string;
				/** Guardrail 7's wording discipline applies to a settled day too: it says
				 * nothing is waiting, never that the world is consistent. */
				waitingEmpty: string;
				/** C2 = A: the row is a pointer into the existing inbox, so the link says
				 * where it goes and the home never accepts or rejects anything itself. */
				reviewLink: string;
				reviewAll: (pending: number) => string;
				activityHeading: string;
				activityEmpty: string;
				activityRevision: (entityName: string) => string;
				activityRelation: (fromName: string, label: string, toName: string) => string;
				activityWork: (workName: string, nodeTitle: string) => string;
				/** Guardrail 2: an accepted-from-the-copilot event stays marked as one after
				 * the fact, so the feed cannot flatten the two authors into "changed". */
				authorAi: string;
				browseEntries: string;
			};
			entries: {
				headTitle: (universeName: string) => string;
				title: string;
				/** The way back to the world home, which the sidebar deliberately does not
				 * carry: A2 caps that nav at seven items and `Entries` now points here. */
				backToHome: (universeName: string) => string;
				columnName: string;
				columnType: string;
				columnRelations: string;
				columnFacts: string;
				columnChanged: string;
				/** The accessible name of a column header's own sort control. */
				sortBy: (column: string) => string;
				tableAriaLabel: string;
				moveHint: string;
				openHint: string;
				/** "1-25 of 214", tabular figures per G2. */
				range: (from: number, to: number, total: number) => string;
				pageOf: (page: number, pages: number) => string;
				previousPage: string;
				nextPage: string;
			};
			filters: {
				all: string;
				/** One of the five browsable types (character/place/faction/event/item) - not
				 * 'session', which nothing in the product creates through this dialog yet. */
				typeLabel: (type: string) => string;
			};
			searchPlaceholder: string;
			searchSubmit: string;
			searchClear: string;
			/** The result line naming the query and how many entries it matched, in the
			 * reader's language - what makes a search that narrowed the table say so, rather
			 * than leaving the type chips (deliberately unfiltered by search) as the only
			 * numbers on screen. */
			searchResultCount: (query: string, count: number) => string;
			changedAt: (when: string) => string;
			emptyColdMessage: string;
			emptyFilteredMessage: string;
			/** The filtered empty state's search-specific wording: names the query, so an
			 * empty table under a live search reads as "this query matched nothing" rather
			 * than borrowing the type filter's generic sentence. */
			emptySearchMessage: (query: string) => string;
			relativeTime: {
				justNow: string;
				minutesAgo: (minutes: number) => string;
				hoursAgo: (hours: number) => string;
				daysAgo: (days: number) => string;
				weeksAgo: (weeks: number) => string;
				monthsAgo: (months: number) => string;
			};
			newEntryDialog: {
				title: string;
				description: string;
				nameLabel: string;
				typeLabel: string;
				submit: string;
				cancel: string;
				nameRequiredError: string;
				typeRequiredError: string;
				viewerForbiddenError: string;
			};
		};
		/** The root `/` page - every universe this account owns or was added to,
		 * before picking one. Reuses `switcher.derivedFrom`/`switcher.entryCount` for the
		 * identical "Derived from X · N entries" line the sidebar switcher already shows. */
		list: {
			/** Issue #138 (I1 = B): signed-in home, the universe picker inside the shell -
			 * a heading and the permanent "New universe" primary action next to it. */
			heading: string;
			newUniverse: string;
		};
		ask: {
			headTitle: (universeName: string) => string;
			crumb: (universeName: string) => string;
			placeholder: string;
			ask: string;
			asking: string;
			askFailed: string;
			questionRequired: string;
			methodNotAllowed: string;
			noLiveModel: string;
			levels: {
				'1_line': string;
				short: string;
				normal: string;
				detailed: string;
				full: string;
			};
			ownCanonLabel: string;
			indexedBadge: string;
			/** issue #346: what the source list actually is, said once above it. It used to be
			 * rendered as a bare list of chips, which reads as "here is what backed each claim"
			 * when what it is is the entries whose own wording matched the question. */
			sourcesNote: string;
			/** issue #346: shown in the source list's place when retrieval found nothing worth
			 * citing. A floor with no empty state behind it is six wrong chips replaced by
			 * silence, which tells a reader less rather than more. */
			sourcesEmpty: string;
			close: string;
			loading: string;
			/** issue #256: the `entry_propose`/`entry_edit_propose` tools' own reserved
			 * sub-object (wave i18n contract) - what a pending Ask-drafted proposal chip says. */
			propose: {
				badgeCreated: string;
				badgeEdited: string;
				redirectedToEdit: (entityName: string) => string;
				redirectedToCreate: (entityName: string) => string;
				reviewLink: string;
				/** issue #256's real-gateway regression: shown independently of whatever the
				 * model's own answer text says, so a failed drafting call never has to rely on
				 * the model reporting it honestly. */
				failed: (message: string) => string;
			};
			/** #290 (decision O3): "keep" is the Loremaster's only write, so these are the
			 * strings of the one control that stores anything. The `note*` fields are the
			 * guardrail 5 sentence in its F3 = C home, shown beside the control at the moment
			 * the answer is stored rather than left to a policy page nobody opens: split up
			 * because it names the provider that actually generated the text, reads differently
			 * when no model wrote it at all, and ends in a link to the full policy.
			 * `noteLinkBefore`/`noteLink` are reused verbatim by the `kept` history below, which
			 * needs the same closing sentence and must not carry a second copy of it. */
			keep: {
				button: string;
				keeping: string;
				kept: string;
				failed: string;
				invalidRequest: string;
				sourceNotInUniverse: string;
				methodNotAllowed: string;
				noteBefore: string;
				noteProvider: (provider: string) => string;
				noteNoProvider: string;
				noteAfter: string;
				noteLinkBefore: string;
				noteLink: string;
				historyLink: string;
			};
			/** #290: the history of what was kept, which is a history only because keeping is a
			 * deliberate act. Detail-level names, the source labels and the closing policy link
			 * come from `levels`, `ownCanonLabel`, `indexedBadge` and `keep.noteLink*` rather
			 * than being repeated here. */
			kept: {
				headTitle: (universeName: string) => string;
				crumb: (universeName: string) => string;
				heading: string;
				note: string;
				empty: string;
				askLink: string;
				askedFrom: string;
				writtenBy: (provider: string) => string;
				writtenWithoutModel: string;
				sourcesLabel: string;
				deletedEntry: string;
				delete: string;
				deleteConfirmPrompt: string;
				deleteConfirmCancel: string;
				deleteFailed: string;
				deleteNotFound: string;
			};
		};
		settings: {
			headTitle: (universeName: string) => string;
			heading: string;
			introBefore: (universeName: string) => string;
			introAnd: string;
			introAfter: string;
			appearanceLink: string;
			exportLink: string;
			viewerForbiddenError: string;
			/** Issue #406 (S1, DECISIONS.md "Round fourteen"): the two-pane page's own
			 * rail - the three group names below, in fixed order (Images, then the
			 * Loremaster, then Canon) - and the small mark a row carries while
			 * `universeSetupItems()` still has the one item that group owns unset.
			 * Replaces the `setupChecklist` card this page used to render at the top:
			 * the array itself is unchanged, only where its output surfaces. */
			groups: {
				images: string;
				loremaster: string;
				canon: string;
			};
			rail: {
				ariaLabel: string;
				incompleteMark: string;
			};
			aiToggle: {
				heading: string;
				description: (universeName: string) => string;
				stopWriting: string;
				resumeWriting: string;
				offNotice: (universeName: string) => string;
			};
			/** Decision C3 amendment (docs/ux/DECISIONS.md "Round nine"): the per-universe
			 * propagation cap, in the same visual language as `aiToggle` above it. */
			propagationCap: {
				heading: string;
				description: (universeName: string) => string;
				capLabel: string;
				noLimitLabel: string;
				save: string;
				/** "Capped at **10** entries per plan." Split like `checklist.estimatedCredits`
				 * so the number can be rendered bold without the whole sentence being one
				 * un-styleable string. */
				capNotice: (cap: number) => { prefix: string; suffix: string };
				noLimitNotice: string;
				invalidCapError: string;
			};
			/** Issue #378, decision R3 (DECISIONS.md "Round thirteen"): the universe-level
			 * image style `pickStyle`'s cascade falls back to (packages/media/src/style.ts,
			 * `entryStyleContext`) when an entry has no override of its own. One row per
			 * universe, updated in place. */
			imageStyle: {
				heading: string;
				description: (universeName: string) => string;
				/** Issue #407, decision S2: sr-only legend on the `<fieldset>` wrapping the
				 * picker grid - interface chrome, unlike a preset's own name/description,
				 * which are content and live in the seed (migration 0048) rather than here. */
				pickerLegend: string;
				/** sr-only text paired with the checkmark on whichever card is selected. */
				selectedLabel: string;
				customCard: {
					label: string;
					hint: string;
				};
				nameLabel: string;
				promptModifierLabel: string;
				save: string;
				nameRequiredError: string;
				promptModifierRequiredError: string;
				/** A preset pick that failed server-side - an invalid id or a permission
				 * refusal already worded by viewerForbiddenError, so this only ever covers
				 * the generic case. */
				pickError: string;
			};
			/** Issue #378, decision R3: a textarea over `universe.loremaster_description`,
			 * which `runAsk` and `completeEntry` (packages/copilot) read directly - see
			 * `loremasterVoiceInstruction` in packages/copilot/src/speech.ts for what it
			 * becomes in the prompt. */
			loremasterVoice: {
				heading: string;
				description: (universeName: string) => string;
				textareaLabel: string;
				hint: string;
				save: string;
				tooLongError: string;
			};
			precedence: {
				heading: string;
				description: (universeName: string) => string;
				empty: string;
				supersededBadge: string;
				remove: string;
				declareHeading: string;
				entryLabel: string;
				baseSourceLabel: string;
				sourceUrlLabel: string;
				noteLabel: string;
				optional: string;
				submit: string;
				onlyDerivedError: string;
				pickEntryError: string;
				pickSourceError: string;
				sourceUrlRequiredError: string;
				alreadySupersededError: string;
				missingIdError: string;
			};
			/** Issue #192 (K1, DECISIONS.md "Round six"): the relation catalogue - every type a
			 * universe can use, shipped and its own, with a real usage count, plus rename, merge
			 * and widen for a universe's own types. The shipped ten stay read-only here on
			 * purpose; editing them is a migration's job, not a settings control's. */
			relations: {
				close: string;
				cardHeading: string;
				cardDescription: (universeName: string) => string;
				cardCountOwn: (count: number) => string;
				manageLink: string;
				headTitle: (universeName: string) => string;
				title: string;
				description: (universeName: string) => string;
				backLink: string;
				shippedHeading: string;
				shippedDescription: string;
				shippedBadge: string;
				ownHeading: string;
				ownDescription: string;
				emptyOwn: string;
				emptyOwnExplanation: string;
				table: {
					label: string;
					inverseLabel: string;
					cardinality: string;
					allowedFrom: string;
					allowedTo: string;
					usage: string;
					actions: string;
				};
				cardinalityLabel: (value: string) => string;
				entityTypeLabel: (type: string) => string;
				rename: {
					trigger: string;
					dialogTitle: (label: string) => string;
					dialogDescription: string;
					labelField: string;
					inverseLabelField: string;
					submit: string;
					labelRequiredError: string;
					inverseLabelRequiredError: string;
					conflictError: string;
					notOwnedError: string;
				};
				widen: {
					trigger: string;
					dialogTitle: (label: string) => string;
					dialogDescription: string;
					fromHeading: string;
					toHeading: string;
					currentlyAdmits: string;
					addOption: (typeLabel: string) => string;
					submit: string;
					noChangeError: string;
					notOwnedError: string;
				};
				/** #198: the GM-written half of a per-locale reading for a universe's own
				 * type - one field pair per shipped locale, all in one form. Leaving both
				 * fields of a locale blank clears that locale's translation back to
				 * display fallback on the authored label; filling only one of the pair is
				 * `incompletePairError`, not a silent partial save. */
				translate: {
					trigger: string;
					dialogTitle: (label: string) => string;
					dialogDescription: string;
					labelField: string;
					inverseLabelField: string;
					submit: string;
					incompletePairError: string;
					notOwnedError: string;
				};
				merge: {
					trigger: string;
					dialogTitle: string;
					dialogDescription: string;
					fromLabel: string;
					intoLabel: string;
					pickFromPlaceholder: string;
					pickIntoPlaceholder: string;
					countWarning: (count: number, fromLabel: string, intoLabel: string) => string;
					countWarningZero: (fromLabel: string, intoLabel: string) => string;
					sameTypeError: string;
					notOwnedError: string;
					needsTwoTypesNotice: string;
					submit: string;
					movedToast: (count: number, intoLabel: string) => string;
				};
				viewerForbiddenError: string;
			};
		};
		/** Issue R11 (round thirteen, DECISIONS.md): the GM's side of `players.*` above -
		 * what the party has learned and when (a `revelation` row, kept by session), and
		 * what is still behind the screen. No invitation exists anywhere in the product
		 * yet, so `invitationsNotice` says that plainly instead of the page growing a
		 * button that writes nothing. */
		players: {
			headTitle: (universeName: string) => string;
			heading: string;
			description: string;
			wikiLinkLabel: string;
			openWikiLink: string;
			invitationsNotice: string;
			revealedHeading: string;
			revealedEmpty: string;
			revealedEmptyAction: string;
			kindLabel: Record<'entity' | 'fact' | 'relation', string>;
			sessionUnknown: string;
			hiddenHeading: string;
			hiddenDescription: string;
			hiddenEmpty: string;
			/** Duplicated per surface rather than shared - see this file's own doc comment
			 * on `entityTypeLabel`'s existing duplication above `relationTypeLabel`. */
			entityTypeLabel: (type: string) => string;
		};
	};

	/** Issue #121's sweep: the /admin subtree (text/image model tables, metrics, pricing). */
	admin: {
		/** Shared fallback for a row with no attribution recorded - a proposal's
		 * modelId, a price change's changedBy - reused across the models and metrics
		 * and pricing tables rather than repeated per table. */
		unattributed: string;

		/** The shared "Save" button label every admin form uses (models' two forms,
		 * pricing's one) - each page keeps its own post-save confirmation text since
		 * those differ ("Saved. Takes effect immediately." vs "Saved."). */
		save: string;

		models: {
			browserTitle: string;
			textHeading: string;
			/** SPEC.md §11.1 intro paragraph, with inline `<code>` spans - rendered via
			 * `{@html}` (static, hand-written, never user input) so each locale can order
			 * the sentence around the code spans naturally instead of being locked to a
			 * fragment-by-fragment split. */
			textIntro1: string;
			/** SPEC.md §17/#125 embedding-purpose paragraph, same `{@html}` treatment. */
			textIntro2: string;
			table: {
				purpose: string;
				currentlyActive: string;
				provider: string;
				modelId: string;
				notConfigured: string;
				providerUnknown: (provider: string) => string;
			};
			purposeLabel: {
				cheap: string;
				premium: string;
				multimodal: string;
				embedding: string;
				image: string;
			};
			saved: string;
			imageHeading: string;
			imageIntro1: string;
			/** Ends right before the real `<a href={resolve('/admin/pricing')}>` link
			 * (kept as real Svelte markup, not baked into the `{@html}` string, so
			 * routing stays real) - the template supplies the trailing period itself. */
			imageIntro2Pre: string;
			imageTable: {
				feature: string;
				pricePerImage: string;
				currency: string;
				/** #332: the shape the feature asks its model for, read-only here. It is a
				 * product decision stored on the row (`params.aspectRatio`), not a field an
				 * admin retypes, but a swap can invalidate it so the page has to show it. */
				aspectRatio: string;
				aspectRatioNotSet: string;
				/** #366: for the two cover features the row's shape is only a default, since a
				 * cover is drawn at the entity type's shape. The save checks every value in
				 * this list, so an admin is told what they are choosing a model against. */
				coverAspectRatios: (shapes: string) => string;
				active: string;
				inactive: string;
			};
			featureLabel: {
				portrait: string;
				variants: string;
				scene: string;
			};
			errors: {
				unknownPurpose: (purpose: string) => string;
				unknownProvider: (provider: string, choices: string) => string;
				modelIdRequired: string;
				providerAndModelIdRequired: string;
				invalidPricePerImage: string;
				invalidCurrency: string;
				aspectRatioUnsupported: (modelId: string, aspectRatio: string, accepted: string) => string;
				aspectRatioModelUnknown: (modelId: string, aspectRatio: string) => string;
			};
		};

		metrics: {
			browserTitle: string;
			heading: string;
			intro: string;
			/** Shared table header words reused across the accept-rate-by-kind,
			 * accept-rate-by-locale, warm-radius and entropy tables. */
			table: {
				produced: string;
				accepted: string;
				rejected: string;
				rate: string;
				universe: string;
				noDataYet: string;
			};
			/** "No universes yet." - shared by the warm-radius and entropy empty states,
			 * which show the exact same sentence today. */
			noUniversesYet: string;
			accept: {
				heading: string;
				intro: (windowDays: number) => string;
				noProposalsYet: string;
				acceptRateLabel: string;
				table: { weekOf: string; kind: string; model: string };
				byLocale: {
					heading: string;
					intro: string;
					localeLabel: string;
				};
			};
			timeToFirstAccept: {
				heading: string;
				intro: string;
				noImportsYet: string;
				noAcceptYet: (count: number) => string;
				summary: (accepted: number, total: number, median: string) => string;
				importStarted: string;
				timeToFirstAcceptLabel: string;
				stillWaiting: string;
			};
			warmRadius: {
				heading: string;
				intro: (thresholdPercent: number) => string;
				consumed: string;
				generated: string;
				hitRate: string;
				currentRadius: string;
				ring: (n: number) => string;
			};
			entropy: {
				heading: string;
				intro: string;
				createdInPrep: string;
				updatedAfterSession: string;
			};
			/** #278: the audit-flag-position panel, empty until the audit is used at volume. */
			auditFlags: {
				heading: string;
				intro: (cap: number) => string;
				position: string;
				produced: string;
				dismissed: string;
				stillOpen: string;
				dismissalRate: string;
				noFlagsYet: string;
			};
		};

		pricing: {
			browserTitle: string;
			/** Also the link text on the models page's image intro, pointing here. */
			title: string;
			intro1: string;
			intro2: string;
			kindLabel: {
				reading: string;
				generation: string;
				import: string;
			};
			table: {
				label: string;
				operation: string;
				credits: string;
				notes: string;
				lastChange: string;
			};
			creditsFor: (label: string) => string;
			saved: string;
			lastChangeSummary: (from: string, to: string, changedBy: string, date: string) => string;
			noChangesYet: string;
			errors: {
				missingOperation: string;
				invalidCredits: string;
				unknownOperation: (operation: string) => string;
			};
		};
	};

	/** Issue #121's sweep: the docs pages' chrome (titles, the import-guide picker) - the
	 * long-form prose body stays English, a documentation-writing project distinct from
	 * interface string localisation. `importGuide.browserTitle` is a function rather than
	 * a fixed suffix so each locale can order the source name and "import guide" however
	 * reads naturally, not just concatenate a shared suffix. */
	docs: {
		hub: {
			browserTitle: string;
			title: string;
			intro: string;
			importHeading: string;
			importIntro: string;
			importLink: string;
			languagesHeading: string;
			languagesIntro: string;
			languagesLink: string;
		};
		importIndex: {
			title: string;
			eyebrow: string;
			intro: string;
			sourcesHeading: string;
		};
		importGuide: {
			browserTitle: (guideLabel: string) => string;
			eyebrow: string;
		};
		privacy: {
			title: string;
		};
	};
}
