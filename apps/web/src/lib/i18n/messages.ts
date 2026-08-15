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
		};
		/** Issue #150 (F2 = A, H1's spend rule): the shell footer's quota meter
		 * (QuotaMeter.svelte). Two lines, not one - included quota and warm budget
		 * are counted separately (SPEC.md §15) and never merge into one number.
		 * `ratio` formats "remaining / total" once for both lines (G2: tabular
		 * figures, per-locale grouping) rather than each line writing its own
		 * template. Guardrail 7 / SPEC.md §15: both totals passed to `ratio` are
		 * always a real, finite number - this namespace holds no "unlimited"
		 * string to reach for. */
		quota: {
			includedHeading: string;
			warmHeading: string;
			ratio: (remaining: number, total: number) => string;
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
			ask: string;
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
		 * only labels, confirmations and fallbacks live here. `deleteUnavailable`
		 * replaces a delete button rather than shipping one that always fails: Better
		 * Auth's `deleteUser` endpoint 404s until `user.deleteUser.enabled` is set in
		 * `lib/server/auth.ts`, which this deployment does not set (checked against the
		 * installed better-auth 1.6.27 source, not assumed). */
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
			emailLabel: string;
			emailNote: string;
			passwordHeading: string;
			currentPasswordLabel: string;
			newPasswordLabel: string;
			passwordSave: string;
			passwordSaving: string;
			passwordSaved: string;
			passwordSaveFailedFallback: string;
			sessionsHeading: string;
			sessionsDescription: string;
			signOutEverywhereButton: string;
			signOutEverywhereInProgress: string;
			signOutEverywhereFailedFallback: string;
			deleteHeading: string;
			deleteUnavailable: string;
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
			pendingProposalsText: (count: number) => string;
		};
		/** `EntryProseWithSecrets.svelte` (`lib/components/players/**`, but only ever
		 * rendered on this GM-facing entry page, never on `/p/**` - the public wiki's own
		 * chrome lives entirely under the `players` namespace above): the secret/GM-note
		 * block tags and the GM-view/player-preview toggle. */
		secrets: {
			hiddenBlock: string;
			gmNoteBlock: string;
			gmView: string;
			playerPreviewActive: string;
			showGmView: string;
			playerPreview: string;
		};
		language: {
			label: string;
			autoDetect: string;
			unsure: string;
			detectedPrefix: (name: string) => string;
			detectedUnknown: string;
		};
		complete: {
			button: string;
			completing: string;
			empty: string;
			drafted: string;
			genericFailure: string;
			aiOff: string;
		};
		tabs: {
			ariaLabel: string;
			sectionsAriaLabel: string;
			relations: string;
			facts: string;
			images: string;
			history: string;
			audit: string;
			/** Issue #148 (I10 = B): below `md`, B1's five-tab aside can't sit beside
			 * the document, so it moves behind this trigger into a bottom sheet
			 * instead of stacking under the prose uninvited - "reachable rather than
			 * cropped", not a second copy of the panel. */
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
			privateNote: string;
			generatedBadge: string;
			generateButton: string;
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
		};
		editor: {
			breadcrumbEdit: string;
			heading: (entityName: string) => string;
			save: string;
			bodyAriaLabel: string;
		};
		toolbar: {
			ariaLabel: string;
			bold: string;
			italic: string;
			heading: string;
			list: string;
			quote: string;
			link: string;
			mention: string;
			mentionLabel: string;
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
			fromEntity: (entityName: string) => string;
			/** Raw `proposal_trigger` enum value ('save'/'complete'/'audit'/'import'/'table'),
			 * shown only when the plan carries no edited-entity name. */
			fromTrigger: (trigger: string) => string;
			entriesLabel: (total: number) => string;
			pendingLabel: (count: number) => string;
			importFrom: (playbook: string) => string;
			importSummary: (total: number, pending: number) => string;
			openImportReview: string;
		};
		plan: {
			crumbCurrent: string;
			headingFromEntity: (entityName: string) => string;
			headingFromPropagation: string;
		};
		checklist: {
			/** Text after the bold "kept" count: " of {total} kept · cap {cap}". */
			keptSuffix: (total: number, cap: number) => string;
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
			showCurrentWording: string;
			showWhatThisReplaced: string;
			was: string;
			now: string;
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
		};
		bulkReject: {
			rejecting: string;
			rejectShown: (count: number) => string;
			rejectedCount: (count: number) => string;
		};
		evidence: {
			button: string;
			embeddingOnly: string;
			close: string;
			reasonRelation: (path: string, hops: number) => string;
			reasonMention: (direction: 'forward' | 'reverse', matchedText: string) => string;
			reasonEmbedding: string;
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
		errors: {
			noDiffsToGenerate: string;
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
		start: {
			headTitle: string;
			heading: string;
			description: string;
			nameLabel: string;
			namePlaceholder: string;
			importCard: { heading: string; description: string; cta: string; badge: string };
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
			badge: Record<'create' | 'update' | 'relation' | 'draft_entity' | 'flag', string>;
			untitledProposal: string;
			accept: string;
			accepted: string;
			outcome: { rejected: string; superseded: string };
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
			askTheLoremaster: string;
			recentHeading: string;
			notBuiltYet: (issue: number) => string;
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
		/** Issue #145 (I7 = C, "one page, two modes"): the universe home is now the entry
		 * browser, with a collapsible overview strip pinned above it. Replaces the old
		 * three-sentence Recent-list page (`recentEntriesHeading`/`empty`) entirely - Recent
		 * stays only in the sidebar (`sidebar.recentHeading`), which Shell owns. */
		index: {
			homebrewEyebrow: string;
			derivedEyebrow: string;
			derivedNoticeBefore: string;
			derivedNoticeAfter: string;
			newEntryAction: string;
			strip: {
				collapseLabel: string;
				expandLabel: string;
				whatChangedHeading: string;
				whatChangedEmpty: string;
				waitingForReviewHeading: string;
				quotaHeading: string;
				quotaValue: (used: number, total: number) => string;
				currentWorkHeading: string;
				currentWorkEmpty: string;
				currentWorkValue: (workName: string, nodeTitle: string) => string;
			};
			filters: {
				all: string;
				/** One of the five browsable types (character/place/faction/event/item) - not
				 * 'session', which nothing in the product creates through this dialog yet. */
				typeLabel: (type: string) => string;
			};
			searchPlaceholder: string;
			changedAt: (when: string) => string;
			emptyColdMessage: string;
			emptyFilteredMessage: string;
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
			close: string;
			loading: string;
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
			aiToggle: {
				heading: string;
				description: (universeName: string) => string;
				stopWriting: string;
				resumeWriting: string;
				offNotice: (universeName: string) => string;
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
				eurPerImage: string;
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
				invalidEurPerImage: string;
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
