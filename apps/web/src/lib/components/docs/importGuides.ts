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
		summary: 'Single File Web Page or a page tree, PDF and DOCX as fallbacks',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'Export your notebook, a section or a page as Single File Web Page (.mht) from the ' +
							'Windows desktop app, and hand Canonry that one file, on its own or zipped. It is ' +
							"OneNote's own export, it needs no other tool, and it is what Canonry reads best: " +
							'every page in it becomes its own entry rather than one long document.'
					),
					p(
						'A folder tree of individually exported pages, one file per page, is read the same way ' +
							'and carries one thing the .mht does not: where each page sits in your notebook, so ' +
							'a subpage is proposed as a subpage. OneNote has no menu item for it, and producing ' +
							'it means running a script against the same GetHierarchy and Publish automation calls ' +
							"OneNote's desktop app exposes, for example meichthys/onenote-html-export, a free, " +
							'open-source tool built for exactly this. It needs the desktop app on Windows. Point ' +
							'Canonry at the folder it produces, or a zip of it.'
					),
					p(
						'Failing both, export to PDF or DOCX and hand Canonry that. It is read through the PDF ' +
							'or DOCX guide, the same as any other PDF or DOCX, keeping every page but losing the ' +
							"notebook's own structure: every page becomes one long document and a subpage becomes " +
							'just another heading. Canonry can tell that a PDF came out of OneNote\u2019s own ' +
							'printer, so it says so on the confirmation screen rather than letting you think the ' +
							'structure came across.'
					),
					p(
						'The three remaining things the export menu offers are refused, and refused before an ' +
							'import starts rather than partway through it, so nothing is spent on them: XPS ' +
							'(.xps) and OneNote\u2019s own binary files (.one, .onetoc2, and the .onepkg package ' +
							'OneNote on the web produces). Canonry reads what a file is from its bytes, not from ' +
							'its name, so renaming one does not get it through.'
					)
				]
			},
			{
				heading: 'What it recognises',
				blocks: [
					p(
						'Two things, either of which is enough. A page OneNote exported says so in its own ' +
							'head, and Canonry reads that, so a .mht or a page tree is recognised whatever else ' +
							'is in it. And a tree of HTML pages where at least one page has its own sibling ' +
							'folder of embedded attachments, named after the page with _files appended, is the ' +
							'shape only an exported page tree produces. Either way Canonry shows you how many ' +
							'pages it counted before asking you to confirm the OneNote playbook; say no and it ' +
							'falls back to a short list of other playbooks.'
					)
				]
			},
			{
				heading: 'What it reads',
				blocks: [
					p(
						"Every page becomes its own entry, with the page's own title as its name and only that " +
							'page\u2019s prose as its content. Every link to another page in the same export ' +
							'becomes a candidate relation, and every embedded image travels across as an ' +
							"attachment on the page's own entity."
					),
					p(
						'The page tree carries one thing more: a page sitting in a folder named after another ' +
							'page is proposed as a subpage of it, with the folder tree itself standing as the ' +
							'evidence, since OneNote\u2019s own export produced it rather than anything written ' +
							'in the page.'
					)
				]
			},
			{
				heading: 'Limits worth knowing',
				blocks: [
					warn(
						'A .mht export carries no hierarchy at all, and Canonry does not invent one. A whole ' +
							"notebook exported that way is its sections' pages one after another with nothing " +
							'between them: no section name, no boundary, and nothing saying which page a subpage ' +
							'used to sit under. So every page comes across as its own entry with none proposed ' +
							'as a subpage. If your notebook\u2019s structure carries meaning you want kept, the ' +
							'page tree is the export that keeps it.'
					),
					warn(
						'OneNote on a Mac cannot produce the page tree at all, and its own export only ' +
							'covers the page you are currently viewing, not the whole notebook. If your world ' +
							'lives in OneNote on a Mac, exporting page by page to PDF is the only option that ' +
							'app gives you.'
					),
					warn(
						'The .onepkg, .one and .onetoc2 formats are not readable. They are documented, and a ' +
							'reader for them is deferred rather than refused, so export as Single File Web Page, ' +
							'PDF or DOCX from the Windows desktop app instead. OneNote on the web also only ' +
							'covers a personal Microsoft or OneDrive account; a work, school or SharePoint ' +
							'account is not covered by that path.'
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
						'Whatever your tool can export: a single file, or a folder of mixed files nested ' +
							'as deep as it likes. If Canonry does not recognise the shape of what you upload ' +
							'as one of the sources above, it runs the generic playbook automatically rather ' +
							'than stopping.'
					)
				]
			},
			{
				heading: 'What counts as a document',
				blocks: [
					p(
						'Every file Canonry can read as text becomes one document, with its own line in ' +
							'the estimate and its own cost: plain text, Markdown, HTML, RTF, CSV, JSON, and a ' +
							'PDF or a Word document sitting in the folder alongside the rest. There is no ' +
							'list of allowed extensions, so a file your tool gave an unusual name, or no ' +
							'extension at all, still counts as long as its contents are text.'
					),
					p(
						'Four kinds of file are skipped instead, and the document count on the estimate ' +
							'screen is where you see it. An image, a sound or video file, an archive, or ' +
							'anything else whose bytes are not text: handing those to a model as if they were ' +
							'text is worse than leaving them out. Anything hidden, meaning a file or folder ' +
							'whose name starts with a dot, which is where an application keeps its own ' +
							'bookkeeping rather than your notes. An empty file. And a scanned PDF with no ' +
							'text layer, because in a mixed folder there is nothing to read out of it: upload ' +
							'that PDF on its own and Canonry recognises it as a PDF instead, and looks at ' +
							'each page as an image.'
					),
					warn(
						'If nothing in your upload reads as text, Canonry says so before you spend ' +
							'anything. The estimate step refuses with "No documents this playbook recognises ' +
							'were found in the upload" rather than starting an import that would propose ' +
							'nothing.'
					)
				]
			},
			{
				heading: 'What to expect',
				blocks: [
					p(
						'The generic playbook reads what it can and proposes entities from whatever text ' +
							'and images it finds. An image is never a document of its own, but the playbook ' +
							'can store one it finds referenced from a document it is reading and attach it to ' +
							'what it proposes. HTML, RTF and CSV are handed over as their own text, markup ' +
							'and commas included, rather than converted to something tidier first.'
					),
					p(
						'It is slower and looser than a playbook built for one source, because it is not ' +
							'assuming a particular structure, but it is a legitimate result, not a fallback ' +
							'that failed. If your source is one of the named ones, use its guide instead: a ' +
							'named playbook understands its structure and produces better candidates from it. ' +
							'You can also pick a named playbook yourself on the confirmation screen when ' +
							'Canonry guessed generic and you know better.'
					)
				]
			}
		]
	}
];
