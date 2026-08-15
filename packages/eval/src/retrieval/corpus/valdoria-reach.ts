/**
 * The retrieval gold corpus (issue #63), seeded from the same Valdoria Reach fixture as
 * the propagation corpus so the questions are real prose, not lorem ipsum, and answerable
 * against text a developer can read in `packages/db/src/seed-fixture.ts`. Chunked with
 * `chunkEntity` (the same split every entity in the fixture gets), so the gold chunk ids
 * are stable and answerable by inspection.
 *
 * **Every label here is justified by text in the chunk it names.** That is the rule this file is
 * held to, and it was not met before: "How many sworn does the Valdoria Watch have?" omitted
 * `aldric-vane#1`, which says "Three hundred and forty sworn" in as many words, and "Why was
 * Aldric Vane dismissed?" had no answer anywhere in the corpus at all, so every model scored zero
 * on it and the number said more about the question than the retrieval. A label set that punishes
 * a correct answer measures the labeller.
 *
 * Two question sets over one set of chunks:
 *
 * - `valdoriaReachRetrieval` asks in English. Most chunks are English, but two are Italian, so
 *   even this set crosses languages in one direction.
 * - `valdoriaReachRetrievalItalian` asks the same questions in Italian against the same chunks,
 *   which is the direction SPEC.md §17 actually promises ("an Italian question against an English
 *   canon must find the English chunk") and the one no published benchmark answers for en/it.
 *
 * Read MRR rather than recall@1 when comparing: `recallAt` divides by the number of labels, so a
 * question with three valid answers can never score above 1/3 at k=1 however well it ranked.
 */
import { valdoriaReach as propagationValdoriaReach } from '../../propagation/corpus/valdoria-reach.js';
import type { GoldQuestion, RetrievalCorpus } from '../types.js';
import { chunkEntity } from './chunk.js';

const chunks = propagationValdoriaReach.entities.flatMap((entity) => chunkEntity(entity));

/** English questions. Where a label looks surprising, the comment quotes the words that earn it. */
const englishQuestions: GoldQuestion[] = [
	{
		id: 'who-keeps-the-gilded-rat',
		question: 'Who keeps the Gilded Rat?',
		relevantChunkIds: ['mother-sennah#0', 'the-gilded-rat#0']
	},
	{
		id: 'who-dismissed-aldric',
		// Was "Why was Aldric Vane dismissed from the watch?", which nothing in the corpus answers:
		// `aldric-vane#0` gives the season, never the cause. Iselde "appointed Aldric Vane, and then
		// broke him", which is who, and that is the question the canon can actually settle.
		question: 'Who dismissed Aldric Vane from the watch?',
		relevantChunkIds: ['iselde-wrenn#0', 'aldric-vane#0']
	},
	{
		id: 'aldric-standing-in-the-city',
		question: "What is Aldric Vane's standing in the city now?",
		relevantChunkIds: ['aldric-vane#1']
	},
	{
		id: 'cairnmouth-sable-winter',
		question: 'What happened to Cairnmouth during the Sable Winter?',
		relevantChunkIds: ['cairnmouth#0', 'the-sable-winter#0']
	},
	{
		id: 'watch-sworn-count',
		// Three chunks state the number. `aldric-vane#1` was missing before, though it opens with
		// "Three hundred and forty sworn used to take his word".
		question: 'How many sworn does the Valdoria Watch have?',
		relevantChunkIds: ['the-valdoria-watch#0', 'valdoria#1', 'aldric-vane#1']
	},
	{
		id: 'who-employs-corvin-ashe',
		question: 'Who employs Corvin Ashe?',
		relevantChunkIds: ['corvin-ashe#0']
	},
	{
		id: 'what-is-the-ashen-ledger',
		question: 'What does the Ashen Ledger do?',
		relevantChunkIds: ['the-ashen-ledger#0']
	},
	{
		id: 'who-appointed-aldric',
		question: 'Who appointed Aldric Vane as captain?',
		relevantChunkIds: ['iselde-wrenn#0']
	},
	{
		id: 'watch-has-no-captain',
		// "currently without a captain" (valdoria#1); the-valdoria-watch#0 describes the same body
		// but says nothing about the vacancy, so it is not labelled.
		question: 'Does the Valdoria Watch have a captain at the moment?',
		relevantChunkIds: ['valdoria#1']
	},
	{
		id: 'poorest-quarter',
		question: 'Which quarter of Valdoria is the poorest?',
		relevantChunkIds: ['valdoria#0']
	},
	{
		id: 'where-does-aldric-drink',
		question: 'Where does Aldric Vane drink?',
		relevantChunkIds: ['aldric-vane#0', 'the-gilded-rat#0']
	},
	{
		id: 'sennah-before-the-inn',
		question: 'What did Mother Sennah do before she kept an inn?',
		relevantChunkIds: ['mother-sennah#0']
	},
	{
		id: 'when-did-the-strait-freeze',
		question: 'What year did the strait freeze?',
		relevantChunkIds: ['the-sable-winter#0']
	},
	{
		id: 'who-holds-lantern-quarter-debt',
		question: "Who holds most of the Lantern Quarter's debt?",
		relevantChunkIds: ['corvin-ashe#0']
	},
	{
		id: 'how-many-still-follow-aldric',
		question: 'How many of the sworn would still follow Aldric Vane?',
		relevantChunkIds: ['aldric-vane#1']
	},
	{
		id: 'who-is-the-harbour-magistrate',
		question: 'Who is the harbour magistrate?',
		relevantChunkIds: ['iselde-wrenn#0']
	},
	{
		// An English question whose answer is only in Italian prose: the reverse of §17's case, and
		// the one that fails silently if the embedding model is English-first.
		id: 'where-are-the-mercanti-records',
		question: 'Where does the Casa dei Mercanti keep its records?',
		relevantChunkIds: ['la-casa-dei-mercanti#0']
	},
	{
		id: 'how-are-mercanti-loans-recorded',
		// "Ogni prestito che la Casa concede viene scritto due volte" - each loan written twice.
		question: 'How many times is each loan of the Casa dei Mercanti written down?',
		relevantChunkIds: ['la-casa-dei-mercanti#1']
	},
	{
		id: 'who-owns-the-smugglers-ledger',
		question: "Who owns the Smugglers' Ledger?",
		relevantChunkIds: ['smugglers-ledger#0']
	},
	{
		id: 'what-does-cairnmouth-live-on',
		question: 'What kind of town is Cairnmouth?',
		relevantChunkIds: ['cairnmouth#0']
	}
];

