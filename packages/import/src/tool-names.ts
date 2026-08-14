/**
 * The tool surface of SPEC.md §6.3, verbatim. Every playbook's `## Tools` section is
 * validated against this exact list (playbook.ts), and it is the only set of tool names
 * `createImportTools` (tools.ts) ever wires up. There is deliberately no tool here that
 * writes an entity, no raw SQL, no arbitrary fetch, no shell: the blast radius of a
 * confused or manipulated model is a batch of bad proposals a human then rejects.
 */
export const IMPORT_TOOL_NAMES = [
	'source_list',
	'source_read',
	'page_image',
	'image_store',
	'entity_propose',
	'relation_propose',
	'checkpoint',
	'job_finish'
] as const;

export type ImportToolName = (typeof IMPORT_TOOL_NAMES)[number];

const TOOL_NAME_LOOKUP: Record<string, true> = Object.fromEntries(
	IMPORT_TOOL_NAMES.map((name) => [name, true])
);

export function isImportToolName(value: string): value is ImportToolName {
	return TOOL_NAME_LOOKUP[value] === true;
}
