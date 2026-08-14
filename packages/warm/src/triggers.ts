/**
 * SPEC.md §8.1: five triggers, deliberately priced differently. Each one only decides
 * *which* candidates exist and in what order to attempt them (via `sortByDegradationOrder`
 * from ./budget.js); `regenerate` (./store.js) is what actually checks freshness, spends
 * the budget and calls the generator, so "if not already fresh" and "within the remaining
 * budget" fall out of that shared function rather than being reimplemented five times.
 */
import {
	activeUniverseIds,
	pinnedNeighbors,
	staleArtifacts,
	type Db,
	type WarmArtifactRow
} from '@canonry/db';
import { universe } from '@canonry/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { WarmBudgetPort } from './budget.js';
import { sortByDegradationOrder } from './budget.js';
import { currentWarmRadius } from './radius.js';
import {
	regenerate,
	type RegenerateResult,
	type WarmCandidate,
	type WarmGenerator
} from './store.js';

/** SPEC.md guardrail 4 / issue #107: "the switch stops generation... anything a model
 * writes" - warming is exactly that, and the artifact's own rejected section is explicit
 * that a background job filling the cache while the switch reads "off" is the same trust
 * break as a silent accept-all. Every trigger below checks this first, before building a
 * single candidate, so a switched-off universe never reaches `regenerate` at all. */
export class AiDisabledError extends Error {
	constructor(universeId: string) {
		super(
			`universe "${universeId}" has generation switched off (guardrail 4); warming does not run`
		);
		this.name = 'AiDisabledError';
	}
}

async function requireAiEnabled(db: Db, universeId: string): Promise<void> {
	const [row] = await db
		.select({ aiEnabled: universe.aiEnabled })
		.from(universe)
		.where(eq(universe.id, universeId))
		.limit(1);
	if (!row) throw new Error(`no universe row for id "${universeId}"`);
	if (!row.aiEnabled) throw new AiDisabledError(universeId);
}

/** `warmNightly` spans every active universe in one call, so one switched-off universe
 * has to drop out of that run rather than fail the whole nightly sweep - the other four
 * triggers each belong to a single universe's own request and throw instead. */
async function aiEnabledUniverseIds(db: Db, universeIds: string[]): Promise<string[]> {
	if (universeIds.length === 0) return [];
	const rows = await db
		.select({ id: universe.id })
		.from(universe)
		.where(and(inArray(universe.id, universeIds), eq(universe.aiEnabled, true)));
	return rows.map((row) => row.id);
}

async function runBatch(
	db: Db,
	candidates: WarmCandidate[],
	generator: WarmGenerator,
	budget: WarmBudgetPort
): Promise<RegenerateResult[]> {
	const results: RegenerateResult[] = [];
	for (const candidate of sortByDegradationOrder(candidates)) {
		results.push(await regenerate(db, candidate, generator, budget));
	}
	return results;
}

// -----------------------------------------------------------------------------------------
// Trigger 1: on write, ~60s debounce - cheap text only
// -----------------------------------------------------------------------------------------

export interface WriteDebounceOptions {
	/** Default 60_000ms, per SPEC §8.1's "~60s debounce". */
	delayMs?: number;
}

/** Coalesces a burst of edits to the same entity into one warm run after `delayMs` of
 * quiet, so an hour of editing a faction produces one write-trigger run at the end, not
 * forty. Framework-free: the caller wires `schedule` to its own edit-save path and
 * provides the `fire` callback (typically `warmOnWrite`), which keeps this class testable
 * with fake timers and reusable outside a web request lifecycle. */
export class WriteDebounce {
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly delayMs: number;

	constructor(options: WriteDebounceOptions = {}) {
		this.delayMs = options.delayMs ?? 60_000;
	}

	schedule(entityId: string, fire: () => void): void {
		clearTimeout(this.timers.get(entityId));
		this.timers.set(
			entityId,
			setTimeout(() => {
				this.timers.delete(entityId);
				fire();
			}, this.delayMs)
		);
	}

	cancel(entityId: string): void {
		clearTimeout(this.timers.get(entityId));
		this.timers.delete(entityId);
	}

	get pendingCount(): number {
		return this.timers.size;
	}
}

export interface WriteWarmInput {
	universeId: string;
	entityId: string;
	promptVersion: string;
	modelId: string;
	briefCredits: number;
	contextPackCredits: number;
}

/** "The GM just thought about this place, so use is likely and cost is negligible": a
 * two-line brief and a context pack, both cheap text, both scoped to the one entity that
 * was just saved. */
