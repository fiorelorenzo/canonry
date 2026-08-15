/**
 * Task `rank`, purpose `cheap`: what the model actually decides in a propagation plan.
 *
 * It is worth being precise about what is on trial here, because it is smaller than
 * "ranking" sounds. `packages/copilot/src/candidates.ts` builds the shortlist
 * deterministically (graph within two hops, plus mentions) and `reject-signal.ts` orders
 * it. `writePlanRationale` then hands that shortlist to the cheap model, and the model's
 * only structural power is to **omit** an entry it judges irrelevant: the response schema
 * pins `entityId` to an enum of the shortlist, and the caller re-filters in the
 * shortlist's own order, so a model cannot add an entry and cannot reorder one.
 *
 * That makes this a precision task with a recall floor, and it is the exactly right thing
 * to measure, because SPEC.md §5.1's warning is about noise: "without a ceiling the copilot
 * becomes noise, and suggestion fatigue is the documented way copilots lose their users".
 * The deterministic layer already scores `meanFalsePositiveRate: 0.224` on this corpus
 * (`packages/copilot/src/eval.test.ts`), so roughly one proposal in five that reaches the
 * model should not reach the GM. Dropping those without dropping the real ones is the job.
 *
 * Scored against `@canonry/eval`'s propagation corpus, eleven cases over three worlds, the
 * same ground truth the deterministic layer is already measured on, so the two numbers sit
 * next to each other and mean the same thing.
 */
import { realCandidateSelector, semanticDiff, writePlanRationale } from '@canonry/copilot';
import { propagationWorlds, type PropagationCase, type PropagationWorld } from '@canonry/eval';
import { detectLanguage } from '@canonry/lang';
import { resolveModel } from '@canonry/ai';
import { benchModelFactory, identityGateway } from '../factory.js';
import { benchFixture } from '../../fixture.js';
import type { BenchTask, CaseOutcome, TaskContext } from '../runner.js';
import { usageSince } from '../runner.js';

interface Instance {
	world: PropagationWorld;
	propagationCase: PropagationCase;
	/** SPEC.md §17 rule two: the plan's prose follows the *reader's* interface locale, not
	 * the entry's language. Three cases run twice, once in each locale, so a model that
	 * quietly answers in English regardless is caught by the same task that scores its
	 * judgement. */
	locale: 'en' | 'it';
}

function instances(): Instance[] {
	const out: Instance[] = [];
	for (const world of propagationWorlds) {
		for (const propagationCase of world.cases) {
			out.push({ world, propagationCase, locale: 'en' });
		}
	}
	// The Italian pass, kept to three cases: it measures one binary property (did the prose
	// come back in the locale it was asked for), and paying for eleven more calls per
	// candidate to measure the same bit eleven times would buy nothing.
	for (const instance of out.slice(0, 3)) {
		out.push({ ...instance, locale: 'it' });
	}
	return out;
}

const ALL = instances();

function idOf(instance: Instance): string {
	return `${instance.world.id}/${instance.propagationCase.id}/${instance.locale}`;
}

export const rankTask: BenchTask = {
	id: 'rank',
	purpose: 'cheap',
	measures:
		'of the deterministic shortlist, does the model keep what a GM wants and drop the noise, and does it write the plan in the reader locale',
	caseIds: () => ALL.map(idOf),

	async runCase(ctx: TaskContext, caseId: string): Promise<CaseOutcome> {
		const instance = ALL.find((i) => idOf(i) === caseId);
		if (!instance) throw new Error(`no rank case ${caseId}`);
		const { world, propagationCase, locale } = instance;

		const before = world.entities.find((e) => e.slug === propagationCase.editedEntitySlug);
		if (!before) throw new Error(`case ${caseId} edits an entity the world does not have`);
		const diff = semanticDiff(before.body, propagationCase.editedBody);
		const pool = await realCandidateSelector()({ world, propagationCase });
		const nameBySlug = new Map(world.entities.map((e) => [e.slug, e.name]));
		const candidates = pool.map((slug) => ({
			entityId: slug,
			name: nameBySlug.get(slug) ?? slug
		}));

		const fixture = await benchFixture(ctx.db);
		const resolved = await resolveModel(ctx.db, 'cheap');
		const started = Date.now();
		const since = new Date(started - 1000);

		const plan = await writePlanRationale({
			db: ctx.db,
			userId: fixture.userId,
			universeId: fixture.universeId,
			editedEntityName: before.name,
			diff,
			candidates,
			model: {
				languageModel: identityGateway(benchModelFactory(resolved)),
				resolved
			},
			locale
		});
		const latencyMs = Date.now() - started;
		const usage = await usageSince(ctx.db, since, resolved.provider, resolved.modelId);

		const kept = new Set(plan.candidates.map((c) => c.entityId));
		const reachableExpected = propagationCase.expected.filter((slug) => pool.includes(slug));
		const reachableNoise = propagationCase.mustNotPropose.filter((slug) => pool.includes(slug));
		const keptExpected = reachableExpected.filter((slug) => kept.has(slug));
		const keptNoise = reachableNoise.filter((slug) => kept.has(slug));

		// Recall over what the deterministic layer actually handed over, not over the whole
		// ground truth: an entity the shortlist never contained is the retrieval layer's
		// miss and scoring the model for it would measure the wrong component.
		const recall =
			reachableExpected.length === 0 ? 1 : keptExpected.length / reachableExpected.length;
		const noiseKept = reachableNoise.length === 0 ? 0 : keptNoise.length / reachableNoise.length;

		// Every kept candidate needs a rationale a GM can read, which is the entire product
		// of this call. An empty or one-word "why" is a kept candidate with no evidence
		// attached, which guardrail 3 does not allow.
		const thinRationales = plan.candidates.filter(
			(c) => c.rationale.trim().split(/\s+/).length < 4
		);
		const rationaleQuality =
			plan.candidates.length === 0 ? 0 : 1 - thinRationales.length / plan.candidates.length;

		const proseSample = [plan.summary, ...plan.candidates.map((c) => c.rationale)].join(' ');
		const detected = detectLanguage(proseSample);
		// `detectLanguage` returns null for prose it cannot call, which is a fair answer on
		// two short sentences, so only a confident wrong answer counts against the model.
		const localeOk = detected === null || detected === locale;

		const score =
			(0.45 * recall + 0.35 * (1 - noiseKept) + 0.2 * rationaleQuality) * (localeOk ? 1 : 0.5);

		return {
			caseId,
			ok: plan.summary.trim().length > 0,
			score,
			detail: {
				poolSize: pool.length,
				kept: [...kept],
				reachableExpected,
				keptExpected,
				reachableNoise,
				keptNoise,
				summary: plan.summary,
				rationales: plan.candidates.map((c) => `${c.entityId}: ${c.rationale}`),
				detectedLanguage: detected,
				localeAsked: locale,
				localeOk,
				recall,
				noiseKept,
				rationaleQuality
			},
			latencyMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			costEur: usage.costEur
		};
	}
};
