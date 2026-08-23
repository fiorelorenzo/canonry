import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { createTV } from 'tailwind-variants';

/**
 * V3's type scale (#495, #621) as a tailwind-merge class group, and it has to be
 * declared or the scale is silently deleted. tailwind-merge reads a `text-*` suffix it
 * does not recognise as a COLOUR, so `text-label` and `text-muted` land in one group
 * and the later one wins: `cn('text-label ... text-muted')` returns a list with no font
 * size in it at all and the element quietly inherits.
 *
 * That is not theoretical and it is not new. `EntryTable`'s `<th>` asks for
 * `text-label font-semibold tracking-wide text-muted uppercase`, and the DOM it
 * produced carried no `text-label`: measured at 16px, inherited from the table, where
 * the token says 12px. Same for every `Badge` in the app, whose `tv` base has carried
 * `text-label` since #509 while its variants carry a colour. It went unnoticed because
 * these elements used to ask for `text-xs`, which tailwind-merge does know is a font
 * size, so it survived the merge and the pixels were right for the wrong reason.
 *
 * Declaring them fixes both halves: they stop colliding with a colour, and they start
 * colliding with each other and with `text-sm`, which is what a merge function is for.
 * `routes/type-scale.test.ts` keeps this list in step with `@theme`.
 */
export const TYPE_SCALE = ['label', 'meta', 'body', 'title', 'page-title'] as const;

const twMergeConfig = {
	extend: { classGroups: { 'font-size': [{ text: [...TYPE_SCALE] }] } }
};

const twMerge = extendTailwindMerge(twMergeConfig);

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * `tailwind-variants` holds its OWN tailwind-merge instance, so configuring `cn` above
 * does not reach it and the four `tv` components (badge, button, and the two
 * input-group parts) would keep dropping the scale. They import this instead of
 * `tailwind-variants` directly, so the token list has one home.
 */
export const tv = createTV({ twMergeConfig: twMergeConfig.extend });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
