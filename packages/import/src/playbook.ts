/**
 * Playbook loading (issue #35, SPEC.md §6.2, §11.2). Format follows pitchbox's, which is
 * in production (`/home/dev/Progetti/pitchbox/playbooks/*.md`): Markdown with YAML
 * frontmatter, then `## Inputs`, `## Tools`, `## Steps` with JSON examples in fenced
 * blocks. A playbook resolves to a system prompt (the whole body, handed to the model
 * verbatim - pitchbox does the same: "a playbook body is shipped standalone... with no
 * include mechanism"), an enabled tool set (parsed out of `## Tools`) and a step budget
 * (frontmatter, since it has no natural home in prose).
 *
 * The frontmatter parser below is a deliberately small YAML subset: flat `key: value`
 * scalars only, no block scalars, no nested maps, no anchors. That is all a playbook's
 * frontmatter needs here (id, version, name, description, model purpose, step budget),
 * and pitchbox itself never parses its playbook frontmatter as YAML at all - it treats
 * the whole file as an opaque body and keeps `name`/`description` in a separate manifest
 * (`shared/src/db/seed-core.ts`). Canonry needs `version` to be machine-readable because
 * it feeds the import fingerprint (SPEC.md §4.6, §6.2, §6.4), so this module actually
 * parses the frontmatter rather than treating it as decoration. If a future playbook
 * needs richer YAML, swapping this for a real parser is a self-contained change: nothing
 * outside this file depends on the subset being small.
 *
 * `import_job.playbook_version` (packages/db/src/schema/source.ts) is an integer column,
 * so `version` here is a positive integer, not a semver string.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { IMPORT_TOOL_NAMES, type ImportToolName } from './tool-names.js';

export class PlaybookParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PlaybookParseError';
	}
}

export class PlaybookValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PlaybookValidationError';
	}
}

export type ImportModelPurpose = 'cheap' | 'premium' | 'multimodal';

export interface LoadedPlaybook {
	id: string;
	version: number;
	name: string;
	description: string;
	modelPurpose: ImportModelPurpose;
	/** Per-document step ceiling (SPEC.md §6.1): "each document gets a step ceiling." */
	stepBudget: number;
	/** issue #24: "premium only where a playbook marks a document hard." A playbook
	 * declares the criterion rather than the model deciding it mid-run - a document
	 * whose source size is at or above this many bytes runs on the premium purpose
	 * instead of `modelPurpose`, even when the playbook's own default is cheap.
	 * `undefined` means no playbook document is ever escalated this way. */
	hardBytesThreshold?: number;
	tools: ImportToolName[];
	/** The whole markdown body after frontmatter, handed to the model as its system prompt. */
	systemPrompt: string;
	/** The original file text, kept for debugging and for re-deriving the fingerprint. */
	raw: string;
}

/** The piece of a loaded playbook that feeds the import fingerprint (SPEC.md §4.6, §6.2,
 * §6.4): bumping this and re-running is what turns an improved playbook into a clean
 * update diff instead of a duplicate world. A thin accessor rather than a bare field
 * read so callers have one documented place to reach for it. */
export function playbookVersion(playbook: LoadedPlaybook): number {
	return playbook.version;
}

const REQUIRED_HEADINGS = ['## Inputs', '## Tools', '## Steps'] as const;

const FRONTMATTER_SCHEMA = z.object({
	id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be lowercase kebab-case, e.g. "generic"'),
	version: z
		.string()
		.regex(
			/^[1-9][0-9]*$/,
			'version must be a positive integer (import_job.playbook_version is an int column)'
		)
		.transform(Number),
	name: z.string().min(1, 'name must not be empty'),
	description: z.string().min(1, 'description must not be empty'),
	modelPurpose: z.enum(['cheap', 'premium', 'multimodal']).optional(),
	stepBudget: z
		.string()
		.regex(/^[1-9][0-9]*$/, 'stepBudget must be a positive integer')
		.transform(Number)
		.pipe(
			z.number().int().positive().max(200, 'stepBudget above 200 is not a ceiling, SPEC.md §6.1')
		),
	hardBytesThreshold: z
		.string()
		.regex(/^[1-9][0-9]*$/, 'hardBytesThreshold must be a positive integer')
		.transform(Number)
		.optional()
});

function splitFrontmatter(source: string): { frontmatter: string; body: string } {
	if (!source.startsWith('---')) {
		throw new PlaybookParseError('playbook must open with a "---" YAML frontmatter fence');
	}
	const closeAt = source.indexOf('\n---', 3);
	if (closeAt === -1) {
		throw new PlaybookParseError('playbook frontmatter opened with "---" but is never closed');
	}
	const frontmatter = source.slice(3, closeAt).trim();
	const afterFenceLineEnd = source.indexOf('\n', closeAt + 1);
	const body = afterFenceLineEnd === -1 ? '' : source.slice(afterFenceLineEnd + 1);
	return { frontmatter, body };
}

