/**
 * The tool surface (issue #22, SPEC.md §6.3), wired against the injected `SourceReader`
 * and `ImageStore` halves (issues #25, #40) and a per-document `DocumentRunContext`
 * that `GatewayDriver` drains after every step. Two structural defenses live here
 * rather than in a text filter (issue #33 relies on both):
 *
 * - `job_finish`'s schema has no field for entity or relation counts. The model cannot
 *   report having created four thousand entities because there is nowhere on this tool
 *   to put that claim; `finishDocument` below computes the real counts from what
 *   `entity_propose`/`relation_propose` actually recorded in `ctx` during this run.
 * - `entity_propose`/`relation_propose` require a `sourceRef.documentId` that must equal
 *   this run's own document id, and `source_read`/`page_image`/`source_list` only ever
 *   see paths the injected `SourceReader` actually has (SPEC.md §6.5: "every tool call
 *   is checked against the job's universe"). A document telling the model to read
 *   another universe has no path to hand these tools that resolves to anything.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SourceReader } from './sources.js';
import type { ImageStore } from './images.js';
import type { EntityProposalPayload, JobEvent, RelationProposalPayload } from './driver.js';

const SPAN_SCHEMA = z
	.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
	.strict()
	.refine((span) => span.end > span.start, {
		message: 'evidenceSpan.end must be greater than evidenceSpan.start'
	});

const SOURCE_REF_SCHEMA = z
	.object({ documentId: z.string().min(1), path: z.string().min(1) })
	.strict();

const ENTITY_TYPE_SCHEMA = z.enum(['character', 'place', 'faction', 'item', 'event', 'session']);
const RELATION_CARDINALITY_SCHEMA = z.enum([
	'one_to_one',
	'one_to_many',
	'many_to_one',
	'many_to_many'
]);

const SOURCE_LIST_INPUT = z.object({ path: z.string().max(500).default('') }).strict();
const SOURCE_READ_INPUT = z.object({ path: z.string().min(1).max(500) }).strict();
const PAGE_IMAGE_INPUT = z
	.object({ path: z.string().min(1).max(500), page: z.number().int().positive() })
	.strict();
const IMAGE_STORE_INPUT = z.object({ path: z.string().min(1).max(500) }).strict();
const ENTITY_PROPOSE_INPUT = z
	.object({
		localId: z.string().min(1).max(64),
		type: ENTITY_TYPE_SCHEMA,
		name: z.string().min(1).max(200),
		aliases: z.array(z.string().min(1).max(200)).max(20).default([]),
		summary: z.string().min(1).max(4000),
		sourceRef: SOURCE_REF_SCHEMA,
		evidenceSpan: SPAN_SCHEMA
	})
	.strict();
const RELATION_PROPOSE_INPUT = z
	.object({
		fromLocalId: z.string().min(1).max(64),
		toLocalId: z.string().min(1).max(64),
		label: z.string().min(1).max(200),
		inverseLabel: z.string().min(1).max(200),
		cardinality: RELATION_CARDINALITY_SCHEMA,
		sourceRef: SOURCE_REF_SCHEMA,
		evidenceSpan: SPAN_SCHEMA
	})
	.strict()
	.refine((r) => r.fromLocalId !== r.toLocalId, {
		message: 'a relation cannot join an entity to itself'
	});
const CHECKPOINT_INPUT = z
	.object({ documentId: z.string().min(1), note: z.string().max(500).optional() })
	.strict();
const JOB_FINISH_INPUT = z
	.object({
		documentId: z.string().min(1),
		outcome: z.enum(['completed', 'skipped']),
		summary: z.string().max(1000).optional()
	})
	.strict();

/** Per-document mutable state, owned by `GatewayDriver` and read/written by the tools
 * below. Every field a tool needs to enforce a real invariant (dedup, dangling
 * references, honest counts) lives here rather than being trusted from model input. */
