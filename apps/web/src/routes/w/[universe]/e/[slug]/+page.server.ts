import { error, fail } from '@sveltejs/kit';
import {
	historyFor,
	mediaAssetsForEntity,
	priceOf,
	relationsFor,
	universeAccessBySlug,
	type Db
} from '@canonry/db';
import { messages } from '$lib/i18n';
import { ImageModelNotConfiguredError, resolveImageModel, resolveStyle } from '@canonry/media';
import { AiDisabledError, completeEntry, semanticDiff } from '@canonry/copilot';
import { UnknownProviderError } from '@canonry/ai';
import { db } from '$lib/server/db';
import { identityGateway, modelFactory } from '$lib/server/copilot';
import { stripMentionSyntax } from '$lib/markdown';
import {
	changedSentencesForEntity,
	pendingUpdateProposalsForEntity,
	reviewableProposalsForEntity,
	ProposalAlreadyDecidedError,
	ProposalNotFoundError,
	rejectProposal
} from '$lib/server/proposals';
import { openAuditFlagsForEntity } from '$lib/server/auditFlags';
import { publicMentionTargetsFrom } from '$lib/server/players';
import type { AuditFlagView } from '$lib/components/audit/AuditFlagsPanel.svelte';
import type { Actions, PageServerLoad } from './$types';

/** Null when the feature has no active image_model_config row yet - the dialog then says
 * so instead of crashing the whole entry page over a missing admin setup step (#64). */
