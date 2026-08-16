/**
 * #192: the shapes `settings/relations/+page.server.ts`'s three actions return and the
 * dialogs in this directory read back, kept in one place rather than inferred per dialog
 * from the route's generated `ActionData` - a leaf component under `$lib/components`
 * has no `./$types` of its own to import, and duplicating this shape per dialog would
 * let them drift.
 */
export interface RenameActionResult {
	action: 'rename';
	typeId: string;
	error?: string;
}

export interface WidenActionResult {
	action: 'widen';
	typeId: string;
	error?: string;
}

export interface MergeActionResult {
	action: 'merge';
	error?: string;
	movedCount?: number;
	dedupedCount?: number;
	intoLabel?: string;
}

export type RelationCatalogueFormResult =
	RenameActionResult | WidenActionResult | MergeActionResult;
