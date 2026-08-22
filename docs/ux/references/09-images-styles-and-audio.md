# References: images, styles and audio

This file covers image generation on an entry and its confirm-the-spend dialog (F1, G11, S3), the universe's image style catalogue (S2), the entry's single media gallery with upload and generate as its two doors in (R10, P6), the cover and its hover affordance (O2, U6), the aspect-ratio table by entity type (Q5), the Loremaster's narration presets (U2), and table mode's ambient audio layers (E2, E3). Today only the generate dialog and a first pass at the ratio table exist in the artifact: the gallery is still three disconnected surfaces that cannot delete anything, `image_style` has no slug, description, example image or sort order behind its nullable `universe_id`, `narration_style` and the ambient-layer interface do not exist at all, and a cover can only be replaced by finding the gallery again.

## Recraft — a style library you browse by looking, with the custom row one click deeper

**Maps to** the universe's image style catalogue, shipped presets as cards plus one custom style per universe behind the last card (S2)

Recraft's Styles panel opens to a Feed, an "infinite style library" of AI-generated styles searchable by descriptive terms like "comics" or "line art," alongside My styles, Saved and Shared tabs and a Display filter by image type. Clicking any style opens a detail view that shows sample images actually generated in that style, and clicking a sample surfaces its own metadata: the prompt, the style name, and the model that made it. Building a custom style is a separate flow: upload up to five reference images (256px minimum), adjust weight sliders between them, write an optional style-level prompt describing "technique, composition, color, and visual feel, not the subject" that gets embedded into the style, choose between two interpretation models, then generate a test image in the "Test it" panel before saving.

**Evidence** https://www.recraft.ai/docs/recraft-studio/styles/overview (style detail view showing sample images plus prompt/name/model metadata; Feed, My styles, Saved and Shared tabs); https://www.recraft.ai/docs/recraft-studio/styles/custom-styles/how-to-create-a-custom-style (reference image upload, weight sliders, the style-level prompt instruction, the two interpretation models, the "Test it" panel before Save style)

**Take** this validates S2's exact bet: a catalogue where every card resolves to real generated pictures rather than a name is what turns choosing into looking. The "Test it" step before saving is worth adding to Canonry's own custom-style row: let a GM see one generated preview against their prompt modifier before it becomes the universe's only unshipped style, rather than trusting a textarea blind.

**Leave** Recraft's Feed, remixing, weighted multi-style blending and choice of two interpretation models are a whole product surface for a designer iterating for hours. `image_style`'s job is six shipped rows plus one custom row per universe, decided once per world, not an infinite searchable library; none of Feed, remixing or the model choice belongs in a picker meant to be a single decision.

## Adobe Firefly — the variant count is a property of the model, not a manual toggle

**Maps to** one action that always confirms the spend, four variants or one image (F1)

Firefly's Generate image ties variant count directly to the model selected: Firefly Image 3 and Firefly Image 4 return four image variations, Firefly Image 4 Ultra and Firefly Image 5 return a single image, and the help page states this as a table rather than a setting a person toggles separately. After a batch lands, the interface offers two distinct follow-up actions rather than one ambiguous "regenerate": "Use settings" reruns the same configuration without the prompt, "Generate more" reruns the same configuration and prompt together for a fresh batch.

**Evidence** https://helpx.adobe.com/firefly/web/work-with-images/generate-images/generate-images-from-text-descriptions.html (the per-model table of variant counts; the grid view versus list view toggle; "Use settings" versus "Generate more" as two separate actions)

**Take** tying the count to a property (here, model; for Canonry, entity type) rather than a manual switch is close to what F1's dialog already does when it defaults the radio choice from entity type. Firefly's clean split between "run it again exactly" and "run it again with a new prompt" is worth keeping distinct in Canonry's own regenerate action, rather than merging both into one button whose behavior depends on what changed.

**Leave** Firefly buries the variant count inside a Model dropdown a GM would have to already know to open before finding out what it costs. F1's dialog puts both counts on visible radio rows with the price attached to each before either is chosen, which is the more honest shape when guardrail 1's confirm is the entire point of the surface.

