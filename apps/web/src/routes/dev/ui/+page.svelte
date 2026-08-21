<script lang="ts">
	/**
	 * #147: a component gallery for I9 = C's control layer, not a product surface (same
	 * footing as routes/dev/ai-marking - see that page's own doc comment). This is the
	 * only place anyone can check a token-mapping mistake against both palettes at once
	 * before five other waves start importing these components at real call sites.
	 */
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import { Segmented } from '$lib/components/ui/segmented';
	import { Switch } from '$lib/components/ui/switch';
	import { Combobox } from '$lib/components/ui/combobox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Popover from '$lib/components/ui/popover';
	import * as Command from '$lib/components/ui/command';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Separator } from '$lib/components/ui/separator';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { KeyHint, type KeyHintPair } from '$lib/components/ui/key-hint';

	const panes = [
		{ theme: 'light', label: 'Light palette' },
		{ theme: 'dark', label: 'Dark palette' }
	] as const;

	// Every popped-open piece below (tooltip, popover, menu, dialog, sheet, command
	// palette) runs with its portal disabled, so it stays a DOM child of the themed
	// <section> it opened from instead of the real document body. Custom properties
	// cascade by DOM ancestry, not by where something paints - an un-disabled portal
	// would always resolve to this page's own live data-theme, so both panes would show
	// the same palette for anything overlay-based. A real page only ever has one
	// data-theme, so wave one's call sites don't need this.
	const inline = { disabled: true };

	const buttonVariantList = ['default', 'secondary', 'ghost', 'link', 'destructive'] as const;
	const buttonSizeList = ['sm', 'default', 'lg', 'icon'] as const;
	const badgeVariantList = ['default', 'secondary', 'destructive', 'ok', 'accent'] as const;
	const selectSampleTypes = ['character', 'place', 'faction'] as const;

	let commandPaletteOpen = $state<Record<string, boolean>>({ light: false, dark: false });
	let selectValue = $state<Record<string, string>>({
		light: selectSampleTypes[0],
		dark: selectSampleTypes[0]
	});

	// Issue #286 (O4 = B): the other two controls of the three, checked here in both
	// palettes for the same reason the Select above them is.
	const segmentedSampleOptions = [
		{ value: 'auto', label: 'Auto-detect' },
		{ value: 'en', label: 'English' },
		{ value: 'it', label: 'Italiano' },
		{ value: 'unsure', label: 'Not sure / mixed' }
	];
	const comboboxSampleOptions = [
		{ value: 'aldric', label: 'Aldric Vane', hint: 'character' },
		{ value: 'sennah', label: 'Mother Sennah', hint: 'character' },
		{ value: 'corvin', label: 'Corvin Ashe', hint: 'character' },
		{ value: 'gilded-rat', label: 'The Gilded Rat', hint: 'place' },
		{ value: 'cairnmouth', label: 'Cairnmouth', hint: 'place' },
		{ value: 'sable-reach', label: 'The Sable Reach', hint: 'place' },
		{ value: 'ashen-ledger', label: 'The Ashen Ledger', hint: 'faction' },
		{ value: 'valdoria-watch', label: 'The Valdoria Watch', hint: 'faction' },
		{ value: 'sable-winter', label: 'The Sable Winter', hint: 'event' }
	];
	let segmentedValue = $state<Record<string, string>>({ light: 'auto', dark: 'auto' });
	let comboboxValue = $state<Record<string, string | null>>({ light: null, dark: null });

	// Issue #383 (R8, round thirteen): not an O4 = B case at all - see the component's
	// own doc comment - so it is checked on its own rather than beside the O4 trio
	// above. `switchDisabledValue` pins the disabled/checked combination that a plain
	// `disabled` boolean on an unchecked switch can't demonstrate.
	let switchValue = $state<Record<string, boolean>>({ light: false, dark: false });
	let switchDisabledValue = $state<Record<string, boolean>>({ light: true, dark: true });

	// T5 (round fifteen, #432): one key beside one verb, the shape `ProposalQueue`,
	// `InlineProposalReview` and `CommandPalette`'s footer all use now. Issue #473:
	// `j`/`k` are `next`/`previous` rather than sharing one verb.
	const keyHintSample: KeyHintPair[] = [
		{ key: 'j', label: 'next' },
		{ key: 'k', label: 'previous' },
		{ key: 'a', label: 'accept' },
		{ key: 'r', label: 'reject' },
		{ key: 'u', label: 'undo' }
	];

	// Issue #367 (Q6): the motion row below. The token list is written out rather than read
	// from the stylesheet on purpose - this page's job is to catch a mistake, and a table
	// that reports whatever the CSS currently says can never disagree with it.
	const motionTokens = [
		{ name: '--transition-duration-fade', note: '140ms, opacity and colour, survives reduce' },
		{ name: '--transition-duration-move', note: '200ms, position and size, 1ms under reduce' },
		{ name: '--ease-arrive', note: 'cubic-bezier(0.16, 0.84, 0.44, 1)' },
		{ name: '--ease-leave', note: 'cubic-bezier(0.4, 0, 1, 1)' }
	];
	let motionRun = $state<Record<string, number>>({ light: 0, dark: 0 });
	function replay(theme: string): void {
		motionRun[theme] = (motionRun[theme] ?? 0) + 1;
	}
