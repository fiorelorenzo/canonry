/**
 * Ask proposes (issue #256, SPEC.md §5's Ask row, guardrail 1): the two tools
 * `apps/web`'s Ask route wires onto the conversational model, and the only place in
 * this package that turns a conversational instruction into new canon content - as a
 * proposal, never a write. `entryPropose` and `entryEditPropose` are plain functions
 * so they are testable exactly like `completeEntry`, which this module mirrors closely:
 * a `createProposalPlan` + `recordProposalDiff` pair, nothing else touches `entity` or
 * `revision`. `acceptProposal` (`@canonry/db`) stays the only code that ever writes a
 * revision from a proposal; see that file's own header comment ("this module is the
 * exclusive writer of canon from a proposal") for the boundary this package never
 * crosses.
 *
 * Guardrail 6 ("refuse rather than invent") is enforced by lookup, not by asking the
 * model to decide: `findExactEntity` checks a case-insensitive exact match on name or
 * alias before either tool drafts anything, and a miss (for an edit) or a hit (for a
 * create) redirects to the other tool's own drafting path rather than editing whatever
 * `searchEntitiesByNameOrAlias` ranked first. A GM who asks to edit "the harbour
 * district" when only "Cairnmouth harbour" exists gets a *new* entry proposed, not a
 * silent edit to Cairnmouth.
 *
 * Guardrail 3's evidence (issue #270): what produced an Ask-originated draft is the GM's
 * own request, so that is what the evidence carries, verbatim, as an
 * `InstructionEvidence` item. Ask's layer-1 retrieval (`ask.ts`'s `searchOwnCanon`) is
 * scored against the whole conversational instruction rather than a targeted query, so
 * its top-k is context at best and never a citation on its own: a retrieved sentence
 * becomes evidence only when the drafting model names it in `usedSources` (validated by
 * `selectEvidence` against the exact numbered list it was handed) *and* the entry it came
 * from is actually named by the GM's request or by the text this draft produces
 * (`namesEntityIn`). No similarity floor, because a number cannot do this job: the three
 * sentences in #270's report scored 0.105, 0.103 and 0.067, so any threshold that keeps
 * the one real link also keeps the Casa dei Mercanti's bookkeeping rule. What separates
 * them is that one of them is about an entry the GM named and the other is not.
 *
 * When no retrieved sentence clears that, `evidence` carries the instruction alone and
 * `NO_CANON_EVIDENCE_NOTE` (speech.ts) says so in the rationale, rather than leaving a
 * reviewer to guess whether the field was simply never filled in.
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import { chargeFor, resolveModel, withQuota } from '@canonry/ai';
import {
	and,
	createProposalPlan,
	eq,
	recordProposalDiff,
	searchEntitiesByNameOrAlias,
	setProposalPlanStatus,
	type Db,
	type ProposalRow
} from '@canonry/db';
import { entity } from '@canonry/db/schema';
import type { EntityType } from '@canonry/db/schema';
import { canonLanguageFor, type Locale } from '@canonry/lang';
import { namesEntityIn, type CandidateEvidence } from './candidates.js';
import type { EntityUpdatePatch } from './diffs.js';
import type { GatewayWrapper, ModelFactory } from './models.js';
import { routeModel } from './models.js';
import { requireAiEnabled } from './propagate.js';
import { canonInstruction, NO_CANON_EVIDENCE_NOTE, speechInstruction } from './speech.js';

/** The subset of `ask.ts`'s `OwnCanonSource` these tools ground on - a plain structural
 * type rather than importing `OwnCanonSource` itself, so this module and `ask.ts` can
 * import from each other's directions without a cycle (`ask.ts` calls `entryPropose`/
 * `entryEditPropose`; both take whatever `ask.ts` already computed as `sources`). Every
 * `OwnCanonSource` satisfies this shape as-is. Indexed/derived-corpus sources are
 * deliberately excluded: SPEC.md §4.1's "the user's own canon always wins" means an
 * external, licensed page is not something this package writes into a GM's own entries
 * without a human reading it first, and licence attribution has nowhere to live in
 * `proposal.evidence`'s existing shape. */
