/**
 * Issue #198's GM-written half: `relation_type_label` and the two functions that write
 * to it. Three things this file exists to prove that no type-level check can: the
 * shipped catalogue is structurally unable to gain a row here (a trigger, not a
 * convention), a second save for the same locale revises the one row instead of
 * duplicating it, and both writes stay scoped to the universe that owns the type -
 * exactly the same ownership shape `renameRelationType`/`widenRelationType` already
 * enforce, extended to a table those functions never touch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	clearRelationTypeLabel,
	closeDb,
	listRelationTypesForUniverse,
	RelationTypeNotOwnedError,
	setRelationTypeLabel,
	type Db
} from '../src/index.js';
import { relationType, relationTypeLabel } from '../src/schema/relation.js';
import { and, eq } from 'drizzle-orm';
import { expectConstraintViolation, insertHomebrewUniverse, testDb } from './helpers.js';

describe('relation_type_label (#198)', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function ownType(universeId?: string) {
		const u = universeId ? { id: universeId } : await insertHomebrewUniverse(db);
		const [rt] = await db
			.insert(relationType)
			.values({
				universeId: u.id,
				label: 'mentors',
				inverseLabel: 'mentored by',
				cardinality: 'one_to_many',
				allowedFrom: ['character'],
				allowedTo: ['character']
			})
			.returning();
		if (!rt) throw new Error('fixture setup failed');
		return { u, rt };
	}

	async function shippedType() {
		const [rt] = await db
			.select()
			.from(relationType)
			.where(eq(relationType.key, 'commands'))
			.limit(1);
		if (!rt) throw new Error('shipped catalogue seed missing "commands"');
		return rt;
	}

	it('rejects a label row for a shipped type - the migration trigger, not just this file convention', async () => {
		const commands = await shippedType();
		let caught: unknown;
		try {
			await db.insert(relationTypeLabel).values({
				relationTypeId: commands.id,
				locale: 'it',
				label: 'comanda',
				inverseLabel: 'comandato da',
				authorKind: 'human'
			});
		} catch (err) {
			caught = err;
		}
		const cause = caught instanceof Error ? caught.cause : undefined;
		expect(cause).toBeInstanceOf(Error);
		expect((cause as Error).message).toMatch(/not a universe's own type/);
	});

	it('rejects a second row for the same (relation_type, locale) pair', async () => {
		const { rt } = await ownType();
		await db.insert(relationTypeLabel).values({
			relationTypeId: rt.id,
			locale: 'it',
			label: 'fa da mentore',
			inverseLabel: 'assistito da',
			authorKind: 'human'
		});
		await expectConstraintViolation(
			db.insert(relationTypeLabel).values({
				relationTypeId: rt.id,
				locale: 'it',
				label: 'insegna a',
				inverseLabel: 'assistito da',
				authorKind: 'human'
			}),
			'relation_type_label_type_locale_key'
		);
	});

	describe('setRelationTypeLabel', () => {
		it('writes a translation a GM authored, recorded as human', async () => {
			const { u, rt } = await ownType();
			const row = await setRelationTypeLabel(db, u.id, rt.id, {
				locale: 'it',
				label: 'fa da mentore',
				inverseLabel: 'assistito da',
				authorKind: 'human'
			});
			expect(row).toMatchObject({
				relationTypeId: rt.id,
				locale: 'it',
				label: 'fa da mentore',
				inverseLabel: 'assistito da',
				authorKind: 'human'
			});
		});

		it('revises the same row on a second save for the same locale, never a duplicate', async () => {
			const { u, rt } = await ownType();
			await setRelationTypeLabel(db, u.id, rt.id, {
				locale: 'it',
				label: 'fa da mentore',
				inverseLabel: 'assistito da',
				authorKind: 'human'
			});
			await setRelationTypeLabel(db, u.id, rt.id, {
				locale: 'it',
				label: 'guida',
				inverseLabel: 'guidato da',
				authorKind: 'human'
			});

			const rows = await db
				.select()
				.from(relationTypeLabel)
				.where(
					and(eq(relationTypeLabel.relationTypeId, rt.id), eq(relationTypeLabel.locale, 'it'))
				);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ label: 'guida', inverseLabel: 'guidato da' });
		});

		it('refuses to write a translation for a type this universe does not own', async () => {
			const { rt } = await ownType();
			const otherUniverse = await insertHomebrewUniverse(db);
			await expect(
				setRelationTypeLabel(db, otherUniverse.id, rt.id, {
					locale: 'it',
					label: 'fa da mentore',
					inverseLabel: 'assistito da',
					authorKind: 'human'
				})
			).rejects.toThrow(RelationTypeNotOwnedError);
		});

		it('refuses to write a translation for a shipped type', async () => {
			const commands = await shippedType();
			const u = await insertHomebrewUniverse(db);
			await expect(
				setRelationTypeLabel(db, u.id, commands.id, {
					locale: 'it',
					label: 'comanda',
					inverseLabel: 'comandato da',
					authorKind: 'human'
				})
			).rejects.toThrow(RelationTypeNotOwnedError);
		});
	});

	describe('clearRelationTypeLabel', () => {
		it('deletes a saved translation, back to authored-label fallback', async () => {
			const { u, rt } = await ownType();
			await setRelationTypeLabel(db, u.id, rt.id, {
				locale: 'it',
				label: 'fa da mentore',
				inverseLabel: 'assistito da',
				authorKind: 'human'
			});

			await clearRelationTypeLabel(db, u.id, rt.id, 'it');

			const rows = await db
				.select()
				.from(relationTypeLabel)
				.where(eq(relationTypeLabel.relationTypeId, rt.id));
			expect(rows).toHaveLength(0);
		});

		it('is a no-op, not an error, for a locale that was never translated', async () => {
			const { u, rt } = await ownType();
			await expect(clearRelationTypeLabel(db, u.id, rt.id, 'it')).resolves.toBeUndefined();
		});

		it('refuses to clear a type this universe does not own', async () => {
			const { rt } = await ownType();
			const otherUniverse = await insertHomebrewUniverse(db);
			await expect(clearRelationTypeLabel(db, otherUniverse.id, rt.id, 'it')).rejects.toThrow(
				RelationTypeNotOwnedError
			);
		});
	});

	describe('listRelationTypesForUniverse labels', () => {
		it('carries every locale translated so far, keyed by locale', async () => {
			const { u, rt } = await ownType();
			await setRelationTypeLabel(db, u.id, rt.id, {
				locale: 'it',
				label: 'fa da mentore',
				inverseLabel: 'assistito da',
				authorKind: 'human'
			});

			const rows = await listRelationTypesForUniverse(db, u.id);
			const row = rows.find((r) => r.id === rt.id);
			expect(row?.labels).toEqual({
				it: { label: 'fa da mentore', inverseLabel: 'assistito da', authorKind: 'human' }
			});
		});

		it('is null for a universe-owned type nobody has translated yet', async () => {
			const { u, rt } = await ownType();
			const rows = await listRelationTypesForUniverse(db, u.id);
			const row = rows.find((r) => r.id === rt.id);
			expect(row?.labels).toBeNull();
		});

		it('is null for every shipped row, which can never carry a translation', async () => {
			const u = await insertHomebrewUniverse(db);
			const rows = await listRelationTypesForUniverse(db, u.id);
			for (const row of rows.filter((r) => r.universeId === null)) {
				expect(row.labels).toBeNull();
			}
		});
	});
});