## WordPress — one attachment row, several pointers, never a second copy

**Maps to** the entry's single media surface, one asset attaching to several roles without a second source of truth (R10)

`set_post_thumbnail($post, $thumbnail_id)` does not copy a file; it writes the attachment's own ID into the post's `_thumbnail_id` meta field. Attachments are their own post type, one row holding the file's location, generated thumbnail sizes, alt text and EXIF data, and that same attachment ID is what `wp_get_attachment_image()` resolves when the identical file is rendered inline inside a different post's content. "Featured image" and "inline image" are two different pointers into the same row; nothing about setting one touches the file or duplicates its metadata.

**Evidence** https://developer.wordpress.org/reference/functions/set_post_thumbnail/ (writes `_thumbnail_id` post meta pointing at an attachment ID; returns false rather than duplicating anything if the value is unchanged); https://developer.wordpress.org/themes/classic-themes/templates/attachment-template-files/ (attachments as their own post type carrying file location, generated sizes, alt text and EXIF, independent of any post that references them)

**Take** this is the shape R10's data layer should copy exactly: `media_asset` stays the one row per uploaded or generated file, and "is the cover," "is referenced in the body" and "is hidden from the party" are all pointers into or flags on that row, never a second copy of the file. A `cover_media_id` column on the entry is WordPress's `_thumbnail_id`; R9's `![alt](/w/.../media/<id> =50%)` markdown pointer is WordPress's inline `wp_get_attachment_image()` call. Same row, multiple pointers.

**Leave** WordPress's attachment is also a full post with its own permalink, comments and template hierarchy; `media_asset` needs none of that, it is a row plus a stored file, never a page of its own.

## Syrinscape — a layer is a typed sound source, a mood is a target-volume snapshot that eases in

**Maps to** the ambient audio layers for table mode, crossfade, and a mood the GM chooses (E2, E3)

Syrinscape's Sound Creator separates two concepts cleanly. An Element is the layer unit, typed as Sound Effect, Music or OneShot, each with its own Initial Volume, playback order and an independent "Crossfade samples?" toggle whose Crossfade Duration is "the number of seconds over which the samples will be crossfaded," automatically reduced to half the shorter sample's length if needed. A Mood is a named, saved combination of elements: each element carries a "Starts with Mood" flag and a Target Volume that "will be eased to" when that mood is selected, so switching moods fades every layer toward its new target rather than cutting between two fixed states. The FAQ frames the whole point as one click: moving "from a peaceful village to a tavern brawl... with just a single click" while players wait.

**Evidence** https://app.syrinscape.com/static/master/frontend/html_partials/syrinscape.html (the Sound Creator's own in-app help text: the Crossfade Duration definition and its half-sample-length cap; "Target Volume: When the selected element is started by a mood, its current volume will be eased to the target volume"; the "Starts with Mood" per-element flag); https://syrinscape.com/faq/ (SoundSets as "tens of thousands of prepared scenes (Moods)"; "you can move from a peaceful village to a tavern brawl... with just a single click")

**Take** this two-tier model, an Element as the independently-controlled layer and a Mood as a named target-volume snapshot that eases rather than cuts, is exactly what "a mood the GM chooses" should mean underneath E2 and E3, not a single manual crossfade slider a GM has to operate mid-scene. The FAQ's single-click framing is the right north star: the GM's one action is picking the mood's name, and the crossfade is what the system does in response, invisible as an action of its own.

**Leave** Syrinscape's property inspector (3D positioning, shuffle versus sequential playback, per-sample gain ranges, reverb presets) is a professional soundboard for the person building the SoundSet, not the person running the table. A GM picking a mood mid-session should never see a mixer this deep, only the mood's name and, if anything, one master crossfade duration behind it.

## Notion — hovering the cover is the entire menu, and the placeholder already agreed

**Maps to** the cover, hover or focus offering replace and remove (O2, U6), and the placeholder as the affordance that starts a generation (P6)

