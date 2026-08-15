/**
 * The same slug a proposal gets when it is accepted.
 *
 * `packages/import/src/job-runner.ts` derives `patch.slug` from the proposed name with
 * exactly this transformation and does not export it. The bench has to score an
 * extraction's proposals against gold slugs, so it needs the same function: scoring
 * against a slightly different normalisation would mark a correct extraction wrong
 * whenever an accent or an apostrophe is involved, which in this corpus is often.
 *
 * Duplicated rather than exported from `packages/import`, because the product's copy is a
 * private detail of how an accepted proposal writes an entity and giving it a public name
 * would invite callers to depend on it. If the two ever drift, the bench's entity recall
 * drops for a reason that has nothing to do with the model, which is loud enough.
 */
export function slugify(name: string): string {
	const base = name
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return base.length > 0 ? base : 'entity';
}