export interface EvidenceSource {
	entityId: string;
	entityName: string;
	statement: string;
	score: number;
}

const ENTITY_TYPES = ['character', 'place', 'faction', 'item', 'event', 'session'] as const;

/** The GM's own request, verbatim, as one evidence item: for an entry asked for in a
 * sentence the instruction *is* the evidence, and it is the only part of an Ask-originated
 * proposal's provenance that is always true. Kept as its own kind rather than folded into
 * `MentionEvidence` so the review screen can say which of the two a quote is
 * (`apps/web/src/lib/components/proposals/evidence.ts`), and deliberately not added to
 * `CandidateEvidence`: propagation, complete and audit can never produce one, and a dead
 * branch in their switches would be worse than a second name here. */
export interface InstructionEvidence {
	kind: 'instruction';
	instruction: string;
}

/** Everything `proposal.evidence` can carry for an Ask-originated proposal. */
export type AskEvidence = CandidateEvidence | InstructionEvidence;

/** Guardrail 3, storage half: converted straight into the shape
 * `apps/web/src/lib/components/proposals/evidence.ts`'s `normalizeEvidence` already
 * renders for any trigger other than `import`. `kind: 'embedding'` is the honest reading
 * of Ask's own layer-1 retrieval: a Jaccard word-overlap score, not a literal substring
 * mention or a formal graph relation, and that is exactly the "reached only by embedding
 * similarity" case whose evidence the proposal review screen forces open rather than lets
 * a GM skim past. Called only from `selectEvidence` below, never on the full retrieved
 * list - see that function. */
function evidenceFromSources(sources: EvidenceSource[]): CandidateEvidence[] {
	return sources.map((s) => ({
		kind: 'embedding' as const,
		similarity: s.score,
		sourceSentence: s.statement
	}));
}

/** issue #270: two gates, both required, before a retrieved sentence is allowed to read
 * as a citation.
 *
 * First the drafting model names which of the numbered candidates (1-based, matching
 * `renderSourcesForModel`'s own numbering) it actually drew a fact from - never trusted as
 * free text, only as an index into the exact list it was handed, so a hallucinated or
 * out-of-range number silently drops.
 *
 * Then `namedIn` has to name the entry that sentence came from: the GM's own request plus
 * the text this draft produces. That is what tells Mother Sennah's sentence, about the aunt
 * the GM asked for, apart from the Casa dei Mercanti's bookkeeping rule at a
 * near-identical similarity - see this module's header comment on why no threshold can.
 *
 * Nothing left after both gates is not an error: it is the honest "nothing in canon
 * actually informed this" case `NO_CANON_EVIDENCE_NOTE` exists for. */
function selectEvidence(
	sources: EvidenceSource[],
	usedIndices: number[],
	namedIn: string
): CandidateEvidence[] {
	const seen = new Set<number>();
	const selected: EvidenceSource[] = [];
	for (const index of usedIndices) {
		if (!Number.isInteger(index) || index < 1 || index > sources.length || seen.has(index)) {
			continue;
		}
		seen.add(index);
		const source = sources[index - 1]!;
		if (namesEntityIn(namedIn, source.entityName)) selected.push(source);
	}
	return evidenceFromSources(selected);
}

/** The evidence an Ask-originated proposal carries, in reading order: the GM's request
 * first, because that is what caused the draft, then whatever canon survived
 * `selectEvidence`'s two gates as supporting context. */
function askEvidence(request: string, canon: CandidateEvidence[]): AskEvidence[] {
	return [{ kind: 'instruction', instruction: request.trim() }, ...canon];
}