Before a cover exists, hovering the empty space above a Notion page's title reveals "Add cover." Once one exists, hovering the cover itself reveals "Change cover" and a reposition control, opening a picker with five entries: a curated Gallery, Upload, Link, an Unsplash search, and, as of 2026, an AI-generated option. Notion recommends a fixed 1500x600px (5:2) cover size, stated once rather than left to guesswork.

**Evidence** https://www.notion.com/help/guides/page-icons-and-covers (hover reveals "Add cover" before one exists and "Change cover" once one does; the five-option picker: Gallery, Upload, Link, Unsplash, AI; the 1500x600px recommendation)

**Take** the hover-reveals-the-control pattern is precisely U6's ask, and it is worth noting Canonry already reached the same instinct from the other direction: U6's own text says the cover's hover affordance is "the same shape the placeholder already uses to offer upload or generate" (P6). Notion's five options collapse cleanly to Canonry's two, since upload and generate are the only ways into media anywhere in the product (S3's "upload is unaffected" by a missing style); the cover's hover menu should offer exactly Replace and Remove resolving to those two, not a wider picker.

**Leave** Notion's cover is a single flat image property with no relationship to anything else on the page. It never has to reconcile with a gallery, a body reference, or a delete-while-in-use rule the way R10's cover does, so nothing about Notion's picker addresses what happens when a GM tries to remove an image that is still attached elsewhere.

## Cloudinary — the shape is decided once, server-side, before delivery

**Maps to** aspect ratios that vary by entity type, and the rule that a generated shape must not disagree with the displayed shape (Q5)

Cloudinary's `ar` parameter takes either an `a:b` ratio or a decimal (`ar_4:3`, `ar_16:9`, `ar_1.33`), combined with a crop mode like `c_fill` and, optionally, `g_auto`, AI-powered gravity that keeps the most important content in frame. The docs state the underlying principle plainly: images "should always be delivered from the server at their final size" rather than relying on the browser to resize a mismatched asset after the fact, and the interactive demo binds cropping mode, gravity and target dimensions into one URL a developer sets once per context.

**Evidence** https://cloudinary.com/documentation/resizing_and_cropping (the `ar_4:3` / `ar_16:9` / decimal aspect-ratio syntax; the `c_fill,g_auto` combination and what auto-gravity does; "images should always be delivered from the server at their final size")

**Take** the discipline worth taking whole is "decided server-side, at final size, once": Q5's rule that a generated shape must not disagree with a displayed shape is Cloudinary's same principle pushed one step earlier, into the generation model's own config rather than a runtime crop. Canonry doesn't need `g_auto`'s runtime content-aware cropping, since a generated image should already be composed for the ratio it was asked for, but it should keep Cloudinary's habit of naming the ratio as one explicit value tied to the context that needs it, exactly like Q5's re-derived table: portrait for a character or item, wide for a place, event or session.

**Leave** Cloudinary's full cropping vocabulary (fill, limit-fill, thumb, four flavors of pad, face detection, liquid rescaling) exists because Cloudinary reshapes images it did not create to fit contexts it does not control. Canonry controls both ends, the model config's `aspectRatio` and the display slot, so none of the runtime crop-mode selection is needed, only agreement between two numbers set once.

## Adobe Firefly Content Credentials — a badge that is a record attached to the file, not a separate flag

**Maps to** the generated badge on every produced image (F1), and how the mark travels with the asset rather than living in a second flag (R7)

Adobe automatically attaches Content Credentials to any asset where "100% of the pixels are generated with Adobe Firefly." The fields always included are deliberately minimal: an output thumbnail (Text to image only), the issuer (Adobe Inc.), the date, the app or device used, the AI tool used, and the general action taken (only "Created" or "Other edits" for Firefly-made assets). These credentials "are attached to their respective files" and may additionally be mirrored to Adobe's own recovery cloud, but the record's home is the file itself.

**Evidence** https://helpx.adobe.com/firefly/web/get-started/learn-the-basics/content-credentials-overview.html (the "100% of the pixels" trigger condition; the always-included field list: output thumbnail, issuer, date, app/device, AI tool, actions; "attached to their respective files")