export interface DocumentRunContext {
	jobId: string;
	documentId: string;
	/** Current step number, set by the driver before each `generateText` call. */
	step: number;
	/** Events a tool call produced this step; the driver drains and yields these after
	 * each `generateText` call resolves. */
	pending: JobEvent[];
	localIds: Set<string>;
	entityCount: number;
	relationCount: number;
	finished: boolean;
	finishOutcome: 'completed' | 'skipped' | null;
}

export function createDocumentRunContext(jobId: string, documentId: string): DocumentRunContext {
	return {
		jobId,
		documentId,
		step: 0,
		pending: [],
		localIds: new Set(),
		entityCount: 0,
		relationCount: 0,
		finished: false,
		finishOutcome: null
	};
}

export interface CreateImportToolsDeps {
	sources: SourceReader;
	images: ImageStore;
}

/** Builds the eight-tool set for one document's run. `enabled` narrows it to the
 * playbook's declared tool list (playbook.ts); a tool the playbook does not enable is
 * simply absent from the object the model sees, not merely refused at call time. */
export function createImportTools(
	ctx: DocumentRunContext,
	deps: CreateImportToolsDeps,
	enabled: Set<string>
): ToolSet {
	const all: ToolSet = {
		source_list: tool({
			description: "List files under a path in this job's unpacked export.",
			inputSchema: SOURCE_LIST_INPUT,
			execute: async (input) => {
				const entries = await deps.sources.list(input.path);
				return { ok: true as const, entries };
			}
		}),

		source_read: tool({
			description: "Read one file's text by path from this job's unpacked export.",
			inputSchema: SOURCE_READ_INPUT,
			execute: async (input) => {
				try {
					const result = await deps.sources.read(input.path);
					return { ok: true as const, ...result };
				} catch (cause) {
					return {
						ok: false as const,
						error: cause instanceof Error ? cause.message : String(cause)
					};
				}
			}
		}),

		page_image: tool({
			description:
				'Render one page of a PDF to an image so a scanned page can be looked at directly.',
			inputSchema: PAGE_IMAGE_INPUT,
			execute: async (input) => {
				try {
					const rendered = await deps.sources.renderPage(input.path, input.page);
					return { ok: true as const, ...rendered };
				} catch (cause) {
					return {
						ok: false as const,
						error: cause instanceof Error ? cause.message : String(cause)
					};
				}
			},
			toModelOutput: ({ output }) => {
				if (!output.ok) return { type: 'json', value: output };
				return {
					type: 'content',
					value: [
						{
							type: 'text',
							text: JSON.stringify({ ok: true, width: output.width, height: output.height })
						},
						{
							type: 'file',
							data: { type: 'data', data: output.base64 },
							mediaType: output.mimeType
						}
					]
				};
			}
		}),

		image_store: tool({
			description: 'Store an image found in the export by path and get back an asset id to attach.',
			inputSchema: IMAGE_STORE_INPUT,
			execute: async (input) => {
				try {
					const asset = await deps.sources.readBinary(input.path);
					const stored = await deps.images.store({
						sourcePath: input.path,
						mimeType: asset.mimeType,
						base64: asset.base64
					});
					return { ok: true as const, assetId: stored.assetId };
				} catch (cause) {
					return {
						ok: false as const,
						error: cause instanceof Error ? cause.message : String(cause)
					};
				}
			}
		}),

		entity_propose: tool({
			description:
				'Emit a candidate entity, with the source reference and evidence span that produced it.',
			inputSchema: ENTITY_PROPOSE_INPUT,
			execute: async (input) => proposeEntity(ctx, input)
		}),

		relation_propose: tool({
			description:
				'Emit a candidate relation between two entities already proposed in this document.',
			inputSchema: RELATION_PROPOSE_INPUT,
			execute: async (input) => proposeRelation(ctx, input)
		}),

		checkpoint: tool({
			description: 'Record progress on this document so a resumed run does not redo finished work.',
			inputSchema: CHECKPOINT_INPUT,
			execute: async (input) => checkpointDocument(ctx, input)
		}),

		job_finish: tool({
			description: 'Close out this document. Counts are computed by the loop, not reported by you.',
			inputSchema: JOB_FINISH_INPUT,
			execute: async (input) => finishDocument(ctx, input)
		})
	};

	return Object.fromEntries(Object.entries(all).filter(([name]) => enabled.has(name))) as ToolSet;
}