/** issue #270: the rationale a reviewer actually reads (`proposal.rationale`, and the
 * plan's own `summary`) says plainly when nothing in canon backs the draft, rather than
 * leaving the evidence popover to speak for itself - guardrail 3's "make the surface say
 * that", not just "make the field honestly empty". Keyed on the canon evidence alone: the
 * instruction item is always there, so counting it would silence this note forever. */
function rationaleFor(locale: Locale, summary: string, canon: CandidateEvidence[]): string {
	return canon.length > 0 ? summary : `${summary} ${NO_CANON_EVIDENCE_NOTE[locale]}`;
}

/** Guardrail 3, prompt half: richer than what gets persisted (names the source entity,
 * which the stored `CandidateEvidence` shape has no field for) and numbered so the
 * model's `usedSources` answer can point back at a specific one. Retrieved sentences
 * are offered as candidates to weigh, not asserted as relevant - the system prompt says
 * so, and `selectEvidence` above is what actually decides which ones become evidence. */
function renderSourcesForModel(sources: EvidenceSource[]): string {
	if (sources.length === 0) return '(none found)';
	return sources.map((s, i) => `[${i + 1}] ${s.entityName}: "${s.statement}"`).join('\n');
}

function slugify(name: string): string {
	const base = name
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base.length > 0 ? base : 'entry';
}

/** Mirrors `@canonry/db`'s `createEntity`'s own bounded-suffix loop (issue #74's "New
 * entry" dialog): two GMs, or a GM and an existing import, both landing on "Aldric" is a
 * name collision worth resolving here, not a race worth leaving to
 * `entity_universe_slug_key` and `acceptProposal`'s slug-collision fold, which only
 * fires at accept time, possibly long after this proposal was written. */
async function uniqueSlug(db: Db, universeId: string, name: string): Promise<string> {
	const base = slugify(name);
	let slug = base;
	for (let suffix = 2; suffix < 100; suffix += 1) {
		const [existing] = await db
			.select({ id: entity.id })
			.from(entity)
			.where(and(eq(entity.universeId, universeId), eq(entity.slug, slug)))
			.limit(1);
		if (!existing) break;
		slug = `${base}-${suffix}`;
	}
	return slug;
}

interface FullEntity {
	id: string;
	name: string;
	slug: string;
	body: string;
	language: string | null;
}

async function loadEntity(db: Db, id: string): Promise<FullEntity | null> {
	const [row] = await db
		.select({
			id: entity.id,
			name: entity.name,
			slug: entity.slug,
			body: entity.body,
			language: entity.language
		})
		.from(entity)
		.where(eq(entity.id, id))
		.limit(1);
	return row ?? null;
}

/** Guardrail 6's lookup: an exact, case-insensitive match on the entry's own name or one
 * of its aliases - `searchEntitiesByNameOrAlias`'s ranking already puts an exact match
 * first when one exists, but this checks equality itself rather than trusting rank 0
 * blindly, so a fuzzy top hit (e.g. a prefix or substring match) never gets treated as
 * "this already exists" and silently redirects onto the wrong entity. */
async function findExactEntity(db: Db, universeId: string, name: string) {
	const trimmed = name.trim();
	if (!trimmed) return null;
	const hits = await searchEntitiesByNameOrAlias(db, universeId, trimmed, { limit: 5 });
	const lower = trimmed.toLowerCase();
	return (
		hits.find((h) => h.name.toLowerCase() === lower || h.matchedAlias?.toLowerCase() === lower) ??
		null
	);
}

interface DraftContext {
	db: Db;
	userId: string;
	universeId: string;
	locale: Locale;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	sources: EvidenceSource[];
	/** The GM's own message to Ask, verbatim (issue #270): the evidence for a draft asked
	 * for in a sentence, and what `selectEvidence` weighs a retrieved sentence's own entry
	 * against. Not the model's `instruction` argument, which is the model's reading of that
	 * message and would be a paraphrase quoted back to the GM as their own words. */
	request: string;
	requestId?: string;
}