**Take** Adobe's trigger, "100% of the pixels are generated," is the right test for Canonry's own badge: binary, about the provenance of the pixels, never a judgment call about how much a GM edited afterward. The minimal always-on field set (what made it, when, by what tool) is the right size for F1's inline "Generated" chip; detail belongs one click deeper, not in the badge itself. And the fact that the record is attached to the file rather than tracked as a separate flag is the same principle behind R7's "an image's audience follows its entry": state travels with the object, it is not a second, independently-settable switch that can drift out of sync with it.

**Leave** Content Credentials is a durable, tamper-evident, C2PA-standard metadata format built for images that leave the app entirely and get re-shared across the web, with a dedicated cloud-hosted recovery tool for when the embedded copy is stripped. Canonry's badge only has to survive as long as the image lives on the entry; none of the cross-platform provenance chain or cloud recovery machinery is worth building for it.

## fal.ai — the price lives on the model's own page, before the click

**Maps to** the confirmation that states cost before a paid action runs (F1, G11)

fal bills per model with a unit that varies by type (per image or megapixel for image generation, per second or flat rate for video, per request or compute-second for everything else), and that unit is "visible on the model's page in the gallery and at fal.ai/pricing" before a run ever starts. The docs are explicit about what is never billed: "you pay only for successful outputs, and you are never charged for server errors or time spent waiting in the queue." Prices are also queryable programmatically, returning a `unit_price` and `unit` per model endpoint.

**Evidence** https://fal.ai/docs/documentation/model-apis/pricing (per-model billing-unit table; "never charged for server errors or time spent waiting in the queue"; the pricing API's `unit_price`/`unit` response shape)

**Take** "never charged for a failure or a wait" is worth stating once in Canonry's own confirmation copy, since a GM who has watched a generation spinner fail is going to wonder whether it cost anything regardless. F1's dialog already states the price per option before Generate is clicked, which is fal's "visible on the model's page" habit applied at the actual point of the click rather than deferred to a separate pricing page a GM would have to go find.

**Leave** fal's pricing surface is built for developers integrating dozens of models into a pipeline, queryable per-endpoint in fractional cents per megapixel. A GM never needs to see a billing unit, only a credit count already resolved from it, which is what F1's "4 credits" and "1 credit" labels already do; fal's audience-facing pricing table does not need to reach any further into the product than that.

## ElevenLabs Music — a prompt answers five questions whether you ask it to or not

**Maps to** the mood a GM chooses for table mode's ambient audio layers, with ElevenLabs behind the generation (E2, E3)

ElevenLabs' own guidance states the mechanism plainly: "a prompt answers five questions, whether you intend it to or not: genre, mood, instrumentation, tempo, and production era. Any question you leave open, the model answers with the most statistically likely choice, which is to say, the most average one." The model responds to both abstract mood words ("eerie," "foreboding") and precise musical language, and for material meant to repeat cleanly as a layer rather than tell a story, the docs describe loop prompting as "an exercise in exclusion": state the bars, BPM and key, and state what is banned, for example "no melody, just drums."

**Evidence** https://elevenlabs.io/docs/overview/capabilities/music/best-practices (the five-question framework and the "most average" default-fill warning; the abstract-versus-precise mood examples; the loop-prompting exclusion technique)

**Take** the five-question framework is the right discipline behind a closed mood picker rather than a free-text box: E2/E3's mood control should resolve to genre, mood, instrumentation, tempo and era every time it fires, the same five slots, so two different GMs picking "tense" for a dungeon corridor get comparably tense results instead of whatever the model defaults to when a question is left open. The loop-prompting instinct, name the bars and the exclusions, is the right shape for an ambient layer specifically, since a layer has to repeat cleanly rather than develop.

**Leave** ElevenLabs' interface here is a prompt field, meant for someone iterating on wording across many attempts. A GM at the table needs a small, closed set of named moods, not a text box and a best-practices guide; the five-question resolution belongs in the universe's ambient-layer setup screen, decided once by whoever configures what "tense" means for that world, never exposed as a live prompt in table mode itself.

