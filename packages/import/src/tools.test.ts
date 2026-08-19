/**
 * Issue #269: OpenAI's structured-output mode rejects any object schema whose properties
 * are not all listed in `required` - `.default()` and `.optional()` both take a field out
 * of `required` in the JSON Schema Zod's `toJSONSchema` produces, so either one reproduces
 * the same 400 the AI Gateway wraps as a `GatewayInternalServerError` with zero input
 * tokens and a suspiciously constant latency (`entity_propose`'s `aliases`/`images`, found
 * against the real gateway once the same bug was fixed once already in #256's
 * `newEntitySchema`, `packages/copilot/src/ask-propose.ts`).
 *
 * This doesn't name `aliases`/`images` and stop there: it converts every tool schema
 * `createImportTools` hands the model to draft-7 JSON Schema (the same conversion
 * `@ai-sdk/provider-utils`'s `zodSchema()` performs before a request reaches a provider,
 * confirmed against `zod/v4/core`'s `toJSONSchema` with the same `{ target: 'draft-7', io:
 * 'input' }` options that package uses) and asserts every property is required, for all
 * eight tools at once. A schema that adds a new field with `.optional()` or `.default()`
 * tomorrow fails this test the same way `aliases` did, without anyone having to remember to
 * name the new field here.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InMemorySourceReader } from './sources.js';
import { InMemoryImageStore } from './images.js';
import { createDocumentRunContext, createImportTools } from './tools.js';
import { IMPORT_TOOL_NAMES } from './tool-names.js';

function toolInputSchemas(): Record<string, z.ZodType> {
	const ctx = createDocumentRunContext('job-1', 'doc-1', 'notes.md');
	const tools = createImportTools(
		ctx,
		{ sources: new InMemorySourceReader({ files: {} }), images: new InMemoryImageStore() },
		new Set(IMPORT_TOOL_NAMES)
	);
	const schemas: Record<string, z.ZodType> = {};
	for (const name of IMPORT_TOOL_NAMES) {
		const schema = tools[name]?.inputSchema;
		if (!schema) throw new Error(`createImportTools did not wire up '${name}'`);
		schemas[name] = schema as z.ZodType;
	}
	return schemas;
}

describe("every import tool's input schema keeps every property in JSON Schema's required (issue #269)", () => {
	const schemas = toolInputSchemas();

	it.each(IMPORT_TOOL_NAMES)('%s', (name) => {
		const schema = schemas[name];
		if (!schema) throw new Error(`no schema captured for '${name}'`);
		const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as {
			properties?: Record<string, unknown>;
			required?: string[];
		};
		const properties = Object.keys(jsonSchema.properties ?? {});
		const required = jsonSchema.required ?? [];

		// A schema with no properties at all would vacuously pass the assertion below
		// without ever exercising it - every one of the eight tools has at least one
		// property today, and a future one that genuinely takes no input still has to
		// prove that here rather than silently sailing through.
		expect(properties.length).toBeGreaterThan(0);
		expect(required.sort()).toEqual(properties.sort());
	});

	// The regression #269 was actually filed against: a schema property made optional
	// through `.default()` rather than `.optional()` fails the exact same way, and this
	// is the one that shipped once already (`entity_propose`'s `aliases`/`images`).
	it("catches a `.default()` field the way #269's own bug shipped, not just `.optional()`", () => {
		const withDefault = z.object({ a: z.string(), b: z.array(z.string()).default([]) }).strict();
		const jsonSchema = z.toJSONSchema(withDefault, { target: 'draft-7', io: 'input' }) as {
			properties?: Record<string, unknown>;
			required?: string[];
		};
		const properties = Object.keys(jsonSchema.properties ?? {});
		const required = jsonSchema.required ?? [];

		expect(required.sort()).not.toEqual(properties.sort());
		expect(required).not.toContain('b');
	});
});