export interface ProposeResult {
	proposal: ProposalRow;
	evidence: AskEvidence[];
	entityName: string;
	entitySlug: string;
	/** Mirrors `proposal.kind` exactly - `'draft_entity'` for a new entry, `'update'` for
	 * an edit to one that already exists. */
	kind: 'draft_entity' | 'update';
	/** True when the tool the GM's turn actually called is not the tool that ran:
	 * `entryPropose` found the name already taken and drafted an edit instead, or
	 * `entryEditPropose` found no matching entry and drafted a new one instead
	 * (guardrail 6). */
	redirected: boolean;
}

// `aliases` has no `.default([])`: OpenAI's structured-output mode requires every
// schema property to be listed in `required`, and Zod's `.default()` drops a field out
// of `required` (the field becomes optional with a client-side fallback instead). Confirmed
// against the real gateway (gpt-5.4, openai/gpt-5.4) - `.default([])` here produced a 400
// "'required' is required to be supplied and to be an array including every key in
// properties. Missing 'aliases'" on every call, which withQuota then reported to the caller
// as a plain thrown error - see entryPropose's own header comment on why a thrown error
// here must never read as a completed proposal.
const newEntitySchema = z.object({
	type: z.enum(ENTITY_TYPES),
	name: z.string().min(1),
	aliases: z.array(z.string()),
	body: z.string().min(1),
	summary: z.string().min(1),
	// issue #270: 1-based indices into the numbered canon candidates the prompt offered,
	// naming only the ones that actually informed this draft - empty when none did. No
	// `.default([])` here either, for the same OpenAI structured-output reason as
	// `aliases` above.
	usedSources: z.array(z.number().int().positive())
});

/** New-entry drafting, reused by both `entryPropose`'s own path and
 * `entryEditPropose`'s redirect when the named entry does not exist yet. Priced and
 * recorded as `entry.complete` (already seeded in `operation_price`): both draft one
 * full entry's worth of prose from evidence, so they share a price rather than this
 * wave adding a migration for a dedicated `ask.propose_entry` row (see this issue's own
 * report for that trade-off). Writes exactly one `draft_entity` proposal and nothing
 * else - no `entity` row, no `revision` row; `acceptProposal` is what turns this into
 * either, later, if a human accepts it. */
