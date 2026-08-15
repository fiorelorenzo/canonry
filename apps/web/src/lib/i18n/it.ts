import { numberFormat, pluralRules } from './intl.js';
import type { Messages } from './messages.js';

// Written thinking in Italian, not translated word-for-word from en.ts (issue #121's own
// rule, honoured here even though the sweep itself is that issue's job): plain, specific
// copy, the product's own voice, not English syntax wearing Italian words.
export const it: Messages = {
	shell: {
		skipToContent: 'Vai al contenuto',
		signedInAs: (name) => `Accesso effettuato come ${name}`,
		notSignedIn: 'Nessun accesso effettuato',
		signIn: 'Accedi',
		signUp: 'Registrati',
		signOut: 'Esci',
		signingOut: 'Uscita in corso…'
	},

	settings: {
		backToUniverses: '← Universi',

		appearance: {
			title: 'Aspetto',
			description:
				'Chiaro o scuro per tutto il prodotto (G1, docs/ux/DECISIONS.md): cambia la palette ovunque, modalità tavolo inclusa. Non cambia la dimensione del testo, la densità o altro.',
			light: 'Chiaro',
			dark: 'Scuro',
			system: 'Segui il sistema',
			save: 'Salva',
			error: 'Scegli chiaro, scuro o segui il sistema.'
		},

		language: {
			title: 'Lingua',
			description:
				"La lingua in cui l'interfaccia e il Loremaster ti parlano (SPEC.md §17). È una preferenza legata al tuo account, quindi ti segue anche sul telefono al tavolo - non è la lingua in cui è scritto il tuo canone, che resta quella di ogni singola voce.",
			signInPrompt: 'Accedi per salvare una lingua preferita sul tuo account.',
			signInLink: 'Accedi',
			save: 'Salva',
			saved: 'Salvato.',
			error: 'Scegli una lingua dall\u2019elenco.'
		},

		billing: {
			title: 'Fatturazione',
			description:
				'Quota inclusa con instradamento tra modelli economici e premium. Nessun credito opaco, e nessun piano qui è mai chiamato "illimitato": ogni piano indica un tetto reale (SPEC.md §15).',
			signInPrompt: 'Accedi per vedere il tuo piano e il saldo.',
			signInLink: 'Accedi',
			checkoutCancelled: 'Il pagamento è stato annullato - il tuo piano non è cambiato.',
			currentPlan: (planName) => `Piano attuale: ${planName}`,
			renews: (date) => `Si rinnova il ${date}`,
			noRenewalDate: 'Nessuna data di rinnovo registrata.',
			includedThisPeriod: 'Incluso in questo periodo',
			purchased: 'Acquistato (non scade)',
			warmBudget: 'Budget di precalcolo',
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
		}
	},

	auth: {
		signIn: {
			title: 'Accedi',
			subtitle: 'I tuoi universi, il tuo account, di nessun altro.',
			emailLabel: 'Email',
			passwordLabel: 'Password',
			submit: 'Accedi',
			submitting: 'Accesso in corso…',
			noAccount: 'Non hai ancora un account?',
			signUpLink: 'Registrati',
			orDivider: 'oppure',
			continueWith: (provider) => `Continua con ${provider}`
		},
		signUp: {
			title: 'Registrati',
			subtitle: 'Un account, i tuoi universi.',
			nameLabel: 'Nome',
			emailLabel: 'Email',
			passwordLabel: 'Password',
			submit: 'Registrati',
			submitting: 'Creazione account…',
			haveAccount: 'Hai già un account?',
			signInLink: 'Accedi',
			orDivider: 'oppure',
			continueWith: (provider) => `Continua con ${provider}`
		},
		languageSwitcher: {
			label: 'Lingua'
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
		relationsHeading: 'Relazioni note'
	}
};
