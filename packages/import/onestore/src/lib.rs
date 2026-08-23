//! A OneNote `.one` section or `.onepkg` notebook into structural JSON, for
//! `packages/import/src/onestore.ts` to turn into the page tree `onenote.md` reads.
//!
//! Issue #603, epic #590. `docs/onenote-export.md` carries the measurement that justified
//! this, and `SPEC.md` §6.6 and §6.10 the product-level decision.
//!
//! # What this does and does not decide
//!
//! It extracts **structure and text**, and it renders no HTML. The document shape the
//! model finally reads is `expandOneNoteMhtml`'s, and that shape lives in TypeScript
//! (`mhtml.ts`), so one place owns it and the two readers cannot drift into producing
//! different-looking trees. This side is a thin structural extractor over
//! `onenote_parser`'s public API: it calls, it never edits, so MPL-2.0's file-level
//! copyleft never attaches to anything here (`AGENTS.md`, licence section).
//!
//! **Headings are deliberately not inferred.** [MS-ONE] carries no style identifier that
//! says "this paragraph is a heading": the only signals are font size and weight, and
//! `docs/corpus-onenote.md` already measured that guess going wrong on the `.mht` export,
//! where taking the 20pt `Calibri Light` paragraph as the title found 63 of 70 pages.
//! Guessing here would invent structure the file does not state. Run-level bold and
//! italic are dropped for a different reason: `stripHtmlPresentationNoise` deletes the
//! `style` attributes OneNote's own HTML export carries bold in, so the `.mht` path loses
//! it too, and dropping it is parity rather than a loss.
//!
//! # ABI
//!
//! Four `extern "C"` functions over one length-prefixed buffer, and no wasm-bindgen. The
//! caller writes the file into the buffer `onestore_alloc` returns, calls
//! `onestore_parse`, reads `[u32 le json length][json][blob bytes]` from the returned
//! pointer, and frees it. Binary attachments travel in the blob region rather than
//! base64 inside the JSON, so a 6MB image costs 6MB rather than 8MB and no encode pass.

use std::io::{Error as IoError, Read};

use onenote_parser::contents::{Content, Image, OutlineElement, OutlineItem, Table};
use onenote_parser::fs::FileSystem;
use onenote_parser::page::Page;
use onenote_parser::section::{Section, SectionEntry};
use onenote_parser::Parser;
use serde_json::{json, Value};
use typed_path::{PathType, TypedPath, TypedPathBuf};

/// The input file, written once by `onestore_alloc` and read by `read_file`.
///
/// A single-file view is all `parse_package` ever needs: it makes exactly one `read_file`
/// call and then swaps in its own in-cabinet filesystem for everything inside the archive.
/// `parse_section_buffer` takes the bytes directly and touches this not at all.
static mut INPUT: Vec<u8> = Vec::new();

/// The upload's own file name, written once by `onestore_alloc_name`.
static mut NAME: Vec<u8> = Vec::new();

fn input() -> &'static [u8] {
    // Single-threaded by construction: wasm32-unknown-unknown has no threads here, and one
    // module instance serves exactly one parse.
    unsafe { &*std::ptr::addr_of!(INPUT) }
}

#[derive(Clone, Copy)]
struct SingleFileFs;

fn unsupported(what: &str) -> IoError {
    IoError::other(format!("{what} is not available in this build"))
}

/// Only `read_file` is ever reached during a parse. The write half of the trait exists for
/// consumers that extract attachments to disk, which this one does not: attachments come
/// back through the blob region instead.
impl FileSystem for SingleFileFs {
    fn is_directory(&self, _path: TypedPath) -> Result<bool, IoError> {
        Ok(false)
    }
    fn read_dir(&self, _path: TypedPath) -> Result<Vec<TypedPathBuf>, IoError> {
        Err(unsupported("read_dir"))
    }
    fn read_file(&self, _path: TypedPath) -> Result<Vec<u8>, IoError> {
        Ok(input().to_vec())
    }
    fn write_file(&self, _path: TypedPath, _data: &[u8]) -> Result<(), IoError> {
        Err(unsupported("write_file"))
    }
    fn stream_to_file(&self, _path: TypedPath, _reader: &mut dyn Read) -> Result<(), IoError> {
        Err(unsupported("stream_to_file"))
    }
    fn make_dir(&self, _path: TypedPath) -> Result<(), IoError> {
        Err(unsupported("make_dir"))
    }
    fn canonicalize(&self, path: TypedPath) -> Result<TypedPathBuf, IoError> {
        Ok(path.to_path_buf())
    }
    fn exists(&self, _path: TypedPath) -> Result<bool, IoError> {
        Ok(true)
    }
}