async function draftNewEntity(
	ctx: DraftContext,
	name: string,
	instruction: string
): Promise<ProposeResult> {
	// No target entity exists yet, so `canonLanguageFor` has nothing to detect from but
	// the GM's own instruction - the closest thing to "the entry that triggered this
	// change" this call has, per that function's own fallback chain.
	const contentLanguage = canonLanguageFor({ triggerBody: instruction });
	const premiumModel = routeModel(
		await resolveModel(ctx.db, 'premium'),
		ctx.modelFactory,
		ctx.gateway
	);
	const [result, price] = await Promise.all([
		withQuota(
			ctx.db,
			premiumModel.resolved,
			{
				userId: ctx.userId,
				universeId: ctx.universeId,
				agent: 'loremaster',
				operation: 'entry.complete',
				...(ctx.requestId !== undefined
					? { requestId: ctx.requestId, idempotencyKey: ctx.requestId }
					: {})
			},
			() =>
				generateObject({
					model: premiumModel.languageModel,
					schema: newEntitySchema,
					system:
						'You are the Loremaster, drafting a brand new wiki entry for a tabletop RPG world ' +
						'because the GM asked for one in conversation. Choose the entity type from the ' +
						'shipped list. Only use what the instruction below states or the numbered canon ' +
						'candidates support - never invent a detail neither one gives you. The numbered ' +
						'candidates are retrieved by rough word overlap and may have nothing to do with ' +
						'what you are writing; list, in usedSources, only the numbers you actually drew a ' +
						'fact from, or leave it empty if none of them did - never list one just because it ' +
						'is topically nearby. Write the full new entry body and a one-line summary of what ' +
						'you created and why. The summary is addressed to the GM; the entry body is the ' +
						'entry itself - different language rules apply to each, stated separately below. ' +
						speechInstruction(ctx.locale) +
						' ' +
						canonInstruction(contentLanguage),
					prompt:
						`Name: ${name}\n\n` +
						`What the GM said: ${instruction}\n\n` +
						`Candidates retrieved from your own canon, numbered:\n${renderSourcesForModel(ctx.sources)}`
				}),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens ?? 0,
					outputTokens: r.usage.outputTokens ?? 0
				})
			}
		),
		chargeFor(ctx.db, 'entry.complete')
	]);

	const draftedName = result.object.name.trim().length > 0 ? result.object.name : name;
	// The two texts a cited entry has to be named in: what the GM asked for, and the entry
	// this draft produces (issue #270). Mother Sennah is named in both when the GM asks for
	// her nephew; the Casa dei Mercanti is named in neither.
	const canonEvidence = selectEvidence(
		ctx.sources,
		result.object.usedSources,
		`${ctx.request}\n${draftedName}\n${result.object.body}`
	);
	const evidence = askEvidence(ctx.request, canonEvidence);
	const rationale = rationaleFor(ctx.locale, result.object.summary, canonEvidence);
	const slug = await uniqueSlug(ctx.db, ctx.universeId, draftedName);

	const { plan, proposals } = await createProposalPlan(ctx.db, {
		universeId: ctx.universeId,
		// issue #270: `ask` is this plan's own trigger, added to `proposal_trigger` by
		// migration 0040 for exactly this. Borrowing `table` made an Ask-originated proposal
		// indistinguishable from a quick action fired during a session, in a value the
		// evidence popover, the inbox, the plan header and §14's accept rate all read.
		trigger: 'ask',
		// issue #270: never anchor this plan to an entity from `ctx.sources` - that field
		// means "the entity whose edit started this", and a create has no such entity,
		// evidenced or not. Anchoring it to a retrieved source's id is what produced "From:
		// editing Mother Sennah" for an entry Mother Sennah was never touched by.
		triggerEntityId: null,
		summary: rationale,
		candidateCap: 1,
		estimatedCredits: price.credits,
		locale: ctx.locale,
		candidates: [
			{
				kind: 'draft_entity',
				targetEntityId: null,
				rationale,
				evidence,
				rank: 0
			}
		]
	});
	const candidate = proposals[0];
	if (!candidate) throw new Error('draftNewEntity: createProposalPlan returned no candidate');

	const proposal = await recordProposalDiff(ctx.db, {
		proposalId: candidate.id,
		patch: {
			type: result.object.type as EntityType,
			name: draftedName,
			slug,
			aliases: result.object.aliases,
			body: result.object.body
		},
		provider: premiumModel.resolved.provider,
		modelId: premiumModel.resolved.modelId,
		credits: price.credits
	});
	// Plan starts `status: 'ready'` (C3's pre-diff checklist); this proposal's diff
	// already exists, so the plan is spent the moment it is written - otherwise the plan
	// detail route renders `PlanChecklist` (a "generate diffs" button over a candidate
	// that already has one) instead of the accept/reject queue the GM actually needs. The
	// existing table quick-actions/notes proposals share this same gap; see this issue's
	// report.
	await setProposalPlanStatus(ctx.db, plan.id, 'spent');

	return {
		proposal,
		evidence,
		entityName: draftedName,
		entitySlug: slug,
		kind: 'draft_entity',
		redirected: false
	};
}

const entityUpdateSchema = z.object({
	summary: z.string().min(1),
	after: z.string().min(1),
	// issue #270: same self-reported, validated evidence selection as newEntitySchema's
	// own `usedSources` - see selectEvidence's doc comment.
	usedSources: z.array(z.number().int().positive())
});

