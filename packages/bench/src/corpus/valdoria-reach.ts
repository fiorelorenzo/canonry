/**
 * Valdoria Reach, the same world packages/db/src/seed-fixture.ts seeds and docs/ux/SAMPLE-WORLD.md
 * describes, extended into a full import corpus. The first fourteen entities below carry the exact
 * slug, name, aliases, type and prose from seed-fixture.ts's ENTITIES array - copied, not
 * paraphrased, because every renderer and every mock in docs/ux/ has to be looking at the same
 * city. Everything past those fourteen is new, written so Valdoria Reach reads like an actual
 * campaign wiki rather than a fixture: the other quarters, a harbour, a rival smuggling outfit, a
 * murder nobody has closed.
 *
 * worldV2 is the same world a month later (SPEC.md §6.4): most entities untouched, a handful edited
 * at the source, one renamed, a few new, and two quietly missing from the export even though
 * nothing in the story deleted them. CHANGE_MANIFEST records exactly what differs, as data, so an
 * e2e run can assert against it instead of against my prose.
 *
 * Relation labels: the shipped catalogue (packages/db/migrations/0001_seed_relation_type_catalogue.sql
 * plus 0029_containment_and_protects_relations.sql, confirmed against the live migrated DB) is ten
 * labels, each with a fixed allowed_from / allowed_to entity-type set that is enforced, not
 * advisory:
 *
 *   commands     | commanded by | one_to_many  | {character,faction} -> {character,faction}
 *   employs      | employed by  | one_to_many  | {character,faction} -> {character}
 *   located in   | contains     | many_to_one  | {character,faction,item,event} -> {place}
 *   member of    | has member   | many_to_many | {character} -> {faction}
 *   ally of      | ally of      | many_to_many | {character,faction} -> {character,faction}
 *   parent of    | child of     | one_to_many  | {character} -> {character}
 *   owns         | owned by     | one_to_many  | {character,faction} -> {item,place}
 *   appointed    | appointed by | one_to_many  | {character,faction} -> {character}
 *   part of      | contains     | many_to_one  | {place,faction} -> {place,faction}
 *   protects     | protected by | many_to_many | {character,faction} -> {character,faction}
 *
 * I hold to exactly these ten labels and their real allowed_from/allowed_to below. `part of`
 * (issue #165) is what makes seed-fixture.ts's own `['the-gilded-rat', 'part of', 'valdoria']` row
 * legal - a place inside a place, which `located in` still cannot start (allowed_from stays
 * {character,faction,item,event}, no `place`). I have not gone back to nest the other quarters or
 * the harbour into Valdoria below: that is new fiction this issue did not ask for, not a
 * consequence of the fix. A session entity still carries no relation at all, since no label's
 * allowed_from or allowed_to includes `session` - #165 left that gap open on purpose (sessions
 * already attach to canon through `revelation.session_entity_id` and
 * `session_context.session_entity_id`, not through the relation catalogue). See "edges the
 * catalogue cannot express" in my report for the full list of what this cost the world.
 */
import type { World, WorldEntity, WorldRelation } from './types.js';

type CatalogueLabel =
	| 'commands'
	| 'employs'
	| 'located in'
	| 'member of'
	| 'ally of'
	| 'parent of'
	| 'owns'
	| 'appointed'
	| 'part of'
	| 'protects';

const RELATION_CATALOGUE: Record<CatalogueLabel, { inverseLabel: string; cardinality: WorldRelation['cardinality'] }> = {
	commands: { inverseLabel: 'commanded by', cardinality: 'one_to_many' },
	employs: { inverseLabel: 'employed by', cardinality: 'one_to_many' },
	'located in': { inverseLabel: 'contains', cardinality: 'many_to_one' },
	'member of': { inverseLabel: 'has member', cardinality: 'many_to_many' },
	'ally of': { inverseLabel: 'ally of', cardinality: 'many_to_many' },
	'parent of': { inverseLabel: 'child of', cardinality: 'one_to_many' },
	owns: { inverseLabel: 'owned by', cardinality: 'one_to_many' },
	appointed: { inverseLabel: 'appointed by', cardinality: 'one_to_many' },
	'part of': { inverseLabel: 'contains', cardinality: 'many_to_one' },
	protects: { inverseLabel: 'protected by', cardinality: 'many_to_many' }
};

function rel(from: string, label: CatalogueLabel, to: string): WorldRelation {
	const def = RELATION_CATALOGUE[label];
	return { from, label, to, inverseLabel: def.inverseLabel, cardinality: def.cardinality };
}

// ---------------------------------------------------------------------------------------------
// The fourteen entities seed-fixture.ts already seeds. Slug, name, aliases, type and prose (lead +
// sections split on the frozen body's `## ` headings) match seed-fixture.ts's ENTITIES array
// exactly. language, tags, kankaSubtype, worldAnvilTemplate and image are mine to set - none of
// those fields exist on seed-fixture.ts's SeedEntity.
// ---------------------------------------------------------------------------------------------

