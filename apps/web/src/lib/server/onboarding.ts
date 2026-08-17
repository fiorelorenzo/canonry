/**
 * Issue #108: onboarding that ends in a first accepted proposal. Decision D7 = A
 * (docs/ux/DECISIONS.md): import first, with a real pre-indexed-universe fallback for a
 * GM with nothing to import. This file is the server-side plumbing shared by
 * apps/web/src/routes/onboarding/**:
 *
 * - universe creation (there was no creation UI anywhere before this issue);
 * - D1 (decision "C, detect then confirm"): sniffing an uploaded export's shape;
 * - D2 (decision "B, live feed of proposals"): an estimate before spending, then a real
 *   import job whose proposals stream in while it still runs;
 * - the driver seam packages/import documents in driver.ts: "nothing outside this
 *   package knows which driver runs behind startJob/cancel". Production wiring uses the
 *   real GatewayDriver, exactly like packages/copilot, packages/indexing and
 *   packages/warm now can (@canonry/ai's createLanguageModel, the composition root that
 *   was missing until this wave). This box has no AI_GATEWAY_* credentials, so
 *   DeterministicExtractionDriver below stands in for a live model, and every place that
 *   matters says so.
 *
 * SPEC.md §14's second metric, "time from import to first accepted proposal", needs no
 * new columns: import_job.created_at/started_at and proposal.decided_at (set by
 * @canonry/db's acceptProposal) are already the rows that answer it, and
 * packages/db/src/queries/metrics.ts's importsToFirstAcceptedProposal already reads them.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import {
	acceptAnyImportProposal as dbAcceptAnyImportProposal,
	admitAndCreateImportJob,
	ArchiveSourceReader,
	DbModelSelector,
	DEFAULT_ARCHIVE_LIMITS,
	estimateImportJob,
	GatewayDriver,
	ImportJobRunner,
	ImportQuotaExceededError,
	InMemoryImageStore,
	lexicalTrigramSimilarity,
	loadBuiltinPlaybook,
	type AcceptImportProposalInput,
	type EntityProposalPayload,
	type GatewayWrapper,
	type ImportDriver,
	type ImportJob as DriverImportJob,
	type ImportModelPurpose,
	type JobDocument,
	type JobEvent,
	type LoadedPlaybook,
	type ModelSelector,
	type RelationProposalPayload,
	type RunImportJobParams,
	type SourceReader
} from '@canonry/import';
import { hashingEmbedder } from '@canonry/indexing';
import { createLanguageModel, readGatewayCredentials, resolveModel } from '@canonry/ai';
import { detectLanguage } from '@canonry/lang';
import { and, desc, eq, type Db } from '@canonry/db';
import { importJob, proposal, proposalPlan, universe } from '@canonry/db/schema';
import type { EntityType, ProposalKind } from '@canonry/db/schema';

export {
	loadBuiltinPlaybook,
	estimateImportJob,
	admitAndCreateImportJob,
	ImportQuotaExceededError
};

// ---------------------------------------------------------------------------------------
// Universe creation (issue #108's other half: there is no creation UI anywhere yet).
// ---------------------------------------------------------------------------------------

export class UniverseNameRequiredError extends Error {
	constructor() {
		super('a universe needs a name');
		this.name = 'UniverseNameRequiredError';
	}
}

function slugifyUniverseName(name: string): string {
	const base = name
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base.length > 0 ? base : 'universe';
}

/** drizzle-orm wraps postgres.js's own error as `.cause` on the DrizzleQueryError it
 * throws (packages/db's warm.ts and supersede.ts check the same shape) - the SQLSTATE
 * lives on `err.cause.code`, not `err.code` itself, which this previously checked and
 * which is never present on the wrapper, so a real collision fell straight through to a
 * 500 rather than ever retrying. Fixed as part of #153 verification: 23505 is
 * unique_violation. `universe_slug_key` is now a global unique index on slug alone
 * (decision J1, issue #153), so this races two different accounts picking the same name
 * at once as well as the same account twice - cheap to retry either way rather than
 * worth a transaction-level lock. */
function isUniqueSlugViolation(err: unknown): boolean {
	if (typeof err !== 'object' || err === null || !('cause' in err)) return false;
	const cause = err.cause;
	if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;
	return cause.code === '23505';
}

export interface CreateUniverseInput {
	userId: string;
	name: string;
	kind: 'homebrew' | 'derived';
	baseUniverseId?: string | null;
}

export type UniverseRow = typeof universe.$inferSelect;

/** Inserts a new universe row, retrying with a numeric suffix on a slug collision.
 * `universe.slug` is globally unique (decision J1, issue #153: a world's URL carries no
 * owner), so the collision this retries against may be a different account's universe,
 * not just this one's own past creations - the mechanism does not change, only how wide
 * the index it races against is. `kind: 'derived'` requires `baseUniverseId` - the
 * schema's own check constraint (`universe_derived_has_base`) enforces that regardless,
 * this just fails with the same UniverseNameRequiredError-adjacent honesty rather than a
 * raw constraint error. */
