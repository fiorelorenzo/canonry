-- Better Auth 1.7 scopes an account's identity by (issuer, accountId) instead of
-- (providerId, accountId), and declares `issuer` required (issue #674). Hand-written rather
-- than left as drizzle-kit generated it, because the generated form was
-- `ADD COLUMN "issuer" text NOT NULL`, which Postgres refuses outright on a table that has
-- rows: it is correct on an empty database and fails every deploy that has ever had a user.
--
-- Add nullable, backfill by an explicit provider mapping, prove the identity pair is unique,
-- then constrain. Every statement here runs inside one transaction, because drizzle's
-- `PgDialect.migrate` wraps each pending migration in `session.transaction(...)`, so any
-- failure below rolls the whole file back and leaves no bookkeeping row: a stack that trips
-- one of the two assertions is a refused deploy on the old schema, never a half-migrated
-- one. That atomicity is also why the index is created plainly rather than CONCURRENTLY,
-- which cannot run in a transaction and leaves an INVALID index behind on failure for
-- somebody to find by hand on a box they were not looking at.
--
-- Values are Better Auth's, from its 1.7 upgrade guide's account identity section and from
-- `createLocalAccountIssuer`/`createOAuthAccountIssuer` in `@better-auth/core/db`:
--   credential -> local:credential                 (accountId is the linked user's own id)
--   google     -> https://accounts.google.com      (its built-in provider declares this issuer)
--   github     -> local:oauth:github               (no issuer of its own, so the synthetic one)
-- `buildSocialProviders` in apps/web/src/lib/server/auth.ts wires exactly github and google,
-- so those three are the whole set this deployment can hold.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint

-- Exhaustive CASE with no ELSE on purpose. An unmapped provider leaves the row NULL rather
-- than taking a plausible-looking fallback, and the assertion below turns that into a named
-- failure. A wrong issuer is an account that cannot sign in, discovered by its owner rather
-- than by us, so guessing is worse than refusing. This is also the file's only list of
-- provider values: the assertion reads the result of this statement instead of repeating
-- them, so the two cannot drift apart.
UPDATE "account" SET "issuer" = CASE "provider_id"
	WHEN 'credential' THEN 'local:credential'
	WHEN 'google' THEN 'https://accounts.google.com'
	WHEN 'github' THEN 'local:oauth:github'
END;--> statement-breakpoint

DO $$
DECLARE unmapped text;
BEGIN
	SELECT string_agg(DISTINCT quote_literal("provider_id"), ', ')
	INTO unmapped FROM "account" WHERE "issuer" IS NULL;

	IF unmapped IS NOT NULL THEN
		RAISE EXCEPTION
			'account.issuer backfill has no mapping for provider_id: %', unmapped
			USING HINT = 'Add the provider''s trusted issuer to migration 0053 before deploying. '
				'An OAuth provider with an OIDC issuer uses that issuer verbatim; one without uses '
				'local:oauth:<encodeURIComponent(providerId)>. Never derive it from an email, a '
				'display name or an authorization endpoint.';
	END IF;
END $$;--> statement-breakpoint

-- The unique index below is what makes the pair an identity, and it is the one statement here
-- that can legitimately fail on real data: nothing in the pre-1.7 schema stopped the same
-- provider account being linked to two different users, so preview and prod each have to be
-- shown to be clean rather than assumed to be. Asserting it separately buys the message: a
-- bare duplicate-key error names an index, this names the rows and says whether one user
-- linked twice (reconcile and delete the extras) or two users claim one identity (stop, and
-- establish the owner from the provider, never by matching email).
DO $$
DECLARE collisions text;
BEGIN
	SELECT string_agg(
		format('(%s, %s): %s rows across %s users', "issuer", "account_id", n_rows, n_users),
		'; ' ORDER BY "issuer", "account_id")
	INTO collisions
	FROM (
		SELECT "issuer", "account_id", count(*) AS n_rows, count(DISTINCT "user_id") AS n_users
		FROM "account" GROUP BY "issuer", "account_id" HAVING count(*) > 1
	) dupes;

	IF collisions IS NOT NULL THEN
		RAISE EXCEPTION
			'account identity (issuer, account_id) is not unique: %', collisions
			USING HINT = 'One user with duplicate rows: keep one, move its tokens, scopes and '
				'timestamps onto it, delete the rest. Two users on one identity: stop and '
				'establish the owner from trusted provider data.';
	END IF;
END $$;--> statement-breakpoint

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_key" ON "account" USING btree ("issuer","account_id");
