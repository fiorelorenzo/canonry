/**
 * Audit (SPEC.md §5.2, issue #55): "runs on the sub-graph touched by recent edits,
 * produces at most a handful of flags, and each flag carries the two statements that
 * disagree." Guardrail 7: never promise consistency - contradiction detection sits at
 * F1 ~52%, barely better than a coin flip, so a flag is a question addressed to the GM,
 * never a finding addressed at the canon (docs/ux/c9-audit-flags.html).
 *
 * "The sub-graph touched by recent edits" is not a second notion of impact radius: it is
 * propagation's own (candidates.ts's `buildCandidatePool` over the edited entity's
 * semantic diff, SPEC.md §5.1 step 2), reused rather than redefined. Candidate PAIRS to
 * examine come from mention evidence only: a relation-only neighbour has no specific
 * sentence to compare against, while a mention hands over one exact statement on each
 * side, which is what guardrail 3's "which entry, which sentence" needs. A pair the
 * mention search never surfaces is never examined - this file invents no second
 * retrieval mechanism.
 *
 * Each candidate pair costs one `audit.flag` model call: a cheap-purpose yes/no judgment
 * plus a short topic phrase (ranking.ts's role, not diffs.ts's - nothing here drafts
 * prose). Charged whether or not the pair turns out to disagree, exactly like
 * `propagate.diff`'s per-candidate charge: the call happened and cost real tokens either
 * way. Every flag lands as `proposal(trigger: 'audit', kind: 'flag')` - the fifth kind,
 * added specifically because a flag has no patch and no accept path (guardrail 1's
 * `acceptProposal` refuses it outright with `ProposalCannotBeAcceptedError`); the only
 * decision it can register is `rejectProposal` ("Dismiss").
 */
import { chargeFor, resolveModel, withQuota } from '@canonry/ai';
import type { Db } from '@canonry/db';
import { createProposalPlan } from '@canonry/db';
import type { ProposalPlanRow, ProposalRow } from '@canonry/db';
import type { Locale } from '@canonry/lang';
import { generateObject } from 'ai';
import { z } from 'zod';
import { mentionsIn } from './candidates.js';
import type { CandidateGraph, GraphEntity } from './candidates.js';
import { loadCandidateGraph } from './db-graph.js';
import { jaccard, semanticDiff, splitIntoSentences, tokenize } from './diff.js';
import type { FactChange } from './diff.js';
import { routeModel } from './models.js';
import type { GatewayWrapper, ModelFactory, RoutedModel } from './models.js';
import { requireAiEnabled } from './propagate.js';
import { AUDIT_DISAGREEMENT, AUDIT_DISAGREEMENT_BARE, speechInstruction } from './speech.js';

/** SPEC.md §5.2: "at most a handful of flags". Bounds both the number of candidate pairs
 * examined (so the model is never billed more than a handful of times per audit run) and,
 * transitively, the number of flags a run can ever produce. */
const AUDIT_PAIR_CAP = 5;

export interface AuditFlagStatement {
	entityId: string;
	entityName: string;
	/** The exact sentence, quoted - guardrail 3's evidence, never a summary of it. */
	statement: string;
	/** Character offsets into that entity's current `body`, `[spanStart, spanEnd)`. */
	spanStart: number;
	spanEnd: number;
}

export interface WrittenAuditFlag {
	proposal: ProposalRow;
	statements: [AuditFlagStatement, AuditFlagStatement];
}

export interface RunAuditInput {
	db: Db;
	userId: string;
	universeId: string;
	editedEntityId: string;
	oldBody: string;
	newBody: string;
	/** SPEC.md §17 rule two (issue #123): the interface locale of whoever's session
	 * produced this audit run - every flag's rationale, and the topic phrase the model
	 * contributes to it, is written in this. */
	locale: Locale;
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
	/** Overrides `AUDIT_PAIR_CAP` - tests only; production never needs more than "a
	 * handful". */
	pairCap?: number;
	requestId?: string;
}

export interface RunAuditResult {
	/** Candidate pairs actually examined (and charged) - informational, for a caller that
	 * wants to say "audit ran" even when nothing disagreed. */
	examined: number;
	plan: ProposalPlanRow | null;
	flags: WrittenAuditFlag[];
}

interface CandidatePair {
	a: AuditFlagStatement;
	b: AuditFlagStatement;
}