export async function createOnboardingUniverse(
	database: Db,
	input: CreateUniverseInput
): Promise<UniverseRow> {
	const trimmedName = input.name.trim();
	if (trimmedName.length === 0) throw new UniverseNameRequiredError();
	const base = slugifyUniverseName(trimmedName);

	for (let attempt = 0; attempt < 25; attempt++) {
		const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
		try {
			const [row] = await database
				.insert(universe)
				.values({
					ownerUserId: input.userId,
					name: trimmedName,
					slug,
					kind: input.kind,
					baseUniverseId: input.kind === 'derived' ? (input.baseUniverseId ?? null) : null
				})
				.returning();
			if (!row) throw new Error('createOnboardingUniverse: insert returned no row');
			return row;
		} catch (err) {
			if (isUniqueSlugViolation(err)) continue;
			throw err;
		}
	}
	throw new Error(`createOnboardingUniverse: could not find a free slug for "${trimmedName}"`);
}

/** D7 option B, "the pre-indexed universe path as a real fallback": the real indexed
 * catalogue SPEC.md §7 describes (issues #57-#59) does not exist yet in this codebase -
 * seed-fixture.ts's own comment on the "forgotten-realms" row says it "stands in for the
 * official pre-indexed universe... until then a derived universe still needs a base to
 * point at". There is no schema flag marking a universe as a valid base (that catalogue
 * is out of this issue's scope), so this resolves one fixed, documented slug rather than
 * guessing at a query over other accounts' private universes. Returns null rather than
 * throwing when it is absent (a fresh, unseeded database), so the fallback option simply
 * does not render instead of crashing the choice screen. */
const PRE_INDEXED_BASE_SLUG = env.PRE_INDEXED_BASE_UNIVERSE_SLUG || 'forgotten-realms';

export async function findPreIndexedBaseUniverse(database: Db): Promise<UniverseRow | null> {
	const [row] = await database
		.select()
		.from(universe)
		.where(eq(universe.slug, PRE_INDEXED_BASE_SLUG))
		.limit(1);
	return row ?? null;
}

// ---------------------------------------------------------------------------------------
// Uploaded artefact storage. Mirrors packages/media's readMediaRoot convention: a
// documented env override, a default under the process cwd's .data/ directory.
// ---------------------------------------------------------------------------------------

function importRoot(): string {
	return env.IMPORT_ROOT && env.IMPORT_ROOT.length > 0
		? env.IMPORT_ROOT
		: path.join(process.cwd(), '.data', 'imports');
}

export interface StoredUpload {
	tempId: string;
	bytes: number;
}

/** Where an uploaded artefact lives on disk, keyed by the id storeUpload returned - the
 * name stays "temp" in the sense that nothing renames it once a real import_job claims
 * it, `import_job.artefact_path` just points straight at it. Exported: storeUpload and
 * every route that re-opens an upload for detection or for the real run need the same
 * path for the same id. */
export function tempUploadPath(tempId: string): string {
	return path.join(importRoot(), `${tempId}.upload`);
}

/** Stores an uploaded file's raw bytes under a temp name before an import_job row (and
 * therefore a real id) exists - D1's confirm step needs to re-open the same archive after
 * the detect step without asking the GM to upload twice. */
export async function storeUpload(bytes: Uint8Array): Promise<StoredUpload> {
	const root = importRoot();
	await mkdir(root, { recursive: true });
	const tempId = randomUUID();
	await writeFile(tempUploadPath(tempId), bytes);
	return { tempId, bytes: bytes.byteLength };
}

// ---------------------------------------------------------------------------------------
// D1 = C, "detect then confirm": sniffs an uploaded archive's shape. Pure archive
// introspection, no model involved - the same "unpack, walk it" side of SPEC.md §6.1's
// envelope table the real ArchiveSourceReader already lives on.
// ---------------------------------------------------------------------------------------

export const KNOWN_PLAYBOOK_IDS = [
	'obsidian',
	'kanka',
	'world-anvil',
	'onenote',
	'pdf',
	'docx',
	'generic'
] as const;
export type KnownPlaybookId = (typeof KNOWN_PLAYBOOK_IDS)[number];

export const PLAYBOOK_LABELS: Record<KnownPlaybookId, string> = {
	obsidian: 'Obsidian',
	kanka: 'Kanka',
	'world-anvil': 'World Anvil',
	onenote: 'OneNote',
	pdf: 'PDF',
	docx: 'DOCX',
	generic: 'Something else'
};

/** Which playbooks DeterministicExtractionDriver can actually run without a live model -
 * see that class's own doc comment. Gates the "start import" action so a GM who picks
 * World Anvil, OneNote, PDF or DOCX on this deployment sees why, rather than a run that silently
 * produces zero proposals. */
export const FAKE_DRIVER_SUPPORTED_PLAYBOOKS: ReadonlySet<KnownPlaybookId> = new Set([
	'obsidian',
	'kanka',
	'generic'
]);

export interface DetectedSource {
	playbookId: KnownPlaybookId;
	confident: boolean;
	detail: string;
}

async function walkAllPaths(reader: SourceReader, prefix = ''): Promise<string[]> {
	const entries = await reader.list(prefix);
	const out: string[] = [];
	for (const entry of entries) {
		if (entry.kind === 'file') out.push(entry.path);
		else out.push(...(await walkAllPaths(reader, entry.path)));
	}
	return out;
}

