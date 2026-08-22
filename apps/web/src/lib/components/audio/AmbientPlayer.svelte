<script lang="ts">
	/**
	 * Issue #69's client player, mounted in table mode's persistent action row
	 * (`w/[universe]/table/+page.svelte`). `pack` is the declared place's current
	 * `ambient_pack` summary from `+layout.server.ts` - reactive to it, not owning it:
	 * when the GM declares a new place, `pack.id` changes and this component crossfades
	 * to it on its own, which is SPEC.md §8's "the GM commands, the system anticipates"
	 * applied to sound. `null` means no pack has been generated for the declared place
	 * yet, shown as a quiet fact (decision E2: no spinner, no promised time), not an
	 * error.
	 *
	 * #529 (round eighteen, W1 = A) rebuilt this down to reference file 09's Syrinscape
	 * shape: "the GM's one action is picking the mood's name, and the crossfade is what
	 * the system does in response, invisible as an action of its own... a GM picking a
	 * mood mid-session should never see a mixer this deep, only the mood's name and, if
	 * anything, one master crossfade duration behind it." What shipped before this was a
	 * full mixer - master volume, per-layer mute/volume, a manual crossfade-seconds
	 * number field, an audio-graph diagnostics toggle - which is exactly what the
	 * decision calls "wired to nothing": present on screen, but nothing a GM running a
	 * game ever reaches for mid-scene. The whole surface is one `Segmented` (O4 = B, a
	 * binary state), Off against the pack's own generated description as its "mood"
	 * name, since this product has one ambient pack per declared place rather than a
	 * library of named moods to choose between. The crossfade duration is fixed
	 * (`DEFAULT_CROSSFADE_SECONDS`) and never GM-set. The per-device mixer preferences
	 * that used to back the old sliders (`prefs.ts`) are deleted, not left dark beside
	 * the new control - nothing here reads or writes them any more.
	 *
	 * Everything below `AudioContext` creation lives in `ambient-player.ts`, unchanged:
	 * this file only owns the UI and reacting to prop changes.
	 */
	import { onDestroy } from 'svelte';
	import { Segmented } from '$lib/components/ui/segmented';
	import { messages, type Locale } from '$lib/i18n';
	import { AmbientEngine, type LayerSpec, type PackSpec } from './ambient-player.js';

	interface PackSummary {
		id: string;
		description: string;
		layerCount: number;
		stale: boolean;
	}

	let {
		universeSlug,
		pack,
		locale
	}: {
		universeSlug: string;
		pack: PackSummary | null;
		locale: Locale;
	} = $props();

	const t = $derived(messages(locale).table.ambientPlayer);

	const DEFAULT_CROSSFADE_SECONDS = 4;

	let engine: AmbientEngine | null = null;
	let mood = $state<'off' | 'on'>('off');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let contextState = $state<AudioContextState | 'unstarted'>('unstarted');
	let currentPackId = $state<string | null>(null);
	let loadErrors = $state<Array<{ layerId: string; message: string }>>([]);

	onDestroy(() => {
		engine?.stopAll();
	});

	async function fetchPackSpec(id: string): Promise<PackSpec> {
		const response = await fetch(`/w/${universeSlug}/ambient/${id}`);
		if (!response.ok) throw new Error(t.couldNotLoadPack(response.status));
		const body = (await response.json()) as {
			id: string;
			description: string;
			layers: LayerSpec[];
		};
		return { id: body.id, description: body.description, layers: body.layers };
	}

	async function start(): Promise<void> {
		if (!pack || loading) return;
		error = null;
		loading = true;
		try {
			engine ??= new AmbientEngine();
			await engine.resume();
			contextState = engine.contextState;

			const spec = await fetchPackSpec(pack.id);
			const voice = await engine.playNewPack(spec);
			currentPackId = spec.id;
			loadErrors = voice.loadErrors;
			mood = 'on';
		} catch (err) {
			error = err instanceof Error ? err.message : t.couldNotStart;
			mood = 'off';
		} finally {
			loading = false;
		}
	}

	async function crossfadeToPack(id: string): Promise<void> {
		if (!engine || loading) return;
		error = null;
		loading = true;
		try {
			const spec = await fetchPackSpec(id);
			const voice = await engine.crossfadeTo(spec, DEFAULT_CROSSFADE_SECONDS);
			currentPackId = spec.id;
			loadErrors = voice.loadErrors;
		} catch (err) {
			error = err instanceof Error ? err.message : t.crossfadeFailed;
		} finally {
			loading = false;
		}
	}

	function stop(): void {
		mood = 'off';
		currentPackId = null;
		engine?.stopWithFade(DEFAULT_CROSSFADE_SECONDS);
	}

	function onMoodChange(next: string): void {
		if (next === 'on') void start();
		else stop();
	}

	// Reacts to the GM declaring a new place while the mood is already "on": `pack` is
	// owned by the caller, this only watches it. A place with no pack yet fades the
	// current one to silence rather than cutting it mid-waveform; picking "on" again
	// once a pack exists is the GM's own next tap, not something this effect assumes.
	$effect(() => {
		const nextId = pack?.id ?? null;
		if (mood !== 'on' || loading) return;
		if (nextId && nextId !== currentPackId) {
			void crossfadeToPack(nextId);
		} else if (!nextId && currentPackId) {
			currentPackId = null;
			engine?.stopWithFade(DEFAULT_CROSSFADE_SECONDS);
		}
	});

	async function resumeAudio(): Promise<void> {
		if (!engine) return;
		await engine.resume();
		contextState = engine.contextState;
	}

	const moodOptions = $derived(
		pack
			? [
					{ value: 'off', label: t.moodOff },
					{ value: 'on', label: pack.description }
				]
			: [{ value: 'off', label: t.moodOff }]
	);
</script>

<div class="flex flex-col gap-1.5" data-testid="ambient-player">
	<span id="table-mood-label" class="font-mono text-label tracking-wide text-muted uppercase">
		{t.moodLabel}
	</span>

	{#if !pack}
		<p class="text-label text-muted">{t.noPackYet}</p>
	{:else}
		<Segmented
			name="table-ambient-mood"
			labelledby="table-mood-label"
			value={mood}
			options={moodOptions}
			onchange={onMoodChange}
		/>

		{#if pack.stale}
			<p class="text-label text-muted">{t.layerSummary(pack.layerCount, pack.stale)}</p>
		{/if}
	{/if}

	{#if loading}
		<p class="text-label text-muted">{t.starting}</p>
	{/if}

	{#if mood === 'on' && contextState === 'suspended'}
		<button
			type="button"
			onclick={resumeAudio}
			class="w-fit text-left text-label text-ink-2 underline"
		>
			{t.audioPausedByBrowser}
			{t.enableAudio}
		</button>
	{/if}

	{#if loadErrors.length > 0}
		<p class="text-label text-danger">{t.layersFailedToLoad(loadErrors.length)}</p>
	{/if}

	{#if error}
		<p class="text-label text-danger">{error}</p>
	{/if}
</div>
