/**
 * Which image model runs `scene` (#258).
 *
 * `image_model_config` had two rows, `portrait` and `variants` (migration 0011), and the
 * `image_feature` enum had three values. Nothing had measured any of the three: 0011 says
 * in its own comment that the two models it seeds are the two SPEC.md §9 names, which is a
 * citation and not a measurement. `docs/models.md` is the standard the text purposes are
 * held to, and this runner is what lets the image side meet it.
 *
 *   DATABASE_URL=postgres://canonry:canonry@127.0.0.1:55432/canonry_<suffix>_bench \
 *     pnpm --filter @canonry/bench scene-images
 *
 * **This spends real money at Replicate**, one prediction per case per arm, plus two
 * gateway vision calls per image to judge it. The arm list and the case list are both
 * deliberately short for that reason, and the run prints what it spent.
 *
 * What it runs is the product's own path, minus one deliberate omission. The prompt comes
 * from `@canonry/media`'s `composePrompt` with the feature it will carry in production,
 * the model comes from `image_model_config` through `resolveImageModel` (the row is
 * rewritten per arm, exactly what an admin does at `/admin/models`), and the prediction
 * goes through `ReplicateImageProvider`, so every image below is charged, priced and
 * recorded in `model_call` the way a GM's would be. The omission is `generateImages`
 * itself: its similarity cache keys on universe, feature and prompt vector, so the second
 * arm to ask for "The Cistern Quarter" as a scene would be served the first arm's picture
 * and the comparison would measure nothing. The cache is a real feature and this runner
 * routing around it is the reason the numbers mean anything.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { generateObject } from 'ai';
import { z } from 'zod';
import { and, closeDb, createDb, eq, type Db } from '@canonry/db';
import { imageModelConfig, operationPrice } from '@canonry/db/schema';
import { computeCost, normalizeUsage, toEur } from '@canonry/ai';
import {
	clearImageModelCache,
	composePrompt,
	ProviderLimiter,
	ReplicateImageProvider,
	resolveImageModel
} from '@canonry/media';
import { entityBySlug, markdownBody } from '../corpus/types.js';
import { worldV1 } from '../corpus/valdoria-reach.js';
import { dataDir, loadEnv, requireEnv } from '../env.js';
import { benchFixture, topUpCredits } from '../fixture.js';
import { JUDGES, splitSlug } from '../models/candidates.js';
import { benchModelFactory } from '../models/factory.js';
import { withRetry } from '../models/runner.js';

/**
 * The six entries the arms are judged on, by corpus slug, and each one is here because of
 * what it does to a model rather than to fill a row:
 *
 * - `valdoria` and `the-sable-reach` are the easy end: a city and a frozen strait, one
 *   with people in its prose and one with none at all.
 * - `the-gilded-rat` and `the-cistern-quarter` are the trap. Both name people in their
 *   lead ("Mother Sennah keeps it", "Sera Voss grew up here"), which is exactly the
 *   sentence that turns a place into a portrait of whoever is standing in it.
 * - `il-molo-vecchio` is Italian prose, because SPEC.md §17 ships Italian and a model that
 *   only frames well in English is a model that frames badly for half the product.
 * - `the-sable-winter` is not a place at all. It is an `event`, and the issue asks for "a
 *   place or a moment", so one case has to be the moment.
 */
const CASE_SLUGS = [
	'valdoria',
	'the-gilded-rat',
	'the-cistern-quarter',
	'the-sable-reach',
	'il-molo-vecchio',
	'the-sable-winter'
] as const;

/** Every arm renders at this ratio, so the shape column measures whether the model obeyed
 * and never which ratio it was asked for. Production says the same thing on the `scene`
 * row of `image_model_config` (`params.aspectRatio`, migration 0045) rather than in code
 * since #332; the bench keeps its own constant because sweeping is exactly the case where
 * the arm, and not the row, decides. */
const SCENE_ASPECT_RATIO = '16:9';
const TARGET_RATIO = 16 / 9;

