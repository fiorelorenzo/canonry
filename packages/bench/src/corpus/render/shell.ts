/**
 * Shared process-shelling helpers for renderers that need a real binary rather than a
 * hand-rolled file format: `pandoc` for docx, `google-chrome` for anything that needs a
 * browser's text layout or paint, `gs` for merging PDFs. None of these are npm
 * dependencies - they are expected on PATH, the same way the sibling packages expect
 * `pdftotext` and friends to exist for a developer poking at a fixture by hand.
 *
 * Every helper here is a pure function of its input bytes: write to a fresh directory
 * under `os.tmpdir()`, run the tool once, read the result back, remove the directory.
 * Nothing here holds state between calls, and nothing here reads `Date.now()` or touches
 * randomness, so a renderer built on top of these stays reproducible.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class ShellToolError extends Error {
	readonly command: string;
	readonly args: readonly string[];
	readonly exitCode: number | null;

	constructor(command: string, args: readonly string[], exitCode: number | null, stderr: string) {
		super(`${command} ${args.join(' ')} exited ${exitCode}: ${stderr.trim() || '(no stderr)'}`);
		this.name = 'ShellToolError';
		this.command = command;
		this.args = args;
		this.exitCode = exitCode;
	}
}

/** Runs one process to completion, optionally feeding it `stdin`, and returns its stdout
 * as raw bytes. Binary-safe: pandoc's docx output goes straight through this, no text
 * encoding in between. Rejects with the tool's own stderr on a non-zero exit. */
export function runProcess(
	command: string,
	args: readonly string[],
	opts?: { input?: Uint8Array }
): Promise<Buffer> {
	const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
	const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
	child.on('error', reject);
	child.on('close', (code) => {
		if (code === 0) {
			resolve(Buffer.concat(stdout));
		} else {
			reject(new ShellToolError(command, args, code, Buffer.concat(stderr).toString('utf8')));
		}
	});
	if (opts?.input) child.stdin.write(opts.input);
	child.stdin.end();
	return promise;
}

/** Creates a fresh temp directory, runs `fn` against it, and always removes it, even if
 * `fn` throws - a renderer that shells out to three different tools in sequence needs
 * this cleanup to survive whichever one failed. */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** `-f markdown-smart` is deliberate: pandoc's plain `markdown` reader turns straight
 * quotes and apostrophes into curly ones by default, and a proper noun copied out of a
 * rendered docx has to come back character for character. */
export async function markdownToDocx(markdown: string): Promise<Uint8Array> {
	const bytes = await runProcess(
		'pandoc',
		['-f', 'markdown-smart', '-t', 'docx', '-o', '-'],
		{ input: Buffer.from(markdown, 'utf8') }
	);
	return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const CHROME_HEADLESS_FLAGS = [
	'--headless=new',
	'--disable-gpu',
	'--no-sandbox',
	'--disable-dev-shm-usage',
	'--hide-scrollbars',
	'--font-render-hinting=none'
];

/** Prints one HTML document to a one-page-per-CSS-page-break PDF with a real browser
 * layout engine, so the text pdf.js later extracts is genuine selectable text, not a
 * hand-built content stream. Chrome's own header/footer (URL, date, page number) is
 * turned off: it is not part of the fixture's content and would leak into every page's
 * extracted text. */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
	return withTempDir('bench-chrome-pdf', async (dir) => {
		const htmlPath = join(dir, 'page.html');
		const pdfPath = join(dir, 'page.pdf');
		await writeFile(htmlPath, html, 'utf8');
		await runProcess('google-chrome', [
			...CHROME_HEADLESS_FLAGS,
			`--print-to-pdf=${pdfPath}`,
			'--no-pdf-header-footer',
			pathToFileURL(htmlPath).href
		]);
		return new Uint8Array(await readFile(pdfPath));
	});
}

/** Screenshots one HTML document at an exact pixel size. Used for the assets (a card
 * rendered once, checked in as a PNG) and for building a scanned-page image (the typed
 * page is screenshotted, then re-embedded and rotated in a second HTML pass). */
export async function htmlToPng(
	html: string,
	size: { width: number; height: number }
): Promise<Uint8Array> {
	return withTempDir('bench-chrome-png', async (dir) => {
		const htmlPath = join(dir, 'page.html');
		const pngPath = join(dir, 'page.png');
		await writeFile(htmlPath, html, 'utf8');
		await runProcess('google-chrome', [
			...CHROME_HEADLESS_FLAGS,
			`--window-size=${size.width},${size.height}`,
			`--screenshot=${pngPath}`,
			pathToFileURL(htmlPath).href
		]);
		return new Uint8Array(await readFile(pngPath));
	});
}

/** Concatenates PDFs, in order, into one document with Ghostscript. `pdfwrite` is the
 * device that re-serialises rather than rasterises: a merged page that started with a
 * real text layer keeps it, and a merged page that started as an image stays an image
 * with no text layer, which is exactly the mix the PDF fixture needs. */
export async function mergePdfs(pdfs: readonly Uint8Array[]): Promise<Uint8Array> {
	return withTempDir('bench-gs-merge', async (dir) => {
		const inputPaths: string[] = [];
		for (const [index, pdf] of pdfs.entries()) {
			const path = join(dir, `in-${index}.pdf`);
			await writeFile(path, pdf);
			inputPaths.push(path);
		}
		const outputPath = join(dir, 'out.pdf');
		await runProcess('gs', [
			'-q',
			'-dNOPAUSE',
			'-dBATCH',
			'-sDEVICE=pdfwrite',
			`-sOutputFile=${outputPath}`,
			...inputPaths
		]);
		return new Uint8Array(await readFile(outputPath));
	});
}
