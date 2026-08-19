<script lang="ts">
	/** #109, guardrail 5: which provider sees campaign content, what retention, no
	 * training on customer data, stated plainly. F3 = C put the short version of this
	 * next to every action that spends (import, generate, Ask); this route is the page
	 * that short version links to for the full detail, so it is written for the GM
	 * reading it, not for another engineer, and it says "we do not know yet" where
	 * that is the honest answer (SPEC.md §16, open decision 2) instead of a number
	 * this repo cannot back up.
	 *
	 * Issue #121's sweep localizes only the DocPage chrome (`docs.privacy`): this is a
	 * legal/product document, and machine-rewriting the long-form prose body below
	 * risks changing what it actually promises, so the body stays English. */
	import DocPage from '$lib/components/docs/DocPage.svelte';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let t = $derived(messages(data.locale).docs.privacy);
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<DocPage title={t.title}>
	<p>
		Canonry uses AI in a few places: answering questions about your canon, drafting updates when
		something changes, generating images, generating ambient sound, and reading your files during an
		import. This page says plainly which company sees your campaign's content for each of those,
		what we do not promise yet, and what never happens to it.
	</p>

	<h2>Text</h2>
	<p>
		Every text call, the Loremaster answering a question, a propagation diff, a drafted entry, a
		document read during an import, goes out through <strong>Vercel AI Gateway</strong>, which
		routes it to whichever model provider is configured for that kind of job: currently Google,
		Anthropic, OpenAI, Groq or Mistral, picked per job from our database. Vercel is the routing
		layer that carries the request and handles logging and cost accounting; the model provider on
		the other side is the company that actually reads and processes your text. A cheap model handles
		bulk extraction, a stronger model is reserved for what a playbook marks as hard, and a
		multimodal model only looks at a page when a page actually has to be looked at. That routing can
		change from an admin panel without a deploy, so this page names both layers, the gateway and the
		provider it currently points at, rather than freezing one company's name here: which provider
		sits behind any single call is a row in our database (visible in the admin models panel), not a
		promise fixed in this paragraph.
	</p>

	<h2>Images</h2>
	<p>
		Generating an image sends that entry's text and your universe's style directly to
		<strong>Replicate</strong> - not through the gateway text uses, because Vercel's AI Gateway has no
		route to Replicate's models. The image starts private to you: it never flows automatically into the
		players' wiki, it stays visibly marked as generated, and image generation can be switched off for
		a universe entirely. That connection to Replicate runs on our own account; there is no setting yet
		to use your own Replicate key for it.
	</p>

	<h2>Sound</h2>
	<p>
		Ambient sound layers and one-shot effects are generated directly with
		<strong>ElevenLabs</strong>, for the same reason images go direct to Replicate: Vercel's gateway
		carries no ElevenLabs sound-generation route either. That connection also runs on our own
		account, with no bring-your-own-key option for it yet. A generated layer is cached and reused
		for similar-enough descriptions, so the same prompt does not necessarily mean a fresh call to
		ElevenLabs every time. Ambient sound can be switched off the same way image generation can.
	</p>

	<h2>Mail</h2>
	<p>
		A password reset, and later an email verification, a shared-universe invitation or an
		import-finished notice, is sent through <strong>Resend</strong>, on our own verified
		<code>canonry.io</code> domain. Resend sees the address you sign up with and the mail we ask it to
		deliver on our behalf - never your canon's content, which never touches this connection at all. The
		key we hold for it can only send mail on that domain; it cannot read your account, your inbox, or
		anyone else's mail. If a send fails, we log that it failed and tell you, rather than showing a message
		that went nowhere.
	</p>

	<h2>Reading stays on when writing is switched off</h2>
	<p>
		The per-universe switch stops generation: text, images, sound, drafted proposals, warming,
		anything a model writes. It does not stop reading. Search over your own canon and mention
		suggestions keep working with writing off, because none of that costs you anything and a wiki
		that cannot search itself is not a good wiki. The honest cost of that choice: search still sends
		the relevant pieces of your canon out to build and query its index, whether or not writing is
		on. Off turns off generation. It does not mean nothing leaves.
	</p>
	<p>
		Naming that one precisely, because it is the piece of this page most likely to be read by
		somebody deciding whether to trust us with a campaign: the embedding model is
		<strong>Qwen3-Embedding-4B</strong>, open weights published by Alibaba under the Apache-2.0
		licence, and Vercel's gateway currently routes it to <strong>DeepInfra</strong>, who run the
		model and therefore see the text being indexed. Alibaba publishes the weights; they do not serve
		them for us and see nothing. We picked an open model over the proprietary one we started with
		for a reason that also matters to you: because the weights are public, the same model can be run
		by a different company, or by us on our own hardware, without re-reading your canon to rebuild
		the index. That is what makes leaving a provider possible at all.
	</p>

	<h2>Imports</h2>
	<p>
		An import's only outbound connection is Vercel AI Gateway. Whatever document you hand it, from
		whichever source, is read by a model picked the same way as everything else: cheap for bulk
		extraction, a stronger model for what the playbook marks as hard, multimodal only where a
		scanned page has to actually be looked at. Nothing in the import process talks to World Anvil,
		Kanka, Replicate or ElevenLabs directly. It only ever reads the file you exported and handed to
		it yourself.
	</p>

	<h2>What we do not do</h2>
	<p>
		We do not run production imports or generation on a shared consumer subscription; a convenience
		like that stays in development, never a real job. Our own logs never record what was in your
		files, only that a call happened: which job, which agent, how many tokens. Never the content,
		never a credential. What we do not yet do is guarantee that the model provider behind a call
		skips training on your prompts - see "Retention, honestly" below for exactly what that gap is
		and how it gets closed.
	</p>

	<h2>Retention, honestly</h2>
	<p>
		This is the one place where "we do not know yet" changed shape rather than went away. Which
		vendor and plan carries text and embeddings is decided now: Vercel AI Gateway, routing to
		whichever model provider a job names (see "Text" above). So the open question is no longer who,
		it is which protections we turn on for that connection - and neither is on yet.
	</p>
	<p>
		Vercel AI Gateway offers two controls we have not switched on: <strong
			>Zero Data Retention</strong
		>, which deletes a prompt and its response once the request completes and, as a side effect,
		also stops the provider training on it; and a narrower, free <strong>no-training</strong> setting
		that stops training without deleting the request log. Turning Zero Data Retention on would also narrow
		which model providers a job can actually reach, because a provider that has not signed Vercel's zero-retention
		terms is silently excluded from routing under it rather than surfaced as a choice - so it is a real
		trade-off, not a free upgrade, and it is not ours to flip silently. Until one of those switches is
		on, the honest default is the one Vercel itself states for an unconfigured request: if a provider's
		training stance is not already covered by one of these agreements, assume it trains.
	</p>
	<p>
		What is not in question, regardless of that switch: your entries live in our own database under
		your account, and any image or sound you generate or import is stored there too, not just linked
		to. Replicate and ElevenLabs, called directly for images and sound, sit outside this gateway
		control entirely - we do not have a stated no-training guarantee from either one yet, and this
		page will say so plainly the day one exists rather than assume it.
	</p>

	<h2>Bring your own key</h2>
	<p>
		You can use your own key for a text-model provider instead of ours, off by default, from
		Settings. Turning it on stops that provider's calls from drawing on your quota, and your own
		provider's limits apply instead of ours. It does not change which model gets picked for which
		job, and it does not skip the gateway, so logging and cost tracking stay the same either way.
	</p>
	<p>
		One thing worth knowing before you rely on it for cost control: if your own key fails, expired,
		revoked, rate-limited, the gateway does not simply refuse the call. It quietly retries with our
		credentials instead, so the call still goes through and you still get an answer, but that
		particular call is billed to us, not to your key. You will not see an error for it; we will see
		the cost. This applies only to text-model providers today (OpenAI, Anthropic, Google, Groq,
		Mistral) - Replicate and ElevenLabs do not offer a bring-your-own-key option yet.
	</p>

	<h2>Where this is going</h2>
	<p>
		Vercel AI Gateway, Replicate and ElevenLabs are today's arrangement, not the end state. When
		Spole ships, an import will be able to run on your own machine with your own agent instead of
		ours: no credential of ours in the loop, nothing of yours leaving your laptop for that job. That
		is not a promise of a date. It is the direction every credential decision in this product
		already points.
	</p>
</DocPage>