</script>

<svelte:head><title>Component gallery: shadcn-svelte control layer (dev only)</title></svelte:head>

<Tooltip.Provider>
	<main class="mx-auto max-w-3xl px-6 py-10">
		<p class="mb-1 font-mono text-xs tracking-wide text-danger uppercase">
			Internal component gallery, not a product page
		</p>
		<h1 class="mb-2 text-2xl font-semibold text-ink">shadcn-svelte control layer</h1>
		<p class="mb-8 max-w-measure text-ink-2">
			Decision I9 = C: shadcn-svelte owns every control shape in the pass, restyled onto this app's
			own tokens rather than its own (<a
				class="underline"
				href="https://github.com/fiorelorenzo/canonry/issues/147">#147</a
			>). Every component below renders in both palettes, because G1 makes that a requirement for
			any surface and nobody could check it before this page existed.
		</p>

		{#each panes as pane (pane.theme)}
			<section
				data-theme={pane.theme}
				class="mb-10 rounded-lg border border-line bg-paper p-6 text-ink"
			>
				<h2 class="mb-4 font-mono text-xs tracking-wide text-muted uppercase">{pane.label}</h2>

				<h3 class="mb-2 text-sm font-semibold text-ink">Button</h3>
				<div class="mb-6 flex flex-wrap items-center gap-3 rounded border border-line bg-panel p-4">
					{#each buttonVariantList as variant (variant)}
						{#each buttonSizeList as size (size)}
							<Button {variant} {size}>{size === 'icon' ? '+' : variant}</Button>
						{/each}
					{/each}
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Badge</h3>
				<div class="mb-6 flex flex-wrap items-center gap-2 rounded border border-line bg-panel p-4">
					{#each badgeVariantList as variant (variant)}
						<Badge {variant}>{variant}</Badge>
					{/each}
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Input, Label, Textarea</h3>
				<div class="mb-6 flex max-w-sm flex-col gap-3 rounded border border-line bg-panel p-4">
					<div class="flex flex-col gap-1.5">
						<Label for="gallery-name-{pane.theme}">Universe name</Label>
						<Input id="gallery-name-{pane.theme}" placeholder="Valdoria Reach" />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="gallery-note-{pane.theme}">Note</Label>
						<Textarea id="gallery-note-{pane.theme}" placeholder="A sentence or two." />
					</div>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Select</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<Select.Root
						type="single"
						name="gallery-entity-type"
						bind:value={selectValue[pane.theme]}
					>
						<Select.Trigger id="gallery-select-{pane.theme}" class="w-48">
							{selectValue[pane.theme]}
						</Select.Trigger>
						<Select.Content portalProps={inline}>
							{#each selectSampleTypes as entityType (entityType)}
								<Select.Item value={entityType} label={entityType}>{entityType}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Segmented (#286, O4 = B)</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<Segmented
						name="gallery-segmented-{pane.theme}"
						bind:value={segmentedValue[pane.theme]}
						options={segmentedSampleOptions}
						ariaLabel="Entry language"
					/>
					<p class="mt-2 font-mono text-xs text-muted">value: {segmentedValue[pane.theme]}</p>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Combobox (#286, O4 = B)</h3>
				<div class="mb-6 max-w-sm rounded border border-line bg-panel p-4">
					<Combobox
						id="gallery-combobox-{pane.theme}"
						bind:value={comboboxValue[pane.theme]}
						options={comboboxSampleOptions}
						placeholder="Choose an entry"
						searchPlaceholder="Search"
						emptyText="No match"
						contentProps={{ portalProps: inline }}
						ariaLabel="Entry"
					/>
					<p class="mt-2 font-mono text-xs text-muted">
						value: {comboboxValue[pane.theme] ?? 'null'}
					</p>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Switch (#383, R8)</h3>
				<div class="mb-6 flex flex-wrap items-center gap-6 rounded border border-line bg-panel p-4">
					<div class="flex items-center gap-2">
						<Switch id="gallery-switch-{pane.theme}" bind:checked={switchValue[pane.theme]} />
						<Label for="gallery-switch-{pane.theme}">
							{switchValue[pane.theme] ? 'On' : 'Off'}
						</Label>
					</div>
					<div class="flex items-center gap-2">
						<Switch id="gallery-switch-disabled-off-{pane.theme}" checked={false} disabled />
						<Label for="gallery-switch-disabled-off-{pane.theme}">Disabled, off</Label>
					</div>
					<div class="flex items-center gap-2">
						<Switch
							id="gallery-switch-disabled-on-{pane.theme}"
							checked={switchDisabledValue[pane.theme]}
							disabled
						/>
						<Label for="gallery-switch-disabled-on-{pane.theme}">Disabled, on</Label>
					</div>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Separator</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<p class="text-sm text-ink-2">Above</p>
					<Separator class="my-3" />
					<p class="text-sm text-ink-2">Below</p>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Tooltip</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<Tooltip.Root>
						<Tooltip.Trigger class={buttonVariants({ variant: 'secondary' })}>
							Hover me
						</Tooltip.Trigger>
						<Tooltip.Content portalProps={inline}>Tabular nums, even here.</Tooltip.Content>
					</Tooltip.Root>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Popover</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<Popover.Root>
						<Popover.Trigger class={buttonVariants({ variant: 'secondary' })}>
							Open popover
						</Popover.Trigger>
						<Popover.Content portalProps={inline}>
							<Popover.Header>
								<Popover.Title>Evidence</Popover.Title>
								<Popover.Description>C5's popover-on-changed-text shape.</Popover.Description>
							</Popover.Header>
						</Popover.Content>
					</Popover.Root>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Dropdown menu</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger class={buttonVariants({ variant: 'secondary' })}>
							Open menu
						</DropdownMenu.Trigger>
						<DropdownMenu.Content portalProps={inline}>
							<DropdownMenu.Group>
								<DropdownMenu.Item>Rename</DropdownMenu.Item>
								<DropdownMenu.Item>Duplicate</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item variant="destructive">Delete</DropdownMenu.Item>
							</DropdownMenu.Group>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Dialog</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<Dialog.Root>
						<Dialog.Trigger class={buttonVariants({ variant: 'default' })}>
							Open dialog
						</Dialog.Trigger>
						<Dialog.Content portalProps={inline} closeLabel="Close">
							<Dialog.Header>
								<Dialog.Title>Generate a portrait</Dialog.Title>
								<Dialog.Description>F1's one action, always confirms the spend.</Dialog.Description>
							</Dialog.Header>
							<Dialog.Footer closeLabel="Close">
								<Button>Generate</Button>
							</Dialog.Footer>
						</Dialog.Content>
					</Dialog.Root>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Sheet</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<Sheet.Root>
						<Sheet.Trigger class={buttonVariants({ variant: 'secondary' })}>
							Open sheet
						</Sheet.Trigger>
						<Sheet.Content portalProps={inline} closeLabel="Close">
							<Sheet.Header>
								<Sheet.Title>Account</Sheet.Title>
								<Sheet.Description>I6's account menu shell.</Sheet.Description>
							</Sheet.Header>
						</Sheet.Content>
					</Sheet.Root>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Command</h3>
				<div class="mb-6 flex flex-wrap items-start gap-4 rounded border border-line bg-panel p-4">
					<div class="h-64 w-72 overflow-hidden rounded-lg border border-line">
						<Command.Root>
							<Command.Input placeholder="Search entries and commands..." />
							<Command.List>
								<Command.Empty>No results.</Command.Empty>
								<Command.Group heading="Entries">
									<Command.Item>Cairnmouth</Command.Item>
									<Command.Item>Iselde Wrenn</Command.Item>
								</Command.Group>
								<Command.Separator />
								<Command.Group heading="Actions">
									<Command.Item>Ask about this entry</Command.Item>
								</Command.Group>
							</Command.List>
						</Command.Root>
					</div>
					<div>
						<Button variant="secondary" onclick={() => (commandPaletteOpen[pane.theme] = true)}>
							Open as a palette (⌘K shape)
						</Button>
						<Command.Dialog
							bind:open={commandPaletteOpen[pane.theme]}
							title="Command palette"
							description="Search entries and commands"
							portalProps={inline}
							closeLabel="Close"
						>
							<Command.Input placeholder="Search entries and commands..." />
							<Command.List>
								<Command.Empty>No results.</Command.Empty>
								<Command.Group heading="Entries">
									<Command.Item>Cairnmouth</Command.Item>
								</Command.Group>
							</Command.List>
						</Command.Dialog>
					</div>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Page header</h3>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<PageHeader
						eyebrow="Universe"
						title="Valdoria Reach"
						description="214 entries, last touched an hour ago."
					>
						{#snippet actions()}
							<Button variant="secondary">Settings</Button>
							<Button>New entry</Button>
						{/snippet}
					</PageHeader>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Empty state, three kinds (I8)</h3>
				<div class="flex flex-col gap-3 rounded border border-line bg-panel p-4">
					<EmptyState kind="cold" message="No entries yet.">
						{#snippet action()}
							<Button>Create the first entry</Button>
						{/snippet}
					</EmptyState>
					<Separator />
					<EmptyState kind="settled" message="Nothing left to review.">
						{#snippet action()}
							<Button>This must not render - settled ignores action</Button>
						{/snippet}
					</EmptyState>
					<Separator />
					<EmptyState
						kind="derived"
						message="No relations recorded yet."
						explanation="Relations are inferred from the entry's own text (B3)."
					>
						{#snippet action()}
							<Button variant="link">Open the editor</Button>
						{/snippet}
					</EmptyState>
				</div>

				<h3 class="mb-2 text-sm font-semibold text-ink">Key hint (T5, #432)</h3>
				<div class="rounded border border-line bg-panel p-4">
					<KeyHint pairs={keyHintSample} />
					<p class="mt-2 font-mono text-xs text-muted">
						Hidden below sm - there is no keyboard there (#148).
					</p>
				</div>

				<!-- Issue #367 (Q6): the motion system's own row. The four tokens with the
				     values they resolve to, and a box that replays the one enter animation
				     every surface in the app uses. This is the surface to point CDP's
				     `Emulation.setEmulatedMedia` at: with `prefers-reduced-motion: reduce`
				     the box still appears and still fades, and stops sliding. -->
				<h3 class="mt-6 mb-2 text-sm font-semibold text-ink">Motion tokens (Q6)</h3>
				<div class="flex flex-col gap-3 rounded border border-line bg-panel p-4">
					<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
						{#each motionTokens as token (token.name)}
							<dt class="text-ink-2">{token.name}</dt>
							<dd class="m-0 text-muted">{token.note}</dd>
						{/each}
					</dl>
					<div class="flex items-center gap-3">
						<Button variant="secondary" size="sm" onclick={() => replay(pane.theme)}>Replay</Button>
						{#key motionRun[pane.theme]}
							<span
								class="animate-in rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-xs text-ink duration-move ease-arrive fade-in-0 slide-in-from-bottom-2"
							>
								duration-move, arriving
							</span>
							<span
								class="animate-in rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-xs text-ink duration-fade ease-arrive fade-in-0"
							>
								duration-fade, no travel
							</span>
						{/key}
					</div>
				</div>
			</section>
		{/each}
	</main>
</Tooltip.Provider>
