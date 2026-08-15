import { numberFormat, pluralRules } from './intl.js';
import type { Messages } from './messages.js';

// Shared between `proposals.rejectChips`' five chip labels and
// `proposals.diffCard.rejectReasonLabel`'s redisplay of a stored reason, so the two
// never drift: the object literal below can't reference its own sibling properties
// while it is still being built, so this lives outside it instead.
const PROPOSAL_REJECT_REASON_LABELS_EN: Record<string, string> = {
	wrong: 'Wrong',
	'already true': 'Already true',
	'not canon yet': 'Not canon yet',
	'too much': 'Too much',
	prose: 'Prose'
};

export const en: Messages = {
	shell: {
		skipToContent: 'Skip to content',
		signedInAs: (name) => `Signed in as ${name}`,
		notSignedIn: 'Not signed in',
		signIn: 'Sign in',
		signUp: 'Sign up',
		signOut: 'Sign out',
		signingOut: 'Signing out…',
		tagline:
			'A wiki for your game world where an AI copilot works in every flow, and never writes anything you did not accept.',
		sidebar: {
			accountNavAriaLabel: 'Account navigation',
			accountNav: {
				universes: 'Universes',
				settings: 'Settings',
				docs: 'Docs'
			}
		},
		quota: {
			includedHeading: 'Included quota',
			warmHeading: 'Warm budget',
			// Same idiom as `settings.billing.creditsCount`: grouped digits, no
			// fractional credits shown - this is the same `subscriptionCredits`/
			// `warmBudgetRemaining` figure that page renders, formatted the same way.
			ratio: (remaining, total) => {
				const fmt = numberFormat('en', { maximumFractionDigits: 0, useGrouping: 'always' });
				return `${fmt.format(remaining)} / ${fmt.format(total)}`;
			}
		},
		door: {
			createAccount: 'Create an account',
			exportNote: 'Markdown in, markdown out. Your canon exports as plain files on any plan.'
		},
		// Issue #148 (I10 = B): the phone top bar's drawer trigger, palette icon and
		// account avatar, plus the E4-shaped bottom tab bar universe mode gets below
		// `md`. "Entries"/"Proposals" are read from `universe.nav` at the call site,
		// not repeated here.
		phoneNav: {
			openNavLabel: 'Navigation and account',
			openNavDescription: 'Universe switcher, navigation links and account controls.',
			closeNavLabel: 'Close navigation',
			paletteTriggerLabel: 'Open the command palette',
			accountLabel: 'Account',
			tabsAriaLabel: 'Primary sections',
			ask: 'Ask',
			more: 'More'
		},
		/** Issue #143 (I6 = B): "Model keys" and "Plan and credits" are the menu's own
		 * wording (the issue body names the six rows separately from the settings
		 * sub-nav's shorter pane titles); everything else here reuses another
		 * namespace's copy rather than a second English string for the same word. */
		accountMenu: {
			account: 'Account',
			language: 'Language',
			appearance: 'Appearance',
			modelKeys: 'Model keys',
			planAndCredits: 'Plan and credits',
			export: 'Export'
		},
		palette: {
			dialogTitle: 'Command palette',
			dialogDescription: 'Jump to an entry, run a command, or ask a question.',
			closeLabel: 'Close the command palette',
			placeholder: 'Jump to an entry, run a command, or ask a question…',
			askHeading: 'Ask',
			askAction: (question) => `Ask "${question}"`,
			askHint: 'Opens Ask',
			entriesHeading: 'Entries',
			noEntryMatches: (query) => `No entries match "${query}".`,
			loadingMessage: 'Searching…',
			akaHint: (alias) => `aka ${alias}`,
			universesHeading: 'Universes',
			noUniverseMatches: (query) => `No universes match "${query}".`,
			actionsHeading: 'Actions',
			emptyMessage: 'Nothing here. Try a different name, action or question.',
			accountSettingsAction: 'Account',
			footerMove: 'Move',
			footerOpen: 'Open',
			footerClose: 'Close'
		}
	},

	settings: {
		subNavAriaLabel: 'Settings sections',

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
			error: 'Pick a language from the list.',
			learnMorePrompt: "Wondering what gets translated and what doesn't?"
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
		},

		export: {
			title: 'Export',
			para1Before:
				'Every entry in a universe becomes one markdown file with YAML frontmatter, flat in one zip, plus a README naming the universe and the export date. ',
			para1After:
				' mentions are left exactly as written, because markdown is how Canonry stores canon (SPEC.md §13): what comes out of this zip is what is in the database, nothing rewritten to fit a different layout.',
			para2Before:
				"This is a flat dump, not a typed, git-ready folder: every file sits at the top level of the zip, named after the entry's slug. GM-only entries are included too, with their own ",
			para2After:
				" named in the frontmatter rather than hidden or filtered out - this is the GM's own copy, not what players would see.",
			emptyState: 'No universes yet.',
			downloadButton: 'Download .zip'
		},

		keys: {
			title: 'API keys',
			infoPara1Before: 'Bring your own key to use your own provider account instead of ours. ',
			infoPara1Bold: 'Off by default, for every provider, until you add one',
			infoPara1After: ' - SPEC.md §15 never makes this the default path.',
			infoPara2Bold: 'What changes:',
			infoPara2After:
				" a call routed on your key stops drawing on your included quota or your warm budget, and your own provider's rate limits apply instead of ours.",
			infoPara3Bold: 'What does not:',
			infoPara3After:
				' model routing is unchanged (the same cheap-model-for-candidates, premium-for-diffs split runs on your key exactly as on ours), the call still goes through our gateway so logging and cost accounting stay uniform, and generated content still carries the same authorship marking and the same privacy rules regardless of whose key paid for it.',
			infoPara3Link: 'Full policy',
			signInLink: 'Sign in',
			signInPrompt: 'to configure a key.',
			activeBadge: 'Active',
			offBadge: 'Off',
			keyEndingIn: (lastFour) => `Key ending in ${lastFour}`,
			addedOn: (date) => `added ${date}`,
			lastUsedOn: (date) => `last used ${date}`,
			neverUsedYet: 'never used yet',
			turnOff: 'Turn off',
			turnOn: 'Turn on',
			forgetKey: 'Forget this key',
			replaceKeyLabel: 'Replace key',
			addKeyLabel: 'Add key',
			apiKeyPlaceholder: (providerLabel) => `${providerLabel} API key`,
			replaceButton: 'Replace',
			saveButton: 'Save',
			savedConfirmation: (lastFour) =>
				`Saved - only the last four characters (…${lastFour}) are ever shown again.`,
			addSignInRequired: 'Sign in to add a key.',
			addPickProvider: 'Pick a provider from the list.',
			addPasteKey: 'Paste the key before saving.',
			addSaveFailedFallback: 'Could not save that key.',
			toggleSignInRequired: 'Sign in to change a key.',
			removeSignInRequired: 'Sign in to remove a key.',
			unknownProvider: 'Unknown provider.'
		},

		account: {
			title: 'Account',
			description:
				'The name and email the product prints on every screen, your password, and how to sign out everywhere or delete the account entirely.',
			signInPrompt: 'Sign in to see and change your account.',
			signInLink: 'Sign in',
			nameLabel: 'Name',
			nameSave: 'Save name',
			nameSaving: 'Saving…',
			nameSaved: 'Saved.',
			nameSaveFailedFallback: 'Could not save that name.',
			emailLabel: 'Email',
			emailNote: 'Email is not editable from this page yet.',
			passwordHeading: 'Password',
			currentPasswordLabel: 'Current password',
			newPasswordLabel: 'New password',
			passwordSave: 'Change password',
			passwordSaving: 'Changing…',
			passwordSaved: 'Password changed.',
			passwordSaveFailedFallback: 'Could not change your password.',
			sessionsHeading: 'Sessions',
			sessionsDescription:
				'Ends every signed-in session for this account, this device included, so you sign back in everywhere.',
			signOutEverywhereButton: 'Sign out everywhere',
			signOutEverywhereInProgress: 'Signing out everywhere…',
			signOutEverywhereFailedFallback: 'Could not sign out every session.',
			deleteHeading: 'Delete account',
			deleteUnavailable:
				'Account deletion is not turned on for this deployment yet, so there is no button here that would fail quietly - ask whoever runs this deployment to enable it in Better Auth\u2019s own configuration.'
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
		},
		footer: {
			whatCanonryIs: 'What Canonry is',
			docs: 'Docs',
			privacy: 'Privacy'
		},
		argument: {
			intro:
				'Change one entry and Canonry says which others that touches, drafts each update, and waits.',
			aldricSentence:
				'Dismissed from the watch in the thaw after the Sable Winter, he now answers to the Ashen Ledger.',
			watchLeadPrefix: 'The Watch is led by',
			watchBefore: 'Captain Aldric Vane',
			watchAfter: 'an acting captain, unnamed since the thaw',
			waitingBadge: 'waiting for you',
			evidence: 'Evidence: Aldric Vane, paragraph 1.',
			disclaimer:
				'Nothing above was applied. Every line a model writes waits for you to accept it, one entry at a time.'
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
	},

	docsLanguages: {
		title: 'What we translate, and what we do not',
		intro:
			'A GM about to hand over a decade of notes deserves a straight answer about language, not a feature list. Here is what Canonry promises, and where that promise stops.',
		interfaceHeading: 'The interface and the copilot speak your language',
		interfaceBody:
			"Chrome, buttons, empty states, error messages, dates and the numbers in your credits panel follow the language on your account - English or Italian today - wherever you're signed in, phone at the table included. Everything the copilot says to you follows the same preference: an Ask answer, a propagation plan's reason, an audit flag's rationale, all in your language, whatever language the canon underneath happens to be written in.",
		canonHeading: 'Your canon keeps its own language',
		canonBody:
			"This is the rule that actually matters, and it runs the other way. An entry's language is detected from what you already wrote in it, per entry, the moment it's saved - and you can override that if the detector gets it wrong. When the copilot drafts a paragraph that lands inside an entry, it writes in that entry's language, not yours: an Italian interface does not get to start writing Italian paragraphs into an English entry just because you're the one reading the screen. A propagation proposal can carry two languages at once, and both are correct - the drafted text is in the target entry's language, the reason it exists is in yours.",
		namesBody:
			'Names are never translated, by an import or by a proposal. "The Gilded Rat" stays "The Gilded Rat" in an Italian sentence, the way a person\u2019s name would.',
		retrievalHeading: 'Retrieval crosses the gap',
		retrievalBody:
			'None of the above is worth much if search only works within one language. Ask an Italian question and it has to find the English entry that answers it - that is what makes the embedding model a multilingual choice rather than an incidental one, and it is why "chi gestisce il Ratto Dorato" and "who runs the Gilded Rat Tavern" can point at the same inn.',
		noRewriteHeading: 'Nothing rewrites what you wrote',
		noRewriteBody:
			"The copilot proposes; it does not rewrite your prose on its own initiative, in any language. A drafted paragraph sits in your inbox like any other proposal until you accept it - there is no background job translating your world while you're not looking.",
		limitsHeading: 'What this does not include',
		limitsIntro: 'Stated plainly, because the limits are the part worth trusting:',
		limitLocales:
			'Two languages today. English and Italian, nothing else, at launch - a third is not on this page because it has not been decided, not because it would be hard.',
		limitNoBulkTranslation:
			'No bulk translation of an existing world. There is no button that rewrites everything you have already written into another language. Your prose is yours, and a mass rewrite is a background job Canonry does not run - a translated paragraph is a proposal like any other, one entry at a time, and it still needs your accept.',
		limitQuotations:
			'Quotations stay in their original language, always. The evidence behind a proposal is quoted verbatim from the entry it came from - translate it and it is no longer the sentence actually in your canon, and you cannot check it against the text. A translation can sit beside a quotation, clearly marked as ours, but never in place of it.',
		limitCopilotDirection:
			"When the copilot talks to you, it follows your interface language, not the entry's. Ask your Italian account about an English entry and the answer comes back in Italian - that is the opposite of the rule above, on purpose: one rule governs what gets written into your canon, this one governs what gets said to you about it."
	},

	entry: {
		page: {
			editLink: 'Edit',
			aliasesLabel: (aliases) => `also: ${aliases}`,
			pendingProposalsText: (count) =>
				count === 1
					? 'pending proposal on this entry \u00b7 review'
					: 'pending proposals on this entry \u00b7 review'
		},

		secrets: {
			hiddenBlock: 'Hidden \u00b7 unlocks on reveal',
			gmNoteBlock: 'GM note \u00b7 never shown to players',
			gmView: 'GM view',
			playerPreviewActive: 'Player preview, what the party sees',
			showGmView: 'Show GM view',
			playerPreview: 'Player preview'
		},

		language: {
			label: 'Language',
			autoDetect: 'Auto-detect',
			unsure: 'Not sure / mixed',
			detectedPrefix: (name) => `Detected: ${name}`,
			detectedUnknown: 'not enough text to tell'
		},

		complete: {
			button: 'Complete entry',
			completing: 'Completing\u2026',
			empty: 'Nothing to complete right now.',
			drafted: 'Drafted an update - now a pending proposal below.',
			genericFailure: 'Complete could not run.',
			aiOff: 'Writing is switched off for this universe.'
		},

		tabs: {
			ariaLabel: 'Entry detail',
			sectionsAriaLabel: 'Entry detail sections',
			relations: 'Relations',
			facts: 'Facts',
			images: 'Images',
			history: 'History',
			audit: 'Audit',
			mobile: {
				trigger: 'Details',
				closeLabel: 'Close details',
				description: 'Relations, facts, images, history and audit for this entry.'
			}
		},

		relations: {
			empty: 'No relations recorded yet.',
			explanation:
				'A relation appears once a propagation or import proposal that adds one is accepted.'
		},

		facts: {
			empty: 'No facts extracted yet.',
			explanation:
				"Facts come from an entry's own prose, pulled out by extraction that hasn't run for this entry yet."
		},

		history: {
			empty: 'No revisions yet.',
			explanation: 'A revision appears once an edit to this entry is saved and accepted.',
			revisionHuman: 'human',
			revisionAiAccepted: 'ai \u00b7 accepted'
		},

		audit: {
			empty: 'No flags on this entry right now.',
			disclaimer: 'Worth checking, not necessarily wrong.',
			dismiss: 'Dismiss',
			dismissing: 'Dismissing\u2026',
			openBoth: 'Open both entries:',
			toCheck: (count) => (count === 1 ? '1 to check' : `${count} to check`)
		},

		media: {
			aiOffBanner:
				'Generation is switched off for this universe. Existing images below still show, but nothing new can be generated until it is turned back on.',
			empty: 'No images yet.',
			explanation:
				'Images are generated on request, one click that always confirms the spend first.',
			privateNote: 'Private - not shown to players until you reveal this entry.',
			generatedBadge: 'Generated',
			generateButton: 'Generate image',
			candidatesSummary: (reusedFromCache, multiple) => {
				const lead = reusedFromCache
					? 'Reused from the similarity cache - not charged.'
					: 'Generated:';
				return multiple ? `${lead} pick one to insert.` : lead;
			},
			insert: 'Insert',
			inserting: 'Inserting\u2026',
			discard: 'Discard',
			styleOverrideLabel: 'Style override for this entry (leave blank to use the universe style)',
			save: 'Save',
			cancel: 'Cancel',
			genericGenerationFailedWithStatus: (status) => `Generation failed (${status})`,
			genericGenerationFailed: 'Generation failed',
			genericInsertFailedWithStatus: (status) => `Insert failed (${status})`,
			genericInsertFailed: 'Insert failed',
			styleSaveFailedWithStatus: (status) => `Saving the style override failed (${status})`,
			genericStyleSaveFailed: 'Saving the style override failed',
			dialogTitle: (entityName) => `Generate image: ${entityName}`,
			howManyAriaLabel: 'How many images',
			styleLabel: (modifier) => `Style: ${modifier && modifier.length > 0 ? modifier : 'none set'}`,
			editStyle: 'edit',
			fourOptions: 'Four options to choose from',
			oneImage: 'One image',
			notConfigured: 'not configured',
			suggestedForCharacter: '\u00b7 suggested for a character',
			// Same idiom as `settings.billing.creditsCount`: grouped digits, plural-aware unit.
			creditsLabel: (count) => {
				const n = numberFormat('en', { maximumFractionDigits: 0, useGrouping: 'always' }).format(
					count
				);
				const form = pluralRules('en').select(Math.round(count));
				return form === 'one' ? `${n} credit` : `${n} credits`;
			},
			privateHint:
				"The image stays private to you until you insert it here - it never reaches the players' wiki on its own.",
			generateAction: 'Generate',
			generating: 'Generating\u2026'
		},

		editor: {
			breadcrumbEdit: 'Edit',
			heading: (entityName) => `Edit ${entityName}`,
			save: 'Save',
			bodyAriaLabel: 'Entry body, markdown'
		},

		toolbar: {
			ariaLabel: 'Formatting',
			bold: 'Bold',
			italic: 'Italic',
			heading: 'Heading',
			list: 'Bulleted list',
			quote: 'Quote',
			link: 'Link',
			mention: 'Mention',
			mentionLabel: '@ Mention'
		},

		mentionMenu: {
			ariaLabel: 'Mention suggestions',
			matching: (query) => `Matching "${query}"`,
			noExactMatch: 'No exact match',
			noMatchBefore: (query) => `No entry named "${query}" yet. Close it with`,
			noMatchAfter: 'to leave an unresolved mention.',
			aliasLabel: (aliases) => `alias: ${aliases}`
		},

		errors: {
			universeNotFound: (slug) => `No universe named "${slug}"`,
			entryNotFound: (slug, universeName) => `No entry named "${slug}" in ${universeName}`,
			viewerCannotEdit: 'Viewers cannot edit entries',
			viewerCannotChangeLanguage: 'Viewers cannot change an entry\u2019s language',
			viewerCannotGenerateMedia: 'Viewers cannot generate or attach media',
			missingBody: 'Missing body',
			missingProposalId: 'Missing proposalId',
			missingLanguageChoice: 'Missing language choice',
			unknownLanguage: (choice) => `Unknown language "${choice}"`,
			completeCannotRun: (message) => `Complete cannot run: ${message}`,
			modifierMustBeString: 'modifier must be a string',
			featureInvalid: 'feature must be "portrait" or "variants"',
			generationOff: 'Generation is switched off for this universe.',
			notEnoughCredits: 'Not enough credits to generate this image.',
			mediaAssetIdMustBeString: 'mediaAssetId must be a string',
			noSuchGeneratedImage: 'No such generated image in this universe',
			alreadyAttached: 'That image is already attached to an entry, or does not exist.',
			noSuchImage: 'No such image in this universe'
		}
	},

	proposals: {
		title: 'Proposals',

		inbox: {
			empty: 'Nothing pending. Edit an entry to start a propagation run.',
			fromEntity: (entityName) => `From: editing ${entityName}`,
			fromTrigger: (trigger) => {
				const labels: Record<string, string> = {
					save: 'an edit',
					complete: 'completing an entry',
					audit: 'an audit pass',
					import: 'an import',
					table: 'table mode'
				};
				return `From: ${labels[trigger] ?? trigger}`;
			},
			entriesLabel: (total) => {
				const form = pluralRules('en').select(total);
				return `${total} ${form === 'one' ? 'entry' : 'entries'}`;
			},
			pendingLabel: (count) => `${count} pending`,
			importFrom: (playbook) => `From: ${playbook} import`,
			importSummary: (total, pending) => {
				const form = pluralRules('en').select(total);
				return `${total} ${form === 'one' ? 'proposal' : 'proposals'}: ${pending} pending`;
			},
			openImportReview: 'Open import review'
		},

		plan: {
			crumbCurrent: 'Plan',
			headingFromEntity: (entityName) => `Plan \u00b7 from editing ${entityName}`,
			headingFromPropagation: 'Plan \u00b7 from propagation'
		},

		checklist: {
			keptSuffix: (total, cap) => ` of ${total} kept \u00b7 cap ${cap}`,
			estimatedCredits: (credits) => {
				const form = pluralRules('en').select(credits);
				return {
					prefix: 'Est. ',
					suffix: form === 'one' ? ' credit to generate diffs' : ' credits to generate diffs'
				};
			},
			drop: 'Drop',
			empty: 'Nothing left in this plan.',
			generating: 'Generating\u2026',
			generateDiffs: (count) => `Generate diffs (${count})`,
			creditsUnit: 'cr'
		},

		queue: {
			empty: 'Nothing left to review.',
			position: (total) => ({ prefix: 'Proposal ', suffix: ` of ${total}` }),
			filterShown: (typeLabel) => `(${typeLabel} shown)`,
			acceptedSuffix: () => ' accepted',
			rejectedSuffix: () => ' rejected',
			acceptedToast: (entityName) => `Accepted ${entityName ?? 'entry'}`,
			undoFailedToast: 'Could not undo - nothing recorded to restore to.',
			undo: 'Undo',
			keyboardMove: 'move',
			keyboardAccept: 'accept',
			keyboardReject: 'reject',
			keyboardUndo: 'undo'
		},

		diffCard: {
			newEntry: 'New entry',
			accepted: 'accepted',
			rejected: 'rejected',
			accept: 'Accept',
			reject: 'Reject',
			undo: 'Undo',
			showCurrentWording: 'Show current wording',
			showWhatThisReplaced: 'Show what this replaced',
			was: 'Was',
			now: 'Now',
			kindLabel: (kind) => {
				const labels: Record<string, string> = {
					create: 'new',
					update: 'update',
					relation: 'relation',
					draft_entity: 'draft',
					flag: 'flag'
				};
				return labels[kind] ?? kind;
			},
			entityTypeLabel: (type) => {
				const labels: Record<string, string> = {
					character: 'character',
					place: 'place',
					faction: 'faction',
					item: 'item',
					event: 'event',
					session: 'session',
					relation: 'relation'
				};
				return labels[type] ?? type;
			},
			rejectReasonLabel: (value) => PROPOSAL_REJECT_REASON_LABELS_EN[value] ?? value
		},

		filterBuckets: {
			all: 'All',
			character: 'Characters',
			place: 'Places',
			faction: 'Factions',
			item: 'Items',
			event: 'Events',
			session: 'Sessions',
			relation: 'Relations'
		},

		bulkReject: {
			rejecting: 'Rejecting\u2026',
			rejectShown: (count) => `Reject ${count} shown`,
			rejectedCount: (count) => `Rejected ${count}.`
		},

		evidence: {
			button: 'Evidence',
			embeddingOnly: 'Embedding similarity only',
			close: 'Close',
			reasonRelation: (path, hops) => `relation ${path}, ${hops}-hop`,
			reasonMention: (direction, matchedText) => `${direction} mention ("${matchedText}")`,
			reasonEmbedding: 'similar wording only, no graph link',
			reasonImportAmbiguous: (path, count) => {
				const form = pluralRules('en').select(count);
				return `ambiguous match in "${path ?? 'the import'}", against ${count} existing ${form === 'one' ? 'entry' : 'entries'}`;
			},
			reasonImportMatched: (path) => `matched an existing entry in "${path ?? 'the import'}"`,
			reasonImportExtracted: (path) => `extracted from "${path ?? 'the import'}"`
		},

		rejectChips: {
			prompt: 'Why not?',
			wrong: PROPOSAL_REJECT_REASON_LABELS_EN.wrong,
			alreadyTrue: PROPOSAL_REJECT_REASON_LABELS_EN['already true'],
			notCanonYet: PROPOSAL_REJECT_REASON_LABELS_EN['not canon yet'],
			tooMuch: PROPOSAL_REJECT_REASON_LABELS_EN['too much'],
			prose: PROPOSAL_REJECT_REASON_LABELS_EN.prose,
			other: 'Other\u2026',
			otherPlaceholder: 'say more\u2026',
			save: 'Save'
		},

		errors: {
			noDiffsToGenerate:
				'This plan has no edited entry, so there are no propagation diffs to generate'
		}
	},

	import: {
		review: {
			headTitle: (universeName) => `Import review · ${universeName}`,
			breadcrumbProposals: 'Proposals',
			breadcrumbCurrent: 'Import review',
			heading: (playbook) => `Import review · ${playbook}`,
			stillImporting: (count) =>
				`Still importing — ${count} proposal${count === 1 ? '' : 's'} so far.`,
			refresh: 'Refresh',
			statusNote: {
				stoppedAtCeiling: (note) =>
					note
						? `Import paused at its credit ceiling: ${note}`
						: 'Import paused at its credit ceiling — restart it to continue where it left off.',
				cancelled: (note) => (note ? `Import cancelled: ${note}` : 'Import cancelled.'),
				failed: (note) => (note ? `Import failed: ${note}` : 'Import failed.')
			},
			emptyRunning: 'Nothing to review yet.',
			emptyRunningExplanation: 'Proposals appear here as the import processes each document.',
			emptyDone: 'Nothing to review — this import produced no proposals.',
			filtering: 'Filtering…',
			errors: {
				universeNotFound: (slug) => `No universe named "${slug}"`,
				jobNotFound: (jobId, universeName) => `No import job "${jobId}" in ${universeName}`,
				missingProposalId: 'Missing proposal ID.',
				proposalNotFound: (proposalId) => `No proposal "${proposalId}" in this job.`,
				missingProposalOrReason: 'Missing proposal ID or reason.',
				proposalNotRejected: 'That proposal is not rejected.',
				missingFilterType: 'Missing filter type.'
			}
		},

		start: {
			headTitle: 'New universe · Canonry',
			heading: 'Name your universe',
			description:
				"Everything in Canonry lives inside one. You can add more later from any universe's switcher.",
			nameLabel: 'Universe name',
			namePlaceholder: 'Valdoria Reach',
			importCard: {
				heading: 'Import a world',
				description:
					'Notes, a wiki export, or a PDF. Confirm what Canonry detected before anything runs.',
				cta: 'Import my world',
				badge: 'Default'
			},
			emptyCard: {
				heading: 'Start empty',
				description: 'Nothing to bring in yet. Add entries by hand from the switcher.',
				cta: 'Create empty'
			},
			preindexedCard: {
				heading: (baseName) => `Start from ${baseName}`,
				genericHeading: 'Derive from a pre-indexed universe',
				description: 'Pre-indexed. Your canon always wins over it, diverge entry by entry.',
				cta: (baseName) => `Start from ${baseName}`,
				notConfigured: 'No pre-indexed universe is configured on this deployment yet.'
			},
			errors: { nameRequired: 'Name your universe first.' }
		},

		upload: {
			headTitle: (universeName) => `Import into ${universeName} · Canonry`,
			heading: 'Import your world',
			description:
				'Drop an export from Obsidian, Kanka or World Anvil, or a PDF or DOCX file. Canonry guesses the source and shows you what it found before anything runs.',
			noLiveModelNotice:
				'This deployment has no live model configured, so only Obsidian, Kanka and generic-text exports can actually run right now (detection still works for everything).',
			uploadButton: 'Upload',
			confirm: {
				uploadedSummary: (fileName, kilobytes) => `${fileName} uploaded, ${kilobytes} KB`,
				detected: (label) => `Detected: ${label}`,
				notDetected: (label) => `Couldn't confidently detect a format: ${label}`,
				playbookLabel: 'Playbook to run',
				continueButton: 'Confirm and continue'
			},
			estimate: {
				heading: 'Import estimate',
				summary: (fileName, playbookLabel) => `${fileName}, ${playbookLabel} playbook`,
				sizeLabel: 'Size',
				documentCount: (count) => `${count} document${count === 1 ? '' : 's'}`,
				timeLabel: 'Time',
				estimatedMinutes: (minutes) => `about ${minutes} minute${minutes === 1 ? '' : 's'}`,
				costLabel: 'Cost',
				estimatedCredits: (credits) => {
					const n = numberFormat('en', { maximumFractionDigits: 0, useGrouping: 'always' }).format(
						credits
					);
					const form = pluralRules('en').select(Math.round(credits));
					return form === 'one' ? `${n} credit` : `${n} credits`;
				},
				startButton: 'Start import'
			},
			errors: {
				noUniverseGiven: 'No universe given to import into.',
				universeNotFound: (slug) => `No universe called "${slug}".`,
				chooseFile: 'Choose a file to upload.',
				unreadableFile: (fileName, message) => `Could not read "${fileName}": ${message}`,
				lostUpload: 'Lost track of the upload — try again.',
				needsLiveModel: (playbookLabel) =>
					`Starting a ${playbookLabel} import needs a live model, and this deployment has no AI_GATEWAY_* credentials configured. Obsidian, Kanka and generic text imports do not need one.`,
				noDocumentsFound: 'No documents this playbook recognises were found in the upload.',
				refused: {
					jobsQuota: 'This import was refused: you have reached your import job limit.',
					documentsQuota:
						'This import was refused: this import has too many documents for your plan.',
					insufficientCredits: 'This import was refused: not enough credits for the estimated cost.'
				}
			}
		},

		job: {
			headTitle: (universeName) => `Importing into ${universeName} · Canonry`,
			firstAcceptHeading: 'First accept',
			firstAcceptMessage: (seconds) =>
				`Accepted in ${seconds}s from the moment you started this import.`,
			headingRunning: 'Importing your world',
			headingTerminal: {
				finished: 'Import finished',
				stoppedAtCeiling: 'Import paused at its credit ceiling',
				cancelled: 'Import cancelled',
				failed: 'Import failed'
			},
			statusWord: {
				queued: 'queued',
				running: 'running',
				finished: 'finished',
				stopped_at_ceiling: 'stopped at ceiling',
				cancelled: 'cancelled',
				failed: 'failed'
			},
			statusLine: (proposalsEmitted, documentCount, statusWord) =>
				`${proposalsEmitted} proposal${proposalsEmitted === 1 ? '' : 's'} so far · ${documentCount} document${documentCount === 1 ? '' : 's'} total · status: ${statusWord}`,
			reviewNow: (count) => `Review ${count} now`,
			goToUniverse: (universeName) => `Go to ${universeName}`,
			errors: {
				jobNotFound: 'No such import job.',
				signInRequired: 'Sign in required.',
				proposalGone: 'That proposal is no longer part of this import.'
			}
		},

		liveFeed: {
			empty: 'No proposals yet.',
			explanation: 'Proposals appear here as the import produces them.',
			badge: {
				create: 'new',
				update: 'update',
				relation: 'relation',
				draft_entity: 'draft',
				flag: 'flag'
			},
			untitledProposal: 'Untitled proposal',
			accept: 'Accept',
			accepted: 'accepted',
			outcome: { rejected: 'rejected', superseded: 'superseded' }
		}
	},

	table: {
		title: 'Table',

		contextStrip: {
			modeOn: 'Table mode: on',
			noPlaceDeclared: (universeName) => `no place declared yet - ${universeName}`,
			pinnedIn: (ms) => `pinned in ${ms}ms`,
			change: 'Change',
			exit: 'Exit table mode'
		},

		declareContext: {
			formLabel: 'Declare context',
			whereArePlayers: 'Where are the players?',
			placePlaceholder: 'Type a place name...',
			placeCandidatesLabel: 'Place candidates',
			placeTag: 'place',
			noPlaceMatch: (query) => `No place matches "${query}".`,
			sessionLabel: 'Session (needed for "mark as revealed")',
			noSessionOption: 'No session declared',
			cancel: 'Cancel',
			declare: 'Declare'
		},

		pinnedCards: {
			empty:
				'No relations two hops from the declared place yet - the pinned column fills in once one exists.',
			listLabel: 'Pinned by the declared place',
			declaredPlace: 'the declared place',
			hopsFromPlace: (hops) => `${hops} hop${hops === 1 ? '' : 's'} from the declared place`,
			warmBriefAt: (relativeTime) => `warm brief · ${relativeTime}`,
			staleSince: (relativeTime) => `stale since ${relativeTime}, refreshes next trigger`,
			notWarmedThisSession: 'not warmed this session',
			justNow: 'just now',
			minutesAgo: (minutes) => `${minutes}m ago`,
			hoursAgo: (hours) => `${hours}h ago`
		},

		phoneTabBar: {
			navLabel: 'Table mode sections',
			here: 'Here',
			actions: 'Actions',
			ask: 'Ask',
			queue: 'Queue'
		},

		actionLabels: {
			npcHere: '+ NPC here',
			createChildLocation: '+ Create a child location',
			quickNote: 'quick note'
		},

		quickActionDock: {
			markAsRevealed: 'Mark as revealed',
			markAsRevealedDisabledTitle: 'Declare a session to mark places as revealed',
			drafting: 'Drafting…',
			more: 'More',
			nameChildLocation: 'Name the child location',
			locationPlaceholder: 'e.g. The Salt Cellar',
			create: 'Create',
			jotNote: 'Jot a note'
		},

		quickNoteForm: {
			formLabel: 'Jot a quick note',
			disclaimer:
				'Never applied directly - this becomes a pending proposal, reviewed like any other, after the session.',
			about: 'About',
			note: 'Note',
			notePlaceholder: 'e.g. Aldric flinched when I mentioned the ledger',
			cancel: 'Cancel',
			saveAsProposal: 'Save as a proposal'
		},

		instantSearch: {
			whoIsThis: 'Who is this?',
			placeholder: 'Type a name or alias...',
			searching: 'searching…',
			instantLane: 'instant lane',
			fastLane: 'fast lane',
			laneStatus: (laneName, ms) => `${laneName} · ${ms}ms`,
			noMatch: (query) => `No match for "${query}".`,
			aka: (alias) => `aka ${alias}`
		},

		ambientPlayer: {
			heading: 'Ambient soundscape',
			showAudioGraph: 'Show audio graph',
			hideAudioGraph: 'Hide audio graph',
			noPackYet: 'No ambient pack generated for this place yet.',
			layerSummary: (count, stale) => {
				const layers = count === 1 ? 'layer' : 'layers';
				return `${count} ${layers}${stale ? ' · stale, refreshes next trigger' : ''}`;
			},
			play: 'Play',
			starting: 'Starting…',
			audioPausedByBrowser: 'Audio is paused by the browser until you interact with the page.',
			enableAudio: 'Enable audio',
			layersFailedToLoad: (count) => `${count} layer${count === 1 ? '' : 's'} failed to load.`,
			master: 'Master',
			crossfade: 'Crossfade',
			muteLayer: (prompt) => `Mute ${prompt}`,
			unmuteLayer: (prompt) => `Unmute ${prompt}`,
			couldNotLoadPack: (status) => `Could not load the ambient pack (${status})`,
			couldNotStart: 'Could not start the soundscape',
			crossfadeFailed: 'Crossfade failed',
			layersAriaLabel: 'Ambient layers'
		},

		home: {
			noContextDeclared: 'Declare a place to pin its main characters and relations.',
			pinnedHeading: 'Pinned',
			quickActionsHeading: 'Quick actions',
			askHeading: 'Ask',
			askNotBuilt: 'Ask is not built in this wave.',
			askOpensFromPalette: (shortcut) =>
				`Once it ships, it opens from the command palette (${shortcut}).`,
			proposalsHeading: 'Proposals from this session',
			proposalsEmpty: 'Nothing yet. Fire a quick action or jot a note to see one land here.',
			proposalLabel: 'proposal',
			from: (source) => `from: ${source}`,
			aiDraftedTooltip: 'A model drafted this - still unapplied until you accept it in Proposals.',
			aiDraftedBadge: 'AI-drafted',
			scaffoldBadge: 'scaffold, no model',
			scaffoldTooltipDefault: 'No model was available for this draft.',
			aiUnavailable: (reason) => `AI unavailable: ${reason}`,
			streamStatus: (count, lastId) => {
				const events = count === 1 ? 'event' : 'events';
				const suffix = lastId !== null ? ` · last id ${lastId}` : '';
				return `stream: ${count} ${events} received${suffix}`;
			},
			draftingNpc: 'Drafting an NPC…',
			actionFailed: (action, reason) => `${action} failed: ${reason}`,
			unknownReason: 'unknown reason',
			savedAsProposal: (via) => `Saved as a proposal (${via})`,
			savedAsProposalScaffold: (via) =>
				`Saved as a proposal (${via}, no model - a scaffold to fill in)`,
			markedRevealed: (name) => `${name} marked as revealed`,
			noteSaveFailed: 'Could not save that note',
			sessionEnded: (proposalCount) =>
				`Session ended. ${proposalCount} proposal${proposalCount === 1 ? '' : 's'} arrived while you played.`
		},

		server: {
			notFound: 'Not Found',
			declareBeforeAction:
				'declare a place before firing a quick action - every action here is "linked to the context"',
			nameLocationBeforeCreating: 'name the child location before creating it',
			unknownActionKind: (kind) => `unknown quick action kind "${kind}"`,
			noSessionDeclared:
				'mark as revealed needs a declared session - set one when declaring context first',
			noteEmpty: 'the note is empty',
			pickNoteTarget: 'pick which entry this note is about',
			entryNotFound: 'that entry does not exist in this universe',
			noteProposalFailed: 'could not create the note proposal',
			nothingIndexedYet: 'nothing indexed yet for this universe',
			embeddingFailed: (reason) => `embedding the query failed (${reason})`,
			quickNoteRationale: (hadPlaceDeclared) =>
				`Captured as a quick note at the table${hadPlaceDeclared ? ' while a place was declared' : ''}. Never applied directly - review it like any other proposal.`,
			npcDraftedRationale: (placeName) =>
				`Drafted via the "+ NPC here" quick action while ${placeName} was the declared context.`,
			npcScaffoldRationale: (placeName, unavailableReason) =>
				`Drafted via "+ NPC here" while ${placeName} was the declared context. AI drafting was unavailable (${unavailableReason}), so this is an empty scaffold for the GM to fill in rather than a discarded tap.`,
			createLocationRationale: (placeName) =>
				`Created via the child-location quick action while ${placeName} was the declared context.`,
			warmBudgetUnavailable: 'the warm budget could not cover this draft right now',
			warmStatusNoProposal: (status) => `warm status "${status}" produced no new proposal`
		}
	},

	works: {
		types: {
			oneshot: 'Oneshot',
			module: 'Module',
			campaign: 'Campaign',
			story: 'Story',
			novel: 'Novel'
		},
		statuses: {
			planning: 'Planning',
			running: 'Running',
			finished: 'Finished',
			abandoned: 'Abandoned'
		},
		kinds: {
			act: 'Act',
			chapter: 'Chapter',
			scene: 'Scene',
			encounter: 'Encounter'
		},
		errors: {
			workNeedsName: 'A work needs a name',
			pickWorkType: 'Pick a work type',
			nodeNeedsTitle: 'A node needs a title',
			pickNodeKind: 'Pick a node kind',
			missingBody: 'Missing body'
		},
		index: {
			title: 'Works',
			description:
				"A oneshot, a module, a campaign, a story or a novel: an ordered tree of acts, chapters, scenes and encounters, separate from the universe's canon. What happens while writing or playing one flows back as proposals, never as a direct write (SPEC.md §4.3).",
			empty: 'No works yet.',
			emptyAction: 'New work',
			createHeading: 'Start a new work',
			nameLabel: 'Name',
			typeLabel: 'Type',
			summaryLabel: 'Summary',
			summaryOptional: '(optional)',
			createButton: 'Create work'
		},
		tree: {
			ariaLabel: 'Work tree',
			emptyHeading: (workName) => `Nothing in ${workName} yet`,
			emptyHint:
				'Add the first node - usually an act, but a short oneshot can start straight at a scene.',
			pickNodeHint: 'Pick a node from the tree on the left, or add another one at the root here.',
			titleLabel: 'Title',
			kindLabel: 'Kind',
			addNodeButton: 'Add node'
		},
		node: {
			moveUp: '↑ Move up',
			moveDown: '↓ Move down',
			titleSrLabel: 'Title',
			save: 'Save',
			addChildSummary: (nodeTitle) => `Add a node under ${nodeTitle}`,
			titleLabel: 'Title',
			kindLabel: 'Kind',
			addNodeButton: 'Add node',
			usesHeading: 'Uses',
			noUses: 'No entries mentioned yet.',
			changedAt: (when) => `changed ${when}`,
			usesHint:
				'Open an entry to read what changed. Accepting a propagation happens there, or in Review.'
		}
	},

	universe: {
		nav: {
			entries: 'Entries',
			works: 'Works',
			proposals: 'Proposals',
			table: 'Table',
			players: 'Players',
			import: 'Import',
			settings: 'Settings'
		},

		sidebar: {
			navAriaLabel: 'Universe navigation',
			primaryNavAriaLabel: 'Primary',
			askTheLoremaster: 'Ask the Loremaster',
			recentHeading: 'Recent',
			notBuiltYet: (issue) => `Not built yet, issue #${issue}`
		},

		switcher: {
			switchAriaLabel: 'Switch universe',
			derivedBadge: 'derived',
			derivedFrom: (baseUniverseName) => `derived from ${baseUniverseName}`,
			entryCount: (count) => (count === 1 ? '1 entry' : `${count} entries`),
			allUniverses: 'All universes',
			newUniverse: 'New universe'
		},

		index: {
			homebrewEyebrow: 'Homebrew universe',
			derivedEyebrow: 'Derived universe',
			derivedNoticeBefore: 'Derived: reads its own canon plus ',
			derivedNoticeAfter: "'s indexed corpus, read-only. Your canon always wins (SPEC.md 4.1).",
			newEntryAction: 'New entry',
			strip: {
				collapseLabel: 'Collapse',
				expandLabel: 'Expand overview',
				whatChangedHeading: 'What changed',
				whatChangedEmpty: 'Nothing changed yet.',
				waitingForReviewHeading: 'Waiting for review',
				quotaHeading: 'Quota',
				quotaValue: (used, total) => {
					const fmt = numberFormat('en', { maximumFractionDigits: 0, useGrouping: 'always' });
					return `${fmt.format(used)} / ${fmt.format(total)} credits`;
				},
				currentWorkHeading: 'Current work',
				currentWorkEmpty: 'Nothing in progress.',
				currentWorkValue: (workName, nodeTitle) => `${workName} \u00b7 ${nodeTitle}`
			},
			filters: {
				all: 'All',
				typeLabel: (type) => {
					const labels: Record<string, string> = {
						character: 'Character',
						place: 'Place',
						faction: 'Faction',
						event: 'Event',
						item: 'Item'
					};
					return labels[type] ?? type;
				}
			},
			searchPlaceholder: 'Search by name or alias\u2026',
			changedAt: (when) => `changed ${when}`,
			emptyColdMessage: 'Nothing here yet. Start with your first entry.',
			emptyFilteredMessage: 'No entries match this filter or search.',
			relativeTime: {
				justNow: 'just now',
				minutesAgo: (minutes) => `${minutes}m ago`,
				hoursAgo: (hours) => `${hours}h ago`,
				daysAgo: (days) => `${days}d ago`,
				weeksAgo: (weeks) => `${weeks}w ago`,
				monthsAgo: (months) => `${months}mo ago`
			},
			newEntryDialog: {
				title: 'New entry',
				description:
					'A name and a type is enough to start - everything else is written in the editor.',
				nameLabel: 'Name',
				typeLabel: 'Type',
				submit: 'Create and open',
				cancel: 'Cancel',
				nameRequiredError: 'A name is required.',
				typeRequiredError: 'Pick a type.',
				viewerForbiddenError: 'Viewers cannot create an entry.'
			}
		},

		list: {
			heading: 'Your universes',
			newUniverse: 'New universe'
		},

		ask: {
			headTitle: (universeName) => `Ask: ${universeName}`,
			crumb: (universeName) => `Ask · ${universeName}`,
			placeholder: 'Ask about this universe…',
			ask: 'Ask',
			asking: 'Asking…',
			askFailed: 'Ask failed.',
			questionRequired: 'A question is required.',
			methodNotAllowed: 'POST a question to ask.',
			noLiveModel:
				'Generation is switched off for this universe: this reads your own canon directly, at no cost, rather than a model-written answer.',
			levels: {
				'1_line': '1 line',
				short: 'Short',
				normal: 'Normal',
				detailed: 'Detailed',
				full: 'Full'
			},
			ownCanonLabel: 'your canon',
			indexedBadge: 'indexed',
			close: 'Close',
			loading: 'Loading…'
		},

		settings: {
			headTitle: (universeName) => `Settings: ${universeName}`,
			heading: 'Settings',
			introBefore: (universeName) =>
				`Universe settings for ${universeName}. The colour theme and the account's export live in `,
			introAnd: ' and ',
			introAfter: ', which apply to the whole account rather than one universe.',
			appearanceLink: 'Appearance',
			exportLink: 'Export',
			viewerForbiddenError: 'Viewers cannot change this setting.',
			aiToggle: {
				heading: 'Loremaster writing',
				description: (universeName) =>
					`Turns off new proposals, images, Ask and warm pre-computation for ${universeName}. Search and mention suggestions keep reading this universe, and cost nothing.`,
				stopWriting: 'Stop writing',
				resumeWriting: 'Resume writing',
				offNotice: (universeName) =>
					`Writing is off for ${universeName}. Search and mention suggestions still spend from your included quota like any other request; they simply cost nothing, on or off.`
			},
			precedence: {
				heading: 'Precedence',
				description: (universeName) =>
					`Your canon always wins. A source page an entry here supersedes is marked below, not deleted, and stops coming back from retrieval for ${universeName} (SPEC.md §4.1).`,
				empty: 'Nothing superseded yet.',
				supersededBadge: 'superseded',
				remove: 'remove',
				declareHeading: 'Declare a supersede',
				entryLabel: 'Your entry',
				baseSourceLabel: 'Base source',
				sourceUrlLabel: 'Source page url',
				noteLabel: 'Note',
				optional: '(optional)',
				submit: 'Supersede',
				onlyDerivedError: 'Only a derived universe can supersede a source page.',
				pickEntryError: 'Pick which entry supersedes the page.',
				pickSourceError: 'Pick which source the page belongs to.',
				sourceUrlRequiredError: 'The source page needs a url.',
				alreadySupersededError: 'This page is already superseded.',
				missingIdError: 'Missing supersede id.'
			}
		}
	},

	admin: {
		unattributed: 'unattributed',
		save: 'Save',

		models: {
			browserTitle: 'Models, Canonry admin',
			textHeading: 'Text models',
			textIntro1:
				'SPEC.md §11.1: the active model per purpose lives in <code class="text-xs">model_config</code>, not in code, and every flow - the Loremaster\'s four modes, propagation, warm generation, indexing, embedding - reads it through <code class="text-xs">resolveModel</code>. A change here takes effect on the very next call, no deploy, no restart. Provider is constrained to what <code class="text-xs">createLanguageModel</code> can actually build; a provider outside that list is not offered.',
			textIntro2:
				'SPEC.md §17, issue #125: an Italian question against an English canon has to find the English chunk, so the <strong>embedding</strong> purpose is a deliberate multilingual choice, not a free one. Candidates were compared on published multilingual retrieval benchmarks (MIRACL, MTEB Multilingual) restricted to providers this build can construct - full reasoning and the disqualified/fallback candidates are in <code class="text-xs">packages/indexing/src/models.ts</code>\'s <code class="text-xs">RECOMMENDED_EMBEDDING_MODEL</code>. Recommended: <code class="text-xs">google</code> / <code class="text-xs">gemini-embedding-001</code> (#1 on the MTEB Multilingual leaderboard, ~100 languages). Gap this box cannot close: no live embedding credential exists here to confirm en/it recall specifically - neither MIRACL nor MTEB publish an isolated English&harr;Italian score, so that is a live benchmark still owed once a real credential exists, not a settled number.',
			table: {
				purpose: 'Purpose',
				currentlyActive: 'Currently active',
				provider: 'Provider',
				modelId: 'Model id',
				notConfigured: 'not configured',
				providerUnknown: (provider) =>
					`provider "${provider}" is not one of this app's known providers - no call can be built for it until this is changed.`
			},
			purposeLabel: {
				cheap: 'Cheap - candidate generation, quick actions',
				premium: 'Premium - diffs, ask, propagation',
				multimodal: 'Multimodal',
				embedding:
					'Embedding - similarity search, warm cache dedup, retrieval (must be multilingual - see note below)',
				image: 'Image (text purpose; see Image models below for the generator itself)'
			},
			saved: 'Saved. Takes effect immediately.',
			imageHeading: 'Image models',
			imageIntro1:
				'SPEC.md §9, issue #64: the active model per feature lives here, not in code, and a change here takes effect on the very next "Generate image" request - no deploy, no restart.',
			imageIntro2Pre:
				'Seeded default: <code class="text-xs">prunaai/p-image</code> for a single portrait, <code class="text-xs">black-forest-labs/flux-schnell</code> for the four-variant batch (SPEC.md §9). EUR per image is our own cost bookkeeping, never the credit price a GM sees - that lives in',
			imageTable: {
				feature: 'Feature',
				eurPerImage: 'EUR / image',
				active: 'active',
				inactive: 'inactive'
			},
			featureLabel: {
				portrait: 'Portrait - one image per request',
				variants: 'Variants - up to four to choose from',
				scene: 'Scene'
			},
			errors: {
				unknownPurpose: (purpose) => `"${purpose}" is not a known model purpose.`,
				unknownProvider: (provider, choices) =>
					`"${provider}" is not a known provider. Choose one of: ${choices}.`,
				modelIdRequired: 'Model id is required.',
				providerAndModelIdRequired: 'Provider and model id are required.',
				invalidEurPerImage: 'Enter a non-negative EUR-per-image cost, up to 6 decimal places.'
			}
		},

		metrics: {
			browserTitle: 'Metrics, Canonry admin',
			heading: 'Metrics',
			intro:
				'SPEC.md §14 and decision F5: the two numbers that decide whether the copilot works, plus the three that say whether the rest of the product does. Staff only, and deliberately not shown to the GM - a GM optimising their own accept rate is a strange incentive on both sides of the relationship.',
			table: {
				produced: 'Produced',
				accepted: 'Accepted',
				rejected: 'Rejected',
				rate: 'Rate',
				universe: 'Universe',
				noDataYet: 'no data yet'
			},
			noUniversesYet: 'No universes yet.',
			accept: {
				heading: 'Accept rate',
				intro: (windowDays) =>
					`Issue #100. <code class="text-xs">proposal.outcome</code>, \`superseded\` and \`pending\` excluded from the denominator - computed by <code class="text-xs">@canonry/eval</code>'s <code class="text-xs">acceptRate</code>, the same function the propagation corpus scores prompt and model changes against. Window: last ${windowDays} days.`,
				noProposalsYet:
					'No proposals have been produced yet. A 0% accept rate here would be a lie by omission, not an honest reading, so this panel shows nothing until there is something to show.',
				acceptRateLabel: 'Accept rate (decided proposals)',
				table: { weekOf: 'Week of', kind: 'Kind', model: 'Model' },
				byLocale: {
					heading: 'By interface locale',
					intro:
						'Issue #128, SPEC.md §17 "instrumented per locale": <code class="text-xs">proposal.locale</code> - the interface language the proposal\'s speech was produced in, computed by the same <code class="text-xs">acceptRate</code> above. A locale with no proposals yet reads as "no data", never a fabricated 0%.',
					localeLabel: 'Locale'
				}
			},
			timeToFirstAccept: {
				heading: 'Time to first accepted proposal',
				intro:
					"Issue #101. From an import's start to its first accepted proposal, per universe, as a distribution: one slow outlier is the churn event AGENTS.md worries about, and an average would hide exactly that outlier.",
				noImportsYet: 'No imports have run yet.',
				noAcceptYet: (count) => {
					const noun = pluralRules('en').select(count) === 'one' ? 'import' : 'imports';
					return `${count} ${noun}, none with an accepted proposal yet.`;
				},
				summary: (accepted, total, median) => {
					const noun = pluralRules('en').select(total) === 'one' ? 'import' : 'imports';
					return `${accepted} of ${total} ${noun} have a first accept, median ${median}.`;
				},
				importStarted: 'Import started',
				timeToFirstAcceptLabel: 'Time to first accept',
				stillWaiting: 'still waiting'
			},
			warmRadius: {
				heading: 'Warm radius',
				intro: (thresholdPercent) =>
					`Issue #102. Warm hit rate - consumed artifacts over generated ones - governs the warm radius automatically: below ${thresholdPercent}% it shrinks from ring 2 to ring 1. This is the same read <code class="text-xs">warmOnConsumption</code> uses to decide how far to reach, not a separate estimate.`,
				consumed: 'Consumed',
				generated: 'Generated',
				hitRate: 'Hit rate',
				currentRadius: 'Current radius',
				ring: (n) => `ring ${n}`
			},
			entropy: {
				heading: 'Canon entropy',
				intro:
					'Issue #103. Entries updated after a session versus created in prep, per universe - the metric that says whether canon entropy was actually solved or whether this is just another place to write things down.',
				createdInPrep: 'Created in prep',
				updatedAfterSession: 'Updated after a session'
			}
		},

		pricing: {
			browserTitle: 'Operation pricing, Canonry admin',
			title: 'Operation pricing',
			intro1:
				'SPEC.md §15, issue #113: the credit price of every chargeable operation lives here, not in code, and a change here takes effect immediately, not after a cache expiry. A price of <b class="text-ink">zero</b> means the operation is free to the user: that is the whole mechanism behind reading staying free, not a special case bolted on elsewhere.',
			intro2:
				'Free to the user is not free to us: every call, priced or not, is still recorded in full with its real tokens and euro cost, because the margin question is answered from those rows and nowhere else.',
			kindLabel: {
				reading: 'Reading, always free',
				generation: 'Generation, charged',
				import: 'Import, charged per document'
			},
			table: {
				label: 'Label',
				operation: 'Operation',
				credits: 'Credits',
				notes: 'Notes',
				lastChange: 'Last change'
			},
			creditsFor: (label) => `Credits for ${label}`,
			saved: 'Saved.',
			lastChangeSummary: (from, to, changedBy, date) =>
				`${from} → ${to} credits, ${changedBy}, ${date}`,
			noChangesYet: 'No changes since it was seeded.',
			errors: {
				missingOperation: 'Missing operation.',
				invalidCredits: 'Enter a non-negative number, up to 4 decimal places.',
				unknownOperation: (operation) => `"${operation}" is not a known operation.`
			}
		}
	},

	docs: {
		hub: {
			browserTitle: 'Docs',
			title: 'Guides',
			intro:
				'Practical guides for getting a world into Canonry and anything else that needs plain instructions rather than a spec section.',
			importHeading: 'Import guides',
			importIntro:
				'One page per source, with the export steps to follow before you upload anything: Obsidian, Kanka, World Anvil, OneNote, PDF, DOCX, and the generic path for anything else.',
			importLink: 'Read the import guides',
			languagesHeading: 'Languages',
			languagesIntro:
				'What the interface translates, what your canon keeps in its own language, and why Canonry will not machine-translate a world you already wrote.',
			languagesLink: "Read what's translated, and what isn't"
		},
		importIndex: {
			title: 'Import guides',
			eyebrow: 'Docs',
			intro:
				'Canonry does not ask you to pick a source before you upload anything. Drop a folder or a file, and it looks at its shape, tells you what it thinks it found, and asks you to confirm (or pick a different playbook from a short list) before it reads any further. These guides exist so the file you hand it is the right one to begin with: what to export from wherever your world lives now, and what Canonry does and does not understand once it gets there.',
			sourcesHeading: 'Sources'
		},
		importGuide: {
			browserTitle: (guideLabel) => `${guideLabel} import guide`,
			eyebrow: 'Import guides'
		},
		privacy: {
			title: "Where your campaign's words go"
		}
	}
};