/**
 * Where a sentence sits in the body it came from.
 *
 * This used to assume a sentence `splitIntoSentences` produced is a literal substring of
 * its own body, and threw when it was not, on the grounds that anything else is a
 * programming error. It is a programming error, but it is one in that assumption:
 * `splitIntoSentences` joins the lines of a paragraph with a single space
 * (`paragraph.join(' ')` in diff.ts), so a paragraph written across several lines comes
 * back as text that appears nowhere in the body. Two very ordinary bodies hit it: markdown
 * wrapped at a column, and a `:::secret` block, which is a shipped feature and which
 * `packages/db/src/seed-fixture.ts` puts in the sample world. Editing that entry crashed
 * `runAudit` outright, and in production that is a background canon-save job dying.
 *
 * So the search is whitespace-tolerant: the sentence's own runs of whitespace match any
 * run in the body. A sentence that still cannot be located returns null and the caller
 * drops that side of the pair, because guardrail 3 says a flag carries the sentence that
 * produced it and a flag pointing at the wrong span is worse than no flag.
 */
function spanOf(body: string, sentence: string): { start: number; end: number } | null {
	const exact = body.indexOf(sentence);
	if (exact >= 0) return { start: exact, end: exact + sentence.length };

	const pattern = sentence
		.trim()
		.split(/\s+/)
		.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('\\s+');
	if (pattern.length === 0) return null;
	const match = new RegExp(pattern).exec(body);
	if (!match) return null;
	return { start: match.index, end: match.index + match[0].length };
}

/** The sentence in `body` most similar (Jaccard word overlap) to `target`, or `null` for
 * an empty body. Used for the side of a pair that has no mention evidence of its own: a
 * candidate entity found via mention is one sentence away from a specific statement, but
 * the *edited* entity rarely names the candidate back, so its side of the pair is picked
 * by topical similarity rather than another mention scan. */
function mostSimilarSentence(body: string, target: string): string | null {
	const sentences = splitIntoSentences(body).filter((s) => !s.startsWith('#'));
	if (sentences.length === 0) return null;
	const targetTokens = tokenize(target);
	let best: { sentence: string; score: number } | null = null;
	for (const sentence of sentences) {
		const score = jaccard(tokenize(sentence), targetTokens);
		if (!best || score > best.score) best = { sentence, score };
	}
	return best!.sentence;
}

function statementFor(entity: GraphEntity, sentence: string): AuditFlagStatement | null {
	const span = spanOf(entity.body, sentence);
	if (!span) return null;
	return {
		entityId: entity.id,
		entityName: entity.name,
		statement: sentence,
		spanStart: span.start,
		spanEnd: span.end
	};
}

function editedSideFor(
	entity: GraphEntity,
	newBody: string,
	sentence: string
): AuditFlagStatement | null {
	const span = spanOf(newBody, sentence);
	if (!span) return null;
	return {
		entityId: entity.id,
		entityName: entity.name,
		statement: sentence,
		spanStart: span.start,
		spanEnd: span.end
	};
}

/**
 * Candidate pairs from the touched sub-graph, deterministic and mention-driven. Two
 * passes over the same idea from opposite directions:
 *
 * 1. Forward: a sentence the edit itself just added or changed names another entity in
 *    the universe (`mentionsIn`) - that sentence is the edited side's exact evidence, and
 *    the named entity's most topically similar sentence (`mostSimilarSentence`) is the
 *    other side.
 * 2. Reverse: some other entity's own body already names the entity that changed - that
 *    sentence is the *other* side's exact evidence, and the edited entity's most
 *    topically similar sentence (against the edit's new body) is the edited side.
 *
 * One pair per candidate entity (the first evidence found for it wins), ordered by which
 * pass found it, capped at `cap` - "at most a handful" is true before any model is asked
 * anything.
 */
function findCandidatePairs(
	graph: CandidateGraph,
	editedEntity: GraphEntity,
	newBody: string,
	diff: FactChange[],
	cap: number
): CandidatePair[] {
	const othersPool = graph.entities.filter((e) => e.id !== editedEntity.id);
	const seenEntityIds = new Set<string>();
	const pairs: CandidatePair[] = [];

	// Pass 1, forward: what the edit's new/changed text names.
	const freshSentences = diff
		.filter((c) => c.kind === 'added' || c.kind === 'changed')
		.map((c) => c.statement);
	for (const sentence of freshSentences) {
		if (pairs.length >= cap) break;
		for (const hit of mentionsIn(sentence, othersPool)) {
			if (pairs.length >= cap) break;
			if (seenEntityIds.has(hit.entity.id)) continue;
			const otherBest = mostSimilarSentence(hit.entity.body, sentence);
			if (!otherBest) continue;
			const a = editedSideFor(editedEntity, newBody, sentence);
			const b = statementFor(hit.entity, otherBest);
			// Guardrail 3: a flag has to carry the sentence that produced it, so a pair whose
			// evidence cannot be located in its own body is dropped rather than flagged with
			// a span that points at the wrong text.
			if (!a || !b) continue;
			seenEntityIds.add(hit.entity.id);
			pairs.push({ a, b });
		}
	}

	// Pass 2, reverse: every other entity's own (unedited) body that already names the
	// entity that just changed - graph hops alone would miss this, the same gap
	// candidates.ts's own doc comment names for propagation's reverse-mention source.
	for (const other of othersPool) {
		if (pairs.length >= cap) break;
		if (seenEntityIds.has(other.id)) continue;
		for (const sentence of splitIntoSentences(other.body)) {
			if (pairs.length >= cap) break;
			if (mentionsIn(sentence, [editedEntity]).length === 0) continue;
			const editedBest = mostSimilarSentence(newBody, sentence);
			if (!editedBest) continue;
			const a = editedSideFor(editedEntity, newBody, editedBest);
			const b = statementFor(other, sentence);
			if (!a || !b) continue;
			seenEntityIds.add(other.id);
			pairs.push({ a, b });
			break;
		}
	}

	return pairs.slice(0, cap);
}

