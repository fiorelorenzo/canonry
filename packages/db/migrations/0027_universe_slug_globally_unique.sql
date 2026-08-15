-- Decision J1 (issue #153): a world's URL becomes /w/<slug> with no owner segment, so a
-- slug that two different owners hold no longer resolves to "whichever row Postgres
-- happens to scan first" (the bug #153 was filed for) - it has to name one world. The old
-- universe_owner_slug_key only enforced uniqueness within an owner, so a same-slug pair
-- across two accounts is valid data under the schema this migration replaces, and the dev
-- database has had exactly that. A migration that throws on real data is not a migration,
-- so duplicates are resolved before the new constraint is added, not after.
--
-- Rule: within each slug, the oldest row (by created_at, ties broken by id) keeps the
-- bare slug; every younger row is renamed slug-2, slug-3, ... in creation order. The
-- candidate search skips any suffix that already names a distinct row (a universe such as
-- "duskwood-vale-2" may already exist in its own right, unrelated to a "duskwood-vale"
-- duplicate being resolved here), so a rename never trades one collision for another.
do $$
declare
	dup record;
	candidate text;
	suffix int;
begin
	for dup in
		select
			id,
			slug,
			row_number() over (partition by slug order by created_at asc, id asc) as rn
		from universe
	loop
		if dup.rn = 1 then
			continue;
		end if;

		suffix := dup.rn;
		loop
			candidate := dup.slug || '-' || suffix;
			exit when not exists (select 1 from universe where slug = candidate);
			suffix := suffix + 1;
		end loop;

		update universe set slug = candidate where id = dup.id;
	end loop;
end $$;
--> statement-breakpoint
DROP INDEX "universe_owner_slug_key";--> statement-breakpoint
CREATE UNIQUE INDEX "universe_slug_key" ON "universe" USING btree ("slug");
