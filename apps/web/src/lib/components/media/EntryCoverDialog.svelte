<script lang="ts">
	/**
	 * Round twelve Q5 (#366): what the cover placeholder opens.
	 *
	 * P6 called the placeholder "the affordance that starts a generation" and #347 built it
	 * as a signpost to the Images section, from where a cover cost four clicks to generate
	 * and three to upload. This asks the only question worth asking, upload or generate,
	 * where the placeholder was clicked, and both answers end with a cover on the entry.
	 *
	 * **The two paths are different acts, and this dialog is where that shows.** An upload
	 * is a person handing over their own file: the choosing is the whole of the decision, so
	 * the file becomes the cover in the same gesture, and guardrail 1 has nothing to say
	 * about it because no model wrote anything. A generation is a model producing something
	 * a person then keeps, so the candidate arrives as a candidate and "use as cover" is the
	 * accept, exactly where O2 put it. Nothing here sets `entity.cover_asset_id` on its own:
	 * both paths POST to `media/cover`, which is still the only writer of that column, and
	 * neither touches `gm_only` (guardrail 6).
	 *
	 * **The wait is inside the click**, because `media/generate` awaits `generateImages()`.
	 * #345's `ModelRunning` is what that looks like: a spinner, a sentence naming what is
	 * being drawn, and a seconds counter, rather than a disabled button with a changed
	 * label, which is indistinguishable from a hung page.
	 *
	 * The endpoints are the ones that already exist (`media/upload`, `media/generate`,
	 * `media/attach`, `media/cover`) and are called in the same order `EntryMediaPanel`
	 * calls them, so this is a second door onto one mechanism rather than a second
	 * mechanism.
	 */
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import ModelRunning from '$lib/components/copilot/ModelRunning.svelte';
	import { Dialog, DialogContent, DialogTitle } from '$lib/components/ui/dialog';

	/** One image, not four: this is the shortest path to a cover, and `variants` would put a
	 * chooser between the click and the picture for a shape the band is going to crop the
	 * same way regardless. The Images section still offers the four-up batch. */
	const FEATURE = 'portrait';

	interface Candidate {
		id: string;
		mimeType: string;
	}

	let {
		open = $bindable(false),
		universeSlug,
		entrySlug,
		entityName,
		aiEnabled,
		portraitPrice,
		portraitModel,
		locale
	}: {
		open?: boolean;
		universeSlug: string;
		entrySlug: string;
		entityName: string;
		aiEnabled: boolean;
		portraitPrice: number;
		/** Null when `image_model_config` has no active `portrait` row, which is the only
		 * state in which generating is withheld and uploading is not. */
		portraitModel: { provider: string; modelId: string } | null;
		locale: Locale;
	} = $props();

	let t = $derived(messages(locale));
	let base = $derived(resolve(`/w/${universeSlug}/e/${entrySlug}/media`));

	let uploadInput: HTMLInputElement | undefined;
	let uploading = $state(false);
	let generating = $state(false);
	let accepting = $state(false);
	let error = $state<string | null>(null);
	let candidate = $state<Candidate | null>(null);

	// Round thirteen R2 (#377): the vendored Dialog owns showModal/close, escape,
	// scrim-click and focus-return now, so this only has to track the closed-to-open
	// transition the way the old effect's `dialogEl.open` check did. Reset on every
	// open rather than at mount: the entry page keeps this component mounted across
	// a navigation to another entry, so a candidate generated for the previous one
	// must not be offered as this one's cover.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			error = null;
			candidate = null;
		}
		wasOpen = open;
	});

	function close(): void {
		open = false;
	}

	function imageUrl(id: string): string {
		return `${base}/${id}`;
	}

	async function post(path: string, body: unknown, fallback: (status: number) => string) {
		const res = await fetch(`${base}${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) throw new Error((await res.text()) || fallback(res.status));
		return res;
	}

	/** The upload path's accept, in full: the file the GM chose becomes the cover. The
	 * upload endpoint attaches it to this entry, so `media/cover`'s this-entry-only check
	 * passes on the id it just returned. */
	async function handleUpload(): Promise<void> {
		const chosen = uploadInput?.files?.[0];
		if (!chosen) return;
		error = null;
		uploading = true;
		try {
			const form = new FormData();
			form.set('file', chosen);
			const res = await fetch(`${base}/upload`, { method: 'POST', body: form });
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || t.entry.media.upload.genericUploadFailedWithStatus(res.status));
			}
			const asset = (await res.json()) as { id: string };
			await post(
				'/cover',
				{ mediaAssetId: asset.id },
				t.entry.media.cover.genericCoverFailedWithStatus
			);
			await invalidateAll();
			close();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.upload.genericUploadFailed;
		} finally {
			uploading = false;
			if (uploadInput) uploadInput.value = '';
		}
	}

	async function handleGenerate(): Promise<void> {
		error = null;
		generating = true;
		try {
			const res = await post(
				'/generate',
				{ feature: FEATURE },
				t.entry.media.genericGenerationFailedWithStatus
			);
			const data = (await res.json()) as { assets: Candidate[] };
			candidate = data.assets[0] ?? null;
			if (!candidate) throw new Error(t.entry.media.genericGenerationFailed);
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.genericGenerationFailed;
		} finally {
			generating = false;
		}
	}

	/** The generated path's accept (O2: "use as cover is the accept"). Attach first, because
	 * a generated asset is unattached until somebody keeps it and `media/cover` refuses an
	 * id that is not this entry's. */
	async function handleUseAsCover(): Promise<void> {
		if (!candidate) return;
		error = null;
		accepting = true;
		try {
			await post(
				'/attach',
				{ mediaAssetId: candidate.id },
				t.entry.media.inBody.attachFailedWithStatus
			);
			await post(
				'/cover',
				{ mediaAssetId: candidate.id },
				t.entry.media.cover.genericCoverFailedWithStatus
			);
			await invalidateAll();
			close();
		} catch (err) {
			error = err instanceof Error ? err.message : t.entry.media.cover.genericCoverFailed;
		} finally {
			accepting = false;
		}
	}

	let busy = $derived(uploading || generating || accepting);
</script>

<Dialog bind:open>
	<DialogContent
		closeLabel={t.entry.cover.cancel}
		class="w-[min(28rem,calc(100vw-2rem))] max-w-md rounded-lg border border-line bg-panel p-0 text-ink"
	>
		<div class="p-5">
			<DialogTitle class="text-base font-semibold text-ink"
				>{t.entry.cover.dialogTitle(entityName)}</DialogTitle
			>
			<p class="mt-1 text-xs text-muted">{t.entry.cover.dialogHint}</p>

			{#if error}
				<p class="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
					{error}
				</p>
			{/if}

			{#if candidate}
				<!-- The accept, and the only place in this dialog where a model's work is on
			     screen: it is a candidate until the button below is pressed. -->
				<img
					src={imageUrl(candidate.id)}
					alt=""
					class="mt-4 max-h-64 w-full rounded-md border border-ai-line object-contain"
				/>
				<p class="mt-2 text-xs text-muted">{t.entry.cover.generatedHint}</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<Button type="button" size="sm" disabled={accepting} onclick={handleUseAsCover}>
						{accepting ? t.entry.media.cover.saving : t.entry.media.cover.useLabel}
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={accepting}
						onclick={() => (candidate = null)}
					>
						{t.entry.media.discard}
					</Button>
				</div>
			{:else if generating}
				<div class="mt-4 rounded-md border border-line bg-panel-2 p-3">
					<ModelRunning label={t.entry.cover.generateRunning} {locale} />
				</div>
			{:else}
				<div class="mt-4 flex flex-col gap-3">
					<div class="rounded-md border border-line bg-panel-2 p-3">
						<Button type="button" size="sm" disabled={busy} onclick={() => uploadInput?.click()}>
							{uploading ? t.entry.cover.uploading : t.entry.cover.uploadAction}
						</Button>
						<p class="mt-2 text-xs text-muted">{t.entry.cover.uploadHint}</p>
						<input
							bind:this={uploadInput}
							type="file"
							accept="image/png,image/jpeg,image/webp"
							class="hidden"
							onchange={handleUpload}
						/>
					</div>

					<div class="rounded-md border border-line bg-panel-2 p-3">
						{#if !aiEnabled}
							<p class="text-sm text-ink-2">{t.entry.cover.aiOff}</p>
						{:else if !portraitModel}
							<p class="text-sm text-ink-2">{t.entry.cover.notConfigured}</p>
						{:else}
							<Button type="button" size="sm" disabled={busy} onclick={handleGenerate}>
								{t.entry.cover.generateAction}
							</Button>
							<p class="mt-2 text-xs text-muted">{t.entry.cover.generateHint(portraitPrice)}</p>
							<p class="text-xs text-muted">{portraitModel.provider}/{portraitModel.modelId}</p>
						{/if}
					</div>
				</div>
			{/if}

			<div class="mt-4">
				<Button type="button" variant="secondary" size="sm" disabled={busy} onclick={close}>
					{t.entry.cover.cancel}
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>
