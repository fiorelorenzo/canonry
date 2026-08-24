/**
 * The one embedder `import.ts` needs, and the two things it feeds (issue #279).
 *
 * This exists to be importable, which `import.ts` is not: that file runs `await main()` at
 * module load, against a real gateway and a real database, so nothing can import it to check
 * what it does. Its guard (`import.test.ts`) therefore used to read the source text for an
 * `import { MATCH_THRESHOLDS } from '@canonry/import'` statement, which defended the right
 * property the weakest possible way: it passed on any file that happened to spell the import
 * that way and failed on this one the moment the product's resolver started returning the band
 * beside the scorer, even though the harness was then more correct than before, not less.
 *
 * Pulling the wiring out here makes the property checkable by behaviour instead: a test calls
 * `benchMatching` and asserts the band it comes back with is, by identity, the one
 * `@canonry/import` exports for that scorer. That fails if somebody re-inlines a literal, and
 * it does not care how an import statement is written.
 *
 * The `Db` is only closed over, never touched until the embedder is called, so that test needs
 * no Postgres - the same reason this package's tests touch none (AGENTS.md). The gateway key it
 * does need, because `readGatewayCredentials` is called here rather than per batch and should
 * fail this harness at wiring time rather than mid-run; a placeholder is enough, since building
 * a gateway-routed model object contacts nothing.
 */
import type { Db } from '@canonry/db';
import { createEmbeddingModel, readGatewayCredentials, type ResolvedModel } from '@canonry/ai';
import { createGatewayEmbedder, embeddingDimensionsFor, type Embedder } from '@canonry/indexing';
import { bandedSimilarity, type BandedSimilarity } from '@canonry/import';

export interface BenchMatchingInput {
	db: Db;
	/** `model_config`'s current `embedding` row, already resolved by the caller: this module
	 * stays free of a database read so its guard needs no database. */
	model: ResolvedModel;
	userId: string;
	universeId: string;
}

export interface BenchMatching extends BandedSimilarity {
	/** K1 (docs/design/DECISIONS.md round six, issue #189): the import loop resolves a relation
	 * label the model proposed against the vocabulary the world already has, and the last rung
	 * of that resolver is semantic. Same embedder as the matcher's, so one job pays for one
	 * text once whichever of the two asked for it. */
	embedRelationLabel: Embedder;
}

/**
 * Builds the real gateway embedder and hands back both of the things a bench import run needs
 * from it: the relation-label embedder, and the banded similarity `@canonry/import` pairs with
 * it.
 *
 * `hashingEmbedder` is deliberately not an option here. This harness promises nothing is
 * stubbed, and both consumers are cases where a stand-in would produce a number about the
 * stand-in: §6.4's own re-import case is in this corpus by name, since v2 renames "The Gilded
 * Rat" to "Il Ratto Dorato", and the lexical scorer is near-blind to exactly that.
 */
export function benchMatching(input: BenchMatchingInput): BenchMatching {
	const embedRelationLabel = createGatewayEmbedder({
		db: input.db,
		model: {
			...input.model,
			model: createEmbeddingModel(
				input.model.provider,
				input.model.modelId,
				readGatewayCredentials(process.env)
			)
		},
		userId: input.userId,
		universeId: input.universeId,
		// Import matching's own row (issue #309), the same one the product now bills a matching
		// embed against. This embedder serves both halves of a bench import, the matcher and the
		// relation-label resolver, so both of them land on that row here, and since issue #629
		// the product does the same: `resolveRelationLabelEmbedder` names this operation too,
		// because a rung that embeds one to three words per relation is not worth its own price
		// row.
		operation: 'import.match.embed'
	});
	return {
		...bandedSimilarity({
			embed: embedRelationLabel,
			vectorSize: embeddingDimensionsFor(input.model.provider, input.model.modelId)
		}),
		embedRelationLabel
	};
}