/// Attachment bytes, accumulated across the whole parse and concatenated after the JSON.
/// A page's `assets` entries carry `off`/`len` into this.
#[derive(Default)]
struct Blobs {
    bytes: Vec<u8>,
    /// Refused rather than truncated: a caller that silently got half an image would
    /// store a corrupt asset and never know.
    budget: usize,
    /// Attachments the file declares, against the ones whose bytes actually came out.
    /// Reported so the reader can tell a GM that an image did not survive, rather than
    /// letting a page arrive quietly short of one.
    seen: u32,
    dropped: u32,
}

impl Blobs {
    fn push(&mut self, data: Vec<u8>) -> Option<(usize, usize)> {
        if self.bytes.len() + data.len() > self.budget {
            return None;
        }
        let off = self.bytes.len();
        let len = data.len();
        self.bytes.extend_from_slice(&data);
        Some((off, len))
    }
}

fn read_all(mut reader: Box<dyn Read>, cap: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    // `take` so a malformed length field in the file cannot ask for an unbounded read.
    reader.by_ref().take(cap as u64 + 1).read_to_end(&mut out).ok()?;
    if out.len() > cap {
        return None;
    }
    Some(out)
}

/// One image into the asset table, returning its index. `None` when the bytes are not in
/// this file (a OneDrive placeholder, or a desktop file whose data lives in the notebook's
/// cache rather than the section) or would blow the budget, and the caller then emits
/// nothing rather than an `<img>` pointing at a file that will not exist.
fn push_image(image: &Image, assets: &mut Vec<Value>, blobs: &mut Blobs) -> Option<usize> {
    blobs.seen += 1;
    let extracted = image.read().and_then(|reader| read_all(reader, blobs.budget));
    let Some(data) = extracted else {
        blobs.dropped += 1;
        return None;
    };
    let Some((off, len)) = blobs.push(data) else {
        blobs.dropped += 1;
        return None;
    };
    let name = image.image_filename().map(str::to_string).unwrap_or_else(|| {
        format!("image{}.{}", assets.len() + 1, image.extension().unwrap_or("png"))
    });
    assets.push(json!({
        "name": name,
        "off": off,
        "len": len,
        "alt": image.alt_text().unwrap_or_default(),
    }));
    Some(assets.len() - 1)
}

/// The same for an embedded file. OneNote lets a GM drop a PDF or a spreadsheet onto a
/// page, and `onenote.md`'s attachment rule is about the `_files` folder rather than
/// specifically about images, so these travel the same way.
fn push_file(
    file: &onenote_parser::contents::EmbeddedFile,
    assets: &mut Vec<Value>,
    blobs: &mut Blobs,
) -> Option<usize> {
    blobs.seen += 1;
    let Some(data) = read_all(file.read(), blobs.budget) else {
        blobs.dropped += 1;
        return None;
    };
    let Some((off, len)) = blobs.push(data) else {
        blobs.dropped += 1;
        return None;
    };
    assets.push(json!({ "name": file.filename(), "off": off, "len": len, "alt": "" }));
    Some(assets.len() - 1)
}

/// OneNote's own sentinel for a hyperlink's destination, stored inline in the paragraph's
/// text as a run styled hidden. `RichText::text` hands back the raw string, markers and
/// all, and `RichText::hyperlinks` reports offsets into that same raw string, so a reader
/// that used the text as it came would show a GM `\u{fddf}HYPERLINK "https://..."` as if
/// it were prose.
const HYPERLINK_MARKER: &str = "\u{fddf}HYPERLINK \"";

fn utf16_len(text: &str) -> u32 {
    u32::try_from(text.encode_utf16().count()).unwrap_or(u32::MAX)
}

