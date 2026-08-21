import { RELATION_TYPE_CATALOGUE } from '@canonry/lang';
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

// #196 (decision L1) / #197: the shipped catalogue's ten keys (#195, fixed, API surface
// from the day they ship), each mapped to their display pair. Owned by
// `packages/copilot/src/relation-catalogue.ts`, not duplicated here - the resolver
// (`resolveRelationType`, #197) needs the exact same strings to match a proposed label
// in any locale, so there is one literal per language, not two. A universe's own type
// has no entry here on purpose - see `Messages.relationTypeLabel`'s doc comment.
const RELATION_TYPE_CATALOGUE_EN = RELATION_TYPE_CATALOGUE.en;

export const en: Messages = {
	relationTypeLabel: (key) => RELATION_TYPE_CATALOGUE_EN[key],
	controls: {
		search: 'Search',
		noMatch: 'No match',
		apply: 'Apply',
		modelRunning: {
			elapsed: (seconds) => `${seconds}s`,
			slow: 'A long draft can take a minute.'
		}
	},
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
			},
			setupWarning: (count) =>
				count === 1 ? '1 setting left to finish' : `${count} settings left to finish`
		},
		quota: {
			includedHeading: 'Included quota',
			// Issue #201: "Table prep" is the label, not the key - `warm_budget_credits`,
			// `warm_budget_spent`, `spendWarmBudget` and `warmBudgetRemaining` keep their
			// names everywhere else.
			warmHeading: 'Table prep',
			// Same idiom as `settings.billing.creditsCount`: grouped digits, no
			// fractional credits shown - this is the same `subscriptionCredits`/
			// `warmBudgetRemaining` figure that page renders, formatted the same way.
			ratio: (remaining, total) => {
				const fmt = numberFormat('en', { maximumFractionDigits: 0, useGrouping: 'always' });
				return `${fmt.format(remaining)} / ${fmt.format(total)}`;
			},
			includedExplainLabel: 'What included quota pays for',
			includedPopoverBody:
				"Pays for drafted entries, propagation plans and diffs, Ask answers, images, and an import's extraction. Reading is free: search, mention suggestions, and the retrieval behind an Ask never move this bar.",
			warmExplainLabel: 'What table prep pays for',
			warmPopoverBody:
				'The drafts Canonry prepares before a session so table mode can answer instantly. Canonry spends this on its own, without anyone asking, which is why it has its own limit and never draws on included quota.',
			renews: (date) => `Renews ${date}`,
			noRenewalDate: 'No renewal date on record yet.'
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
			askPlaceholder: 'Ask about this universe…',
			sendLabel: 'Send',
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
		},
		// Issue #285 (decision O3): the chrome carries none of the copilot's hue, so the name
		// and the glyph are the only things saying this is the copilot. "Loremaster" is a
		// product name and stays untranslated in both catalogues, like "Canonry" itself.
		quickAsk: {
			name: 'Loremaster',
			openLabel: 'Open the Loremaster',
			closeLabel: 'Close the Loremaster',
			launcherHint: 'Ask what your canon already says.',
			context: (pageName) => `about ${pageName}`,
			disclosure:
				'Every question here is answered and kept automatically, as your own note grouped into a conversation: it never becomes part of an entry without a proposal you accept, players never see it, and it stays until you delete the conversation. ',
			openInAsk: 'Open in Ask',
			// R6 (round thirteen, #381): three deterministic suggestions, never from a model.
			// `connects` reads the six-value entity type, the same one-function-per-catalogue
			// pattern `entityTypeLabel` uses below rather than a key per type.
			suggestions: {
				entry: {
					summary: (entityName) => `What do we know about ${entityName}?`,
					connects: (entityType, entityName) => {
						const templates: Record<string, string> = {
							character: `Who does ${entityName} know?`,
							place: `What's happened at ${entityName}?`,
							faction: `Who's aligned with ${entityName}?`,
							item: `Where has ${entityName} turned up?`,
							event: `Who was there when ${entityName} happened?`,
							session: `What happened during ${entityName}?`
						};
						return templates[entityType] ?? `What connects to ${entityName}?`;
					},
					gaps: (entityName) => `What's still missing on ${entityName}?`
				},
				world: {
					shape: "What's the shape of this world so far?",
					recent: "What's been added recently?",
					gaps: 'Where are the gaps?'
				},
				proposals: {
					pending: "What's waiting for review?",
					oldest: "What's the oldest pending proposal?",
					conflicts: 'Is anything likely to conflict?'
				}
			}
		}
	},

	settings: {
		subNavAriaLabel: 'Settings sections',

		appearance: {
			title: 'Appearance',
			description:
				'This is light or dark for the whole product: it changes the palette everywhere, table mode included. It does not change type size, density or anything else.',
			light: 'Light',
			dark: 'Dark',
			system: 'Match system',
			save: 'Save',
			saving: 'Saving…',
			error: 'Pick light, dark or match system.'
		},

		language: {
			title: 'Language',
			description:
				'The language the interface and the Loremaster speak to you in. This is a preference on your account, so it follows you to the phone at the table - it is not the language your canon is written in, which stays whatever each entry was written in.',
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
				'Included quota with routing between cheap and premium models. No opaque credits, and no plan here is ever called "unlimited" - every plan states a real ceiling.',
			signInPrompt: 'Sign in to see your plan and balance.',
			signInLink: 'Sign in',
			checkoutCancelled: 'Checkout was cancelled - your plan has not changed.',
			currentPlan: (planName) => `Current plan: ${planName}`,
			renews: (date) => `Renews ${date}`,
			noRenewalDate: 'No renewal date on record yet.',
			includedThisPeriod: 'Included this period',
			purchased: 'Purchased (never expires)',
			warmBudget: 'Table prep',
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
			switchTo: (planName) => `Switch to ${planName}`,
			redirecting: 'Redirecting…'
		},

		export: {
			title: 'Export',
			para1Before:
				'Every entry in a universe becomes one markdown file with YAML frontmatter, flat in one zip, plus a README naming the universe and the export date. ',
			para1After:
				' mentions are left exactly as written, because markdown is how Canonry stores canon: what comes out of this zip is what is in the database, nothing rewritten to fit a different layout.',
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
			infoPara1After: '.',
			infoPara2Bold: 'What changes:',
			infoPara2After:
				" a call routed on your key stops drawing on your included quota or your table prep, and your own provider's rate limits apply instead of ours.",
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
			turningOff: 'Turning off…',
			turningOn: 'Turning on…',
			forgetKey: 'Forget this key',
			forgetting: 'Forgetting…',
			replaceKeyLabel: 'Replace key',
			addKeyLabel: 'Add key',
			apiKeyPlaceholder: (providerLabel) => `${providerLabel} API key`,
			replaceButton: 'Replace',
			replacingKey: 'Replacing…',
			saveButton: 'Save',
			savingKey: 'Saving…',
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
			nameRequired: 'Enter a name.',
			emailLabel: 'Email',
			emailNote: 'Email is not editable from this page yet.',
			passwordHeading: 'Password',
			currentPasswordLabel: 'Current password',
			newPasswordLabel: 'New password',
			passwordSave: 'Change password',
			passwordSaving: 'Changing…',
			passwordSaved: 'Password changed.',
			passwordSaveFailedFallback: 'Could not change your password.',
			passwordRequired: 'Enter your current password and the new one.',
			sessionsHeading: 'Sessions',
			sessionsDescription:
				'Ends every signed-in session for this account, this device included, so you sign back in everywhere.',
			signOutEverywhereButton: 'Sign out everywhere',
			signOutEverywhereInProgress: 'Signing out everywhere…',
			signOutEverywhereFailedFallback: 'Could not sign out every session.',
			deleteHeading: 'Delete account',
			deleteIntro:
				'This closes the account for good. There is no recovery once the confirmation mail is followed.',
			deleteImpact: (impact) => {
				const universes = impact.universes === 1 ? '1 universe' : `${impact.universes} universes`;
				const entities = impact.entities === 1 ? '1 entity' : `${impact.entities} entities`;
				const revisions = impact.revisions === 1 ? '1 revision' : `${impact.revisions} revisions`;
				const proposals = impact.proposals === 1 ? '1 proposal' : `${impact.proposals} proposals`;
				const images = impact.images === 1 ? '1 image' : `${impact.images} images`;
				return `Deleting this account takes ${universes}, ${entities}, ${revisions}, ${proposals} and ${images} with it.`;
			},
			deleteExportPrompt: 'Export what is worth keeping before asking for the confirmation link.',
			deleteExportLink: 'Go to export',
			deletePasswordLabel: 'Current password',
			deleteButton: 'Email me a confirmation link',
			deleteSending: 'Sending…',
			deletePasswordRequired: 'Enter the current password to request the confirmation link.',
			deleteWrongPassword: 'That password is not correct.',
			deleteSendFailed: 'The confirmation mail could not be sent. Nothing was deleted; try again.',
			deleteRequested:
				'Check the inbox: the link in that mail is what actually deletes the account, and it expires in 24 hours.'
		}
	},

	auth: {
		signIn: {
			title: 'Sign in',
			subtitle: "Your universes, your account, nobody else's.",
			emailLabel: 'Email',
			passwordLabel: 'Password',
			credentialsRequired: 'Enter your email and password.',
			signInFailed: 'Could not sign in. Check the email and the password.',
			submit: 'Sign in',
			submitting: 'Signing in…',
			noAccount: 'No account yet?',
			signUpLink: 'Sign up',
			orDivider: 'or',
			continueWith: (provider) => `Continue with ${provider}`,
			forgotPasswordLink: 'Forgotten password?'
		},
		signUp: {
			title: 'Sign up',
			subtitle: 'One account, your own universes.',
			nameLabel: 'Name',
			emailLabel: 'Email',
			passwordLabel: 'Password',
			fieldsRequired: 'Enter a name, an email and a password.',
			signUpFailed: 'Could not create an account.',
			submit: 'Sign up',
			submitting: 'Creating account…',
			haveAccount: 'Already have an account?',
			signInLink: 'Sign in',
			orDivider: 'or',
			continueWith: (provider) => `Continue with ${provider}`
		},
		forgotPassword: {
			title: 'Reset your password',
			subtitle: "We'll send a link to the address on your account.",
			emailLabel: 'Email',
			emailRequired: 'Enter the email address on your account.',
			submit: 'Send reset link',
			submitting: 'Sending…',
			success: 'If that address has an account, a reset link is on its way. It expires in an hour.',
			sendFailed: 'The reset link could not be sent. Try again in a moment.',
			backToSignIn: 'Back to sign in'
		},
		resetPassword: {
			title: 'Set a new password',
			subtitle: 'Choose a new password for your account.',
			newPasswordLabel: 'New password',
			confirmPasswordLabel: 'Confirm password',
			passwordRequired: 'Enter a new password and confirm it.',
			submit: 'Set new password',
			submitting: 'Setting password…',
			passwordMismatch: "Passwords don't match.",
			invalidToken: 'This link has expired or was already used.',
			requestNewLink: 'Request a new link',
			success: 'Password updated. Sign in with your new password.',
			signInLink: 'Sign in'
		},
		accountDeleted: {
			title: 'Account deleted',
			subtitle: 'Gone, universes included.',
			body: 'The account and everything it owned are gone. Signing in with those credentials will not work any more.',
			homeLink: 'Back to Canonry'
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

	mail: {
		passwordReset: {
			subject: 'Reset your Canonry password',
			heading: 'Reset your password',
			body: 'Someone asked to reset the password on this account. If that was you, choose a new one below.',
			button: 'Reset password',
			linkFallback: 'Or paste this link into your browser:',
			expiryNotice: 'This link expires in one hour.',
			ignoreNotice:
				"If you didn't request this, you can ignore this email and your password will stay the same."
		},
		deleteAccount: {
			subject: 'Confirm deleting your Canonry account',
			heading: 'Confirm account deletion',
			body: 'Someone asked to delete this account. Clicking the link below permanently deletes the account and every universe, entity, revision, proposal and image it owns. This cannot be undone.',
			button: 'Delete my account',
			linkFallback: 'Or paste this link into your browser:',
			expiryNotice: 'This link expires in 24 hours.',
			ignoreNotice:
				"If you didn't request this, ignore this email and the account will stay exactly as it is."
		}
	},

	players: {
		wikiLabel: "Players' wiki",
		notDiscovered: 'Not yet discovered',
		revealed: 'Revealed',
		indexTitle: 'Everything the table has touched',
		indexSubtitle: 'What the party has revealed so far, and nothing else.',
		emptyState: 'Nothing has been said aloud yet.',
		gapNoticeBefore: 'You have heard the name. Nobody at the table has learned enough about',
		gapNoticeAfter: (type) => `for this ${type} page to say more; yet.`,
		factsHeading: "What's known",
		relationsHeading: 'Known relations',
		media: {
			heading: 'Images'
		}
	},

	mentionPreview: {
		gap: 'Heard of, not yet discovered.',
		empty: 'Nobody has written this one yet.'
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
			aliasesLabel: (aliases) => `also: ${aliases}`
		},

		secrets: {
			hiddenBlock: 'Hidden \u00b7 unlocks on reveal',
			gmNoteBlock: 'GM note \u00b7 never shown to players'
		},

		prose: {
			gmView: 'GM view',
			playersView: 'Players view',
			viewAriaLabel: 'GM or players view',
			gmViewDescription: 'GM view: secrets and GM notes are visible.',
			playerPreviewActive: 'Player preview: this is what the party sees.'
		},

		language: {
			label: 'Language',
			autoDetect: 'Auto-detect',
			unsure: 'Not sure / mixed',
			detectedPrefix: (name) => `Detected: ${name}`,
			detectedUnknown: 'not enough text to tell'
		},

		cover: {
			placeholderAction: 'Add a cover',
			placeholderHint: 'Upload an image, or generate one.',
			placeholderHintNoStyle: 'Upload an image. Generating one needs an image style.',
			placeholderNoStyleLink: 'Set an image style in settings',
			dialogTitle: (entityName) => `Cover for ${entityName}`,
			dialogHint:
				'An image you upload becomes the cover straight away. A generated one becomes the cover when you say so.',
			uploadAction: 'Upload an image',
			uploadHint: 'A PNG, JPEG or WEBP of your own.',
			uploading: 'Uploading\u2026',
			generateAction: 'Generate an image',
			generateHint: (credits) =>
				`One image drawn for this entry, ${credits} ${credits === 1 ? 'credit' : 'credits'}.`,
			generateRunning: 'Drawing a cover for this entry',
			generatedHint: 'Nothing is the cover until you choose it.',
			notConfigured: 'No image model is configured yet, so only an upload can be a cover.',
			aiOff:
				'Generation is switched off for this universe. You can still upload an image of your own.',
			cancel: 'Cancel'
		},

		complete: {
			button: 'Complete entry',
			hint: (credits) =>
				`Draft a full pass over this entry, ${credits} ${credits === 1 ? 'credit' : 'credits'}.`,
			running: 'The Loremaster is drafting this entry',
			empty: 'Nothing to complete right now.',
			genericFailure: 'Complete could not run.',
			aiOff: 'Writing is switched off for this universe.'
		},

		sections: {
			ariaLabel: 'Entry detail',
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
			revisionAiAccepted: 'ai \u00b7 accepted',
			proposalLink: 'View the proposal'
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
			generatedBadge: 'Generated',
			generateButton: 'Generate image',
			noStyle: {
				notice: 'This universe has no image style set.',
				link: 'Set one in settings'
			},
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
				"A generated candidate is nobody's until you insert it here - it never reaches the players' wiki on its own.",
			generateAction: 'Generate',
			generating: 'Generating\u2026',
			upload: {
				button: 'Upload image',
				uploading: 'Uploading\u2026',
				uploadedBadge: 'Uploaded',
				noFile: 'Choose a file to upload.',
				tooLarge: (maxMegabytes) => `Image is larger than the ${maxMegabytes}MB limit.`,
				unsupportedType: 'Only PNG, JPEG or WEBP images can be uploaded.',
				typeMismatch: 'The file\u2019s declared type does not match its contents.',
				genericUploadFailedWithStatus: (status) => `Upload failed (${status})`,
				genericUploadFailed: 'Upload failed'
			},
			inBody: {
				toolbarLabel: 'Image',
				toolbarTitle: 'Insert image into the body',
				dialogTitle: 'Choose an image',
				existingHeading: "This entry's images",
				emptyExisting: 'No images attached to this entry yet - upload or generate one below.',
				uploadHeading: 'Upload one',
				generateHeading: 'Generate a new one',
				sceneCost: (credits) =>
					`One wide scene image of this entry, ${credits} ${credits === 1 ? 'credit' : 'credits'}.`,
				sceneNotConfigured: 'No image model is configured for scenes yet.',
				generateButton: 'Generate',
				insertThisImage: 'Insert this image',
				useThisOne: 'Use this one',
				generateFailedWithStatus: (status) => `Could not generate an image (${status})`,
				generateFailed: 'Could not generate an image',
				attachFailedWithStatus: (status) => `Could not attach the generated image (${status})`,
				attachFailed: 'Could not attach the generated image',
				width: {
					heading: 'Width',
					ariaLabel: 'Image width in the body',
					third: 'A third',
					twoThirds: 'Two thirds',
					full: 'Full'
				}
			},
			/** Issue #255: refine a candidate with an instruction instead of a fresh roll. */
			regenerate: {
				trigger: 'Refine with instruction',
				dialogTitle: (entityName) => `Regenerate: ${entityName}`,
				hint: "Builds on the picture you're looking at, not a fresh roll - keeps the entity and style, and changes only what you ask for.",
				instructionLabel: "What's wrong with it?",
				instructionPlaceholder: 'older, and lose the helmet',
				action: 'Regenerate',
				regenerating: 'Regenerating\u2026',
				instructionMustBeString: 'instruction must be a string',
				fromAssetIdMustBeString: 'fromAssetId must be a string',
				sourceHasNoPrompt: 'That image has no stored prompt to regenerate from.'
			},
			// Issue #382/#385, decision R7/R10: an image's audience follows its entry, and
			// attaching is the accept - this block is down to the one exception a GM can
			// still set, `gm_only`, plus the sentence below the grid explaining the default.
			publish: {
				gmOnlyBadge: 'GM only',
				label: 'Solo GM',
				ariaLabel: 'Who can see this image',
				explanation:
					"The party sees an entry's images once the entry itself is revealed. Mark an image Solo GM to hold it back regardless.",
				gmOnlyMustBeBoolean: 'gmOnly must be a boolean',
				genericUpdateFailedWithStatus: (status) => `Updating failed (${status})`,
				genericUpdateFailed: 'Updating failed'
			},

			cover: {
				badge: 'Cover',
				useLabel: 'Use as cover',
				removeLabel: 'Remove as cover',
				replaceLabel: 'Replace cover',
				saving: 'Saving\u2026',
				explanation:
					'A cover shows above the title of this entry. Players see it once the entry is revealed, unless it is marked Solo GM - the same rule as any other image here.',
				mediaAssetIdMustBeStringOrNull: 'mediaAssetId must be a string or null',
				mustBeAnImage: 'Only an image can be a cover',
				genericCoverFailedWithStatus: (status) => `Setting the cover failed (${status})`,
				genericCoverFailed: 'Setting the cover failed'
			},
			delete: {
				label: 'Delete',
				confirmLabel: 'Confirm delete',
				deleting: 'Deleting\u2026',
				refusedCover:
					'This image is the cover for this entry. Remove it as cover first, then delete it.',
				refusedInBody:
					'This image is used in the body of this entry. Remove it from the text first, then delete it.',
				genericDeleteFailedWithStatus: (status) => `Delete failed (${status})`,
				genericDeleteFailed: 'Delete failed'
			},
			gallery: {
				dialogTitle: (entityName) => `Images: ${entityName}`,
				closeLabel: 'Close',
				openLabel: 'Open gallery',
				count: (n) => (n === 1 ? '1 image' : `${n} images`)
			}
		},

		editor: {
			breadcrumbEdit: 'Edit',
			heading: (entityName) => `Edit ${entityName}`,
			save: 'Save',
			saving: 'Saving…',
			bodyAriaLabel: 'Entry body, markdown',
			view: {
				ariaLabel: 'Editor view',
				write: 'Write',
				preview: 'Preview',
				previewAriaLabel: 'Preview of the entry, as the page renders it',
				previewEmpty: 'Nothing written yet, so there is nothing to preview.'
			},
			imageWidth: {
				ariaLabel: "Change this image's width",
				third: 'A third',
				twoThirds: 'Two thirds',
				full: 'Full'
			}
		},

		toolbar: {
			ariaLabel: 'Formatting',
			bold: 'Bold',
			italic: 'Italic',
			heading: 'Heading',
			list: 'Bulleted list',
			quote: 'Quote',
			link: 'Link',
			mention: 'Mention'
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
			featureInvalid: 'feature must be "portrait", "variants" or "scene"',
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
			from: (provenance) => `From: ${provenance}`,
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

		provenance: (trigger, entityName) => {
			// Ask reads the trigger before the entity name on purpose (issue #270): an Ask
			// proposal about Cairnmouth is not an edit to Cairnmouth, and saying "editing
			// Cairnmouth" would credit the GM with a change they never made.
			if (trigger === 'ask') {
				return entityName ? `a question in Ask about ${entityName}` : 'a question in Ask';
			}
			if (entityName) return `an edit to ${entityName}`;
			const labels: Record<string, string> = {
				save: 'an edit',
				complete: 'completing an entry',
				audit: 'an audit pass',
				import: 'an import',
				table: 'table mode'
			};
			return labels[trigger] ?? trigger;
		},

		plan: {
			crumbCurrent: 'Plan',
			heading: (provenance) => `Plan \u00b7 from ${provenance}`
		},

		checklist: {
			keptSuffix: (total, cap) =>
				cap === null ? ` of ${total} kept \u00b7 no cap` : ` of ${total} kept \u00b7 cap ${cap}`,
			estimatedCredits: (credits) => {
				const form = pluralRules('en').select(credits);
				return {
					prefix: 'Est. ',
					suffix: form === 'one' ? ' credit to generate diffs' : ' credits to generate diffs'
				};
			},
			toGenerate: (count, perDiffCreditsFormatted) => ({
				prefix: `${count} \u00d7 ${perDiffCreditsFormatted} cr = `,
				suffix: ' cr to generate'
			}),
			alreadySpent: () => ({
				prefix: 'Already spent: ',
				suffix: ' cr on this plan'
			}),
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
			keyboardNext: 'next',
			keyboardPrevious: 'previous',
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
			changedRegions: (count) => `${count} changed passages`,
			unchangedUnits: (count) =>
				count === 1 ? '1 sentence unchanged' : `${count} sentences unchanged`,
			removedLabel: 'Removed:',
			addedLabel: 'Added:',
			changedLabel: 'Reworded:',
			kindLabel: (kind) => {
				const labels: Record<string, string> = {
					create: 'new',
					update: 'update',
					relation: 'relation',
					draft_entity: 'draft',
					flag: 'flag',
					relation_type_reuse: 'reuse type',
					relation_type_widen: 'widen type',
					relation_type_new: 'new type'
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
			relation: 'Relations',
			relation_type: 'Vocabulary'
		},

		relationVocab: {
			reuseHeading: 'Reuse an existing relation type',
			widenHeading: 'Widen an existing relation type',
			newHeading: 'New relation type',
			askReuse: 'The model said it differently. Here is the type it means.',
			askWiden: 'This type exists, but cannot currently join these two kinds of thing.',
			askNew: 'This world does not have this relation type yet.',
			reuseType: (label, inverseLabel) =>
				`Reuses your existing type "${label}" / "${inverseLabel}"`,
			admitsCurrently: (pairs) => `Currently admits ${pairs}.`,
			widensTo: (fromLabel, toLabel) => `Widens it to also admit ${fromLabel} \u2192 ${toLabel}.`,
			newType: (label, inverseLabel, cardinality) =>
				`Creates "${label}" / "${inverseLabel}", ${cardinality}`,
			newAdmits: (pairs) => `Would admit ${pairs}.`,
			waitingCount: (count) => `${count} relation${count === 1 ? '' : 's'} waiting on this`,
			cardinalityLabel: (cardinality) => {
				const labels: Record<string, string> = {
					one_to_one: 'one to one',
					one_to_many: 'one to many',
					many_to_one: 'many to one',
					many_to_many: 'many to many'
				};
				return labels[cardinality] ?? cardinality;
			}
		},

		bulkReject: {
			rejecting: 'Rejecting\u2026',
			rejectShown: (count) => `Reject ${count} shown`,
			rejectedCount: (count) => `Rejected ${count}.`
		},

		evidence: {
			button: 'Show source',
			embeddingOnly: 'Embedding similarity only',
			instructionOnly: 'Your request in Ask, not a canon link',
			close: 'Close',
			reasonRelation: (path, hops) => `relation ${path}, ${hops}-hop`,
			reasonMention: (direction, matchedText) => `${direction} mention ("${matchedText}")`,
			reasonEmbedding: 'similar wording only, no graph link',
			reasonInstruction: 'what you asked for in Ask, drafted from it',
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

		inline: {
			regionLabel: 'Proposals waiting on this entry',
			heading: (pending) =>
				pending === 1 ? '1 proposal to review' : `${pending} proposals to review`,
			headingSettled: 'Nothing waiting here',
			position: (index, total) => `${index} of ${total}`,
			acceptedNote: 'Accepted, and it is canon above.',
			failed: (message) => `That decision did not go through: ${message}`,
			awaitingDiff: (count) =>
				count === 1
					? '1 candidate on this entry has no draft yet.'
					: `${count} candidates on this entry have no draft yet.`,
			awaitingDiffLink: 'open the plan'
		},

		review: {
			awaitingDiff: {
				kicker: 'Waiting on its diff',
				body: (entryName) =>
					`${entryName} is part of a plan. The copilot has not written this candidate's diff yet, so there is nothing here to accept or reject.`,
				reasonLabel: "The copilot's reason:",
				cost: (credits) => {
					const form = pluralRules('en').select(credits);
					return {
						prefix: 'Generating this diff would cost ',
						suffix: form === 'one' ? ' credit.' : ' credits.'
					};
				},
				planLink: 'Open the plan',
				backToEntry: 'Back to the entry'
			}
		},

		errors: {
			noDiffsToGenerate:
				'This plan has no edited entry, so there are no propagation diffs to generate',
			proposalNotFound: 'No such proposal in this universe.',
			unknownAction: 'Unknown decision.',
			viewerCannotDecide: 'Read-only access cannot decide a proposal.',
			missingRejectReason: 'That reject reason is missing.',
			notRejected: 'This proposal is not rejected.'
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
			missing: {
				heading: (count) =>
					count === 1
						? '1 entity is missing from this import'
						: `${count} entities are missing from this import`,
				explanation:
					'These existed after an earlier import of this source but were not found this time. Nothing has been deleted — open each one and decide what it means.'
			},
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

		outcomeNote: {
			finished: (documents, proposals) =>
				`${documents} document${documents === 1 ? '' : 's'} processed, ${proposals} proposal${proposals === 1 ? '' : 's'} emitted`,
			noDocuments: 'No documents to process.',
			unchanged: (documents) =>
				`Nothing changed: all ${documents} document${documents === 1 ? '' : 's'} matched what was already imported.`,
			stoppedNoOffender: (documents, proposals) =>
				`Stopped before finishing: ${documents} document${documents === 1 ? '' : 's'} settled, ${proposals} proposal${proposals === 1 ? '' : 's'} emitted`,
			offenderReason: {
				step_ceiling: "this document's step ceiling was reached",
				cancelled_before_step: 'cancelled before this step started',
				cancelled_mid_step: 'cancelled mid-step',
				tool_calls_unparseable:
					'every tool call in this step failed to parse, most likely truncated by the output limit',
				step_worst_case_exceeds_budget:
					"this step's worst case would not fit this job's remaining credit budget",
				job_budget_exhausted: "this job's credit budget is exhausted",
				never_started: 'never started',
				model_call_failed: (errorName) => `model call failed: ${errorName}`,
				loop_guard: (toolName, count) =>
					`stuck in a loop: ${toolName} was called with identical arguments ${count} time${count === 1 ? '' : 's'} in a row, so this document was ended rather than run to its step ceiling`,
				other: (text) => text
			},
			offender: (path, reasonText) => `${path}: ${reasonText}`,
			offenderWithOthers: (base, othersCount) =>
				`${base} (and ${othersCount} other document${othersCount === 1 ? '' : 's'} that did not finish cleanly)`,
			lossy: (path, count) =>
				`${path} lost ${count} tool call${count === 1 ? '' : 's'} along the way, most likely truncated by a step's output limit`,
			lossyWithOthers: (base, othersCount) =>
				`${base} (and ${othersCount} other document${othersCount === 1 ? '' : 's'} that lost some too)`
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
				cta: 'Import my world'
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
			creating: 'Creating…',
			errors: { nameRequired: 'Name your universe first.' }
		},

		upload: {
			headTitle: (universeName) => `Import into ${universeName} · Canonry`,
			heading: 'Import your world',
			description:
				'Drop an export from Obsidian, Kanka, World Anvil or OneNote, or a PDF or DOCX file. Canonry guesses the source and shows you what it found before anything runs.',
			noLiveModelNotice:
				'This deployment has no live model configured, so only Obsidian, Kanka and generic-text exports can actually run right now (detection still works for everything).',
			uploadButton: 'Upload',
			uploading: 'Uploading…',
			confirm: {
				uploadedSummary: (fileName, kilobytes) => `${fileName} uploaded, ${kilobytes} KB`,
				detected: (label) => `Detected: ${label}`,
				notDetected: (label) => `Couldn't confidently detect a format: ${label}`,
				detail: (d) => {
					switch (d.kind) {
						case 'obsidian':
							return `${d.notes} note${d.notes === 1 ? '' : 's'}, .obsidian folder found`;
						case 'obsidian-unsure':
							return `${d.markdownFiles} Markdown file${d.markdownFiles === 1 ? '' : 's'}, no .obsidian folder found`;
						case 'kanka':
							return `${d.jsonFiles} JSON file${d.jsonFiles === 1 ? '' : 's'}, entity_type field found`;
						case 'world-anvil':
							return 'json/ and html/ folders found, matching a Full World Export';
						case 'onenote':
							return `${d.pages} exported page${d.pages === 1 ? '' : 's'}, sibling _files/ folder found`;
						case 'pdf':
							return 'one PDF file';
						case 'docx':
							return 'one DOCX file';
						case 'generic':
							return `${d.files} file${d.files === 1 ? '' : 's'}, no known export schema`;
					}
				},
				playbookLabel: 'Playbook to run',
				continueButton: 'Confirm and continue',
				checking: 'Checking…'
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
				startButton: 'Start import',
				starting: 'Starting import…'
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
				flag: 'flag',
				relation_type_reuse: 'reuse type',
				relation_type_widen: 'widen type',
				relation_type_new: 'new type'
			},
			untitledProposal: 'Untitled proposal',
			accept: 'Accept',
			accepting: 'Accepting…',
			accepted: 'accepted',
			outcome: { rejected: 'rejected', superseded: 'superseded' }
		},
		existing: {
			fileInputLabel: 'Export file',
			jobsHeading: 'Previous imports',
			jobsEmpty: 'No import has run in this world yet.',
			jobsEmptyAction: 'Start an import',
			proposals: (count) => (count === 1 ? '1 proposal' : `${count} proposals`),
			reviewLink: 'Review',
			viewerNotice: 'Only an editor or owner can start an import.'
		}
	},

	table: {
		title: 'Table',

		contextStrip: {
			modeOn: 'Table mode: on',
			noPlaceDeclared: (universeName) => `no place declared yet - ${universeName}`,
			pinnedIn: (ms) => `pinned in ${ms}ms`,
			change: 'Change',
			declare: 'Declare',
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
			declare: 'Declare',
			declaring: 'Declaring…'
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
			creating: 'Creating…',
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
			saveAsProposal: 'Save as a proposal',
			savingAsProposal: 'Saving as a proposal…'
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
			choosePlace: 'Choose a place',
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
			warmBudgetUnavailable: 'table prep could not cover this draft right now',
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
				"A oneshot, a module, a campaign, a story or a novel: an ordered tree of acts, chapters, scenes and encounters, separate from the universe's canon. What happens while writing or playing one flows back as proposals, never as a direct write.",
			empty: 'No works yet.',
			emptyAction: 'New work',
			createHeading: 'Start a new work',
			nameLabel: 'Name',
			typeLabel: 'Type',
			summaryLabel: 'Summary',
			summaryOptional: '(optional)',
			createButton: 'Create work',
			creating: 'Creating…'
		},
		tree: {
			ariaLabel: 'Work tree',
			emptyHeading: (workName) => `Nothing in ${workName} yet`,
			emptyHint:
				'Add the first node - usually an act, but a short oneshot can start straight at a scene.',
			pickNodeHint: 'Pick a node from the tree on the left, or add another one at the root here.',
			titleLabel: 'Title',
			kindLabel: 'Kind',
			addNodeButton: 'Add node',
			addingNode: 'Adding…'
		},
		node: {
			moveUp: '↑ Move up',
			moveDown: '↓ Move down',
			moving: 'Moving…',
			titleSrLabel: 'Title',
			save: 'Save',
			saving: 'Saving…',
			addChildSummary: (nodeTitle) => `Add a node under ${nodeTitle}`,
			titleLabel: 'Title',
			kindLabel: 'Kind',
			addNodeButton: 'Add node',
			addingNode: 'Adding…',
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
			recentHeading: 'Recent'
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
			derivedNoticeAfter: "'s indexed corpus, read-only. Your canon always wins.",
			newEntryAction: 'New entry',
			home: {
				pulseMoving: (total, latest, weeks) => {
					const fmt = numberFormat('en', { maximumFractionDigits: 0, useGrouping: 'always' });
					const changes = total === 1 ? '1 change' : `${fmt.format(total)} changes`;
					const tail =
						latest === 0
							? 'none in the last seven days'
							: `${fmt.format(latest)} in the last seven days`;
					return `${changes} in the last ${weeks} weeks, ${tail}.`;
				},
				pulseQuiet: (weeks, lastChange) =>
					lastChange
						? `Nothing has changed in ${weeks} weeks. Last change: ${lastChange}.`
						: `Nothing has changed in ${weeks} weeks.`,
				pulseWeekTitle: (count, weeksAgo) => {
					const changes = count === 1 ? '1 change' : `${count} changes`;
					if (weeksAgo === 0) return `last seven days: ${changes}`;
					return weeksAgo === 1 ? `1 week ago: ${changes}` : `${weeksAgo} weeks ago: ${changes}`;
				},
				continueHeading: 'Continue',
				continueEmpty: 'Nothing changed yet.',
				waitingHeading: 'Waiting for you',
				waitingEmpty: 'Nothing is waiting for you.',
				reviewLink: 'review',
				reviewAll: (pending) => `Review all ${pending}`,
				activityHeading: 'Recent activity',
				activityEmpty: 'Nothing has happened here yet.',
				activityRevision: (entityName) => `${entityName} was rewritten`,
				activityRelation: (fromName, label, toName) => `${fromName} ${label} ${toName}`,
				activityWork: (workName, nodeTitle) => `${nodeTitle} \u00b7 ${workName}`,
				authorAi: 'accepted from the Loremaster',
				browseEntries: 'Browse every entry'
			},
			entries: {
				headTitle: (universeName) => `Entries: ${universeName}`,
				title: 'Entries',
				backToHome: (universeName) => `Back to ${universeName}`,
				columnName: 'Name',
				columnType: 'Type',
				columnRelations: 'Relations',
				columnFacts: 'Facts',
				columnChanged: 'Changed',
				sortBy: (column) => `Sort by ${column}`,
				tableAriaLabel: 'Entries',
				moveHint: 'move',
				openHint: 'open',
				range: (from, to, total) => {
					const fmt = numberFormat('en', { maximumFractionDigits: 0, useGrouping: 'always' });
					return `${fmt.format(from)}\u2013${fmt.format(to)} of ${fmt.format(total)}`;
				},
				pageOf: (page, pages) => `page ${page} of ${pages}`,
				previousPage: 'Previous',
				nextPage: 'Next'
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
			searchPlaceholder: 'Search by name, alias, or text\u2026',
			searchClear: 'Clear search',
			searchResultCount: (query, count) => {
				const entries = count === 1 ? '1 entry matches' : `${count} entries match`;
				return `${entries} "${query}".`;
			},
			changedAt: (when) => `changed ${when}`,
			emptyColdMessage: 'Nothing here yet. Start with your first entry.',
			emptyFilteredMessage: 'No entries match this filter.',
			emptySearchMessage: (query) => `No entries match "${query}".`,
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
			placeholderFollowUp: 'Ask a follow-up…',
			ask: 'Ask',
			asking: 'Asking…',
			askFailed: 'Ask failed.',
			questionRequired: 'A question is required.',
			methodNotAllowed: 'POST a question to ask.',
			noLiveModel:
				'Generation is switched off for this universe: this reads your own canon directly, at no cost, rather than a model-written answer.',
			detailLevelLabel: 'Detail level',
			levels: {
				'1_line': '1 line',
				short: 'Short',
				normal: 'Normal',
				detailed: 'Detailed',
				full: 'Full'
			},
			ownCanonLabel: 'your canon',
			indexedBadge: 'indexed',
			sourcesNote:
				'The answer was written from these and from nothing else: the entries whose own wording matched your question.',
			sourcesEmpty:
				'Nothing to cite. No entry matched the words of this question, so this answer rests on nothing in your canon.',
			deletedEntry: 'This entry has since been deleted.',
			close: 'Close',
			loading: 'Loading…',
			disclosure:
				'Every question here is answered and kept automatically, as your own note grouped into this conversation: it never becomes part of an entry without a proposal you accept, players never see it, and it stays until you delete the conversation. ',
			emptyState: {
				heading: 'Ask the Loremaster',
				body: (universeName) =>
					`Ask anything about ${universeName}: characters, places, events, history. A follow-up continues this same conversation, so dig as deep as you want.`,
				tryAsking: 'Try asking:'
			},
			propose: {
				badgeCreated: 'Proposed: new entry',
				badgeEdited: 'Proposed: edit',
				redirectedToEdit: (entityName) =>
					`${entityName} already exists, so this became a proposed edit instead.`,
				redirectedToCreate: (entityName) =>
					`No entry named ${entityName} exists yet, so this became a proposed new entry instead.`,
				reviewLink: 'Review in Proposals',
				failed: (message) => `A proposal attempt failed, and nothing was proposed: ${message}`
			},
			keep: {
				failed: 'Could not keep that answer.',
				invalidRequest: 'That answer cannot be kept as it was sent.',
				sourceNotInUniverse: 'One of those sources does not belong to this universe.',
				methodNotAllowed: 'POST an answer to keep it.',
				noteLinkBefore: 'Which company reads your campaign to answer a question is named in the ',
				noteLink: 'full policy',
				historyLink: 'Conversations'
			},
			kept: {
				headTitle: (universeName) => `Conversations: ${universeName}`,
				crumb: (universeName) => `Conversations · ${universeName}`,
				heading: 'Conversations',
				note: 'The Loremaster keeps every question and answer automatically, as your own note grouped by conversation. Nothing here becomes part of an entry without a proposal you accept, players never see it, and a conversation stays until you delete it.',
				empty:
					'Nothing yet. Ask the Loremaster something, from the panel or from this page, and it appears here.',
				askLink: 'Ask the Loremaster',
				turnCount: (count) => {
					const n = numberFormat('en', {
						maximumFractionDigits: 0,
						useGrouping: 'always'
					}).format(count);
					const form = pluralRules('en').select(Math.round(count));
					return form === 'one' ? `${n} exchange` : `${n} exchanges`;
				},
				delete: 'Delete',
				deleteConfirmPrompt: 'Delete this whole conversation permanently?',
				deleteConfirmCancel: 'Cancel',
				deleteFailed: 'Could not delete that conversation.',
				deleteNotFound: 'That conversation is already gone.'
			}
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
			groups: {
				images: 'Images',
				loremaster: 'The Loremaster',
				canon: 'Canon'
			},
			rail: {
				ariaLabel: 'Settings groups',
				incompleteMark: 'Unset'
			},
			aiToggle: {
				heading: 'Loremaster writing',
				description: (universeName) =>
					`Turns off new proposals, images, Ask and warm pre-computation for ${universeName}. Search and mention suggestions keep reading this universe, and cost nothing.`,
				stopWriting: 'Stop writing',
				stoppingWriting: 'Stopping writing…',
				resumeWriting: 'Resume writing',
				resumingWriting: 'Resuming writing…',
				offNotice: (universeName) =>
					`Writing is off for ${universeName}. Search and mention suggestions still spend from your included quota like any other request; they simply cost nothing, on or off.`
			},
			propagationCap: {
				heading: 'Propagation cap',
				description: (universeName) =>
					`How many entries a save's plan may propose for ${universeName}. Every entry the copilot drafts a diff for costs a credit, so raising this is agreeing to spend more each time you save.`,
				capLabel: 'Cap',
				noLimitLabel: 'No limit',
				save: 'Save',
				saving: 'Saving…',
				capNotice: (cap) => {
					const form = pluralRules('en').select(cap);
					return {
						prefix: 'Capped at ',
						suffix: form === 'one' ? ' entry per plan.' : ' entries per plan.'
					};
				},
				noLimitNotice:
					'No limit: a save\u2019s plan may surface every candidate connected to what changed, however many that is, and each diff you complete during review still costs one credit. Nothing drafts without you confirming it first.',
				invalidCapError: 'Enter a number of 1 or more, or turn the limit off.'
			},
			imageStyle: {
				heading: 'Image style',
				description: (universeName) =>
					`What a new image in ${universeName} starts from when its entry has no style of its own. An entry can still override it for itself.`,
				pickerLegend: 'Choose a style',
				selectedLabel: 'Selected',
				customCard: {
					label: 'Custom style',
					hint: 'Write your own name and prompt modifier instead of a shipped preset.'
				},
				nameLabel: 'Name',
				promptModifierLabel: 'Prompt modifier',
				applying: 'Applying…',
				save: 'Save',
				saving: 'Saving…',
				nameRequiredError: 'Give the style a name.',
				promptModifierRequiredError: 'Describe what the style adds to a prompt.',
				pickError: 'Could not set that style. Try again.'
			},
			narration: {
				heading: "Loremaster's voice",
				description: (universeName) =>
					`How the Loremaster sounds when it answers a question or fills in a thin entry for ${universeName} - never what it is allowed to write, only how it phrases it.`,
				pickerLegend: 'Choose a voice',
				selectedLabel: 'Selected',
				customCard: {
					label: 'Custom voice',
					hint: 'Write your own name and prompt clause instead of a shipped preset.'
				},
				nameLabel: 'Name',
				promptClauseLabel: 'Prompt clause',
				applying: 'Applying…',
				save: 'Save',
				saving: 'Saving…',
				nameRequiredError: 'Give the voice a name.',
				promptClauseRequiredError: 'Describe how this voice should sound.',
				pickError: 'Could not set that voice. Try again.'
			},
			loremasterConversations: {
				text: 'Every question asked in the Loremaster panel is answered and kept automatically, grouped by conversation, until you delete it.',
				link: 'See what is kept'
			},
			precedence: {
				heading: 'Precedence',
				description: (universeName) =>
					`Your canon always wins. A source page an entry here supersedes is marked below, not deleted, and stops coming back from retrieval for ${universeName}.`,
				empty: 'Nothing superseded yet.',
				supersededBadge: 'superseded',
				remove: 'remove',
				removing: 'Removing…',
				declareHeading: 'Declare a supersede',
				entryLabel: 'Your entry',
				baseSourceLabel: 'Base source',
				sourceUrlLabel: 'Source page url',
				noteLabel: 'Note',
				optional: '(optional)',
				submit: 'Supersede',
				superseding: 'Superseding…',
				onlyDerivedError: 'Only a derived universe can supersede a source page.',
				pickEntryError: 'Pick which entry supersedes the page.',
				pickSourceError: 'Pick which source the page belongs to.',
				sourceUrlRequiredError: 'The source page needs a url.',
				alreadySupersededError: 'This page is already superseded.',
				missingIdError: 'Missing supersede id.'
			},
			relations: {
				close: 'Close',
				cardHeading: 'Relation catalogue',
				cardDescription: (universeName) =>
					`Every relation type ${universeName} can use, the shipped ten and its own, with how many relations use each one.`,
				cardCountOwn: (count) => {
					const form = pluralRules('en').select(count);
					if (count === 0) return 'No types of its own yet.';
					return `${count} ${form === 'one' ? 'type' : 'types'} of its own.`;
				},
				manageLink: 'Manage relation types',
				headTitle: (universeName) => `Relation catalogue: ${universeName}`,
				title: 'Relation catalogue',
				description: (universeName) =>
					`Every relation type ${universeName} can use: the shipped catalogue every world starts with, and this universe's own. Rename, widen or translate your own, merge two into one; the shipped ten stay a migration's to change.`,
				shippedHeading: 'Shipped catalogue',
				shippedDescription:
					'The ten labels every universe starts with. Editing one is a migration, not a setting, so this list is read-only.',
				ownHeading: "This universe's own types",
				ownDescription:
					'Types this universe invented, by hand or through an accepted import proposal.',
				emptyOwn: 'No relation types of its own yet.',
				emptyOwnExplanation:
					'A type appears here the moment a GM adds one, or accepts an import proposal that invents a new label.',
				summary: (inverseLabel, from, to, cardinality) => {
					const base = `Inverse "${inverseLabel}". Connects ${from} to ${to}`;
					return cardinality ? `${base}, ${cardinality}.` : `${base}.`;
				},
				usageCount: (count) => {
					if (count === 0) return 'Not used in this universe yet.';
					const form = pluralRules('en').select(count);
					return `Used by ${count} ${form === 'one' ? 'relation' : 'relations'} in this universe.`;
				},
				cardinalityLabel: (value) => {
					const labels: Record<string, string> = {
						one_to_one: 'one to one',
						one_to_many: 'one to many',
						many_to_one: 'many to one',
						many_to_many: 'many to many'
					};
					return labels[value] ?? value;
				},
				entityTypeLabel: (type) => {
					const labels: Record<string, string> = {
						character: 'character',
						place: 'place',
						faction: 'faction',
						item: 'item',
						event: 'event',
						session: 'session'
					};
					return labels[type] ?? type;
				},
				rename: {
					trigger: 'Rename',
					dialogTitle: (label) => `Rename "${label}"`,
					dialogDescription:
						'One row holds both labels, so the two sides of the relation can never drift apart.',
					labelField: 'Label',
					inverseLabelField: 'Inverse label',
					submit: 'Save',
					labelRequiredError: 'The label cannot be empty.',
					inverseLabelRequiredError: 'The inverse label cannot be empty.',
					conflictError: 'This universe already has a type with that label.',
					notOwnedError: 'Only a type this universe created can be renamed.'
				},
				widen: {
					trigger: 'Widen',
					dialogTitle: (label) => `Widen "${label}"`,
					dialogDescription:
						'Add entity types this relation can join. It only ever grows: narrowing it back would risk relations the graph already has.',
					fromHeading: 'From',
					toHeading: 'To',
					currentlyAdmits: 'Currently admits',
					addOption: (typeLabel) => `Add ${typeLabel}`,
					submit: 'Widen',
					noChangeError: 'Check at least one entity type to add.',
					notOwnedError: 'Only a type this universe created can be widened.'
				},
				translate: {
					trigger: 'Add a translation',
					dialogTitle: (label) => `Translate "${label}"`,
					dialogDescription:
						'Your own words, read in another interface language. Leave a language blank to show the label as you wrote it there too.',
					labelField: 'Label',
					inverseLabelField: 'Inverse label',
					submit: 'Save',
					incompletePairError: 'Enter both fields for a language, or leave both blank.',
					notOwnedError: 'Only a type this universe created can be translated.'
				},
				merge: {
					trigger: 'Merge',
					dialogTitle: 'Merge two relation types',
					dialogDescription:
						'For cleaning up after an import that named the same relation twice. Every relation using the losing type moves to the type it merges into, and the losing type is removed.',
					fromLabel: 'Merge this type',
					intoLabel: 'Into this type',
					pickFromPlaceholder: 'Pick a type this universe owns',
					pickIntoPlaceholder: 'Pick a type to merge into',
					countWarning: (count, fromLabel, intoLabel) => {
						const form = pluralRules('en').select(count);
						const uses = form === 'one' ? 'relation currently uses' : 'relations currently use';
						const moves = form === 'one' ? 'it' : 'all of them';
						return `${count} ${uses} "${fromLabel}". Merging moves ${moves} to "${intoLabel}", and "${fromLabel}" is removed.`;
					},
					countWarningZero: (fromLabel, intoLabel) =>
						`"${fromLabel}" has no relations yet. Merging removes it and leaves "${intoLabel}" as it is.`,
					sameTypeError: 'Pick two different types.',
					notOwnedError: 'Only a type this universe created can be merged away.',
					needsTwoTypesNotice:
						'This universe needs at least one type of its own before two types can merge.',
					submit: 'Merge',
					movedToast: (count, intoLabel) => {
						const form = pluralRules('en').select(count);
						if (count === 0) return `Merged into "${intoLabel}".`;
						return `Moved ${count} ${form === 'one' ? 'relation' : 'relations'} into "${intoLabel}".`;
					}
				},
				viewerForbiddenError: 'Viewers cannot change the relation catalogue.'
			}
		},
		players: {
			headTitle: (universeName) => `Players · ${universeName}`,
			heading: 'Players',
			description: 'What the party has learned, and what is still behind the screen.',
			wikiLinkLabel: "The players' wiki",
			openWikiLink: "Open the players' wiki",
			invitationsNotice:
				'There is no invitation to send yet: share the wiki address with your players directly.',
			revealedHeading: 'Revealed',
			openInWiki: (entityName) => `Open ${entityName} in the players' wiki`,
			revealedEmpty: 'Nothing has been revealed to the party yet.',
			revealedEmptyAction: 'Go to Table mode',
			kindLabel: { entity: 'Entity', fact: 'Fact', relation: 'Relation' },
			sessionUnknown: 'an untracked session',
			hiddenHeading: 'Still behind the screen',
			hiddenDescription: 'Revealable, and not yet found.',
			hiddenEmpty: 'Nothing is left to discover.',
			entityTypeLabel: (type) => {
				const labels: Record<string, string> = {
					character: 'Character',
					place: 'Place',
					faction: 'Faction',
					item: 'Item',
					event: 'Event',
					session: 'Session'
				};
				return labels[type] ?? type;
			}
		}
	},

	admin: {
		unattributed: 'unattributed',
		save: 'Save',
		saving: 'Saving…',

		models: {
			browserTitle: 'Models, Canonry admin',
			textHeading: 'Text models',
			textIntro1:
				'The active model per purpose lives in <code class="text-xs">model_config</code>, not in code, and every flow - the Loremaster\'s four modes, propagation, warm generation, indexing, embedding - reads it through <code class="text-xs">resolveModel</code>. A change here takes effect on the very next call, no deploy, no restart. Provider is constrained to what <code class="text-xs">createLanguageModel</code> can actually build; a provider outside that list is not offered.',
			textIntro2:
				'An Italian question against an English canon has to find the English chunk, so the <strong>embedding</strong> purpose is a deliberate multilingual choice, not a free one. Candidates were compared on published multilingual retrieval benchmarks (MIRACL, MTEB Multilingual) restricted to providers this build can construct. Recommended: <code class="text-xs">google</code> / <code class="text-xs">gemini-embedding-001</code> (#1 on the MTEB Multilingual leaderboard, ~100 languages). Gap this box cannot close: no live embedding credential exists here to confirm en/it recall specifically - neither MIRACL nor MTEB publish an isolated English&harr;Italian score, so that is a live benchmark still owed once a real credential exists, not a settled number.',
			table: {
				purpose: 'Purpose',
				currentlyActive: 'Currently active',
				provider: 'Provider',
				modelId: 'Model id',
				notConfigured: 'not configured',
				actions: 'Actions',
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
				'The active model per feature lives here, not in code, and a change here takes effect on the very next "Generate image" request - no deploy, no restart.',
			imageIntro2Pre:
				'Seeded default: <code class="text-xs">prunaai/p-image</code> for a single portrait, <code class="text-xs">black-forest-labs/flux-schnell</code> for the four-variant batch. Price per image is our own cost bookkeeping, in whichever currency the provider quotes it, never the credit price a GM sees - that lives in',
			imageTable: {
				feature: 'Feature',
				pricePerImage: 'Price / image',
				currency: 'Currency',
				aspectRatio: 'Shape',
				aspectRatioNotSet: 'model default',
				coverAspectRatios: (shapes) =>
					`A cover is drawn at the entity type's own shape, so this model has to accept ${shapes}.`,
				active: 'active',
				inactive: 'inactive',
				actions: 'Actions'
			},
			featureLabel: {
				portrait: 'Portrait - one image per request',
				variants: 'Variants - up to four to choose from',
				scene: 'Scene - one wide image for an entry body'
			},
			errors: {
				unknownPurpose: (purpose) => `"${purpose}" is not a known model purpose.`,
				unknownProvider: (provider, choices) =>
					`"${provider}" is not a known provider. Choose one of: ${choices}.`,
				modelIdRequired: 'Model id is required.',
				providerAndModelIdRequired: 'Provider and model id are required.',
				invalidPricePerImage: 'Enter a non-negative price per image, up to 6 decimal places.',
				invalidCurrency: 'Choose one of the listed currencies.',
				aspectRatioUnsupported: (modelId, aspectRatio, accepted) =>
					`This feature generates at ${aspectRatio}, and "${modelId}" does not accept that shape. It accepts: ${accepted}. Pick a model that offers ${aspectRatio}, or change the shape on the row first.`,
				aspectRatioModelUnknown: (modelId, aspectRatio) =>
					`This feature generates at ${aspectRatio}, and nobody has recorded which shapes "${modelId}" accepts, so saving it would mean guessing. Read the model's aspect_ratio enum from its provider and add it to IMAGE_MODEL_ASPECT_RATIOS in @canonry/media first.`
			}
		},

		metrics: {
			browserTitle: 'Metrics, Canonry admin',
			heading: 'Metrics',
			intro:
				'The two numbers that decide whether the copilot works, plus the three that say whether the rest of the product does. Staff only, and deliberately not shown to the GM - a GM optimising their own accept rate is a strange incentive on both sides of the relationship.',
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
					`<code class="text-xs">proposal.outcome</code>, \`superseded\` and \`pending\` excluded from the denominator - computed by <code class="text-xs">@canonry/eval</code>'s <code class="text-xs">acceptRate</code>, the same function the propagation corpus scores prompt and model changes against. Window: last ${windowDays} days.`,
				noProposalsYet:
					'No proposals have been produced yet. A 0% accept rate here would be a lie by omission, not an honest reading, so this panel shows nothing until there is something to show.',
				acceptRateLabel: 'Accept rate (decided proposals)',
				table: { weekOf: 'Week of', kind: 'Kind', model: 'Model' },
				byLocale: {
					heading: 'By interface locale',
					intro:
						'<code class="text-xs">proposal.locale</code> - the interface language the proposal\'s speech was produced in, computed by the same <code class="text-xs">acceptRate</code> above. A locale with no proposals yet reads as "no data", never a fabricated 0%.',
					localeLabel: 'Locale'
				}
			},
			timeToFirstAccept: {
				heading: 'Time to first accepted proposal',
				intro:
					"From an import's start to its first accepted proposal, per universe, as a distribution: one slow outlier is itself a churn risk, and an average would hide exactly that outlier.",
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
					`Warm hit rate - consumed artifacts over generated ones - governs the warm radius automatically: below ${thresholdPercent}% it shrinks from ring 2 to ring 1. This is the same read <code class="text-xs">warmOnConsumption</code> uses to decide how far to reach, not a separate estimate.`,
				consumed: 'Consumed',
				generated: 'Generated',
				hitRate: 'Hit rate',
				currentRadius: 'Current radius',
				ring: (n) => `ring ${n}`
			},
			entropy: {
				heading: 'Canon entropy',
				intro:
					'Entries updated after a session versus created in prep, per universe - the metric that says whether canon entropy was actually solved or whether this is just another place to write things down.',
				createdInPrep: 'Created in prep',
				updatedAfterSession: 'Updated after a session'
			},
			auditFlags: {
				heading: 'Audit flags by position',
				intro: (cap: number) =>
					`Dismissals over flags produced, broken out by where the flag sat in its own audit run. One run writes at most ${cap} flags, and that number is a reading of the spec rather than a measurement: if dismissals climb with position, it is already too generous. A flag cannot be accepted, only dismissed or left alone, so this is dismissed over produced and not an accept rate.`,
				position: 'Position in run',
				produced: 'Flags produced',
				dismissed: 'Dismissed',
				stillOpen: 'Left alone',
				dismissalRate: 'Dismissal rate',
				noFlagsYet:
					'No audit flags yet. This panel needs the audit to have run on real edits before it says anything, and a line drawn through no data would be worse than an empty table.'
			}
		},

		pricing: {
			browserTitle: 'Operation pricing, Canonry admin',
			title: 'Operation pricing',
			intro1:
				'The credit price of every chargeable operation lives here, not in code, and a change here takes effect immediately, not after a cache expiry. A price of <b class="text-ink">zero</b> means the operation is free to the user: that is the whole mechanism behind reading staying free, not a special case bolted on elsewhere.',
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
				'Practical guides for getting a world into Canonry and anything else that needs plain instructions rather than dense reference material.',
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
	},
	errorPage: {
		notFoundHeading: 'Page not found',
		notFoundBody: "There's nothing at this address. It may have moved, or the link was mistyped.",
		serverErrorHeading: 'Something went wrong',
		serverErrorBody: "The page didn't load. Try again, or head back to somewhere that works.",
		worldHomeAction: 'Go to world home',
		entriesAction: 'Browse entries',
		allUniversesAction: 'Go to your universes',
		searchAction: 'Search',
		retryAction: 'Try again'
	}
};