/** How far off 16:9 still counts as honoured. Models round to a multiple of 8 or 16 pixels,
 * so 1184x672 (1.762) is an obeyed 16:9 and not a near miss; 1:1 or 4:3 is nowhere near
 * this band. */
const RATIO_TOLERANCE = 0.04;

interface SceneArm {
	id: string;
	/** Replicate slug, `owner/name`. */
	slug: string;
	/**
	 * Which framing `composePrompt` builds for this arm. Every arm but the control asks
	 * for `scene`; the control asks for `portrait` at the same 16:9 canvas, which is the
	 * only way to tell whether the framing clause does anything the aspect ratio was not
	 * already doing.
	 */
	framing: 'scene' | 'portrait';
	/** Replicate's own list price per output image, in USD, read off the model's page on
	 * 2026-08-19. All five are billed per output image rather than per second. */
	usdPerImage: number;
	why: string;
}

const ARMS: SceneArm[] = [
	{
		id: 'p-image',
		slug: 'prunaai/p-image',
		framing: 'scene',
		usdPerImage: 0.005,
		why: 'the model `portrait` already runs (migration 0011), asked for a scene. The issue names this outcome explicitly: if the honest answer is the portrait model with different parameters, that is a fine answer.'
	},
	{
		id: 'p-image-portrait-prompt',
		slug: 'prunaai/p-image',
		framing: 'portrait',
		usdPerImage: 0.005,
		why: 'the control. Same model, same 16:9 canvas, portrait prompt. Separates "the model can frame a scene" from "the aspect ratio did it".'
	},
	{
		id: 'seedream-4',
		slug: 'bytedance/seedream-4',
		framing: 'scene',
		usdPerImage: 0.03,
		why: 'a general text-to-image model from a third house, so the field is not two FLUX checkpoints and the incumbent. It replaced `google/imagen-4-fast`, which could not be measured at all: Replicate accepted the prediction and Google then answered 404 for `imagen-4.0-fast-generate-001` on its own Vertex endpoint, so every case failed before generating anything (prediction fjfhvm0pp1rmy0d03e9vkyq6e0).'
	},
	{
		id: 'flux-schnell',
		slug: 'black-forest-labs/flux-schnell',
		framing: 'scene',
		usdPerImage: 0.003,
		why: 'the cheapest arm, and the model `variants` already runs, so a win here would cost nothing to adopt.'
	},
	{
		id: 'flux-1.1-pro',
		slug: 'black-forest-labs/flux-1.1-pro',
		framing: 'scene',
		usdPerImage: 0.04,
		why: 'the expensive end. Worth measuring so the cost of the quality nobody bought is a number rather than a guess.'
	}
];

const JUDGE_RUBRIC = `You are looking at one image generated for a tabletop-RPG world wiki.
A player or GM would see it inside the body of a wiki entry about a place or an event, the
way a photograph sits inside an encyclopaedia article.

Answer three things about the image itself, never about how pretty it is:

1. subject: what is the image OF? "place" for a location, a building, a street, a landscape
   or an interior. "moment" for an event or a scene of something happening. "person" for a
   portrait: one or a few figures posed and filling the frame, the way a character portrait
   does. "object" for a single prop on its own. "unclear" when none of those fits.
2. adherence: 0 to 4, how much of the supplied entry text the image actually shows. 4 means
   a reader of the entry would recognise the picture as this entry. 0 means it could
   illustrate anything.
3. usableInBody: would you place this image in that entry's body as it stands?

Be hard on subject. An image with a figure standing in a wide street is still a "place";
an image where a figure's head and shoulders fill the frame is a "person" no matter how
much scenery is behind them.`;

const verdictSchema = z.object({
	subject: z.enum(['place', 'moment', 'person', 'object', 'unclear']),
	adherence: z.number().min(0).max(4),
	usableInBody: z.boolean(),
	reason: z.string().describe('one sentence naming what in the image decided the subject')
});

type Verdict = z.infer<typeof verdictSchema>;

interface SniffedImage {
	width: number;
	height: number;
}

