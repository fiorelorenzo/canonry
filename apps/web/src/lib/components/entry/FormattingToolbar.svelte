<script lang="ts">
	/**
	 * G4 = A: an always-visible toolbar above the editor, because a trigger character is
	 * not free on an Italian keyboard. Every button inserts real markdown characters
	 * (`editorState.ts`'s pure edits) - never a shortcut around the mention resolve menu.
	 */
	export type FormatCommand = 'bold' | 'italic' | 'heading' | 'list' | 'quote' | 'link' | 'mention';

	let { onCommand }: { onCommand: (command: FormatCommand) => void } = $props();

	const buttons: { command: FormatCommand; label: string; title: string }[] = [
		{ command: 'bold', label: 'B', title: 'Bold' },
		{ command: 'italic', label: 'I', title: 'Italic' },
		{ command: 'heading', label: 'H2', title: 'Heading' },
		{ command: 'list', label: '\u2022', title: 'Bulleted list' },
		{ command: 'quote', label: '\u201C', title: 'Quote' },
		{ command: 'link', label: 'Link', title: 'Link' }
	];
</script>

<div
	class="fmtbar flex items-center gap-1 rounded-t-lg border border-b-0 border-line-2 bg-panel-2 p-1.5"
	role="toolbar"
	aria-label="Formatting"
>
	{#each buttons as button (button.command)}
		<button
			type="button"
			class="min-w-8 rounded px-2 py-1.5 text-sm font-semibold text-ink-2 hover:bg-panel"
			title={button.title}
			aria-label={button.title}
			onclick={() => onCommand(button.command)}
		>
			{button.label}
		</button>
	{/each}
	<div class="mx-1 h-5 w-px bg-line-2"></div>
	<button
		type="button"
		class="rounded px-2 py-1.5 font-mono text-xs text-ink-2 hover:bg-panel"
		title="Mention"
		aria-label="Mention"
		onclick={() => onCommand('mention')}
	>
		@ Mention
	</button>
</div>
