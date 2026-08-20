import { RELATION_TYPE_CATALOGUE } from '@canonry/lang';
import { numberFormat, pluralRules } from './intl.js';
import type { Messages } from './messages.js';

// Written thinking in Italian, not translated word-for-word from en.ts (issue #121's own
// rule, honoured here even though the sweep itself is that issue's job): plain, specific
// copy, the product's own voice, not English syntax wearing Italian words.
// Condivisa fra le cinque etichette dei chip di `proposals.rejectChips` e
// `proposals.diffCard.rejectReasonLabel` (che ripropone il motivo salvato): l'oggetto
// letterale qui sotto non può riferirsi alle proprietà dei propri fratelli mentre è
// ancora in costruzione, quindi questa mappa vive fuori da esso.
const PROPOSAL_REJECT_REASON_LABELS_IT: Record<string, string> = {
	wrong: 'Sbagliata',
	'already true': 'Già vero',
	'not canon yet': 'Non ancora canone',
	'too much': 'Troppo',
	prose: 'Prosa'
};

// #196 (decisione L1) / #197: le dieci chiavi del catalogo di serie (#195, fisse,
// superficie API dal giorno del rilascio), ciascuna mappata sulla coppia da mostrare.
// Di proprietà di `packages/copilot/src/relation-catalogue.ts`, non duplicata qui - il
// resolver (`resolveRelationType`, #197) ha bisogno delle stesse identiche stringhe per
// far corrispondere un'etichetta proposta in qualunque lingua, quindi esiste un solo
// letterale per lingua, non due. Un tipo proprio di un universo non ha una voce qui, di
// proposito - vedi il commento su `Messages.relationTypeLabel`.
const RELATION_TYPE_CATALOGUE_IT = RELATION_TYPE_CATALOGUE.it;