/// The paragraph's visible text, plus what it takes to move a raw offset onto it.
///
/// Offsets are UTF-16 code units on both sides, which is what `onenote_parser` reports and
/// also exactly what a JavaScript string index means, so the reader slices the text it is
/// handed with no conversion. The rebase happens here rather than in TypeScript to keep
/// the marker constant in one place: that the format hides a URL inside the prose is this
/// crate's business, and the JSON boundary is cleaner for not carrying it across.
struct Cleaned {
    text: String,
    /// `(raw offset by which this much has been removed, cumulative units removed)`.
    shifts: Vec<(u32, u32)>,
}

impl Cleaned {
    fn rebase(&self, raw: u32) -> u32 {
        let removed = self
            .shifts
            .iter()
            .rev()
            .find(|(at, _)| raw >= *at)
            .map(|(_, removed)| *removed)
            .unwrap_or(0);
        raw.saturating_sub(removed)
    }
}

/// Byte spans to remove: every well-formed marker run, plus any leftover sentinel on its
/// own. Both go through one list so the visible string and the offset rebase can never
/// disagree about how much was dropped.
fn marker_cuts(text: &str) -> Vec<(usize, usize)> {
    let mut cuts: Vec<(usize, usize)> = Vec::new();
    let mut from = 0;
    while let Some(relative) = text[from..].find(HYPERLINK_MARKER) {
        let start = from + relative;
        let target_start = start + HYPERLINK_MARKER.len();
        let Some(relative_end) = text[target_start..].find('"') else {
            break;
        };
        let end = target_start + relative_end + 1;
        cuts.push((start, end));
        from = end;
    }
    for (offset, character) in text.char_indices() {
        if character == '\u{fddf}' && !cuts.iter().any(|(s, e)| offset >= *s && offset < *e) {
            cuts.push((offset, offset + character.len_utf8()));
        }
    }
    cuts.sort_by_key(|(start, _)| *start);
    cuts
}

fn clean(text: &str) -> Cleaned {
    let cuts = marker_cuts(text);
    if cuts.is_empty() {
        return Cleaned { text: text.to_string(), shifts: Vec::new() };
    }
    let mut out = String::with_capacity(text.len());
    let mut shifts = Vec::new();
    let mut removed = 0u32;
    let mut cursor = 0usize;
    for (start, end) in &cuts {
        out.push_str(&text[cursor..*start]);
        removed += utf16_len(&text[*start..*end]);
        shifts.push((utf16_len(&text[..*end]), removed));
        cursor = *end;
    }
    out.push_str(&text[cursor..]);
    Cleaned { text: out, shifts }
}

fn rich_text_block(
    text: &onenote_parser::contents::RichText,
    indent: u8,
    list: Option<&str>,
) -> Value {
    let cleaned = clean(text.text());
    // The parser has already resolved which runs each link covers, so its offsets are the
    // ones to trust; only the marker removal has to be applied on top of them.
    let links: Vec<Value> = text
        .hyperlinks()
        .iter()
        .filter_map(|link| {
            let (start, end) = (cleaned.rebase(link.start()), cleaned.rebase(link.end()));
            (start < end).then(|| json!({ "target": link.target(), "start": start, "end": end }))
        })
        .collect();
    json!({
        "k": "p",
        "text": cleaned.text,
        "links": links,
        "indent": indent,
        "list": list,
    })
}

fn table_block(table: &Table, assets: &mut Vec<Value>, blobs: &mut Blobs) -> Value {
    let rows: Vec<Value> = table
        .contents()
        .iter()
        .map(|row| {
            let cells: Vec<Value> = row
                .contents()
                .iter()
                .map(|cell| {
                    let mut blocks = Vec::new();
                    for element in cell.contents() {
                        element_blocks(element, 0, &mut blocks, assets, blobs);
                    }
                    Value::Array(blocks)
                })
                .collect();
            Value::Array(cells)
        })
        .collect();
    json!({ "k": "table", "rows": rows })
}

