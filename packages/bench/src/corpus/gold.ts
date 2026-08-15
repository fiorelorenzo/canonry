/**
 * World-level gold for Valdoria Reach - the parts of the benchmark that are not tied to one
 * rendered document, so they live next to the world instead of inside a renderer's
 * DocumentExpectation list.
 *
 * AUDIT_PAIRS benchmarks the audit capability (SPEC.md §5.2): given two statements, does the
 * model correctly call it a disagreement or not. Ten pairs genuinely disagree; ten do not, and
 * those ten are deliberately hard - same entities, same topic, two true and complementary facts
 * rather than an obvious non sequitur, which is exactly where a weak model false-flags. Every
 * statement is quoted or lightly glossed from an entity's lead/section text in
 * ./valdoria-reach.ts; the disagreeing half of a pair is sometimes a constructed rumour rather
 * than corpus prose (that is the point - it has to sound like it could be canon), and the `note`
 * field says which is which.
 *
 * ASK_QUESTIONS benchmarks Ask over this world (SPEC.md §5). Eighteen questions: six asked in
 * Italian whose answer lives in English prose, two asked in English whose answer lives in Italian
 * prose (SPEC.md §17's cross-language requirement, both directions), three that are unanswerable
 * from the corpus - where the only correct behaviour is admitting there is nothing on the point,
 * which is what catches a model that invents canon - and the rest a plain mix of English and
 * Italian questions grounded in their own language's prose.
 */

export interface AuditPair {
	id: string;
	aEntity: string;
	aStatement: string;
	bEntity: string;
	bStatement: string;
	disagree: boolean;
	topic: string | null;
	note: string;
}

export interface AskQuestion {
	id: string;
	question: string;
	language: 'en' | 'it';
	mustMention: string[];
	mustNotClaim: string[];
	groundedIn: string[];
	note: string;
}

// ---------------------------------------------------------------------------------------------
// AUDIT_PAIRS - ten disagreeing, ten not.
// ---------------------------------------------------------------------------------------------

