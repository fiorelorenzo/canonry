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
		summary: 'A zip of your vault, wikilinks read as relations',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'A zip of your vault folder. Obsidian already stores everything as plain files, so ' +
							'there is no export step: zip the folder that contains the .obsidian folder and ' +
							'upload that. The upload box takes one file rather than a folder, which is why the ' +
							'zip is the way in, and the .obsidian folder inside it is what Canonry looks for.'
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
		summary: 'The notebook or a section in OneNote\u2019s own format, from the desktop app',
		sections: [
			{
				heading: 'What to hand Canonry',
				blocks: [
					p(
						'Use File > Export in the OneNote desktop app: pick Section and save it as OneNote ' +
							'Section (.one), or pick Notebook and save it as OneNote Package (.onepkg). Hand ' +
							'Canonry the file, on its own or zipped. This is the format OneNote itself reads ' +
							'back, and it is the only export that records where each page sits in your ' +
							'notebook, so a subpage is proposed as a subpage rather than as one more page.'
					),
					warn(
						'Which OneNote you have decides whether that menu exists. File > Export is in the ' +
							'desktop app, the one sold with Microsoft 365 and known as OneNote 2016, and that ' +
							'is where .one and .onepkg come from. The newer OneNote app that ships with ' +
							'Windows, the one that replaced OneNote for Windows 10, exports to PDF and nothing ' +
							'else. If that is the OneNote you have, none of the options in this paragraph are ' +
							'in your menus and the section-at-a-time route below is the one to take. OneNote ' +
							'on the web can also export a notebook as .onepkg, but only for a personal ' +
							'Microsoft or OneDrive account, not a work, school or SharePoint one.'
					),
					p(
						'Failing that, export one section at a time as Single File Web Page (.mht) from the ' +
							"desktop app, and hand Canonry each file, on its own or zipped. It is OneNote's " +
							'own export, it needs no other tool, and every page in it becomes its own entry ' +
							'rather than one long document. What it does not carry is the hierarchy.'
					),
					warn(
						'Export a whole notebook in one go as .mht, PDF or DOCX and OneNote leaves pages out ' +
							'of the file it writes. The file is well formed, it imports without a complaint, ' +
							'and the pages that did not make it are simply not there to import. Nothing in the ' +
							'file says which ones they were, so Canonry cannot put them back or tell you what ' +
							'is absent. Exporting a section at a time does not lose them, which is why that is ' +
							'the instruction above. A section is also the unit that fits an import: it comes ' +
							'back with an estimate you can read before you spend anything. The .onepkg export ' +
							'is the exception and does not behave that way, which is why it is the first thing ' +
							'on this page.'
					),
					p(
						'A folder tree of individually exported pages, one file per page, carries the same ' +
							'hierarchy .one and .onepkg do and is read the same way. It exists because it used ' +
							'to be the only way to get that, and OneNote has no menu item for it: producing it ' +
							'means running a script against the GetHierarchy and Publish automation calls the ' +
							'desktop app exposes, for example meichthys/onenote-html-export, a free, ' +
							'open-source tool built for exactly this. Zip the folder it produces and upload ' +
							'that, since the upload box takes one file rather than a folder. If File > Export ' +
							'is available to you, it is less work for the same result.'
					),
					p(
						'Failing all of those, print one section at a time to PDF, or export it to DOCX, and ' +
							'hand Canonry that. It is read through the PDF or DOCX guide, the same as any other ' +
							"PDF or DOCX, and it loses the notebook's own structure: every page becomes one " +
							'long document and a subpage becomes just another heading. Whole-notebook scope ' +
							'drops pages here as well. Canonry can tell that a PDF came out of OneNote\u2019s ' +
							'own printer, and it can tell from the page footers when a print covers more than ' +
							'one section, so it says both on the confirmation screen rather than letting you ' +
							'think everything came across.'
					),
					p(
						'One thing the export menu offers is refused, and refused before an import starts ' +
							'rather than partway through it, so nothing is spent on it: XPS (.xps). It is the ' +
							'same printed notebook a PDF would be, and the PDF is already read. Canonry reads ' +
							'what a file is from its bytes, not from its name, so renaming one does not get it ' +
							'through.'
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
						'A .mht export carries no hierarchy at all, and Canonry does not invent one. A ' +
							"notebook exported that way is its sections' pages one after another with nothing " +
							'between them: no section name, no boundary, and nothing saying which page a subpage ' +
							'used to sit under. So every page comes across as its own entry with none proposed ' +
							'as a subpage. If your notebook\u2019s structure carries meaning you want kept, .one ' +
							'or .onepkg is the export that keeps it.'
					),
					warn(
						'A .mht also says nothing about what it covers, so Canonry cannot tell one section ' +
							'from a whole notebook by looking at the file, and the confirmation screen says as ' +
							'much rather than picking one. That is why the instruction is a section at a time: ' +
							'it is the one scope you can be sure kept everything, and you are the only one who ' +
							'knows which you chose. A .one or .onepkg names its own sections, so that question ' +
							'does not arise for them.'
					),
					warn(
						'The newer OneNote app that ships with Windows has no File > Export at all: PDF is ' +
							'its only export, and it is a print, so it carries no hierarchy. The classic ' +
							'desktop app can be installed alongside it and opens the same notebooks, which is ' +
							'the shortest route to a .one or a .onepkg if the app you have cannot make one.'
					),
					warn(
						'OneNote on a Mac has no File > Export either, and its own export only covers the ' +
							'page you are currently viewing, not the whole notebook. If your world lives in ' +
							'OneNote on a Mac, exporting page by page to PDF is the only option that app gives ' +
							'you, and syncing the notebook and exporting it from a Windows machine or from ' +
							'OneNote on the web is the way to get anything better.'
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
						'Whatever your tool can export: one file, or a zip of a folder of mixed files ' +
							'nested as deep as it likes. If Canonry does not recognise the shape of what you ' +
							'upload as one of the sources above, it runs the generic playbook automatically ' +
							'rather than stopping.'
					),
					p(
						'The upload box suggests the extensions the guides ask for, and that is a hint ' +
							'rather than a rule: Canonry reads what a file is from its bytes, so a file with ' +
							'an unusual extension or none at all is still read as text if that is what it ' +
							'holds. If your file manager will not let you choose it, switch the dialog to all ' +
							'files, or zip it.'
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
