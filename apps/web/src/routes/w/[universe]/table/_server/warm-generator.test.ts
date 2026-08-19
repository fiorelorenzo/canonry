/**
 * Issue #269: `npcDraftSchema` is handed straight to `generateObject`, so it hits the
 * same OpenAI structured-output rule `packages/import/src/tools.test.ts` defends against -
 * every property has to stay in the JSON Schema's `required` array, or a purpose that
 * routes to an OpenAI model fails the "+ NPC here" quick action's slow lane with a
 * `GatewayInternalServerError` that names neither the schema nor the field.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { npcDraftSchema } from './warm-generator.js';

describe("npcDraftSchema keeps every property in JSON Schema's required (issue #269)", () => {
	it('has no property missing from required', () => {
		const jsonSchema = z.toJSONSchema(npcDraftSchema, { target: 'draft-7', io: 'input' }) as {
			properties?: Record<string, unknown>;
			required?: string[];
		};
		const properties = Object.keys(jsonSchema.properties ?? {});
		const required = jsonSchema.required ?? [];

		expect(properties.length).toBeGreaterThan(0);
		expect(required.sort()).toEqual(properties.sort());
	});
});