/** Edit drafting against a real, already-loaded entity, reused by both
 * `entryEditPropose`'s own path and `entryPropose`'s redirect when the requested name
 * already exists. Priced and recorded as `propagate.diff` (already seeded): both draft
 * one targeted update from evidence, so they share a price rather than this wave adding
 * a migration for a dedicated operation row (see this issue's report). Writes exactly
 * one `update` proposal and nothing else. */
async function draftEntityUpdate(
	ctx: DraftContext,
	target: FullEntity,
	instruction: string
): Promise<ProposeResult> {
	const contentLanguage = canonLanguageFor({
		targetLanguage: target.language,
		targetBody: target.body
	});
	const premiumModel = routeModel(
		await resolveModel(ctx.db, 'premium'),
		ctx.modelFactory,
		ctx.gateway
	);
	const [result, price] = await Promise.all([
		withQuota(
			ctx.db,
			premiumModel.resolved,
			{
				userId: ctx.userId,
				universeId: ctx.universeId,
				agent: 'loremaster',
				operation: 'propagate.diff',
				...(ctx.requestId !== undefined
					? { requestId: ctx.requestId, idempotencyKey: ctx.requestId }
					: {})
			},
			() =>
				generateObject({
					model: premiumModel.languageModel,
					schema: entityUpdateSchema,
					system:
						'You are the Loremaster, drafting an update to an existing wiki entry because the ' +
						'GM asked for one in conversation. Write the full new body text, keeping every ' +
						'existing sentence unless it directly conflicts with what the GM said, and add ' +
						'only what the instruction below states or the numbered canon candidates support - ' +
						'never invent a detail neither one gives you. The numbered candidates are retrieved ' +
						'by rough word overlap and may have nothing to do with this update; list, in ' +
						'usedSources, only the numbers you actually drew a fact from, or leave it empty if ' +
						'none of them did - never list one just because it is topically nearby. Write a ' +
						'one-line summary of what you added and why. The summary is addressed to the GM; ' +
						'the new body text is the entry itself - different language rules apply to each, ' +
						'stated separately below. ' +
						speechInstruction(ctx.locale) +
						' ' +
						canonInstruction(contentLanguage),
					prompt:
						`Entry to update: ${target.name}\n\n` +
						`Current body:\n${target.body || '(empty)'}\n\n` +
						`What the GM said to add: ${instruction}\n\n` +
						`Candidates retrieved from your own canon, numbered:\n${renderSourcesForModel(ctx.sources)}`
				}),
			{
				extractUsage: (r) => ({
					inputTokens: r.usage.inputTokens ?? 0,
					outputTokens: r.usage.outputTokens ?? 0
				})
			}
		),
		chargeFor(ctx.db, 'propagate.diff')
	]);

	// Same two gates as the create path, over the entry this edit targets and the body it
	// produces (issue #270).
	const canonEvidence = selectEvidence(
		ctx.sources,
		result.object.usedSources,
		`${ctx.request}\n${target.name}\n${result.object.after}`
	);
	const evidence = askEvidence(ctx.request, canonEvidence);
	const rationale = rationaleFor(ctx.locale, result.object.summary, canonEvidence);

	const { plan, proposals } = await createProposalPlan(ctx.db, {
		universeId: ctx.universeId,
		trigger: 'ask',
		// `target` really is the entity this edit targets, unlike `draftNewEntity`'s create
		// path, so recording it is honest (issue #270). What it is *not* is an edit the GM
		// made: with `trigger: 'ask'` the provenance line reads "a question in Ask about
		// Cairnmouth" rather than "editing Cairnmouth", which is the whole reason the two
		// renderers now read the trigger before the entity name.
		triggerEntityId: target.id,
		summary: rationale,
		candidateCap: 1,
		estimatedCredits: price.credits,
		locale: ctx.locale,
		candidates: [
			{
				kind: 'update',
				targetEntityId: target.id,
				rationale,
				evidence,
				rank: 0
			}
		]
	});
	const candidate = proposals[0];
	if (!candidate) throw new Error('draftEntityUpdate: createProposalPlan returned no candidate');

	const patch: EntityUpdatePatch = {
		summary: result.object.summary,
		before: target.body,
		after: result.object.after
	};
	const proposal = await recordProposalDiff(ctx.db, {
		proposalId: candidate.id,
		patch,
		provider: premiumModel.resolved.provider,
		modelId: premiumModel.resolved.modelId,
		credits: price.credits
	});
	await setProposalPlanStatus(ctx.db, plan.id, 'spent');

	return {
		proposal,
		evidence,
		entityName: target.name,
		entitySlug: target.slug,
		kind: 'update',
		redirected: false
	};
}