/** The same questions in Italian, labels untouched. Written against what the chunks say rather
 * than translated word for word, so a miss is the model's and not the phrasing's. */
const italianQuestionText: Record<string, string> = {
	'who-keeps-the-gilded-rat': 'Chi gestisce la locanda del Ratto Dorato?',
	'who-dismissed-aldric': 'Chi ha cacciato Aldric Vane dalla guardia?',
	'aldric-standing-in-the-city': 'Che reputazione ha adesso Aldric Vane in città?',
	'cairnmouth-sable-winter': "Che cosa è successo a Cairnmouth durante l'Inverno del Zibellino?",
	'watch-sworn-count': 'Quanti giurati ha la Guardia di Valdoria?',
	'who-employs-corvin-ashe': 'Per chi lavora Corvin Ashe?',
	'what-is-the-ashen-ledger': 'Che cosa fa il Libro di Cenere?',
	'who-appointed-aldric': 'Chi ha nominato capitano Aldric Vane?',
	'watch-has-no-captain': 'La Guardia di Valdoria ha un capitano in questo momento?',
	'poorest-quarter': 'Qual è il quartiere più povero di Valdoria?',
	'where-does-aldric-drink': 'Dove va a bere Aldric Vane?',
	'sennah-before-the-inn': 'Che mestiere faceva Madre Sennah prima di gestire la locanda?',
	'when-did-the-strait-freeze': 'In che anno si è ghiacciato lo stretto?',
	'who-holds-lantern-quarter-debt':
		'Chi detiene la maggior parte dei debiti del Quartiere della Lanterna?',
	'how-many-still-follow-aldric': 'Quanti giurati seguirebbero ancora Aldric Vane?',
	'who-is-the-harbour-magistrate': 'Chi è il magistrato del porto?',
	'where-are-the-mercanti-records': 'Dove tiene i suoi registri la Casa dei Mercanti?',
	'how-are-mercanti-loans-recorded':
		'Quante volte viene scritto ogni prestito della Casa dei Mercanti?',
	'who-owns-the-smugglers-ledger': 'Chi è il proprietario del registro dei contrabbandieri?',
	'what-does-cairnmouth-live-on': 'Che tipo di città è Cairnmouth?'
};

export const valdoriaReachRetrieval: RetrievalCorpus = {
	id: 'valdoria-reach',
	name: 'Valdoria Reach',
	chunks,
	questions: englishQuestions
};

/** SPEC.md §17's direction: Italian question, canon mostly written in English. Same chunks, same
 * labels, so a difference between the two reports is a difference in the model's cross-lingual
 * behaviour and nothing else. */
export const valdoriaReachRetrievalItalian: RetrievalCorpus = {
	id: 'valdoria-reach-it',
	name: 'Valdoria Reach (Italian questions)',
	chunks,
	questions: englishQuestions.map((question) => {
		const italian = italianQuestionText[question.id];
		if (!italian) throw new Error(`no Italian phrasing for gold question "${question.id}"`);
		return { ...question, question: italian };
	})
};
