/**
 * Who is on trial, and why.
 *
 * `model_config` has one active row per purpose (`packages/db/src/schema/model.ts`), and
 * today those rows say `anthropic/claude-haiku-4.5` for `cheap` and
 * `anthropic/claude-opus-4.8` for `premium` (migration 0024). Nothing measured that. The
 * shortlists below are the field, drawn from the gateway's own catalogue on 2026-08-15,
 * and the bench is what turns the field into a decision.
 *
 * Two rules for being on a shortlist:
 *
 * 1. **The gateway can route it.** Everything here is a slug from `GET /v1/models`.
 * 2. **The purpose's own requirements are met.** `cheap` and `premium` both drive
 *    `generateObject` and, for import, a tool-calling loop, so a model without `tools` in
 *    `supported_parameters` is not a candidate at any price. `multimodal` additionally
 *    needs `image` in its input modalities, because the whole job is looking at a page.
 *
 * `KNOWN_PROVIDERS` in `packages/ai/src/composition.ts` lists the seven providers an admin
 * may select today, and its doc comment gives the reason: "a typo cannot point a purpose at
 * a model nobody has evaluated". Four candidates here sit outside that list on purpose.
 * Evaluating them is exactly how a provider earns a place on it, and the bench routes
 * through its own factory (`factory.ts`) so an unevaluated provider can be measured without
 * first being blessed. A candidate marked `outsideKnownProviders` that wins has to be paid
 * for with a one-line change to `KNOWN_PROVIDERS` and a note saying what it scored.
 */

export type BenchPurpose = 'cheap' | 'premium' | 'multimodal';

export interface Candidate {
	/** The gateway slug, `provider/model`. Split on the first `/` for `model_config`. */
	slug: string;
	/** One line on why this one is in the field. Not marketing copy: the reason a reader
	 * would need to know why it is here and not something else. */
	why: string;
	/** True when `packages/ai`'s `KNOWN_PROVIDERS` does not carry this provider yet. */
	outsideKnownProviders?: boolean;
	/** The row `model_config` holds today for this purpose. Exactly one per purpose. */
	incumbent?: boolean;
	/** Set when `--preflight` found the model cannot do something every task needs. The
	 * candidate stays on the list with its reason: a shortlist that silently loses a row is
	 * a shortlist nobody can audit, and "we tried it and it cannot emit an object" is the
	 * most useful thing to know about a cheap model. */
	disqualified?: string;
}

/**
 * `cheap` runs the bulk work: ranking a propagation plan's candidates
 * (`propagate.plan`), judging whether two statements disagree (`audit.flag`), and the
 * import loop's per-document extraction (every shipped playbook declares
 * `modelPurpose: cheap`). Volume is the defining property, so a factor of twenty in price
 * between the top and the bottom of this list is the whole question.
 */
export const CHEAP_CANDIDATES: Candidate[] = [
	{
		slug: 'anthropic/claude-haiku-4.5',
		why: 'the incumbent, and the most expensive thing on this list by five times',
		incumbent: true
	},
	{
		slug: 'openai/gpt-5-nano',
		why: 'the cheapest input price of any frontier-lab model the gateway routes, 0.05/0.40'
	},
	{ slug: 'openai/gpt-5-mini', why: 'the step up from nano, still an order under the incumbent' },
	{
		slug: 'openai/gpt-4.1-nano',
		why: 'the previous generation at the same price as gpt-5-nano, a useful control on whether reasoning helps here'
	},
	{
		slug: 'google/gemini-2.5-flash-lite',
		why: 'the cheap workhorse of the family that already supplies the embedding shortlist'
	},
	{ slug: 'google/gemini-3.1-flash-lite', why: 'the current generation of the same line' },
	{
		slug: 'alibaba/qwen3.5-flash',
		why: 'already a known provider here, and Qwen is the only open-weights family in the running',
		disqualified:
			'preflight 2026-08-15: generateObject fails because the provider demands the word "json" ' +
			'appear in the messages before it will honour a json_object response format, which is a ' +
			'prompt this codebase does not write and should not have to. Every Loremaster call is a ' +
			'generateObject, so this is not a corner case.'
	},
	{ slug: 'xai/grok-4.1-fast-non-reasoning', why: 'cheap, fast, and a known provider' },
	{
		slug: 'mistral/mistral-small',
		why: 'the cheapest known-provider option, and European hosting is a real answer to the data question of guardrail 5'
	},
	{
		slug: 'openai/gpt-oss-120b',
		why: 'open weights routed under the openai slug, so it needs no provider change to adopt',
		disqualified: 'preflight 2026-08-15: generateObject returned no object matching the schema'
	},
	{
		slug: 'zai/glm-4.7-flash',
		why: 'cheapest credible tool-use model in the catalogue at 0.07/0.40',
		outsideKnownProviders: true
	},
	{
		slug: 'deepseek/deepseek-v4-flash',
		why: 'a million-token window at 0.20/0.40, which matters for a long import document',
		outsideKnownProviders: true,
		disqualified: 'preflight 2026-08-15: generateObject returned no object matching the schema'
	}
];

