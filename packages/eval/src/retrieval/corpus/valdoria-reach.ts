/**
 * The retrieval gold corpus (issue #63), seeded from the same Valdoria Reach fixture as
 * the propagation corpus so the questions are real prose, not lorem ipsum, and answerable
 * against text a developer can read in `packages/db/src/seed-fixture.ts`. Chunked with
 * `chunkEntity` (the same split every entity in the fixture gets), so the gold chunk ids
 * are stable and answerable by inspection.
 */
import { valdoriaReach as propagationValdoriaReach } from '../../propagation/corpus/valdoria-reach.js';
import type { RetrievalCorpus } from '../types.js';
import { chunkEntity } from './chunk.js';

const chunks = propagationValdoriaReach.entities.flatMap((entity) => chunkEntity(entity));

export const valdoriaReachRetrieval: RetrievalCorpus = {
	id: 'valdoria-reach',
	name: 'Valdoria Reach',
	chunks,
	questions: [
		{
			id: 'who-keeps-the-gilded-rat',
			question: 'Who keeps the Gilded Rat?',
			relevantChunkIds: ['the-gilded-rat#0', 'mother-sennah#0']
		},
		{
			id: 'why-was-aldric-dismissed',
			question: 'Why was Aldric Vane dismissed from the watch?',
			relevantChunkIds: ['aldric-vane#0']
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
			question: 'How many sworn does the Valdoria Watch have?',
			relevantChunkIds: ['the-valdoria-watch#0', 'valdoria#1']
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
		}
	]
};
