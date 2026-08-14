/**
 * Impact candidates from graph and retrieval (issue #49, SPEC.md §5.1 step 2): "graph
 * neighbours within 2 hops, plus retrieval over mentions and embeddings."
 *
 * Deterministic and pure over an in-memory graph snapshot, on purpose: this is the exact
 * signature `packages/eval`'s `CandidateSelector` wants (see `eval-adapter.ts`), so the
 * harness in issue #99 scores the real algorithm, not a stand-in for it. The DB-backed
 * loader that turns a universe into this shape lives in `db-graph.ts`; nothing in this
 * file touches `@canonry/db`.
 *
 * Four sources feed the pool, and all four matter for recall - a fixture case in
 * `packages/eval`'s corpus (`valdoria-reach`'s "gilded-rat-turns-away-collectors") only
 * reaches Aldric Vane through a *reverse* mention: his own body links to the Gilded Rat,
 * the entity that changed, even though no formal `relation` row connects them at all.
 * Graph hops alone would miss him entirely.
 */
import { splitIntoSentences, type FactChange } from './diff.js';

export interface GraphEntity {
	id: string;
	type: string;
	name: string;
	aliases: string[];
	body: string;
}

export interface GraphRelationEdge {
	fromId: string;
	toId: string;
	label: string;
}

/** An in-memory snapshot of one universe's canon graph, small enough to hold in memory
 * whole - the same shape `packages/eval`'s `PropagationWorld` already uses, and the shape
 * `db-graph.ts` builds from Postgres for real universes. */
export interface CandidateGraph {
	entities: GraphEntity[];
	relations: GraphRelationEdge[];
}

export interface RelationEvidence {
	kind: 'relation';
	hops: number;
	/** Relation labels travelled from the edited entity to this candidate, one per hop. */
	path: string[];
}

export interface MentionEvidence {
	kind: 'mention';
	/** 'forward': the candidate is named in the edit's new text. 'reverse': the candidate's
	 * own (unedited) body already names the entity that just changed - the connection SPEC
	 * calls "retrieval over mentions" and a formal relation would miss. */
	direction: 'forward' | 'reverse';
	matchedText: string;
	/** Guardrail 3's evidence: the exact sentence carrying the mention. */
	sourceSentence: string;
}

export interface EmbeddingEvidence {
	kind: 'embedding';
	similarity: number;
	sourceSentence: string;
}

export type CandidateEvidence = RelationEvidence | MentionEvidence | EmbeddingEvidence;

export interface CandidateEntry {
	entityId: string;
	/** Every path that surfaced this candidate - an entity found two ways (e.g. named
	 * directly *and* one relation hop away) carries two entries, and both feed the score. */
	evidence: CandidateEvidence[];
	/** Base relevance, before issue #56's reject-history adjustment. */
	score: number;
}

const MAX_HOPS = 2;
const RELATION_HOP_SCORE: Record<number, number> = { 1: 1, 2: 0.5 };
const FORWARD_MENTION_SCORE = 1;
const REVERSE_MENTION_SCORE = 0.8;
const EMBEDDING_WEIGHT = 0.6;

function buildAdjacency(
	relations: GraphRelationEdge[]
): Map<string, Array<{ toId: string; label: string }>> {
	const adjacency = new Map<string, Array<{ toId: string; label: string }>>();
	const add = (fromId: string, toId: string, label: string): void => {
		const edges = adjacency.get(fromId);
		if (edges) edges.push({ toId, label });
		else adjacency.set(fromId, [{ toId, label }]);
	};
	for (const rel of relations) {
		// Relations are undirected for reachability purposes here - candidate-finding cares
		// whether two entities are connected at all, not which end declared the relation.
		add(rel.fromId, rel.toId, rel.label);
		add(rel.toId, rel.fromId, rel.label);
	}
	return adjacency;
}

/** BFS to `maxHops`, shortest path only: the first time a node is reached fixes its hop
 * count and the label path travelled, exactly as SPEC.md §5.1's "2 hops" is meant to be
 * read (fewest relations away, not every walk of length 2). Exported for `audit.ts`:
 * SPEC.md §5.2's "sub-graph touched by recent edits" is propagation's own impact radius,
 * not a second one audit should compute differently. */
export function graphNeighbors(
	graph: CandidateGraph,
	startId: string,
	maxHops: number
): Map<string, { hops: number; path: string[] }> {
	const adjacency = buildAdjacency(graph.relations);
	const visited = new Map<string, { hops: number; path: string[] }>();
	visited.set(startId, { hops: 0, path: [] });
	let frontier: Array<{ id: string; path: string[] }> = [{ id: startId, path: [] }];

	for (let hop = 1; hop <= maxHops; hop++) {
		const next: Array<{ id: string; path: string[] }> = [];
		for (const node of frontier) {
			for (const edge of adjacency.get(node.id) ?? []) {
				if (visited.has(edge.toId)) continue;
				const path = [...node.path, edge.label];
				visited.set(edge.toId, { hops: hop, path });
				next.push({ id: edge.toId, path });
			}
		}
		frontier = next;
	}

	visited.delete(startId);
	return visited;
}

