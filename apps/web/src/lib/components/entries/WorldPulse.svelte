<script lang="ts">
	/**
	 * #348: the world home's masthead line, in place of the three figures that used to open
	 * this page (entries, waiting review, credits spent), each of which the shell already
	 * shows: the first two on the sidebar's own rows, the third in F2's quota meter. This
	 * says the one thing none of those do, which is how the world has been moving.
	 *
	 * A sentence and, when there is a shape to draw, twelve bars: one rolling week each,
	 * oldest on the left, the newest week in the accent so the eye lands on now rather than
	 * on the tallest column. The sentence is the accessible content and states both figures
	 * the bars encode, which is why the strip itself is `aria-hidden`: a screen reader
	 * reading out twelve numbers would be a worse version of the sentence above it. The
	 * `title` on each bar answers the one follow-up a mouse asks, which week that was.
	 *
	 * Colours are the theme's own: `--color-line-2` for a week that happened,
	 * `--color-accent` for the newest one. Never `--color-ai` (C1 reserves violet for
	 * unaccepted copilot text, and a bar chart of a GM's own edits is neither).
	 *
	 * G2 needs nothing here: `html { font-variant-numeric: tabular-nums }` in layout.css
	 * already makes every figure in the app tabular, and the serif is the body face.
	 */
	import { dateFormat, type Locale, type Messages } from '$lib/i18n';
	import { PULSE_WEEKS, type WorldPulse } from './world-pulse';

	let {
		pulse,
		locale,
		t
	}: {
		pulse: WorldPulse;
		locale: Locale;
		t: Messages['universe']['index']['home'];
	} = $props();

	/** The strip's own height in pixels, which the bars are scaled into. Small enough to sit
	 * under the world's name without competing with it, tall enough that a week with one
	 * change and a week with nine are visibly different. */
	const STRIP_PX = 44;
	/** A week with nothing in it still draws a hairline, so the strip reads as twelve weeks
	 * with gaps rather than as a shorter strip. */
	const EMPTY_PX = 2;

	const monthFormat = $derived(dateFormat(locale, { month: 'long', year: 'numeric' }));

	const sentence = $derived.by(() => {
		if (pulse.kind === 'moving') return t.pulseMoving(pulse.total, pulse.latest, PULSE_WEEKS);
		if (pulse.kind === 'quiet')
			return t.pulseQuiet(
				PULSE_WEEKS,
				pulse.lastChangeAt ? monthFormat.format(pulse.lastChangeAt) : null
			);
		return null;
	});

	/**
	 * Square root of the share of the busiest week, not the share itself, and the bars are
	 * therefore deliberately not proportional to the counts. One import afternoon or one long
	 * session puts twenty changes in a week where the others hold three, and on a linear scale
	 * those eleven weeks collapse into hairlines: the strip then says "one big week" and
	 * nothing else, which the sentence beside it already said better. The magnitudes live in
	 * the prose; what the strip is for is the rhythm, so it is scaled to keep a quiet week
	 * legible next to a loud one.
	 */
	function barHeight(count: number, peak: number): number {
		if (count === 0) return EMPTY_PX;
		return Math.max(5, Math.round(Math.sqrt(count / peak) * STRIP_PX));
	}

	/** The newest week carries the accent, an empty week only a hairline in `--color-line`,
	 * everything else the same quiet `--color-line-2`: the shape is the information, so a
	 * per-height gradient would only add a second encoding of the same number. */
	function barTone(count: number, newest: boolean): string {
		if (newest) return 'bg-accent';
		return count === 0 ? 'bg-line' : 'bg-line-2';
	}
</script>

{#if sentence}
	<div
		class="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-2"
	>
		<p class="max-w-measure text-ink-2">{sentence}</p>
		{#if pulse.kind === 'moving'}
			<div class="flex shrink-0 items-end gap-2" style="height: {STRIP_PX}px" aria-hidden="true">
				{#each pulse.weeks as count, index (index)}
					<span
						class="w-3 rounded-t-sm {barTone(count, index === pulse.weeks.length - 1)}"
						style="height: {barHeight(count, pulse.peak)}px"
						title={t.pulseWeekTitle(count, pulse.weeks.length - 1 - index)}
					></span>
				{/each}
			</div>
		{/if}
	</div>
{/if}