fn element_blocks(
    element: &OutlineElement,
    indent: u8,
    out: &mut Vec<Value>,
    assets: &mut Vec<Value>,
    blobs: &mut Blobs,
) {
    // A `List` alongside the contents is what makes this outline element a list item. Only
    // the marker's shape is kept, ordered against unordered: the exact bullet glyph and
    // its font are presentation, and `stripHtmlPresentationNoise` would drop them anyway.
    let list = element.list_contents().first().map(|list| {
        let ordered = list
            .list_format()
            .first()
            .is_some_and(|c| c.is_ascii_digit() || c.is_alphabetic());
        if ordered {
            "number"
        } else {
            "bullet"
        }
    });

    for content in element.contents() {
        match content {
            Content::RichText(text) => out.push(rich_text_block(text, indent, list)),
            Content::Table(table) => out.push(table_block(table, assets, blobs)),
            Content::Image(image) => {
                if let Some(index) = push_image(image, assets, blobs) {
                    out.push(json!({ "k": "image", "asset": index }));
                }
            }
            Content::EmbeddedFile(file) => {
                if let Some(index) = push_file(file, assets, blobs) {
                    out.push(json!({ "k": "file", "asset": index }));
                }
            }
            // An ink stroke carries no text. What it can carry is OneNote's own
            // handwriting recognition, and that hangs off the page rather than the stroke,
            // so it is emitted once at page level instead of here.
            Content::Ink(_) | Content::Unknown => {}
        }
    }

    for child in element.children() {
        outline_item_blocks(child, indent.saturating_add(1), out, assets, blobs);
    }
}

fn outline_item_blocks(
    item: &OutlineItem,
    indent: u8,
    out: &mut Vec<Value>,
    assets: &mut Vec<Value>,
    blobs: &mut Blobs,
) {
    match item {
        OutlineItem::Element(element) => element_blocks(element, indent, out, assets, blobs),
        OutlineItem::Group(group) => {
            for child in group.outlines() {
                outline_item_blocks(child, indent, out, assets, blobs);
            }
        }
    }
}

fn page_json(page: &Page, blobs: &mut Blobs) -> Value {
    let mut blocks = Vec::new();
    let mut assets = Vec::new();

    for content in page.contents() {
        match content {
            onenote_parser::page::PageContent::Outline(outline) => {
                for item in outline.items() {
                    outline_item_blocks(item, 0, &mut blocks, &mut assets, blobs);
                }
            }
            onenote_parser::page::PageContent::Image(image) => {
                if let Some(index) = push_image(image, &mut assets, blobs) {
                    blocks.push(json!({ "k": "image", "asset": index }));
                }
            }
            onenote_parser::page::PageContent::EmbeddedFile(file) => {
                if let Some(index) = push_file(file, &mut assets, blobs) {
                    blocks.push(json!({ "k": "file", "asset": index }));
                }
            }
            onenote_parser::page::PageContent::Ink(_)
            | onenote_parser::page::PageContent::Unknown => {}
        }
    }

    // Handwriting OneNote itself recognised. Kept because a GM who writes on a tablet has
    // prose here and nowhere else, and marked as ink so a reader knows its provenance.
    if let Some(recognition) = page.ink_recognition() {
        let text = recognition.text();
        if !text.trim().is_empty() {
            blocks.push(json!({ "k": "ink", "text": text }));
        }
    }

    json!({
        "title": page.title_text().unwrap_or_default(),
        "level": page.level(),
        "id": page.link_target_id(),
        "created": page.created_time().unix_timestamp(),
        "updated": page.updated_time().unix_timestamp(),
        "blocks": blocks,
        "assets": assets,
    })
}

fn section_json(section: &Section, blobs: &mut Blobs) -> Value {
    let mut pages = Vec::new();
    for series in section.page_series() {
        for page in series.pages() {
            pages.push(page_json(page, blobs));
        }
    }
    json!({ "name": section.display_name(), "pages": pages })
}

/// A section group is flattened into its sections, with the group's name prefixed onto
/// each one. `onenote.md` reads a folder tree whose levels are notebook, section and page,
/// so a nested group would either add a level the playbook does not describe or be
/// silently dropped; a prefixed name keeps the GM's own words without inventing a level.
fn collect_sections(
    entries: &[SectionEntry],
    prefix: &str,
    out: &mut Vec<Value>,
    blobs: &mut Blobs,
) {
    for entry in entries {
        match entry {
            SectionEntry::Section(section) => {
                let mut value = section_json(section, blobs);
                if !prefix.is_empty() {
                    let name = value["name"].as_str().unwrap_or_default().to_string();
                    value["name"] = json!(format!("{prefix} - {name}"));
                }
                out.push(value);
            }
            SectionEntry::SectionGroup(group) => {
                let nested = if prefix.is_empty() {
                    group.display_name().to_string()
                } else {
                    format!("{prefix} - {}", group.display_name())
                };
                collect_sections(group.entries(), &nested, out, blobs);
            }
        }
    }
}

