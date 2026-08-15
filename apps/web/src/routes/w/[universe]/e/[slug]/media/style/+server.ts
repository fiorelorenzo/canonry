/**
 * The inline "edit" chip next to the style modifier (#65, F1's own mock: "the inline edit
 * chip covers 'change it now'"). Always writes `entity.image_prompt_modifier`, the
 * per-entry override - decision F1's "what this locks in" defers a full universe-level
 * style manager to a separate settings surface, this chip is exactly the "change it now"
 * scope it left in place. An empty string is a real, saved override ("no style for this
 * entry"), not treated as "clear it back to null" - clearing back to inheriting the
 * universe style is a separate explicit action (DELETE).
 */
import { error, json } from '@sveltejs/kit';
import { eq } from '@canonry/db';
import { entity } from '@canonry/db/schema';
import { messages } from '$lib/i18n';
import type { RequestHandler } from './$types';
import { loadMediaContext, requireWriter } from '../_context.js';

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const context = await loadMediaContext(locals, params.universe, params.slug);
	requireWriter(locals, context.role);

	const body: unknown = await request.json();
	const modifier =
		typeof body === 'object' && body !== null && 'modifier' in body ? body.modifier : undefined;
	if (typeof modifier !== 'string')
		error(400, messages(locals.locale).entry.errors.modifierMustBeString);

	await context.conn
		.update(entity)
		.set({ imagePromptModifier: modifier })
		.where(eq(entity.id, context.entity.id));
	return json({ modifier });
};

/** Clears the override back to null, so the entry inherits the universe style again. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = await loadMediaContext(locals, params.universe, params.slug);
	requireWriter(locals, context.role);

	await context.conn
		.update(entity)
		.set({ imagePromptModifier: null })
		.where(eq(entity.id, context.entity.id));
	return json({ modifier: null });
};
