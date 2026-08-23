<script lang="ts" module>
	import { type VariantProps } from 'tailwind-variants';
	import { tv } from '$lib/utils/cn';

	/* #147: default/secondary/destructive started this set. #155 adds two more meanings
	 * that already existed in the app as hand-written pills - `ok` (the live proposal
	 * feed's accepted state, RevisionBadge's ai-accepted state) and `accent` (the
	 * players' wiki entity type tag, a soft tint where `default`'s solid fill would
	 * shout). Still no "outline"/"ghost"/"link" - see the note above - and never the copilot's
	 * hue: its own marking (C1) stays off this generic set on guardrail 2's say-so, not
	 * this component's. */
	export const badgeVariants = tv({
		base: 'h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-label font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none',
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
				secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
				destructive:
					'bg-destructive/10 text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/20',
				ok: 'bg-ok-bg text-ok [a]:hover:bg-ok-bg/80',
				accent: 'bg-accent-bg text-accent-ink [a]:hover:bg-accent-bg/80'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils/cn.js';
	import type { HTMLAnchorAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
	} = $props();
</script>

<svelte:element
	this={href ? 'a' : 'span'}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
