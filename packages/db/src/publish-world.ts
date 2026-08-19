/**
 * Publishing a world to its players' wiki, as a reviewed plan rather than a switch.
 *
 * SPEC.md §10 is explicit that the players' wiki takes "zero configuration from the GM: if
 * it came up at the table, it shows up", and decision E5 chose the session log as the only
 * path there. So there is no per-entry publish button in this product, deliberately, and
 * "publish a world" cannot mean flipping one: it means writing the `revelation` rows a
 * table would have written, for a slice somebody read first. That is what this module does,
 * and nothing else - guardrail 6's review step is the plan below being in git, read in a
 * pull request, rather than a dialog somebody clicks through.
 *
 * Three things it refuses, because the point of a script here is that it cannot do more
 * than the table could:
 *
 * - It never changes `entity.visibility`. A `gm_only` entry named in a plan is an error
 *   that writes nothing, not a row to flip: that marking is the GM saying players may not
 *   even learn the name, and no automated act gets to overrule it.
 * - It never reveals a fact. A fact's `sourceExcerpt` is cut from the raw revision body
 *   (`publicEntityBySlug`), and nothing in the public read path checks whether that span
 *   sits inside a `:::secret` fence, so a bulk fact reveal is the one shape of this script
 *   that could publish text a reader was never meant to see. A fact reaches players through
 *   the table, where the GM is looking at the sentence they are revealing. Issue #306
 *   carries the missing filter.
 * - It never reveals a relation that touches something outside the published slice, so a
 *   relation can only ever name an entry the index already lists.
 *
 * Idempotent, because a runbook step that cannot be re-run safely does not get re-run at
 * all: every write goes through `revealEntityLive`/`revealRelationLive`, whose unique index
 * per (target, session) turns a second run into a no-op that never moves an earlier
 * `confirmed_at`.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { closeDb, createDb, type Db } from './client.js';
import { isPubliclyVisible, revealEntityLive, revealRelationLive } from './queries/players.js';
import { user } from './schema/auth.js';
import { entity } from './schema/entity.js';
import { revelation } from './schema/players.js';
import { relation } from './schema/relation.js';
import { universe, universeMember } from './schema/universe.js';

export interface PublicationSession {
	/** Slug of an existing `session` entity in the universe. */
	session: string;
	/** Slugs of the entries that became readable in that session. The session entry itself
	 * is always published alongside them: a recap nobody can read is not a recap. */
	entities: string[];
}

export interface PublicationPlan {
	universeSlug: string;
	sessions: PublicationSession[];
}

export interface PublicationResult {
	universeId: string;
	/** Entity slugs this run publishes, session order first, plan order within a session. */
	published: string[];
	/**
	 * Entries a different session had already revealed, left exactly as they were.
	 *
	 * An entry is learned once. A world's own history wins over a plan that disagrees with
	 * it: the fixture reveals three entries in session 1 by itself, and a real table reveals
	 * whatever came up whenever it came up, so a plan naming a different session for one of
	 * those must not write a second row and quietly move when the players learned it.
	 */
	alreadyPublic: string[];
	/** Relations this run makes visible: both ends published by this plan, so a relation
	 * never names an entry the public index does not already list. Relations another session
	 * already revealed are left alone for the same reason entries are. */
	relations: number;
	/** Revealable entries the plan leaves as decision E7 gap pages, on purpose. */
	gaps: string[];
	/** `gm_only` entries this run did not touch and could not have. */
	withheld: string[];
}

/** A plan that does not match the database, reported before anything is written. */
export class PublicationPlanError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PublicationPlanError';
	}
}

export interface PublishWorldOptions {
	/** Recorded on every `revelation` row this writes, so a GM asking why the party knows
	 * something gets an answer that names the act rather than a bare timestamp. */
	note?: string;
	/** Validate and compute, write nothing. */
	dryRun?: boolean;
}

