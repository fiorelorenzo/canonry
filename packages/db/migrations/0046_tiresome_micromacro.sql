-- Issue #382, decision R7: an image's audience now follows its entry - attaching one is
-- the accept, and `gm_only` is the deliberate exception that holds a picture back even
-- after its entry is revealed. A plain RENAME COLUMN carries every row's old boolean
-- forward untouched, so the UPDATE below inverts it: a row that was
-- published_to_players = true (visible under the old switch) must come out gm_only =
-- false, and a row that was false (never published) must come out gm_only = true - so
-- nothing invisible today becomes visible the moment this deploys (guardrail 6).
ALTER TABLE "media_asset" RENAME COLUMN "published_to_players" TO "gm_only";--> statement-breakpoint
UPDATE "media_asset" SET "gm_only" = NOT "gm_only";