function proposeEntity(ctx: DocumentRunContext, input: z.infer<typeof ENTITY_PROPOSE_INPUT>) {
	if (input.sourceRef.documentId !== ctx.documentId) {
		return {
			ok: false as const,
			error: `sourceRef.documentId "${input.sourceRef.documentId}" does not match this run's document`
		};
	}
	if (ctx.localIds.has(input.localId)) {
		return {
			ok: false as const,
			error: `localId "${input.localId}" was already proposed in this document`
		};
	}
	ctx.localIds.add(input.localId);
	ctx.entityCount += 1;
	const payload: EntityProposalPayload = {
		localId: input.localId,
		type: input.type,
		name: input.name,
		aliases: input.aliases,
		summary: input.summary,
		sourceRef: input.sourceRef,
		evidenceSpan: input.evidenceSpan
	};
	ctx.pending.push({
		type: 'proposal',
		jobId: ctx.jobId,
		documentId: ctx.documentId,
		step: ctx.step,
		proposal: { kind: 'entity', payload }
	});
	return { ok: true as const, localId: input.localId };
}

function proposeRelation(ctx: DocumentRunContext, input: z.infer<typeof RELATION_PROPOSE_INPUT>) {
	if (input.sourceRef.documentId !== ctx.documentId) {
		return {
			ok: false as const,
			error: `sourceRef.documentId "${input.sourceRef.documentId}" does not match this run's document`
		};
	}
	if (!ctx.localIds.has(input.fromLocalId)) {
		return {
			ok: false as const,
			error: `fromLocalId "${input.fromLocalId}" was never proposed in this document`
		};
	}
	if (!ctx.localIds.has(input.toLocalId)) {
		return {
			ok: false as const,
			error: `toLocalId "${input.toLocalId}" was never proposed in this document`
		};
	}
	ctx.relationCount += 1;
	const payload: RelationProposalPayload = {
		fromLocalId: input.fromLocalId,
		toLocalId: input.toLocalId,
		label: input.label,
		inverseLabel: input.inverseLabel,
		cardinality: input.cardinality,
		sourceRef: input.sourceRef,
		evidenceSpan: input.evidenceSpan
	};
	ctx.pending.push({
		type: 'proposal',
		jobId: ctx.jobId,
		documentId: ctx.documentId,
		step: ctx.step,
		proposal: { kind: 'relation', payload }
	});
	return { ok: true as const };
}

function checkpointDocument(ctx: DocumentRunContext, input: z.infer<typeof CHECKPOINT_INPUT>) {
	if (input.documentId !== ctx.documentId) {
		return {
			ok: false as const,
			error: `checkpoint targets "${input.documentId}", not this run's document "${ctx.documentId}"`
		};
	}
	ctx.pending.push({
		type: 'progress',
		jobId: ctx.jobId,
		documentId: ctx.documentId,
		step: ctx.step,
		status: 'running',
		entityCount: ctx.entityCount,
		relationCount: ctx.relationCount,
		detail: input.note ?? 'checkpoint'
	});
	return { ok: true as const };
}

function finishDocument(ctx: DocumentRunContext, input: z.infer<typeof JOB_FINISH_INPUT>) {
	if (input.documentId !== ctx.documentId) {
		return {
			ok: false as const,
			error: `job_finish targets "${input.documentId}", not this run's document "${ctx.documentId}"`
		};
	}
	ctx.finished = true;
	ctx.finishOutcome = input.outcome;
	ctx.pending.push({
		type: 'progress',
		jobId: ctx.jobId,
		documentId: ctx.documentId,
		step: ctx.step,
		status: 'finished',
		entityCount: ctx.entityCount,
		relationCount: ctx.relationCount,
		detail: input.outcome
	});
	return { ok: true as const, entityCount: ctx.entityCount, relationCount: ctx.relationCount };
}