/**
 * Valdoria Reach as we publish it, which is the answer to "which entries of the sample
 * world are revealed" and the thing to review in this file.
 *
 * The slice is a reading order, not a subset chosen for safety. Three sessions of a real
 * campaign's worth of discovery, each one leaving the reader somewhere they can carry on
 * from: the city and the inn, then the court that broke the captain and the bank that
 * bought him, then the winter everybody in the first two sessions keeps referring to. Every
 * `[[mention]]` in a published body lands on another published entry, with two deliberate
 * exceptions that read as the honest edges of a world rather than as holes:
 *
 * - **The Smugglers' Ledger** stays a gap page. Its own first sentence says nobody at the
 *   table has read it, so publishing its text would contradict the entry; a name the
 *   players have heard of and nothing else is exactly what decision E7's gap page is for.
 * - **The Drowned Concord** is `gm_only` and therefore not in this plan at all, not even as
 *   a name. A mention of it inside published prose resolves like a name nothing owns.
 */
export const SAMPLE_WORLD_PUBLICATION: PublicationPlan = {
	universeSlug: 'valdoria-reach',
	sessions: [
		{
			// Arrival: the city, the room they took in it, the woman who keeps that room, the
			// man in the corner seat and the bank whose name is in his own entry. The first
			// three of those are what the fixture itself reveals in this session, so the plan
			// agrees with the world's own history instead of rewriting it.
			session: 'session-1',
			entities: [
				'valdoria',
				'the-gilded-rat',
				'mother-sennah',
				'aldric-vane',
				'the-valdoria-watch',
				'the-ashen-ledger'
			]
		},
		{
			// Who broke him, and who is paying for what is left of the watch. Reading these
			// after session 1 is what makes Aldric's own entry land.
			session: 'session-2',
			entities: ['iselde-wrenn', 'corvin-ashe', 'la-casa-dei-mercanti']
		},
		{
			// The winter both earlier sessions keep dating things from, and the two places
			// that carry it. Cairnmouth contradicts Aldric's own entry about who led the
			// watch through the second freeze, which is left in on purpose: guardrail 7, the
			// product shows what does not add up and never certifies a canon.
			session: 'session-3',
			entities: ['the-sable-winter', 'the-sable-reach', 'cairnmouth']
		}
	]
};

/** The note every row written for the sample world carries, so the prod database says out
 * loud that this world is ours and why its wiki is public. */
export const SAMPLE_WORLD_NOTE = 'Published as our own sample world (canonry#251).';