export async function warmOnWrite(
	db: Db,
	input: WriteWarmInput,
	generator: WarmGenerator,
	budget: WarmBudgetPort
): Promise<RegenerateResult[]> {
	await requireAiEnabled(db, input.universeId);
	const candidates: WarmCandidate[] = [
		{
			universeId: input.universeId,
			kind: 'brief',
			subjectEntityId: input.entityId,
			sourceEntityIds: [input.entityId],
			promptVersion: input.promptVersion,
			modelId: input.modelId,
			credits: input.briefCredits
		},
		{
			universeId: input.universeId,
			kind: 'context_pack',
			subjectEntityId: input.entityId,
			sourceEntityIds: [input.entityId],
			promptVersion: input.promptVersion,
			modelId: input.modelId,
			credits: input.contextPackCredits
		}
	];
	return runBatch(db, candidates, generator, budget);
}

// -----------------------------------------------------------------------------------------
// Trigger 2: on prep - the expensive material
// -----------------------------------------------------------------------------------------

const DEFAULT_NPC_DRAFTS_PER_PLACE = 3;

export interface PrepWarmInput {
	universeId: string;
	/** Places the work/session is expected to visit. */
	expectedPlaceEntityIds: string[];
	/** NPCs already pinned (e.g. by an earlier session_context) that still need a
	 * portrait. */
	pinnedNpcEntityIds: string[];
	promptVersion: string;
	modelId: string;
	npcDraftCredits: number;
	ambientPackCredits: number;
	portraitCredits: number;
	/** Default 3, per SPEC §8.1's "3 NPC drafts per expected place". */
	npcDraftsPerPlace?: number;
}

/** "It is declared, it is asynchronous by nature, and it is the only moment the GM accepts
 * waiting": npc_draft candidates land in `proposal` as `draft_entity` (store.ts), never as
 * an `entity` - the GM still has to accept each one. Each slot gets its own fingerprint
 * (the prompt version is suffixed per slot) so three drafts for the same place do not
 * collide on the (kind, subject, fingerprint) unique index. */
export async function warmOnPrep(
	db: Db,
	input: PrepWarmInput,
	generator: WarmGenerator,
	budget: WarmBudgetPort
): Promise<RegenerateResult[]> {
	await requireAiEnabled(db, input.universeId);
	const slots = input.npcDraftsPerPlace ?? DEFAULT_NPC_DRAFTS_PER_PLACE;
	const candidates: WarmCandidate[] = [];

	for (const placeId of input.expectedPlaceEntityIds) {
		for (let slot = 1; slot <= slots; slot += 1) {
			candidates.push({
				universeId: input.universeId,
				kind: 'npc_draft',
				subjectEntityId: placeId,
				sourceEntityIds: [placeId],
				promptVersion: `${input.promptVersion}#npc-slot-${slot}`,
				modelId: input.modelId,
				credits: input.npcDraftCredits,
				rationale: `Prep drafted a candidate NPC for this place (slot ${slot} of ${slots}).`
			});
		}
		candidates.push({
			universeId: input.universeId,
			kind: 'ambient_pack',
			subjectEntityId: placeId,
			sourceEntityIds: [placeId],
			promptVersion: input.promptVersion,
			modelId: input.modelId,
			credits: input.ambientPackCredits
		});
	}

	for (const npcId of input.pinnedNpcEntityIds) {
		candidates.push({
			universeId: input.universeId,
			kind: 'portrait',
			subjectEntityId: npcId,
			sourceEntityIds: [npcId],
			promptVersion: input.promptVersion,
			modelId: input.modelId,
			credits: input.portraitCredits
		});
	}

	return runBatch(db, candidates, generator, budget);
}

// -----------------------------------------------------------------------------------------
// Trigger 3: on opening table mode - ring 1, if not already fresh
// -----------------------------------------------------------------------------------------

export interface TableOpenWarmInput {
	universeId: string;
	placeEntityId: string;
	promptVersion: string;
	modelId: string;
	briefCredits: number;
	contextPackCredits: number;
}

/** "Safety net for the improvised session": a context pack spanning the current place and
 * its immediate (1-hop) neighbors, plus a brief for each of those neighbors individually.
 * "If not already fresh" needs no extra branch here - `regenerate` already returns
 * `status: 'fresh'` without spending or generating when the stored fingerprint still
 * matches. */
export async function warmOnTableOpen(
	db: Db,
	input: TableOpenWarmInput,
	generator: WarmGenerator,
	budget: WarmBudgetPort
): Promise<RegenerateResult[]> {
	await requireAiEnabled(db, input.universeId);
	const ring1 = await pinnedNeighbors(db, input.placeEntityId, { hops: 1 });
	const ring1Ids = ring1.map((neighbor) => neighbor.entity.id);

	const candidates: WarmCandidate[] = [
		{
			universeId: input.universeId,
			kind: 'context_pack',
			subjectEntityId: input.placeEntityId,
			sourceEntityIds: [input.placeEntityId, ...ring1Ids],
			promptVersion: input.promptVersion,
			modelId: input.modelId,
			credits: input.contextPackCredits
		},
		...ring1.map((neighbor): WarmCandidate => ({
			universeId: input.universeId,
			kind: 'brief',
			subjectEntityId: neighbor.entity.id,
			sourceEntityIds: [neighbor.entity.id],
			promptVersion: input.promptVersion,
			modelId: input.modelId,
			credits: input.briefCredits
		}))
	];

	return runBatch(db, candidates, generator, budget);
}

