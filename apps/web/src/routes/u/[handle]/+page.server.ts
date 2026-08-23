/**
 * Issue #158, decision J1: `/u/` is a person. This is the whole server side of that page,
 * and it is short on purpose - `publicProfileByHandle` (`@canonry/db`) owns which worlds a
 * profile may name and what it may say about them, the same way `loadPublicUniverse` owns
 * `/p/`'s, so `../leak.test.ts` calls this exported `load` rather than a re-derivation of
 * what it does.
 *
 * A handle nobody holds is a 404, and so is a reserved word, a malformed handle, and the
 * handle of an account that never chose one: none of them can be stored, so there is nothing
 * to tell apart and nothing to say beyond "no page here". That is also why this route does
 * not validate the parameter before querying - a lookup that cannot match is the same answer
 * as a lookup that is refused, and one code path is one thing to get right.
 */
import { error } from '@sveltejs/kit';
import { publicProfileByHandle } from '@canonry/db';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const profile = await publicProfileByHandle(db(), params.handle);
	if (!profile) error(404, `No profile at /u/${params.handle}`);
	return { profile };
};