export async function publishWorld(
	db: Db,
	plan: PublicationPlan,
	options: PublishWorldOptions = {}
): Promise<PublicationResult> {
	const [world] = await db
		.select({ id: universe.id })
		.from(universe)
		.where(eq(universe.slug, plan.universeSlug))
		.limit(1);
	if (!world) {
		throw new PublicationPlanError(`no universe has the slug "${plan.universeSlug}"`);
	}

	const rows = await db
		.select({
			id: entity.id,
			slug: entity.slug,
			type: entity.type,
			visibility: entity.visibility
		})
		.from(entity)
		.where(eq(entity.universeId, world.id));
	const bySlug = new Map(rows.map((row) => [row.slug, row]));

	// Every problem at once, and nothing written until there are none: a plan half applied
	// is worse than a plan refused, because the half that landed is public.
	const missing: string[] = [];
	const gmOnly: string[] = [];
	const notSessions: string[] = [];
	const duplicated: string[] = [];
	/** Publication order: entity slug to the session it is attributed to. */
	const sessionBySlug = new Map<string, string>();

	for (const step of plan.sessions) {
		const sessionRow = bySlug.get(step.session);
		if (sessionRow && sessionRow.type !== 'session') notSessions.push(step.session);
		for (const slug of [step.session, ...step.entities]) {
			const row = bySlug.get(slug);
			if (!row) {
				missing.push(slug);
				continue;
			}
			if (!isPubliclyVisible(row.visibility)) {
				gmOnly.push(slug);
				continue;
			}
			if (sessionBySlug.has(slug)) {
				duplicated.push(slug);
				continue;
			}
			sessionBySlug.set(slug, step.session);
		}
	}

	const problems: string[] = [];
	if (missing.length > 0) {
		problems.push(`no entry with these slugs: ${missing.join(', ')}`);
	}
	if (gmOnly.length > 0) {
		problems.push(
			`these entries are gm_only: ${gmOnly.join(', ')}. Publishing never changes an ` +
				'entry\u2019s visibility. If players may learn one of these exists, mark it ' +
				'revealable in the GM tool first, deliberately.'
		);
	}
	if (notSessions.length > 0) {
		problems.push(`these slugs are not session entries: ${notSessions.join(', ')}`);
	}
	if (duplicated.length > 0) {
		problems.push(
			`these entries appear in more than one session: ${duplicated.join(', ')}. An entry ` +
				'is learned once; two sessions would write two revelation rows for it.'
		);
	}
	if (problems.length > 0) {
		throw new PublicationPlanError(
			`refusing to publish ${plan.universeSlug}: ${problems.join(' | ')}`
		);
	}

	// What the world already says was learned, and in which session. A plan does not get to
	// rewrite that: an entry or a relation another session already revealed is left exactly
	// as it is, which is why running this against a world whose table has been playing is
	// safe rather than destructive.
	const confirmed = await db
		.select({
			kind: revelation.kind,
			entityId: revelation.entityId,
			relationId: revelation.relationId,
			sessionEntityId: revelation.sessionEntityId
		})
		.from(revelation)
		.where(and(eq(revelation.universeId, world.id), isNotNull(revelation.confirmedAt)));

	const alreadyPublic: string[] = [];
	const toReveal: Array<{ slug: string; session: string }> = [];
	for (const [slug, session] of sessionBySlug) {
		const entityId = bySlug.get(slug)?.id;
		const plannedSessionId = bySlug.get(session)?.id;
		const elsewhere = confirmed.some(
			(row) =>
				row.kind === 'entity' &&
				row.entityId === entityId &&
				row.sessionEntityId !== plannedSessionId
		);
		if (elsewhere) alreadyPublic.push(slug);
		else toReveal.push({ slug, session });
	}

	const publishedIds = new Set([...sessionBySlug.keys()].map((slug) => bySlug.get(slug)?.id));

	// A relation is only ever revealed between two published entries. Attributed to the
	// later of the two sessions, because that is when the pair was knowable at all.
	const sessionOrder = new Map(plan.sessions.map((step, index) => [step.session, index]));
	const relationRows = await db
		.select({
			id: relation.id,
			fromEntityId: relation.fromEntityId,
			toEntityId: relation.toEntityId
		})
		.from(relation)
		.where(eq(relation.universeId, world.id));
	const idToSlug = new Map(rows.map((row) => [row.id, row.slug]));
	const relationsToReveal = relationRows
		.filter((row) => publishedIds.has(row.fromEntityId) && publishedIds.has(row.toEntityId))
		.map((row) => {
			const from = sessionBySlug.get(idToSlug.get(row.fromEntityId) ?? '') ?? '';
			const to = sessionBySlug.get(idToSlug.get(row.toEntityId) ?? '') ?? '';
			const later = (sessionOrder.get(from) ?? 0) >= (sessionOrder.get(to) ?? 0) ? from : to;
			return { id: row.id, session: later };
		})
		.filter(
			(row) =>
				!confirmed.some(
					(existing) =>
						existing.kind === 'relation' &&
						existing.relationId === row.id &&
						existing.sessionEntityId !== bySlug.get(row.session)?.id
				)
		);

	if (!options.dryRun) {
		const note = options.note ?? '';
		for (const { slug, session } of toReveal) {
			const entityId = bySlug.get(slug)?.id;
			const sessionEntityId = bySlug.get(session)?.id;
			if (!entityId || !sessionEntityId) throw new PublicationPlanError('plan resolution lost');
			await revealEntityLive(db, {
				universeId: world.id,
				entityId,
				sessionEntityId,
				note
			});
		}
		for (const row of relationsToReveal) {
			const sessionEntityId = bySlug.get(row.session)?.id;
			if (!sessionEntityId) throw new PublicationPlanError('plan resolution lost');
			await revealRelationLive(db, {
				universeId: world.id,
				relationId: row.id,
				sessionEntityId,
				note
			});
		}
	}

	return {
		universeId: world.id,
		published: toReveal.map(({ slug }) => slug),
		alreadyPublic,
		relations: relationsToReveal.length,
		gaps: rows
			.filter((row) => isPubliclyVisible(row.visibility) && !sessionBySlug.has(row.slug))
			.map((row) => row.slug)
			.sort(),
		withheld: rows
			.filter((row) => !isPubliclyVisible(row.visibility))
			.map((row) => row.slug)
			.sort()
	};
}