// -----------------------------------------------------------------------------------------
// Trigger 4: on consumption (rolling) - warms the next ring
// -----------------------------------------------------------------------------------------

export interface ConsumptionWarmInput {
	universeId: string;
	/** The place the party just entered. */
	enteredPlaceEntityId: string;
	promptVersion: string;
	modelId: string;
	briefCredits: number;
}

/** "You only pay where the party is actually going": brief-only (cheap) candidates for
 * exactly the ring *beyond* what trigger 3 already covers. The ring itself is not fixed at
 * hop 2 - issue #102's governor (radius.ts) picks 1 or 2 from this universe's current warm
 * hit rate, so a universe whose warmed material keeps going unconsumed pulls back to the
 * safety net's own ring 1 instead of continuing to speculate two hops out. Never hop 1
 * *again* when the radius is 2, and never the expensive kinds trigger 2 reserves for
 * declared prep, either way. */
export async function warmOnConsumption(
	db: Db,
	input: ConsumptionWarmInput,
	generator: WarmGenerator,
	budget: WarmBudgetPort
): Promise<RegenerateResult[]> {
	await requireAiEnabled(db, input.universeId);
	const { radius } = await currentWarmRadius(db, input.universeId);
	const ring = await pinnedNeighbors(db, input.enteredPlaceEntityId, { hops: radius });
	const nextRing = ring.filter((neighbor) => neighbor.hopDistance === radius);

	const candidates: WarmCandidate[] = nextRing.map((neighbor) => ({
		universeId: input.universeId,
		kind: 'brief',
		subjectEntityId: neighbor.entity.id,
		sourceEntityIds: [neighbor.entity.id],
		promptVersion: input.promptVersion,
		modelId: input.modelId,
		credits: input.briefCredits
	}));

	return runBatch(db, candidates, generator, budget);
}

// -----------------------------------------------------------------------------------------
// Trigger 5: nightly - universes active in the last N days
// -----------------------------------------------------------------------------------------

export interface NightlyWarmInput {
	sinceDays: number;
	promptVersion: string;
	modelId: string;
	/** packages/warm never prices anything (SPEC §15: prices live in `operation_price`);
	 * the caller resolves each stale artifact's price the same way any other chargeable
	 * operation does. */
	creditsFor: (artifact: WarmArtifactRow) => number;
}

/** `warm_artifact` stores a fingerprint, not the entity id set that produced it, so
 * recomposing a stale row needs its source set rebuilt from what the row itself still
 * carries: a `context_pack`'s sources are its subject plus that subject's 1-hop ring
 * (recomputed exactly as `warmOnTableOpen` computed it originally); every other kind's
 * source is just its own subject entity. */
async function sourceEntityIdsForStaleArtifact(
	db: Db,
	artifact: WarmArtifactRow
): Promise<string[]> {
	if (artifact.subjectEntityId === null) {
		throw new Error(
			`warmNightly: artifact ${artifact.id} has no subject entity, so its source set cannot be recomputed`
		);
	}
	if (artifact.kind !== 'context_pack') return [artifact.subjectEntityId];

	const ring1 = await pinnedNeighbors(db, artifact.subjectEntityId, { hops: 1 });
	return [artifact.subjectEntityId, ...ring1.map((neighbor) => neighbor.entity.id)];
}

/** "Recomposes what went stale, within the remaining budget": one batch per active
 * universe, each batch limited to that universe's currently stale artifacts and run through
 * the same degradation-ordered `regenerate` as every other trigger, so a universe with more
 * drift than budget degrades exactly as trigger 2 or 4 would mid-session. */
export async function warmNightly(
	db: Db,
	input: NightlyWarmInput,
	generator: WarmGenerator,
	budget: WarmBudgetPort
): Promise<Map<string, RegenerateResult[]>> {
	const activeIds = await activeUniverseIds(db, input.sinceDays);
	const universeIds = await aiEnabledUniverseIds(db, activeIds);
	const results = new Map<string, RegenerateResult[]>();

	for (const universeId of universeIds) {
		const stale = await staleArtifacts(db, universeId);
		const candidates: WarmCandidate[] = [];
		for (const artifact of stale) {
			candidates.push({
				universeId,
				kind: artifact.kind,
				subjectEntityId: artifact.subjectEntityId,
				sourceEntityIds: await sourceEntityIdsForStaleArtifact(db, artifact),
				promptVersion: input.promptVersion,
				modelId: input.modelId,
				credits: input.creditsFor(artifact)
			});
		}
		results.set(universeId, await runBatch(db, candidates, generator, budget));
	}

	return results;
}