const FORBIDDEN_TOPIC_PATTERNS: RegExp[] = [
	/contradiction detected/i,
	/error:/i,
	/\d+\s*%/,
	/\bconsistent\b/i,
	/\binconsistent\b/i,
	/no conflicts? found/i,
	/fix this automatically/i
];

/** Guardrail 7, enforced in code rather than trusted to prompting alone: whatever short
 * topic phrase the model volunteers is checked against the exact forbidden vocabulary
 * docs/ux/c9-audit-flags.html's table names ("Contradiction detected.", a percentage,
 * "consistent" in either direction, "no conflicts found", "fix this automatically") before
 * it is allowed into a flag's rationale. A phrase that trips any of them is dropped, not
 * rewritten - the deterministic template below is always safe on its own. */
export function isGuardrailSafeTopic(topic: string): boolean {
	return !FORBIDDEN_TOPIC_PATTERNS.some((re) => re.test(topic));
}

/** The exact framing docs/ux/c9-audit-flags.html locks in verbatim: "X and Y do not agree
 * on <topic>." Never "detected", never a percentage, never a verdict - a question, not a
 * finding. SPEC.md §17 rule two (issue #123): a locale-templated framing per
 * `speech.ts`'s `AUDIT_DISAGREEMENT`/`AUDIT_DISAGREEMENT_BARE`, since this is exactly the
 * kind of user-facing speech this package writes without a model call. */
export function buildFlagRationale(
	entityAName: string,
	entityBName: string,
	topic: string,
	locale: Locale
): string {
	const trimmed = topic.trim();
	if (trimmed.length > 0 && isGuardrailSafeTopic(trimmed)) {
		return AUDIT_DISAGREEMENT[locale](entityAName, entityBName, trimmed);
	}
	return AUDIT_DISAGREEMENT_BARE[locale](entityAName, entityBName);
}

const judgmentSchema = z.object({
	disagree: z.boolean(),
	/** A short noun phrase, e.g. "who led the watch through the second freeze" - never a
	 * verdict, a percentage or the word "consistent" (checked in code, not only asked for
	 * in the prompt: see `isGuardrailSafeTopic`). */
	topic: z.string()
});

const SYSTEM_PROMPT =
	'You are the Loremaster auditing two statements from different entries in a tabletop ' +
	'RPG wiki for a disagreement worth a human look. You are not a fact-checker and you are ' +
	'not certifying anything: contradiction detection this way is correct barely half the ' +
	'time, so judge only whether the two statements below could not both be true as ' +
	'written. If they disagree, name the topic in a few words, exactly like "who led the ' +
	'watch through the second freeze" - never a verdict, never a percentage, never the word ' +
	'"consistent" or "inconsistent", never "contradiction detected" or "error". If they do ' +
	'not disagree (they are compatible, or about different things), say so.';

export interface StatementPairJudgment {
	disagree: boolean;
	topic: string;
	inputTokens: number;
	outputTokens: number;
}

export interface JudgeStatementPairInput {
	db: Db;
	userId: string;
	universeId: string;
	model: RoutedModel;
	locale: Locale;
	a: { entityName: string; statement: string };
	b: { entityName: string; statement: string };
	/** Passed straight through to `withQuota` so a retried run charges once. */
	requestId?: string;
	idempotencyKey?: string;
}

/**
 * One pair, one charged model call, the whole of what a model decides in an audit. Split
 * out of `runAudit` so the judgement has a seam of its own: it is the only place in this
 * package where a cheap model's answer is a yes or a no rather than prose, which makes it
 * the one audit behaviour that can be measured against labelled pairs instead of read.
 * `packages/bench` does exactly that when it picks the model for the `cheap` purpose, and
 * it has to be able to measure the shipped prompt rather than a copy of it that drifts.
 */
