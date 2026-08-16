CREATE TABLE "relation_type_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relation_type_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"inverse_label" text NOT NULL,
	"author_kind" "author_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relation_type_label_type_locale_key" UNIQUE("relation_type_id","locale")
);
--> statement-breakpoint
ALTER TABLE "relation_type_label" ADD CONSTRAINT "relation_type_label_relation_type_id_relation_type_id_fk" FOREIGN KEY ("relation_type_id") REFERENCES "public"."relation_type"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Issue #198: the shipped ten never get a row here - their strings live in the i18n
-- bundle (#196), never in this table, so there is exactly one place either one's text
-- lives and nothing to reconcile between them. A `CHECK` constraint cannot look at
-- `relation_type.universe_id` from this table, so the rule is a trigger instead, the
-- same choice 0032_relation_type_key.sql made for `relation_type_derive_key_trigger`.
-- Fires on UPDATE too, not only INSERT: a row inserted while its type was still a
-- universe's own must not survive that type later being repointed - though nothing
-- today ever changes `relation_type.universe_id` after insert, so this is defense in
-- depth against a future write path assuming otherwise, not a rule protecting against a
-- reachable case yet.
CREATE OR REPLACE FUNCTION relation_type_label_owned_only() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM relation_type
		WHERE id = NEW.relation_type_id AND universe_id IS NOT NULL
	) THEN
		RAISE EXCEPTION 'relation_type_label: relation_type % is not a universe''s own type', NEW.relation_type_id;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER relation_type_label_owned_only_trigger
BEFORE INSERT OR UPDATE ON "relation_type_label"
FOR EACH ROW EXECUTE FUNCTION relation_type_label_owned_only();