async function looksLikeKankaExport(reader: SourceReader, jsonPaths: string[]): Promise<boolean> {
	// SPEC.md §6.9 / playbooks/kanka.md: each file is a JSON array of records sharing one
	// `entity_type` field - Kanka's own export shape, not a guess at file naming.
	for (const p of jsonPaths.slice(0, 6)) {
		try {
			const { content } = await reader.read(p);
			const parsed: unknown = JSON.parse(content);
			if (
				Array.isArray(parsed) &&
				parsed.some((r) => r && typeof r === 'object' && 'entity_type' in r)
			) {
				return true;
			}
		} catch {
			// Not JSON, or not shaped like a Kanka record - keep looking at the next file.
		}
	}
	return false;
}

/** Given the uploaded archive's own contents, guesses which playbook applies. Never the
 * final word - D1's whole point is that the GM confirms or overrides this in a dropdown
 * before anything runs. */
export async function detectSource(reader: SourceReader): Promise<DetectedSource> {
	const paths = (await walkAllPaths(reader)).filter((p) => !p.startsWith('__MACOSX/'));
	const lower = paths.map((p) => p.toLowerCase());

	if (lower.some((p) => p.split('/').includes('.obsidian'))) {
		const notes = lower.filter((p) => p.endsWith('.md')).length;
		return {
			playbookId: 'obsidian',
			confident: true,
			detail: `${notes} note(s), .obsidian folder found`
		};
	}

	const jsonPaths = paths.filter((p) => p.toLowerCase().endsWith('.json'));
	if (jsonPaths.length > 0 && (await looksLikeKankaExport(reader, jsonPaths))) {
		return {
			playbookId: 'kanka',
			confident: true,
			detail: `${jsonPaths.length} JSON file(s), entity_type field found`
		};
	}

	const hasJsonFolder = lower.some((p) => p.startsWith('json/'));
	const hasHtmlFolder = lower.some((p) => p.startsWith('html/'));
	if (hasJsonFolder && hasHtmlFolder) {
		return {
			playbookId: 'world-anvil',
			confident: true,
			detail: 'json/ and html/ folders found, matching a Full World Export'
		};
	}

	const htmlPaths = paths.filter((p) => /\.html?$/i.test(p));
	if (htmlPaths.length > 0) {
		// onenote.md: an embedded attachment lives beside its page in a folder named after
		// the page with "_files" appended (notebook/section/page_files/image.png) - the
		// shape OneNote's own GetHierarchy/Publish export produces and no other source
		// mimics, so it is a stronger signal than a bare ".htm" file would be.
		const htmlStems = new Set(htmlPaths.map((p) => p.replace(/\.html?$/i, '')));
		const hasAttachmentFolder = paths.some((p) => {
			const match = /^(.*)_files\//.exec(p);
			return match !== null && htmlStems.has(match[1] ?? '');
		});
		if (hasAttachmentFolder) {
			return {
				playbookId: 'onenote',
				confident: true,
				detail: `${htmlPaths.length} exported page(s), sibling _files/ folder(s) found`
			};
		}
	}

	const mdPaths = paths.filter((p) => p.toLowerCase().endsWith('.md'));
	if (paths.length > 0 && mdPaths.length === paths.length) {
		return {
			playbookId: 'obsidian',
			confident: false,
			detail: `${mdPaths.length} Markdown file(s), no .obsidian folder found`
		};
	}

	if (paths.length === 1 && paths[0]!.toLowerCase().endsWith('.pdf')) {
		return { playbookId: 'pdf', confident: true, detail: 'one PDF file' };
	}
	if (paths.length === 1 && paths[0]!.toLowerCase().endsWith('.docx')) {
		return { playbookId: 'docx', confident: true, detail: 'one DOCX file' };
	}

	return {
		playbookId: 'generic',
		confident: false,
		detail: `${paths.length} file(s), no known export schema`
	};
}

// ---------------------------------------------------------------------------------------
// Enumerating the documents a playbook will process, for the estimate step. Pure archive
// introspection again - this is what "214 documents" in D2's estimate card comes from.
// ---------------------------------------------------------------------------------------