export async function judgeStatementPair(
	input: JudgeStatementPairInput
): Promise<StatementPairJudgment> {
	const judged = await withQuota(
		input.db,
		input.model.resolved,
		{
			userId: input.userId,
			universeId: input.universeId,
			agent: 'loremaster',
			operation: 'audit.flag',
			...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
			...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {})
		},
		() =>
			generateObject({
				model: input.model.languageModel,
				schema: judgmentSchema,
				system: `${SYSTEM_PROMPT} ${speechInstruction(input.locale)}`,
				prompt:
					`${input.a.entityName}: "${input.a.statement}"\n\n` +
					`${input.b.entityName}: "${input.b.statement}"\n\n` +
					'Do these two statements disagree?'
			}),
		{
			extractUsage: (r) => ({
				inputTokens: r.usage.inputTokens ?? 0,
				outputTokens: r.usage.outputTokens ?? 0
			})
		}
	);
	return {
		disagree: judged.object.disagree,
		topic: judged.object.topic,
		inputTokens: judged.usage.inputTokens ?? 0,
		outputTokens: judged.usage.outputTokens ?? 0
	};
}

/** SPEC.md §5.2, issue #55: audits the sub-graph a recent edit touched and writes at most
 * a handful of flags. Mirrors `planPropagation`'s shape (deterministic candidates first,
 * one charged model call per candidate) but has no diff-generation phase after it - a
 * flag is fully written the moment it is found, there is nothing left to spend on later.
 * Returns `plan: null` when nothing disagreed (including when the edit produced no
 * semantic change, or the touched sub-graph offered no mention-linked pair to examine at
 * all): nothing to see is not itself an event guardrail 7 wants surfaced. */
export async function runAudit(input: RunAuditInput): Promise<RunAuditResult> {
	await requireAiEnabled(input.db, input.universeId);

	const diff = semanticDiff(input.oldBody, input.newBody);
	if (diff.length === 0) return { examined: 0, plan: null, flags: [] };

	const graph = await loadCandidateGraph(input.db, input.universeId);
	const editedEntity = graph.entities.find((e) => e.id === input.editedEntityId);
	if (!editedEntity) {
		throw new Error(`runAudit: unknown edited entity "${input.editedEntityId}"`);
	}

	const cap = input.pairCap ?? AUDIT_PAIR_CAP;
	const pairs = findCandidatePairs(graph, editedEntity, input.newBody, diff, cap);
	if (pairs.length === 0) return { examined: 0, plan: null, flags: [] };

	const cheapModel = routeModel(
		await resolveModel(input.db, 'cheap'),
		input.modelFactory,
		input.gateway
	);
	const price = await chargeFor(input.db, 'audit.flag');

	const survivors: Array<{ pair: CandidatePair; topic: string }> = [];
	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i]!;
		const judged = await judgeStatementPair({
			db: input.db,
			userId: input.userId,
			universeId: input.universeId,
			model: cheapModel,
			locale: input.locale,
			a: pair.a,
			b: pair.b,
			...(input.requestId !== undefined
				? { requestId: input.requestId, idempotencyKey: `${input.requestId}:${i}` }
				: {})
		});
		if (judged.disagree) survivors.push({ pair, topic: judged.topic });
	}

	if (survivors.length === 0) return { examined: pairs.length, plan: null, flags: [] };

	const first = survivors[0]!;
	const { plan, proposals } = await createProposalPlan(input.db, {
		universeId: input.universeId,
		trigger: 'audit',
		triggerEntityId: input.editedEntityId,
		summary: buildFlagRationale(
			first.pair.a.entityName,
			first.pair.b.entityName,
			first.topic,
			input.locale
		),
		candidateCap: cap,
		// Real spend, not a forward-looking estimate: every pair examined above is already
		// charged by the time this plan is written, so this is what the run actually cost.
		estimatedCredits: pairs.length * price.credits,
		locale: input.locale,
		candidates: survivors.map((s, index) => ({
			kind: 'flag' as const,
			targetEntityId: s.pair.a.entityId,
			relatedEntityId: s.pair.b.entityId,
			rationale: buildFlagRationale(
				s.pair.a.entityName,
				s.pair.b.entityName,
				s.topic,
				input.locale
			),
			evidence: [s.pair.a, s.pair.b],
			rank: index
		}))
	});

	const flags: WrittenAuditFlag[] = proposals.map((proposal, index) => ({
		proposal,
		statements: [survivors[index]!.pair.a, survivors[index]!.pair.b]
	}));

	return { examined: pairs.length, plan, flags };
}