export interface EntryProposeInput {
	db: Db;
	userId: string;
	universeId: string;
	locale: Locale;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	/** Ask's own layer-1 retrieval, already computed and already shown to the GM before
	 * this tool can run (guardrail 3) - see this module's header comment. */
	sources: EvidenceSource[];
	/** The GM's own message to Ask, verbatim - the evidence this draft is proposed on
	 * (issue #270), and never the model's `instruction` paraphrase of it. */
	request: string;
	name: string;
	instruction: string;
	requestId?: string;
}

/** `entry_propose`'s domain function (issue #256). Guardrail 6: when `name` already
 * names a real entry, this never creates a second one - it drafts an edit to the
 * existing entry instead and reports `redirected: true`, so the caller (`ask.ts`) can
 * tell the GM "X already exists, I proposed an edit instead" rather than silently doing
 * something other than what was asked. */
export async function entryPropose(input: EntryProposeInput): Promise<ProposeResult> {
	await requireAiEnabled(input.db, input.universeId);
	const ctx: DraftContext = {
		db: input.db,
		userId: input.userId,
		universeId: input.universeId,
		locale: input.locale,
		modelFactory: input.modelFactory,
		gateway: input.gateway,
		sources: input.sources,
		request: input.request,
		...(input.requestId !== undefined ? { requestId: input.requestId } : {})
	};

	const existing = await findExactEntity(input.db, input.universeId, input.name);
	if (existing) {
		const target = await loadEntity(input.db, existing.id);
		if (!target) throw new Error(`entryPropose: entity "${existing.id}" vanished mid-request`);
		const result = await draftEntityUpdate(ctx, target, input.instruction);
		return { ...result, redirected: true };
	}
	return draftNewEntity(ctx, input.name, input.instruction);
}

export interface EntryEditProposeInput {
	db: Db;
	userId: string;
	universeId: string;
	locale: Locale;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	sources: EvidenceSource[];
	/** The GM's own message to Ask, verbatim (issue #270) - see `EntryProposeInput`. */
	request: string;
	entityName: string;
	instruction: string;
	requestId?: string;
}

/** `entry_edit_propose`'s domain function (issue #256). Guardrail 6: when
 * `entityName` names no real entry, this never edits the nearest match - it drafts a
 * new entry instead and reports `redirected: true`. */
export async function entryEditPropose(input: EntryEditProposeInput): Promise<ProposeResult> {
	await requireAiEnabled(input.db, input.universeId);
	const ctx: DraftContext = {
		db: input.db,
		userId: input.userId,
		universeId: input.universeId,
		locale: input.locale,
		modelFactory: input.modelFactory,
		gateway: input.gateway,
		sources: input.sources,
		request: input.request,
		...(input.requestId !== undefined ? { requestId: input.requestId } : {})
	};

	const existing = await findExactEntity(input.db, input.universeId, input.entityName);
	if (!existing) {
		const result = await draftNewEntity(ctx, input.entityName, input.instruction);
		return { ...result, redirected: true };
	}
	const target = await loadEntity(input.db, existing.id);
	if (!target) throw new Error(`entryEditPropose: entity "${existing.id}" vanished mid-request`);
	return draftEntityUpdate(ctx, target, input.instruction);
}