export async function documentsForPlaybook(
	playbookId: KnownPlaybookId,
	reader: SourceReader
): Promise<JobDocument[]> {
	const paths = (await walkAllPaths(reader)).filter((p) => !p.startsWith('__MACOSX/'));

	if (playbookId === 'kanka') {
		const jsonPaths = paths.filter((p) => p.toLowerCase().endsWith('.json'));
		const docs: JobDocument[] = [];
		for (const p of jsonPaths) {
			try {
				const { content } = await reader.read(p);
				const parsed: unknown = JSON.parse(content);
				if (
					Array.isArray(parsed) &&
					parsed.some((r) => r && typeof r === 'object' && 'entity_type' in r)
				) {
					docs.push({ id: `doc-${docs.length + 1}`, sourcePath: p });
				}
			} catch {
				// Not a Kanka per-type JSON file (e.g. a stray non-export json) - skip it.
			}
		}
		return docs;
	}

	if (playbookId === 'obsidian' || playbookId === 'generic') {
		return paths
			.filter((p) => !p.toLowerCase().split('/').includes('.obsidian'))
			.filter((p) => /\.(md|txt)$/i.test(p))
			.map((p, i) => ({ id: `doc-${i + 1}`, sourcePath: p }));
	}

	if (playbookId === 'world-anvil') {
		const jsonPaths = paths.filter(
			(p) => p.toLowerCase().startsWith('json/') && p.toLowerCase().endsWith('.json')
		);
		return jsonPaths.map((p, i) => ({ id: `doc-${i + 1}`, sourcePath: p }));
	}

	if (playbookId === 'onenote') {
		// Each exported page is its own document (onenote.md's Inputs section: "you are
		// bound to exactly one page"). A "<page>_files" folder holds only that page's own
		// embedded attachments, never another page, so filtering to .htm/.html already
		// excludes it - the extra segment check is belt and suspenders, the same
		// distinction onenote.md itself draws for the model.
		return paths
			.filter((p) => /\.html?$/i.test(p))
			.filter((p) => !p.split('/').some((segment) => segment.endsWith('_files')))
			.map((p, i) => ({ id: `doc-${i + 1}`, sourcePath: p }));
	}

	// pdf / docx: one document per matching file. ArchiveSourceReader.read() already runs
	// the real, deterministic text extraction (pdfjs-dist / mammoth) for these - the model
	// only enters the picture for a *scanned* page (SPEC.md §6.6's page_image path), which
	// this issue's fake driver does not attempt.
	const ext = playbookId === 'pdf' ? '.pdf' : '.docx';
	return paths
		.filter((p) => p.toLowerCase().endsWith(ext))
		.map((p, i) => ({ id: `doc-${i + 1}`, sourcePath: p }));
}

// ---------------------------------------------------------------------------------------
// D2 = B's estimate. job-runner.ts's EstimateImportJobInput doc comment: "historical
// average, supplied by the caller... never invented here." Onboarding is a cold start by
// definition (nobody has ever run this playbook on this deployment yet), so a documented
// conservative default stands in only until real import_job rows exist to average.
// ---------------------------------------------------------------------------------------

const COLD_START_ESTIMATE: Record<
	KnownPlaybookId,
	{ avgCreditsPerDocument: number; avgSecondsPerDocument: number }
> = {
	kanka: { avgCreditsPerDocument: 0.2, avgSecondsPerDocument: 8 },
	obsidian: { avgCreditsPerDocument: 0.25, avgSecondsPerDocument: 12 },
	onenote: { avgCreditsPerDocument: 0.25, avgSecondsPerDocument: 12 },
	'world-anvil': { avgCreditsPerDocument: 0.3, avgSecondsPerDocument: 15 },
	pdf: { avgCreditsPerDocument: 0.5, avgSecondsPerDocument: 25 },
	docx: { avgCreditsPerDocument: 0.4, avgSecondsPerDocument: 20 },
	generic: { avgCreditsPerDocument: 0.3, avgSecondsPerDocument: 15 }
};

export async function estimateAveragesFor(
	database: Db,
	playbookId: KnownPlaybookId
): Promise<{ avgCreditsPerDocument: number; avgSecondsPerDocument: number }> {
	const rows = await database
		.select({
			documentCount: importJob.documentCount,
			spentCredits: importJob.spentCredits,
			startedAt: importJob.startedAt,
			finishedAt: importJob.finishedAt
		})
		.from(importJob)
		.where(and(eq(importJob.playbook, playbookId), eq(importJob.status, 'finished')))
		.orderBy(desc(importJob.createdAt))
		.limit(20);

	const withDocs = rows.filter((r) => r.documentCount > 0);
	if (withDocs.length === 0) return COLD_START_ESTIMATE[playbookId];

	const totalDocs = withDocs.reduce((sum, r) => sum + r.documentCount, 0);
	const totalCredits = withDocs.reduce((sum, r) => sum + r.spentCredits, 0);
	const totalSeconds = withDocs.reduce((sum, r) => {
		if (!r.startedAt || !r.finishedAt) return sum;
		return sum + (r.finishedAt.getTime() - r.startedAt.getTime()) / 1000;
	}, 0);

	return {
		avgCreditsPerDocument:
			totalCredits > 0
				? totalCredits / totalDocs
				: COLD_START_ESTIMATE[playbookId].avgCreditsPerDocument,
		avgSecondsPerDocument:
			totalSeconds > 0
				? totalSeconds / totalDocs
				: COLD_START_ESTIMATE[playbookId].avgSecondsPerDocument
	};
}

// ---------------------------------------------------------------------------------------
// Driver + similarity selection. Production wiring uses the real GatewayDriver - the
// composition root (@canonry/ai's createLanguageModel) every package's injected factory
// seam was waiting for now exists. This box has no AI_GATEWAY_* credentials (checked,
// 2026-08-14: unset), so hasLiveGatewayCredentials() is false here and every run this
// issue's own verification exercises goes through DeterministicExtractionDriver instead -
// see that class's own doc comment for exactly what it fakes and what it does not.
// ---------------------------------------------------------------------------------------

