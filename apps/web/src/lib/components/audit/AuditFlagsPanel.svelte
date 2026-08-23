<script lang="ts">
	/**
	 * C9 = B: "an aside section" reading the same flag list the badge counts - the entry
	 * aside's fifth section (EntrySections.svelte). Guardrail 7: a flag is a question
	 * addressed to the GM, never a finding addressed at the canon, so there is no Accept
	 * here and no percentage anywhere on this panel - only `proposal.rationale` (already
	 * guardrail-safe, `audit.ts`'s `buildFlagRationale`), the two statements quoted
	 * verbatim, and the two actions `docs/ux/c9-audit-flags.html`'s table allowed (deleted 2026-08-23, in git history at c84c8f8): "Dismiss"
	 * and "Open both entries".
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import { stripMentionSyntax } from '$lib/markdown';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { InlineLink } from '$lib/components/ui/link';

	export interface AuditFlagStatementView {
		entityId: string;
		entityName: string;
		entitySlug: string;
		statement: string;
	}

	export interface AuditFlagView {
		id: string;
		rationale: string;
		statements: [AuditFlagStatementView, AuditFlagStatementView];
	}

	let {
		flags,
		universeSlug,
		locale
	}: { flags: AuditFlagView[]; universeSlug: string; locale: Locale } = $props();
	let t = $derived(messages(locale));

	let dismissing = $state<Record<string, boolean>>({});
</script>

{#if flags.length === 0}
	<EmptyState kind="settled" message={t.entry.audit.empty} />
{:else}
	<ul class="space-y-3">
		{#each flags as flag (flag.id)}
			<li class="rounded-md border border-warn bg-warn-bg p-3">
				<p class="text-sm text-ink-2">{flag.rationale}</p>
				<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
					{#each flag.statements as statement (statement.entityId)}
						<div class="rounded-md border border-line bg-panel p-2 text-xs">
							<a
								href={resolve(`/w/${universeSlug}/e/${statement.entitySlug}`)}
								class="block font-mono text-label font-semibold tracking-wide text-muted uppercase hover:text-accent-ink hover:underline"
							>
								{statement.entityName}
							</a>
							<p class="mt-1 text-ink-2 italic">
								&ldquo;{stripMentionSyntax(statement.statement)}&rdquo;
							</p>
						</div>
					{/each}
				</div>
				<p class="mt-2 text-xs text-ink-2">{t.entry.audit.disclaimer}</p>
				<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
					<form
						method="POST"
						action="?/dismissFlag"
						use:enhance={() => {
							dismissing = { ...dismissing, [flag.id]: true };
							return async ({ update }) => {
								await update();
							};
						}}
					>
						<input type="hidden" name="proposalId" value={flag.id} />
						<Button type="submit" variant="secondary" size="sm" disabled={dismissing[flag.id]}>
							{dismissing[flag.id] ? t.entry.audit.dismissing : t.entry.audit.dismiss}
						</Button>
					</form>
					<span class="text-ink-2">{t.entry.audit.openBoth}</span>
					{#each flag.statements as statement (statement.entityId)}
						<InlineLink
							href={resolve(`/w/${universeSlug}/e/${statement.entitySlug}`)}
							target="_blank"
							rel="noopener"
						>
							{statement.entityName} &#8599;
						</InlineLink>
					{/each}
				</div>
			</li>
		{/each}
	</ul>
{/if}