## Character.AI — the example is the voice, not a description of it

**Maps to** narration presets for the Loremaster's voice, an example sentence in that voice instead of an example image (U2)

A Character's Greeting is the first line spoken in a new conversation, capped at 500 characters and, for the quick-creation path, required rather than optional. The documentation is direct about why it matters more than any other field: "the greeting can have a large impact, especially on a character without a lot of other details or a well-known name to identify them," to the point that in quick creation "the Greeting can be almost all that defines them." A greeting also does double duty setting the scene, telling a new user "what talking with them will be like," and a creator can write up to five additional greetings for variety.

**Evidence** https://book.character.ai/character-guide/character-attributes/greeting (the 500-character cap and the quick-creation requirement; "the greeting can have a large impact... the Greeting can be almost all that defines them"; a greeting's job of setting the scene and showing "what talking with them will be like"; the five-additional-greetings allowance)

**Take** this is the exact mechanism U2 asks for: one written sentence demonstrates a voice far better than any adjective describing it, because the reader is shown the register directly instead of being told about it. `narration_style`'s example line should be written with this instinct in mind, a sentence with a hook and a specific rhythm, not a generic pleasantry, because a bland example teaches a bland preset the same way a vague style prompt taught a vague image under the old textarea S2 replaced.

**Leave** Character.AI's greeting is a functional prompt component that actively shapes what the model generates next in that conversation, not only a display sample for a person choosing between options. `narration_style`'s example sentence in Canonry sits closer to the badge in spirit than the mechanism: illustrative to the GM picking a preset, while the actual instruction to the model lives in the preset's own separate prompt clause per the decision text, so the example line itself never has to double as the steering input the way Character.AI's greeting does.

## Spotify — crossfade, automix and gapless stay three separate toggles, never merged

**Maps to** crossfade for table mode's ambient audio layers (E2, E3)

Spotify's official steps describe Crossfade as a feature that "overlaps 2 tracks by fading out of the first while fading in the next," turned on in Settings under Playback and controlled with a single length slider; a secondary source confirms the exact range as adjustable "between 1 and 12 seconds." Automix (beat-matched transitions with intro/outro skipping) and Gapless playback (removing silence between tracks entirely) sit in the same Playback menu as fully independent toggles doing different jobs, not variations of the same slider.

**Evidence** https://support.spotify.com/us/article/tracks-transitions/ (the official Crossfade, Automix and Gapless playback steps, each an independent toggle under Playback); https://screenrant.com/spotify-crossfade-dj-tools-explained/ ("Spotify lets users adjust the crossfade duration between 1 and 12 seconds," and the practical guidance that 5-6 seconds suits personal listening while up to 12 suits a room full of people)

**Take** keeping crossfade, beat-matched transition and silence-removal as three distinct, independently-toggled concepts is worth borrowing directly: table mode's ambient layers need Spotify's plain crossfade, one duration, fading one layer out while the next fades in, and nothing like beat-matching, since ambient loops have no beat grid to match. A single seconds value is the entire control surface a GM should ever see for it.

**Leave** Spotify's crossfade is a global player preference set once in account settings and forgotten. E2/E3's crossfade is a per-mood-change event a GM triggers mid-session by picking a new mood, so it has to live on the table-mode control itself, not in a settings page nobody opens while running a game.

## Endel — an endlessly adapting backdrop, not a composition anyone is meant to notice

**Maps to** a mood the GM chooses for table mode's ambient audio (E2, E3)

Endel offers three named modes, Focus, Relax and Sleep, each an intent rather than a genre, generated in real time by a proprietary engine: "Endel does not stream a playlist. It generates an endless soundscape... then keeps composing as your context changes." The site states its own restraint directly: "unlike music, Endel is designed to restore, not entertain. No artistic statement here, just an endlessly adapting backdrop."

**Evidence** https://endel.io/science ("All Endel sounds are generated using our proprietary, patented AI engine... personalized to your inputs at all times, and endless"; "Unlike music, Endel is designed to restore, not entertain. No artistic statement here, just an endlessly adapting backdrop"; the three-mode Focus/Relax/Sleep structure)