export function hasLiveGatewayCredentials(): boolean {
	// One key since the Vercel gateway switch (issue #97): the account/gateway pair was
	// Cloudflare's routing shape and no longer exists. Checking the dead vars here would have
	// reported 'no credentials' on a correctly configured box.
	return Boolean(env.AI_GATEWAY_API_KEY);
}

export function resolveImportDriver(database: Db): { driver: ImportDriver; isFake: boolean } {
	if (!hasLiveGatewayCredentials()) {
		return { driver: new DeterministicExtractionDriver(), isFake: true };
	}
	// $env/dynamic/private's `env` is a plain Record<string, string | undefined>, the same
	// shape readGatewayCredentials reads field-by-field as NodeJS.ProcessEnv; the interface
	// itself is what refuses to be satisfied structurally without a cast.
	const processEnvShaped = env as NodeJS.ProcessEnv;
	const credentials = readGatewayCredentials(processEnvShaped);
	const models: ModelSelector = new DbModelSelector({
		resolvePurpose: async (purpose: ImportModelPurpose) => {
			const resolved = await resolveModel(database, purpose);
			return { provider: resolved.provider, modelId: resolved.modelId, params: resolved.params };
		},
		createLanguageModel: (provider, modelId) => createLanguageModel(provider, modelId, credentials)
	});
	// Identity: createLanguageModel above already wraps the model with the gateway
	// (packages/ai/src/composition.ts's own `gateway(factory(modelId))`), so applying a
	// second, non-identity wrapper here would double-wrap the same call.
	const identityGateway: GatewayWrapper = (model) => model;
	return { driver: new GatewayDriver({ gateway: identityGateway, models }), isFake: false };
}

/** matching.ts's own doc comment on lexicalTrigramSimilarity: "not production code... the
 * real similarity function, wired once real embedding credentials exist". No embedding-
 * backed SimilarityFn exists anywhere in packages/import yet (unlike the driver seam,
 * nobody built that composition root this wave), so this is a second, distinct gap from
 * the driver one above rather than the same env-var check. */
export const importMatchSimilarity = lexicalTrigramSimilarity;

export const MATCH_THRESHOLDS = { matchAbove: 0.85, newBelow: 0.5 };

// ---------------------------------------------------------------------------------------
// DeterministicExtractionDriver: implements packages/import's ImportDriver directly - the
// same seam driver.ts documents SpoleDriver will eventually fill ("nothing outside this
// package knows which driver runs behind startJob/cancel"). It is not an AI SDK model and
// makes no network call: for a Kanka export it parses the real JSON records and maps them
// through the exact table playbooks/kanka.md specifies; for Markdown/PDF/DOCX/generic text
// it takes the first heading (or first line) as a name and the rest as a summary. Every
// entity and relation it proposes is grounded in real bytes from the uploaded export - the
// dishonesty a fake model risks (guardrail 1: "a demo that fakes the click to look fast is
// worse than a slower path that is honest") is a fabricated *decision*, not a
// deterministic *rule*, and this driver only ever applies the latter. A short artificial
// delay between documents is the one thing here that is not "real": a live model's own
// network latency would otherwise be what makes D2 = B's live feed have anything to watch
// arrive, and FAKE_STEP_DELAY_MS stands in for that, nothing else.
// ---------------------------------------------------------------------------------------

const FAKE_STEP_DELAY_MS = 700;

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The uploaded export is untrusted content (SPEC.md §6.5), so every read off its parsed
 * JSON goes through a runtime check rather than an assertion of a shape nobody verified. */
function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
function readString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' ? value : undefined;
}
function readNumberOrString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	return undefined;
}
function readArray(record: Record<string, unknown>, key: string): unknown[] {
	const value = record[key];
	return Array.isArray(value) ? value : [];
}

const KANKA_TYPE_MAP: Record<string, EntityType | undefined> = {
	character: 'character',
	location: 'place',
	organisation: 'faction',
	family: 'faction',
	item: 'item',
	event: 'event',
	journal: 'session',
	quest: 'event'
};

// playbooks/kanka.md's own worked examples ("Rival" -> rival/rival, "Reports to" ->
// reports to/commands); anything else falls back to a symmetric generic label rather than
// inventing a directional one it cannot ground in anything.
const KANKA_RELATION_LABELS: Record<string, { label: string; inverseLabel: string }> = {
	protects: { label: 'protects', inverseLabel: 'protected by' },
	leads: { label: 'leads', inverseLabel: 'led by' },
	rival: { label: 'rival', inverseLabel: 'rival' },
	'reports to': { label: 'reports to', inverseLabel: 'commands' }
};

interface FakeExtraction {
	entities: EntityProposalPayload[];
	relations: RelationProposalPayload[];
}

