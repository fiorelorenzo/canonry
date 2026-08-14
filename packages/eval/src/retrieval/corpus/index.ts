import { valdoriaReachRetrieval } from './valdoria-reach.js';
import type { RetrievalCorpus } from '../types.js';

export { valdoriaReachRetrieval };

/** Every corpus available to the retrieval harness, in a fixed order. */
export const retrievalCorpora: RetrievalCorpus[] = [valdoriaReachRetrieval];
