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
	/** #196: the merge target's key, alongside the already-returned `intoLabel` fallback -
	 * `movedToast` needs it to show a shipped target's word translated rather than the
	 * raw stored English the server action reads off the row. */
	intoKey?: string;
}

/** #198: the catalogue page's translate form, one submit covering every shipped
 * locale's field pair for one type at once (unlike rename/widen/merge, there is no
 * per-locale `typeId` disambiguation needed beyond the one already carried here - the
 * dialog only ever has one type open at a time). */
export interface TranslateActionResult {
	action: 'translate';
	typeId: string;
	error?: string;
}

export type RelationCatalogueFormResult =
	RenameActionResult | WidenActionResult | MergeActionResult | TranslateActionResult;

/** #196 (decision L1): the settings catalogue table and its rename/widen/merge dialogs
 * all show the same two columns - a shipped type's label and inverse label - and all
 * need the same fallback chain: the i18n bundle by `key` first (the shipped ten), then
 * #198's saved translation for `locale` (a universe's own type only - `row.labels` is
 * structurally `null` for a shipped row, per the migration's
 * `relation_type_label_owned_only_trigger`), then the stored text as authored. One
 * place for that chain so the five call sites cannot drift on which field wins. */
export function relationTypeDisplayLabel(
	row: {
		key: string;
		label: string;
		labels?: Record<string, { label: string; inverseLabel: string }> | null;
	},
	lookup: (key: string) => { label: string; inverseLabel: string } | undefined,
	locale: string
): string {
	return lookup(row.key)?.label ?? row.labels?.[locale]?.label ?? row.label;
}

export function relationTypeDisplayInverseLabel(
	row: {
		key: string;
		inverseLabel: string;
		labels?: Record<string, { label: string; inverseLabel: string }> | null;
	},
	lookup: (key: string) => { label: string; inverseLabel: string } | undefined,
	locale: string
): string {
	return lookup(row.key)?.inverseLabel ?? row.labels?.[locale]?.inverseLabel ?? row.inverseLabel;
}