function extractKankaDocument(
	documentId: string,
	sourcePath: string,
	content: string
): FakeExtraction {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return { entities: [], relations: [] };
	}
	if (!Array.isArray(parsed)) return { entities: [], relations: [] };
	const records = parsed.map(asRecord);
	// issue #126, SPEC.md §17: this fallback driver is the "no AI_GATEWAY_* credentials"
	// stand-in for the real GatewayDriver (this file's own doc comment), so it detects
	// per document the same way that real loop does - the whole document's own text,
	// stamped onto every entity it proposes, never the interface's locale.
	const documentLanguage = detectLanguage(content);

	const entities: EntityProposalPayload[] = [];
	const localIdByEntityId = new Map<string, string>();

	records.forEach((record, index) => {
		if (!record) return;
		const kankaType = readString(record, 'entity_type');
		const mappedType = kankaType ? KANKA_TYPE_MAP[kankaType] : undefined;
		const name = readString(record, 'name');
		if (!mappedType || !name) return; // unmapped Kanka type (playbooks/kanka.md's own table): do not propose it.

		const localId = `${documentId}-e${index}`;
		const entityId = readNumberOrString(record, 'entity_id');
		if (entityId) localIdByEntityId.set(entityId, localId);

		const entry = readString(record, 'entry');
		const summary = entry ? stripHtml(entry) : `${name} appears in this export.`;
		entities.push({
			localId,
			type: mappedType,
			name,
			aliases: [],
			summary,
			sourceRef: { documentId, path: sourcePath },
			evidenceSpan: { start: 0, end: Math.min(summary.length, 400) },
			images: [],
			language: documentLanguage
		});
	});

	const relations: RelationProposalPayload[] = [];
	records.forEach((record, index) => {
		if (!record) return;
		const ownEntityId = readNumberOrString(record, 'entity_id');
		if (!ownEntityId || !localIdByEntityId.has(ownEntityId)) return;
		const fromLocalId = `${documentId}-e${index}`;
		const entry = readString(record, 'entry') ?? '';

		for (const rawRelation of readArray(record, 'relations')) {
			const relationRecord = asRecord(rawRelation);
			if (!relationRecord) continue;
			const targetId = readNumberOrString(relationRecord, 'target_id');
			const relationLabel = readString(relationRecord, 'relation');
			if (!targetId || !relationLabel) continue;
			// Only same-document targets resolve to a localId this run can use - a target in
			// a sibling file is a real Kanka case (kanka.md's own "propose a minimal entity
			// for it" step) this driver simplifies away; job-runner.ts would drop it anyway
			// on a first import, since neither side is an accepted entity yet.
			const toLocalId = localIdByEntityId.get(targetId);
			if (!toLocalId) continue;
			const known = KANKA_RELATION_LABELS[relationLabel.toLowerCase()];
			relations.push({
				fromLocalId,
				toLocalId,
				label: known?.label ?? relationLabel.toLowerCase(),
				inverseLabel: known?.inverseLabel ?? relationLabel.toLowerCase(),
				cardinality: 'many_to_many',
				sourceRef: { documentId, path: sourcePath },
				evidenceSpan: { start: 0, end: Math.min(entry.length, 400) }
			});
		}
	});

	return { entities, relations };
}

function entityTypeFromPath(sourcePath: string): EntityType {
	const lower = sourcePath.toLowerCase();
	if (lower.includes('/locations/') || lower.includes('/places/')) return 'place';
	if (lower.includes('/factions/') || lower.includes('/organisations/')) return 'faction';
	if (lower.includes('/items/')) return 'item';
	if (lower.includes('/events/') || lower.includes('/sessions/')) return 'event';
	return 'character';
}

/** Markdown, plain text, and the already-extracted text of a PDF/DOCX entry (§6.1's
 * "unpack, render PDF pages, extract embedded images" is deterministic code - and
 * ArchiveSourceReader.read() already ran that real extraction before this ever sees the
 * content). One entity per document: the heading (or first line) is the name, the first
 * real paragraph is the summary. No relation_propose here - see this module's own doc
 * comment for why that is a deliberately scoped-down simplification, not a bug. */