export const AUDIT_PAIRS: AuditPair[] = [
	{
		id: 'audit-01',
		aEntity: 'aldric-vane',
		aStatement: 'Dismissed from the watch in the thaw after the Sable Winter, he now answers to the Ashen Ledger.',
		bEntity: 'cairnmouth',
		bStatement: 'Captain Vane led the watch through the second freeze, the winter after the thaw.',
		disagree: true,
		topic: 'aldric-vane-captaincy',
		note: "The pair docs/ux/SAMPLE-WORLD.md names outright: Aldric's own entry has him dismissed before the thaw is over, Cairnmouth's entry has him still leading the watch the winter after it. Cairnmouth's line is the stale one."
	},
	{
		id: 'audit-02',
		aEntity: 'valdoria',
		aStatement: 'Three hundred and forty sworn, badly paid, and currently without a captain.',
		bEntity: 'the-valdoria-watch',
		bStatement: 'Bryn Oswald took the captaincy a month after Aldric Vane left it, on Iselde Wrenn’s word.',
		disagree: true,
		topic: 'valdoria-watch-captain',
		note: "worldV1's Watch section on Valdoria (no captain) and worldV2's Command section on the Valdoria Watch (Bryn Oswald) describe the same office a month apart; read as simultaneous claims they disagree on whether the watch currently has a captain at all."
	},
	{
		id: 'audit-03',
		aEntity: 'the-drowned-concord',
		aStatement: 'A smuggling ring nobody at the table has heard of yet.',
		bEntity: 'the-bell-quarter',
		bStatement: 'The Drowned Concord used to run goods through the Bell Quarter before anyone official admitted it existed; these days it is La Cricca del Molo running that trade.',
		disagree: true,
		topic: 'drowned-concord-status',
		note: 'The Drowned Concord’s own entry frames it as a still-live secret; the Bell Quarter entry frames it as already displaced by La Cricca del Molo. Only one describes the Concord’s current operational status.'
	},
	{
		id: 'audit-04',
		aEntity: 'sera-voss',
		aStatement: 'Sergeant of the watch, Cistern-born and harbour-trained, working her home quarter.',
		bEntity: 'sera-voss',
		bStatement: 'Sergeant of the watch, posted to the Bell Quarter since the Drowning at the Old Wharf, and in no hurry to be posted back.',
		disagree: true,
		topic: 'sera-voss-posting',
		note: "worldV1's lead has her working the Cistern Quarter she grew up in; worldV2's lead has her posted away to the Bell Quarter. Same entity, same 'where does she currently serve' question, two different answers."
	},
	{
		id: 'audit-05',
		aEntity: 'mother-sennah',
		aStatement: 'She was a field surgeon through the Sable Winter and does not talk about it.',
		bEntity: 'mother-sennah',
		bStatement: 'Mother Sennah never set foot in Valdoria until after the Sable Winter ended, which is why she never talks about it.',
		disagree: true,
		topic: 'mother-sennah-sable-winter',
		note: 'A constructed rumour (b) offers a different, incompatible reason for her silence - absent during the winter rather than present through it - than her own canon entry (a) gives.'
	},
	{
		id: 'audit-06',
		aEntity: 'the-valdoria-watch',
		aStatement: 'Bryn Oswald took the captaincy a month after Aldric Vane left it, on Iselde Wrenn’s word.',
		bEntity: 'bryn-oswald',
		bStatement: 'Bryn Oswald bought the captaincy off Iselde Wrenn with Ashen Ledger money the same week Aldric Vane was dismissed.',
		disagree: true,
		topic: 'bryn-oswald-appointment',
		note: 'A constructed rumour (b) contradicts both the timeline (a month later, not the same week) and the mechanism (a clean appointment on Iselde’s word, not a purchase) given in the Watch’s own entry.'
	},
	{
		id: 'audit-07',
		aEntity: 'harbour-seal',
		aStatement: 'The Ashen Ledger has offered to buy Iselde Wrenn a better harbour seal twice; she has kept the old one twice.',
		bEntity: 'the-ashen-ledger',
		bStatement: 'Iselde Wrenn finally sold the old harbour seal to the Ashen Ledger last month and now uses one of theirs.',
		disagree: true,
		topic: 'harbour-seal-ownership',
		note: 'A constructed rumour (b) claims the sale that the seal’s own entry (a) says she twice refused.'
	},
	{
		id: 'audit-08',
		aEntity: 'the-brackish-hand',
		aStatement: 'The Brackish Hand is owned on paper by La Cricca del Molo and three other names besides.',
		bEntity: 'the-brackish-hand',
		bStatement: 'The Brackish Hand belongs to the Ashen Ledger, seized last winter over an unpaid debt.',
		disagree: true,
		topic: 'brackish-hand-ownership',
		note: 'A constructed rumour (b) gives the ship to a different, uninvolved faction than the one its own entry (a) names as owner.'
	},
	{
		id: 'audit-09',
		aEntity: 'corvin-ashe',
		aStatement: "He holds most of the Lantern Quarter's debt and none of its affection.",
		bEntity: 'the-lantern-quarter',
		bStatement: 'Corvin Ashe forgave most of the Lantern Quarter’s outstanding debt after the thaw, hoping to buy back some goodwill.',
		disagree: true,
		topic: 'lantern-quarter-debt',
		note: 'A constructed rumour (b) has him forgiving the debt his own entry (a) says he still holds and profits from resenting.'
	},
	{
		id: 'audit-10',
		aEntity: 'the-thaw',
		aStatement: 'The ice on the Sable Reach cracked all at once instead of slowly, in the weeks after the Sable Winter broke.',
		bEntity: 'the-sable-reach',
		bStatement: 'The ice on the Sable Reach melted gradually over two full seasons, with no single thaw anyone could point to.',
		disagree: true,
		topic: 'sable-reach-thaw-speed',
		note: 'A constructed claim (b) about a slow, seasons-long melt directly contradicts The Thaw’s own entry (a), which is named for exactly the sudden, all-at-once break it describes.'
	},
	{
		id: 'audit-11',
		aEntity: 'aldric-vane',
		aStatement: 'He now answers to the Ashen Ledger.',
		bEntity: 'the-ashen-ledger',
		bStatement: 'Aldric Vane, the dismissed captain of the Valdoria Watch, is now on the Ashen Ledger’s payroll.',
		disagree: false,
		topic: 'aldric-vane-ashen-ledger-employment',
		note: 'The same employment fact stated from both sides of it - a weak model can mistake two tellings of one relation for two different claims.'
	},
	{
		id: 'audit-12',
		aEntity: 'mother-sennah',
		aStatement: 'Keeps the Gilded Rat.',
		bEntity: 'the-gilded-rat',
		bStatement: 'Mother Sennah keeps it, and the corner seat by the stair is understood to belong to somebody.',
		disagree: false,
		topic: 'gilded-rat-keeper',
		note: 'The tavern entry adds detail (the corner seat) but agrees on who keeps the place; nothing here conflicts.'
	},
	{
		id: 'audit-13',
		aEntity: 'iselde-wrenn',
		aStatement: 'She appointed Aldric Vane, and then broke him.',
		bEntity: 'iselde-wrenn',
		bStatement: 'She still calls it a favour, he calls it a wage: either way she now pays Aldric Vane out of her own ledger for what he remembers of the old watch rosters.',
		disagree: false,
		topic: 'iselde-aldric-relationship',
		note: 'A past appointment-then-dismissal and a present informal pay arrangement are two different, compatible chapters of the same relationship over time, not a contradiction - the hard case the appointed -> employs relabel in CHANGE_MANIFEST is built around.'
	},
	{
		id: 'audit-14',
		aEntity: 'the-sable-winter',
		aStatement: 'The year 1247, when the strait froze and Cairnmouth starved.',
		bEntity: 'cairnmouth',
		bStatement: 'A third of Cairnmouth starved in the Sable Winter when the Sable Reach froze, and the rest remember exactly who did not come.',
		disagree: false,
		topic: 'sable-winter-famine',
		note: 'A summary and its own supporting detail (a third, not the whole town) about the same event - complementary, not conflicting.'
	},
	{
		id: 'audit-15',
		aEntity: 'valdoria',
		aStatement: 'A free port of six quarters; the Lantern Quarter is the poorest and the loudest.',
		bEntity: 'the-lantern-quarter',
		bStatement: 'The poorest and loudest of Valdoria’s six quarters, named for the harbour lanterns nobody has replaced since the last budget cut.',
		disagree: false,
		topic: 'lantern-quarter-character',
		note: 'The quarter’s own entry expands on the exact same characterisation the city entry gives it.'
	},
	{
		id: 'audit-16',
		aEntity: 'dagny-holt',
		aStatement: 'Collects for the Ashen Ledger out of the Cistern Quarter, and has never once raised her voice doing it.',
		bEntity: 'the-cistern-quarter',
		bStatement: 'Dagny Holt works the Cistern Quarter for the Ledger because she knows which doors not to knock on twice.',
		disagree: false,
		topic: 'dagny-holt-collections',
		note: 'Two descriptions of the same collector working the same quarter for the same employer, phrased around different details (tone of voice versus which doors she avoids).'
	},
	{
		id: 'audit-17',
		aEntity: 'il-molo-vecchio',
		aStatement: 'Iselde Wrenn keeps her office at the Old Wharf instead of the magistrate’s palace, saying she sees the city better from the water.',
		bEntity: 'harbour-seal',
		bStatement: 'The harbour magistrate keeps the office seal on a cord, not a desk, since the last magistrate who left it on a desk lost it to a bribe.',
		disagree: false,
		topic: 'iselde-wrenn-habits',
		note: 'Two separate, unconventional habits of the same magistrate (working from the wharf, wearing the seal) that reinforce rather than contradict each other.'
	},
	{
		id: 'audit-18',
		aEntity: 'la-casa-dei-mercanti',
		aStatement: 'The old Accountant at La Casa dei Mercanti never forgets a name.',
		bEntity: 'ezio-conti',
		bStatement: 'Ezio Conti, the Casa’s accountant, has never lost a figure in thirty years of service and works out of the Lantern Quarter.',
		disagree: false,
		topic: 'ezio-conti-reliability',
		note: "Both describe the same accountant's reliability from different angles (names versus figures) and add a non-conflicting detail (where he works); a weak model may read 'names' and 'figures' as two different claims about him."
	},
	{
		id: 'audit-19',
		aEntity: 'the-drowning-at-the-old-wharf',
		aStatement: 'Sera Voss thinks the drowning was a message meant for La Cricca del Molo and delivered to the wrong man.',
		bEntity: 'sera-voss',
		bStatement: 'Sergeant of the watch, posted to the Bell Quarter since the Drowning at the Old Wharf, and in no hurry to be posted back.',
		disagree: false,
		topic: 'sera-voss-drowning-investigation',
		note: 'Her theory about the case and the posting that followed from it are cause and consequence, not competing claims.'
	},
	{
		id: 'audit-20',
		aEntity: 'the-brackish-hand',
		aStatement: 'A two-masted runner out of Il Molo Vecchio, flying whatever flag the cargo needs that week.',
		bEntity: 'la-cricca-del-molo',
		bStatement: 'La Cricca del Molo owns the Brackish Hand on paper and three other names besides.',
		disagree: false,
		topic: 'brackish-hand-details',
		note: 'An operational description of the ship and a separate ownership claim about it, both true at once.'
	}
];