const aldricVane: WorldEntity = {
	slug: 'aldric-vane',
	type: 'character',
	name: 'Aldric Vane',
	aliases: ['Captain Vane', 'the broken captain'],
	language: 'en',
	lead: 'Dismissed from the watch in the thaw after [[The Sable Winter]], he now answers to [[The Ashen Ledger]]. He still drinks at [[The Gilded Rat]], in the corner seat nobody asks him to leave.',
	sections: [
		{
			heading: 'Standing in the city',
			body: 'Three hundred and forty sworn used to take his word. Forty of them still would, which is the number [[Corvin Ashe]] is paying for.'
		}
	],
	tags: ['watch', 'ashen-ledger', 'disgraced'],
	image: { file: 'aldric-vane.png', alt: 'Ink-and-wash portrait of Aldric Vane, ex-captain of the Valdoria Watch' },
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const motherSennah: WorldEntity = {
	slug: 'mother-sennah',
	type: 'character',
	name: 'Mother Sennah',
	aliases: ['the Winter Surgeon'],
	language: 'en',
	lead: 'Keeps [[The Gilded Rat]]. She was a field surgeon through [[The Sable Winter]] and does not talk about it, which is its own kind of talking about it.',
	sections: [],
	tags: ['gilded-rat', 'sable-winter', 'healer'],
	image: { file: 'mother-sennah.png', alt: 'Ink-and-wash portrait of Mother Sennah, keeper of the Gilded Rat' },
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const corvinAshe: WorldEntity = {
	slug: 'corvin-ashe',
	type: 'character',
	name: 'Corvin Ashe',
	aliases: [],
	language: 'en',
	lead: "Factor of [[The Ashen Ledger]]. He holds most of the Lantern Quarter's debt and none of its affection.",
	sections: [],
	tags: ['ashen-ledger', 'lantern-quarter', 'factor'],
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const iseldeWrenn: WorldEntity = {
	slug: 'iselde-wrenn',
	type: 'character',
	name: 'Iselde Wrenn',
	aliases: [],
	language: 'en',
	lead: 'Harbour magistrate. She appointed [[Aldric Vane]], and then broke him, and has never explained which of the two she regrets.',
	sections: [],
	tags: ['magistrate', 'harbour', 'watch'],
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const valdoria: WorldEntity = {
	slug: 'valdoria',
	type: 'place',
	name: 'Valdoria',
	aliases: [],
	language: 'en',
	lead: 'A free port of six quarters. The Lantern Quarter is the poorest and the loudest.',
	sections: [
		{
			heading: 'The Watch',
			body: 'Three hundred and forty sworn, badly paid, and currently without a captain.'
		}
	],
	tags: ['city', 'free-port', 'six-quarters'],
	image: { file: 'valdoria.png', alt: 'Ink-and-wash map of Valdoria’s six quarters' },
	kankaSubtype: 'City',
	worldAnvilTemplate: 'settlement'
};

const theGildedRat: WorldEntity = {
	slug: 'the-gilded-rat',
	type: 'place',
	name: 'The Gilded Rat',
	aliases: ['Gilded Rat Tavern', 'Il Ratto Dorato'],
	language: 'en',
	lead: 'An inn in the Lantern Quarter. [[Mother Sennah]] keeps it, and the corner seat by the stair is understood to belong to somebody.',
	sections: [],
	tags: ['tavern', 'lantern-quarter', 'watch-haunt'],
	image: { file: 'the-gilded-rat.png', alt: 'Ink-and-wash exterior of the Gilded Rat tavern in the Lantern Quarter' },
	kankaSubtype: 'Tavern',
	worldAnvilTemplate: 'settlement'
};

const cairnmouth: WorldEntity = {
	slug: 'cairnmouth',
	type: 'place',
	name: 'Cairnmouth',
	aliases: [],
	language: 'en',
	lead: 'A fishing town two days up the coast. A third of it starved in [[The Sable Winter]] when [[The Sable Reach]] froze, and the rest remember exactly who did not come. Captain Vane led the watch through the second freeze, the winter after the thaw.',
	sections: [],
	tags: ['fishing-town', 'sable-winter', 'coast'],
	kankaSubtype: 'Town',
	worldAnvilTemplate: 'settlement'
};

const theAshenLedger: WorldEntity = {
	slug: 'the-ashen-ledger',
	type: 'faction',
	name: 'The Ashen Ledger',
	aliases: [],
	language: 'en',
	lead: 'A merchant bank that lends at knife point and keeps better records than the magistrate.\n\n:::secret\nAldric Vane, the dismissed captain of the Valdoria Watch, is now on its payroll.\n:::\n\n:::gmnote\nIselde Wrenn appointed Aldric, then broke him. Play this reveal as her fault circling back, not his.\n:::',
	sections: [],
	tags: ['bank', 'lantern-quarter', 'debt'],
	image: { file: 'the-ashen-ledger.png', alt: 'Ink-and-wash seal of the Ashen Ledger merchant bank' },
	kankaSubtype: 'Bank',
	worldAnvilTemplate: 'organization'
};

const theValdoriaWatch: WorldEntity = {
	slug: 'the-valdoria-watch',
	type: 'faction',
	name: 'The Valdoria Watch',
	aliases: [],
	language: 'en',
	lead: 'Three hundred and forty sworn, paid badly and proud of it anyway.',
	sections: [],
	tags: ['watch', 'city-guard', 'valdoria'],
	kankaSubtype: 'Guild',
	worldAnvilTemplate: 'organization'
};

const theSableWinter: WorldEntity = {
	slug: 'the-sable-winter',
	type: 'event',
	name: 'The Sable Winter',
	aliases: [],
	language: 'en',
	lead: 'The year 1247, when the strait froze and [[Cairnmouth]] starved.',
	sections: [],
	tags: ['event', '1247', 'disaster'],
	kankaSubtype: 'Disaster',
	worldAnvilTemplate: 'myth'
};

const session1: WorldEntity = {
	slug: 'session-1',
	type: 'session',
	name: 'Session 1',
	aliases: [],
	language: 'en',
	lead: 'The party arrived in the Lantern Quarter and started asking questions about Aldric Vane.',
	sections: [],
	tags: ['session', 'campaign-log'],
	kankaSubtype: 'Session Log',
	worldAnvilTemplate: 'report'
};

const theDrownedConcord: WorldEntity = {
	slug: 'the-drowned-concord',
	type: 'faction',
	name: 'The Drowned Concord',
	aliases: [],
	language: 'en',
	lead: 'A smuggling ring nobody at the table has heard of yet. Not for players (#82-85 fixture).',
	sections: [],
	tags: ['smuggling', 'gm-only', 'faction'],
	kankaSubtype: 'Guild',
	worldAnvilTemplate: 'organization'
};

const laCasaDeiMercanti: WorldEntity = {
	slug: 'la-casa-dei-mercanti',
	type: 'faction',
	name: 'La Casa dei Mercanti',
	aliases: ['The Merchant House'],
	language: 'it',
	lead: 'La Casa dei Mercanti tiene i suoi registri nel Quartiere della Lanterna, non lontano dal porto di [[Valdoria]]. Nessuno entra senza un debito da saldare o una lettera di credito da mostrare, e il vecchio Contabile non dimentica mai un nome.',
	sections: [
		{
			heading: 'Il libro nero',
			body: 'Ogni prestito che la Casa concede viene scritto due volte: una per il debitore, una per la cassa. [[The Ashen Ledger]] la considera una concorrente, mai un’alleata, e i loro uomini non bevono mai allo stesso tavolo.'
		}
	],
	tags: ['bank', 'italian-quarter', 'rival-of-ledger'],
	kankaSubtype: 'Bank',
	worldAnvilTemplate: 'organization'
};

const smugglersLedger: WorldEntity = {
	slug: 'smugglers-ledger',
	type: 'item',
	name: "The Smugglers' Ledger",
	aliases: [],
	language: 'mixed',
	lead: "A ledger nobody at the table has read yet, kept by whoever is running goods through the Lantern Quarter that week. The handwriting changes hands more than the goods do, and nobody has ever admitted to owning it.\n\nIl carico di questa settimana non è passato dal molo, ma dalla porta sul retro della locanda, dove nessuno guarda mai due volte. Chi scrive non firma mai con il proprio nome, e questo non è un caso.\n\nHalf the entries are crossed out, and the other half do not match what actually left the harbour that night. Whoever kept it after [[Aldric Vane]] stopped writing has a different hand entirely, but the same habit of saying less than they know.",
	sections: [],
	tags: ['item', 'mixed-language', 'harbour'],
	kankaSubtype: 'Item',
	worldAnvilTemplate: 'item'
};

// ---------------------------------------------------------------------------------------------
// The eighteen new entities. English unless noted; four more Italian (il-molo-vecchio,
// la-cricca-del-molo, cassaforte-della-casa, ezio-conti) plus la-casa-dei-mercanti above makes
// five Italian entities total. One more mixed (session-3) plus smugglers-ledger above makes two
// mixed entities total.
// ---------------------------------------------------------------------------------------------

const theSableReach: WorldEntity = {
	slug: 'the-sable-reach',
	type: 'place',
	name: 'The Sable Reach',
	aliases: ['the Reach'],
	language: 'en',
	lead: "The strait between Valdoria and the open water, narrow enough to see the far shore on a clear day and cold enough that most years nobody tries. It froze solid in 1247, which nobody in [[Cairnmouth]] had seen happen before and hopes not to see again.",
	sections: [
		{
			heading: 'The freeze',
			body: "Ice held from the first frost to the thaw, thick enough to walk a cart across by midwinter. [[The Sable Winter]] takes its name from what the ice did to the fishing towns on the far side, not from the reach itself."
		}
	],
	tags: ['geography', 'sable-winter', 'strait'],
	kankaSubtype: 'Region',
	worldAnvilTemplate: 'settlement'
};

const theCisternQuarter: WorldEntity = {
	slug: 'the-cistern-quarter',
	type: 'place',
	name: 'The Cistern Quarter',
	aliases: ['the Cistern'],
	language: 'en',
	lead: "Valdoria's second poorest quarter, built over the old rain cisterns that give it the name and the smell. [[Sera Voss]] grew up here, and says the water table is the only honest thing about the district.",
	sections: [
		{
			heading: "Who's from here",
			body: "Dockhands, ropers, and anyone who owes [[The Ashen Ledger]] and would rather not be found near the harbour. [[Dagny Holt]] works the quarter for the Ledger because she knows which doors not to knock on twice."
		}
	],
	tags: ['valdoria-quarter', 'docks', 'ledger'],
	kankaSubtype: 'District',
	worldAnvilTemplate: 'settlement'
};

const theBellQuarter: WorldEntity = {
	slug: 'the-bell-quarter',
	type: 'place',
	name: 'The Bell Quarter',
	aliases: [],
	language: 'en',
	lead: "The quarter that hears the harbour bell first and the watch bell second, which tells you which one the residents trust more. [[Il Molo Vecchio]] sits at its western edge, and most of what happens in the Bell Quarter happens because of what comes off the boats.",
	sections: [
		{
			heading: 'After dark',
			body: "[[The Drowned Concord]] used to run goods through here before anyone official admitted the Concord existed. These days it's [[La Cricca del Molo]] that the watch pretends not to see."
		}
	],
	tags: ['valdoria-quarter', 'harbour', 'smuggling'],
	kankaSubtype: 'District',
	worldAnvilTemplate: 'settlement'
};

const ilMoloVecchio: WorldEntity = {
	slug: 'il-molo-vecchio',
	type: 'place',
	name: 'Il Molo Vecchio',
	aliases: ['The Old Wharf'],
	language: 'it',
	lead: "Il porto vecchio di Valdoria, dove attraccano le barche da pesca e quelle che non vogliono essere contate. [[Iselde Wrenn]] tiene il suo ufficio qui, non nel palazzo del magistrato, perché dice di vedere meglio la città dall’acqua che dalla terra.",
	sections: [
		{
			heading: 'Il traffico',
			body: 'Ogni nave che entra paga il molo prima di pagare chiunque altro. [[La Cricca del Molo]] controlla metà degli ormeggi e non lo nasconde più di tanto.'
		}
	],
	tags: ['porto', 'valdoria-quarter', 'harbour'],
	kankaSubtype: 'Harbour',
	worldAnvilTemplate: 'settlement'
};

const brynOswald: WorldEntity = {
	slug: 'bryn-oswald',
	type: 'character',
	name: 'Bryn Oswald',
	aliases: ['Captain Oswald'],
	language: 'en',
	lead: "Promoted out of the ranks a week after [[Aldric Vane]] left them, on [[Iselde Wrenn]]'s word and nobody else's. He has not yet worked out whether that makes him lucky.",
	sections: [
		{
			heading: 'First orders',
			body: "Doubled the harbour patrol and left the Lantern Quarter roster untouched, which everyone read as a message about [[Corvin Ashe]] even though he insists it was about arithmetic."
		}
	],
	tags: ['watch', 'new-captain', 'lantern-quarter'],
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const seraVoss: WorldEntity = {
	slug: 'sera-voss',
	type: 'character',
	name: 'Sera Voss',
	aliases: ['Sergeant Voss'],
	language: 'en',
	lead: "Sergeant of the watch, Cistern-born and harbour-trained, the one who actually reads the log book [[Aldric Vane]] used to skim.",
	sections: [
		{
			heading: 'What she keeps quiet',
			body: "She liked the old captain more than she says in front of [[Bryn Oswald]], and reads [[The Smugglers' Ledger]] on her own time when nobody's asked her to."
		}
	],
	tags: ['watch', 'cistern-quarter', 'investigator'],
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const dagnyHolt: WorldEntity = {
	slug: 'dagny-holt',
	type: 'character',
	name: 'Dagny Holt',
	aliases: ['the collector'],
	language: 'en',
	lead: 'Collects for [[The Ashen Ledger]] out of the Cistern Quarter, and has never once raised her voice doing it. People pay her faster than they pay anyone who shouts.',
	sections: [
		{
			heading: 'Method',
			body: 'She does not carry a blade where it shows. [[Corvin Ashe]] trusts her with the accounts he does not want written down twice.'
		}
	],
	tags: ['ledger', 'collector', 'cistern-quarter'],
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const ezioConti: WorldEntity = {
	slug: 'ezio-conti',
	type: 'character',
	name: 'Ezio Conti',
	aliases: ['il Contabile'],
	language: 'it',
	lead: 'Il contabile di [[La Casa dei Mercanti]], quello che non dimentica mai un nome, come dicono tutti. Tiene i registri nel quartiere della Lanterna e non ha mai perso una cifra in trent’anni di servizio.',
	sections: [
		{
			heading: 'Il debito di Corvin Ashe',
			body: 'Non parla mai con [[Corvin Ashe]] di persona, ma sa esattamente quanto deve a [[The Ashen Ledger]] e quanto dovrebbe dovere a [[La Casa dei Mercanti]] se fosse onesto. Lavora nel [[The Lantern Quarter]], due porte più in là dalla bottega dove tutti fingono di non vederlo.'
		}
	],
	tags: ['la-casa-dei-mercanti', 'italian-quarter', 'accountant'],
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const theBrackishHand: WorldEntity = {
	slug: 'the-brackish-hand',
	type: 'item',
	name: 'The Brackish Hand',
	aliases: ['the Hand'],
	language: 'en',
	lead: "A two-masted runner out of [[Il Molo Vecchio]], flying whatever flag the cargo needs that week. [[La Cricca del Molo]] owns her on paper and three other names besides.",
	sections: [
		{
			heading: 'Cargo',
			body: "Officially salt fish. Actually whatever fits under the salt fish, which is most things if you're not fussy about the smell."
		}
	],
	tags: ['ship', 'smuggling', 'harbour'],
	kankaSubtype: 'Vehicle',
	worldAnvilTemplate: 'item'
};

const harbourSeal: WorldEntity = {
	slug: 'harbour-seal',
	type: 'item',
	name: 'The Harbour Seal',
	aliases: ['the harbour seal'],
	language: 'en',
	lead: "The wax seal of the harbour magistrate's office, older than [[Iselde Wrenn]]'s appointment and outlasting most who have held it. She keeps it on a cord, not a desk, since the last magistrate who left it on a desk lost it to a bribe.",
	sections: [
		{
			heading: "What it's worth",
			body: "Nothing sold on a ship or docked at [[Il Molo Vecchio]] is legal without its mark. [[The Ashen Ledger]] has offered to buy her a better one twice. She has kept the old one twice."
		}
	],
	tags: ['harbour', 'magistrate', 'item'],
	kankaSubtype: 'Item',
	worldAnvilTemplate: 'item'
};

const cassaforteDellaCasa: WorldEntity = {
	slug: 'cassaforte-della-casa',
	type: 'item',
	name: 'La Cassaforte della Casa',
	aliases: ['la cassaforte'],
	language: 'it',
	lead: 'La cassaforte di [[La Casa dei Mercanti]], due chiavi, mai la stessa mano per entrambe nella stessa settimana. [[Ezio Conti]] ne tiene una; l’altra passa di socio in socio, e nessuno ricorda una regola per come si sceglie il prossimo.',
	sections: [
		{
			heading: 'Cosa contiene',
			body: 'Non oro, quasi mai. Lettere di credito, pegni, e un libro più vecchio del libro nero che nessuno fuori dalla Casa ha mai visto aperto.'
		}
	],
	tags: ['la-casa-dei-mercanti', 'item', 'italian-quarter'],
	kankaSubtype: 'Item',
	worldAnvilTemplate: 'item'
};

const laCriccaDelMolo: WorldEntity = {
	slug: 'la-cricca-del-molo',
	type: 'faction',
	name: 'La Cricca del Molo',
	aliases: ['the Wharf Clique'],
	language: 'it',
	lead: 'Non è una gilda, non ufficialmente. È un accordo tra chi controlla gli ormeggi di [[Il Molo Vecchio]] e chi controlla cosa ci passa sopra, ed è più vecchio di quanto chiunque al tavolo di [[Iselde Wrenn]] voglia ammettere.',
	sections: [
		{
			heading: 'Rispetto a La Casa dei Mercanti',
			body: 'La Casa dei Mercanti presta denaro. La Cricca presta favori, e i favori si pagano più cari. Non sono nemici, ma non si siedono mai allo stesso tavolo.'
		}
	],
	tags: ['rival-faction', 'harbour', 'smuggling'],
	kankaSubtype: 'Guild',
	worldAnvilTemplate: 'organization'
};

const theThaw: WorldEntity = {
	slug: 'the-thaw',
	type: 'event',
	name: 'The Thaw',
	aliases: [],
	language: 'en',
	lead: "The weeks after [[The Sable Winter]] broke, when the ice on [[The Sable Reach]] cracked all at once instead of slowly, and half of Valdoria's harbour traffic tried to move in the same week. It is when [[Aldric Vane]] lost his captaincy, though nobody at [[The Valdoria Watch]] will say the two things happened for the same reason out loud.",
	sections: [
		{
			heading: 'What changed',
			body: "[[Iselde Wrenn]] signed three orders in a single week: one dismissing a captain, one appointing his replacement, one nobody outside her office has read. [[Valdoria]] barely noticed the third."
		}
	],
	tags: ['event', 'sable-winter-aftermath', '1247'],
	kankaSubtype: 'Historical',
	worldAnvilTemplate: 'myth'
};

const theDrowningAtTheOldWharf: WorldEntity = {
	slug: 'the-drowning-at-the-old-wharf',
	type: 'event',
	name: 'The Drowning at the Old Wharf',
	aliases: [],
	language: 'en',
	lead: "A body came up under [[Il Molo Vecchio]] on a morning tide, weeks ago now, tied in a way the harbour master said no accident ties a rope. [[The Valdoria Watch]] called it a drowning in the official log and something else everywhere the log isn't read.",
	sections: [
		{
			heading: "The watch's theory",
			body: "[[Sera Voss]] thinks it was a message meant for [[La Cricca del Molo]] and delivered to the wrong man. She has said so to [[Bryn Oswald]] and to nobody else."
		}
	],
	tags: ['event', 'murder', 'bell-quarter'],
	kankaSubtype: 'Incident',
	worldAnvilTemplate: 'myth'
};

const session2: WorldEntity = {
	slug: 'session-2',
	type: 'session',
	name: 'Session 2',
	aliases: [],
	language: 'en',
	lead: "The party followed [[Aldric Vane]] to [[The Gilded Rat]] and got their first look at [[The Ashen Ledger]]'s handwriting, on a note he didn't mean to leave on the table.",
	sections: [],
	tags: ['session', 'campaign-log'],
	kankaSubtype: 'Session Log',
	worldAnvilTemplate: 'report'
};

const session3: WorldEntity = {
	slug: 'session-3',
	type: 'session',
	name: 'Session 3',
	aliases: [],
	language: 'mixed',
	lead: "The party crossed into [[The Cistern Quarter]] chasing a name out of [[The Smugglers' Ledger]] and met [[Dagny Holt]], who answered exactly as many questions as she was paid to. La sessione è finita nel Molo Vecchio, con il gruppo che guarda una nave salpare senza sapere se dovevano fermarla.",
	sections: [],
	tags: ['session', 'campaign-log', 'cistern-quarter'],
	kankaSubtype: 'Session Log',
	worldAnvilTemplate: 'report'
};

const session4: WorldEntity = {
	slug: 'session-4',
	type: 'session',
	name: 'Session 4',
	aliases: [],
	language: 'en',
	lead: "Word of [[The Drowning at the Old Wharf]] reached the table before the watch's own report did. The party spent the session deciding who to ask first: [[Sera Voss]], who investigates it officially, or [[Ezio Conti]], who might know who owed money to a dead man.",
	sections: [],
	tags: ['session', 'campaign-log', 'murder'],
	kankaSubtype: 'Session Log',
	worldAnvilTemplate: 'report'
};

const theLanternQuarter: WorldEntity = {
	slug: 'the-lantern-quarter',
	type: 'place',
	name: 'The Lantern Quarter',
	aliases: ['Quartiere della Lanterna'],
	language: 'en',
	lead: "The poorest and loudest of [[Valdoria]]'s six quarters, named for the harbour lanterns nobody has replaced since the last budget cut. [[Corvin Ashe]] holds most of its debt, and most of its residents know exactly which building is his.",
	sections: [
		{
			heading: 'Who works it',
			body: "[[Bryn Oswald]] keeps the roster here light on purpose. [[Ezio Conti]] keeps the books here honest, or honest enough that nobody has proven otherwise."
		}
	],
	tags: ['valdoria-quarter', 'poverty', 'ledger'],
	kankaSubtype: 'District',
	worldAnvilTemplate: 'settlement'
};

// ---------------------------------------------------------------------------------------------
// worldV1
// ---------------------------------------------------------------------------------------------

const V1_ENTITIES: WorldEntity[] = [
	aldricVane,
	motherSennah,
	corvinAshe,
	iseldeWrenn,
	brynOswald,
	seraVoss,
	dagnyHolt,
	ezioConti,
	valdoria,
	theGildedRat,
	cairnmouth,
	theSableReach,
	theCisternQuarter,
	theBellQuarter,
	ilMoloVecchio,
	theLanternQuarter,
	theAshenLedger,
	theValdoriaWatch,
	theDrownedConcord,
	laCasaDeiMercanti,
	laCriccaDelMolo,
	smugglersLedger,
	theBrackishHand,
	harbourSeal,
	cassaforteDellaCasa,
	theSableWinter,
	theThaw,
	theDrowningAtTheOldWharf,
	session1,
	session2,
	session3,
	session4
];

const V1_RELATIONS: WorldRelation[] = [
	rel('the-ashen-ledger', 'employs', 'aldric-vane'),
	rel('iselde-wrenn', 'appointed', 'aldric-vane'),
	rel('aldric-vane', 'member of', 'the-valdoria-watch'),
	rel('the-valdoria-watch', 'located in', 'valdoria'),
	rel('mother-sennah', 'owns', 'the-gilded-rat'),
	rel('the-ashen-ledger', 'employs', 'corvin-ashe'),
	rel('la-casa-dei-mercanti', 'located in', 'valdoria'),
	rel('smugglers-ledger', 'located in', 'valdoria'),
	rel('bryn-oswald', 'commands', 'the-valdoria-watch'),
	rel('iselde-wrenn', 'appointed', 'bryn-oswald'),
	rel('bryn-oswald', 'member of', 'the-valdoria-watch'),
	rel('sera-voss', 'member of', 'the-valdoria-watch'),
	rel('the-ashen-ledger', 'employs', 'dagny-holt'),
	rel('la-casa-dei-mercanti', 'owns', 'cassaforte-della-casa'),
	rel('ezio-conti', 'member of', 'la-casa-dei-mercanti'),
	rel('la-cricca-del-molo', 'owns', 'the-brackish-hand'),
	rel('the-brackish-hand', 'located in', 'il-molo-vecchio'),
	rel('iselde-wrenn', 'owns', 'harbour-seal'),
	rel('the-sable-winter', 'located in', 'the-sable-reach'),
	rel('the-thaw', 'located in', 'the-sable-reach'),
	rel('the-drowning-at-the-old-wharf', 'located in', 'the-bell-quarter'),
	rel('corvin-ashe', 'located in', 'the-lantern-quarter'),
	rel('dagny-holt', 'located in', 'the-cistern-quarter'),
	rel('sera-voss', 'located in', 'the-cistern-quarter'),
	rel('bryn-oswald', 'located in', 'the-lantern-quarter'),
	rel('iselde-wrenn', 'located in', 'il-molo-vecchio'),
	rel('la-cricca-del-molo', 'located in', 'the-bell-quarter'),
	rel('ezio-conti', 'located in', 'the-lantern-quarter')
];

export const worldV1: World = {
	id: 'valdoria-reach',
	name: 'Valdoria Reach',
	revision: 'v1',
	entities: V1_ENTITIES,
	relations: V1_RELATIONS
};

// ---------------------------------------------------------------------------------------------
// worldV2: the same world a month later.
//
// Renamed (1): the-gilded-rat's primary name becomes "Il Ratto Dorato", "The Gilded Rat" demotes
// to an alias. Same slug, same body - this is the matcher stress case docs/ux/SAMPLE-WORLD.md
// names ("the Gilded Rat (existing) against Il Ratto Dorato (incoming), similarity 0.86").
//
// Changed at source (6), each with a reason:
//   - iselde-wrenn: two sections added. "The new captain" records her hovering over Bryn Oswald's
//     watch changes; "An old arrangement" establishes she now quietly pays Aldric Vane for what he
//     remembers of the old rosters - the prose that makes the appointed -> employs relabel below
//     honest rather than arbitrary.
//   - valdoria: its "The Watch" section no longer says the city is "without a captain" - it names
//     Bryn Oswald, since a city entry that still called the watch captainless a month after the
//     appointment would itself be the kind of stale fact this corpus exists to catch.
//   - the-valdoria-watch: a "Command" section is added naming Bryn Oswald as captain, mirroring the
//     change to valdoria's own Watch section from the faction's side.
//   - sera-voss: her lead changes outright (not just a new section) to record she has been posted
//     to the Bell Quarter since the drowning - the counterpart to the relocated `located in` edge
//     below.
//   - the-drowning-at-the-old-wharf: a "What the watch found" section is added - the case is still
//     open, which is also why one of gold.ts's unanswerable ASK_QUESTIONS asks who did it.
//   - la-cricca-del-molo: a section is added recording the Ashen Ledger's new courtesy visits to the
//     wharf, the prose counterpart to the new ally-of edge between them below.
//
// Added (4, absent from v1): session-5, captains-baton, the-frost-market, pell-ashcombe - a next
// session, the new captain's baton of office, the market that only opens once the reach thaws, and
// a Watch recruit. None of the four carry any relation: a freshly written note in a real vault
// often has no relations mapped into it yet, and it keeps the relation diff below to exactly the
// three additions the task calls for.
//
// Removed from source, i.e. present in v1 and absent from v2, to be marked missing_in_source and
// never deleted (2):
//   - the-drowned-concord: it "goes dark" - consistent with it never having carried a relation in
//     the first place (seed-fixture.ts's own RELATIONS array never mentions it either), so removing
//     it from the entity list removes zero relations, keeping the relation diff clean.
//   - session-1: an old session log a GM drops while tidying the vault - the ordinary, mundane way
//     missing_in_source actually happens, as opposed to a dramatic in-fiction disappearance.
// ---------------------------------------------------------------------------------------------

const ilRattoDorato: WorldEntity = {
	...theGildedRat,
	name: 'Il Ratto Dorato',
	aliases: ['The Gilded Rat', 'Gilded Rat Tavern']
};

const iseldeWrennV2: WorldEntity = {
	...iseldeWrenn,
	sections: [
		{
			heading: 'The new captain',
			body: "She appointed [[Bryn Oswald]] within the week, no ceremony, and has been at his shoulder during the watch changes at [[The Bell Quarter]] more often than a magistrate strictly needs to be. Whatever she owes [[Aldric Vane]], she is not going to owe it twice."
		},
		{
			heading: 'An old arrangement',
			body: "She still calls it a favour. He calls it a wage. Either way it turns up in her own ledger and not the watch’s, a line she pays out of pocket for what he remembers about the old rosters at [[The Valdoria Watch]]."
		}
	]
};

const valdoriaV2: WorldEntity = {
	...valdoria,
	sections: [
		{
			heading: 'The Watch',
			body: 'Three hundred and forty sworn, badly paid, and answering to [[Bryn Oswald]] now, a month into the appointment.'
		}
	]
};

const theValdoriaWatchV2: WorldEntity = {
	...theValdoriaWatch,
	sections: [
		{
			heading: 'Command',
			body: "[[Bryn Oswald]] took the captaincy a month after [[Aldric Vane]] left it, on [[Iselde Wrenn]]'s word. Nobody has salted his boots yet, which passes for approval in the Lantern Quarter."
		}
	]
};

const seraVossV2: WorldEntity = {
	...seraVoss,
	lead: "Sergeant of the watch, posted to [[The Bell Quarter]] since [[The Drowning at the Old Wharf]], and in no hurry to be posted back."
};

const theDrowningAtTheOldWharfV2: WorldEntity = {
	...theDrowningAtTheOldWharf,
	sections: [
		...theDrowningAtTheOldWharf.sections,
		{
			heading: 'What the watch found',
			body: "Nothing that would hold up in front of a magistrate. [[Sera Voss]] has her own opinion about [[La Cricca del Molo]], and keeps it to herself in front of [[Dagny Holt]]."
		}
	]
};

const laCriccaDelMoloV2: WorldEntity = {
	...laCriccaDelMolo,
	sections: [
		...laCriccaDelMolo.sections,
		{
			heading: 'Nuova compagnia',
			body: 'The Ashen Ledger ha iniziato a mandare un impiegato al molo nei giorni di consegna, cosa che i vecchi chiamano una cortesia e tutti gli altri chiamano una tassa.'
		}
	]
};

const session5: WorldEntity = {
	slug: 'session-5',
	type: 'session',
	name: 'Session 5',
	aliases: [],
	language: 'en',
	lead: "The party pressed [[Ezio Conti]] about who owed money to whoever went into the water at [[Il Molo Vecchio]], and got a name nobody expected: someone still on [[The Valdoria Watch]]'s own roster.",
	sections: [],
	tags: ['session', 'campaign-log', 'murder'],
	kankaSubtype: 'Session Log',
	worldAnvilTemplate: 'report'
};

const captainsBaton: WorldEntity = {
	slug: 'captains-baton',
	type: 'item',
	name: "The Captain's Baton",
	aliases: [],
	language: 'en',
	lead: "The watch captain's baton of office, handed to [[Bryn Oswald]] the week he took the post. It is shorter and plainer than the one [[Aldric Vane]] carried, on Iselde's specific instruction.",
	sections: [
		{
			heading: 'Provenance',
			body: 'Cut from the same oak as every baton since the Watch was founded, which is either tradition or an excuse not to buy new wood, depending which sergeant you ask.'
		}
	],
	tags: ['watch', 'item', 'symbol-of-office'],
	kankaSubtype: 'Item',
	worldAnvilTemplate: 'item'
};

const theFrostMarket: WorldEntity = {
	slug: 'the-frost-market',
	type: 'place',
	name: 'The Frost Market',
	aliases: [],
	language: 'en',
	lead: "A market that only exists once [[The Sable Reach]] has properly thawed, three weeks of stalls along [[The Bell Quarter]]'s waterfront selling whatever the ice kept back all winter.",
	sections: [
		{
			heading: 'This year',
			body: 'Later than usual and thinner than usual, which everyone blames on [[The Thaw]] without agreeing on why.'
		}
	],
	tags: ['seasonal', 'bell-quarter', 'market'],
	kankaSubtype: 'Landmark',
	worldAnvilTemplate: 'settlement'
};

const pellAshcombe: WorldEntity = {
	slug: 'pell-ashcombe',
	type: 'character',
	name: 'Pell Ashcombe',
	aliases: ['the new boy'],
	language: 'en',
	lead: "The newest sworn name on [[The Valdoria Watch]]'s roster, assigned to [[Sera Voss]] because nobody else had room for him. He asks more questions than a first-month recruit should, which [[Bryn Oswald]] has decided to allow for now.",
	sections: [],
	tags: ['watch', 'recruit', 'new'],
	kankaSubtype: 'NPC',
	worldAnvilTemplate: 'person'
};

const V2_ENTITIES: WorldEntity[] = [
	aldricVane,
	motherSennah,
	corvinAshe,
	iseldeWrennV2,
	brynOswald,
	seraVossV2,
	dagnyHolt,
	ezioConti,
	pellAshcombe,
	valdoriaV2,
	ilRattoDorato,
	cairnmouth,
	theSableReach,
	theCisternQuarter,
	theBellQuarter,
	ilMoloVecchio,
	theLanternQuarter,
	theFrostMarket,
	theAshenLedger,
	theValdoriaWatchV2,
	laCasaDeiMercanti,
	laCriccaDelMoloV2,
	smugglersLedger,
	theBrackishHand,
	harbourSeal,
	cassaforteDellaCasa,
	captainsBaton,
	theSableWinter,
	theThaw,
	theDrowningAtTheOldWharfV2,
	session2,
	session3,
	session4,
	session5
];

const seraVossLocatedInCistern = rel('sera-voss', 'located in', 'the-cistern-quarter');
const seraVossLocatedInBell = rel('sera-voss', 'located in', 'the-bell-quarter');
const iseldeAppointedAldric = rel('iselde-wrenn', 'appointed', 'aldric-vane');
const iseldeEmploysAldric = rel('iselde-wrenn', 'employs', 'aldric-vane');
const iseldeAllyBryn = rel('iselde-wrenn', 'ally of', 'bryn-oswald');
const ledgerAllyCricca = rel('the-ashen-ledger', 'ally of', 'la-cricca-del-molo');

const V2_RELATIONS: WorldRelation[] = [
	rel('the-ashen-ledger', 'employs', 'aldric-vane'),
	rel('aldric-vane', 'member of', 'the-valdoria-watch'),
	rel('the-valdoria-watch', 'located in', 'valdoria'),
	rel('mother-sennah', 'owns', 'the-gilded-rat'),
	rel('the-ashen-ledger', 'employs', 'corvin-ashe'),
	rel('la-casa-dei-mercanti', 'located in', 'valdoria'),
	rel('smugglers-ledger', 'located in', 'valdoria'),
	rel('bryn-oswald', 'commands', 'the-valdoria-watch'),
	rel('iselde-wrenn', 'appointed', 'bryn-oswald'),
	rel('bryn-oswald', 'member of', 'the-valdoria-watch'),
	rel('sera-voss', 'member of', 'the-valdoria-watch'),
	rel('the-ashen-ledger', 'employs', 'dagny-holt'),
	rel('la-casa-dei-mercanti', 'owns', 'cassaforte-della-casa'),
	rel('ezio-conti', 'member of', 'la-casa-dei-mercanti'),
	rel('la-cricca-del-molo', 'owns', 'the-brackish-hand'),
	rel('the-brackish-hand', 'located in', 'il-molo-vecchio'),
	rel('iselde-wrenn', 'owns', 'harbour-seal'),
	rel('the-sable-winter', 'located in', 'the-sable-reach'),
	rel('the-thaw', 'located in', 'the-sable-reach'),
	rel('the-drowning-at-the-old-wharf', 'located in', 'the-bell-quarter'),
	rel('corvin-ashe', 'located in', 'the-lantern-quarter'),
	rel('dagny-holt', 'located in', 'the-cistern-quarter'),
	rel('bryn-oswald', 'located in', 'the-lantern-quarter'),
	rel('iselde-wrenn', 'located in', 'il-molo-vecchio'),
	rel('la-cricca-del-molo', 'located in', 'the-bell-quarter'),
	rel('ezio-conti', 'located in', 'the-lantern-quarter'),
	iseldeEmploysAldric,
	seraVossLocatedInBell,
	iseldeAllyBryn,
	ledgerAllyCricca
];

export const worldV2: World = {
	id: 'valdoria-reach',
	name: 'Valdoria Reach',
	revision: 'v2',
	entities: V2_ENTITIES,
	relations: V2_RELATIONS
};

// ---------------------------------------------------------------------------------------------
// CHANGE_MANIFEST: the v1 -> v2 diff as data, exactly true of worldV1 and worldV2 above.
// ---------------------------------------------------------------------------------------------

export interface ChangeManifest {
	unchanged: string[];
	changedAtSource: string[];
	renamed: Array<{ slug: string; fromName: string; toName: string }>;
	added: string[];
	removedFromSource: string[];
	relationsAdded: string[];
	relationsRemoved: string[];
	relationsRelabelled: Array<{ from: string; to: string }>;
}

export const CHANGE_MANIFEST: ChangeManifest = {
	unchanged: [
		'aldric-vane',
		'mother-sennah',
		'corvin-ashe',
		'cairnmouth',
		'the-ashen-ledger',
		'the-sable-winter',
		'la-casa-dei-mercanti',
		'smugglers-ledger',
		'the-sable-reach',
		'the-cistern-quarter',
		'the-bell-quarter',
		'il-molo-vecchio',
		'bryn-oswald',
		'dagny-holt',
		'ezio-conti',
		'the-brackish-hand',
		'harbour-seal',
		'cassaforte-della-casa',
		'the-thaw',
		'session-2',
		'session-3',
		'session-4',
		'the-lantern-quarter'
	],
	changedAtSource: [
		'iselde-wrenn',
		'valdoria',
		'the-valdoria-watch',
		'sera-voss',
		'the-drowning-at-the-old-wharf',
		'la-cricca-del-molo'
	],
	renamed: [{ slug: 'the-gilded-rat', fromName: 'The Gilded Rat', toName: 'Il Ratto Dorato' }],
	added: ['session-5', 'captains-baton', 'the-frost-market', 'pell-ashcombe'],
	removedFromSource: ['the-drowned-concord', 'session-1'],
	relationsAdded: [
		`${seraVossLocatedInBell.from}|${seraVossLocatedInBell.label}|${seraVossLocatedInBell.to}`,
		`${iseldeAllyBryn.from}|${iseldeAllyBryn.label}|${iseldeAllyBryn.to}`,
		`${ledgerAllyCricca.from}|${ledgerAllyCricca.label}|${ledgerAllyCricca.to}`
	],
	relationsRemoved: [
		`${seraVossLocatedInCistern.from}|${seraVossLocatedInCistern.label}|${seraVossLocatedInCistern.to}`
	],
	// No `dismissed` label exists in the shipped catalogue (see the header comment). I relabel
	// iselde-wrenn|appointed|aldric-vane to iselde-wrenn|employs|aldric-vane rather than dropping it,
	// per Main's guidance, and I made it honest rather than a bare label swap: iseldeWrennV2's "An old
	// arrangement" section establishes she now quietly pays Aldric for what he remembers of the old
	// rosters, distinct from - and in addition to - the Ashen Ledger's own, separate employs edge to
	// him.
	relationsRelabelled: [
		{
			from: `${iseldeAppointedAldric.from}|${iseldeAppointedAldric.label}|${iseldeAppointedAldric.to}`,
			to: `${iseldeEmploysAldric.from}|${iseldeEmploysAldric.label}|${iseldeEmploysAldric.to}`
		}
	]
};
