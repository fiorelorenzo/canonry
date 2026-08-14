/**
 * Wikitext cleanup for the chunker (SPEC.md §7/§11.3). Not a full MediaWiki parser -
 * templates can nest arbitrarily and this only unwinds a bounded number of levels - but
 * enough to turn real wiki markup into readable prose for chunking and embedding, which
 * is all indexing needs. Deliberately conservative: strips markup and noise (comments,
 * references, templates, tables), never rewrites the remaining text.
 */

const MAX_TEMPLATE_UNWIND_PASSES = 8;

function stripTemplates(text: string): string {
	let result = text;
	// {{...}} can nest; strip from the innermost pair outward, bounded so a malformed
	// (unbalanced) page can never loop forever.
	for (let pass = 0; pass < MAX_TEMPLATE_UNWIND_PASSES; pass++) {
		const next = result.replace(/\{\{[^{}]*\}\}/g, '');
		if (next === result) break;
		result = next;
	}
	return result;
}

function stripTables(text: string): string {
	return text.replace(/^\{\|[\s\S]*?^\|\}\s*$/gm, '');
}

export function wikitextToPlainText(wikitext: string): string {
	let text = wikitext;
	text = text.replace(/<!--[\s\S]*?-->/g, '');
	text = text.replace(/<ref[^>]*\/>/gi, '');
	text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
	text = stripTables(text);
	text = stripTemplates(text);
	// [[Link|Label]] -> Label, [[Link]] -> Link, [[File:...]]/[[Category:...]] -> dropped.
	text = text.replace(/\[\[(File|Image|Category):[^\]]*\]\]/gi, '');
	text = text.replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, '$2');
	text = text.replace(/\[\[([^\]]*)\]\]/g, '$1');
	// External links: [https://example.com Label] -> Label, bare [https://example.com] dropped.
	text = text.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1');
	text = text.replace(/\[https?:\/\/\S+\]/g, '');
	text = text.replace(/'''''([^']*)'''''/g, '$1');
	text = text.replace(/'''([^']*)'''/g, '$1');
	text = text.replace(/''([^']*)''/g, '$1');
	// Remaining raw HTML tags: drop the tag, keep the inner text.
	text = text.replace(/<[^>]+>/g, '');
	text = text.replace(/&nbsp;/g, ' ');
	text = text.replace(/[ \t]+\n/g, '\n');
	text = text.replace(/\n{3,}/g, '\n\n');
	return text.trim();
}