**Take** "an endlessly adapting backdrop, not an artistic statement" is precisely the tone table mode's ambient layers should aim for: a mood a GM picks, tavern, dungeon, storm, is functional set dressing, never a composition anyone at the table is meant to consciously notice. Three named-intent modes rather than a per-instrument knob is the right level of control for someone running a game, not mixing one.

**Leave** Endel's adaptation runs on inputs Canonry has no access to and no reason to want: heart rate from a wearable, live weather, location, time of day. The GM's own mood choice is the only input that exists at a table; nothing here should be sensed automatically.

## Material Design — a disabled control paired with the reason, and a test for when confirmation is even needed

**Maps to** the refusal rather than a silent default when no style is set (S3), and delete refused while an image is the cover or referenced in the body (R10)

Material's guidance on unavailable features is direct: "features not available may be indicated as disabled in the UI... paired with text explaining it is not available," rather than a control that is simply dead with no reason given. Its confirmation guidance supplies the other half of the same logic, a test for when a dialog is even warranted: "confirmation isn't necessary when the consequences of an action are reversible or negligible... if a check mark shows an image has been selected, further confirmation is unnecessary."

**Evidence** https://m1.material.io/patterns/errors.html ("features not available may be indicated as disabled in the UI... paired with text explaining it is not available"); https://m2.material.io/design/communication/confirmation-acknowledgement.html (the reversible/negligible test for whether a confirmation dialog is necessary at all)

**Take** "disabled, paired with text explaining it is not available" is Material's own validation of S3's choice: a refusal with the link that fixes it, not a bare disabled button with a tooltip nobody reads. The reversible/negligible test is the right lens for R10's delete rule too, and it argues for something stronger than a dialog: deleting a stored file and its database row is neither reversible nor negligible, which is exactly why R10 refuses the action outright with no confirmation offered at all, rather than merely asking permission for something that would otherwise proceed.

**Leave** Material's own answer to an irreversible destructive action is still a confirmation dialog with a styled button, asking permission before proceeding. R10's answer to deleting an image still in use is a refusal with no dialog whatsoever, because the problem is not consent, it is a body that would point at a missing file; Material's pattern language has no entry for "this action is currently impossible until you do something else first," which is the actual shape R10 needs.

## Apple Human Interface Guidelines — Cancel is the button an unread keypress should land on

**Maps to** confirming every paid action (G11), and the weight given to a destructive choice before R10's refusal even applies

Apple's alert guidance pairs the two cases Canonry treats the same way: "alerts disrupt the user experience and should only be used in important situations like confirming purchases and destructive actions (such as deletions)." Every alert requires a Cancel button, worded exactly "Cancel," and the guidance goes further than simply offering an exit: "make the Cancel button bold by marking it as the default button," so a person who presses Return without reading is not the one who completes the destructive or paid action. A button that does perform the destructive action gets its own distinct "Destructive" style, rendered differently from a neutral confirm.

**Evidence** https://codershigh.github.io/guidelines/ios/human-interface-guidelines/ui-views/alerts/index.html, a mirror of Apple's Human Interface Guidelines "Alerts" page (developer.apple.com/design/human-interface-guidelines/alerts, opened directly; its body renders as an empty client-rendered shell in this environment, so the mirrored text is the citable copy) ("alerts disrupt the user experience and should only be used in important situations like confirming purchases and destructive actions"; "provide a Cancel button... make the Cancel button bold by marking it as the default button"; "set the button's style to Destructive")

**Take** grouping "confirming purchases" and "destructive actions" under one alert weight validates G11's read that generation, a spend, deserves the same confirm-every-time treatment as anything destructive. Defaulting the focused button to Cancel rather than the paid action is worth adopting literally in F1's own generate dialog: an unread Return keypress should never fire a 4-credit generation.

**Leave** Apple's model still assumes the destructive action is legal to attempt and only needs a second, deliberate click. R10's delete-while-referenced case sits a step earlier than anything an alert addresses: the action is refused before any alert would even open, because the failure state, a body pointing at nothing, is worse than an accidental confirm would have been.