async function modelSummary(conn: Db, feature: 'portrait' | 'variants') {
	try {
		const model = await resolveImageModel(conn, feature);
		return { provider: model.provider, modelId: model.modelId };
	} catch (err) {
		if (err instanceof ImageModelNotConfiguredError) return null;
		throw err;
	}
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user)
		error(404, messages(locals.locale).entry.errors.universeNotFound(params.universe));

	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, messages(locals.locale).entry.errors.universeNotFound(params.universe));
	const world = access.universe;

	const current = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.universeId, world.id), eq(entity.slug, params.slug))
	});
	if (!current)
		error(404, messages(locals.locale).entry.errors.entryNotFound(params.slug, world.name));

	// Mention resolution needs every entity's name and aliases, not just this one - a body
	// full of `[[Other Entity]]` has to resolve against the whole universe (#105/#15).
	// `visibility` rides along too (#220): `publicMentionTargetsFrom` below filters this
	// same list down to what `publicMentionTargets` (`@canonry/db`) would return, so
	// `EntryProseWithSecrets.svelte`'s player preview matches the real `/p/` route with no
	// second query on toggle - one fetch here serves both surfaces.
	const universeEntities = await conn.query.entity.findMany({
		where: (entity, { eq }) => eq(entity.universeId, world.id),
		columns: { name: true, slug: true, aliases: true, visibility: true }
	});

	const entityFacts = await conn.query.fact.findMany({
		where: (fact, { eq }) => eq(fact.entityId, current.id),
		orderBy: (fact, { asc }) => asc(fact.spanStart)
	});

	// No `relations()` are declared between `fact` and `revision`, so the relational query
	// API can't join them; fetch the handful of source revisions the facts point at and
	// slice the excerpt in JS instead of asking Postgres for a `substring()`.
	const revisionIds = [...new Set(entityFacts.map((f) => f.sourceRevisionId))];
	const sourceRevisions = revisionIds.length
		? await conn.query.revision.findMany({
				where: (revision, { inArray }) => inArray(revision.id, revisionIds),
				columns: { id: true, body: true }
			})
		: [];
	const bodyByRevisionId = new Map(sourceRevisions.map((r) => [r.id, r.body]));

	const facts = entityFacts.map((f) => ({
		id: f.id,
		statement: f.statement,
		spanStart: f.spanStart,
		spanEnd: f.spanEnd,
		authorKind: f.authorKind,
		// A quoted excerpt is read as prose, not rendered as markdown, so `[[Name]]` reduces
		// to `Name` here; the stored span itself (used for the in-body highlight) is untouched.
		sourceExcerpt: stripMentionSyntax(
			(bodyByRevisionId.get(f.sourceRevisionId) ?? '').slice(f.spanStart, f.spanEnd)
		)
	}));

	const [
		relations,
		history,
		mediaAssets,
		style,
		portraitPrice,
		variantsPrice,
		completePrice,
		portraitModel,
		variantsModel,
		pendingProposals,
		review,
		openFlags
	] = await Promise.all([
		relationsFor(conn, current.id, locals.locale),
		historyFor(conn, current.id),
		mediaAssetsForEntity(conn, current.id),
		resolveStyle(conn, current.id),
		priceOf(conn, 'image.portrait'),
		priceOf(conn, 'image.variants'),
		// Round fifteen T1 (#428): the complete control's tooltip now states its own cost
		// (G11), the same way `cover.generateHint` already does next to its button - so this
		// loader fetches the same seeded `entry.complete` row `+page.server.ts`'s own
		// `complete` action already charges (`chargeFor`, `@canonry/ai`).
		priceOf(conn, 'entry.complete'),
		modelSummary(conn, 'portrait'),
		modelSummary(conn, 'variants'),
		pendingUpdateProposalsForEntity(conn, world.id, current.id),
		// #345: the same pending proposals again, resolved and enriched, so the entry can be
		// where they are reviewed. Deliberately a second read rather than derived from the
		// line above: the marking needs only patches, the review needs every joined name,
		// diff, layout and evidence view the queue renders, and collapsing the two would
		// make the C1 marking pay for the joins it has no use for.
		reviewableProposalsForEntity(conn, world.id, current.id),
		openAuditFlagsForEntity(conn, world.id, current.id)
	]);

	// C1 = B, #106: which of the entry's own sentences a pending proposal would replace or
	// remove, re-diffed live against `current.body` rather than a stored snapshot - see
	// `changedSentencesForEntity`'s own comment for why. An array over the wire (not a
	// `Set`) so the page component owns reconstructing it, matching every other derived
	// prop this load already returns as plain JSON.
	const markedSentences = [...changedSentencesForEntity(current.body, pendingProposals)];

	// C9 = B, #55: the badge's count and the aside's list read the same resolved flags -
	// mapped to a plain view here (statement text and current entity slugs only) so the
	// component never has to know a flag's evidence column is shaped like
	// `packages/copilot`'s `AuditFlagStatement`. `stripMentionSyntax` on the quoted text,
	// same treatment `facts.sourceExcerpt` gets above: a quote is read as prose, and the
	// stored span (untouched here) is what the guardrail-3 evidence actually anchors to.
	const auditFlags: AuditFlagView[] = openFlags.map((flag) => ({
		id: flag.proposal.id,
		rationale: flag.proposal.rationale,
		statements: [
			{
				entityId: flag.statements[0].entityId,
				entityName: flag.entities[0].name,
				entitySlug: flag.entities[0].slug,
				statement: stripMentionSyntax(flag.statements[0].statement)
			},
			{
				entityId: flag.statements[1].entityId,
				entityName: flag.entities[1].name,
				entitySlug: flag.entities[1].slug,
				statement: stripMentionSyntax(flag.statements[1].statement)
			}
		]
	}));

	return {
		universe: {
			slug: world.slug,
			name: world.name,
			id: world.id,
			aiEnabled: world.aiEnabled,
			// Issue #408, decision S3: the one condition every generate control and the
			// generate endpoint itself gate on - read straight off the row `_context.ts`
			// already loads for the endpoint, never redefined as a second query.
			hasImageStyle: world.imageStyleId !== null
		},
		entity: {
			id: current.id,
			type: current.type,
			name: current.name,
			slug: current.slug,
			aliases: current.aliases,
			body: current.body,
			// #347: `language` and `languageSource` are deliberately not here. The control that
			// read them moved to the editor, which loads them itself, and this page has nothing
			// left that shows an entry's language - a field nothing renders is a field the next
			// reader of this loader has to work out the purpose of.
			imagePromptModifier: current.imagePromptModifier,
			// O2 (#284): the band above the title and the Images section's "cover" badge read
			// this same field, so there is one answer to "which picture is the cover" on the
			// page. Guardrail 6 is not this loader's business - this is the GM's own surface,
			// and `/p/<slug>` resolves its own cover against visible, revealed assets only.
			coverAssetId: current.coverAssetId,
			updatedAt: current.updatedAt
		},
		mentionTargets: universeEntities,
		publicMentionTargets: publicMentionTargetsFrom(universeEntities),
		proposals: {
			markedSentences,
			// #345: what the region renders, and what stays a link because it has no text yet.
			reviewable: review.reviewable,
			awaitingDiff: review.awaitingDiff
		},
		audit: {
			flags: auditFlags
		},
		// Round fifteen T1 (#428): the icon button's tooltip states this before the click
		// spends it (G11), the same shape `media.generate.portrait.price` already gives
		// `EntryCoverPlaceholder`/`MediaGallery`'s own generate buttons.
		complete: {
			price: completePrice.credits
		},
		relations,
		history,
		facts,
		media: {
			assets: mediaAssets.map((asset) => ({
				id: asset.id,
				mimeType: asset.mimeType,
				generated: asset.generated,
				gmOnly: asset.gmOnly,
				credits: asset.credits,
				createdAt: asset.createdAt
			})),
			style,
			canWrite: access.role !== 'viewer',
			generate: {
				portrait: { price: portraitPrice.credits, model: portraitModel },
				variants: { price: variantsPrice.credits, model: variantsModel }
			}
		}
	};
};

