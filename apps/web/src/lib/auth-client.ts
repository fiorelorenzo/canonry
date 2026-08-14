/**
 * The browser half of Better Auth (issue #86). No `baseURL` - the client talks to the
 * same origin the page was served from, which is where `hooks.server.ts`'s
 * `svelteKitHandler` already intercepts `/api/auth/*`, so there is nothing to point at
 * a second host in any of the environments this app runs in (dev, preview, prod).
 */
import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();