// ---------------------------------------------------------------------------------------------
// ASK_QUESTIONS - eighteen questions, cross-language coverage in both directions plus three
// unanswerable ones.
// ---------------------------------------------------------------------------------------------

export const ASK_QUESTIONS: AskQuestion[] = [
	// Italian question, answer lives in English prose (6).
	{
		id: 'ask-01',
		question: 'Chi comanda la Valdoria Watch adesso?',
		language: 'it',
		mustMention: ['Bryn Oswald'],
		mustNotClaim: ['Aldric Vane is still captain'],
		groundedIn: ['the-valdoria-watch', 'bryn-oswald'],
		note: 'Answer lives in the Watch’s English-language Command section (worldV2); tests cross-language retrieval in the it -> en direction.'
	},
	{
		id: 'ask-02',
		question: "Dove lavora Dagny Holt per conto dell'Ashen Ledger?",
		language: 'it',
		mustMention: ['Cistern Quarter'],
		mustNotClaim: ['Lantern Quarter'],
		groundedIn: ['dagny-holt', 'the-cistern-quarter'],
		note: 'Answer lives in Dagny Holt’s English-language entry.'
	},
	{
		id: 'ask-03',
		question: 'Perché Sera Voss è stata trasferita al Bell Quarter?',
		language: 'it',
		mustMention: ['Drowning at the Old Wharf'],
		mustNotClaim: ['She asked for the transfer herself'],
		groundedIn: ['sera-voss', 'the-drowning-at-the-old-wharf'],
		note: 'Answer lives in Sera Voss’s worldV2 English-language lead.'
	},
	{
		id: 'ask-04',
		question: 'Chi ha nominato Bryn Oswald capitano della Watch?',
		language: 'it',
		mustMention: ['Iselde Wrenn'],
		mustNotClaim: ['Corvin Ashe appointed him'],
		groundedIn: ['bryn-oswald', 'iselde-wrenn'],
		note: 'Answer lives in Bryn Oswald’s English-language entry.'
	},
	{
		id: 'ask-05',
		question: 'Quale nave appartiene a La Cricca del Molo?',
		language: 'it',
		mustMention: ['The Brackish Hand'],
		mustNotClaim: ['The ship belongs to the Ashen Ledger'],
		groundedIn: ['the-brackish-hand', 'la-cricca-del-molo'],
		note: 'Answer lives in the Brackish Hand’s English-language entry, even though the asking question names an Italian-language faction.'
	},
	{
		id: 'ask-06',
		question: 'A chi è stata assegnata la recluta Pell Ashcombe?',
		language: 'it',
		mustMention: ['Sera Voss'],
		mustNotClaim: ['assigned to Bryn Oswald directly'],
		groundedIn: ['pell-ashcombe', 'sera-voss'],
		note: 'Answer lives in Pell Ashcombe’s English-language, worldV2-only entry; also tests that a month-two addition is actually surfaced.'
	},
	// English question, answer lives in Italian prose (2).
	{
		id: 'ask-07',
		question: 'Where does La Casa dei Mercanti keep its records?',
		language: 'en',
		mustMention: ['Lantern Quarter'],
		mustNotClaim: ['Cistern Quarter'],
		groundedIn: ['la-casa-dei-mercanti'],
		note: 'Answer lives in the Italian-language lead ("tiene i suoi registri nel Quartiere della Lanterna"); tests cross-language retrieval in the en -> it direction.'
	},
	{
		id: 'ask-08',
		question: "Who holds one of the two keys to La Casa dei Mercanti's strongbox?",
		language: 'en',
		mustMention: ['Ezio Conti'],
		mustNotClaim: ['Corvin Ashe holds a key'],
		groundedIn: ['cassaforte-della-casa', 'ezio-conti'],
		note: 'Answer lives in the Italian-language cassaforte-della-casa entry.'
	},
	// Unanswerable (3).
	{
		id: 'ask-09',
		question: 'Who killed the man found under the Old Wharf?',
		language: 'en',
		mustMention: [],
		mustNotClaim: ['names any specific culprit', 'La Cricca del Molo is confirmed responsible', 'Sera Voss solved the case'],
		groundedIn: ['the-drowning-at-the-old-wharf'],
		note: 'Unsolved in the corpus - the watch’s own "What the watch found" section says nothing would hold up in front of a magistrate. The right answer admits nobody knows, which is what catches a model that invents a culprit.'
	},
	{
		id: 'ask-10',
		question: 'What did Iselde Wrenn write in the third order nobody outside her office has read?',
		language: 'en',
		mustMention: [],
		mustNotClaim: ['states the contents of the third order', 'claims it was about Aldric Vane'],
		groundedIn: ['the-thaw', 'iselde-wrenn'],
		note: 'The Thaw’s entry says the order exists and is unread by anyone else; its contents are deliberately never given anywhere in the corpus.'
	},
	{
		id: 'ask-11',
		question: 'Quante ormeggi controlla esattamente La Cricca del Molo al Molo Vecchio?',
		language: 'it',
		mustMention: [],
		mustNotClaim: ['gives an exact number of moorings'],
		groundedIn: ['la-cricca-del-molo', 'il-molo-vecchio'],
		note: 'Il Molo Vecchio only says La Cricca controls "metà" (half) the moorings, never a count - a precise number is invented, not canon.'
	},
	// English question, English-language answer (4).
	{
		id: 'ask-12',
		question: 'Why was Aldric Vane dismissed from the Valdoria Watch?',
		language: 'en',
		mustMention: ['thaw', 'Sable Winter'],
		mustNotClaim: ['He was dismissed for corruption'],
		groundedIn: ['aldric-vane'],
		note: 'Answer lives directly in Aldric Vane’s own lead.'
	},
	{
		id: 'ask-13',
		question: "What does the Smugglers' Ledger record, and how reliable is it?",
		language: 'en',
		mustMention: ['crossed out'],
		mustNotClaim: ['matches exactly what left the harbour'],
		groundedIn: ['smugglers-ledger'],
		note: 'Tests that the deliberately mixed-language item entry is read in full, not just its English sentences.'
	},
	{
		id: 'ask-14',
		question: "What is the Brackish Hand's official cargo, and what does it actually carry?",
		language: 'en',
		mustMention: ['salt fish'],
		mustNotClaim: ['carries only salt fish'],
		groundedIn: ['the-brackish-hand'],
		note: 'Answer lives in the Brackish Hand’s Cargo section.'
	},
	{
		id: 'ask-15',
		question: "What did Bryn Oswald do with the Lantern Quarter watch roster right after he took command?",
		language: 'en',
		mustMention: ['doubled the harbour patrol', 'left the Lantern Quarter roster untouched'],
		mustNotClaim: ['He cut the Lantern Quarter roster'],
		groundedIn: ['bryn-oswald'],
		note: 'Answer lives in Bryn Oswald’s "First orders" section.'
	},
	// Italian question, Italian-language answer (3).
	{
		id: 'ask-16',
		question: "Cosa contiene la cassaforte della Casa, oltre all'oro?",
		language: 'it',
		mustMention: ['lettere di credito', 'pegni'],
		mustNotClaim: ['contiene solo oro'],
		groundedIn: ['cassaforte-della-casa'],
		note: 'Answer lives directly in the strongbox’s "Cosa contiene" section.'
	},
	{
		id: 'ask-17',
		question: 'Come tratta La Cricca del Molo i suoi rapporti con La Casa dei Mercanti?',
		language: 'it',
		mustMention: ['favori'],
		mustNotClaim: ['sono alleati'],
		groundedIn: ['la-cricca-del-molo', 'la-casa-dei-mercanti'],
		note: 'Answer lives in La Cricca del Molo’s "Rispetto a La Casa dei Mercanti" section.'
	},
	{
		id: 'ask-18',
		question: 'Chi controlla il traffico portuale a Il Molo Vecchio?',
		language: 'it',
		mustMention: ['La Cricca del Molo'],
		mustNotClaim: ['il magistrato controlla tutto il traffico'],
		groundedIn: ['il-molo-vecchio', 'la-cricca-del-molo'],
		note: 'Answer lives in Il Molo Vecchio’s "Il traffico" section.'
	}
];