/**
 * `dismissFlag`: the flag's only decision, per guardrail 7/`ProposalCannotBeAcceptedError`
 * - `rejectProposal`, never `acceptProposal`, since a flag carries no patch. `complete`:
 * issue #54, runs `completeEntry` and lands its output as a normal pending `update`
 * proposal (guardrail 1), then immediately dismisses it again if the draft turned out to
 * change nothing - a proposal whose `after` is semantically identical to `before` is not
 * "something to review", it is the model declining to add anything (`completeEntry`'s own
 * system prompt allows this explicitly), so leaving it pending would show a false pending
 * count for zero real content.
 */
async function requireAccess(locals: App.Locals, universeSlug: string) {
	if (!locals.user) error(404, messages(locals.locale).entry.errors.universeNotFound(universeSlug));
	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, messages(locals.locale).entry.errors.universeNotFound(universeSlug));
	return { conn, world: access.universe, role: access.role, userId: locals.user.id };
}

export const actions: Actions = {
	dismissFlag: async ({ request, params, locals }) => {
		const { conn, userId } = await requireAccess(locals, params.universe);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string')
			return fail(400, { error: messages(locals.locale).entry.errors.missingProposalId });
		try {
			const rejected = await rejectProposal(conn, { proposalId, reason: null, decidedBy: userId });
			return { id: rejected.id };
		} catch (err) {
			if (err instanceof ProposalNotFoundError || err instanceof ProposalAlreadyDecidedError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	},

	complete: async ({ params, locals }) => {
		const { conn, world, userId } = await requireAccess(locals, params.universe);
		const current = await conn.query.entity.findFirst({
			where: (entity, { and, eq }) =>
				and(eq(entity.universeId, world.id), eq(entity.slug, params.slug))
		});
		if (!current)
			error(404, messages(locals.locale).entry.errors.entryNotFound(params.slug, world.name));

		try {
			const result = await completeEntry({
				db: conn,
				userId,
				universeId: world.id,
				entityId: current.id,
				// Speech follows the reader; the drafted body follows this entry's own language,
				// which `completeEntry` reads from the entity itself (SPEC.md §17).
				locale: locals.locale,
				modelFactory,
				gateway: identityGateway
			});
			const patch = result.proposal.patch as { before: string; after: string };
			if (semanticDiff(patch.before, patch.after).length === 0) {
				await rejectProposal(conn, {
					proposalId: result.proposal.id,
					reason: null,
					decidedBy: userId
				});
				return { completeEmpty: true };
			}
			return { completed: true };
		} catch (err) {
			if (err instanceof AiDisabledError) {
				return fail(403, { completeError: messages(locals.locale).entry.complete.aiOff });
			}
			if (err instanceof UnknownProviderError) {
				return fail(503, {
					completeError: messages(locals.locale).entry.errors.completeCannotRun(err.message)
				});
			}
			throw err;
		}
	}
};
