<script lang="ts">
	/** #109, guardrail 5: which provider sees campaign content, what retention, no
	 * training on customer data, stated plainly. F3 = C put the short version of this
	 * next to every action that spends (import, generate, Ask); this route is the page
	 * that short version links to for the full detail, so it is written for the GM
	 * reading it, not for another engineer, and it says "we do not know yet" where
	 * that is the honest answer (SPEC.md §16, open decision 2) instead of a number
	 * this repo cannot back up. */
	import { resolve } from '$app/paths';
	import DocPage from '$lib/components/docs/DocPage.svelte';
</script>

<svelte:head>
	<title>Where your campaign's words go: Canonry</title>
</svelte:head>

<DocPage title="Where your campaign's words go" backHref={resolve('/')} backLabel="Universes">
	<p>
		Canonry uses AI in a few places: answering questions about your canon, drafting updates when
		something changes, generating images, and reading your files during an import. This page says
		plainly which provider sees your campaign's content when that happens, what we do not promise
		yet, and what never happens to it, whichever provider is behind the gateway on a given day.
	</p>

	<h2>Text</h2>
	<p>
		Every text call, the Loremaster answering a question, a propagation diff, a drafted entry, a
		document read during an import, goes out through Cloudflare AI Gateway to whichever model is
		configured for that kind of job. A cheap model handles bulk extraction, a stronger model is
		reserved for what a playbook marks as hard, and a multimodal model only looks at a page when a
		page actually has to be looked at. That routing can change from an admin panel without a deploy,
		so this page names the gateway rather than one company: which company sits behind any single
		call is a row in our database, not a promise fixed in this paragraph.
	</p>

	<h2>Images</h2>
	<p>
		Generating an image sends that entry's text and your universe's style to Replicate, through the
		same gateway text uses. The image starts private to you: it never flows automatically into the
		players' wiki, it stays visibly marked as generated, and image generation can be switched off
		for a universe entirely. That connection to Replicate runs on our own account, not yours, unless
		you turn on your own key for it.
	</p>

	<h2>Reading stays on when writing is switched off</h2>
	<p>
		The per-universe switch stops generation: text, images, drafted proposals, warming, anything a
		model writes. It does not stop reading. Search over your own canon and mention suggestions keep
		working with writing off, because none of that costs you anything and a wiki that cannot search
		itself is not a good wiki. The honest cost of that choice: search still sends the relevant
		pieces of your canon out to build and query its index, through the same gateway, whether or not
		writing is on. Off turns off generation. It does not mean nothing leaves.
	</p>

	<h2>Imports</h2>
	<p>
		An import's only outbound connection is the gateway. Whatever document you hand it, from
		whichever source, is read by a model picked the same way as everything else: cheap for bulk
		extraction, a stronger model for what the playbook marks as hard, multimodal only where a
		scanned page has to actually be looked at. Nothing in the import process talks to World Anvil,
		Kanka or any other source directly. It only ever reads the file you exported and handed to it
		yourself.
	</p>

	<h2>What we do not do</h2>
	<p>
		We do not run production imports or generation on a shared consumer subscription; a convenience
		like that stays in development, never a real job. Whichever provider ends up behind the gateway,
		no training on your campaign content is a condition of doing business with them, not a hope
		about behaviour we cannot see. Our own logs never record what was in your files, only that a
		call happened: which job, which agent, how many tokens. Never the content, never a credential.
	</p>

	<h2>Retention, honestly</h2>
	<p>
		This is the one place we do not have a clean number, and we would rather say so than invent one.
		Which commercial provider and plan backs production imports is still an open question we are
		settling as a procurement matter, not a technical one, so we cannot yet tell you how many days a
		provider holds a request log after it processes one. What is not in question: your entries live
		in our own database under your account, and any image you generate or import is stored there
		too, not just linked to. We will put a number on the provider side the day that agreement
		exists, not before.
	</p>

	<h2>Bring your own key</h2>
	<p>
		You can use your own provider key instead of ours, off by default. Turning it on stops that
		provider's calls from drawing on your quota, and your own provider's limits apply instead of
		ours. It does not change which model gets picked for which job, and it does not skip the
		gateway, so logging and cost tracking stay the same either way. Find it in Settings.
	</p>

	<h2>Where this is going</h2>
	<p>
		Cloudflare AI Gateway and Replicate are today's arrangement, not the end state. When Spole
		ships, an import will be able to run on your own machine with your own agent instead of ours: no
		credential of ours in the loop, nothing of yours leaving your laptop for that job. That is not a
		promise of a date. It is the direction every credential decision in this product already points.
	</p>
</DocPage>
