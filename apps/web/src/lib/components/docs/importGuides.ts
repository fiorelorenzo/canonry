/**
 * Content for the import guides (issue #110, SPEC.md §6.6, §6.8, §6.9, §6.10), one
 * entry per source, in the same order the spec's source table does. Kept as data
 * rather than seven near-identical Svelte files: the chrome (`DocPage.svelte`) is
 * one component, the export steps are the only thing that actually differs per
 * source, and a shared shape keeps that difference reviewable as prose rather than
 * as seven copies of the same markup drifting apart.
 *
 * D1 = C, detect then confirm (docs/ux/DECISIONS.md): Canonry never makes a GM pick
 * a source before uploading, it guesses from what was uploaded and asks for
 * confirmation. Every "what it recognises" section below is written to match that
 * flow, not a source picker.
 */

export type GuideBlock =
	| { kind: 'p'; text: string }
	| { kind: 'list'; ordered?: boolean; items: string[] }
	| { kind: 'callout'; tone: 'note' | 'warn'; text: string };

export interface GuideSection {
	heading: string;
	blocks: GuideBlock[];
}

export interface ImportGuide {
	slug: string;
	label: string;
	/** One line, shown on the `/docs/import` index next to the link. */
	summary: string;
	sections: GuideSection[];
}

function p(text: string): GuideBlock {
	return { kind: 'p', text };
}

function warn(text: string): GuideBlock {
	return { kind: 'callout', tone: 'warn', text };
}