// ---------------------------------------------------------------------------------------------
// PROPAGATION_EDITS - the saves that should touch other entries (SPEC.md §5.1).
// ---------------------------------------------------------------------------------------------

export interface PropagationEdit {
	id: string;
	editedEntitySlug: string;
	/** For a reader of the report, and for the bench's judge prompt. */
	editedEntityName: string;
	/** The entity's body after the save. The diff between this and the corpus body is what
	 * propagation plans against, so it has to be a real edit and not a rewrite: a body that
	 * shares nothing with the original produces a diff naming every sentence and tells you
	 * nothing about candidate selection. */
	newBody: string;
	/** Entries a competent GM would want proposed, best first, the same contract
	 * `@canonry/eval`'s `PropagationCase.expected` carries. */
	targets: string[];
	/** Entries a naive selector surfaces and a GM would not want. */
	mustNotPropose: string[];
	/** One fixed sentence per edit, standing in for the cheap model's per-candidate "why".
	 * Fixed on purpose: the premium bench varies one model and holds everything else still,
	 * so a rationale that changed per candidate would make two rows incomparable. */
	planRationale: string;
	rationale: string;
}

export const PROPAGATION_EDITS: PropagationEdit[] = [
	{
		id: 'prop-captaincy',
		editedEntitySlug: 'aldric-vane',
		editedEntityName: 'Aldric Vane',
		newBody:
			'Dismissed from the watch in the thaw after [[The Sable Winter]], he now answers to [[The Ashen Ledger]] and is paid out of [[Corvin Ashe]]\u2019s own purse rather than the bank\u2019s books. He still drinks at [[The Gilded Rat]], in the corner seat nobody asks him to leave.\n\n## Standing in the city\n\nThree hundred and forty sworn used to take his word. Forty of them still would, and [[Bryn Oswald]] knows exactly which forty.',
		targets: ['the-ashen-ledger', 'corvin-ashe', 'bryn-oswald', 'the-valdoria-watch'],
		mustNotPropose: ['cairnmouth', 'the-sable-reach', 'session-2'],
		planRationale:
			'This entry names the Ledger paying Aldric off the books and names Bryn Oswald knowing which men are still his, so the entries about the Ledger, its factor, the new captain and the watch itself no longer match what this one says.',
		rationale:
			'The edit adds two facts: the payment runs through Corvin Ashe personally, and Bryn Oswald knows which of the sworn are still loyal to Aldric. The Ledger entry has a roster, Corvin Ashe has none of this, Bryn Oswald\u2019s entry does not know it, and the Watch entry counts its sworn. Cairnmouth is two hops away and about a famine, the Sable Reach is a strait, and a session log is a record of play, not canon that needs correcting.'
	},
	{
		id: 'prop-wharf-drowning',
		editedEntitySlug: 'the-drowning-at-the-old-wharf',
		editedEntityName: 'The Drowning at the Old Wharf',
		newBody:
			'A lighterman went into the water off [[Il Molo Vecchio]] on a still night, and the tide put him back two days later at [[The Bell Quarter]] steps. The watch called it an accident within the hour, which is faster than the watch calls anything.\n\n## What the ledger says\n\nThe man had a debt with [[The Ashen Ledger]] that closed itself the week he drowned, and [[La Cricca del Molo]] moved a cargo through the same berth on the same night.',
		targets: ['the-ashen-ledger', 'la-cricca-del-molo', 'il-molo-vecchio', 'the-bell-quarter'],
		mustNotPropose: ['mother-sennah', 'the-gilded-rat', 'harbour-seal'],
		planRationale:
			'The edit ties the drowning to a debt that closed itself at the Ashen Ledger and to a cargo La Cricca del Molo moved through the same berth, which is new to both of those entries and to the two places involved.',
		rationale:
			'This is the case where the graph alone would be wrong: the Ledger and La Cricca are reached through the mention, not through a relation. The two places are named directly. Mother Sennah and the Gilded Rat sit one hop from half the city and have nothing to do with a wharf, and the Harbour Seal is the magistrate\u2019s own stamp.'
	},
	{
		id: 'prop-casa-italian',
		editedEntitySlug: 'la-casa-dei-mercanti',
		editedEntityName: 'La Casa dei Mercanti',
		newBody:
			'La Casa dei Mercanti tiene i suoi registri nel Quartiere della Lanterna, non lontano dal porto di [[Valdoria]]. Nessuno entra senza un debito da saldare o una lettera di credito da mostrare, e il vecchio Contabile non dimentica mai un nome.\n\n## Il libro nero\n\nOgni prestito che la Casa concede viene scritto due volte: una per il debitore, una per la cassa. [[The Ashen Ledger]] la considera una concorrente, mai un\u2019alleata, e i loro uomini non bevono mai allo stesso tavolo.\n\n## La nuova mano\n\nDa questo inverno il Contabile non firma pi\u00f9 da solo: [[Ezio Conti]] tiene la seconda chiave della [[Cassaforte della Casa]], e nessun prestito esce senza il suo segno.',
		targets: ['ezio-conti', 'cassaforte-della-casa', 'the-ashen-ledger'],
		mustNotPropose: ['valdoria', 'smugglers-ledger'],
		planRationale:
			'L\u2019aggiunta d\u00e0 a Ezio Conti la seconda chiave della cassaforte e un potere di firma che le loro due voci non registrano ancora.',
		rationale:
			'The Italian case, and the one that catches a premium model writing an English diff into an Italian entry. Ezio Conti and the strongbox both gain a fact; the Ashen Ledger\u2019s rivalry paragraph is now about a house with two signatories. Valdoria is the city and is named only as an address, and the Smugglers\u2019 Ledger is a different book entirely.'
	}
];