/**
 * Width and height straight out of the file's own header. PNG, JPEG and WebP, because
 * those are the three formats the five arms actually return; there is no image dependency
 * in this repo and this is thirty lines. `@canonry/import`'s `media-store.ts` sniffs the
 * same headers for the upload path and deliberately skips WebP, which a Replicate model
 * returns by default, so it is not reusable here.
 */
function sniffDimensions(bytes: Uint8Array): SniffedImage | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
		return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
	}
	// WebP: 'RIFF' .... 'WEBP' then a chunk. VP8X carries a 24-bit width-1/height-1 pair,
	// VP8L packs 14 bits each, lossy VP8 puts two 14-bit values after a 3-byte frame tag.
	if (bytes.length > 30 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42) {
		const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
		if (chunk === 'VP8X') {
			const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16);
			const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16);
			return { width: w + 1, height: h + 1 };
		}
		if (chunk === 'VP8L') {
			const bits = view.getUint32(21, true);
			return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
		}
		if (chunk === 'VP8 ') {
			return {
				width: view.getUint16(26, true) & 0x3fff,
				height: view.getUint16(28, true) & 0x3fff
			};
		}
	}
	if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 <= bytes.length) {
			if (bytes[offset] !== 0xff) return undefined;
			const marker = bytes[offset + 1]!;
			if (marker === 0xd8 || marker === 0xd9) break;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
				offset += 2;
				continue;
			}
			const isStartOfFrame =
				marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (isStartOfFrame) {
				return {
					height: view.getUint16(offset + 5, false),
					width: view.getUint16(offset + 7, false)
				};
			}
			offset += 2 + view.getUint16(offset + 2, false);
		}
	}
	return undefined;
}

const EXTENSION_BY_MIME: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp'
};

/** `image.scene`'s price, seeded here because the bench runs before the migration that
 * seeds it for real: `withQuota` refuses an operation with no `operation_price` row, and
 * measuring the model is what decides whether the row is worth writing at all. Same
 * credits as `image.portrait`, since a scene is one generated image just as a portrait is.
 * The migration this run justifies writes the same number. */
async function seedScenePrice(db: Db): Promise<void> {
	await db
		.insert(operationPrice)
		.values({
			operation: 'image.scene',
			label: 'Scene image',
			credits: 3,
			kind: 'generation',
			notes: 'Seeded by packages/bench/src/media/scene.ts so the scene measurement can charge.'
		})
		.onConflictDoNothing();
}

/** Points `image_model_config`'s `scene` row at one arm, priced from Replicate's own list
 * in its own currency (issue #132: never pre-converted), so the `model_call.cost_eur` rows
 * this run leaves behind are the real cost of the arm. Mirrors `setActiveModel` in
 * `models/factory.ts`, which does the same job for `model_config`.
 *
 * The two columns do not split the slug the way `model_config`'s do, and getting that
 * wrong is a silent 404 rather than a type error: an image row's `provider` is the
 * platform ('replicate', which is what `ProviderLimiter` and `KNOWN_PROVIDERS` mean by a
 * provider) and its `model_id` carries Replicate's whole `owner/name`, because that is
 * what `generateImage` puts in the URL path. Migration 0011's two rows are the reference. */
const REPLICATE = 'replicate';

async function pointSceneAt(db: Db, arm: SceneArm): Promise<void> {
	const modelId = arm.slug;
	await db
		.update(imageModelConfig)
		.set({ active: false })
		.where(and(eq(imageModelConfig.feature, 'scene'), eq(imageModelConfig.active, true)));
	const params = { currency: 'USD' as const, pricePerImage: arm.usdPerImage, imagesPerRequest: 1 };
	const existing = await db
		.select({ id: imageModelConfig.id })
		.from(imageModelConfig)
		.where(
			and(
				eq(imageModelConfig.feature, 'scene'),
				eq(imageModelConfig.provider, REPLICATE),
				eq(imageModelConfig.modelId, modelId)
			)
		)
		.limit(1);
	const row = existing[0];
	if (row) {
		await db
			.update(imageModelConfig)
			.set({ active: true, params, updatedAt: new Date() })
			.where(eq(imageModelConfig.id, row.id));
	} else {
		await db
			.insert(imageModelConfig)
			.values({ feature: 'scene', provider: REPLICATE, modelId, active: true, params });
	}
	clearImageModelCache();
}