function extractFreeTextDocument(
	documentId: string,
	sourcePath: string,
	content: string
): FakeExtraction {
	const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');
	// issue #126, SPEC.md §17: same per-document detection the real GatewayDriver runs
	// (see extractKankaDocument's own comment above).
	const documentLanguage = detectLanguage(content);
	const lines = withoutFrontmatter
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return { entities: [], relations: [] };

	const headingLine = lines.find((line) => line.startsWith('#'));
	const filenameStem =
		sourcePath
			.split('/')
			.pop()
			?.replace(/\.(md|txt)$/i, '') ?? sourcePath;
	const name = headingLine ? headingLine.replace(/^#+\s*/, '').trim() : filenameStem;

	const summaryLine = lines.find(
		(line) =>
			line !== headingLine &&
			!line.startsWith('#') &&
			!line.startsWith('![[') &&
			!/^[A-Za-z ]+::/.test(line)
	);
	const summary = summaryLine
		? summaryLine.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
		: `${name}, from ${sourcePath}.`;

	return {
		entities: [
			{
				localId: `${documentId}-e0`,
				type: entityTypeFromPath(sourcePath),
				name,
				aliases: [],
				summary,
				sourceRef: { documentId, path: sourcePath },
				evidenceSpan: { start: 0, end: Math.min(summary.length, 400) },
				images: [],
				language: documentLanguage
			}
		],
		relations: []
	};
}

const WORLD_ANVIL_TEMPLATE_MAP: Record<string, EntityType> = {
	settlement: 'place',
	location: 'place',
	condition: 'event',
	organization: 'faction',
	organisation: 'faction',
	character: 'character',
	person: 'character',
	item: 'item',
	document: 'item'
};

async function extractWorldAnvilDocument(
	documentId: string,
	jsonPath: string,
	jsonContent: string,
	sources: SourceReader
): Promise<FakeExtraction> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonContent);
	} catch {
		return { entities: [], relations: [] };
	}
	// issue #126, SPEC.md §17: detected on the document the real driver would see
	// (`document.sourcePath` resolves to this JSON file, not its HTML sibling - see
	// extractKankaDocument's own comment above for why this mirrors GatewayDriver).
	const documentLanguage = detectLanguage(jsonContent);
	const meta = asRecord(parsed);
	const title = meta ? readString(meta, 'title') : undefined;
	if (!meta || !title) return { entities: [], relations: [] };

	const htmlPath = jsonPath.replace(/^json\//i, 'html/').replace(/\.json$/i, '.html');
	let summary = `${title}, from ${jsonPath}.`;
	try {
		const { content } = await sources.read(htmlPath);
		const stripped = stripHtml(content);
		if (stripped.length > 0) summary = stripped;
	} catch {
		// Sibling HTML entry missing or unreadable - keep the title-only summary above.
	}

	const template = readString(meta, 'template');
	const type = template
		? (WORLD_ANVIL_TEMPLATE_MAP[template.toLowerCase()] ?? 'character')
		: 'character';
	return {
		entities: [
			{
				localId: `${documentId}-e0`,
				type,
				name: title,
				aliases: [],
				summary,
				sourceRef: { documentId, path: jsonPath },
				evidenceSpan: { start: 0, end: Math.min(summary.length, 400) },
				images: [],
				language: documentLanguage
			}
		],
		relations: []
	};
}

async function extractDeterministic(
	playbookId: string,
	documentId: string,
	sourcePath: string,
	sources: SourceReader
): Promise<FakeExtraction> {
	const { content } = await sources.read(sourcePath);
	if (playbookId === 'kanka') return extractKankaDocument(documentId, sourcePath, content);
	if (playbookId === 'world-anvil') {
		return extractWorldAnvilDocument(documentId, sourcePath, content, sources);
	}
	return extractFreeTextDocument(documentId, sourcePath, content);
}

export class DeterministicExtractionDriver implements ImportDriver {
	private readonly cancelled = new Set<string>();

	startJob(job: DriverImportJob) {
		const jobId = job.id;
		const cancelled = this.cancelled;
		const playbookId = job.playbook.id;

		async function* generate(): AsyncGenerator<JobEvent> {
			let step = 0;
			for (const document of job.documents) {
				if (cancelled.has(jobId)) return;
				step += 1;
				yield {
					type: 'progress',
					jobId,
					documentId: document.id,
					step,
					status: 'running',
					entityCount: 0,
					relationCount: 0,
					detail: `reading ${document.sourcePath}`
				};

				const { promise: paused, resolve: unpause } = Promise.withResolvers<void>();
				setTimeout(unpause, FAKE_STEP_DELAY_MS);
				await paused;
				if (cancelled.has(jobId)) return;

				const extraction = await extractDeterministic(
					playbookId,
					document.id,
					document.sourcePath,
					job.sources
				);

				for (const payload of extraction.entities) {
					if (cancelled.has(jobId)) return;
					step += 1;
					yield {
						type: 'proposal',
						jobId,
						documentId: document.id,
						step,
						proposal: { kind: 'entity', payload }
					};
				}
				for (const payload of extraction.relations) {
					if (cancelled.has(jobId)) return;
					step += 1;
					yield {
						type: 'proposal',
						jobId,
						documentId: document.id,
						step,
						proposal: { kind: 'relation', payload }
					};
				}

				// issue #133: this still drives job-runner.ts's per-call `model_call` write
				// (agent 'import', operation `import.cheap`, zero tokens and zero cost since
				// nothing real ran) - a fake extractor gets the same bookkeeping shape a real
				// gateway call would, rather than a special case. The real per-document charge
				// stays job-runner.ts's own `chargeFor('import.document')` call, applied once
				// regardless of what this event reports, so credits here is always 0 rather
				// than a fabricated second charge.
				step += 1;
				yield {
					type: 'usage',
					jobId,
					documentId: document.id,
					step,
					purpose: 'cheap',
					provider: 'deterministic-fake',
					modelId: 'onboarding-fake-extractor-v1',
					inputTokens: 0,
					outputTokens: 0,
					credits: 0,
					costEur: 0,
					latencyMs: FAKE_STEP_DELAY_MS
				};

				step += 1;
				yield {
					type: 'progress',
					jobId,
					documentId: document.id,
					step,
					status: 'finished',
					entityCount: extraction.entities.length,
					relationCount: extraction.relations.length,
					detail: `${extraction.entities.length} entit${extraction.entities.length === 1 ? 'y' : 'ies'}, ${extraction.relations.length} relation(s)`
				};
			}
		}

		const iterable = generate();
		return Object.assign(iterable, { jobId });
	}

	cancel(jobId: string): void {
		this.cancelled.add(jobId);
	}
}

