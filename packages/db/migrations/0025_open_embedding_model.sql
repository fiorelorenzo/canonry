-- The embedding model moves to open weights: `alibaba/qwen3-embedding-4b`, Apache-2.0, 2560
-- dimensions. Chosen and argued in packages/indexing/src/models.ts, which carries the measurement
-- table this migration is the consequence of.
--
-- Why, in one line: it is the only candidate measured whose retrieval does not degrade when the
-- question changes language (English MRR 0.793, Italian 0.795 against the same English chunks),
-- where every closed model tested loses between 0.12 and 0.32 MRR on that switch. Open weights are
-- the requirement rather than a preference, because a vector is the one artefact in this product
-- that cannot be recomputed cheaply: Apache-2.0 weights served by six providers mean a provider can
-- be changed without re-embedding a customer's corpus, and a proprietary endpoint means it cannot.
--
-- The rate: Vercel AI Gateway's own model list quotes $0.00000002 per input token, so $0.020 per
-- million, which at the ECB reference rate of 2026-08-15 (1 EUR = 1.1567 USD) is 0.0173 EUR per
-- million. That is 8.7x cheaper than the gemini row it replaces, on top of being better at the job.
--
-- **This changes the vector width from 3072 to 2560, so every existing lore collection is
-- unreadable and has to be re-indexed.** Nothing is dropped here: the collection name carries the
-- model (`UniverseLore_{provider}_{model}_{universeId}`, SPEC.md §11.3), so old collections are
-- simply orphaned rather than corrupted, and `ensureCollection`'s `onDimensionMismatch: 'throw'`
-- refuses to write 2560-wide vectors into a 3072-wide collection. Dropping the orphans is a
-- deliberate operational step, not something a migration should do to a customer's data.
UPDATE "model_config"
SET "provider" = 'alibaba',
	"model_id" = 'qwen3-embedding-4b',
	"params" = '{"eurPerEmbeddingMTok":0.0173}'
WHERE "purpose" = 'embedding' AND "active" = true;

INSERT INTO "model_config" ("purpose", "provider", "model_id", "active", "params")
VALUES ('embedding', 'alibaba', 'qwen3-embedding-4b', true, '{"eurPerEmbeddingMTok":0.0173}')
ON CONFLICT DO NOTHING;