interface JudgedImage {
	judge: string;
	verdict: Verdict;
	costEur: number;
}

async function judgeImage(
	judge: string,
	entryText: string,
	image: { bytes: Uint8Array; mimeType: string }
): Promise<JudgedImage> {
	const { provider, modelId } = splitSlug(judge);
	const resolved = {
		purpose: 'multimodal' as const,
		provider,
		modelId,
		// The gateway's list price for the two judges on 2026-08-19, in USD (issue #132).
		// Judging is a bench cost rather than a product cost, so it is priced here rather
		// than read from `model_config`, whose rows describe what the product runs.
		params:
			judge === 'openai/gpt-5.4'
				? { currency: 'USD' as const, pricePerInputMTok: 2.5, pricePerOutputMTok: 15 }
				: { currency: 'USD' as const, pricePerInputMTok: 5, pricePerOutputMTok: 25 }
	};
	const result = await withRetry(() =>
		generateObject({
			model: benchModelFactory(resolved),
			schema: verdictSchema,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: `${JUDGE_RUBRIC}\n\nThe entry text was:\n${entryText}` },
						{
							type: 'file',
							data: { type: 'data', data: Buffer.from(image.bytes).toString('base64') },
							mediaType: image.mimeType
						}
					]
				}
			]
		})
	);
	const costEur = computeCost(
		resolved.params,
		normalizeUsage({
			inputTokens: result.usage.inputTokens ?? 0,
			outputTokens: result.usage.outputTokens ?? 0
		})
	).costEur;
	return { judge, verdict: result.object, costEur };
}

interface CaseResult {
	caseId: string;
	ok: boolean;
	latencyMs: number;
	width: number;
	height: number;
	ratioHonoured: boolean;
	subjects: string[];
	subjectOk: boolean;
	adherence: number;
	usableVotes: number;
	file: string;
	prompt: string;
	judgeCostEur: number;
	error?: string;
}

interface ArmResult {
	arm: SceneArm;
	cases: CaseResult[];
	imageCostEur: number;
	judgeCostEur: number;
}

/**
 * Replicate throttles prediction creation to 6 a minute with a burst of 1 while an account
 * holds less than $5 in credit, which is the state this account is in and which is not a
 * thing a bench can opt out of: the second and third submissions of the first paced-wrong
 * run came back `429 Request was throttled ... resets in ~10s`. So one submission every
 * eleven seconds, and a retry that honours the same window when a 429 lands anyway.
 *
 * Nothing about this belongs in the product. A GM clicking Generate twice inside ten
 * seconds would hit the same 429 and see it as a failed generation, which is worth its own
 * issue rather than a retry loop smuggled in here.
 */
const SUBMIT_INTERVAL_MS = 11_000;
const THROTTLE_ATTEMPTS = 4;

let lastSubmittedAt = 0;

async function paceSubmission(): Promise<void> {
	const since = Date.now() - lastSubmittedAt;
	if (lastSubmittedAt > 0 && since < SUBMIT_INTERVAL_MS) {
		await sleep(SUBMIT_INTERVAL_MS - since);
	}
	lastSubmittedAt = Date.now();
}