/// `kind`: 0 a `.one` section, 1 a `.onepkg` package. Chosen by the caller from
/// `sniffUpload`'s answer rather than sniffed again here.
fn run(kind: u32, name: &str, blob_budget: usize) -> Result<(Value, Vec<u8>), String> {
    let mut blobs = Blobs { budget: blob_budget, ..Blobs::default() };
    let sections = match kind {
        0 => {
            let section = Parser::new_with_fs(SingleFileFs)
                .parse_section_buffer(input(), TypedPath::new(name, PathType::Windows))
                .map_err(|e| e.to_string())?;
            vec![section_json(&section, &mut blobs)]
        }
        1 => {
            let notebook = Parser::new_with_fs(SingleFileFs)
                .parse_package(TypedPath::new(name, PathType::Windows))
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            collect_sections(notebook.entries(), "", &mut out, &mut blobs);
            out
        }
        _ => return Err(format!("unknown input kind {kind}")),
    };
    let value = json!({
        "ok": true,
        "sections": sections,
        "blobBytes": blobs.bytes.len(),
        "attachmentsSeen": blobs.seen,
        "attachmentsDropped": blobs.dropped,
    });
    Ok((value, blobs.bytes))
}

/// Reserve `len` bytes for the input file and return where to write them.
#[no_mangle]
pub extern "C" fn onestore_alloc(len: usize) -> *mut u8 {
    let mut buffer = vec![0u8; len];
    let pointer = buffer.as_mut_ptr();
    unsafe {
        INPUT = buffer;
    }
    pointer
}

/// Reserve `len` bytes for the upload's own file name, as UTF-8, and return where to
/// write it.
///
/// The name is not cosmetic for a `.one`: `parse_section_buffer` takes the section's
/// display name from it, so a placeholder here would name the section after the
/// placeholder and the page tree would be built under the wrong folder.
#[no_mangle]
pub extern "C" fn onestore_alloc_name(len: usize) -> *mut u8 {
    let mut buffer = vec![0u8; len];
    let pointer = buffer.as_mut_ptr();
    unsafe {
        NAME = buffer;
    }
    pointer
}

/// Parse, and return `[u32 le json length][json][blob bytes]`. Never returns null: a
/// failure is a JSON body with `ok: false` and the parser's own message, because the
/// caller has to tell a GM which file could not be read and why.
#[no_mangle]
pub extern "C" fn onestore_parse(kind: u32, blob_budget: usize) -> *mut u8 {
    let raw = unsafe { &*std::ptr::addr_of!(NAME) };
    let name = if raw.is_empty() {
        String::from("section.one")
    } else {
        String::from_utf8_lossy(raw).into_owned()
    };

    let (value, blobs) = match run(kind, &name, blob_budget) {
        Ok(pair) => pair,
        Err(message) => (json!({ "ok": false, "error": message }), Vec::new()),
    };
    emit(&value, &blobs)
}

/// Free a buffer `onestore_parse` returned.
#[no_mangle]
pub unsafe extern "C" fn onestore_free(pointer: *mut u8) {
    if pointer.is_null() {
        return;
    }
    let mut header = [0u8; 4];
    header.copy_from_slice(std::slice::from_raw_parts(pointer, 4));
    let total = 4 + u32::from_le_bytes(header) as usize;
    drop(Vec::from_raw_parts(pointer, total, total));
}

fn emit(value: &Value, blobs: &[u8]) -> *mut u8 {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| br#"{"ok":false,"error":"encode"}"#.to_vec());
    let mut out = Vec::with_capacity(4 + body.len() + blobs.len());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out.extend_from_slice(blobs);
    let mut boxed = out.into_boxed_slice();
    let pointer = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    pointer
}