/**
 * Hands a universe to a real account: `owner_user_id` plus an `owner` row in
 * `universe_member`, which is what the GM tool reads for access.
 *
 * Issue #251 decided the published sample is a real world owned by a real account rather
 * than something the deployment seeds, and this is the step that makes that true. The
 * account has to exist already, created through sign-up like anybody else's: this never
 * invents a user row, because an owner with no credential is exactly the halfway state the
 * fixture owner is and the reason this function exists.
 */
export async function claimUniverse(
	db: Db,
	input: { universeSlug: string; ownerEmail: string }
): Promise<{ universeId: string; userId: string }> {
	const [world] = await db
		.select({ id: universe.id })
		.from(universe)
		.where(eq(universe.slug, input.universeSlug))
		.limit(1);
	if (!world) {
		throw new PublicationPlanError(`no universe has the slug "${input.universeSlug}"`);
	}
	const [account] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, input.ownerEmail))
		.limit(1);
	if (!account) {
		throw new PublicationPlanError(
			`no account with the email "${input.ownerEmail}". Sign up first, then re-run.`
		);
	}

	await db.update(universe).set({ ownerUserId: account.id }).where(eq(universe.id, world.id));
	await db
		.insert(universeMember)
		.values({ universeId: world.id, userId: account.id, role: 'owner' })
		.onConflictDoUpdate({
			target: [universeMember.universeId, universeMember.userId],
			set: { role: 'owner' }
		});

	return { universeId: world.id, userId: account.id };
}

async function main(): Promise<void> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) throw new Error('DATABASE_URL is not set');

	const args = process.argv.slice(2);
	const apply = args.includes('--apply');
	const ownerIndex = args.indexOf('--owner');
	const ownerEmail = ownerIndex >= 0 ? args[ownerIndex + 1] : undefined;
	if (ownerIndex >= 0 && !ownerEmail) throw new Error('--owner needs an email address');

	const plan = SAMPLE_WORLD_PUBLICATION;
	const db = createDb(connectionString, { max: 1, quiet: true });
	try {
		if (ownerEmail && apply) {
			const claimed = await claimUniverse(db, { universeSlug: plan.universeSlug, ownerEmail });
			console.log(`owner of ${plan.universeSlug} is now ${ownerEmail} (${claimed.userId})`);
		} else if (ownerEmail) {
			console.log(`would hand ${plan.universeSlug} to ${ownerEmail}`);
		}

		const result = await publishWorld(db, plan, {
			note: SAMPLE_WORLD_NOTE,
			dryRun: !apply
		});
		for (const step of plan.sessions) {
			console.log(`  ${step.session}: ${step.entities.join(', ')}`);
		}
		console.log(`  ${result.published.length} entries published, ${result.relations} relations`);
		if (result.alreadyPublic.length > 0) {
			console.log(
				`  already public from another session, left alone: ${result.alreadyPublic.join(', ')}`
			);
		}
		console.log(`  left as gap pages: ${result.gaps.join(', ') || 'none'}`);
		console.log(`  gm_only, untouched: ${result.withheld.join(', ') || 'none'}`);
		console.log(
			apply
				? `\npublished. Read it signed out at /p/${plan.universeSlug}`
				: '\ndry run, nothing written. Re-run with --apply.'
		);
	} finally {
		await closeDb(db);
	}
}

// CLI entry point: `tsx src/publish-world.ts`, or `node migrate/dist/publish-world.js` from
// the shipped runtime image, which carries this file compiled next to the migrator for
// exactly this reason. Guarded so importing the module never publishes anything.
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err: unknown) => {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
	});
}