async function runArm(db: Db, arm: SceneArm, fixture: { userId: string; universeId: string }) {
	await pointSceneAt(db, arm);
	const model = await resolveImageModel(db, 'scene');
	const images = new ReplicateImageProvider({
		db,
		replicateApiToken: requireEnv('REPLICATE_API_TOKEN'),
		limiter: new ProviderLimiter(),
		agent: 'media'
	});
	const outDir = path.join(dataDir, 'scene', arm.id);
	mkdirSync(outDir, { recursive: true });

	const cases: CaseResult[] = [];
	for (const slug of CASE_SLUGS) {
		const entity = entityBySlug(worldV1, slug);
		// The product's caller strips mention syntax before handing the body over
		// (apps/web's `stripMentionSyntax`, see composePrompt's own doc comment), so the
		// bench hands over the same shape of text rather than raw `[[wikilinks]]`.
		const description = markdownBody(entity).replace(/\[\[([^\]]+)\]\]/g, '$1');
		const prompt = composePrompt({
			name: entity.name,
			description,
			styleModifier: null,
			feature: arm.framing
		});

		let generated;
		let started = Date.now();
		try {
			for (let attempt = 1; ; attempt++) {
				await paceSubmission();
				started = Date.now();
				try {
					generated = await images.generate({
						prompt,
						model,
						count: 1,
						userId: fixture.userId,
						universeId: fixture.universeId,
						operation: 'image.scene',
						aspectRatio: SCENE_ASPECT_RATIO
					});
					break;
				} catch (err) {
					const throttled = err instanceof Error && err.message.includes('status 429');
					if (!throttled || attempt === THROTTLE_ATTEMPTS) throw err;
					console.log(`  ${arm.id} / ${slug}: throttled, retrying in 11s`);
				}
			}
		} catch (err) {
			cases.push({
				caseId: slug,
				ok: false,
				latencyMs: Date.now() - started,
				width: 0,
				height: 0,
				ratioHonoured: false,
				subjects: [],
				subjectOk: false,
				adherence: 0,
				usableVotes: 0,
				file: '',
				prompt,
				judgeCostEur: 0,
				error: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
			});
			// An arm that cannot submit one prediction cannot submit six, and the first run
			// of this file proved it: a wrong `provider`/`model_id` split put a 404 in the
			// URL and every one of the thirty cases went to Replicate to find that out
			// again. Stop the arm on its first failure and let the report say so.
			console.log(`  ${arm.id} / ${slug}: FAILED, skipping the rest of this arm`);
			break;
		}
		const latencyMs = Date.now() - started;
		const image = generated[0]!;
		const sniffed = sniffDimensions(image.bytes);
		const file = path.join(outDir, `${slug}.${EXTENSION_BY_MIME[image.mimeType] ?? 'bin'}`);
		writeFileSync(file, image.bytes);

		const judged = await Promise.all(
			JUDGES.map((judge) => judgeImage(judge, `${entity.name}. ${description}`, image))
		);
		const subjects = judged.map((j) => j.verdict.subject);
		// The both-judges rule `judge.ts` already documents, applied to the subject: a case
		// only counts as portrait-shaped when neither judge saw a place or a moment. One
		// judge calling a wide street a portrait is a disagreement, not a verdict.
		const subjectOk = subjects.some((s) => s === 'place' || s === 'moment');
		const ratio = sniffed ? sniffed.width / sniffed.height : 0;
		const result: CaseResult = {
			caseId: slug,
			ok: true,
			latencyMs,
			width: sniffed?.width ?? 0,
			height: sniffed?.height ?? 0,
			ratioHonoured: Math.abs(ratio - TARGET_RATIO) / TARGET_RATIO <= RATIO_TOLERANCE,
			subjects,
			subjectOk,
			adherence: judged.reduce((sum, j) => sum + j.verdict.adherence, 0) / judged.length / 4,
			usableVotes: judged.filter((j) => j.verdict.usableInBody).length,
			file: path.relative(dataDir, file),
			prompt,
			judgeCostEur: judged.reduce((sum, j) => sum + j.costEur, 0)
		};
		cases.push(result);
		console.log(
			`  ${arm.id} / ${slug}: ${result.width}x${result.height} ` +
				`${result.ratioHonoured ? 'ratio ok' : 'RATIO OFF'}, ` +
				`subject ${subjects.join('/')}, adherence ${result.adherence.toFixed(2)}, ` +
				`${latencyMs} ms`
		);
	}

	const priced = cases.filter((c) => c.ok).length;
	return {
		arm,
		cases,
		imageCostEur: toEur(arm.usdPerImage * priced, 'USD'),
		judgeCostEur: cases.reduce((sum, c) => sum + c.judgeCostEur, 0)
	} satisfies ArmResult;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function renderReport(results: ArmResult[]): string {
	const lines: string[] = ['# `scene` image model measurement', ''];
	lines.push(
		`Cases: ${CASE_SLUGS.join(', ')}`,
		`Aspect ratio asked for: ${SCENE_ASPECT_RATIO}`,
		''
	);
	lines.push(
		'| arm | prompt | shape | subject | adherence | usable | median ms | USD/image | run EUR |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
	);
	for (const r of results) {
		const done = r.cases.filter((c) => c.ok);
		const n = done.length || 1;
		lines.push(
			`| ${r.arm.id} | ${r.arm.framing} | ` +
				`${done.filter((c) => c.ratioHonoured).length}/${done.length} | ` +
				`${done.filter((c) => c.subjectOk).length}/${done.length} | ` +
				`${(done.reduce((s, c) => s + c.adherence, 0) / n).toFixed(3)} | ` +
				`${done.reduce((s, c) => s + c.usableVotes, 0)}/${done.length * 2} | ` +
				`${Math.round(median(done.map((c) => c.latencyMs)))} | ` +
				`${r.arm.usdPerImage.toFixed(3)} | ${r.imageCostEur.toFixed(4)} |`
		);
	}
	lines.push('');
	for (const r of results) {
		lines.push(`## ${r.arm.id} (${r.arm.slug}, ${r.arm.framing} prompt)`, '', r.arm.why, '');
		for (const c of r.cases) {
			lines.push(
				c.ok
					? `- \`${c.caseId}\`: ${c.width}x${c.height}, subject ${c.subjects.join(' / ')}, ` +
							`adherence ${c.adherence.toFixed(2)}, usable ${c.usableVotes}/2, ${c.latencyMs} ms, ${c.file}`
					: `- \`${c.caseId}\`: failed, ${c.error}`
			);
		}
		lines.push('');
	}
	const images = results.reduce((s, r) => s + r.imageCostEur, 0);
	const judges = results.reduce((s, r) => s + r.judgeCostEur, 0);
	lines.push(
		`Spent: EUR ${images.toFixed(4)} on ${results.reduce((s, r) => s + r.cases.filter((c) => c.ok).length, 0)} images, ` +
			`EUR ${judges.toFixed(4)} on judging, EUR ${(images + judges).toFixed(4)} in total.`,
		''
	);
	return lines.join('\n');
}

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	requireEnv('REPLICATE_API_TOKEN');
	requireEnv('AI_GATEWAY_API_KEY');

	// `--arm <id>`, repeatable, the same shape `models -- --purpose cheap` already has: an
	// arm that has to be re-run (a candidate that turned out to be dead, a case list that
	// changed) should not cost another sweep of the four that were fine.
	const wanted = process.argv.reduce<string[]>((ids, value, index) => {
		if (value === '--arm' && process.argv[index + 1]) ids.push(process.argv[index + 1]!);
		return ids;
	}, []);
	const arms = wanted.length > 0 ? ARMS.filter((arm) => wanted.includes(arm.id)) : ARMS;
	if (arms.length === 0) throw new Error(`no arm matches ${wanted.join(', ')}`);

	const db = createDb(url, { max: 4, quiet: true });
	try {
		const fixture = await benchFixture(db);
		await topUpCredits(db);
		await seedScenePrice(db);

		const results: ArmResult[] = [];
		for (const arm of arms) {
			console.log(`\n${arm.id} (${arm.slug}, ${arm.framing} prompt)`);
			results.push(await runArm(db, arm, fixture));
		}

		const suffix = wanted.length > 0 ? `-${wanted.join('-')}` : '';
		const report = renderReport(results);
		const reportPath = path.join(dataDir, 'scene', `report${suffix}.md`);
		writeFileSync(reportPath, report);
		writeFileSync(
			path.join(dataDir, 'scene', `raw${suffix}.json`),
			JSON.stringify(results, null, 2)
		);
		console.log(`\n${report}\nwrote ${reportPath}`);
	} finally {
		await closeDb(db);
	}
}

await main();
