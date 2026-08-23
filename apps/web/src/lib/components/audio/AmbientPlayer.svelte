<script lang="ts">
	/**
	 * Issue #69's client player, mounted at table mode's `#table-ambient-slot`
	 * (`w/[universe]/table/+page.svelte`, agreed with the table agent). `pack` is the
	 * declared place's current `ambient_pack` summary from
	 * `w/[universe]/table/+layout.server.ts` - reactive to it, not owning it: when the
	 * GM declares a new place, `pack.id` changes and this component crossfades to it on
	 * its own, which is SPEC.md §8's "the GM commands, the system anticipates" applied to
	 * sound. `null` means no pack has been generated for the declared place yet, which is
	 * shown as a quiet fact (decision E2: no spinner, no promised time), not an error.
	 *
	 * Everything below `AudioContext` creation lives in `ambient-player.ts`; this file
	 * owns the UI, the localStorage preferences (`prefs.ts`) and reacting to prop
	 * changes. `window.__ambientEngine` is a deliberate escape hatch for issue #69's own
	 * verification method - reading the live Web Audio graph back with `tab.evaluate` -
	 * and touches nothing this component does not already expose through its own state.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { messages, type Locale } from '$lib/i18n';
	import {
		AmbientEngine,
		type LayerSpec,
		type PackSpec,
		type PackVoice
	} from './ambient-player.js';
	import {
		DEFAULT_MASTER_VOLUME,
		layerPrefsOrDefault,
		loadAudioPrefs,
		saveAudioPrefs,
		type AudioPrefs
	} from './prefs.js';

	interface PackSummary {
		id: string;
		description: string;
		layerCount: number;
		stale: boolean;
	}

	let {
		universeSlug,
		userId,
		pack,
		locale
	}: {
		universeSlug: string;
		userId: string;
		pack: PackSummary | null;
		locale: Locale;
	} = $props();

	const t = $derived(messages(locale).table.ambientPlayer);

	const DEFAULT_CROSSFADE_SECONDS = 4;
	const DIAGNOSTICS_REFRESH_MS = 500;

	let engine: AmbientEngine | null = null;
	let started = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let contextState = $state<AudioContextState | 'unstarted'>('unstarted');
	let currentPackId = $state<string | null>(null);
	let currentDescription = $state<string | null>(null);
	let activeLayers = $state<LayerSpec[]>([]);
	let loadErrors = $state<Array<{ layerId: string; message: string }>>([]);
	let crossfadeSeconds = $state(DEFAULT_CROSSFADE_SECONDS);
	let showDiagnostics = $state(false);
	let diagnosticsTick = $state(0);

	let prefs: AudioPrefs = { masterVolume: DEFAULT_MASTER_VOLUME, layers: {} };
	let masterVolume = $state(DEFAULT_MASTER_VOLUME);
	let layerVolumes = $state<Record<string, { muted: boolean; volume: number }>>({});
	let activeVoice: PackVoice | null = null;

	function persistPrefs(): void {
		prefs = { masterVolume, layers: layerVolumes };
		saveAudioPrefs(window.localStorage, userId, prefs);
	}

	onMount(() => {
		prefs = loadAudioPrefs(window.localStorage, userId);
		masterVolume = prefs.masterVolume;
		layerVolumes = { ...prefs.layers };

		const diagnosticsTimer = window.setInterval(() => {
			diagnosticsTick++;
			if (engine) contextState = engine.contextState;
		}, DIAGNOSTICS_REFRESH_MS);
		return () => window.clearInterval(diagnosticsTimer);
	});

	onDestroy(() => {
		engine?.stopAll();
		if (
			typeof window !== 'undefined' &&
			(window as unknown as Record<string, unknown>).__ambientEngine === engine
		) {
			delete (window as unknown as Record<string, unknown>).__ambientEngine;
		}
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

	function applyStoredPrefs(voice: PackVoice): void {
		if (!engine) return;
		for (const layer of voice.layers) {
			const layerPrefs = layerPrefsOrDefault(prefs, layer.spec.id, layer.spec.volume);
			layerVolumes[layer.spec.id] = layerPrefs;
			engine.setLayerMuted(voice, layer.spec.id, layerPrefs.muted);
			engine.setLayerVolume(voice, layer.spec.id, layerPrefs.volume);
		}
		engine.setMasterVolume(masterVolume);
	}

	async function start(): Promise<void> {
		if (!pack || loading) return;
		error = null;
		loading = true;
		try {
			engine ??= new AmbientEngine();
			(window as unknown as Record<string, unknown>).__ambientEngine = engine;
			await engine.resume();
			contextState = engine.contextState;

			const spec = await fetchPackSpec(pack.id);
			const voice = await engine.playNewPack(spec);
			applyStoredPrefs(voice);

			activeVoice = voice;
			currentPackId = spec.id;
			currentDescription = spec.description;
			activeLayers = spec.layers;
			loadErrors = voice.loadErrors;
			started = true;
		} catch (err) {
			error = err instanceof Error ? err.message : t.couldNotStart;
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
			const voice = await engine.crossfadeTo(spec, crossfadeSeconds);
			applyStoredPrefs(voice);

			activeVoice = voice;
			currentPackId = spec.id;
			currentDescription = spec.description;
			activeLayers = spec.layers;
			loadErrors = voice.loadErrors;
		} catch (err) {
			error = err instanceof Error ? err.message : t.crossfadeFailed;
		} finally {
			loading = false;
		}
	}

	// Reacts to the GM declaring a new place: `pack` is owned by the caller, this only
	// watches it. Nothing runs before `start()` has been clicked once - autoplay stays
	// blocked until the explicit user gesture issue #69 requires.
	$effect(() => {
		const nextId = pack?.id ?? null;
		if (!started || loading) return;
		if (nextId && nextId !== currentPackId) {
			crossfadeToPack(nextId);
		} else if (!nextId && currentPackId) {
			currentPackId = null;
			currentDescription = null;
			activeLayers = [];
			engine?.stopWithFade(crossfadeSeconds);
		}
	});

	async function resumeAudio(): Promise<void> {
		if (!engine) return;
		await engine.resume();
		contextState = engine.contextState;
	}

	function toggleMute(layerId: string): void {
		if (!engine || !activeVoice) return;
		const current = layerVolumes[layerId] ?? { muted: false, volume: 0.5 };
		const next = { ...current, muted: !current.muted };
		layerVolumes[layerId] = next;
		engine.setLayerMuted(activeVoice, layerId, next.muted);
		persistPrefs();
	}

	function setLayerVolume(layerId: string, volume: number): void {
		if (!engine || !activeVoice) return;
		const current = layerVolumes[layerId] ?? { muted: false, volume };
		const next = { ...current, volume };
		layerVolumes[layerId] = next;
		engine.setLayerVolume(activeVoice, layerId, volume);
		persistPrefs();
	}

	function setMaster(volume: number): void {
		masterVolume = volume;
		engine?.setMasterVolume(volume);
		persistPrefs();
	}

	const diagnostics = $derived.by(() => {
		void diagnosticsTick;
		return engine?.snapshot() ?? null;
	});
</script>

<div class="rounded-lg border border-line bg-panel p-3" data-testid="ambient-player">
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-title font-semibold text-ink">{t.heading}</h3>
		{#if started}
			<Button
				type="button"
				variant="link"
				size="sm"
				class="h-auto p-0 text-muted hover:text-ink"
				onclick={() => (showDiagnostics = !showDiagnostics)}
			>
				{showDiagnostics ? t.hideAudioGraph : t.showAudioGraph}
			</Button>
		{/if}
	</div>

	<!-- `started` is read FIRST on purpose. Svelte 5 tracks dependencies as they are
		actually read, so `!pack && !started` never reads `started` while a pack exists,
		the chain never re-runs when playback begins, and the body stays on the Play
		button forever while the header above it updates. Do not reorder this. -->
	{#if !started && !pack}
		<p class="mt-2 text-sm text-muted">{t.noPackYet}</p>
	{:else if !started}
		<p class="mt-2 text-sm text-ink-2">{pack?.description}</p>
		<p class="text-xs text-muted">
			{t.layerSummary(pack?.layerCount ?? 0, pack?.stale ?? false)}
		</p>
		<Button type="button" class="mt-2" onclick={start} disabled={loading}>
			{loading ? t.starting : t.play}
		</Button>
	{:else}
		{#if contextState === 'suspended'}
			<p class="mt-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink-2">
				{t.audioPausedByBrowser}
				<Button
					type="button"
					variant="link"
					size="sm"
					class="ml-1 h-auto p-0"
					onclick={resumeAudio}
				>
					{t.enableAudio}
				</Button>
			</p>
		{/if}

		<p class="mt-2 text-sm text-ink-2">{currentDescription}</p>

		{#if loadErrors.length > 0}
			<p class="mt-1 text-xs text-danger">
				{t.layersFailedToLoad(loadErrors.length)}
			</p>
		{/if}

		<!-- #147: the mixer below - mute toggle, master/crossfade/layer sliders - stays
			native. It is the ambient player's transport, not a form: the range inputs
			carry the browser's own slider track and thumb, which an Input's text-box
			chrome would replace, and the mute glyph is a two-state icon, not a label a
			Button variant expresses. -->
		<div class="mt-3 flex items-center gap-2">
			<label class="flex items-center gap-2 text-xs text-ink-2" for="ambient-master-volume">
				{t.master}
				<input
					id="ambient-master-volume"
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={masterVolume}
					oninput={(e) => setMaster(Number(e.currentTarget.value))}
				/>
			</label>
			<label class="flex items-center gap-1 text-xs text-muted" for="ambient-crossfade-seconds">
				{t.crossfade}
				<input
					id="ambient-crossfade-seconds"
					type="number"
					min="1"
					max="20"
					step="0.5"
					class="w-14 rounded border border-line bg-panel px-1 py-0.5"
					value={crossfadeSeconds}
					oninput={(e) => (crossfadeSeconds = Number(e.currentTarget.value))}
				/>
				s
			</label>
		</div>

		<ul class="mt-3 flex flex-col gap-1.5" aria-label={t.layersAriaLabel}>
			{#each activeLayers as layer (layer.id)}
				{@const layerState = layerVolumes[layer.id] ?? { muted: false, volume: layer.volume }}
				<li class="flex items-center gap-2 text-xs">
					<button
						type="button"
						class="w-4 flex-none text-center"
						aria-pressed={layerState.muted}
						aria-label={layerState.muted ? t.unmuteLayer(layer.prompt) : t.muteLayer(layer.prompt)}
						onclick={() => toggleMute(layer.id)}
					>
						{layerState.muted ? '🔇' : '🔊'}
					</button>
					<span
						class="w-16 flex-none rounded-full bg-panel-2 px-2 py-0.5 text-center text-label text-ink-2"
					>
						{layer.loopType}
					</span>
					<span class="flex-1 truncate text-ink-2">{layer.prompt}</span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={layerState.volume}
						oninput={(e) => setLayerVolume(layer.id, Number(e.currentTarget.value))}
					/>
				</li>
			{/each}
		</ul>

		{#if showDiagnostics && diagnostics}
			<pre
				class="mt-3 overflow-x-auto rounded-md border border-line bg-panel-2 p-2 text-label text-ink-2">{JSON.stringify(
					diagnostics,
					null,
					2
				)}</pre>
		{/if}
	{/if}

	{#if error}
		<p class="mt-2 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
			{error}
		</p>
	{/if}
</div>