// ---------------------------------------------------------------------------------------
// Kicking the job off. Issue #26: "a job has its own timeout independent of whatever HTTP
// request or browser tab started it" - so this fires ImportJobRunner.run() without
// awaiting it, and the running-jobs guard below stops a page revisit from starting the
// same job twice while the first run is still in flight (ImportJobRunner.run is itself
// resumable, but two concurrent calls on the same job would race the same DB rows).
// ---------------------------------------------------------------------------------------

const runningJobs = new Set<string>();

export interface StartImportRunInput {
	dbJobId: string;
	universeId: string;
	sourceSystem: KnownPlaybookId;
	userId: string;
	playbook: LoadedPlaybook;
	documents: JobDocument[];
	artefactPath: string;
	budgetCredits: number;
}

/** Loads the archive back off disk into a fresh ArchiveSourceReader - the same reader an
 * upload's own detect step used, reopened rather than kept around in process memory so a
 * server restart between confirm and run does not lose the job. */
export async function openArtefact(artefactPath: string): Promise<ArchiveSourceReader> {
	const bytes = await readFile(artefactPath);
	return ArchiveSourceReader.open(bytes, DEFAULT_ARCHIVE_LIMITS);
}

export function startImportRun(database: Db, input: StartImportRunInput): void {
	if (runningJobs.has(input.dbJobId)) return;
	runningJobs.add(input.dbJobId);

	void (async () => {
		try {
			const sources = await openArtefact(input.artefactPath);
			const { driver } = resolveImportDriver(database);
			const runner = new ImportJobRunner();
			const params: RunImportJobParams = {
				db: database,
				driver,
				dbJobId: input.dbJobId,
				universeId: input.universeId,
				sourceSystem: input.sourceSystem,
				userId: input.userId,
				playbook: input.playbook,
				documents: input.documents,
				sources,
				images: new InMemoryImageStore(),
				budget: { maxCredits: input.budgetCredits },
				similarity: importMatchSimilarity,
				thresholds: MATCH_THRESHOLDS,
				// Issue #189/#190, decision K1: same network-free default embedder
				// `@canonry/indexing`'s own pipeline wires in wherever a real gateway
				// credential is not available, which is exactly this driver's situation
				// too (`DeterministicExtractionDriver`, this file's own doc comment).
				embedRelationLabel: hashingEmbedder,
				timeoutMs: 5 * 60_000
			};
			await runner.run(params);
		} catch (err) {
			console.error(`onboarding import job ${input.dbJobId} failed to run:`, err);
		} finally {
			runningJobs.delete(input.dbJobId);
		}
	})();
}

// ---------------------------------------------------------------------------------------
// Reading back a running (or finished) job's live feed for the onboarding page's polling
// endpoint, and accepting the one proposal D7's own mock shows inline on the "first
// accept" screen. The full multi-proposal queue (D4, keyboard C6) is ReviewSurfaces'
// /w/[universe]/import/[job]/review, linked to rather than rebuilt here.
// ---------------------------------------------------------------------------------------

export type ImportJobRow = typeof importJob.$inferSelect;
export type ProposalRow = typeof proposal.$inferSelect;

export async function getImportJobRow(database: Db, jobId: string): Promise<ImportJobRow | null> {
	const [row] = await database.select().from(importJob).where(eq(importJob.id, jobId)).limit(1);
	return row ?? null;
}

/** Every proposal this job's plans produced, oldest first, via proposal_plan.import_job_id
 * (added this wave once the review screen needed a real join instead of a time-window
 * approximation). */
export async function proposalsForImportJob(database: Db, jobId: string): Promise<ProposalRow[]> {
	const rows = await database
		.select({ proposal })
		.from(proposal)
		.innerJoin(proposalPlan, eq(proposal.planId, proposalPlan.id))
		.where(eq(proposalPlan.importJobId, jobId))
		.orderBy(proposal.createdAt);
	return rows.map((row) => row.proposal);
}

/** Issue #190: dispatches by kind, same as the full review queue's own accept action -
 * a relation-type vocabulary proposal (never touches entity_source_ref) routes to
 * acceptRelationTypeProposal, everything else keeps going through acceptImportProposal
 * exactly as before. `kind` is read by the caller from the same proposal row it already
 * fetched to find this proposal in the first place (proposalsForImportJob), never
 * re-queried here. */
export async function acceptOnboardingProposal(
	database: Db,
	kind: ProposalKind,
	input: AcceptImportProposalInput
): Promise<ProposalRow> {
	return dbAcceptAnyImportProposal(database, kind, input);
}

/** proposal.evidence is untrusted-shape jsonb (this file's own writer, matchEvidence in
 * packages/import/src/job-runner.ts, is the only producer, but the column itself carries
 * no schema) - reads the source document's path back out defensively rather than
 * asserting the shape. Used by the accept action to recompute entity_source_ref's
 * content_hash from the real archive bytes, never trusted from the client. */
export function evidenceSourcePath(evidence: unknown): string | null {
	if (typeof evidence !== 'object' || evidence === null) return null;
	const sourceRef = (evidence as Record<string, unknown>).sourceRef;
	if (typeof sourceRef !== 'object' || sourceRef === null) return null;
	const path = (sourceRef as Record<string, unknown>).path;
	return typeof path === 'string' ? path : null;
}