export const IMPORT_GUIDES: readonly ImportGuide[] = [
	{
		slug: 'obsidian',
		label: 'Obsidian',
		summary: 'Vault folder or zip, wikilinks read as relations',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'Your vault folder itself, or a zip of it. Obsidian already stores everything as ' +
							'plain files, so there is no export step: point Canonry at the folder that contains ' +
							'a .obsidian folder, or zip that folder first if you would rather upload a single ' +
							'file.'
					)
				]
			},
			{
				heading: 'What it recognises',
				blocks: [
					p(
						'Canonry looks for a .obsidian folder to tell your vault apart from any other ' +
							'folder of text files; find one and it shows you how many notes it counted before ' +
							'asking you to confirm the Obsidian playbook. Without one, if every file in the ' +
							'upload is Markdown, it still guesses Obsidian, just unconfirmed - say no either ' +
							'way and it falls back to a short list of other playbooks.'
					)
				]
			},
			{
				heading: 'What it reads',
				blocks: [
					p(
						'Every [[wikilink]] becomes a candidate relation, the starting graph rather than a ' +
							'decoration. That covers aliases, heading and block links, and embeds. Dataview ' +
							'inline fields written as Key:: value are read as structured facts rather than ' +
							'plain prose.'
					)
				]
			}
		]
	},
	{
		slug: 'kanka',
		label: 'Kanka',
		summary: 'Campaign export, free tier, once a day',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'The campaign export from your Kanka account. Open your campaign, run the export, ' +
							'and download the JSON file it produces. Images are included in that file, so ' +
							"there's nothing to gather separately. The export is available on Kanka's free " +
							'tier, once a day.'
					)
				]
			},
			{
				heading: 'Why not the API',
				blocks: [
					p(
						"Kanka's API is clean and well documented, but its terms restrict commercial use on " +
							'a customer\u2019s behalf, and a paid product calling it for you on your account is ' +
							'exactly what that restricts. Using the export you already download from your own ' +
							'account avoids the question entirely, and keeps this the same as every other ' +
							'source: a file you own, that you hand to us.'
					)
				]
			},
			{
				heading: 'What it recognises',
				blocks: [
					p(
						'Canonry tells a Kanka export apart from other JSON by its shape, and confirms the ' +
							'Kanka playbook before running it, the same as any other source.'
					)
				]
			}
		]
	},
	{
		slug: 'world-anvil',
		label: 'World Anvil',
		summary: 'Full World Export, guild members only',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'The Full World Export: a structured zip of JSON and HTML that World Anvil produces ' +
							'for guild members. Request the Full World Export for your world from World Anvil ' +
							'and upload the zip it gives you. Canonry does the parsing, entity extraction and ' +
							'relation inference on our side once you hand it over.'
					)
				]
			},
			{
				heading: "If you're on the free tier",
				blocks: [
					warn(
						'There is no clean way in for a free World Anvil account, and we are not building a ' +
							'workaround for that. The Full World Export needs guild membership. The API is a ' +
							'further step up: a Grandmaster subscription, plus an app key granted by human ' +
							'review, roughly fifteen days. Neither door is open below guild membership. ' +
							'Export what you can to PDF or DOCX instead and bring that in through those ' +
							'guides, or use Something else if neither fits your notes.'
					)
				]
			},
			{
				heading: 'What it recognises',
				blocks: [
					p(
						"Every article's template, person, settlement, organisation, item and so on, " +
							'becomes an entity type; headings become sections; links between articles become ' +
							'candidate relations.'
					)
				]
			}
		]
	},
	{
		slug: 'onenote',
		label: 'OneNote',
		summary: 'Page tree preferred, PDF/DOCX/.onepkg as fallback',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'The real path is a folder tree of individually exported pages, one file per page, ' +
							"keeping every page's place in your notebook's own hierarchy. OneNote has no menu " +
							'item for this itself: producing it means running a script against the same ' +
							"GetHierarchy and Publish automation calls OneNote's desktop app exposes, for " +
							'example meichthys/onenote-html-export, a free, open-source tool built for exactly ' +
							'this. It needs the desktop app on Windows; there is no web or Mac equivalent for ' +
							'producing the tree. Point Canonry at the folder it produces, or a zip of it.'
					),
					p(
						'If you cannot produce that tree, export the whole notebook or a section to PDF or ' +
							'DOCX from the Windows desktop app instead, or to .onepkg from OneNote on the web ' +
							'with a personal Microsoft account, and hand Canonry that file. It is read through ' +
							'the PDF or DOCX guide, the same as any other PDF or DOCX, keeping every page but ' +
							"losing the notebook's own hierarchy: a subpage becomes just another heading once " +
							'the export flattens it.'
					)
				]
			},
			{
				heading: 'What it recognises',
				blocks: [
					p(
						'Canonry looks for a tree of HTML pages where at least one page has its own sibling ' +
							'folder of embedded attachments, named after the page with _files appended - the ' +
							'shape only an exported OneNote page tree produces, and nothing else mimics. Find ' +
							'that and it shows you how many pages it counted before asking you to confirm the ' +
							'OneNote playbook; say no and it falls back to a short list of other playbooks. A ' +
							'notebook where no page embeds an image has no such folder for Canonry to key on, ' +
							'so detection will not recognise it as OneNote - bring in at least one page with ' +
							'an embedded image if you can, or use the PDF, DOCX or .onepkg fallback above.'
					)
				]
			},
			{
				heading: 'What it reads',
				blocks: [
					p(
						"The notebook's own hierarchy is what a flattened PDF or DOCX export throws away, " +
							'and it is the reason this path exists: a page sitting in a folder named after ' +
							'another page is proposed as a subpage of it, with the folder tree itself standing ' +
							"as the evidence, since OneNote's own export produced it rather than anything " +
							'written in the page itself. Every link to another page in the tree becomes a ' +
							'candidate relation the same way, and every embedded image travels across as an ' +
							"attachment on the page's own entity. A page's title becomes its entity name."
					)
				]
			},
			{
				heading: 'Limits worth knowing',
				blocks: [
					warn(
						'OneNote on a Mac cannot produce the page tree at all, and its own export only ' +
							'covers the page you are currently viewing, not the whole notebook. If your world ' +
							'lives in OneNote on a Mac, exporting page by page to PDF is the only option that ' +
							'app gives you.'
					),
					warn(
						'A .onepkg file is not readable yet. The format is documented, but no reader has ' +
							'been built for it, deferred rather than refused. If .onepkg is your only option, ' +
							'for instance from OneNote on the web, export to PDF instead, or move to the ' +
							'Windows desktop app if you have access to one. Web export also only covers a ' +
							'personal Microsoft or OneDrive account; a work, school or SharePoint account is ' +
							'not covered by that path.'
					)
				]
			}
		]
	},
	{
		slug: 'pdf',
		label: 'PDF',
		summary: 'Any PDF, scanned pages read as images',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'Any PDF file, uploaded directly. If your world lives somewhere that can print or ' +
							'export to PDF, that is a valid way in even when nothing else on this list fits.'
					)
				]
			},
			{
				heading: "How it's read",
				blocks: [
					p(
						'Text on the page is read as text. A scanned page with no text layer is rendered as ' +
							'an image, and the model looks at it directly, the same page a person would see. ' +
							'There is no separate OCR service and no third party involved in that step.'
					)
				]
			}
		]
	},
	{
		slug: 'docx',
		label: 'DOCX',
		summary: 'Word document, structure kept, styling dropped',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [p('A Word document (.docx), uploaded directly.')]
			},
			{
				heading: 'What survives',
				blocks: [
					p(
						'Structure survives: headings, paragraphs, lists. Visual styling, fonts, colours, ' +
							'manual layout, does not, because Canonry cares about what the document says, not ' +
							'how it looks on a page.'
					)
				]
			}
		]
	},
	{
		slug: 'generic',
		label: 'Something else',
		summary: 'Anything else, read by the generic playbook',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'Whatever your tool can export: plain text, HTML, RTF, CSV, a folder of mixed files, ' +
							'anything readable. If Canonry does not recognise the shape of what you upload as ' +
							'one of the sources above, it runs the generic playbook automatically rather than ' +
							'stopping.'
					)
				]
			},
			{
				heading: 'What to expect',
				blocks: [
					p(
						'The generic playbook reads what it can and proposes entities from whatever text ' +
							'and images it finds. It is slower and looser than a playbook built for one ' +
							'source, because it is not assuming a particular structure, but it is a ' +
							'legitimate result, not a fallback that failed. If your source is one of the ' +
							'named ones, use its guide instead: a named playbook understands its structure ' +
							'and produces better candidates from it.'
					)
				]
			}
		]
	}
];