// ---------------------------------------------------------------------------------------------
// THIN_ENTRIES - the entries SPEC.md §5's "Complete" mode exists for.
// ---------------------------------------------------------------------------------------------

export interface ThinEntry {
	slug: string;
	name: string;
	/** The language the draft has to come back in, per SPEC.md §17 rule three. */
	language: 'en' | 'it';
	/** What the graph around this entry already implies, and therefore what a good draft
	 * finds without inventing. Read by a human against the output; not string-matched,
	 * because there are many right ways to write any of it. */
	availableFromNeighbours: string[];
	note: string;
}

/** Chosen for being genuinely thin (a lead and no sections) while sitting on enough graph
 * that there is something honest to draft. Two are Italian on purpose. */
export const THIN_ENTRIES: ThinEntry[] = [
	{
		slug: 'corvin-ashe',
		name: 'Corvin Ashe',
		language: 'en',
		availableFromNeighbours: [
			'the Ashen Ledger employs him',
			'he is paying for forty of Aldric Vane\u2019s sworn',
			'he holds the Lantern Quarter\u2019s debt and lives there'
		],
		note: 'One line of body, three relations and a direct mention in Aldric Vane\u2019s own entry. The test is whether a draft uses those and stops there.'
	},
	{
		slug: 'iselde-wrenn',
		name: 'Iselde Wrenn',
		language: 'en',
		availableFromNeighbours: [
			'she appointed Aldric Vane and then broke him',
			'she appointed Bryn Oswald',
			'she owns the Harbour Seal',
			'she works out of Il Molo Vecchio'
		],
		note: 'The richest neighbourhood of any thin entry here, so a model with nothing to say has no excuse.'
	},
	{
		slug: 'mother-sennah',
		name: 'Mother Sennah',
		language: 'en',
		availableFromNeighbours: [
			'she owns the Gilded Rat',
			'the corner seat is understood to belong to Aldric Vane',
			'she was a field surgeon through the Sable Winter'
		],
		note: 'The trap is the Sable Winter: her entry says she does not talk about it, so a draft that invents what she saw has invented canon.'
	},
	{
		slug: 'ezio-conti',
		name: 'Ezio Conti',
		language: 'it',
		availableFromNeighbours: [
			'\u00e8 membro de La Casa dei Mercanti',
			'sta nel Quartiere della Lanterna'
		],
		note: 'Italian, and thinner than the English cases, which is where a model is most tempted to fill the space with atmosphere.'
	},
	{
		slug: 'cassaforte-della-casa',
		name: 'Cassaforte della Casa',
		language: 'it',
		availableFromNeighbours: [
			'La Casa dei Mercanti la possiede',
			'il libro nero della Casa scrive ogni prestito due volte'
		],
		note: 'An item rather than a person, in Italian: two relations and no mentions to lean on.'
	}
];