## GitHub — one image, one job, and nothing else on the repository ever points at it

**Maps to** the entry's single media surface, as the pattern R10 is deliberately not (R10)

A GitHub repository gets exactly one social preview image, set from Settings, General, Social preview, Edit, Upload an image (PNG, JPG or GIF under 1MB, a recommended 1280x640px), replaced by uploading a new one or cleared entirely with "Remove image." Nothing else on the repository can reference that same file; there is no gallery, no history of previous uploads, no second role the image could ever be asked to serve.

**Evidence** https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview (the upload/remove flow; PNG/JPG/GIF under 1MB, recommended 1280x640px; the transparency-on-dark-mode note)

**Take** nothing structural, and that is exactly the point of including it: this is the cleanest illustration of the single-role case R10 explicitly refuses to be. It is worth naming precisely because it shows what a media surface looks like when it never has to ask "is this file used somewhere else," which clarifies by contrast why R10's gallery has to check the cover slot and the body before allowing a delete.

**Leave** everything about the mechanism. GitHub's social preview cannot structurally collide with another use of the same file, so it has nothing to say about a gallery, a cover, and a body reference all pointing at the same `media_asset` row, which is the entire design problem R10 has to solve.

## What I would build from this

- Give `image_style` a Recraft-shaped catalogue now: add `slug`, `description`, `example_images` and `sort_order` columns, and borrow Recraft's "Test it" step for the custom-style row so a GM sees one generated preview against their prompt modifier before it becomes the universe's only unshipped style.
- Build the media gallery's data model on WordPress's attachment shape: `media_asset` stays the one row per file, `cover_media_id` on the entry and the body's `![alt](/w/.../media/<id> =50%)` pointer both resolve to it, and delete checks both pointers before it is permitted, the same discipline as `_thumbnail_id` never duplicating what `wp_get_attachment_image()` also renders inline.
- Design table mode's ambient audio as Syrinscape's two-tier model: Elements as independently-controlled typed layers, Moods as named target-volume snapshots that ease in on selection, so the GM's one action stays picking a mood name, the way Syrinscape's own FAQ frames "a single click" while players wait.
- Give the cover a Notion-shaped hover menu with exactly two entries, Replace and Remove, resolving to the same Upload and Generate the gallery already offers, never a wider picker.
- Write Q5's re-derived ratio table with Cloudinary's discipline: one named ratio value per entity type, decided once and shared between the generation model's config and the display slot, never a runtime crop reconciling a mismatch after the fact.
- Put ElevenLabs' five-question framework, genre, mood, instrumentation, tempo, production era, behind the universe's ambient-layer setup screen rather than in front of the GM: an admin resolves what "tense" or "market day" means once, and table mode only ever shows the resolved mood's name.
- Write `narration_style`'s example sentence with Character.AI's greeting instinct: a sentence with a hook and a specific rhythm in the actual voice, not a description of the voice, the same discipline S2 already applied by replacing a prompt textarea with pictures.
- Default F1's generate dialog's focused button to Cancel, not Generate, following Apple's rule that an alert confirming a purchase or a destructive action should never let an unread Return keypress complete it.
- Keep R10's delete refusal a refusal, never a confirmation dialog: Material's own pattern language has no entry for "this action is currently impossible," which is the actual shape of an image still referenced in the cover slot or the body.

## Anti-references

- Recraft's Feed, an infinite searchable style library, is the scale S2 explicitly rejected two products ago in favor of six fixed presets and one custom row; adding search or an ever-growing catalogue would turn a once-per-world decision into a browsing session.
- Endel's adaptation runs on heart rate, weather and location pulled from a wearable and the OS; Canonry's ambient layers have no sensors and no reason to want any, since the GM's own mood choice is the only input that exists at the table.
- ElevenLabs Music's control surface is a prompt field a person learns to write well over many attempts. Exposing that box directly to a GM mid-session would reopen the same free-text failure S2 and S3 already closed for images, and it must not reopen for audio.
