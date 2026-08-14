/**
 * A small, deterministic stand-in for the real indexing pipeline's chunker (issue #58):
 * splits an entity body on its `## ` headings and builds a breadcrumb the same shape as
 * SPEC.md §11.3's payload (`entity name` or `entity name > heading`). Good enough to turn
 * fixture prose into gold chunks; not meant to be the production chunker.
 */
import type { GoldChunk } from '../types.js';

export interface ChunkableEntity {
	slug: string;
	name: string;
	body: string;
}

export function chunkEntity(entity: ChunkableEntity): GoldChunk[] {
	const sections = entity.body.split(/\n\n(?=## )/);
	return sections.map((section, index) => {
		const headingMatch = /^## (.+)\n\n([\s\S]*)$/.exec(section);
		if (headingMatch) {
			return {
				id: `${entity.slug}#${index}`,
				entitySlug: entity.slug,
				breadcrumb: `${entity.name} > ${headingMatch[1]!}`,
				text: headingMatch[2]!.trim()
			};
		}
		return {
			id: `${entity.slug}#${index}`,
			entitySlug: entity.slug,
			breadcrumb: entity.name,
			text: section.trim()
		};
	});
}