/**
 * `premium` writes prose a GM reads and decides on: the per-entry diffs of a propagation
 * plan (`propagate.diff`), a thin entry's completion (`entry.complete`), and the Ask
 * answer (`ask.answer`). Volume is low and the cost of a bad output is high, so the
 * question is the reverse of `cheap`: how far down the price list can quality survive.
 */
export const PREMIUM_CANDIDATES: Candidate[] = [
	{
		slug: 'anthropic/claude-opus-4.8',
		why: 'the incumbent, and the price ceiling',
		incumbent: true
	},
	{ slug: 'anthropic/claude-sonnet-4.6', why: 'the same house at 60 per cent of the price' },
	{
		slug: 'anthropic/claude-haiku-4.5',
		why: "today's cheap row, on trial for the premium job as well, which would collapse two rows into one"
	},
	{ slug: 'openai/gpt-5.4', why: "OpenAI's current flagship, half the incumbent's input price" },
	{ slug: 'openai/gpt-5.2', why: 'the generation below, materially cheaper' },
	{ slug: 'openai/gpt-5-mini', why: 'the cheap-tier model asked to do the premium job' },
	{ slug: 'google/gemini-3.1-pro-preview', why: "Google's flagship, with a million-token window" },
	{ slug: 'google/gemini-3-flash', why: 'the cheap end of the current Gemini line' },
	{
		slug: 'google/gemini-2.5-flash',
		why: 'the older flash, a control on whether the new one earns it'
	},
	{ slug: 'xai/grok-4.3', why: 'flagship pricing at a tenth of the incumbent output cost' },
	{
		slug: 'mistral/mistral-large-3',
		why: 'the European option at the premium tier, 0.50/1.50'
	},
	{
		slug: 'moonshotai/kimi-k2.5',
		why: 'open weights at 0.60/3.00, and strong on long-form prose',
		outsideKnownProviders: true,
		disqualified: 'preflight 2026-08-15: generateObject returned a response the SDK could not parse'
	},
	{
		slug: 'zai/glm-4.7',
		why: 'open weights at 0.60/2.20',
		outsideKnownProviders: true,
		disqualified:
			'preflight 2026-08-15: generateObject returned no object matching the schema (glm-4.7-flash, the cheap-tier sibling, passes)'
	}
];

/**
 * `multimodal` exists for one job in the whole product: SPEC.md §6.3's `page_image`, which
 * renders one page of a PDF and hands it to a model that can look at it. No `model_config`
 * row has ever been seeded for this purpose, so today a scanned page fails with
 * `ModelNotConfiguredError`. Every candidate takes image input.
 */
export const MULTIMODAL_CANDIDATES: Candidate[] = [
	{
		slug: 'google/gemini-2.5-flash-lite',
		why: 'cheapest vision model with tool use in the catalogue'
	},
	{ slug: 'google/gemini-3.1-flash-lite', why: 'current generation of the same line' },
	{ slug: 'google/gemini-3-flash', why: 'the step up, for whether a scan needs it' },
	{ slug: 'openai/gpt-5-nano', why: 'vision at 0.05/0.40' },
	{ slug: 'openai/gpt-5-mini', why: 'the mid tier' },
	{ slug: 'openai/gpt-4.1-nano', why: 'previous generation control at the same price' },
	{
		slug: 'anthropic/claude-haiku-4.5',
		why: "the cheap row's own vision, so one row could serve both"
	},
	{ slug: 'anthropic/claude-sonnet-4.6', why: 'the quality ceiling worth paying for a page' },
	{ slug: 'alibaba/qwen3.5-flash', why: 'open weights with vision, already a known provider' },
	{ slug: 'mistral/pixtral-12b', why: "Mistral's vision model, flat 0.15/0.15" },
	{ slug: 'mistral/ministral-14b', why: 'the newer Mistral with vision and a 256k window' },
	{ slug: 'xai/grok-4.1-fast-non-reasoning', why: 'cheap vision from a known provider' }
];

export const CANDIDATES: Record<BenchPurpose, Candidate[]> = {
	cheap: CHEAP_CANDIDATES,
	premium: PREMIUM_CANDIDATES,
	multimodal: MULTIMODAL_CANDIDATES
};

/**
 * The two models that score the prose tasks. Two rather than one, from different houses,
 * because a judge scoring its own family higher is the documented failure mode of
 * LLM-as-judge and a single judge gives no way to see it. The bench reports both scores and
 * their disagreement, and a task where the judges disagree by more than a point is reported
 * as unresolved rather than averaged into a false precision.
 *
 * Both are deliberately at the top of their houses' lines: judging is cheap here (a few
 * hundred outputs) and a weak judge is the one place where saving money buys nothing.
 */
export const JUDGES = ['openai/gpt-5.4', 'anthropic/claude-opus-4.8'] as const;
export type Judge = (typeof JUDGES)[number];

export function splitSlug(slug: string): { provider: string; modelId: string } {
	const cut = slug.indexOf('/');
	if (cut <= 0) throw new Error(`${slug} is not a provider/model slug`);
	return { provider: slug.slice(0, cut), modelId: slug.slice(cut + 1) };
}
