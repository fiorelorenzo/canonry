<script lang="ts">
	/**
	 * G4 = A: an always-visible toolbar above the editor, because a trigger character is
	 * not free on an Italian keyboard. Every button inserts real markdown characters
	 * (`editorState.ts`'s pure edits) - never a shortcut around the mention resolve menu.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';

	export type FormatCommand = 'bold' | 'italic' | 'heading' | 'list' | 'quote' | 'link' | 'mention';

	let { onCommand, locale }: { onCommand: (command: FormatCommand) => void; locale: Locale } =
		$props();
	let t = $derived(messages(locale));

	let buttons = $derived<{ command: FormatCommand; label: string; title: string }[]>([
		{ command: 'bold', label: 'B', title: t.entry.toolbar.bold },
		{ command: 'italic', label: 'I', title: t.entry.toolbar.italic },
		{ command: 'heading', label: 'H2', title: t.entry.toolbar.heading },
		{ command: 'list', label: '\u2022', title: t.entry.toolbar.list },
		{ command: 'quote', label: '\u201C', title: t.entry.toolbar.quote },
		{ command: 'link', label: t.entry.toolbar.link, title: t.entry.toolbar.link }
	]);
</script>

<div
	class="fmtbar flex items-center gap-1 rounded-t-lg border border-b-0 border-line-2 bg-panel-2 p-1.5"
	role="toolbar"
	aria-label={t.entry.toolbar.ariaLabel}
>
	{#each buttons as button (button.command)}
		<Button
			type="button"
			variant="ghost"
			size="sm"
			class="h-auto min-w-8 px-2 py-1.5 font-semibold hover:bg-panel aria-expanded:bg-panel"
			title={button.title}
			aria-label={button.title}
			onclick={() => onCommand(button.command)}
		>
			{button.label}
		</Button>
	{/each}
	<div class="mx-1 h-5 w-px bg-line-2"></div>
	<Button
		type="button"
		variant="ghost"
		size="sm"
		class="h-auto px-2 py-1.5 font-mono text-xs hover:bg-panel aria-expanded:bg-panel"
		title={t.entry.toolbar.mention}
		aria-label={t.entry.toolbar.mention}
		onclick={() => onCommand('mention')}
	>
		{t.entry.toolbar.mentionLabel}
	</Button>
</div>
