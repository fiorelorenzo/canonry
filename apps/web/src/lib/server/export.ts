/**
 * Issue #21, decision F4 = A: a flat zip, one markdown file per entity plus a README,
 * built without ever holding the whole universe in memory. `streamEntitiesForExport`
 * (packages/db) hands entities over one at a time from a Postgres cursor; this file
 * turns each one into a zip entry and pushes the zip's own compressed bytes straight
 * onto the HTTP response as fflate produces them, so neither the database rows nor the
 * finished archive sit fully buffered anywhere in this process.
 *
 * Every scalar in the frontmatter is written with JSON.stringify, which is also valid
 * YAML flow-scalar syntax (YAML is a superset of JSON here): any standard YAML reader,
 * Obsidian's frontmatter parser included, reads it correctly, and `parseExportedFrontmatter`
 * below can read it back with nothing more than JSON.parse per line - no YAML dependency
 * needed for a format this file both writes and owns the reading of.
 */
import { Zip, ZipDeflate } from 'fflate';
import {
	countEntitiesForExport,
	streamEntitiesForExport,
	type Db,
	type ExportEntityRow,
	type UniverseExportMeta
} from '@canonry/db';

const encoder = new TextEncoder();

export function exportZipFilename(universeSlug: string): string {
	return `${universeSlug}-export.zip`;
}

/** One `key: value` frontmatter line. JSON.stringify always produces a double-quoted
 * YAML flow scalar (or a `[...]` flow sequence for `aliases`), so this never needs to
 * decide whether a name, alias or slug happens to need quoting. */
function frontmatterLine(key: string, value: string | string[]): string {
	return `${key}: ${JSON.stringify(value)}`;
}

/** The fields that survive a round trip, per issue #21: name, type, aliases, slug,
 * visibility, timestamps. Everything after the closing `---` is `entity.body` untouched -
 * no re-wrapping, no re-encoding `[[Name]]` mentions - because markdown is the stored
 * form (decision B2) and this is the direction export has to be lossless in: what gets
 * written here has to be exactly what is canon right now. */
export function renderEntryMarkdown(entry: ExportEntityRow): string {
	const frontmatter = [
		'---',
		frontmatterLine('name', entry.name),
		frontmatterLine('type', entry.type),
		frontmatterLine('aliases', entry.aliases),
		frontmatterLine('slug', entry.slug),
		frontmatterLine('visibility', entry.visibility),
		frontmatterLine('created_at', entry.createdAt.toISOString()),
		frontmatterLine('updated_at', entry.updatedAt.toISOString()),
		'---'
	].join('\n');
	return `${frontmatter}\n\n${entry.body}`;
}

export function renderReadme(
	universe: UniverseExportMeta,
	entryCount: number,
	generatedAt: Date
): string {
	const dateLabel = generatedAt.toISOString().slice(0, 10);
	const fileWord = entryCount === 1 ? 'file' : 'files';
	return `# ${universe.name}

Exported from Canonry on ${dateLabel}.

This zip holds a flat markdown export of every entry in this universe: ${entryCount} ${fileWord},
one per entry, each named after the entry's slug with a .md extension. There is no folder
structure and no images here, just the entries themselves.

Each file opens with a YAML frontmatter block (name, type, aliases, slug, visibility,
created_at, updated_at), then the entry's body exactly as Canonry stores it, mentions
written as [[Name]] and all. This is the GM's own copy, not the players' wiki: an entry
whose frontmatter says visibility: "gm_only" is included here with that visibility named,
not hidden and not filtered out.

Every [[Name]] mention is left exactly as written rather than rewritten into a relative
link, so the files read correctly the moment this zip is unpacked into an Obsidian vault,
or read as plain text anywhere else.
`;
}

/** Parses exactly what `renderEntryMarkdown` writes: the frontmatter block between the
 * opening `---` and the first `\n---\n\n` after it, one JSON-valued field per line, then
 * everything after that boundary as the body, untouched. Exists so the export's own
 * round-trip test can prove the frontmatter parses and the body it recovers is
 * byte-identical to what went in, without pulling in a general YAML parser to check a
 * format this module fully controls both ends of. */
export interface ParsedExportFile {
	frontmatter: {
		name: string;
		type: string;
		aliases: string[];
		slug: string;
		visibility: string;
		created_at: string;
		updated_at: string;
	};
	body: string;
}

export function parseExportedFrontmatter(fileContent: string): ParsedExportFile {
	const OPEN = '---\n';
	const CLOSE = '\n---\n\n';
	if (!fileContent.startsWith(OPEN)) {
		throw new Error('export file does not open with a frontmatter block');
	}
	const closeIndex = fileContent.indexOf(CLOSE);
	if (closeIndex === -1) {
		throw new Error('export file frontmatter block is never closed');
	}

	const fields: Record<string, unknown> = {};
	const block = fileContent.slice(OPEN.length, closeIndex);
	for (const line of block.split('\n')) {
		const separator = line.indexOf(': ');
		if (separator === -1) {
			throw new Error(`malformed frontmatter line: ${line}`);
		}
		fields[line.slice(0, separator)] = JSON.parse(line.slice(separator + 2));
	}

	return {
		frontmatter: fields as ParsedExportFile['frontmatter'],
		body: fileContent.slice(closeIndex + CLOSE.length)
	};
}

/** Issue #21 acceptance: streams the whole zip, README included, without ever holding
 * more than one entity's markdown and one batch of database rows in memory. The README
 * needs an accurate entry count, which `countEntitiesForExport` answers with one cheap
 * scalar query up front; the entity bodies themselves still only ever arrive through the
 * cursor in `streamEntitiesForExport`, one batch at a time. */
export function streamUniverseExportZip(
	db: Db,
	universe: UniverseExportMeta,
	generatedAt: Date = new Date()
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const zip = new Zip((err, chunk, final) => {
				if (err) {
					controller.error(err);
					return;
				}
				if (chunk) controller.enqueue(chunk);
				if (final) controller.close();
			});

			try {
				const entryCount = await countEntitiesForExport(db, universe.id);

				const readme = new ZipDeflate('README.md');
				zip.add(readme);
				readme.push(encoder.encode(renderReadme(universe, entryCount, generatedAt)), true);

				for await (const entity of streamEntitiesForExport(db, universe.id)) {
					const file = new ZipDeflate(`${entity.slug}.md`);
					zip.add(file);
					file.push(encoder.encode(renderEntryMarkdown(entity)), true);
				}

				zip.end();
			} catch (err) {
				controller.error(err);
			}
		}
	});
}
