/**
 * Deterministic Qdrant point ids (RFC 4122 UUID v5), so re-indexing the same page and
 * chunk index always writes to the same point instead of accumulating duplicates - what
 * makes an upsert an upsert. Hand-rolled rather than a dependency: UUID v5 is exactly
 * "SHA-1 of namespace + name, with two nibbles patched for version/variant", nothing a
 * library buys correctness on.
 */
import { createHash } from 'node:crypto';

// Fixed, arbitrary namespace for every point id this package mints - only has to be
// stable across runs, not meaningful on its own (RFC 4122 §4.3).
const NAMESPACE = '6f0af6d8-6b0e-5f2f-9d9a-1f7b1c9d6c3a';

function uuidV5(name: string, namespace: string = NAMESPACE): string {
	const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
	const hash = createHash('sha1').update(namespaceBytes).update(name, 'utf8').digest();
	const bytes = hash.subarray(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One id per (data source, page url, chunk index) - stable across re-indexing runs as
 * long as the page's chunk boundaries do not shift. */
export function chunkPointId(dataSourceId: string, pageUrl: string, chunkIndex: number): string {
	return uuidV5(`${dataSourceId}\u0000${pageUrl}\u0000${chunkIndex}`);
}

/** The single entity-level point's id (issue #703): one per (data source, entity url), so
 * re-indexing an entity overwrites its name point instead of accumulating one per save.
 * `'entity'` where `chunkPointId` puts a chunk index, which is a number, so the two name
 * spaces cannot collide however many chunks a body grows to. */
export function entityPointId(dataSourceId: string, entityUrl: string): string {
	return uuidV5(`${dataSourceId}\u0000${entityUrl}\u0000entity`);
}
