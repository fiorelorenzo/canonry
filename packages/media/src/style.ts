/**
 * Style resolution (#65, SPEC.md §9: style is "shared at universe level ... overridable
 * per entry"). The entry's own `image_prompt_modifier` always wins when it is set at all -
 * including an explicit empty string, which is a deliberate "no style for this one entry"
 * override, not "fall through to the universe". Null is the only value that inherits.
 */
import { entryStyleContext, type Db, type EntryStyleContext } from '@canonry/db';

export type { EntryStyleContext };

export type StyleSource = 'entry' | 'universe' | 'none';

export interface ResolvedStyle {
	modifier: string | null;
	source: StyleSource;
}

export function pickStyle(
	context: Pick<EntryStyleContext, 'entityOverride' | 'universeStyleModifier'>
): ResolvedStyle {
	if (context.entityOverride !== null) {
		return { modifier: context.entityOverride, source: 'entry' };
	}
	if (context.universeStyleModifier !== null) {
		return { modifier: context.universeStyleModifier, source: 'universe' };
	}
	return { modifier: null, source: 'none' };
}

export class EntryNotFoundError extends Error {
	constructor(entityId: string) {
		super(`no entity "${entityId}" to resolve an image style for`);
		this.name = 'EntryNotFoundError';
	}
}

export async function resolveStyle(db: Db, entityId: string): Promise<ResolvedStyle> {
	const context = await entryStyleContext(db, entityId);
	if (!context) throw new EntryNotFoundError(entityId);
	return pickStyle(context);
}
