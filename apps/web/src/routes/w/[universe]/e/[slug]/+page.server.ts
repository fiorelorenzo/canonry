import { error, fail } from '@sveltejs/kit';
import {
	historyFor,
	mediaAssetsForEntity,
	priceOf,
	relationsFor,
	resetEntityLanguageToDetected,
	setEntityLanguage,
	universeAccessBySlug,
	type Db
} from '@canonry/db';
import { isLocale, messages, toLocale } from '$lib/i18n';
import { ImageModelNotConfiguredError, resolveImageModel, resolveStyle } from '@canonry/media';
import { AiDisabledError, completeEntry, semanticDiff } from '@canonry/copilot';
import { UnknownProviderError } from '@canonry/ai';
import { db } from '$lib/server/db';
import { identityGateway, modelFactory } from '$lib/server/copilot';
import { stripMentionSyntax } from '$lib/markdown';
import {
	changedSentencesForEntity,
	pendingUpdateProposalsForEntity,
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
		portraitModel,
		variantsModel,
		pendingProposals,
		openFlags
	] = await Promise.all([
		relationsFor(conn, current.id, locals.locale),
		historyFor(conn, current.id),
		mediaAssetsForEntity(conn, current.id),
		resolveStyle(conn, current.id),
		priceOf(conn, 'image.portrait'),
		priceOf(conn, 'image.variants'),
		modelSummary(conn, 'portrait'),
		modelSummary(conn, 'variants'),
		pendingUpdateProposalsForEntity(conn, world.id, current.id),
		openAuditFlagsForEntity(conn, world.id, current.id)
	]);

	// C1 = B, #106: which of the entry's own sentences a pending proposal would replace or
	// remove, re-diffed live against `current.body` rather than a stored snapshot - see
	// `changedSentencesForEntity`'s own comment for why. An array over the wire (not a
	// `Set`) so the page component owns reconstructing it, matching every other derived
	// prop this load already returns as plain JSON.
	const markedSentences = [...changedSentencesForEntity(current.body, pendingProposals)];
	const pendingProposalPlanId = pendingProposals[0]?.planId ?? null;

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
			aiEnabled: world.aiEnabled
		},
		entity: {
			id: current.id,
			type: current.type,
			name: current.name,
			slug: current.slug,
			aliases: current.aliases,
			body: current.body,
			language: toLocale(current.language),
			languageSource: current.languageSource,
			imagePromptModifier: current.imagePromptModifier,
			// O2 (#284): the band above the title and the Images section's "cover" badge read
			// this same field, so there is one answer to "which picture is the cover" on the
			// page. Guardrail 6 is not this loader's business - this is the GM's own surface,
			// and `/p/<slug>` resolves its own cover against published assets only.
			coverAssetId: current.coverAssetId,
			updatedAt: current.updatedAt
		},
		mentionTargets: universeEntities,
		publicMentionTargets: publicMentionTargetsFrom(universeEntities),
		proposals: {
			markedSentences,
			count: pendingProposals.length,
			planId: pendingProposalPlanId
		},
		audit: {
			flags: auditFlags
		},
		relations,
		history,
		facts,
		media: {
			assets: mediaAssets.map((asset) => ({
				id: asset.id,
				mimeType: asset.mimeType,
				generated: asset.generated,
				publishedToPlayers: asset.publishedToPlayers,
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
	},

	/** Issue #122, SPEC.md §17: the entry's own language control. `auto` reverts to
	 * detection and re-runs it immediately against the body as it stands now, rather than
	 * leaving a stale guess sitting under the new 'detected' provenance until the next
	 * save; `unsure` is the explicit "not sure / mixed" answer, stored as `language: null`
	 * under `languageSource: 'human'` so it is never re-guessed. */
	setLanguage: async ({ request, params, locals }) => {
		const { conn, world, role } = await requireAccess(locals, params.universe);
		if (role === 'viewer')
			error(403, messages(locals.locale).entry.errors.viewerCannotChangeLanguage);

		const current = await conn.query.entity.findFirst({
			where: (entity, { and, eq }) =>
				and(eq(entity.universeId, world.id), eq(entity.slug, params.slug)),
			columns: { id: true }
		});
		if (!current)
			error(404, messages(locals.locale).entry.errors.entryNotFound(params.slug, world.name));

		const form = await request.formData();
		const choice = form.get('language');
		if (typeof choice !== 'string')
			return fail(400, {
				languageError: messages(locals.locale).entry.errors.missingLanguageChoice
			});

		if (choice === 'auto') {
			return await resetEntityLanguageToDetected(conn, { entityId: current.id });
		}
		if (choice === 'unsure') {
			return await setEntityLanguage(conn, { entityId: current.id, language: null });
		}
		if (!isLocale(choice))
			return fail(400, {
				languageError: messages(locals.locale).entry.errors.unknownLanguage(choice)
			});
		return await setEntityLanguage(conn, { entityId: current.id, language: choice });
	}
};
