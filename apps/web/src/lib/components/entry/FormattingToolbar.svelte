<script lang="ts">
	/**
	 * G4 = A: an always-visible toolbar above the editor, because a trigger character is
	 * not free on an Italian keyboard. Every button inserts real markdown characters
	 * (`editorState.ts`'s pure edits) - never a shortcut around the mention resolve menu.
	 *
	 * Round twelve, Q4: every control here is an icon, and the rule that comes with that
	 * is the reason this file changed. An icon carries its name in a tooltip *and* in
	 * `aria-label`, both, everywhere - the tooltip is for the person who can see the
	 * button and does not recognise the glyph, the `aria-label` is for the person who
	 * never sees it at all, and neither one substitutes for the other. `ui/tooltip/` was
	 * vendored with the rest of the control layer (I9 = C) and unused until now, so this
	 * is the first call site rather than a new primitive.
	 *
	 * `title` is deliberately gone. It used to be the whole hint; keeping it beside a
	 * real tooltip would draw the browser's own yellow box on top of ours a second later,
	 * saying the same words in a different typeface. The toolbar does nothing at all
	 * without JavaScript (every button drives a textarea through an event handler), so
	 * there is no no-JS reader losing a label here.
	 *
	 * The bar's chrome (border, background, rounding) belongs to `MarkdownEditor`, which
	 * owns the row this sits in and puts the write/preview control at the other end of it.
	 */
	import BoldIcon from '@lucide/svelte/icons/bold';
	import ItalicIcon from '@lucide/svelte/icons/italic';
	import Heading2Icon from '@lucide/svelte/icons/heading-2';
	import ListIcon from '@lucide/svelte/icons/list';
	import QuoteIcon from '@lucide/svelte/icons/quote';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ImageIcon from '@lucide/svelte/icons/image';
	import AtSignIcon from '@lucide/svelte/icons/at-sign';
	import { messages, type Locale } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';

	export type FormatCommand =
		'bold' | 'italic' | 'heading' | 'list' | 'quote' | 'link' | 'image' | 'mention';

	/** Any of the `@lucide/svelte` icons above: they all share one component signature. */
	type IconComponent = typeof BoldIcon;

	interface ToolbarButton {
		command: FormatCommand;
		icon: IconComponent;
		/** The one string the tooltip shows and `aria-label` announces. Deliberately one
		 * value and not two, so a translation can never label the eye and the screen
		 * reader differently. */
		name: string;
	}

	let {
		onCommand,
		locale,
		imageInsertEnabled = false,
		disabled = false
	}: {
		onCommand: (command: FormatCommand) => void;
		locale: Locale;
		/** Issue #253: only the entry editor (which knows the entity's universe/slug and
		 * its image assets) can offer this button - the works/node editor reuses this same
		 * toolbar with no entity behind it, so the button stays hidden there rather than
		 * opening a picker with nothing to pick from. */
		imageInsertEnabled?: boolean;
		/** True while the preview is showing: these buttons edit a textarea nobody can see
		 * from there, so they go disabled rather than silently rewriting hidden text. */
		disabled?: boolean;
	} = $props();
	let t = $derived(messages(locale));

	// `\u2022` and `\u201C` used to stand in for a list and a quote, which asked the
	// reader to recognise a punctuation mark as a block type and left the glyph at the
	// mercy of whichever font resolved. Both are real icons now.
	let buttons = $derived<ToolbarButton[]>([
		{ command: 'bold', icon: BoldIcon, name: t.entry.toolbar.bold },
		{ command: 'italic', icon: ItalicIcon, name: t.entry.toolbar.italic },
		{ command: 'heading', icon: Heading2Icon, name: t.entry.toolbar.heading },
		{ command: 'list', icon: ListIcon, name: t.entry.toolbar.list },
		{ command: 'quote', icon: QuoteIcon, name: t.entry.toolbar.quote },
		{ command: 'link', icon: LinkIcon, name: t.entry.toolbar.link },
		...(imageInsertEnabled
			? [
					{
						command: 'image' as const,
						icon: ImageIcon,
						name: t.entry.media.inBody.toolbarTitle
					}
				]
			: [])
	]);
</script>

{#snippet iconButton(button: ToolbarButton)}
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => onCommand(button.command)}>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="ghost"
					size="icon"
					{disabled}
					class="size-8 hover:bg-panel aria-expanded:bg-panel"
					aria-label={button.name}
				>
					<button.icon aria-hidden="true" />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{button.name}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<!-- One provider for the whole bar: bits-ui shares the open-delay state across it, so
     moving along the row after the first tooltip opens does not re-wait each time. -->
<Tooltip.Provider delayDuration={400}>
	<div class="flex items-center gap-1" role="toolbar" aria-label={t.entry.toolbar.ariaLabel}>
		{#each buttons as button (button.command)}
			{@render iconButton(button)}
		{/each}
		<!-- The divider survives the move to icons, and it was never compensating for text
		     labels: everything to its left writes markdown characters into the body, while
		     `@` reaches into this universe's own entities and opens the resolve menu. That
		     is a different kind of act, so it keeps a different position in the row. What
		     it loses is the monospaced styling, which existed only to make the bare `@`
		     read as a character rather than as a word. -->
		<div class="mx-1 h-5 w-px bg-line-2"></div>
		{@render iconButton({
			command: 'mention',
			icon: AtSignIcon,
			name: t.entry.toolbar.mention
		})}
	</div>
</Tooltip.Provider>