export const it: Messages = {
	relationTypeLabel: (key) => RELATION_TYPE_CATALOGUE_IT[key],
	controls: {
		search: 'Cerca',
		noMatch: 'Nessun risultato',
		apply: 'Applica',
		modelRunning: {
			elapsed: (seconds) => `${seconds}s`,
			slow: 'Una stesura lunga può richiedere un minuto.'
		}
	},
	shell: {
		skipToContent: 'Vai al contenuto',
		signedInAs: (name) => `Accesso effettuato come ${name}`,
		notSignedIn: 'Nessun accesso effettuato',
		signIn: 'Accedi',
		signUp: 'Registrati',
		signOut: 'Esci',
		signingOut: 'Uscita in corso…',
		tagline:
			'Un wiki per il tuo mondo di gioco, dove un copilota IA lavora in ogni fase e non scrive mai nulla che tu non abbia accettato.',
		sidebar: {
			accountNavAriaLabel: 'Navigazione account',
			accountNav: {
				universes: 'Universi',
				settings: 'Impostazioni',
				docs: 'Documentazione'
			}
		},
		quota: {
			includedHeading: 'Quota inclusa',
			// Issue #201: "Preparazione al tavolo" è l'etichetta, non la chiave -
			// `warm_budget_credits`, `warm_budget_spent`, `spendWarmBudget` e
			// `warmBudgetRemaining` mantengono il loro nome ovunque nel codice.
			warmHeading: 'Preparazione al tavolo',
			// Stesso idioma di `settings.billing.creditsCount`: cifre raggruppate,
			// nessun credito frazionario mostrato - lo stesso numero che quella
			// pagina mostra (`subscriptionCredits`/`warmBudgetRemaining`), formattato
			// allo stesso modo.
			ratio: (remaining, total) => {
				const fmt = numberFormat('it', { maximumFractionDigits: 0, useGrouping: 'always' });
				return `${fmt.format(remaining)} / ${fmt.format(total)}`;
			},
			includedExplainLabel: 'A cosa serve la quota inclusa',
			includedPopoverBody:
				"Paga le voci redatte, i piani di propagazione e i diff, le risposte di Ask, le immagini e l'estrazione di un'importazione. Leggere è gratis: la ricerca, i suggerimenti di menzione e il recupero dietro un Ask non toccano mai questa barra.",
			warmExplainLabel: 'A cosa serve la preparazione al tavolo',
			warmPopoverBody:
				"Le bozze che Canonry prepara prima di una sessione, così la modalità tavolo risponde all'istante. Canonry la spende da sé, senza che nessuno la richieda: per questo ha un limite proprio e non intacca mai la quota inclusa.",
			renews: (date) => `Si rinnova il ${date}`,
			noRenewalDate: 'Nessuna data di rinnovo registrata.'
		},
		door: {
			createAccount: 'Crea un account',
			exportNote:
				'Markdown in entrata, markdown in uscita. Il tuo canone si esporta come file semplici su qualunque piano.'
		},
		accountMenu: {
			account: 'Account',
			language: 'Lingua',
			appearance: 'Aspetto',
			modelKeys: 'Chiavi modello',
			planAndCredits: 'Piano e crediti',
			export: 'Esportazione'
		},
		// Issue #148 (I10 = B): il selettore del drawer nella barra superiore del
		// telefono, l'icona della palette e l'avatar dell'account, più la barra di
		// tab in basso in stile E4 che la modalità universo riceve sotto `md`.
		// "Entries"/"Proposals" si leggono da `universe.nav` nel punto di chiamata,
		// non ripetuti qui.
		phoneNav: {
			openNavLabel: 'Navigazione e account',
			openNavDescription: 'Selettore universo, link di navigazione e controlli account.',
			closeNavLabel: 'Chiudi la navigazione',
			paletteTriggerLabel: 'Apri la palette dei comandi',
			accountLabel: 'Account',
			tabsAriaLabel: 'Sezioni principali',
			more: 'Altro'
		},
		palette: {
			dialogTitle: 'Palette dei comandi',
			dialogDescription: 'Vai a una voce, esegui un comando o fai una domanda.',
			closeLabel: 'Chiudi la palette dei comandi',
			placeholder: 'Vai a una voce, esegui un comando o fai una domanda…',
			askPlaceholder: 'Chiedi di questo universo…',
			askHeading: 'Chiedi',
			askAction: (question) => `Chiedi "${question}"`,
			askHint: 'Apre Chiedi',
			askHereHint: 'Risponde qui',
			entriesHeading: 'Voci',
			noEntryMatches: (query) => `Nessuna voce corrisponde a "${query}".`,
			loadingMessage: 'Ricerca in corso…',
			akaHint: (alias) => `alias ${alias}`,
			universesHeading: 'Universi',
			noUniverseMatches: (query) => `Nessun universo corrisponde a "${query}".`,
			actionsHeading: 'Azioni',
			emptyMessage: 'Nulla qui. Prova un altro nome, un\u2019azione o una domanda diversa.',
			accountSettingsAction: 'Account',
			footerMove: 'Sposta',
			footerOpen: 'Apri',
			footerClose: 'Chiudi'
		},
		// Issue #285 (decisione O3): la cornice non porta il colore del copilota, quindi il
		// nome e il glifo sono le sole cose che dicono che questo è il copilota. "Loremaster"
		// è un nome di prodotto e resta invariato, come "Canonry".
		quickAsk: {
			name: 'Loremaster',
			openLabel: 'Apri il Loremaster',
			closeLabel: 'Chiudi il Loremaster',
			context: (pageName) => `su ${pageName}`,
			streaming: 'in arrivo…',
			openInAsk: 'Apri in Chiedi'
		}
	},

	settings: {
		subNavAriaLabel: 'Sezioni delle impostazioni',

		appearance: {
			title: 'Aspetto',
			description:
				'Chiaro o scuro per tutto il prodotto: cambia la palette ovunque, modalità tavolo inclusa. Non cambia la dimensione del testo, la densità o altro.',
			light: 'Chiaro',
			dark: 'Scuro',
			system: 'Segui il sistema',
			save: 'Salva',
			error: 'Scegli chiaro, scuro o segui il sistema.'
		},

		language: {
			title: 'Lingua',
			description:
				"La lingua in cui l'interfaccia e il Loremaster ti parlano. È una preferenza legata al tuo account, quindi ti segue anche sul telefono al tavolo - non è la lingua in cui è scritto il tuo canone, che resta quella di ogni singola voce.",
			signInPrompt: 'Accedi per salvare una lingua preferita sul tuo account.',
			signInLink: 'Accedi',
			save: 'Salva',
			saved: 'Salvato.',
			error: 'Scegli una lingua dall\u2019elenco.',
			learnMorePrompt: 'Ti stai chiedendo cosa viene tradotto e cosa no?'
		},

		billing: {
			title: 'Fatturazione',
			description:
				'Quota inclusa con instradamento tra modelli economici e premium. Nessun credito opaco, e nessun piano qui è mai chiamato "illimitato": ogni piano indica un tetto reale.',
			signInPrompt: 'Accedi per vedere il tuo piano e il saldo.',
			signInLink: 'Accedi',
			checkoutCancelled: 'Il pagamento è stato annullato - il tuo piano non è cambiato.',
			currentPlan: (planName) => `Piano attuale: ${planName}`,
			renews: (date) => `Si rinnova il ${date}`,
			noRenewalDate: 'Nessuna data di rinnovo registrata.',
			includedThisPeriod: 'Incluso in questo periodo',
			purchased: 'Acquistato (non scade)',
			warmBudget: 'Preparazione al tavolo',
			creditsCount: (count) => {
				const n = numberFormat('it', { maximumFractionDigits: 0, useGrouping: 'always' }).format(
					count
				);
				const form = pluralRules('it').select(Math.round(count));
				return form === 'one' ? `${n} credito` : `${n} crediti`;
			},
			plansHeading: 'Piani',
			perMonth: '/mese',
			currentPlanBadge: 'Piano attuale',
			switchTo: (planName) => `Passa a ${planName}`
		},

		export: {
			title: 'Esportazione',
			para1Before:
				"Ogni voce di un universo diventa un file markdown con frontmatter YAML, tutte insieme in un unico zip, più un README che indica l'universo e la data dell'esportazione. Le menzioni ",
			para1After:
				" restano scritte esattamente come sono, perché il markdown è il modo in cui Canonry conserva il canone: quello che esce da questo zip è quello che c'è nel database, senza riscritture per adattarlo a un altro formato.",
			para2Before:
				'Questo è un dump piatto, non una cartella tipizzata pronta per git: ogni file sta al livello più alto dello zip, con il nome dello slug della voce. Anche le voci riservate al GM sono incluse, con la propria ',
			para2After:
				' indicata nel frontmatter invece di essere nascosta o filtrata - questa è la copia del GM, non quello che vedrebbero i giocatori.',
			emptyState: 'Nessun universo ancora.',
			downloadButton: 'Scarica lo .zip'
		},

		keys: {
			title: 'Chiavi API',
			infoPara1Before:
				'Usa la tua chiave per collegare il tuo account presso il provider invece del nostro. ',
			infoPara1Bold: 'Disattivata di default, per ogni provider, finché non ne aggiungi una',
			infoPara1After: '.',
			infoPara2Bold: 'Cosa cambia:',
			infoPara2After:
				' una chiamata instradata sulla tua chiave smette di consumare la quota inclusa o la preparazione al tavolo, e si applicano i limiti del tuo provider invece dei nostri.',
			infoPara3Bold: 'Cosa non cambia:',
			infoPara3After:
				" l'instradamento dei modelli resta invariato (la stessa suddivisione modello economico per i candidati, premium per i diff funziona sulla tua chiave esattamente come sulla nostra), la chiamata passa comunque dal nostro gateway quindi log e conteggio dei costi restano uniformi, e i contenuti generati portano comunque la stessa marcatura di autore e le stesse regole sulla privacy, indipendentemente da quale chiave l'ha pagata.",
			infoPara3Link: 'Informativa completa',
			signInLink: 'Accedi',
			signInPrompt: 'per configurare una chiave.',
			activeBadge: 'Attiva',
			offBadge: 'Disattivata',
			keyEndingIn: (lastFour) => `Chiave che termina con ${lastFour}`,
			addedOn: (date) => `aggiunta il ${date}`,
			lastUsedOn: (date) => `usata l'ultima volta il ${date}`,
			neverUsedYet: 'mai usata',
			turnOff: 'Disattiva',
			turnOn: 'Attiva',
			forgetKey: 'Dimentica questa chiave',
			replaceKeyLabel: 'Sostituisci chiave',
			addKeyLabel: 'Aggiungi chiave',
			apiKeyPlaceholder: (providerLabel) => `Chiave API ${providerLabel}`,
			replaceButton: 'Sostituisci',
			saveButton: 'Salva',
			savedConfirmation: (lastFour) =>
				`Salvata - vengono mostrati di nuovo solo gli ultimi quattro caratteri (…${lastFour}).`,
			addSignInRequired: 'Accedi per aggiungere una chiave.',
			addPickProvider: "Scegli un provider dall'elenco.",
			addPasteKey: 'Incolla la chiave prima di salvare.',
			addSaveFailedFallback: 'Non è stato possibile salvare questa chiave.',
			toggleSignInRequired: 'Accedi per modificare una chiave.',
			removeSignInRequired: 'Accedi per rimuovere una chiave.',
			unknownProvider: 'Provider sconosciuto.'
		},

		account: {
			title: 'Account',
			description:
				"Il nome e l'email che il prodotto mostra su ogni schermata, la tua password, e come uscire ovunque o eliminare del tutto l'account.",
			signInPrompt: 'Accedi per vedere e modificare il tuo account.',
			signInLink: 'Accedi',
			nameLabel: 'Nome',
			nameSave: 'Salva nome',
			nameSaving: 'Salvataggio…',
			nameSaved: 'Salvato.',
			nameSaveFailedFallback: 'Non è stato possibile salvare questo nome.',
			nameRequired: 'Inserisci un nome.',
			emailLabel: 'Email',
			emailNote: "L'email non è ancora modificabile da questa pagina.",
			passwordHeading: 'Password',
			currentPasswordLabel: 'Password attuale',
			newPasswordLabel: 'Nuova password',
			passwordSave: 'Cambia password',
			passwordSaving: 'Modifica in corso…',
			passwordSaved: 'Password cambiata.',
			passwordSaveFailedFallback: 'Non è stato possibile cambiare la password.',
			passwordRequired: 'Inserisci la password attuale e quella nuova.',
			sessionsHeading: 'Sessioni',
			sessionsDescription:
				'Termina ogni sessione attiva per questo account, incluso questo dispositivo, quindi dovrai accedere di nuovo ovunque.',
			signOutEverywhereButton: 'Esci ovunque',
			signOutEverywhereInProgress: 'Uscita da ovunque in corso…',
			signOutEverywhereFailedFallback: 'Non è stato possibile terminare tutte le sessioni.',
			deleteHeading: 'Elimina account',
			deleteIntro:
				"Questa azione chiude l'account in modo definitivo. Non c'è modo di tornare indietro una volta seguito il link di conferma.",
			deleteImpact: (impact) => {
				const universes = impact.universes === 1 ? '1 universo' : `${impact.universes} universi`;
				const entities = impact.entities === 1 ? '1 entit\u00e0' : `${impact.entities} entit\u00e0`;
				const revisions = impact.revisions === 1 ? '1 revisione' : `${impact.revisions} revisioni`;
				const proposals = impact.proposals === 1 ? '1 proposta' : `${impact.proposals} proposte`;
				const images = impact.images === 1 ? '1 immagine' : `${impact.images} immagini`;
				return `Eliminare questo account porta con s\u00e9 ${universes}, ${entities}, ${revisions}, ${proposals} e ${images}.`;
			},
			deleteExportPrompt:
				'Esporta ci\u00f2 che vale la pena conservare prima di chiedere il link di conferma.',
			deleteExportLink: "Vai all'esportazione",
			deletePasswordLabel: 'Password attuale',
			deleteButton: 'Inviami un link di conferma',
			deleteSending: 'Invio…',
			deletePasswordRequired: 'Inserisci la password attuale per richiedere il link di conferma.',
			deleteWrongPassword: 'Quella password non \u00e8 corretta.',
			deleteSendFailed:
				'La mail di conferma non \u00e8 stata inviata. Nulla \u00e8 stato eliminato; riprova.',
			deleteRequested:
				"Controlla la posta in arrivo: il link in quella mail \u00e8 ci\u00f2 che elimina davvero l'account, e scade tra 24 ore."
		}
	},

	auth: {
		signIn: {
			title: 'Accedi',
			subtitle: 'I tuoi universi, il tuo account, di nessun altro.',
			emailLabel: 'Email',
			passwordLabel: 'Password',
			credentialsRequired: 'Inserisci email e password.',
			signInFailed: 'Non è stato possibile accedere. Controlla email e password.',
			submit: 'Accedi',
			submitting: 'Accesso in corso…',
			noAccount: 'Non hai ancora un account?',
			signUpLink: 'Registrati',
			orDivider: 'oppure',
			continueWith: (provider) => `Continua con ${provider}`,
			forgotPasswordLink: 'Password dimenticata?'
		},
		signUp: {
			title: 'Registrati',
			subtitle: 'Un account, i tuoi universi.',
			nameLabel: 'Nome',
			emailLabel: 'Email',
			passwordLabel: 'Password',
			fieldsRequired: 'Inserisci nome, email e password.',
			signUpFailed: 'Non è stato possibile creare un account.',
			submit: 'Registrati',
			submitting: 'Creazione account…',
			haveAccount: 'Hai già un account?',
			signInLink: 'Accedi',
			orDivider: 'oppure',
			continueWith: (provider) => `Continua con ${provider}`
		},
		forgotPassword: {
			title: 'Recupera la password',
			subtitle: "Ti inviamo un link all'indirizzo del tuo account.",
			emailLabel: 'Email',
			emailRequired: "Inserisci l'indirizzo email del tuo account.",
			submit: 'Invia link di recupero',
			submitting: 'Invio in corso…',
			success:
				"Se quell'indirizzo ha un account, il link di recupero è in arrivo. Scade tra un'ora.",
			sendFailed: 'Non è stato possibile inviare il link. Riprova tra poco.',
			backToSignIn: "Torna all'accesso"
		},
		resetPassword: {
			title: 'Imposta una nuova password',
			subtitle: 'Scegli una nuova password per il tuo account.',
			newPasswordLabel: 'Nuova password',
			confirmPasswordLabel: 'Conferma password',
			passwordRequired: 'Inserisci una nuova password e confermala.',
			submit: 'Imposta nuova password',
			submitting: 'Impostazione in corso…',
			passwordMismatch: 'Le password non corrispondono.',
			invalidToken: 'Questo link è scaduto o è già stato usato.',
			requestNewLink: 'Richiedi un nuovo link',
			success: 'Password aggiornata. Accedi con la tua nuova password.',
			signInLink: 'Accedi'
		},
		accountDeleted: {
			title: 'Account eliminato',
			subtitle: 'Sparito, universi inclusi.',
			body: "L'account e tutto ci\u00f2 che possedeva sono spariti. Accedere con quelle credenziali non funzioner\u00e0 pi\u00f9.",
			homeLink: 'Torna a Canonry'
		},
		languageSwitcher: {
			label: 'Lingua'
		},
		footer: {
			whatCanonryIs: "Cos'è Canonry",
			docs: 'Documentazione',
			privacy: 'Privacy'
		},
		argument: {
			intro:
				'Cambia una voce e Canonry ti dice quali altre ne risentono, prepara ogni aggiornamento e aspetta.',
			aldricSentence:
				"Congedato dalla guardia nel disgelo dopo l'Inverno Sabbia, ora risponde al Libro Mastro di Cenere.",
			watchLeadPrefix: 'La Guardia è comandata da',
			watchBefore: 'Capitano Aldric Vane',
			watchAfter: 'un capitano facente funzione, senza nome dal disgelo',
			waitingBadge: 'ti aspetta',
			evidence: 'Prova: Aldric Vane, paragrafo 1.',
			disclaimer:
				'Niente di quanto sopra è stato applicato. Ogni riga scritta da un modello aspetta la tua approvazione, una voce alla volta.'
		}
	},

	mail: {
		passwordReset: {
			subject: 'Reimposta la tua password Canonry',
			heading: 'Reimposta la tua password',
			body: 'Qualcuno ha chiesto di reimpostare la password di questo account. Se sei stato tu, scegline una nuova qui sotto.',
			button: 'Reimposta password',
			linkFallback: 'Oppure incolla questo link nel browser:',
			expiryNotice: "Questo link scade tra un'ora.",
			ignoreNotice:
				'Se non hai fatto questa richiesta, ignora pure questa email: la tua password resterà invariata.'
		},
		deleteAccount: {
			subject: "Conferma l'eliminazione del tuo account Canonry",
			heading: "Conferma l'eliminazione dell'account",
			body: "Qualcuno ha chiesto di eliminare questo account. Cliccando sul link qui sotto elimini in modo permanente l'account e ogni universo, entit\u00e0, revisione, proposta e immagine che possiede. Non si pu\u00f2 annullare.",
			button: 'Elimina il mio account',
			linkFallback: 'Oppure incolla questo link nel browser:',
			expiryNotice: 'Questo link scade tra 24 ore.',
			ignoreNotice:
				"Se non hai fatto questa richiesta, ignora questa email: l'account rimarr\u00e0 esattamente com'\u00e8."
		}
	},

	players: {
		wikiLabel: 'Wiki dei giocatori',
		notDiscovered: 'Non ancora scoperto',
		revealed: 'Rivelato',
		indexTitle: 'Tutto ciò che il tavolo ha toccato',
		indexSubtitle:
			'Se è emerso al tavolo, è qui. Un nome in grigio è stato sentito ma non ancora esplorato.',
		emptyState: 'Non è stato ancora detto nulla ad alta voce.',
		gapNoticeBefore: 'Hai sentito il nome. Nessuno al tavolo ha ancora scoperto abbastanza su',
		gapNoticeAfter: (type) => `perché questa pagina di tipo ${type} dica di più, per ora.`,
		factsHeading: 'Cosa si sa',
		relationsHeading: 'Relazioni note',
		media: {
			heading: 'Immagini'
		}
	},

	mentionPreview: {
		gap: 'Se ne è sentito parlare, ma non è ancora stato scoperto.',
		empty: 'Nessuno ha ancora scritto questa pagina.'
	},

	docsLanguages: {
		title: 'Cosa traduciamo, e cosa no',
		intro:
			'Chi sta per affidarci un decennio di appunti di gioco merita una risposta diretta sulla lingua, non un elenco di funzionalità. Ecco cosa promette Canonry, e dove quella promessa si ferma.',
		interfaceHeading: 'L\u2019interfaccia e il Loremaster parlano la tua lingua',
		interfaceBody:
			'Menu, pulsanti, stati vuoti, messaggi di errore, date e i numeri nel pannello dei crediti seguono la lingua del tuo account - oggi inglese o italiano - ovunque tu sia collegato, telefono al tavolo incluso. Tutto ciò che il Loremaster ti dice segue la stessa preferenza: una risposta di Ask, il motivo di un piano di propagazione, la spiegazione di una segnalazione di controllo, sempre nella tua lingua, qualunque sia la lingua del canone sotto.',
		canonHeading: 'Il tuo canone mantiene la propria lingua',
		canonBody:
			'Questa è la regola che conta davvero, e va nella direzione opposta. La lingua di una voce viene rilevata da ciò che hai già scritto al suo interno, voce per voce, nel momento in cui la salvi - e puoi correggerla se il rilevatore sbaglia. Quando il Loremaster propone un paragrafo destinato a finire dentro una voce, lo scrive nella lingua di quella voce, non nella tua: un\u2019interfaccia in italiano non inizia a scrivere paragrafi in italiano dentro una voce in inglese solo perché sei tu a leggere lo schermo. Una proposta di propagazione può avere due lingue insieme, ed entrambe sono corrette: il testo proposto è nella lingua della voce di destinazione, il motivo per cui esiste è nella tua.',
		namesBody:
			'I nomi non vengono mai tradotti, né da un\u2019importazione né da una proposta. "The Gilded Rat" resta "The Gilded Rat" anche in una frase italiana, come il nome di una persona.',
		retrievalHeading: 'La ricerca attraversa il confine',
		retrievalBody:
			'Niente di tutto questo vale molto se la ricerca funziona solo dentro una lingua. Una domanda in italiano deve trovare la voce in inglese che le risponde - è questo che rende la scelta del modello di embedding una scelta multilingue e non un dettaglio, ed è per questo che "chi gestisce il Ratto Dorato" e "who runs the Gilded Rat Tavern" possono indicare la stessa locanda.',
		noRewriteHeading: 'Niente riscrive quello che hai scritto',
		noRewriteBody:
			'Il Loremaster propone; non riscrive la tua prosa di propria iniziativa, in nessuna lingua. Un paragrafo proposto resta nella tua casella come qualsiasi altra proposta finché non lo accetti - non esiste un lavoro in background che traduce il tuo mondo mentre non guardi.',
		limitsHeading: 'Cosa questo non include',
		limitsIntro:
			'Detto senza giri di parole, perché i limiti sono la parte che vale la pena di fidarsi:',
		limitLocales:
			'Due lingue, oggi. Inglese e italiano, nient\u2019altro, al lancio - una terza non è su questa pagina perché non è stata decisa, non perché sarebbe difficile.',
		limitNoBulkTranslation:
			'Nessuna traduzione in blocco di un mondo già esistente. Non esiste un pulsante che riscrive tutto quello che hai già scritto in un\u2019altra lingua. La tua prosa è tua, e una riscrittura di massa è un lavoro che Canonry non esegue: un paragrafo tradotto è una proposta come le altre, una voce alla volta, e va comunque accettato da te.',
		limitQuotations:
			'Le citazioni restano sempre nella lingua originale. Le prove dietro una proposta sono citate parola per parola dalla voce da cui provengono - tradotta, una citazione non è più la frase che si trova davvero nel tuo canone, e non puoi verificarla confrontandola con il testo. Una traduzione può comparire accanto a una citazione, segnata chiaramente come nostra, ma mai al suo posto.',
		limitCopilotDirection:
			'Quando il Loremaster parla con te, segue la lingua della tua interfaccia, non quella della voce. Chiedi al tuo account in italiano di una voce in inglese, e la risposta arriva in italiano - è l\u2019opposto della regola qui sopra, apposta: quella regola governa cosa finisce scritto nel tuo canone, questa governa cosa ti viene detto a riguardo.'
	},

	entry: {
		page: {
			editLink: 'Modifica',
			aliasesLabel: (aliases) => `anche: ${aliases}`
		},

		secrets: {
			hiddenBlock: 'Nascosto \u00b7 si sblocca alla rivelazione',
			gmNoteBlock: 'Nota del GM \u00b7 mai mostrata ai giocatori',
			gmView: 'Vista GM',
			playerPreviewActive: 'Anteprima giocatori, quello che vede il tavolo',
			showGmView: 'Mostra vista GM',
			playerPreview: 'Anteprima giocatori'
		},

		language: {
			label: 'Lingua',
			autoDetect: 'Rilevamento automatico',
			unsure: 'Non sicuro / misto',
			detectedPrefix: (name) => `Rilevata: ${name}`,
			detectedUnknown: 'testo insufficiente per stabilirlo'
		},

		cover: {
			placeholderAction: 'Aggiungi una copertina',
			placeholderHint: 'Carica un\u2019immagine, oppure generane una.',
			dialogTitle: (entityName) => `Copertina di ${entityName}`,
			dialogHint:
				'Un\u2019immagine che carichi diventa subito la copertina. Una generata lo diventa quando lo decidi tu.',
			uploadAction: 'Carica un\u2019immagine',
			uploadHint: 'Un file PNG, JPEG o WEBP tuo.',
			uploading: 'Caricamento\u2026',
			generateAction: 'Genera un\u2019immagine',
			generateHint: (credits) =>
				`Un\u2019immagine disegnata per questa voce, ${credits} ${credits === 1 ? 'credito' : 'crediti'}.`,
			generateRunning: 'Sto disegnando una copertina per questa voce',
			generatedHint: 'Niente diventa copertina finché non la scegli tu.',
			notConfigured:
				'Non c\u2019è ancora un modello di immagini configurato, quindi solo un caricamento può diventare copertina.',
			aiOff:
				'La generazione è disattivata per questo universo. Puoi comunque caricare un\u2019immagine tua.',
			cancel: 'Annulla'
		},

		complete: {
			button: 'Completa la voce',
			running: 'Il Loremaster sta scrivendo una bozza per questa voce',
			empty: 'Al momento non c\u2019è nulla da completare.',
			genericFailure: 'Non è stato possibile eseguire il completamento.',
			aiOff: 'La scrittura è disattivata per questo universo.'
		},

		sections: {
			ariaLabel: 'Dettagli della voce',
			relations: 'Relazioni',
			facts: 'Fatti',
			images: 'Immagini',
			history: 'Cronologia',
			audit: 'Verifica',
			mobile: {
				trigger: 'Dettagli',
				closeLabel: 'Chiudi i dettagli',
				description: 'Relazioni, fatti, immagini, cronologia e verifica per questa voce.'
			}
		},

		relations: {
			empty: 'Nessuna relazione registrata finora.',
			explanation:
				'Una relazione compare quando viene accettata una proposta di propagazione o di importazione che la introduce.'
		},

		facts: {
			empty: 'Nessun fatto estratto finora.',
			explanation:
				"I fatti provengono dalla prosa della voce: per questa voce l'estrazione non è ancora stata eseguita."
		},

		history: {
			empty: 'Nessuna revisione finora.',
			explanation:
				'Una revisione compare quando una modifica a questa voce viene salvata e accettata.',
			revisionHuman: 'umano',
			revisionAiAccepted: 'IA \u00b7 accettata'
		},

		audit: {
			empty: 'Nessuna segnalazione su questa voce al momento.',
			disclaimer: 'Da controllare, non necessariamente sbagliato.',
			dismiss: 'Ignora',
			dismissing: 'Ignorando\u2026',
			openBoth: 'Apri entrambe le voci:',
			toCheck: (count) => (count === 1 ? '1 da controllare' : `${count} da controllare`)
		},

		media: {
			aiOffBanner:
				'La generazione è disattivata per questo universo. Le immagini esistenti restano visibili qui sotto, ma non se ne possono generare di nuove finché non viene riattivata.',
			empty: 'Nessuna immagine finora.',
			explanation:
				'Le immagini si generano su richiesta, con un clic che chiede sempre conferma della spesa.',
			generatedBadge: 'Generata',
			generateButton: 'Genera immagine',
			candidatesSummary: (reusedFromCache, multiple) => {
				const lead = reusedFromCache
					? 'Recuperata dalla cache di similarità - nessun addebito.'
					: 'Generata:';
				return multiple ? `${lead} scegline una da inserire.` : lead;
			},
			insert: 'Inserisci',
			inserting: 'Inserimento in corso\u2026',
			discard: 'Scarta',
			styleOverrideLabel:
				'Stile personalizzato per questa voce (lascia vuoto per usare lo stile dell\u2019universo)',
			save: 'Salva',
			cancel: 'Annulla',
			genericGenerationFailedWithStatus: (status) => `Generazione non riuscita (${status})`,
			genericGenerationFailed: 'Generazione non riuscita',
			genericInsertFailedWithStatus: (status) => `Inserimento non riuscito (${status})`,
			genericInsertFailed: 'Inserimento non riuscito',
			styleSaveFailedWithStatus: (status) => `Salvataggio dello stile non riuscito (${status})`,
			genericStyleSaveFailed: 'Salvataggio dello stile non riuscito',
			dialogTitle: (entityName) => `Genera immagine: ${entityName}`,
			howManyAriaLabel: 'Quante immagini',
			styleLabel: (modifier) =>
				`Stile: ${modifier && modifier.length > 0 ? modifier : 'nessuno impostato'}`,
			editStyle: 'modifica',
			fourOptions: 'Quattro opzioni tra cui scegliere',
			oneImage: 'Un\u2019immagine',
			notConfigured: 'non configurato',
			suggestedForCharacter: '\u00b7 consigliato per un personaggio',
			creditsLabel: (count) => {
				const n = numberFormat('it', { maximumFractionDigits: 0, useGrouping: 'always' }).format(
					count
				);
				const form = pluralRules('it').select(Math.round(count));
				return form === 'one' ? `${n} credito` : `${n} crediti`;
			},
			privateHint:
				'L\u2019immagine resta privata finché non la inserisci qui - non raggiunge mai da sola il wiki dei giocatori.',
			generateAction: 'Genera',
			generating: 'Generazione in corso\u2026',
			upload: {
				button: 'Carica immagine',
				uploading: 'Caricamento in corso\u2026',
				uploadedBadge: 'Caricata',
				noFile: 'Scegli un file da caricare.',
				tooLarge: (maxMegabytes) => `L\u2019immagine supera il limite di ${maxMegabytes}MB.`,
				unsupportedType: 'Puoi caricare solo immagini PNG, JPEG o WEBP.',
				typeMismatch: 'Il tipo dichiarato del file non corrisponde al suo contenuto.',
				genericUploadFailedWithStatus: (status) => `Caricamento non riuscito (${status})`,
				genericUploadFailed: 'Caricamento non riuscito'
			},
			inBody: {
				toolbarLabel: 'Immagine',
				toolbarTitle: 'Inserisci un\u2019immagine nel testo',
				dialogTitle: 'Inserisci un\u2019immagine',
				existingHeading: 'Le immagini di questa voce',
				uploadHeading: 'Caricane una',
				emptyExisting:
					'Nessuna immagine collegata a questa voce - caricane o generane una qui sotto.',
				generateHeading: 'Generane una nuova',
				sceneCost: (credits) =>
					`Un\u2019immagine panoramica della scena di questa voce, ${credits} ${credits === 1 ? 'credito' : 'crediti'}.`,
				sceneNotConfigured: 'Nessun modello di immagini configurato per le scene.',
				generateButton: 'Genera',
				insertThisImage: 'Inserisci questa immagine',
				useThisOne: 'Usa questa',
				generateFailedWithStatus: (status) => `Generazione non riuscita (${status})`,
				generateFailed: 'Generazione non riuscita',
				attachFailedWithStatus: (status) =>
					`Collegamento dell\u2019immagine non riuscito (${status})`,
				attachFailed: 'Collegamento dell\u2019immagine non riuscito'
			},
			/** Issue #255: affina un candidato con un'istruzione invece di un tiro nuovo. */
			regenerate: {
				trigger: "Affina con un'istruzione",
				dialogTitle: (entityName) => `Rigenera: ${entityName}`,
				hint: "Parte dall'immagine che stai guardando, non da un tiro nuovo: stessa entità e stesso stile, cambia solo quello che chiedi.",
				instructionLabel: 'Cosa non va?',
				instructionPlaceholder: "più vecchio, e senza l'elmo",
				action: 'Rigenera',
				regenerating: 'Rigenerazione in corso\u2026',
				instructionMustBeString: 'instruction deve essere una stringa',
				fromAssetIdMustBeString: 'fromAssetId deve essere una stringa',
				sourceHasNoPrompt: 'Quell\u2019immagine non ha un prompt salvato da cui rigenerare.'
			},
			// #254: il controllo di pubblicazione/ritiro per singola immagine e la frase di
			// riepilogo sotto la griglia. Sostituisce la vecchia `privateNote` incondizionata,
			// che smetteva di essere vera non appena un'immagine poteva essere pubblicata -
			// questa resta accurata sia con la griglia tutta privata, tutta pubblicata, o mista.
			publish: {
				publishedBadge: 'Pubblicata',
				publishedNote: 'Pubblicata nel wiki dei giocatori.',
				privateNote: 'Privata.',
				publishLabel: 'Pubblica',
				unpublishLabel: 'Ritira dal wiki',
				publishing: 'Pubblicazione in corso\u2026',
				unpublishing: 'Ritiro in corso\u2026',
				explanation:
					"Pubblica un'immagine per aggiungerla al wiki dei giocatori. Da qui nulla arriva ai giocatori da solo.",
				publishedMustBeBoolean: 'published deve essere un booleano',
				genericPublishFailedWithStatus: (status) => `Pubblicazione non riuscita (${status})`,
				genericPublishFailed: 'Pubblicazione non riuscita'
			},

			cover: {
				badge: 'Copertina',
				useLabel: 'Usa come copertina',
				removeLabel: 'Rimuovi da copertina',
				saving: 'Salvataggio in corso\u2026',
				explanation:
					'La copertina compare sopra il titolo di questa voce. I giocatori la vedono solo quando l\u2019immagine stessa è pubblicata.',
				mediaAssetIdMustBeStringOrNull: 'mediaAssetId deve essere una stringa oppure null',
				mustBeAnImage: 'Solo un\u2019immagine può essere una copertina',
				genericCoverFailedWithStatus: (status) =>
					`Impostazione della copertina non riuscita (${status})`,
				genericCoverFailed: 'Impostazione della copertina non riuscita'
			}
		},

		editor: {
			breadcrumbEdit: 'Modifica',
			heading: (entityName) => `Modifica ${entityName}`,
			save: 'Salva',
			bodyAriaLabel: 'Corpo della voce, markdown',
			view: {
				ariaLabel: 'Vista editor',
				write: 'Scrivi',
				preview: 'Anteprima',
				previewAriaLabel: 'Anteprima della voce, come la mostra la pagina',
				previewEmpty: 'Non c\u2019\u00e8 ancora niente da vedere in anteprima.'
			}
		},

		toolbar: {
			ariaLabel: 'Formattazione',
			bold: 'Grassetto',
			italic: 'Corsivo',
			heading: 'Titolo',
			list: 'Elenco puntato',
			quote: 'Citazione',
			link: 'Link',
			mention: 'Menzione'
		},

		mentionMenu: {
			ariaLabel: 'Suggerimenti di menzione',
			matching: (query) => `Corrispondenze per "${query}"`,
			noExactMatch: 'Nessuna corrispondenza esatta',
			noMatchBefore: (query) => `Nessuna voce di nome "${query}" ancora. Chiudila con`,
			noMatchAfter: 'per lasciare una menzione non risolta.',
			aliasLabel: (aliases) => `alias: ${aliases}`
		},

		errors: {
			universeNotFound: (slug) => `Nessun universo chiamato "${slug}"`,
			entryNotFound: (slug, universeName) => `Nessuna voce chiamata "${slug}" in ${universeName}`,
			viewerCannotEdit: 'I lettori non possono modificare le voci',
			viewerCannotChangeLanguage: 'I lettori non possono cambiare la lingua di una voce',
			viewerCannotGenerateMedia: 'I lettori non possono generare o allegare media',
			missingBody: 'Corpo mancante',
			missingProposalId: 'proposalId mancante',
			missingLanguageChoice: 'Scelta della lingua mancante',
			unknownLanguage: (choice) => `Lingua sconosciuta "${choice}"`,
			completeCannotRun: (message) => `Impossibile eseguire il completamento: ${message}`,
			modifierMustBeString: 'modifier deve essere una stringa',
			featureInvalid: 'feature deve essere "portrait", "variants" o "scene"',
			generationOff: 'La generazione è disattivata per questo universo.',
			notEnoughCredits: 'Crediti insufficienti per generare questa immagine.',
			mediaAssetIdMustBeString: 'mediaAssetId deve essere una stringa',
			noSuchGeneratedImage: 'Nessuna immagine generata di questo tipo in questo universo',
			alreadyAttached: 'Quell\u2019immagine è già allegata a una voce, oppure non esiste.',
			noSuchImage: 'Nessuna immagine di questo tipo in questo universo'
		}
	},

	proposals: {
		title: 'Proposte',

		inbox: {
			empty: 'Niente in sospeso. Modifica una voce per avviare una propagazione.',
			from: (provenance) => `Da: ${provenance}`,
			entriesLabel: (total) => {
				const form = pluralRules('it').select(total);
				return `${total} ${form === 'one' ? 'voce' : 'voci'}`;
			},
			pendingLabel: (count) => `${count} in sospeso`,
			importFrom: (playbook) => `Da: importazione ${playbook}`,
			importSummary: (total, pending) => {
				const form = pluralRules('it').select(total);
				return `${total} ${form === 'one' ? 'proposta' : 'proposte'}: ${pending} in sospeso`;
			},
			openImportReview: "Apri la revisione dell'importazione"
		},

		provenance: (trigger, entityName) => {
			// "Chiedi" è il nome della modalità nell'interfaccia, quindi la provenienza la
			// chiama così (issue #270): una proposta nata da una domanda su Cairnmouth non è
			// una modifica di Cairnmouth.
			if (trigger === 'ask') {
				return entityName ? `una domanda in Chiedi su ${entityName}` : 'una domanda in Chiedi';
			}
			if (entityName) return `una modifica di ${entityName}`;
			const labels: Record<string, string> = {
				save: 'una modifica',
				complete: 'un completamento',
				audit: 'un controllo',
				import: "un'importazione",
				table: 'la modalità tavolo'
			};
			return labels[trigger] ?? trigger;
		},

		plan: {
			crumbCurrent: 'Piano',
			heading: (provenance) => `Piano \u00b7 da ${provenance}`
		},

		checklist: {
			keptSuffix: (total, cap) => {
				const form = pluralRules('it').select(total);
				const word = form === 'one' ? 'mantenuto' : 'mantenuti';
				const capPart = cap === null ? 'nessun limite' : `limite ${cap}`;
				return ` su ${total} ${word} \u00b7 ${capPart}`;
			},
			estimatedCredits: (credits) => {
				const form = pluralRules('it').select(credits);
				return {
					prefix: 'Stima: ',
					suffix:
						form === 'one'
							? ' credito per generare le differenze'
							: ' crediti per generare le differenze'
				};
			},
			drop: 'Scarta',
			empty: 'Non è rimasto nulla in questo piano.',
			generating: 'Generazione in corso\u2026',
			generateDiffs: (count) => `Genera differenze (${count})`,
			creditsUnit: 'cr'
		},

		queue: {
			empty: "Non c'è più nulla da revisionare.",
			position: (total) => ({ prefix: 'Proposta ', suffix: ` di ${total}` }),
			filterShown: (typeLabel) => `(${typeLabel} mostrati)`,
			acceptedSuffix: (count) =>
				pluralRules('it').select(count) === 'one' ? ' accettata' : ' accettate',
			rejectedSuffix: (count) =>
				pluralRules('it').select(count) === 'one' ? ' rifiutata' : ' rifiutate',
			acceptedToast: (entityName) => `Accettato: ${entityName ?? 'la voce'}`,
			undoFailedToast: "Impossibile annullare: non c'è nulla da ripristinare.",
			undo: 'Annulla',
			keyboardMove: 'sposta',
			keyboardAccept: 'accetta',
			keyboardReject: 'rifiuta',
			keyboardUndo: 'annulla'
		},

		diffCard: {
			newEntry: 'Nuova voce',
			accepted: 'accettata',
			rejected: 'rifiutata',
			accept: 'Accetta',
			reject: 'Rifiuta',
			undo: 'Annulla',
			changedRegions: (count) => `${count} punti modificati`,
			unchangedUnits: (count) =>
				count === 1 ? '1 frase non modificata' : `${count} frasi non modificate`,
			removedLabel: 'Rimosso:',
			addedLabel: 'Aggiunto:',
			changedLabel: 'Riscritto:',
			kindLabel: (kind) => {
				const labels: Record<string, string> = {
					create: 'nuovo',
					update: 'modifica',
					relation: 'relazione',
					draft_entity: 'bozza',
					flag: 'segnalazione',
					relation_type_reuse: 'riusa tipo',
					relation_type_widen: 'amplia tipo',
					relation_type_new: 'nuovo tipo'
				};
				return labels[kind] ?? kind;
			},
			entityTypeLabel: (type) => {
				const labels: Record<string, string> = {
					character: 'personaggio',
					place: 'luogo',
					faction: 'fazione',
					item: 'oggetto',
					event: 'evento',
					session: 'sessione',
					relation: 'relazione'
				};
				return labels[type] ?? type;
			},
			rejectReasonLabel: (value) => PROPOSAL_REJECT_REASON_LABELS_IT[value] ?? value
		},

		filterBuckets: {
			all: 'Tutti',
			character: 'Personaggi',
			place: 'Luoghi',
			faction: 'Fazioni',
			item: 'Oggetti',
			event: 'Eventi',
			session: 'Sessioni',
			relation: 'Relazioni',
			relation_type: 'Vocabolario'
		},

		relationVocab: {
			reuseHeading: 'Riusa un tipo di relazione esistente',
			widenHeading: 'Amplia un tipo di relazione esistente',
			newHeading: 'Nuovo tipo di relazione',
			askReuse: 'Il modello lo ha chiamato in un altro modo: ecco il tipo a cui si riferisce.',
			askWiden: 'Questo tipo esiste già, ma non ammette ancora questa coppia di elementi.',
			askNew: 'Questo mondo non ha ancora questo tipo di relazione.',
			reuseType: (label, inverseLabel) =>
				`Riusa il tuo tipo esistente "${label}" / "${inverseLabel}"`,
			admitsCurrently: (pairs) => `Attualmente ammette ${pairs}.`,
			widensTo: (fromLabel, toLabel) =>
				`Lo amplia per ammettere anche ${fromLabel} \u2192 ${toLabel}.`,
			newType: (label, inverseLabel, cardinality) =>
				`Crea "${label}" / "${inverseLabel}", ${cardinality}`,
			newAdmits: (pairs) => `Ammetterebbe ${pairs}.`,
			waitingCount: (count) => {
				const form = pluralRules('it').select(count);
				return `${count} ${form === 'one' ? 'relazione in attesa' : 'relazioni in attesa'} di questo`;
			},
			cardinalityLabel: (cardinality) => {
				const labels: Record<string, string> = {
					one_to_one: 'uno a uno',
					one_to_many: 'uno a molti',
					many_to_one: 'molti a uno',
					many_to_many: 'molti a molti'
				};
				return labels[cardinality] ?? cardinality;
			}
		},

		bulkReject: {
			rejecting: 'Rifiuto in corso\u2026',
			rejectShown: (count) => {
				const form = pluralRules('it').select(count);
				return `Rifiuta ${count} ${form === 'one' ? 'mostrata' : 'mostrate'}`;
			},
			rejectedCount: (count) => {
				const form = pluralRules('it').select(count);
				return `${form === 'one' ? 'Rifiutata' : 'Rifiutate'} ${count}.`;
			}
		},

		evidence: {
			button: 'Prova',
			embeddingOnly: 'Solo similarità di embedding',
			instructionOnly: 'La tua richiesta in Chiedi, non un collegamento nel canone',
			close: 'Chiudi',
			reasonRelation: (path, hops) => {
				const form = pluralRules('it').select(hops);
				return `relazione ${path}, ${hops} ${form === 'one' ? 'salto' : 'salti'}`;
			},
			reasonMention: (direction, matchedText) =>
				`menzione ${direction === 'forward' ? 'in avanti' : "all'indietro"} ("${matchedText}")`,
			reasonEmbedding: 'solo somiglianza testuale, nessun collegamento nel grafo',
			reasonInstruction: 'quello che hai chiesto in Chiedi, da cui è stata scritta',
			reasonImportAmbiguous: (path, count) => {
				const form = pluralRules('it').select(count);
				return `corrispondenza ambigua in "${path ?? "l'import"}", con ${count} ${form === 'one' ? 'voce esistente' : 'voci esistenti'}`;
			},
			reasonImportMatched: (path) => `corrisponde a una voce esistente in "${path ?? "l'import"}"`,
			reasonImportExtracted: (path) => `estratto da "${path ?? "l'import"}"`
		},

		rejectChips: {
			prompt: 'Perché no?',
			wrong: PROPOSAL_REJECT_REASON_LABELS_IT.wrong,
			alreadyTrue: PROPOSAL_REJECT_REASON_LABELS_IT['already true'],
			notCanonYet: PROPOSAL_REJECT_REASON_LABELS_IT['not canon yet'],
			tooMuch: PROPOSAL_REJECT_REASON_LABELS_IT['too much'],
			prose: PROPOSAL_REJECT_REASON_LABELS_IT.prose,
			other: 'Altro\u2026',
			otherPlaceholder: 'dicci di più\u2026',
			save: 'Salva'
		},

		inline: {
			regionLabel: 'Proposte in attesa su questa voce',
			heading: (pending) =>
				pending === 1 ? '1 proposta da rivedere' : `${pending} proposte da rivedere`,
			headingSettled: 'Nessuna proposta in attesa qui',
			position: (index, total) => `${index} di ${total}`,
			keys: 'muovi, accetta, rifiuta, annulla',
			acceptedNote: 'Accettata: ora è nel canone qui sopra.',
			failed: (message) => `Non è stato possibile registrare la decisione: ${message}`,
			awaitingDiff: (count) =>
				count === 1
					? '1 candidata su questa voce non ha ancora una bozza.'
					: `${count} candidate su questa voce non hanno ancora una bozza.`,
			awaitingDiffLink: 'apri il piano'
		},

		errors: {
			noDiffsToGenerate:
				'Questo piano non ha una voce modificata, quindi non ci sono differenze di propagazione da generare.',
			proposalNotFound: 'Questa proposta non esiste in questo universo.',
			unknownAction: 'Decisione non riconosciuta.',
			viewerCannotDecide: 'Chi ha accesso in sola lettura non può decidere una proposta.',
			missingRejectReason: 'Manca il motivo del rifiuto.',
			notRejected: 'Questa proposta non è stata rifiutata.'
		}
	},

	import: {
		review: {
			headTitle: (universeName) => `Revisione import · ${universeName}`,
			breadcrumbProposals: 'Proposte',
			breadcrumbCurrent: 'Revisione import',
			heading: (playbook) => `Revisione import · ${playbook}`,
			stillImporting: (count) =>
				`Importazione in corso — ${count} ${count === 1 ? 'proposta' : 'proposte'} finora.`,
			refresh: 'Aggiorna',
			statusNote: {
				stoppedAtCeiling: (note) =>
					note
						? `Import in pausa al tetto di credito: ${note}`
						: 'Import in pausa al tetto di credito — riavvialo per continuare da dove si era fermato.',
				cancelled: (note) => (note ? `Import annullato: ${note}` : 'Import annullato.'),
				failed: (note) => (note ? `Import non riuscito: ${note}` : 'Import non riuscito.')
			},
			emptyRunning: 'Niente da rivedere ancora.',
			emptyRunningExplanation:
				"Le proposte appariranno qui man mano che l'importazione elabora i documenti.",
			emptyDone: 'Niente da rivedere — questo import non ha prodotto proposte.',
			filtering: 'Filtro in corso…',
			missing: {
				heading: (count) =>
					count === 1
						? '1 entità risulta mancante in questo import'
						: `${count} entità risultano mancanti in questo import`,
				explanation:
					'Esistevano dopo un import precedente di questa fonte ma non sono state trovate questa volta. Non è stato cancellato nulla — apri ciascuna e decidi cosa significa.'
			},
			errors: {
				universeNotFound: (slug) => `Nessun universo di nome "${slug}"`,
				jobNotFound: (jobId, universeName) => `Nessun import "${jobId}" in ${universeName}`,
				missingProposalId: 'ID proposta mancante.',
				proposalNotFound: (proposalId) => `Nessuna proposta "${proposalId}" in questo import.`,
				missingProposalOrReason: 'ID proposta o motivo mancante.',
				proposalNotRejected: 'Quella proposta non è stata rifiutata.',
				missingFilterType: 'Tipo di filtro mancante.'
			}
		},

		outcomeNote: {
			finished: (documents, proposals) =>
				`${documents} ${documents === 1 ? 'documento elaborato' : 'documenti elaborati'}, ${proposals} ${proposals === 1 ? 'proposta generata' : 'proposte generate'}`,
			noDocuments: 'Nessun documento da elaborare.',
			unchanged: (documents) =>
				documents === 1
					? "Nulla di cambiato: l'unico documento corrisponde a ciò che era già stato importato."
					: `Nulla di cambiato: tutti i ${documents} documenti corrispondono a ciò che era già stato importato.`,
			stoppedNoOffender: (documents, proposals) =>
				`Interrotto prima della fine: ${documents} ${documents === 1 ? 'documento concluso' : 'documenti conclusi'}, ${proposals} ${proposals === 1 ? 'proposta generata' : 'proposte generate'}`,
			offenderReason: {
				step_ceiling: 'ha raggiunto il limite di passi previsto per questo documento',
				cancelled_before_step: 'annullato prima che questo passo iniziasse',
				cancelled_mid_step: 'annullato a metà di un passo',
				tool_calls_unparseable:
					'tutte le chiamate a strumenti di questo passo non erano interpretabili, probabilmente troncate dal limite di output',
				step_worst_case_exceeds_budget:
					'il costo massimo di questo passo non entra nel budget di credito rimasto per questo import',
				job_budget_exhausted: 'il budget di credito di questo import è esaurito',
				never_started: 'mai avviato',
				model_call_failed: (errorName) => `la chiamata al modello è fallita: ${errorName}`,
				loop_guard: (toolName, count) =>
					`bloccato in un ciclo: ${toolName} è stato chiamato con gli stessi argomenti ${count} ${count === 1 ? 'volta' : 'volte'} di fila, quindi il documento è stato interrotto invece di proseguire fino al suo limite di passi`,
				other: (text) => text
			},
			offender: (path, reasonText) => `${path}: ${reasonText}`,
			offenderWithOthers: (base, othersCount) =>
				`${base} (e altri ${othersCount} ${othersCount === 1 ? 'documento che non è finito correttamente' : 'documenti che non sono finiti correttamente'})`,
			lossy: (path, count) =>
				`${path} ha perso ${count} ${count === 1 ? 'chiamata a uno strumento' : 'chiamate a strumenti'} lungo il percorso, probabilmente troncate dal limite di output di un passo`,
			lossyWithOthers: (base, othersCount) =>
				`${base} (e altri ${othersCount} ${othersCount === 1 ? 'documento che ne ha perse alcune' : 'documenti che ne hanno perse alcune'})`
		},

		start: {
			headTitle: 'Nuovo universo · Canonry',
			heading: 'Dai un nome al tuo universo',
			description:
				'Tutto, in Canonry, vive dentro un universo. Puoi aggiungerne altri più avanti dal selettore di qualsiasi universo.',
			nameLabel: "Nome dell'universo",
			namePlaceholder: 'La Landa di Valdoria',
			importCard: {
				heading: 'Importa un mondo',
				description:
					'Appunti, un export da un wiki o un PDF. Confermerai cosa Canonry ha rilevato prima che parta qualsiasi cosa.',
				cta: 'Importa il mio mondo'
			},
			emptyCard: {
				heading: 'Parti da zero',
				description: 'Niente da portare dentro, per ora. Aggiungi le voci a mano dal selettore.',
				cta: 'Crea vuoto'
			},
			preindexedCard: {
				heading: (baseName) => `Parti da ${baseName}`,
				genericHeading: 'Deriva da un universo pre-indicizzato',
				description:
					'Pre-indicizzato. Il tuo canone vince sempre su di esso, diverge voce per voce.',
				cta: (baseName) => `Parti da ${baseName}`,
				notConfigured: 'Nessun universo pre-indicizzato è configurato su questa installazione.'
			},
			errors: { nameRequired: 'Dai prima un nome al tuo universo.' }
		},

		upload: {
			headTitle: (universeName) => `Import in ${universeName} · Canonry`,
			heading: 'Importa il tuo mondo',
			description:
				'Trascina un export da Obsidian, Kanka, World Anvil o OneNote, oppure un file PDF o DOCX. Canonry indovina la sorgente e ti mostra cosa ha trovato prima che parta qualsiasi cosa.',
			noLiveModelNotice:
				'Questa installazione non ha un modello live configurato, quindi in questo momento possono davvero partire solo gli import da Obsidian, Kanka e testo generico (il rilevamento funziona comunque per tutto).',
			uploadButton: 'Carica',
			confirm: {
				uploadedSummary: (fileName, kilobytes) => `${fileName} caricato, ${kilobytes} KB`,
				detected: (label) => `Rilevato: ${label}`,
				notDetected: (label) => `Formato non rilevato con sicurezza: ${label}`,
				detail: (d) => {
					switch (d.kind) {
						case 'obsidian':
							return `${d.notes} ${d.notes === 1 ? 'nota trovata' : 'note trovate'}, con cartella .obsidian`;
						case 'obsidian-unsure':
							return `${d.markdownFiles} file Markdown, ma senza cartella .obsidian`;
						case 'kanka':
							return `${d.jsonFiles} file JSON, con campo entity_type`;
						case 'world-anvil':
							return 'cartelle json/ e html/ trovate, corrispondono a un Full World Export';
						case 'onenote':
							return `${d.pages} ${d.pages === 1 ? 'pagina esportata' : 'pagine esportate'}, con cartella _files/ associata`;
						case 'pdf':
							return 'un file PDF';
						case 'docx':
							return 'un file DOCX';
						case 'generic':
							return `${d.files} file, schema di export non riconosciuto`;
					}
				},
				playbookLabel: 'Playbook da eseguire',
				continueButton: 'Conferma e continua'
			},
			estimate: {
				heading: "Stima dell'import",
				summary: (fileName, playbookLabel) => `${fileName}, playbook ${playbookLabel}`,
				sizeLabel: 'Dimensione',
				documentCount: (count) => `${count} document${count === 1 ? 'o' : 'i'}`,
				timeLabel: 'Tempo',
				estimatedMinutes: (minutes) => `circa ${minutes} minut${minutes === 1 ? 'o' : 'i'}`,
				costLabel: 'Costo',
				estimatedCredits: (credits) => {
					const n = numberFormat('it', { maximumFractionDigits: 0, useGrouping: 'always' }).format(
						credits
					);
					const form = pluralRules('it').select(Math.round(credits));
					return form === 'one' ? `${n} credito` : `${n} crediti`;
				},
				startButton: 'Avvia import'
			},
			errors: {
				noUniverseGiven: "Nessun universo indicato per l'import.",
				universeNotFound: (slug) => `Nessun universo di nome "${slug}".`,
				chooseFile: 'Scegli un file da caricare.',
				unreadableFile: (fileName, message) => `Impossibile leggere "${fileName}": ${message}`,
				lostUpload: 'Il caricamento si è perso — riprova.',
				needsLiveModel: (playbookLabel) =>
					`Avviare un import ${playbookLabel} richiede un modello live, e questa installazione non ha credenziali AI_GATEWAY_* configurate. Gli import da Obsidian, Kanka e testo generico non ne hanno bisogno.`,
				noDocumentsFound: 'Questo playbook non ha riconosciuto nessun documento nel file caricato.',
				refused: {
					jobsQuota: 'Import rifiutato: hai raggiunto il tuo limite di import.',
					documentsQuota: 'Import rifiutato: questo import ha troppi documenti per il tuo piano.',
					insufficientCredits: 'Import rifiutato: crediti insufficienti per il costo stimato.'
				}
			}
		},

		job: {
			headTitle: (universeName) => `Import in corso in ${universeName} · Canonry`,
			firstAcceptHeading: 'Prima accettazione',
			firstAcceptMessage: (seconds) =>
				`Accettata in ${seconds}s dal momento in cui hai avviato questo import.`,
			headingRunning: 'Importazione del tuo mondo in corso',
			headingTerminal: {
				finished: 'Import completato',
				stoppedAtCeiling: 'Import in pausa al tetto di credito',
				cancelled: 'Import annullato',
				failed: 'Import non riuscito'
			},
			statusWord: {
				queued: 'in coda',
				running: 'in corso',
				finished: 'completato',
				stopped_at_ceiling: 'fermato al tetto',
				cancelled: 'annullato',
				failed: 'non riuscito'
			},
			statusLine: (proposalsEmitted, documentCount, statusWord) =>
				`${proposalsEmitted} ${proposalsEmitted === 1 ? 'proposta' : 'proposte'} finora · ${documentCount} ${documentCount === 1 ? 'documento' : 'documenti'} totali · stato: ${statusWord}`,
			reviewNow: (count) => `Rivedi ${count} ora`,
			goToUniverse: (universeName) => `Vai a ${universeName}`,
			errors: {
				jobNotFound: 'Nessun import di questo tipo.',
				signInRequired: 'Accesso richiesto.',
				proposalGone: 'Quella proposta non fa più parte di questo import.'
			}
		},

		liveFeed: {
			empty: 'Nessuna proposta ancora.',
			explanation: "Le proposte appariranno qui man mano che l'importazione le produce.",
			badge: {
				create: 'nuovo',
				update: 'modifica',
				relation: 'relazione',
				draft_entity: 'bozza',
				flag: 'segnalazione',
				relation_type_reuse: 'riusa tipo',
				relation_type_widen: 'amplia tipo',
				relation_type_new: 'nuovo tipo'
			},
			untitledProposal: 'Proposta senza titolo',
			accept: 'Accetta',
			accepted: 'accettata',
			outcome: { rejected: 'rifiutata', superseded: 'sostituita' }
		},
		existing: {
			fileInputLabel: 'File di esportazione',
			jobsHeading: 'Importazioni precedenti',
			jobsEmpty: 'Nessuna importazione è stata ancora eseguita in questo mondo.',
			jobsEmptyAction: "Avvia un'importazione",
			proposals: (count) => (count === 1 ? '1 proposta' : `${count} proposte`),
			reviewLink: 'Revisiona',
			viewerNotice: "Solo chi ha un ruolo di editor o proprietario può avviare un'importazione."
		}
	},

	table: {
		title: 'Tavolo',

		contextStrip: {
			modeOn: 'Modalità tavolo: attiva',
			noPlaceDeclared: (universeName) => `nessun luogo dichiarato ancora - ${universeName}`,
			pinnedIn: (ms) => `appuntati in ${ms}ms`,
			change: 'Cambia',
			exit: 'Esci dalla modalità tavolo'
		},

		declareContext: {
			formLabel: 'Dichiara il contesto',
			whereArePlayers: 'Dove si trovano i giocatori?',
			placePlaceholder: 'Scrivi il nome di un luogo...',
			placeCandidatesLabel: 'Luoghi candidati',
			placeTag: 'luogo',
			noPlaceMatch: (query) => `Nessun luogo corrisponde a "${query}".`,
			sessionLabel: 'Sessione (necessaria per "segna come rivelato")',
			noSessionOption: 'Nessuna sessione dichiarata',
			cancel: 'Annulla',
			declare: 'Dichiara'
		},

		pinnedCards: {
			empty:
				'Ancora nessuna relazione a due salti dal luogo dichiarato - la colonna degli appuntati si popola non appena ce n\u2019è una.',
			listLabel: 'Appuntati dal luogo dichiarato',
			declaredPlace: 'il luogo dichiarato',
			hopsFromPlace: (hops) => `a ${hops} ${hops === 1 ? 'salto' : 'salti'} dal luogo dichiarato`,
			warmBriefAt: (relativeTime) => `sintesi precalcolata · ${relativeTime}`,
			staleSince: (relativeTime) => `obsoleta da ${relativeTime}, si aggiorna al prossimo innesco`,
			notWarmedThisSession: 'non precalcolato in questa sessione',
			justNow: 'proprio ora',
			minutesAgo: (minutes) => `${minutes} min fa`,
			hoursAgo: (hours) => `${hours} h fa`
		},

		phoneTabBar: {
			navLabel: 'Sezioni della modalità tavolo',
			here: 'Qui',
			actions: 'Azioni',
			ask: 'Chiedi',
			queue: 'Coda'
		},

		actionLabels: {
			npcHere: '+ PNG qui',
			createChildLocation: '+ Crea un luogo figlio',
			quickNote: 'nota rapida'
		},

		quickActionDock: {
			markAsRevealed: 'Segna come rivelato',
			markAsRevealedDisabledTitle: 'Dichiara una sessione per segnare i luoghi come rivelati',
			drafting: 'Bozza in corso…',
			more: 'Altro',
			nameChildLocation: 'Assegna un nome al luogo figlio',
			locationPlaceholder: 'es. La Cantina di Sale',
			create: 'Crea',
			jotNote: 'Prendi una nota'
		},

		quickNoteForm: {
			formLabel: 'Prendi una nota rapida',
			disclaimer:
				'Mai applicata direttamente - diventa una proposta in attesa, revisionata come ogni altra, dopo la sessione.',
			about: 'Riguardo a',
			note: 'Nota',
			notePlaceholder: 'es. Aldric ha esitato quando ho nominato il registro',
			cancel: 'Annulla',
			saveAsProposal: 'Salva come proposta'
		},

		instantSearch: {
			whoIsThis: 'Chi è?',
			placeholder: 'Scrivi un nome o un alias...',
			searching: 'ricerca in corso…',
			instantLane: 'corsia immediata',
			fastLane: 'corsia veloce',
			laneStatus: (laneName, ms) => `${laneName} · ${ms}ms`,
			noMatch: (query) => `Nessuna corrispondenza per "${query}".`,
			aka: (alias) => `alias ${alias}`
		},

		ambientPlayer: {
			heading: 'Paesaggio sonoro ambientale',
			showAudioGraph: 'Mostra il grafico audio',
			hideAudioGraph: 'Nascondi il grafico audio',
			noPackYet: 'Nessun pacchetto ambientale generato per questo luogo, per ora.',
			layerSummary: (count, stale) => {
				const layers = count === 1 ? 'livello' : 'livelli';
				return `${count} ${layers}${stale ? ' · obsoleto, si aggiorna al prossimo innesco' : ''}`;
			},
			play: 'Riproduci',
			starting: 'Avvio…',
			audioPausedByBrowser:
				"L'audio è in pausa per via del browser finché non interagisci con la pagina.",
			enableAudio: 'Attiva audio',
			layersFailedToLoad: (count) => {
				const noun = count === 1 ? 'livello' : 'livelli';
				const verb = count === 1 ? 'non è stato caricato' : 'non sono stati caricati';
				return `${count} ${noun} ${verb}.`;
			},
			master: 'Master',
			crossfade: 'Dissolvenza',
			muteLayer: (prompt) => `Silenzia ${prompt}`,
			unmuteLayer: (prompt) => `Riattiva ${prompt}`,
			couldNotLoadPack: (status) => `Impossibile caricare il pacchetto ambientale (${status})`,
			couldNotStart: 'Impossibile avviare il paesaggio sonoro',
			crossfadeFailed: 'Dissolvenza non riuscita',
			layersAriaLabel: 'Livelli ambientali'
		},

		home: {
			noContextDeclared:
				'Dichiara un luogo per appuntare i suoi personaggi principali e le sue relazioni.',
			pinnedHeading: 'Appuntati',
			quickActionsHeading: 'Azioni rapide',
			askHeading: 'Chiedi',
			askNotBuilt: 'Chiedi non è ancora disponibile in questa fase.',
			askOpensFromPalette: (shortcut) =>
				`Una volta pronto, si aprirà dalla palette dei comandi (${shortcut}).`,
			proposalsHeading: 'Proposte di questa sessione',
			proposalsEmpty:
				'Ancora nulla. Avvia un\u2019azione rapida o prendi una nota per vederne arrivare una qui.',
			proposalLabel: 'proposta',
			from: (source) => `da: ${source}`,
			aiDraftedTooltip:
				'Il Loremaster ha proposto questo testo - resta in sospeso finché non lo accetti in Proposte.',
			aiDraftedBadge: 'Bozza del Loremaster',
			scaffoldBadge: 'scheletro, nessun modello',
			scaffoldTooltipDefault: 'Nessun modello disponibile per questa bozza.',
			aiUnavailable: (reason) => `Loremaster non disponibile: ${reason}`,
			streamStatus: (count, lastId) => {
				const events = count === 1 ? 'evento' : 'eventi';
				const received = count === 1 ? 'ricevuto' : 'ricevuti';
				const suffix = lastId !== null ? ` · ultimo id ${lastId}` : '';
				return `flusso: ${count} ${events} ${received}${suffix}`;
			},
			draftingNpc: 'Bozza del PNG in corso…',
			actionFailed: (action, reason) => `${action} non riuscita: ${reason}`,
			unknownReason: 'motivo sconosciuto',
			savedAsProposal: (via) => `Salvata come proposta (${via})`,
			savedAsProposalScaffold: (via) =>
				`Salvata come proposta (${via}, nessun modello - uno scheletro da completare)`,
			markedRevealed: (name) => `${name} segnato come rivelato`,
			noteSaveFailed: 'Impossibile salvare la nota',
			sessionEnded: (proposalCount) =>
				`Sessione terminata. ${proposalCount} proposta${proposalCount === 1 ? '' : 'e'} arrivat${proposalCount === 1 ? 'a' : 'e'} mentre giocavate.`
		},

		server: {
			notFound: 'Non trovato',
			declareBeforeAction:
				'dichiara un luogo prima di avviare un\u2019azione rapida - qui ogni azione è "legata al contesto"',
			nameLocationBeforeCreating: 'assegna un nome al luogo figlio prima di crearlo',
			unknownActionKind: (kind) => `tipo di azione rapida sconosciuto "${kind}"`,
			noSessionDeclared:
				'segnare come rivelato richiede una sessione dichiarata - impostane una dichiarando il contesto',
			noteEmpty: 'la nota è vuota',
			pickNoteTarget: 'scegli a quale voce si riferisce questa nota',
			entryNotFound: 'quella voce non esiste in questo universo',
			noteProposalFailed: 'non è stato possibile creare la proposta della nota',
			nothingIndexedYet: 'ancora nulla di indicizzato per questo universo',
			embeddingFailed: (reason) => `l\u2019embedding della ricerca non è riuscito (${reason})`,
			quickNoteRationale: (hadPlaceDeclared) =>
				`Registrata come nota rapida al tavolo${hadPlaceDeclared ? ' mentre era dichiarato un luogo' : ''}. Mai applicata direttamente - revisionala come ogni altra proposta.`,
			npcDraftedRationale: (placeName) =>
				`Proposto tramite l\u2019azione rapida "+ PNG qui" mentre ${placeName} era il contesto dichiarato.`,
			npcScaffoldRationale: (placeName, unavailableReason) =>
				`Proposto tramite "+ PNG qui" mentre ${placeName} era il contesto dichiarato. La scrittura del Loremaster non era disponibile (${unavailableReason}), quindi questo è uno scheletro vuoto da completare invece di un tocco scartato.`,
			createLocationRationale: (placeName) =>
				`Creato tramite l\u2019azione rapida del luogo figlio mentre ${placeName} era il contesto dichiarato.`,
			warmBudgetUnavailable:
				'la preparazione al tavolo non poteva coprire questa bozza in questo momento',
			warmStatusNoProposal: (status) =>
				`lo stato di precalcolo "${status}" non ha prodotto una nuova proposta`
		}
	},

	works: {
		types: {
			oneshot: 'Oneshot',
			module: 'Modulo',
			campaign: 'Campagna',
			story: 'Storia',
			novel: 'Romanzo'
		},
		statuses: {
			planning: 'In preparazione',
			running: 'In corso',
			finished: 'Conclusa',
			abandoned: 'Abbandonata'
		},
		kinds: {
			act: 'Atto',
			chapter: 'Capitolo',
			scene: 'Scena',
			encounter: 'Incontro'
		},
		errors: {
			workNeedsName: "Un'opera ha bisogno di un nome",
			pickWorkType: 'Scegli il tipo di opera',
			nodeNeedsTitle: 'Un nodo ha bisogno di un titolo',
			pickNodeKind: 'Scegli il tipo di nodo',
			missingBody: 'Testo mancante'
		},
		index: {
			title: 'Opere',
			description:
				"Un'avventura singola, un modulo, una campagna, una storia o un romanzo: un albero ordinato di atti, capitoli, scene e incontri, separato dal canone dell'universo. Quello che succede scrivendo o giocando un'opera torna indietro come proposte, mai come scrittura diretta.",
			empty: "Nessun'opera ancora.",
			emptyAction: 'Nuova opera',
			createHeading: 'Inizia una nuova opera',
			nameLabel: 'Nome',
			typeLabel: 'Tipo',
			summaryLabel: 'Riassunto',
			summaryOptional: '(facoltativo)',
			createButton: 'Crea opera'
		},
		tree: {
			ariaLabel: "Albero dell'opera",
			emptyHeading: (workName) => `Ancora niente in ${workName}`,
			emptyHint:
				"Aggiungi il primo nodo - di solito un atto, ma un'avventura singola breve può iniziare direttamente da una scena.",
			pickNodeHint: "Scegli un nodo dall'albero a sinistra, oppure aggiungine uno alla radice qui.",
			titleLabel: 'Titolo',
			kindLabel: 'Tipo',
			addNodeButton: 'Aggiungi nodo'
		},
		node: {
			moveUp: '↑ Sposta su',
			moveDown: '↓ Sposta giù',
			titleSrLabel: 'Titolo',
			save: 'Salva',
			addChildSummary: (nodeTitle) => `Aggiungi un nodo sotto ${nodeTitle}`,
			titleLabel: 'Titolo',
			kindLabel: 'Tipo',
			addNodeButton: 'Aggiungi nodo',
			usesHeading: 'Riferimenti',
			noUses: 'Nessuna voce citata ancora.',
			changedAt: (when) => `modificata: ${when}`,
			usesHint:
				'Apri una voce per leggere cosa è cambiato: accettare una propagazione avviene lì, oppure in fase di revisione.'
		}
	},

	universe: {
		nav: {
			entries: 'Voci',
			works: 'Opere',
			proposals: 'Proposte',
			table: 'Tavolo',
			players: 'Giocatori',
			import: 'Importa',
			settings: 'Impostazioni'
		},

		sidebar: {
			navAriaLabel: 'Navigazione universo',
			primaryNavAriaLabel: 'Principale',
			recentHeading: 'Recenti'
		},

		switcher: {
			switchAriaLabel: 'Cambia universo',
			derivedBadge: 'derivato',
			derivedFrom: (baseUniverseName) => `derivato da ${baseUniverseName}`,
			entryCount: (count) => (count === 1 ? '1 voce' : `${count} voci`),
			allUniverses: 'Tutti gli universi',
			newUniverse: 'Nuovo universo'
		},

		index: {
			homebrewEyebrow: 'Universo homebrew',
			derivedEyebrow: 'Universo derivato',
			derivedNoticeBefore: 'Derivato: legge il proprio canone più il corpus indicizzato di ',
			derivedNoticeAfter: ', in sola lettura. Il tuo canone vince sempre.',
			newEntryAction: 'Nuova voce',
			home: {
				pulseMoving: (total, latest, weeks) => {
					const fmt = numberFormat('it', { maximumFractionDigits: 0, useGrouping: 'always' });
					const changes = total === 1 ? '1 modifica' : `${fmt.format(total)} modifiche`;
					const tail =
						latest === 0
							? 'nessuna negli ultimi sette giorni'
							: `${fmt.format(latest)} negli ultimi sette giorni`;
					return `${changes} nelle ultime ${weeks} settimane, ${tail}.`;
				},
				pulseQuiet: (weeks, lastChange) =>
					lastChange
						? `Niente è cambiato da ${weeks} settimane. Ultima modifica: ${lastChange}.`
						: `Niente è cambiato da ${weeks} settimane.`,
				pulseWeekTitle: (count, weeksAgo) => {
					const changes = count === 1 ? '1 modifica' : `${count} modifiche`;
					if (weeksAgo === 0) return `ultimi sette giorni: ${changes}`;
					return weeksAgo === 1
						? `1 settimana fa: ${changes}`
						: `${weeksAgo} settimane fa: ${changes}`;
				},
				continueHeading: 'Riprendi',
				continueEmpty: 'Ancora nessun cambiamento.',
				waitingHeading: 'In attesa di te',
				waitingEmpty: 'Non c\u2019è niente in attesa.',
				reviewLink: 'rivedi',
				reviewAll: (pending) => `Rivedi tutto: ${pending}`,
				activityHeading: 'Attività recente',
				activityEmpty: 'Qui non è ancora successo niente.',
				activityRevision: (entityName) => `Riscrittura di ${entityName}`,
				activityRelation: (fromName, label, toName) => `${fromName} ${label} ${toName}`,
				activityWork: (workName, nodeTitle) => `${nodeTitle} \u00b7 ${workName}`,
				authorAi: 'accettato dal Loremaster',
				browseEntries: 'Sfoglia tutte le voci'
			},
			entries: {
				headTitle: (universeName) => `Voci: ${universeName}`,
				title: 'Voci',
				backToHome: (universeName) => `Torna a ${universeName}`,
				columnName: 'Nome',
				columnType: 'Tipo',
				columnRelations: 'Relazioni',
				columnFacts: 'Fatti',
				columnChanged: 'Cambiata',
				sortBy: (column) => `Ordina per ${column}`,
				tableAriaLabel: 'Voci',
				moveHint: 'muovi',
				openHint: 'apri',
				range: (from, to, total) => {
					const fmt = numberFormat('it', { maximumFractionDigits: 0, useGrouping: 'always' });
					return `${fmt.format(from)}\u2013${fmt.format(to)} di ${fmt.format(total)}`;
				},
				pageOf: (page, pages) => `pagina ${page} di ${pages}`,
				previousPage: 'Precedente',
				nextPage: 'Successiva'
			},
			filters: {
				all: 'Tutte',
				typeLabel: (type) => {
					const labels: Record<string, string> = {
						character: 'Personaggio',
						place: 'Luogo',
						faction: 'Fazione',
						event: 'Evento',
						item: 'Oggetto'
					};
					return labels[type] ?? type;
				}
			},
			searchPlaceholder: 'Cerca per nome o alias\u2026',
			changedAt: (when) => `cambiata ${when}`,
			emptyColdMessage: 'Ancora niente qui. Comincia con la prima voce.',
			emptyFilteredMessage: 'Nessuna voce corrisponde a questo filtro o a questa ricerca.',
			relativeTime: {
				justNow: 'proprio ora',
				minutesAgo: (minutes) => `${minutes} min fa`,
				hoursAgo: (hours) => `${hours} h fa`,
				daysAgo: (days) => `${days} g fa`,
				weeksAgo: (weeks) => `${weeks} sett fa`,
				monthsAgo: (months) => `${months} mesi fa`
			},
			newEntryDialog: {
				title: 'Nuova voce',
				description: 'Un nome e un tipo bastano per iniziare: il resto si scrive nell\u2019editor.',
				nameLabel: 'Nome',
				typeLabel: 'Tipo',
				submit: 'Crea e apri',
				cancel: 'Annulla',
				nameRequiredError: 'Il nome è obbligatorio.',
				typeRequiredError: 'Scegli un tipo.',
				viewerForbiddenError: 'I lettori non possono creare voci.'
			}
		},

		list: {
			heading: 'I tuoi universi',
			newUniverse: 'Nuovo universo'
		},

		ask: {
			headTitle: (universeName) => `Chiedi: ${universeName}`,
			crumb: (universeName) => `Chiedi · ${universeName}`,
			placeholder: 'Fai una domanda su questo universo…',
			ask: 'Chiedi',
			asking: 'Sto chiedendo…',
			askFailed: 'Richiesta non riuscita.',
			questionRequired: 'Serve una domanda.',
			methodNotAllowed: 'Invia una domanda con POST.',
			noLiveModel:
				'La generazione è disattivata per questo universo: qui si legge direttamente il tuo canone, a costo zero, invece di una risposta scritta da un modello.',
			levels: {
				'1_line': '1 riga',
				short: 'Breve',
				normal: 'Normale',
				detailed: 'Dettagliata',
				full: 'Completa'
			},
			ownCanonLabel: 'il tuo canone',
			indexedBadge: 'indicizzata',
			sourcesNote:
				'La risposta è scritta da queste e da nient’altro: le voci le cui parole corrispondono alla tua domanda.',
			sourcesEmpty:
				'Niente da citare. Nessuna voce corrisponde alle parole di questa domanda, quindi questa risposta non si appoggia a nulla del tuo canone.',
			close: 'Chiudi',
			loading: 'Caricamento…',
			propose: {
				badgeCreated: 'Proposta: nuova voce',
				badgeEdited: 'Proposta: modifica',
				redirectedToEdit: (entityName) =>
					`${entityName} esiste già, quindi è diventata una proposta di modifica.`,
				redirectedToCreate: (entityName) =>
					`Non esiste ancora una voce chiamata ${entityName}, quindi è diventata una proposta di nuova voce.`,
				reviewLink: 'Rivedi nelle proposte',
				failed: (message) =>
					`Un tentativo di proposta non è riuscito, e non è stato proposto nulla: ${message}`
			},
			keep: {
				button: 'Conserva',
				keeping: 'Sto conservando…',
				kept: 'Conservata',
				failed: 'Non è stato possibile conservare questa risposta.',
				invalidRequest: 'Questa risposta non può essere conservata così come è stata inviata.',
				sourceNotInUniverse: 'Una di queste fonti non appartiene a questo universo.',
				methodNotAllowed: 'Invia con POST una risposta da conservare.',
				noteBefore:
					'Conservandola vengono salvati la domanda, la risposta e le voci che cita, come una tua nota. ',
				noteProvider: (provider) => `${provider} ha scritto la risposta dal tuo canone.`,
				noteNoProvider:
					"Nessun modello l'ha scritta: la scrittura è disattivata per questo universo, quindi la risposta sono le tue stesse frasi ripetute.",
				noteAfter:
					' Resta una nota e non entra a fare parte di nessuna voce, i giocatori non la vedono, e resta finché non la elimini. ',
				// The elision stays on the prefix, so the link's own text is a real word rather
				// than something starting with an apostrophe.
				noteLinkBefore:
					"Quale azienda legge la tua campagna per rispondere a una domanda è indicato nell'",
				noteLink: 'informativa completa',
				historyLink: 'Risposte conservate'
			},
			kept: {
				headTitle: (universeName) => `Risposte conservate: ${universeName}`,
				crumb: (universeName) => `Risposte conservate · ${universeName}`,
				heading: 'Risposte conservate',
				note: 'Queste sono le risposte che hai scelto di conservare. Ognuna è testo generato dal tuo canone e salvato come una tua nota: non entra a fare parte di una voce senza una proposta che accetti, i giocatori non la vedono, e nessuno la rimuove tranne te. Eliminarne una elimina la riga stessa, senza copie da nessuna parte.',
				empty:
					'Non hai ancora conservato nulla. Chiedi qualcosa al Loremaster, e conserva la risposta se vale la pena.',
				askLink: 'Chiedi al Loremaster',
				askedFrom: 'Chiesta da',
				writtenBy: (provider) => `Scritta da ${provider}`,
				writtenWithoutModel: 'Letta dal tuo canone, senza modello',
				sourcesLabel: 'Fonti',
				deletedEntry: 'Questa voce è stata eliminata nel frattempo.',
				delete: 'Elimina',
				deleteConfirmPrompt: 'Eliminarla definitivamente?',
				deleteConfirmCancel: 'Annulla',
				deleteFailed: 'Non è stato possibile eliminare questa risposta.',
				deleteNotFound: 'Questa risposta non esiste più.'
			}
		},

		settings: {
			headTitle: (universeName) => `Impostazioni: ${universeName}`,
			heading: 'Impostazioni',
			introBefore: (universeName) =>
				`Impostazioni dell'universo per ${universeName}. Il tema dei colori e l'esportazione dell'account si trovano in `,
			introAnd: ' e ',
			introAfter: ", che valgono per l'intero account e non per un singolo universo.",
			appearanceLink: 'Aspetto',
			exportLink: 'Esporta',
			viewerForbiddenError:
				'Chi ha accesso in sola visualizzazione non può modificare questa impostazione.',
			aiToggle: {
				heading: 'Scrittura del Loremaster',
				description: (universeName) =>
					`Disattiva nuove proposte, immagini, Chiedi e il precalcolo per ${universeName}. Ricerca e suggerimenti di menzione continuano a leggere questo universo, e non costano nulla.`,
				stopWriting: 'Ferma la scrittura',
				resumeWriting: 'Riprendi la scrittura',
				offNotice: (universeName) =>
					`La scrittura è disattivata per ${universeName}. Ricerca e suggerimenti di menzione continuano comunque a pesare sulla tua quota inclusa come qualsiasi altra richiesta; semplicemente non costano nulla, attivi o no.`
			},
			propagationCap: {
				heading: 'Limite di propagazione',
				description: (universeName) =>
					`Quante voci può proporre il piano di un salvataggio per ${universeName}. Ogni voce per cui il copilota scrive una differenza costa un credito, quindi alzare questo valore significa accettare di spendere di più a ogni salvataggio.`,
				capLabel: 'Limite',
				noLimitLabel: 'Nessun limite',
				save: 'Salva',
				capNotice: (cap) => {
					const form = pluralRules('it').select(cap);
					return {
						prefix: 'Limitato a ',
						suffix: form === 'one' ? ' voce per piano.' : ' voci per piano.'
					};
				},
				noLimitNotice:
					'Nessun limite: ogni candidato trovato dal copilota riceve una differenza. La spesa viene comunque confermata prima di generare le differenze.',
				invalidCapError: 'Inserisci un numero maggiore o uguale a 1, oppure disattiva il limite.'
			},
			precedence: {
				heading: 'Precedenza',
				description: (universeName) =>
					`Il tuo canone vince sempre. Una pagina sorgente che una voce qui soppianta viene segnata sotto, non cancellata, e smette di comparire nel recupero per ${universeName}.`,
				empty: 'Nessuna sostituzione ancora.',
				supersededBadge: 'soppiantata',
				remove: 'rimuovi',
				declareHeading: 'Dichiara una sostituzione',
				entryLabel: 'La tua voce',
				baseSourceLabel: 'Fonte di base',
				sourceUrlLabel: 'Url della pagina sorgente',
				noteLabel: 'Nota',
				optional: '(facoltativo)',
				submit: 'Sostituisci',
				onlyDerivedError: 'Solo un universo derivato può soppiantare una pagina sorgente.',
				pickEntryError: 'Scegli quale voce soppianta la pagina.',
				pickSourceError: 'Scegli a quale fonte appartiene la pagina.',
				sourceUrlRequiredError: 'Alla pagina sorgente serve un url.',
				alreadySupersededError: 'Questa pagina è già stata soppiantata.',
				missingIdError: 'Id della sostituzione mancante.'
			},
			relations: {
				close: 'Chiudi',
				cardHeading: 'Catalogo delle relazioni',
				cardDescription: (universeName) =>
					`Ogni tipo di relazione che ${universeName} può usare, i dieci di serie e i propri, con quante relazioni usa ciascuno.`,
				cardCountOwn: (count) => {
					const form = pluralRules('it').select(count);
					if (count === 0) return 'Nessun tipo proprio ancora.';
					return `${count} ${form === 'one' ? 'tipo proprio' : 'tipi propri'}.`;
				},
				manageLink: 'Gestisci i tipi di relazione',
				headTitle: (universeName) => `Catalogo delle relazioni: ${universeName}`,
				title: 'Catalogo delle relazioni',
				description: (universeName) =>
					`Ogni tipo di relazione che ${universeName} può usare: il catalogo di serie con cui parte ogni mondo, e quello proprio di questo universo. Rinomina o amplia i tuoi, unisci due tipi in uno; i dieci di serie restano cosa di una migrazione.`,
				backLink: 'Torna alle impostazioni',
				shippedHeading: 'Catalogo di serie',
				shippedDescription:
					"Le dieci etichette con cui parte ogni universo. Modificarne una è una migrazione, non un'impostazione, quindi questo elenco è di sola lettura.",
				shippedBadge: 'di serie',
				ownHeading: 'I tipi propri di questo universo',
				ownDescription:
					"Tipi inventati da questo universo, a mano o tramite una proposta d'importazione accettata.",
				emptyOwn: 'Nessun tipo di relazione proprio ancora.',
				emptyOwnExplanation:
					"Un tipo compare qui appena un GM ne aggiunge uno, o accetta una proposta d'importazione che inventa una nuova etichetta.",
				table: {
					label: 'Etichetta',
					inverseLabel: 'Inversa',
					cardinality: 'Cardinalità',
					allowedFrom: 'Da',
					allowedTo: 'A',
					usage: 'In uso',
					actions: 'Azioni'
				},
				cardinalityLabel: (value) => {
					const labels: Record<string, string> = {
						one_to_one: 'uno a uno',
						one_to_many: 'uno a molti',
						many_to_one: 'molti a uno',
						many_to_many: 'molti a molti'
					};
					return labels[value] ?? value;
				},
				entityTypeLabel: (type) => {
					const labels: Record<string, string> = {
						character: 'personaggio',
						place: 'luogo',
						faction: 'fazione',
						item: 'oggetto',
						event: 'evento',
						session: 'sessione'
					};
					return labels[type] ?? type;
				},
				rename: {
					trigger: 'Rinomina',
					dialogTitle: (label) => `Rinomina "${label}"`,
					dialogDescription:
						'Una riga sola contiene entrambe le etichette, così i due lati della relazione non possono mai disallinearsi.',
					labelField: 'Etichetta',
					inverseLabelField: 'Etichetta inversa',
					submit: 'Salva',
					labelRequiredError: "L'etichetta non può essere vuota.",
					inverseLabelRequiredError: "L'etichetta inversa non può essere vuota.",
					conflictError: "Questo universo ha già un tipo con quell'etichetta.",
					notOwnedError: 'Solo un tipo creato da questo universo può essere rinominato.'
				},
				widen: {
					trigger: 'Amplia',
					dialogTitle: (label) => `Amplia "${label}"`,
					dialogDescription:
						'Aggiungi i tipi di entità che questa relazione può collegare. Cresce soltanto: restringerla rischierebbe relazioni che il grafo ha già.',
					fromHeading: 'Da',
					toHeading: 'A',
					currentlyAdmits: 'Ammette già',
					addOption: (typeLabel) => `Aggiungi ${typeLabel}`,
					submit: 'Amplia',
					noChangeError: 'Seleziona almeno un tipo di entità da aggiungere.',
					notOwnedError: 'Solo un tipo creato da questo universo può essere ampliato.'
				},
				translate: {
					trigger: 'Aggiungi una traduzione',
					dialogTitle: (label) => `Traduci "${label}"`,
					dialogDescription:
						"Le tue parole, lette in un'altra lingua dell'interfaccia. Lascia una lingua vuota per mostrare l'etichetta esattamente come l'hai scritta anche lì.",
					labelField: 'Etichetta',
					inverseLabelField: 'Etichetta inversa',
					submit: 'Salva',
					incompletePairError:
						'Compila entrambi i campi per una lingua, oppure lasciali entrambi vuoti.',
					notOwnedError: 'Solo un tipo creato da questo universo può essere tradotto.'
				},
				merge: {
					trigger: 'Unisci due tipi',
					dialogTitle: 'Unisci due tipi di relazione',
					dialogDescription:
						"Per fare ordine dopo un'importazione che ha chiamato la stessa relazione in due modi. Ogni relazione che usa il tipo perdente si sposta sul tipo in cui viene unito, e il tipo perdente viene rimosso.",
					fromLabel: 'Unisci questo tipo',
					intoLabel: 'In questo tipo',
					pickFromPlaceholder: 'Scegli un tipo di questo universo',
					pickIntoPlaceholder: 'Scegli il tipo in cui unirlo',
					countWarning: (count, fromLabel, intoLabel) => {
						const form = pluralRules('it').select(count);
						const uses = form === 'one' ? 'relazione usa' : 'relazioni usano';
						const moves = form === 'one' ? 'la sposta' : 'le sposta tutte';
						return `${count} ${uses} "${fromLabel}". L'unione ${moves} su "${intoLabel}", e "${fromLabel}" viene rimosso.`;
					},
					countWarningZero: (fromLabel, intoLabel) =>
						`"${fromLabel}" non ha ancora relazioni. L'unione lo rimuove e lascia "${intoLabel}" com'è.`,
					sameTypeError: 'Scegli due tipi diversi.',
					notOwnedError: 'Solo un tipo creato da questo universo può essere unito e rimosso.',
					needsTwoTypesNotice:
						'Questo universo ha bisogno di almeno un tipo proprio prima che due tipi possano unirsi.',
					submit: 'Unisci',
					movedToast: (count, intoLabel) => {
						if (count === 0) return `Unito in "${intoLabel}".`;
						const suffix = count === 1 ? 'a' : 'e';
						const noun = count === 1 ? 'relazione' : 'relazioni';
						return `Spostat${suffix} ${count} ${noun} in "${intoLabel}".`;
					}
				},
				viewerForbiddenError:
					'Chi ha accesso in sola visualizzazione non può modificare il catalogo delle relazioni.'
			}
		},
		players: {
			headTitle: (universeName) => `Giocatori · ${universeName}`,
			heading: 'Giocatori',
			description: 'Cosa ha scoperto il gruppo, e cosa è ancora dietro lo schermo.',
			wikiLinkLabel: 'Il wiki dei giocatori',
			openWikiLink: 'Apri il wiki dei giocatori',
			invitationsNotice:
				"Non esiste ancora un invito da inviare: condividi l'indirizzo del wiki direttamente con i tuoi giocatori.",
			revealedHeading: 'Rivelato',
			revealedEmpty: 'Nulla è stato ancora rivelato al gruppo.',
			revealedEmptyAction: 'Vai alla modalità Tavolo',
			kindLabel: { entity: 'Voce', fact: 'Fatto', relation: 'Relazione' },
			sessionUnknown: 'una sessione non tracciata',
			hiddenHeading: 'Ancora dietro lo schermo',
			hiddenDescription: 'Rivelabile, e non ancora trovato.',
			hiddenEmpty: "Non c'è più nulla da scoprire.",
			entityTypeLabel: (type) => {
				const labels: Record<string, string> = {
					character: 'Personaggio',
					place: 'Luogo',
					faction: 'Fazione',
					item: 'Oggetto',
					event: 'Evento',
					session: 'Sessione'
				};
				return labels[type] ?? type;
			}
		}
	},

	admin: {
		unattributed: 'non attribuito',
		save: 'Salva',

		models: {
			browserTitle: 'Modelli, Canonry admin',
			textHeading: 'Modelli di testo',
			textIntro1:
				'Il modello attivo per ciascuno scopo vive in <code class="text-xs">model_config</code>, non nel codice, e ogni flusso - le quattro modalità del Loremaster, la propagazione, la generazione a caldo, l\'indicizzazione, l\'embedding - lo legge tramite <code class="text-xs">resolveModel</code>. Una modifica qui ha effetto dalla chiamata successiva, senza deploy né riavvio. Il provider è vincolato a ciò che <code class="text-xs">createLanguageModel</code> può effettivamente costruire; un provider fuori da questo elenco non è proposto.',
			textIntro2:
				'Una domanda in italiano su un canone in inglese deve trovare il blocco inglese, quindi lo scopo <strong>embedding</strong> è una scelta multilingue deliberata, non gratuita. I candidati sono stati confrontati sui benchmark di retrieval multilingue pubblicati (MIRACL, MTEB Multilingual), limitati ai provider che questa build può costruire. Consigliato: <code class="text-xs">google</code> / <code class="text-xs">gemini-embedding-001</code> (#1 nella classifica MTEB Multilingual, ~100 lingue). Lacuna che questo riquadro non può colmare: qui non esiste una credenziale di embedding attiva per confermare il recall en/it nello specifico - né MIRACL né MTEB pubblicano un punteggio isolato inglese&harr;italiano, quindi resta un benchmark ancora da fare una volta disponibile una credenziale reale, non un dato consolidato.',
			table: {
				purpose: 'Scopo',
				currentlyActive: 'Attualmente attivo',
				provider: 'Provider',
				modelId: 'ID modello',
				notConfigured: 'non configurato',
				providerUnknown: (provider) =>
					`il provider "${provider}" non è tra quelli noti a questa app - nessuna chiamata può essere costruita finché non viene cambiato.`
			},
			purposeLabel: {
				cheap: 'Economico - generazione di candidati, azioni rapide',
				premium: 'Premium - diff, ask, propagazione',
				multimodal: 'Multimodale',
				embedding:
					'Embedding - ricerca per similarità, deduplica della cache a caldo, retrieval (deve essere multilingue - vedi nota sotto)',
				image:
					'Immagine (scopo testuale; vedi Modelli immagine più sotto per il generatore vero e proprio)'
			},
			saved: 'Salvato. Ha effetto immediatamente.',
			imageHeading: 'Modelli immagine',
			imageIntro1:
				'Il modello attivo per ciascuna funzione vive qui, non nel codice, e una modifica qui ha effetto dalla prossima richiesta di "Genera immagine" - senza deploy né riavvio.',
			imageIntro2Pre:
				'Predefinito iniziale: <code class="text-xs">prunaai/p-image</code> per un singolo ritratto, <code class="text-xs">black-forest-labs/flux-schnell</code> per il lotto da quattro varianti. Il prezzo per immagine è la nostra contabilità dei costi, nella valuta in cui lo quota il provider, mai il prezzo in crediti che vede un GM - quello vive in',
			imageTable: {
				feature: 'Funzione',
				pricePerImage: 'Prezzo / immagine',
				currency: 'Valuta',
				aspectRatio: 'Formato',
				aspectRatioNotSet: 'predefinito del modello',
				coverAspectRatios: (shapes) =>
					`Una copertina viene disegnata nel formato del tipo di voce, quindi questo modello deve accettare ${shapes}.`,
				active: 'attivo',
				inactive: 'inattivo'
			},
			featureLabel: {
				portrait: "Ritratto - un'immagine per richiesta",
				variants: 'Varianti - fino a quattro tra cui scegliere',
				scene: 'Scena - una sola immagine panoramica per il corpo di una voce'
			},
			errors: {
				unknownPurpose: (purpose) => `"${purpose}" non è uno scopo di modello noto.`,
				unknownProvider: (provider, choices) =>
					`"${provider}" non è un provider noto. Scegli tra: ${choices}.`,
				modelIdRequired: "L'ID del modello è obbligatorio.",
				providerAndModelIdRequired: 'Provider e ID del modello sono obbligatori.',
				invalidPricePerImage:
					'Inserisci un prezzo per immagine non negativo, con al massimo 6 cifre decimali.',
				invalidCurrency: 'Scegli una delle valute elencate.',
				aspectRatioUnsupported: (modelId, aspectRatio, accepted) =>
					`Questa funzione genera in ${aspectRatio} e "${modelId}" non accetta quel formato. Accetta: ${accepted}. Scegli un modello che offra ${aspectRatio}, oppure cambia prima il formato sulla riga.`,
				aspectRatioModelUnknown: (modelId, aspectRatio) =>
					`Questa funzione genera in ${aspectRatio} e nessuno ha annotato quali formati accetta "${modelId}", quindi salvarlo significherebbe tirare a indovinare. Leggi l'enum aspect_ratio del modello dal suo provider e aggiungilo prima a IMAGE_MODEL_ASPECT_RATIOS in @canonry/media.`
			}
		},

		metrics: {
			browserTitle: 'Metriche, Canonry admin',
			heading: 'Metriche',
			intro:
				'I due numeri che decidono se il copilota funziona, più i tre che dicono se il resto del prodotto funziona. Solo per lo staff, e volutamente non mostrati al GM - un GM che ottimizza il proprio tasso di accettazione è un incentivo strano per entrambe le parti del rapporto.',
			table: {
				produced: 'Prodotte',
				accepted: 'Accettate',
				rejected: 'Respinte',
				rate: 'Tasso',
				universe: 'Universo',
				noDataYet: 'nessun dato ancora'
			},
			noUniversesYet: 'Nessun universo ancora.',
			accept: {
				heading: 'Tasso di accettazione',
				intro: (windowDays) =>
					`<code class="text-xs">proposal.outcome</code>, \`superseded\` e \`pending\` esclusi dal denominatore - calcolato dalla funzione <code class="text-xs">acceptRate</code> di <code class="text-xs">@canonry/eval</code>, la stessa che valuta il corpus di propagazione per le modifiche a prompt e modello. Finestra: ultimi ${windowDays} giorni.`,
				noProposalsYet:
					"Nessuna proposta è stata ancora prodotta. Un tasso di accettazione dello 0% qui sarebbe una bugia per omissione, non una lettura onesta, quindi questo pannello non mostra nulla finché non c'è qualcosa da mostrare.",
				acceptRateLabel: 'Tasso di accettazione (proposte decise)',
				table: { weekOf: 'Settimana del', kind: 'Tipo', model: 'Modello' },
				byLocale: {
					heading: "Per lingua dell'interfaccia",
					intro:
						'<code class="text-xs">proposal.locale</code> - la lingua dell\'interfaccia in cui è stata prodotta la proposta, calcolata dalla stessa <code class="text-xs">acceptRate</code> qui sopra. Una lingua senza ancora proposte compare come "nessun dato", mai come uno 0% inventato.',
					localeLabel: 'Lingua'
				}
			},
			timeToFirstAccept: {
				heading: 'Tempo alla prima proposta accettata',
				intro:
					"Dall'inizio di un import alla sua prima proposta accettata, per universo, come distribuzione: un singolo valore anomalo e lento è di per sé un rischio di churn, e una media nasconderebbe esattamente quell'anomalia.",
				noImportsYet: 'Nessun import è ancora stato eseguito.',
				noAcceptYet: (count) => `${count} import, nessuno con una proposta accettata finora.`,
				summary: (accepted, total, median) =>
					`${accepted} di ${total} import con una prima accettazione, mediana ${median}.`,
				importStarted: 'Import avviato',
				timeToFirstAcceptLabel: 'Tempo alla prima accettazione',
				stillWaiting: 'ancora in attesa'
			},
			warmRadius: {
				heading: 'Raggio di precalcolo',
				intro: (thresholdPercent) =>
					`Il tasso di successo a caldo - artefatti consumati sul totale generato - governa automaticamente il raggio di precalcolo: sotto il ${thresholdPercent}% si restringe dall'anello 2 all'anello 1. È la stessa lettura che <code class="text-xs">warmOnConsumption</code> usa per decidere quanto estendersi, non una stima separata.`,
				consumed: 'Consumati',
				generated: 'Generati',
				hitRate: 'Tasso di successo',
				currentRadius: 'Raggio attuale',
				ring: (n) => `anello ${n}`
			},
			entropy: {
				heading: 'Entropia del canone',
				intro:
					"Voci aggiornate dopo una sessione rispetto a quelle create in preparazione, per universo - la metrica che dice se l'entropia del canone è stata davvero risolta o se questo è solo un altro posto dove annotarla.",
				createdInPrep: 'Create in preparazione',
				updatedAfterSession: 'Aggiornate dopo una sessione'
			},
			auditFlags: {
				heading: 'Segnalazioni della revisione per posizione',
				intro: (cap: number) =>
					`Archiviazioni sul totale delle segnalazioni prodotte, divise per la posizione che la segnalazione occupava nella sua revisione. Una revisione scrive al massimo ${cap} segnalazioni, e quel numero è una lettura delle specifiche piuttosto che una misura: se le archiviazioni crescono con la posizione, è già troppo generoso. Una segnalazione non si può accettare, solo archiviare o lasciare stare, quindi qui il rapporto è archiviate su prodotte e non un tasso di accettazione.`,
				position: 'Posizione nella revisione',
				produced: 'Segnalazioni prodotte',
				dismissed: 'Archiviate',
				stillOpen: 'Lasciate stare',
				dismissalRate: 'Tasso di archiviazione',
				noFlagsYet:
					'Nessuna segnalazione della revisione, per ora. Questo pannello ha bisogno che la revisione abbia girato su modifiche reali prima di dire qualcosa, e una linea tracciata su nessun dato sarebbe peggio di una tabella vuota.'
			}
		},

		pricing: {
			browserTitle: 'Prezzi delle operazioni, Canonry admin',
			title: 'Prezzi delle operazioni',
			intro1:
				"Il prezzo in crediti di ogni operazione a pagamento vive qui, non nel codice, e una modifica qui ha effetto immediato, non dopo la scadenza di una cache. Un prezzo pari a <b class=\"text-ink\">zero</b> significa che l'operazione è gratuita per l'utente: è l'intero meccanismo dietro alla lettura che resta gratuita, non un caso speciale aggiunto altrove.",
			intro2:
				"Gratis per l'utente non è gratis per noi: ogni chiamata, a pagamento o no, viene comunque registrata per intero con i suoi token reali e il suo costo in euro, perché la domanda sul margine trova risposta solo in quelle righe, in nessun altro posto.",
			kindLabel: {
				reading: 'Lettura, sempre gratuita',
				generation: 'Generazione, a pagamento',
				import: 'Import, a pagamento per documento'
			},
			table: {
				label: 'Etichetta',
				operation: 'Operazione',
				credits: 'Crediti',
				notes: 'Note',
				lastChange: 'Ultima modifica'
			},
			creditsFor: (label) => `Crediti per ${label}`,
			saved: 'Salvato.',
			lastChangeSummary: (from, to, changedBy, date) =>
				`${from} → ${to} crediti, ${changedBy}, ${date}`,
			noChangesYet: 'Nessuna modifica da quando è stato configurato inizialmente.',
			errors: {
				missingOperation: 'Operazione mancante.',
				invalidCredits: 'Inserisci un numero non negativo, con al massimo 4 cifre decimali.',
				unknownOperation: (operation) => `"${operation}" non è un'operazione nota.`
			}
		}
	},

	docs: {
		hub: {
			browserTitle: 'Documentazione',
			title: 'Guide',
			intro:
				'Guide pratiche per portare un mondo dentro Canonry, e tutto ciò che ha bisogno di istruzioni concrete invece di materiale di riferimento tecnico.',
			importHeading: "Guide all'importazione",
			importIntro:
				'Una pagina per ciascuna fonte, con i passaggi di esportazione da seguire prima di caricare qualsiasi cosa: Obsidian, Kanka, World Anvil, OneNote, PDF, DOCX, e il percorso generico per tutto il resto.',
			importLink: "Leggi le guide all'importazione",
			languagesHeading: 'Lingue',
			languagesIntro:
				"Cosa traduce l'interfaccia, cosa il tuo canone mantiene nella propria lingua, e perché Canonry non tradurrà automaticamente un mondo che hai già scritto.",
			languagesLink: 'Leggi cosa viene tradotto, e cosa no'
		},
		importIndex: {
			title: "Guide all'importazione",
			eyebrow: 'Documentazione',
			intro:
				"Canonry non ti chiede di scegliere una fonte prima di caricare qualcosa. Trascina una cartella o un file: Canonry ne osserva la forma, ti dice cosa pensa di aver trovato, e ti chiede conferma (o di scegliere un altro playbook da un elenco breve) prima di leggere altro. Queste guide esistono perché il file che consegni sia quello giusto fin dall'inizio: cosa esportare da dove vive oggi il tuo mondo, e cosa Canonry capisce e cosa no una volta che il file arriva.",
			sourcesHeading: 'Fonti'
		},
		importGuide: {
			browserTitle: (guideLabel) => `Guida all'importazione da ${guideLabel}`,
			eyebrow: "Guide all'importazione"
		},
		privacy: {
			title: 'Dove vanno le parole della tua campagna'
		}
	}
};
