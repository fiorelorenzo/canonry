import type { EntityType, UniverseKind } from '@canonry/db/schema';

/**
 * What the sidebar's universe switcher renders per row. `baseUniverseName` is set only
 * when `kind` is `'derived'`: SPEC.md 4.1 requires that a derived universe's reliance
 * on another universe's indexed corpus stays visible in the UI rather than implicit.
 */
export interface UniverseSummary {
	id: string;
	name: string;
	slug: string;
	kind: UniverseKind;
	baseUniverseName: string | null;
	entityCount: number;
}

export interface RecentEntity {
	id: string;
	name: string;
	slug: string;
	type: EntityType;
}
