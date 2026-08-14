/**
 * The seam of SPEC.md §11.2 and AGENTS.md's "one rule about packages/import that is easy
 * to break and expensive to fix": nothing outside this package knows which driver runs
 * behind `startJob`/`cancel`, and no provider or protocol type leaks past this file.
 * `GatewayDriver` (gateway-driver.ts, issue #23) is the only implementation that exists
 * yet; `SpoleDriver` (issue #34, deferred) will implement the same interface without
 * adding a single field here.
 *
 * SPEC.md §11.2 writes the interface as illustrative pseudocode,
 * `startJob(playbook, documents, budget) -> stream of {...}` and `cancel(jobId)`. Two
 * things that pseudocode elides but a real driver needs: a job id `cancel` can address
 * (assigned by whoever owns `import_job.id`, generally before the driver runs), and the
 * per-job read/write halves of the tool surface that SPEC.md §6.1 keeps out of the
 * model's hands (`sources`, `images` - issues #25 and #40). Both are folded into the
 * single `ImportJob` argument below rather than added as new positional parameters,
 * which is a documented deviation from the pseudocode's exact arity, not from its
 * meaning: `startJob` still takes a playbook, a document list and a budget, structured
 * as one object instead of three arguments.
 */
import type { LoadedPlaybook } from './playbook.js';
import type { SourceReader } from './sources.js';
import type { ImageStore } from './images.js';

/** One document, the unit of work SPEC.md §6.1 requires: "never the whole world, so
 * context cannot grow with the size of the export." */
export interface JobDocument {
	id: string;
	/** Path into this job's `SourceReader` where the document starts. */
	sourcePath: string;
	/** issue #24: this document runs on the premium purpose instead of the playbook's
	 * default, because the playbook's own `hardBytesThreshold` (playbook.ts) marked it
	 * hard. Set by whoever enumerates a job's documents, never by the model. */
	hard?: boolean;
}

/** Credit ceiling for the whole job (SPEC.md §6.7, §15: "a per-job ceiling... a clean
 * stop when it is reached with the proposals so far intact"), in the same credit unit
 * as `operation_price`/`proposal.credits`/`model_call.credits`. */
export interface JobBudget {
	maxCredits: number;
}

export interface EntityProposalPayload {
	localId: string;
	type: 'character' | 'place' | 'faction' | 'item' | 'event' | 'session';
	name: string;
	aliases: string[];
	summary: string;
	sourceRef: { documentId: string; path: string };
	evidenceSpan: { start: number; end: number };
	/** Asset ids returned by `image_store` (issue #40) that belong to this entity. Empty
	 * for the common case of a document with no images. */
	images: string[];
}

export interface RelationProposalPayload {
	fromLocalId: string;
	toLocalId: string;
	label: string;
	inverseLabel: string;
	cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
	sourceRef: { documentId: string; path: string };
	evidenceSpan: { start: number; end: number };
}

/** Mirrors `import_job_status` (packages/db/src/schema/enums.ts) for the statuses that
 * apply to a single document's run within a job; the driver never touches that column
 * itself ("Shape is the driver's, and the database does not read it" - source.ts's
 * comment on `import_job.checkpoint`), but reusing its vocabulary keeps the two sides
 * of the seam speaking the same language. */
export type DocumentStatus = 'running' | 'finished' | 'stopped_at_ceiling' | 'cancelled' | 'failed';

export type JobEvent =
	| {
			type: 'proposal';
			jobId: string;
			documentId: string;
			step: number;
			proposal:
				| { kind: 'entity'; payload: EntityProposalPayload }
				| { kind: 'relation'; payload: RelationProposalPayload };
	  }
	| {
			type: 'progress';
			jobId: string;
			documentId: string;
			step: number;
			status: DocumentStatus;
			/** Counts computed by the driver from what actually ran in this document, never
			 * from a value the model claimed (SPEC.md §6.5, issue #33). */
			entityCount: number;
			relationCount: number;
			detail: string;
	  }
	| {
			type: 'usage';
			jobId: string;
			documentId: string;
			step: number;
			purpose: string;
			provider: string;
			modelId: string;
			inputTokens: number;
			outputTokens: number;
			credits: number;
			costEur: number;
	  };

/** A `startJob` return value is a stream, decorated with the id `cancel` addresses -
 * the id is available synchronously, before the first event is awaited. */
export interface JobStream extends AsyncIterable<JobEvent> {
	readonly jobId: string;
}

export interface ImportJob {
	id: string;
	playbook: LoadedPlaybook;
	documents: JobDocument[];
	budget: JobBudget;
	sources: SourceReader;
	images: ImageStore;
}

export interface ImportDriver {
	startJob(job: ImportJob): JobStream;
	cancel(jobId: string): void;
}
