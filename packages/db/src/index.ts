export { closeDb, createDb, ping, type Db } from './client.js';
export { runMigrations } from './migrate.js';
export { factWithSource, type FactWithSource } from './queries/facts.js';
export { relationsFor, type RelationView } from './queries/relations.js';
export { historyFor } from './queries/revisions.js';

/**
 * The query operators, re-exported from the one drizzle this workspace installs.
 * Consumers need `eq` and friends the moment they write anything, and the alternative
 * is every app declaring `drizzle-orm` itself, which invites two copies in the tree and
 * the confusing type errors that come with them. `db.transaction()` comes from the
 * instance, so a write that spans tables does not need anything else from here.
 */
export { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
