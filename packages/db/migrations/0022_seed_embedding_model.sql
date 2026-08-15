-- SPEC.md §17 and issue #125: retrieval has to find an English chunk from an Italian question,
-- which makes the embedding model a multilingual choice rather than a free one. There was no
-- 'embedding' row at all until now, so `resolveModel(db, 'embedding')` threw and every retrieval
-- path silently fell back to a bag-of-words hash - the gap that made §17's promise untrue in
-- practice while every test passed.
--
-- google/gemini-embedding-001 is chosen and argued in packages/indexing/src/models.ts, which also
-- records the en<->it numbers measured through the live gateway (translation pair 0.8093, Italian
-- question to English fact 0.7972, unrelated 0.5571, right chunk first 8 times out of 8).
--
-- The rate: Vercel AI Gateway's own model list quotes $0.00000015 per input token for this model,
-- which is $0.15 per million. The column is euros, so at the ECB reference rate of 2026-08-15
-- (1 EUR = 1.1567 USD) that is 0.15 * 0.8645 = 0.1297, rounded to 0.13 EUR per million tokens.
-- Stating the conversion because the gateway bills in dollars and model_call.cost_eur is what
-- SPEC.md §15's margin question is answered from: a dollar figure stored in a euro column is
-- wrong by about 15%, which is larger than the margin it is used to compute.
INSERT INTO "model_config" ("purpose", "provider", "model_id", "active", "params")
VALUES ('embedding', 'google', 'gemini-embedding-001', true, '{"eurPerEmbeddingMTok":0.13}')
ON CONFLICT DO NOTHING;
