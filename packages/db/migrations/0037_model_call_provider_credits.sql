-- Issue #116: ElevenLabs bills sound-generation in its own credits (the `character-cost`
-- response header on `/v1/sound-generation`), a unit that is neither a token count nor a
-- Replicate-style image, so `model_call.provider_credits` gives that figure a column of
-- its own rather than being folded into input/output/embedding tokens. Nullable: every
-- text/embedding/image row today leaves this null ("not applicable"), never 0
-- ("billed nothing") - see packages/db/src/schema/model.ts's column comment for why that
-- distinction matters once cost_eur can be genuinely zero for a real, priced reason.
ALTER TABLE "model_call" ADD COLUMN "provider_credits" integer;