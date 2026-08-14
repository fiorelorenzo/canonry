/**
 * Round trip in the direction that matters (issue #21 acceptance): every entry in the
 * database has a file, that file's frontmatter parses, and its body is byte-identical to
 * `entity.body`. Runs against the real dev Postgres (`DATABASE_URL`, falling back to the
 * local instance this repo runs at 127.0.0.1:55432) rather than the separate
 * `canonry_test` database packages/db's own suite owns the lifecycle of - this file only
 * ever inserts its own uniquely-slugged universe and cleans it up afterwards, so it never
 * collides with the seeded fixture world or another suite's data.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { entity, universe, user } from '@canonry/db/schema';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	exportZipFilename,
	parseExportedFrontmatter,
	renderEntryMarkdown,
	streamUniverseExportZip
} from './export.js';

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgres://canonry:canonry@127.0.0.1:55432/canonry';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function readWholeStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) chunks.push(value);
	}
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.length;
	}
	return merged;
}

describe('renderEntryMarkdown / parseExportedFrontmatter', () => {
	it('round-trips a name with quotes, an alias with a colon, and a body with a literal ---', () => {
		const entry = {
			name: 'Aldric "the Broken" Vane',
			type: 'character' as const,
			aliases: ['Captain Vane', 'the broken captain: exiled'],
			slug: 'aldric-vane',
			visibility: 'gm_only' as const,
			body: 'Line one.\n\n---\n\nMentions [[The Sable Winter]] and a literal horizontal rule above.\n',
			createdAt: new Date('2026-07-20T10:00:00.000Z'),
			updatedAt: new Date('2026-07-30T14:22:00.000Z')
		};

		const rendered = renderEntryMarkdown(entry);
		const parsed = parseExportedFrontmatter(rendered);

		expect(parsed.frontmatter).toEqual({
			name: entry.name,
			type: entry.type,
			aliases: entry.aliases,
			slug: entry.slug,
			visibility: entry.visibility,
			created_at: entry.createdAt.toISOString(),
			updated_at: entry.updatedAt.toISOString()
		});
		expect(parsed.body).toBe(entry.body);
	});
});

describe('streamUniverseExportZip', () => {
	let db: Db;
	let universeRow: { id: string; ownerUserId: string; name: string; slug: string };

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 2 });

		const userId = unique('export-test-user');
		const [owner] = await db
			.insert(user)
			.values({ id: userId, name: 'Export Test Owner', email: `${userId}@example.test` })
			.returning();
		if (!owner) throw new Error('user insert did not return a row');

		const [row] = await db
			.insert(universe)
			.values({
				ownerUserId: owner.id,
				name: 'Export Test Universe',
				slug: unique('export-test-universe'),
				kind: 'homebrew'
			})
			.returning();
		if (!row) throw new Error('universe insert did not return a row');
		universeRow = row;

		await db.insert(entity).values([
			{
				universeId: row.id,
				type: 'character',
				name: 'Public Hero',
				slug: 'public-hero',
				aliases: ['The Hero'],
				body: 'A revealable entry mentioning [[Secret Villain]] by name.',
				visibility: 'revealable'
			},
			{
				universeId: row.id,
				type: 'faction',
				name: 'Secret Villain',
				slug: 'secret-villain',
				body: 'GM-only body nobody but the table owner should read.',
				visibility: 'gm_only'
			}
		]);
	});

	afterAll(async () => {
		// Cascades to `entity` (entity.universe_id references universe with onDelete cascade).
		await db.delete(universe).where(eq(universe.id, universeRow.id));
		await db.delete(user).where(eq(user.id, universeRow.ownerUserId));
		await closeDb(db);
	});

	it('has one file per database entry, each with parseable frontmatter and a byte-identical body', async () => {
		const zipBytes = await readWholeStream(streamUniverseExportZip(db, universeRow));
		const files = unzipSync(zipBytes);

		const dbEntities = await db.select().from(entity).where(eq(entity.universeId, universeRow.id));
		expect(dbEntities).toHaveLength(2);

		const decoder = new TextDecoder();
		for (const dbEntity of dbEntities) {
			const fileBytes = files[`${dbEntity.slug}.md`];
			expect(fileBytes, `missing zip entry for ${dbEntity.slug}.md`).toBeDefined();

			const parsed = parseExportedFrontmatter(decoder.decode(fileBytes));
			expect(parsed.frontmatter.name).toBe(dbEntity.name);
			expect(parsed.frontmatter.type).toBe(dbEntity.type);
			expect(parsed.frontmatter.aliases).toEqual(dbEntity.aliases);
			expect(parsed.frontmatter.slug).toBe(dbEntity.slug);
			// The GM-only entry carries its own visibility rather than being hidden or
			// relabelled - this is the GM's own copy (F4), not the players' wiki.
			expect(parsed.frontmatter.visibility).toBe(dbEntity.visibility);
			expect(parsed.body).toBe(dbEntity.body);
		}

		expect(Object.keys(files).sort()).toEqual(
			['README.md', ...dbEntities.map((row) => `${row.slug}.md`)].sort()
		);
	});

	it('the README names the universe and the export date, and nothing else is in the zip', async () => {
		const zipBytes = await readWholeStream(streamUniverseExportZip(db, universeRow));
		const files = unzipSync(zipBytes);

		const readme = new TextDecoder().decode(files['README.md']);
		expect(readme).toContain(universeRow.name);
		expect(readme).toContain(new Date().toISOString().slice(0, 10));
		expect(readme).toContain('2 files');
	});

	it('exportZipFilename names the download after the universe slug', () => {
		expect(exportZipFilename('valdoria-reach')).toBe('valdoria-reach-export.zip');
	});
});