/** Parses the small flat-scalar YAML subset described in the module comment. */
function parseFrontmatterScalars(block: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const rawLine of block.split('\n')) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;
		const colon = line.indexOf(':');
		if (colon === -1) {
			throw new PlaybookParseError(`frontmatter line is not "key: value": "${rawLine}"`);
		}
		const key = line.slice(0, colon).trim();
		if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
			throw new PlaybookParseError(`frontmatter key "${key}" is not a valid identifier`);
		}
		if (key in result) {
			throw new PlaybookParseError(`frontmatter key "${key}" is duplicated`);
		}
		let value = line.slice(colon + 1).trim();
		const isDoubleQuoted = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
		const isSingleQuoted = value.startsWith("'") && value.endsWith("'") && value.length >= 2;
		if (isDoubleQuoted || isSingleQuoted) value = value.slice(1, -1);
		result[key] = value;
	}
	return result;
}

function requireHeadingsInOrder(body: string): void {
	let cursor = -1;
	for (const heading of REQUIRED_HEADINGS) {
		const at = body.indexOf(heading);
		if (at === -1) throw new PlaybookValidationError(`missing required section "${heading}"`);
		if (at < cursor) {
			throw new PlaybookValidationError(
				`section "${heading}" must come after the other required sections, in the order Inputs, Tools, Steps`
			);
		}
		cursor = at;
	}
}

function sectionBody(body: string, heading: string): string {
	const at = body.indexOf(heading);
	const rest = body.slice(at + heading.length);
	const nextHeading = rest.indexOf('\n## ');
	return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

const TOOL_BULLET = /^-\s*`([a-z_]+)`/;

/** Parses the enabled tool set out of `## Tools`' bullet list (`- \`tool_name\` - ...`),
 * the same convention pitchbox's own playbooks use. Validates every name against
 * SPEC.md §6.3's fixed surface: a playbook cannot invent a tool that was never wired up. */
function parseToolsSection(body: string): ImportToolName[] {
	const section = sectionBody(body, '## Tools');
	const found: ImportToolName[] = [];
	const seen: Record<string, true> = {};
	for (const line of section.split('\n')) {
		const match = TOOL_BULLET.exec(line.trim());
		if (!match) continue;
		const name = match[1] as string;
		if (!(IMPORT_TOOL_NAMES as readonly string[]).includes(name)) {
			throw new PlaybookValidationError(
				`"## Tools" names "${name}", which is not one of SPEC.md §6.3's tools: ${IMPORT_TOOL_NAMES.join(', ')}`
			);
		}
		if (seen[name]) continue;
		seen[name] = true;
		found.push(name as ImportToolName);
	}
	if (found.length === 0) {
		throw new PlaybookValidationError(
			'"## Tools" must list at least one tool as a `- `name`` bullet'
		);
	}
	return found;
}

/** Requires at least one fenced ```json block inside `## Steps`, and that it parses. */
function requireStepsJsonExample(body: string): void {
	const section = sectionBody(body, '## Steps');
	const match = /```json\n([\s\S]*?)```/.exec(section);
	if (!match) {
		throw new PlaybookValidationError(
			'"## Steps" must contain at least one fenced ```json example'
		);
	}
	try {
		JSON.parse(match[1] ?? '');
	} catch (cause) {
		throw new PlaybookValidationError(
			`"## Steps"' json example does not parse: ${cause instanceof Error ? cause.message : String(cause)}`
		);
	}
}

export interface LoadPlaybookOptions {
	/** When set, the frontmatter `id` must match this exactly (playbook.ts callers derive
	 * it from the filename, catching drift between a file's name and its declared id). */
	expectedId?: string;
}

export function loadPlaybook(source: string, options: LoadPlaybookOptions = {}): LoadedPlaybook {
	const { frontmatter, body } = splitFrontmatter(source);
	const rawFields = parseFrontmatterScalars(frontmatter);
	const parsed = FRONTMATTER_SCHEMA.safeParse(rawFields);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join('; ');
		throw new PlaybookValidationError(`playbook frontmatter is invalid: ${issues}`);
	}
	if (options.expectedId && parsed.data.id !== options.expectedId) {
		throw new PlaybookValidationError(
			`playbook file name implies id "${options.expectedId}" but frontmatter declares id "${parsed.data.id}"`
		);
	}

	requireHeadingsInOrder(body);
	const tools = parseToolsSection(body);
	requireStepsJsonExample(body);

	return {
		id: parsed.data.id,
		version: parsed.data.version,
		name: parsed.data.name,
		description: parsed.data.description,
		modelPurpose: parsed.data.modelPurpose ?? 'cheap',
		stepBudget: parsed.data.stepBudget,
		...(parsed.data.hardBytesThreshold === undefined
			? {}
			: { hardBytesThreshold: parsed.data.hardBytesThreshold }),
		tools,
		systemPrompt: body.trim(),
		raw: source
	};
}

function playbooksDir(): URL {
	return new URL('../playbooks/', import.meta.url);
}

export async function loadPlaybookFile(path: string): Promise<LoadedPlaybook> {
	const source = await readFile(path, 'utf8');
	const fileName = path.split('/').at(-1) ?? path;
	const expectedId = fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName;
	return loadPlaybook(source, { expectedId });
}

/** Loads one of the playbooks shipped under `packages/import/playbooks/` by id, e.g.
 * `loadBuiltinPlaybook('generic')`. Resolves relative to this module's own location so
 * it works identically from `src/` (vitest/tsx) and from a built `dist/` (tsc). */
export async function loadBuiltinPlaybook(id: string): Promise<LoadedPlaybook> {
	const fileUrl = new URL(`${id}.md`, playbooksDir());
	return loadPlaybookFile(fileURLToPath(fileUrl));
}