/** Exported for `ask.ts` and `audit.ts`: any entity's searchable names are its canonical
 * name plus its aliases, not something either file should reimplement. */
export function namesFor(entity: GraphEntity): string[] {
	return [entity.name, ...entity.aliases].filter((name) => name.trim().length > 0);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface MentionHit {
	entity: GraphEntity;
	matchedText: string;
}

/** Every entity from `pool` that `sentence` names, as a `[[wikilink]]` or as a bare
 * case-insensitive whole-phrase match. One hit per entity per sentence is enough evidence,
 * even if both its name and an alias happen to match. Exported for `audit.ts`: a flag's
 * candidate pairs are found the same way a propagation candidate is (SPEC.md §5.2's
 * "sub-graph touched by recent edits" is propagation's own impact radius). */
export function mentionsIn(sentence: string, pool: GraphEntity[]): MentionHit[] {
	const results: MentionHit[] = [];
	for (const entity of pool) {
		for (const name of namesFor(entity)) {
			const escaped = escapeRegExp(name);
			const wikilinkRe = new RegExp(`\\[\\[\\s*${escaped}\\s*\\]\\]`, 'i');
			const plainRe = new RegExp(`(?:^|[^\\w])${escaped}(?:$|[^\\w])`, 'i');
			if (wikilinkRe.test(sentence) || plainRe.test(sentence)) {
				results.push({ entity, matchedText: name });
				break;
			}
		}
	}
	return results;
}

export interface EmbeddingMatch {
	entityId: string;
	similarity: number;
	sourceSentence: string;
}

export interface BuildCandidatePoolOptions {
	maxHops?: number;
	/** Pre-fetched Qdrant hits, when the caller has a vector search wired in. Optional and
	 * additive: `packages/vector` does not exist yet (parallel wave), and graph plus mention
	 * retrieval alone is a complete, correct candidate source without it - this is an
	 * enrichment seam, not a stub standing in for missing behaviour. See `findCandidates` in
	 * `propagate.ts` for where a real caller supplies it. */
	embeddingMatches?: EmbeddingMatch[];
}

/** The candidate pool for one edit (issue #49): graph neighbours within `maxHops`
 * (default 2), entities the edit's new/changed text names, entities that already mention
 * the one that changed, and any embedding hits the caller supplied. Pure and
 * database-free - `entityId` is whatever id space `graph` uses (a slug in
 * `packages/eval`'s corpus, a UUID for a real universe). */
export function buildCandidatePool(
	graph: CandidateGraph,
	editedEntityId: string,
	diff: FactChange[],
	options: BuildCandidatePoolOptions = {}
): CandidateEntry[] {
	const maxHops = options.maxHops ?? MAX_HOPS;
	const byId = new Map(graph.entities.map((entity) => [entity.id, entity]));
	const editedEntity = byId.get(editedEntityId);
	if (!editedEntity) {
		throw new Error(`buildCandidatePool: unknown edited entity "${editedEntityId}"`);
	}

	const entries = new Map<string, CandidateEntry>();
	const ensure = (id: string): CandidateEntry => {
		const existing = entries.get(id);
		if (existing) return existing;
		const created: CandidateEntry = { entityId: id, evidence: [], score: 0 };
		entries.set(id, created);
		return created;
	};

	// 1. Graph neighbours within maxHops.
	for (const [id, info] of graphNeighbors(graph, editedEntityId, maxHops)) {
		if (!byId.has(id)) continue;
		const entry = ensure(id);
		entry.evidence.push({ kind: 'relation', hops: info.hops, path: info.path });
		entry.score += RELATION_HOP_SCORE[info.hops] ?? 0;
	}

	// 2. Forward mention: who does the edit's new/changed text name?
	const freshSentences = diff
		.filter((change) => change.kind === 'added' || change.kind === 'changed')
		.map((change) => change.statement);
	const othersPool = graph.entities.filter((entity) => entity.id !== editedEntityId);
	for (const sentence of freshSentences) {
		for (const { entity, matchedText } of mentionsIn(sentence, othersPool)) {
			const entry = ensure(entity.id);
			entry.evidence.push({
				kind: 'mention',
				direction: 'forward',
				matchedText,
				sourceSentence: sentence
			});
			entry.score += FORWARD_MENTION_SCORE;
		}
	}

	// 3. Reverse mention: which other entities already talk about the one that changed?
	for (const other of othersPool) {
		for (const sentence of splitIntoSentences(other.body)) {
			for (const { matchedText } of mentionsIn(sentence, [editedEntity])) {
				const entry = ensure(other.id);
				entry.evidence.push({
					kind: 'mention',
					direction: 'reverse',
					matchedText,
					sourceSentence: sentence
				});
				entry.score += REVERSE_MENTION_SCORE;
			}
		}
	}

	// 4. Embeddings, when the caller supplied any.
	for (const match of options.embeddingMatches ?? []) {
		if (match.entityId === editedEntityId || !byId.has(match.entityId)) continue;
		const entry = ensure(match.entityId);
		entry.evidence.push({
			kind: 'embedding',
			similarity: match.similarity,
			sourceSentence: match.sourceSentence
		});
		entry.score += match.similarity * EMBEDDING_WEIGHT;
	}

	return Array.from(entries.values());
}
