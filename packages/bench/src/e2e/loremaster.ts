/**
 * The Loremaster, end to end, on the seeded corpus world.
 *
 *   pnpm --filter @canonry/bench loremaster-e2e
 *
 * Four modes, one output shape, which is SPEC.md §5's own framing and the reason this can
 * be one runner rather than four. It seeds the world, indexes it into Qdrant with the real
 * embedding model, then exercises each mode against it and writes down what came back:
 *
 * - **retrieval**, first, because everything else is downstream of it. Scored with
 *   `@canonry/eval`'s retrieval harness against the gold corpus, so the number is
 *   comparable with the one SPEC.md §11.4 records and with the threshold that section says
 *   must be re-derived whenever the embedding model changes.
 * - **ask**, at every detail level and in both languages, including the cross-language
 *   cases that SPEC.md §17 says are a test rather than a hope.
 * - **propagate**, the full two-phase flow: `planPropagation` then `generatePlanDiffs`, with
 *   the plan's own cap and the proposals it wrote.
 * - **audit** and **complete**, each once per case in the gold set.
 *
 * Nothing here scores model quality on its own: that is what `src/models` is for, and
 * mixing the two would mean re-running an hour of benchmark every time somebody wants to
 * know whether the flow still works. This runner answers a different question, the one
 * that has never been answered for this codebase: does the whole thing work against a real
 * gateway, a real database and a real vector store, and what does it produce.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	completeEntry,
	generatePlanDiffs,
	planPropagation,
	runAsk,
	runAudit,
	type AskDetailLevel
} from '@canonry/copilot';
import { resolveModel } from '@canonry/ai';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, proposal, proposalPlan } from '@canonry/db/schema';
import {
	createVectorClient,
	ensureCollection,
	loreCollectionNameForModel,
	upsertLoreChunks
} from '@canonry/vector';
import { chunkWikiPage, heuristicExtractor, retrieveForUniverse } from '@canonry/indexing';
import { detectLanguage } from '@canonry/lang';
import { dataDir, loadEnv, requireEnv } from '../env.js';
import { benchEmbedder } from '../embedder.js';
import { benchFixture, topUpCredits } from '../fixture.js';
import { benchModelFactory, identityGateway } from '../models/factory.js';
import { indexOwnCanon } from '../index-canon.js';
import { seedWorld } from '../corpus/seed.js';
import { markdownBody } from '../corpus/types.js';
import { worldV1 } from '../corpus/valdoria-reach.js';
import { ASK_QUESTIONS, PROPAGATION_EDITS, THIN_ENTRIES } from '../corpus/gold.js';

const DETAIL_LEVELS: AskDetailLevel[] = ['1_line', 'short', 'normal', 'detailed', 'full'];

export interface AskObservation {
	id: string;
	question: string;
	language: string;
	detailLevel: AskDetailLevel;
	answerLength: number;
	answerLanguage: string | null;
	sourceCount: number;
	ownCanonSources: number;
	indexedSources: number;
	followUps: number;
	generated: boolean;
	credits: number;
	seconds: number;
	mentioned: string[];
	missed: string[];
	wronglyClaimed: string[];
	answer: string;
}

export interface PropagationObservation {
	editId: string;
	editedEntity: string;
	planId: string | null;
	summary: string | null;
	candidateCount: number;
	candidates: Array<{ entity: string; rationale: string; rank: number }>;
	expected: string[];
	missed: string[];
	unexpected: string[];
	diffsWritten: number;
	diffs: Array<{ entity: string; summary: string; afterLength: number; language: string | null }>;
	planStatus: string | null;
	seconds: number;
}

export interface AuditObservation {
	editId: string;
	examined: number;
	flags: Array<{ a: string; b: string; rationale: string }>;
	seconds: number;
}

export interface CompleteObservation {
	slug: string;
	before: number;
	after: number;
	language: string | null;
	expectedLanguage: string;
	summary: string;
	seconds: number;
}

export interface RetrievalObservation {
	collection: string;
	chunks: number;
	vectorSize: number;
	questions: Array<{
		id: string;
		question: string;
		language: string;
		hits: number;
		topScore: number | null;
		topBreadcrumb: string | null;
		expectedEntities: string[];
		hitEntities: string[];
		recall: number;
	}>;
	meanRecall: number;
	crossLanguageMeanRecall: number;
}

export interface LoremasterE2EReport {
	ranAt: string;
	cheapModel: string;
	premiumModel: string;
	embeddingModel: string;
	world: { entities: number; relations: number; droppedRelations: string[] };
	retrieval: RetrievalObservation;
	ask: AskObservation[];
	propagate: PropagationObservation[];
	audit: AuditObservation[];
	complete: CompleteObservation[];
}

async function measureRetrieval(
	db: Db,
	universeId: string,
	collection: string,
	chunks: number,
	vectorSize: number
): Promise<RetrievalObservation> {
	const embedder = await benchEmbedder(db, universeId);
	const client = createVectorClient();
	const questions: RetrievalObservation['questions'] = [];

	for (const q of ASK_QUESTIONS) {
		const [vector] = await embedder([q.question]);
		if (!vector) throw new Error(`no query vector for ${q.id}`);
		const hits = await retrieveForUniverse({
			db,
			vectorClient: client,
			collectionName: collection,
			universeId,
			queryVector: vector,
			queryText: q.question
		});
		const hitEntities = [
			...new Set(hits.map((h) => String(h.payload.url ?? '').replace('canonry://entity/', '')))
		];
		const expected = q.groundedIn;
		const found = expected.filter((slug) => hitEntities.includes(slug));
		questions.push({
			id: q.id,
			question: q.question,
			language: q.language,
			hits: hits.length,
			topScore: hits[0]?.score ?? null,
			topBreadcrumb: hits[0] ? String(hits[0].payload.breadcrumb ?? '') : null,
			expectedEntities: expected,
			hitEntities,
			recall: expected.length === 0 ? 1 : found.length / expected.length
		});
	}

	const scored = questions.filter((q) => q.expectedEntities.length > 0);
	// The cross-language subset: an Italian question whose answer is in English prose, or
	// the reverse. SPEC.md §17 makes this the property the embedding model was chosen for,
	// so it is reported on its own rather than averaged into the rest.
	const cross = scored.filter((q) => {
		const answerLanguages = q.expectedEntities.map(
			(slug) => worldV1.entities.find((e) => e.slug === slug)?.language ?? 'en'
		);
		return answerLanguages.some((lang) => lang !== q.language && lang !== 'mixed');
	});

	return {
		collection,
		chunks,
		vectorSize,
		questions,
		meanRecall: scored.length === 0 ? 0 : scored.reduce((a, q) => a + q.recall, 0) / scored.length,
		crossLanguageMeanRecall:
			cross.length === 0 ? 0 : cross.reduce((a, q) => a + q.recall, 0) / cross.length
	};
}

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	requireEnv('QDRANT_URL');

	const db = createDb(url, { max: 4, quiet: true });
	try {
		const fixture = await benchFixture(db);
		await topUpCredits(db);
		const seeded = await seedWorld(db, fixture.universeId, worldV1);
		const cheap = await resolveModel(db, 'cheap');
		const premium = await resolveModel(db, 'premium');
		const embedding = await resolveModel(db, 'embedding');

		const indexed = await indexOwnCanon(db, fixture.universeId);
		const retrieval = await measureRetrieval(
			db,
			fixture.universeId,
			indexed.collection,
			indexed.chunks,
			indexed.vectorSize
		);

		const report: LoremasterE2EReport = {
			ranAt: new Date().toISOString(),
			cheapModel: `${cheap.provider}/${cheap.modelId}`,
			premiumModel: `${premium.provider}/${premium.modelId}`,
			embeddingModel: `${embedding.provider}/${embedding.modelId}`,
			world: {
				entities: seeded.entities,
				relations: seeded.relations,
				droppedRelations: seeded.droppedRelations
			},
			retrieval,
			ask: [],
			propagate: [],
			audit: [],
			complete: []
		};

		// Ask: every question at 'normal', plus the first question at every other detail
		// level so the five levels are exercised without paying for 18 x 5.
		const askPlan: Array<{ id: string; detailLevel: AskDetailLevel }> = [
			...ASK_QUESTIONS.map((q) => ({ id: q.id, detailLevel: 'normal' as AskDetailLevel })),
			...DETAIL_LEVELS.filter((l) => l !== 'normal').map((l) => ({
				id: ASK_QUESTIONS[0]!.id,
				detailLevel: l
			}))
		];

		const embedder = await benchEmbedder(db, fixture.universeId);
		const client = createVectorClient();
		for (const item of askPlan) {
			const q = ASK_QUESTIONS.find((x) => x.id === item.id)!;
			const started = Date.now();
			let ownCanonSources = 0;
			let indexedSources = 0;
			const result = await runAsk({
				db,
				userId: fixture.userId,
				universeId: fixture.universeId,
				question: q.question,
				locale: q.language,
				detailLevel: item.detailLevel,
				vectorClient: client,
				embedder,
				modelFactory: benchModelFactory,
				gateway: identityGateway,
				onSources: (sources) => {
					for (const s of sources) {
						if (s.kind === 'own_canon') ownCanonSources++;
						else indexedSources++;
					}
				}
			});
			const lowered = result.answer.toLowerCase();
			report.ask.push({
				id: q.id,
				question: q.question,
				language: q.language,
				detailLevel: item.detailLevel,
				answerLength: result.answer.length,
				answerLanguage: detectLanguage(result.answer),
				sourceCount: result.sources.length,
				ownCanonSources,
				indexedSources,
				followUps: result.followUps.length,
				generated: result.generated,
				credits: result.credits,
				seconds: (Date.now() - started) / 1000,
				mentioned: q.mustMention.filter((m) => lowered.includes(m.toLowerCase())),
				missed: q.mustMention.filter((m) => !lowered.includes(m.toLowerCase())),
				wronglyClaimed: q.mustNotClaim.filter((m) => lowered.includes(m.toLowerCase())),
				answer: result.answer
			});
		}

		// Propagate and audit: the same edits drive both, exactly as a real save does
		// (`scheduleCanonSaveJob` fires propagation and audit off one revision).
		for (const edit of PROPAGATION_EDITS) {
			const target = worldV1.entities.find((e) => e.slug === edit.editedEntitySlug);
			if (!target) throw new Error(`edit ${edit.id} names an entity the world lacks`);
			const entityId = seeded.idBySlug.get(edit.editedEntitySlug);
			if (!entityId) throw new Error(`edit ${edit.id}: no seeded entity`);
			const oldBody = markdownBody(target);

			const started = Date.now();
			const plan = await planPropagation({
				db,
				userId: fixture.userId,
				universeId: fixture.universeId,
				editedEntityId: entityId,
				editedEntityName: target.name,
				oldBody,
				newBody: edit.newBody,
				modelFactory: benchModelFactory,
				gateway: identityGateway,
				locale: 'en'
			});

			const slugById = new Map([...seeded.idBySlug].map(([slug, id]) => [id, slug]));
			const candidates = (plan?.proposals ?? []).map((p, i) => ({
				entity: slugById.get(p.targetEntityId ?? '') ?? p.targetEntityId ?? '(none)',
				rationale: p.rationale ?? '',
				rank: p.rank ?? i
			}));
			const proposedSlugs = candidates.map((c) => c.entity);

			let diffsWritten = 0;
			const diffs: PropagationObservation['diffs'] = [];
			let planStatus: string | null = null;
			if (plan) {
				const generated = await generatePlanDiffs({
					db,
					userId: fixture.userId,
					universeId: fixture.universeId,
					planId: plan.plan.id,
					editedEntityId: entityId,
					editedEntityName: target.name,
					diff: plan.diff,
					modelFactory: benchModelFactory,
					gateway: identityGateway,
					locale: 'en'
				});
				diffsWritten = generated.written.length;
				planStatus = generated.plan.status;
				for (const written of generated.written) {
					const patch = written.patch as { summary?: string; after?: string };
					diffs.push({
						entity: slugById.get(written.targetEntityId ?? '') ?? '(none)',
						summary: patch.summary ?? '',
						afterLength: (patch.after ?? '').length,
						language: detectLanguage(patch.after ?? '')
					});
				}
			}

			report.propagate.push({
				editId: edit.id,
				editedEntity: edit.editedEntitySlug,
				planId: plan?.plan.id ?? null,
				summary: plan?.plan.summary ?? null,
				candidateCount: candidates.length,
				candidates,
				expected: edit.targets,
				missed: edit.targets.filter((slug) => !proposedSlugs.includes(slug)),
				unexpected: proposedSlugs.filter((slug) => !edit.targets.includes(slug)),
				diffsWritten,
				diffs,
				planStatus,
				seconds: (Date.now() - started) / 1000
			});

			const auditStarted = Date.now();
			const audited = await runAudit({
				db,
				userId: fixture.userId,
				universeId: fixture.universeId,
				editedEntityId: entityId,
				oldBody,
				newBody: edit.newBody,
				locale: 'en',
				modelFactory: benchModelFactory,
				gateway: identityGateway
			});
			report.audit.push({
				editId: edit.id,
				examined: audited.examined,
				flags: audited.flags.map((f) => ({
					a: slugById.get(f.proposal.targetEntityId ?? '') ?? '(none)',
					b: slugById.get(f.proposal.relatedEntityId ?? '') ?? '(none)',
					rationale: f.proposal.rationale ?? ''
				})),
				seconds: (Date.now() - auditStarted) / 1000
			});
		}

		for (const thin of THIN_ENTRIES) {
			const entityId = seeded.idBySlug.get(thin.slug);
			if (!entityId) throw new Error(`thin entry ${thin.slug} is not in the seeded world`);
			const started = Date.now();
			const result = await completeEntry({
				db,
				userId: fixture.userId,
				universeId: fixture.universeId,
				entityId,
				modelFactory: benchModelFactory,
				gateway: identityGateway,
				locale: 'en'
			});
			const patch = result.proposal.patch as { before?: string; after?: string; summary?: string };
			report.complete.push({
				slug: thin.slug,
				before: (patch.before ?? '').length,
				after: (patch.after ?? '').length,
				language: detectLanguage(patch.after ?? ''),
				expectedLanguage: thin.language,
				summary: patch.summary ?? '',
				seconds: (Date.now() - started) / 1000
			});
		}

		mkdirSync(dataDir, { recursive: true });
		const file = path.join(dataDir, 'loremaster-e2e.json');
		writeFileSync(file, JSON.stringify(report, null, '\t'));

		const plans = await db
			.select({ trigger: proposalPlan.trigger, status: proposalPlan.status })
			.from(proposalPlan)
			.where(eq(proposalPlan.universeId, fixture.universeId));
		const proposals = await db
			.select({ kind: proposal.kind, outcome: proposal.outcome })
			.from(proposal)
			.where(eq(proposal.universeId, fixture.universeId));

		console.log(`world: ${report.world.entities} entities, ${report.world.relations} relations`);
		if (report.world.droppedRelations.length > 0) {
			console.log(
				`  relations the catalogue cannot express: ${report.world.droppedRelations.length}`
			);
		}
		console.log(
			`retrieval: ${retrieval.chunks} chunks, ${retrieval.vectorSize} dims, mean recall ` +
				`${retrieval.meanRecall.toFixed(3)}, cross-language ${retrieval.crossLanguageMeanRecall.toFixed(3)}`
		);
		console.log(
			`ask: ${report.ask.length} answers, ${report.ask.filter((a) => a.wronglyClaimed.length > 0).length} with a forbidden claim`
		);
		console.log(
			`propagate: ${report.propagate.length} plans, ${report.propagate.reduce((a, p) => a + p.diffsWritten, 0)} diffs`
		);
		console.log(
			`audit: ${report.audit.reduce((a, x) => a + x.flags.length, 0)} flags over ${report.audit.reduce((a, x) => a + x.examined, 0)} pairs`
		);
		console.log(`complete: ${report.complete.length} drafts`);
		console.log(`plans in db: ${plans.length}, proposals: ${proposals.length}`);
		console.log(`\nwritten to ${file}`);
	} finally {
		await closeDb(db);
	}
}

await main();
